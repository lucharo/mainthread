# MainThread Agent Instructions

Instructions for AI agents working on this codebase.

## Project Structure

```
mainthread/
├── apps/web/           # React frontend (TypeScript, Vite, Tailwind)
├── src/mainthread/     # Python backend (FastAPI, Claude Agent SDK)
│   ├── agents/         # Agent logic and custom tools
│   ├── server.py       # API endpoints and SSE streaming
│   └── db.py           # SQLite persistence
├── tests/              # Backend tests (pytest)
└── docs/               # Documentation
```

## Development

```bash
# Backend
uv sync                          # Install dependencies
uv run mainthread serve --reload # Start dev server (port 3031)
uv run pytest                    # Run tests

# Frontend
cd apps/web
bun install                      # Install dependencies
bun run dev                      # Start dev server (port 3000)
bun run build                    # Build for production
bun test                         # Run tests
```

## Key Concepts

### Threads
- **Main thread**: Primary conversation, can spawn sub-threads
- **Sub-threads**: Parallel workers that notify parent on completion
- Threads have: model, permission mode, working directory, parent relationship

### Permission Modes
- `default`: Prompt for each action
- `acceptEdits`: Auto-approve file changes
- `bypassPermissions`: Skip all prompts
- `plan`: Require plan approval before execution

### Custom Tools (MCP)
Main thread has: `SpawnThread`, `ListThreads`, `ReadThread`, `ArchiveThread`, `SendToThread`
Sub-threads have: `SignalStatus`

## Code Quality

Before committing:
1. Run `uv run pytest` - all tests must pass
2. Run `cd apps/web && bun run build` - frontend must build
3. Check for TypeScript errors in frontend

## Architecture Notes

- SSE streaming for real-time updates
- SQLite for thread/message persistence
- Claude Agent SDK for agent execution
- Zustand for frontend state management
