# Contributing to MainThread

## Development Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   uv sync
   pnpm install
   ```
3. Build the frontend:
   ```bash
   pnpm run build
   ```
4. Run the server:
   ```bash
   uv run mainthread serve --reload
   ```

## Project Structure

### Backend (`src/mainthread/`)

- **cli.py**: Typer CLI entry point
- **server.py**: FastAPI server with SSE streaming
- **db.py**: SQLite database layer
- **agents/**: Claude SDK integration
  - **core.py**: Main agent execution loop
  - **registry.py**: Service registry (replaces callbacks)
  - **tools/**: Individual tool implementations

### Frontend (`apps/web/src/`)

- **components/**: React components
  - **ChatPanel.tsx**: Main chat interface (orchestrator)
  - **ThreadHeader.tsx**: Thread title, metadata, actions
  - **MessageInput.tsx**: Message input with controls
  - **MessageBubble.tsx**: Message rendering with markdown
- **store/**: Zustand state management
  - **threadStore.ts**: Main store with SSE handling
  - **types.ts**: TypeScript interfaces

## Code Style

### Python
- Use type hints
- Run `uvx ruff check` and `uvx ruff format`
- Follow PEP 8

### TypeScript
- Use strict mode
- Run `pnpm run lint` (biome)
- Prefer functional components

## Architecture Decisions

### Service Registry Pattern
Tools query a central registry for services instead of receiving callbacks. This makes dependencies explicit and testable.

```python
from mainthread.agents.registry import get_registry

registry = get_registry()
await registry.create_thread(title="...")
```

### SSE Streaming
Real-time updates use Server-Sent Events with:
- Sequence IDs for reconnection recovery
- Heartbeat every 30 seconds
- Event store for replay on reconnect

### Tool Design
Tools are created by factory functions that capture context:
```python
def create_spawn_thread_tool(parent_thread_id: str):
    @tool("SpawnThread", ...)
    async def spawn_thread(args):
        # Has access to parent_thread_id
        ...
    return spawn_thread
```

## Testing

```bash
# Python tests
uv run pytest

# Frontend tests
pnpm run test
```

## Pull Requests

1. Create a feature branch
2. Make your changes
3. Ensure tests pass
4. Update documentation if needed
5. Submit PR with clear description
