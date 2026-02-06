# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-02-06

### Added
- Multi-threaded Claude conversations with web UI
- React frontend with Vite, Tailwind, and Zustand state management
- FastAPI backend with SSE streaming for real-time updates
- SQLite persistence for threads, messages, and SSE events
- Sub-thread spawning from main thread with parent notification
- Session resumption via Claude Agent SDK
- Custom MCP tools: SpawnThread, ListThreads, ReadThread, ArchiveThread, SendToThread, SignalStatus
- Agent auto-retry with configurable max retries and timeout
- Watchdog for stuck thread recovery (15s interval)
- Hourly event cleanup for SSE events older than 24h
- Permission modes: default, acceptEdits, bypassPermissions, plan
- CLI entry point via `mainthread serve`

[Unreleased]: https://github.com/lucharo/mainthread/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/lucharo/mainthread/releases/tag/v0.1.0
