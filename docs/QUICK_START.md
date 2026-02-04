# MainThread Quick Start Guide

Get up and running with MainThread in 5 minutes.

## Prerequisites

- **Python 3.11+** - Required runtime
- **ANTHROPIC_API_KEY** - Get yours at [console.anthropic.com](https://console.anthropic.com)

## Installation

```bash
# Install MainThread
pip install .
# or with uv
uv pip install .

# Set your API key
export ANTHROPIC_API_KEY="your-api-key-here"

# Start the server (opens browser automatically)
mainthread
```

The web UI opens at **http://localhost:2026**

> ℹ️ If port 2026 is in use, MainThread automatically finds the next available port.

## Interface Overview

**Thread Sidebar (Right)**
- List of all conversations
- Status indicators: 🟢 Ready | 🟠 Processing | 🔴 Needs Attention
- Model badges: S4.5 (Sonnet) | O4.5 (Opus) | H4.5 (Haiku)
- "+ New" button to create threads

**Chat Panel (Center)**
- Message history with streaming responses
- Thread breadcrumbs (main thread → sub-threads)
- Tool use displays and notifications

**Message Input (Bottom)**
- Text input field
- Model selector (Sonnet 4.5, Opus 4.5, Haiku 4.5)
- Permission mode selector
- Thinking toggle
- Attachment button
- "+ Thread" button (spawn sub-thread)

## Basic Usage

| Action | How To |
|--------|--------|
| **Send a message** | Type in input field and press `Enter` |
| **Change model** | Click model dropdown (S4.5 default, O4.5 most capable, H4.5 fastest) |
| **Create new thread** | Click "+ New" button in sidebar |
| **Spawn sub-thread** | Click "+ Thread" button (for parallel tasks) |
| **Attach images** | Drag & drop or click attachment button (📎) |
| **Stop processing** | Press `Esc` or click Stop button |
| **Archive thread** | Hover over thread in sidebar, click archive icon |

## Key Features

**Permission Modes** (cycle with `Shift+Enter`)
- **Plan** - Review implementation plan before executing
- **Accept** - Auto-approve file edits only
- **Normal** - Prompt for each action (default)
- **Bypass** - Skip all prompts ⚠️ use carefully

**Extended Thinking**
- Toggle thinking mode for detailed reasoning
- Thinking blocks show Claude's analysis process
- Useful for complex problems

**Auto-React**
- Automatically respond to sub-thread notifications
- Available on main threads only
- Toggle in message input controls

**Git Integration**
- Automatic branch detection (shown in sidebar)
- Sub-threads create isolated worktrees
- Work on experimental changes safely

**Sub-Thread Notifications**
- Sub-threads notify parent when complete or blocked
- Red dot (🔴) on parent thread indicates notification
- Click notification to navigate to relevant context

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+K` | Open command palette |
| `Cmd+,` | Open settings |
| `Cmd+N` | Create new thread |
| `Esc` | Stop thread / Close dialogs |
| `Enter` | Send message |
| `Shift+Enter` | Cycle permission mode |
| `@` | Open file picker |

## CLI Commands

```bash
# Start server with custom port
mainthread serve --port 3000

# Start with custom working directory
mainthread serve --work-dir /path/to/project

# Enable auto-reload for development
mainthread serve --reload

# Show database statistics
mainthread stats

# Reset database (delete all threads)
mainthread reset

# Show version
mainthread version
```

## Next Steps

- Read [README.md](../README.md) for architecture and API details
- See [CONTRIBUTING.md](../CONTRIBUTING.md) for development setup
- Check thread tools reference in README for advanced features

## Troubleshooting

**Port in use?**
→ MainThread auto-detects next available port. Check terminal output for actual port.

**API key not working?**
→ Verify `ANTHROPIC_API_KEY` is exported: `echo $ANTHROPIC_API_KEY`

**Browser doesn't open?**
→ Manually navigate to `http://localhost:2026`

**Thread stuck processing?**
→ Press `Esc` to stop, then send a new message to resume

---

**Need help?** Check the [README](../README.md) or open an issue on GitHub.
