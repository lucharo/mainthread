# 🧵 Main Thread

[![PyPI version](https://img.shields.io/pypi/v/mainthread.svg)](https://pypi.org/project/mainthread/)
[![Python versions](https://img.shields.io/pypi/pyversions/mainthread.svg)](https://pypi.org/project/mainthread/)
[![License](https://img.shields.io/pypi/l/mainthread.svg)](https://github.com/lucharo/mainthread/blob/main/LICENSE)

Multi-threaded Claude conversations with a web UI. Spawn sub-threads for parallel work that you can jump into at any time—these aren't autonomous sub-agents running in the background, they're full conversations you can continue from the CLI or UI whenever you need to.

## Use Cases

- **Single orchestrator, multiple workstreams**: Interact with one main agent that spawns and manages sub-threads for parallel tasks. Jump into any conversation whenever you need to provide guidance or take over.

- **Naturally parallelizable work**: Work on different tickets, features, or areas of the codebase simultaneously. Each sub-thread maintains its own context and working directory.

- **Git worktree integration**: With worktrees, each sub-thread can operate in its own isolated branch—making parallel agent work even more ergonomic.

## Quick Start

```bash
# Try it instantly with uvx (no install needed)
uvx mainthread

# Or install with pip/uv
pip install mainthread
# or
uv add mainthread

# Run the server (opens web UI at http://localhost:2026)
mainthread

# Run in current directory
mainthread serve

# Or specify a different directory
mainthread serve --work-dir /path/to/project
```

## Features

- **Spawned Sub-threads**: Create parallel threads for independent work—not background sub-agents, but full conversations you can jump into and continue anytime
- **Nested Sub-threads**: Sub-threads can spawn their own sub-threads for hierarchical task decomposition
- **Continue from CLI**: Every thread can be resumed from the command line with full conversation history
- **Automatic Notifications**: Sub-threads signal completion or need attention; parent thread stays informed
- **Claude Code Integration**: Uses Claude Code SDK for tool use and extended thinking
- **Real-time Streaming**: SSE-based streaming with reconnection recovery
- **Git-Aware**: Detects branch, repo, and worktree status
- **Permission Modes**: Plan, Accept, Normal, or Bypass permissions

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

## Development

### Prerequisites

- Python 3.11+
- Node.js 20+ / Bun
- Claude Code CLI (`npm install -g @anthropic-ai/claude-code`)

### Setup

```bash
# Install all dependencies
just install

# Run both backend and frontend in dev mode
just dev

# Or run them separately:
just serve          # Backend with auto-reload
just dev-frontend   # Frontend with hot reload
```

Many quick scripts are available in the `justfile`. Run `just` to see all available commands.

### Project Structure

```
mainthread/
├── src/mainthread/           # Python backend (FastAPI)
│   ├── cli.py               # Typer CLI
│   ├── server.py            # FastAPI server with SSE
│   ├── db.py                # SQLite persistence
│   └── agents/              # Claude SDK integration + tools
├── apps/web/                # React frontend (TypeScript, Vite, Tailwind)
│   └── src/
│       ├── components/      # UI components
│       └── store/           # Zustand state
└── justfile                 # Development commands
```

### Testing & Quality

```bash
just test        # Run tests
just lint        # Check linting
just lint-fix    # Fix lint issues
just typecheck   # Type check
just check       # Run all checks
```

## License

MIT
