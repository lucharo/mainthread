# Handoff: Batch 5 Content Block Architecture

## What Was Done

### 1. Backend FIFO Tool Tracking (`main.py`)
- Added `pending_tool_ids` queue to track tool IDs in order
- When `tool_result` has no `tool_use_id`, falls back to FIFO pop
- Applied to both `send_message` and `run_thread_for_agent`

### 2. Unified Streaming Blocks (`threadStore.ts`)
- Added `StreamingBlock` interface with `type`, `timestamp`, and type-specific fields
- Added `streamingBlocks: Record<string, StreamingBlock[]>` state
- New actions: `appendStreamingBlock`, `appendTextToLastBlock`, `markBlockComplete`, `clearStreamingBlocks`
- SSE handlers now populate both old state (backward compat) AND new streamingBlocks

### 3. Chronological Rendering (`ChatPanel.tsx`)
- Added `StreamingBlockRenderer` component for live streaming
- Replaced grouped ToolHistoryBlock + StreamingMessage with unified block loop
- Blocks render in arrival order: text → tool → text → tool

### 4. Database Persistence (`db.py`, `main.py`)
- Added `content_blocks TEXT` column to messages table (with auto-migration)
- `add_message()` now accepts optional `content_blocks` JSON string
- Backend collects blocks during streaming and saves to DB

### 5. Persisted Block Rendering (`ChatPanel.tsx`)
- `MessageBubble` parses `content_blocks` from DB
- `PersistedBlockRenderer` renders saved blocks with completed tools showing ✓
- Falls back to plain `content` for legacy messages

### 6. Test Infrastructure
- **Backend:** `apps/api/tests/conftest.py` + `test_streaming.py` (11 tests)
- **Frontend:** `apps/web/src/store/threadStore.test.ts` (11 tests)
- All 22 tests pass

## Remaining Steps

### To Test Manually
```bash
# Terminal 1: Start API
cd apps/api && uv run uvicorn main:app --reload --port 3001

# Terminal 2: Start Web
pnpm dev:web
```

Then:
1. Send a message that triggers tools (e.g., "count characters in a file")
2. Watch for interleaved text/tools during streaming
3. Verify tools show spinner → checkmark when complete
4. Refresh page → verify tool history persists

### Potential Issues to Watch For

1. **Tool completion still not working?**
   - Check browser console for `[SSE] tool_result received:` logs
   - If `tool_use_id` is null, FIFO fallback should kick in
   - Check if IDs match between tool_use and tool_result

2. **Blocks not in order?**
   - Verify `streamingBlocks` is being populated (check React DevTools)
   - Ensure `StreamingBlockRenderer` is being called

3. **Persistence not working?**
   - Check SQLite has `content_blocks` column: `sqlite3 mainthread.db "PRAGMA table_info(messages)"`
   - Check message has content_blocks: `sqlite3 mainthread.db "SELECT content_blocks FROM messages LIMIT 1"`

### Known Gaps

1. **Extended thinking** (`mainthread-z94`): Config stored but not passed to SDK
   - `ClaudeCodeOptions` has no `extended_thinking` param
   - May need `extra_args` CLI flag approach
   - Investigate: `.venv/lib/python3.13/site-packages/claude_code_sdk/types.py`

2. **ListThreads archived status**: Fixed in `agents.py` but not tested

3. **Old streaming state cleanup**: Still maintaining both old (`streamingContent`, `streamingToolUse`) and new (`streamingBlocks`) state for backward compatibility. Could be cleaned up later.

## Files Changed

```
apps/api/
├── main.py          # FIFO tracking, block collection, persistence
├── db.py            # content_blocks column + migration
├── agents.py        # ListThreads archived status
└── tests/
    ├── __init__.py
    ├── conftest.py  # Mock fixtures
    └── test_streaming.py

apps/web/src/
├── store/
│   ├── threadStore.ts      # StreamingBlock, new state/actions
│   └── threadStore.test.ts # 11 tests
└── components/
    └── ChatPanel.tsx       # StreamingBlockRenderer, PersistedBlockRenderer
```

## Beads Status

Closed:
- `mainthread-xgn` - Tasks don't mark complete
- `mainthread-0im` - Tool calls disappear after completion
- `mainthread-0yd` - Test infrastructure

Still open (related):
- `mainthread-z94` - Thinking blocks not visible (needs SDK investigation)

## Run Tests

```bash
# Backend
cd apps/api && .venv/bin/python -m pytest tests/ -v

# Frontend
cd apps/web && npx vitest run
```

## Next Session Checklist

1. [ ] Start API and web servers
2. [ ] Test streaming with tool calls
3. [ ] Verify tool completion (0/2 → 1/2 → 2/2 → ✓)
4. [ ] Verify interleaved ordering (text-tool-text-tool)
5. [ ] Refresh and verify persistence
6. [ ] If issues, check browser console logs
7. [ ] Address any remaining bugs
8. [ ] Consider removing old streaming state once stable
