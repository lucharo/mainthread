# MainThread UI/UX Validation Spec

The definitive specification for how the MainThread conversation flow should look and behave. Use this to validate the current implementation.

## 1. Starting a Conversation

**User sends a message** in the main thread.

### Phase 1: Connecting (gray, subtle)
- A **gray** indicator appears: "Connecting to Claude..." with a small spinner and bouncing dots
- This is the API connection phase - no content from Claude yet
- Visually neutral (zinc/gray tones) to distinguish from actual thinking
- Disappears as soon as the first SSE event with content arrives (thinking or text)

### Phase 2: Thinking (amber, if extended thinking is on)
- When thinking content starts streaming, show an **amber** collapsible block
- Label: **"Thinking..."** (with bouncing dots while streaming)
- Auto-expanded so user can see reasoning in real-time
- When thinking finishes (text/tool starts): **remove the dots but keep the label as "Thinking"**
- Do NOT change the label to "Claude's Reasoning" - that's inconsistent. It was thinking, it stays "Thinking"
- Block collapses automatically when text/tools start arriving
- User can re-expand to review thinking content

### Phase 3: Response (text and/or tools)
- Text streams in as markdown
- Tool calls appear as collapsible blocks (see Section 3)

### Phase 4: Complete
- Thread status returns to "active" (green dot in sidebar)
- Streaming blocks transition cleanly to persisted message
- **No duplication**: the final message should render exactly once
- No flash, no overlap window, no double-render

## 2. Thread Status Indicators (Sidebar)

Each thread in the sidebar has a colored dot:

| Status | Color | Meaning |
|--------|-------|---------|
| `active` (idle) | Green | Thread is idle, ready for input |
| `pending` | Amber/orange, blinking | Waiting to connect / queued |
| `running` | Blue, blinking | Agent is actively working |
| `done` | Gray | Thread completed its task |
| `error` | Red | Something went wrong |

**Main thread goes green while waiting for sub-threads.** The main thread is idle (not running Claude) - sub-threads are the ones working. Main thread's dot should be green/idle, not blue/running.

## 3. Tool Calls Display

### General Tools
- Tool calls are shown as collapsible blocks
- Multiple consecutive tool calls are **grouped into a single collapsible** section
- Each tool within the group shows its name, status (spinner while running, checkmark when done)
- When a tool completes, its spinner stops immediately (checkmark appears)
- When ALL tools in a group complete, the group can auto-collapse

### SpawnThread Tool (Special Handling)
SpawnThread is a tool like any other, but gets special treatment because it creates navigable threads:

- Multiple SpawnThread calls are grouped together like other tools
- **When it's only SpawnThread calls in a group**: show them expanded (not collapsed), because each one has a navigable link
- Each SpawnThread entry shows:
  - Thread title
  - A small **arrow/link icon** (blue) to navigate to that thread
  - Status: spinner while creating, checkmark when the thread is live
- The navigation arrow should **only be clickable once the sub-thread is actually running** (has an SSE connection, is live)
- Keep it minimal - just title + arrow. No extra text about "thread created" notifications
- **Do NOT show separate "thread created" notification cards** for SpawnThread-created threads. The SpawnThread tool block IS the notification. Showing it twice is clutter.

## 4. Sub-Thread Lifecycle

### Creation
1. SpawnThread tool is called in parent thread
2. Sub-thread appears in sidebar under parent (indented)
3. Sub-thread starts with "pending" status (amber blinking dot)
4. It's OK if it takes a moment for the Claude instance to start - show "Connecting to Claude..." in the sub-thread when first opened

### Running
1. Sub-thread status changes to "running" (blue blinking dot)
2. The minimap graph shows the thread hierarchy
3. Sub-thread processes independently
4. If user clicks into it: show the initial prompt (user message) and whatever the agent is working on
5. It's fine to show content with a slight delay - only show when ready, don't flash empty states

### Completion
1. Sub-thread calls `SignalStatus` (done/needs_attention)
2. Parent thread receives a notification message
3. Sub-thread status in sidebar: gray dot (done) or amber (needs attention)
4. Parent reads the sub-thread results and continues

### While Sub-Threads Work
- **Main thread is idle** - green dot, not running
- The minimap widget shows thread hierarchy with colored dots
- User can freely switch between threads
- No spinners or "processing" indicators on the main thread while waiting

## 5. Minimap / Thread Graph

- Shows when sub-threads exist
- Displays thread hierarchy as connected dots
- Dot colors match sidebar status colors
- Clicking a dot navigates to that thread
- Fades out after all sub-threads complete (after a short delay)
- Can be manually dismissed

## 6. Message Rendering Rules

### No Duplication
- Each piece of content renders exactly ONCE
- Streaming blocks and persisted messages never overlap visually
- The transition from streaming to persisted should be seamless

### Content Blocks
- Thinking blocks: collapsible, amber-themed
- Text blocks: rendered as markdown
- Tool blocks: collapsible, grouped when consecutive
- The final persisted message uses `content_blocks` for structured rendering

### Timestamps
- Show on the persisted message only (not on streaming blocks)

## 7. Error States

- If stats API returns data without `cache` field, don't crash - gracefully skip cache section
- If SSE connection drops, reconnect with backoff (max 5 retries)
- If a thread errors, show red dot and error message
- React ErrorBoundary catches render crashes with "Something went wrong" + reload button

## 8. Things to NOT Show

- Don't show "thread created" notification cards for SpawnThread-created threads (the tool block is enough)
- Don't show "Claude's Reasoning" as a label - keep it as "Thinking" throughout
- Don't show "Thinking" during the connection phase - show "Connecting to Claude..."
- Don't show duplicate content during the streaming-to-persisted transition
- Don't show worktree paths in thread headers (worktrees are optional and internal detail)
- Don't show spinners that never stop - every spinner must have a terminal state
