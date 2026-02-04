# MainThread TODO

## Completed
- [x] Add biome for linting/formatting
- [x] Add lint/format scripts
- [x] Run lint on files (some CSS warnings remain)
- [x] Add @anthropic-ai/claude-agent-sdk to dependencies
- [x] Update claude.ts to try Agent SDK import

## Still Needs Review/Work

### Auth Integration
- [ ] Verify Agent SDK auth pattern - currently falls back to standard SDK
- [ ] Check if Claude Code stores OAuth tokens we can reuse
- [ ] Test with `claude login` flow

### Agent SDK
- [ ] Properly integrate Agent SDK API (need to check actual SDK interface)
- [ ] Current implementation is placeholder - imports SDK but falls back to standard

### Minor Lint Issues (4 remaining)
- CSS @apply directive warnings (Tailwind)
- A few `any` types in db.ts

## To Run
```bash
cd ~/projects/hobby/mainthread
pnpm install
pnpm lint        # check lint
pnpm lint:fix    # auto-fix
pnpm dev         # start dev server
```

## Notes
- Agent SDK package: @anthropic-ai/claude-agent-sdk v0.2.9
- better-sqlite3 may need rebuild on first install
- Frontend at http://localhost:3000, API at http://localhost:3001
