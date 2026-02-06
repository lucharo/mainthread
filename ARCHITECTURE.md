# MainThread Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  React Frontend (Vite + Zustand)                    :3000       │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ ChatPanel │  │ Sidebar  │  │ Minimap  │  │ threadStore.ts│  │
│  │          │  │          │  │          │  │ (SSE client)  │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───────┬───────┘  │
│       │              │              │                │          │
│       └──────────────┴──────────────┴────────────────┘          │
│                              │                                  │
│              EventSource (SSE) + REST API                       │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               │ HTTP
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│  FastAPI Backend (server.py)                        :2026        │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ SSE Endpoint  /api/threads/{id}/stream                     │  │
│  │  • Replays missed events from SQLite on reconnect          │  │
│  │  • Heartbeat every 30s                                     │  │
│  │  • last_event_id query param for recovery                  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────┐  ┌──────────────────────────────────┐  │
│  │ broadcast_to_thread()│  │ MessageStreamProcessor           │  │
│  │  1. Write to SQLite  │  │  • Processes SDK stream events   │  │
│  │     events table     │  │  • Saves content incrementally   │  │
│  │  2. Push to SSE      │  │  • Tracks tool call FIFO         │  │
│  │     subscriber queues│  │  • Handles thinking/text/tools   │  │
│  └──────────┬───────────┘  └─────────────┬────────────────────┘  │
│             │                            │                       │
│  ┌──────────┴────────────────────────────┴────────────────────┐  │
│  │ run_agent_with_retry()                                      │  │
│  │  • Wraps agent execution with retry logic                   │  │
│  │  • On process death: re-fetch session_id, send continuation │  │
│  │  • Up to MAX_AGENT_RETRIES (default 2)                      │  │
│  └─────────────────────────┬──────────────────────────────────┘  │
│                            │                                     │
│  ┌─────────────────────────┴──────────────────────────────────┐  │
│  │ Background Services                                         │  │
│  │  • Watchdog (15s interval) - detects stuck threads          │  │
│  │  • Event cleanup (hourly) - prunes events older than 24h    │  │
│  │  • Notification workers - sequential per-parent queues      │  │
│  │  • Agent semaphore (max 10 concurrent)                      │  │
│  └─────────────────────────────────────────────────────────────┘  │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│  Claude Agent SDK (subprocess per thread)                        │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ run_agent() → claude_sdk.query()                          │    │
│  │  • Streams: text, thinking, tool_use, tool_result, usage  │    │
│  │  • resume=session_id for conversation continuity          │    │
│  │  • Custom tools: SpawnThread, ListThreads, ReadThread...  │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  Auto-persists to:                                               │
│  ~/.claude/projects/<encoded-path>/<session-id>.jsonl             │
│  (complete conversation history - our crash recovery backup)      │
└──────────────────────────────────────────────────────────────────┘


## Persistence Layers

┌──────────────────────────────────────────────────────────────────┐
│                     SQLite (Primary)                              │
│                   ~/.mainthread/mainthread.db                     │
│                                                                  │
│  ┌────────────┐  ┌────────────┐  ┌─────────────────────────┐    │
│  │  threads    │  │  messages   │  │  events                 │    │
│  │            │  │            │  │                         │    │
│  │ id         │  │ id         │  │ seq_id (auto-increment) │    │
│  │ title      │  │ thread_id  │  │ thread_id               │    │
│  │ status     │  │ role       │  │ event_type              │    │
│  │ parent_id  │  │ content    │  │ data (JSON)             │    │
│  │ session_id │  │ content_   │  │ created_at              │    │
│  │ model      │  │   blocks   │  │                         │    │
│  │ ...        │  │ timestamp  │  │ Indexed on:             │    │
│  │            │  │            │  │  (thread_id, seq_id)    │    │
│  └────────────┘  └────────────┘  └─────────────────────────┘    │
│                                                                  │
│  threads: Thread state, config, hierarchy                        │
│  messages: Persisted conversation content                        │
│  events: SSE events for reconnect replay (pruned after 24h)     │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                   SDK JSONL Files (Backup)                        │
│           ~/.claude/projects/<path>/<session-id>.jsonl            │
│                                                                  │
│  • Written automatically by Claude Agent SDK                     │
│  • Complete conversation: user msgs, assistant msgs, tool calls  │
│  • Append-only, crash-safe                                       │
│  • Used ONLY for catastrophic recovery (DB corruption/loss)      │
│  • Sub-threads in: <session-id>/subagents/<sub-session>.jsonl    │
└──────────────────────────────────────────────────────────────────┘


## Recovery Ladder (most common → rarest)

  ┌─────────────────────────────────────────────────────────────┐
  │ 1. CLIENT RECONNECT (browser tab switch, network blip)      │
  │    Frontend sends last_event_id → server replays from       │
  │    SQLite events table → seamless, no flash                 │
  ├─────────────────────────────────────────────────────────────┤
  │ 2. SERVER RESTART (deploy, crash, hot reload)               │
  │    Events persist in SQLite → client reconnects with        │
  │    last_event_id → missed events replayed from DB           │
  │    Stale pending threads reset to active on startup         │
  ├─────────────────────────────────────────────────────────────┤
  │ 3. AGENT PROCESS DEATH (OOM, timeout, SDK crash)            │
  │    run_agent_with_retry() catches error →                   │
  │    re-fetches thread for latest session_id →                │
  │    sends continuation message → retries (up to 2x)          │
  │    Watchdog detects stuck threads every 15s                 │
  ├─────────────────────────────────────────────────────────────┤
  │ 4. CATASTROPHIC FAILURE (DB corruption, data loss)          │
  │    Reconstruct from SDK .jsonl files in ~/.claude/projects  │
  │    Full conversation history available for recovery          │
  └─────────────────────────────────────────────────────────────┘


## Event Flow (Real-Time Streaming)

  User sends message
       │
       ▼
  POST /api/threads/{id}/messages
       │
       ▼
  run_agent_with_retry()
       │
       ▼
  Claude SDK subprocess starts (or resumes with session_id)
       │
       │  async for msg in stream:
       ▼
  MessageStreamProcessor.process_message()
       │
       ├──→ Accumulate content in memory (collected_blocks)
       ├──→ Save to SQLite messages table (incremental)
       │
       ▼
  broadcast_to_thread()
       │
       ├──→ Write to SQLite events table (seq_id assigned)
       ├──→ Push to all SSE subscriber queues
       │
       ▼
  SSE EventSource in browser receives event
       │
       ├──→ text_delta → append to StreamingMessage
       ├──→ thinking → append to ThinkingBlock
       ├──→ tool_use → show ToolBlock with spinner
       ├──→ tool_result → show checkmark on ToolBlock
       ├──→ complete → atomic transition: clear streaming, show persisted
       │
       ▼
  User sees response streaming in real-time


## Thread Hierarchy

  Main Thread (green dot when idle)
       │
       ├── Sub-Thread A (blue dot when running)
       │       │
       │       └── Nested Sub-Thread (if nesting enabled)
       │
       ├── Sub-Thread B (amber dot when pending)
       │
       └── Task Thread (ephemeral, hidden from minimap)
               └── Read-only, auto-cleaned

  • Main thread spawns sub-threads via SpawnThread tool
  • Sub-threads signal completion via SignalStatus tool
  • Parent receives notification and can auto-react
  • Task threads are fire-and-forget SDK subagents


## Key Config (Environment Variables)

  MAINTHREAD_AGENT_TIMEOUT=1800    # 30 min default (complex tasks need time)
  MAINTHREAD_MAX_RETRIES=2         # Auto-retry on process death
  MAINTHREAD_MAX_AGENTS=10         # Concurrent agent limit
  DATABASE_PATH=~/.mainthread/mainthread.db
