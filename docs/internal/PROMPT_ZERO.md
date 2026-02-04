# MainThread POC - Code Review & Rewrite Plan

## Summary

Rewrite backend from Node/Fastify to **Python** with **claude-agent-sdk**, fix frontend bugs, add **SSE** for real-time updates.

---

## Current State Issues

### Bugs Found
1. `routes/threads.ts:56-58` - `askClaude()` returns object but passed directly to `addMessage()` expecting string
2. `ChatPanel.tsx:19-21` - useEffect scroll has empty deps, only scrolls on mount
3. `threadStore.ts:63-71` - No `res.ok` check before parsing JSON
4. Orphan sub-threads disappear if parent deleted

### Unused Code (to delete)
- `packages/agent/` - Never imported
- `packages/threads/` - ThreadManager never wired up
- Node backend in `apps/server/` - Being replaced

---

## New Architecture

```
mainthread/
├── apps/
│   ├── web/                 # React frontend (keep, fix bugs)
│   └── api/                 # NEW: Python backend
│       ├── main.py          # FastAPI app + SSE
│       ├── agents.py        # Claude Agent SDK integration
│       ├── db.py            # SQLite (same schema)
│       └── requirements.txt
└── packages/
    └── ui/                  # Keep React components
```

### Tech Stack
- **Backend**: Python 3.11+, FastAPI, SQLite, claude-agent-sdk
- **Frontend**: React + Vite + Zustand (existing, with fixes)
- **Real-time**: SSE (Server-Sent Events)

---

## Implementation Plan

### Phase 1: Python Backend Setup

**File: `apps/api/requirements.txt`**
```
fastapi>=0.109.0
uvicorn>=0.27.0
claude-agent-sdk>=0.2.0
python-dotenv>=1.0.0
sse-starlette>=2.0.0
```

**File: `apps/api/main.py`**
- FastAPI app with CORS
- Routes:
  - `GET /api/threads` - List all threads
  - `GET /api/threads/{id}` - Get thread with messages
  - `POST /api/threads` - Create thread
  - `POST /api/threads/{id}/messages` - Send message (streams via SSE)
  - `PATCH /api/threads/{id}/status` - Update status
  - `GET /api/threads/{id}/stream` - SSE endpoint for thread updates

### Phase 2: Agent SDK Integration

**File: `apps/api/agents.py`**

Using claude-agent-sdk properly:
```python
from claude_agent_sdk import query, ClaudeAgentOptions, AgentDefinition, HookMatcher

# Main thread agent with ability to spawn sub-threads
async def run_main_agent(thread, user_message):
    async for message in query(
        prompt=user_message,
        options=ClaudeAgentOptions(
            allowed_tools=["Read", "Edit", "Bash", "Glob", "Grep", "Task"],
            agents={
                "sub-thread": AgentDefinition(
                    description="Spawn for focused subtasks",
                    prompt="You are a focused worker...",
                    tools=["Read", "Edit", "Bash", "Glob", "Grep"]
                )
            },
            hooks={
                "SubagentStop": [HookMatcher(hooks=[on_subagent_done])],
                "Stop": [HookMatcher(hooks=[on_agent_stop])]
            }
        )
    ):
        yield message  # Stream to SSE
```

Key features:
- **Subagents** for spawning sub-threads
- **Sessions** for resuming conversations (`resume=session_id`)
- **Hooks** for detecting completion/blocked states
- **parent_tool_use_id** to track which messages belong to which thread

### Phase 3: SSE Real-time Updates

**Backend SSE endpoint:**
```python
from sse_starlette.sse import EventSourceResponse

@app.get("/api/threads/{thread_id}/stream")
async def stream_thread(thread_id: str):
    async def event_generator():
        async for msg in run_agent(thread_id):
            yield {"event": "message", "data": json.dumps(msg)}
    return EventSourceResponse(event_generator())
```

**Frontend SSE client:**
```typescript
// In threadStore.ts
const eventSource = new EventSource(`/api/threads/${threadId}/stream`);
eventSource.onmessage = (e) => {
  const data = JSON.parse(e.data);
  // Update thread messages in real-time
};
```

### Phase 4: Frontend Fixes

1. **Fix scroll** (`ChatPanel.tsx:19-21`):
   ```tsx
   useEffect(() => {
     messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
   }, [messages.length]);  // Add dependency
   ```

2. **Fix error handling** (`threadStore.ts`):
   ```tsx
   const res = await fetch(...);
   if (!res.ok) throw new Error(`HTTP ${res.status}`);
   const thread = await res.json();
   ```

3. **Replace `prompt()`** with proper modal dialog component

4. **Add SSE integration** to threadStore for real-time updates

### Phase 5: Delete Unused Code

- Remove `apps/server/` (Node backend)
- Remove `packages/agent/` (unused)
- Remove `packages/threads/` (unused)

---

## Data Flow

```
User types message
    ↓
Frontend POST /api/threads/{id}/messages
    ↓
Backend starts Agent SDK query()
    ↓
Agent works (tools, subagents)
    ↓ (streaming via SSE)
Frontend receives real-time updates
    ↓
SubagentStop hook fires → notify parent thread
    ↓
Stop hook fires → mark thread done/blocked
```

---

## Files to Create/Modify

### Create (Python backend)
- `apps/api/main.py` - FastAPI app
- `apps/api/agents.py` - Agent SDK wrapper
- `apps/api/db.py` - SQLite operations
- `apps/api/requirements.txt` - Dependencies
- `apps/api/pyproject.toml` - Python project config

### Modify (Frontend fixes)
- `apps/web/src/components/ChatPanel.tsx` - Fix scroll, add modal
- `apps/web/src/store/threadStore.ts` - SSE integration, error handling
- `apps/web/src/components/ThreadSidebar.tsx` - Replace prompt()

### Delete
- `apps/server/` - Entire Node backend
- `packages/agent/` - Unused
- `packages/threads/` - Unused

---

## Verification

1. **Run Python backend**: `cd apps/api && uvicorn main:app --reload`
2. **Run frontend**: `cd apps/web && pnpm dev`
3. **Test flow**:
   - Create main thread → verify in UI
   - Send message → see streaming response via SSE
   - Spawn sub-thread → verify parent notified
   - Sub-thread signals [DONE] → status updates in real-time
