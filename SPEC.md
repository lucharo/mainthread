# MainThread - Specification

## Overview

A minimal full-stack web app centered around a **main thread** communicating with a single agent that can:

1. **Spawn sub-threads** - The main thread's agent can create new active threads on demand
2. **Cross-thread communication** - Main thread can write to and read from spawned threads
3. **Notifications** - Both via Claude Agent SDK hooks and user-visible UI notifications
4. **Thread navigation** - User can jump into any thread to interact directly
5. **Thread UI** - Threads displayed as tabs with the main thread as "home"

## Core Requirements

### Thread Management
- Main thread serves as the "home" thread
- Agent can spawn sub-threads dynamically
- Threads displayed as navigable tabs
- User can jump into any thread to interact directly

### Cross-Thread Communication
- Main thread can write messages to spawned threads
- Main thread can read responses from spawned threads
- Bidirectional communication between main and sub-threads

### Notifications
- Claude Agent SDK hooks for programmatic notifications
- User-visible UI notifications for important events

### Agent Features
- Display thinking blocks when extended thinking is enabled
- Display tool use (what tools are being called)
- Mode switching: plan mode / edit mode / normal mode
- Default permissions matching Claude Code / OpenCode apps
- Model switching capability
- Toggle thinking on/off (default: on)

---

## Implementation Notes

*These are not requirements, just possible approaches:*

- Tabs UI for thread switching
- Home button for main thread
- Real-time streaming via SSE
- WebSocket alternative for real-time updates
- React/Next.js for frontend
- Node.js backend with Claude Agent SDK
