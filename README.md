# MainThread

Multi-threaded Claude conversations with a web UI. Create parallel sub-threads for complex tasks with automatic status notifications.

## Quick Start

```bash
# Install with pip/uv
pip install .
# or
uv pip install .

# Run the server (opens web UI at http://localhost:2026)
mainthread

# Or with custom options
mainthread serve --port 2026 --work-dir /path/to/project
```

## Features

- **Multi-threaded Conversations**: Spawn sub-threads for parallel work
- **Automatic Notifications**: Sub-threads notify parent when done or blocked
- **Claude Code Integration**: Uses Claude Code SDK for tool use and extended thinking
- **Real-time Streaming**: SSE-based streaming with reconnection recovery
- **Git-Aware**: Detects branch, repo, and worktree status
- **Permission Modes**: Plan, Accept, Normal, or Bypass permissions

## Architecture

```
mainthread/
├── src/mainthread/           # Python backend
│   ├── cli.py               # Typer CLI (mainthread command)
│   ├── server.py            # FastAPI server with SSE
│   ├── db.py                # SQLite persistence
│   ├── agents/              # Claude SDK integration
│   │   ├── core.py          # Agent execution loop
│   │   ├── registry.py      # Service registry for tools
│   │   └── tools/           # Tool implementations
│   │       ├── spawn_thread.py
│   │       ├── list_threads.py
│   │       ├── read_thread.py
│   │       ├── archive_thread.py
│   │       ├── send_to_thread.py
│   │       └── signal_status.py
│   └── static/              # Built React frontend
├── apps/web/                # React frontend source
│   └── src/
│       ├── components/      # UI components
│       │   ├── ChatPanel.tsx
│       │   ├── ThreadHeader.tsx
│       │   ├── MessageInput.tsx
│       │   └── MessageBubble.tsx
│       └── store/           # Zustand state
└── pyproject.toml           # Package configuration
```

## Development

### Prerequisites
- Python 3.11+
- Node.js 20+
- pnpm
- Claude Code CLI (`npm install -g @anthropic-ai/claude-code`)

### Setup

```bash
# Install Python dependencies
uv sync

# Install frontend dependencies
pnpm install

# Build frontend (outputs to src/mainthread/static/)
pnpm run build

# Run in development mode (with auto-reload)
uv run mainthread serve --reload
```

### Frontend Development

```bash
# Run frontend dev server (hot reload)
cd apps/web
pnpm run dev  # Runs on port 3000, proxies API to 2026
```

## Thread Tools

Main threads have access to these tools:

| Tool | Description |
|------|-------------|
| `SpawnThread` | Create a sub-thread for parallel work |
| `ListThreads` | List all threads with status |
| `ReadThread` | Read a thread's conversation history |
| `ArchiveThread` | Archive completed threads |
| `SendToThread` | Send follow-up messages to child threads |
| `Task` | Quick ephemeral work (Explore, Plan agents) |

Sub-threads have:

| Tool | Description |
|------|-------------|
| `SignalStatus` | Signal completion (`done`) or need for help (`blocked`) |
| `Task` | Same as main thread |

## API Reference

### Threads

- `GET /api/threads` - List threads (query: `include_archived=true`)
- `GET /api/threads/:id` - Get thread details
- `POST /api/threads` - Create thread
- `PATCH /api/threads/:id/status` - Update status
- `PATCH /api/threads/:id/config` - Update model/permissions
- `DELETE /api/threads/:id/messages` - Clear messages
- `POST /api/threads/:id/archive` - Archive thread
- `POST /api/threads/:id/unarchive` - Unarchive thread

### Messages

- `GET /api/threads/:id/messages` - Get paginated messages
- `POST /api/threads/:id/messages` - Send message (triggers agent)
- `POST /api/threads/:id/answer` - Answer agent questions

### Real-time

- `GET /api/threads/:id/stream` - SSE event stream

## Configuration

Environment variables:
- `ANTHROPIC_API_KEY` - Required for Claude API
- `CORS_ORIGINS` - Comma-separated allowed origins (default: localhost)

## License

MIT
