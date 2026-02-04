# MainThread Release Validation

Pre-release validation checklist for v0.1.0.

## Setup

```bash
# Terminal 1: Start backend
cd /path/to/mainthread
uv run mainthread serve --reload

# Terminal 2: Start frontend
cd apps/web
bun run dev
```

Open http://localhost:3000

---

## 1. Bug Fix Validations

### 1.1 Plan Approval Flow (Bug #1 - CRITICAL)

**Setup**: Create a new thread, set permission mode to "Plan"

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send: "Create a hello.txt file with 'Hello World'" | Agent explores, then calls ExitPlanMode |
| 2 | Observe plan modal | Modal appears with plan content (not empty) |
| 3 | Wait 30 seconds | Agent does NOT proceed automatically |
| 4 | Click "Proceed" | Agent continues and creates the file |

**Result**: [ ] PASS / [ ] FAIL

---

### 1.2 Thread Click Navigation (Bug #2)

**Setup**: Create 3 threads with different names

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click Thread A in sidebar | Chat panel shows Thread A, URL updates |
| 2 | Click Thread B in sidebar | Chat panel shows Thread B, URL updates |
| 3 | Click Thread C in sidebar | Chat panel shows Thread C, URL updates |
| 4 | Use browser back button | Returns to Thread B |
| 5 | Refresh page | Stays on current thread (URL-based) |

**Result**: [ ] PASS / [ ] FAIL

---

### 1.3 Tool Block Collapse Animation (Bug #3)

**Setup**: Create a thread, set permission mode to "Bypass" or "Accept"

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send: "Read the package.json file" | Tool block appears expanded with spinner |
| 2 | Watch tool complete | Block smoothly collapses (500ms animation) |
| 3 | Watch message complete | Blocks clear after collapse finishes |
| 4 | Send: "List files in src/" | Multiple tool blocks collapse in sequence |

**Result**: [ ] PASS / [ ] FAIL

---

## 2. Sub-Thread Spawning

### 2.1 Basic Sub-Thread Creation

**Setup**: Main thread with default settings

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click "+ Thread" button | Sub-thread input appears |
| 2 | Enter task: "Count to 10" | Sub-thread created, appears in sidebar |
| 3 | Observe sidebar | Sub-thread shows as child of main thread |
| 4 | Wait for completion | Notification appears in main thread |

**Result**: [ ] PASS / [ ] FAIL

---

### 2.2 Sub-Thread with Different Models

**Setup**: Main thread using Sonnet 4.5

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create sub-thread | Opens sub-thread creation UI |
| 2 | Change model to Haiku 4.5 | Model selector shows H4.5 |
| 3 | Send task: "What model are you?" | Sub-thread runs with Haiku |
| 4 | Check response | Should mention Haiku or be noticeably faster |
| 5 | Check sidebar badge | Shows "H4.5" for sub-thread |

**Result**: [ ] PASS / [ ] FAIL

---

### 2.3 Sub-Thread with Different Permission Modes

**Setup**: Main thread with "Normal" permission mode

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create sub-thread | Opens sub-thread creation UI |
| 2 | Set permission mode to "Bypass" | Mode selector shows bypass |
| 3 | Send task: "Create test.txt with 'test'" | Sub-thread runs without prompts |
| 4 | Verify file created | File exists (no permission prompt shown) |

**Result**: [ ] PASS / [ ] FAIL

---

### 2.4 Sub-Thread with Plan Mode

**Setup**: Main thread with any permission mode

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create sub-thread | Opens sub-thread creation UI |
| 2 | Set permission mode to "Plan" | Mode selector shows plan |
| 3 | Send task: "Refactor the utils folder" | Sub-thread enters plan mode |
| 4 | Navigate to sub-thread | Plan approval modal visible |
| 5 | Click "Proceed" | Sub-thread continues execution |

**Result**: [ ] PASS / [ ] FAIL

---

### 2.5 Multiple Parallel Sub-Threads

**Setup**: Main thread ready

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Send: "Create 2 sub-threads: one to count to 5, another to list files" | Agent spawns 2 sub-threads |
| 2 | Observe sidebar | Both sub-threads appear, running in parallel |
| 3 | Wait for completion | Both complete, notifications appear |
| 4 | Check main thread | Both notifications visible |

**Result**: [ ] PASS / [ ] FAIL

---

## 3. Core Functionality Smoke Tests

### 3.1 Basic Chat

| Test | Action | Expected |
|------|--------|----------|
| Send message | Type + Enter | Response streams |
| Stop response | Press Esc | Stops immediately |
| Model switch | Change dropdown | Next message uses new model |
| Thinking mode | Toggle on | Thinking blocks appear |

**Result**: [ ] PASS / [ ] FAIL

---

### 3.2 Thread Management

| Test | Action | Expected |
|------|--------|----------|
| Create thread | "+ New" button | New thread created |
| Archive thread | Hover + archive icon | Thread moves to archived |
| Rename thread | (if implemented) | Title updates |

**Result**: [ ] PASS / [ ] FAIL

---

### 3.3 File Attachments

| Test | Action | Expected |
|------|--------|----------|
| Attach image | Drag & drop or click | Image previews in input |
| Send with image | Enter | Image included in message |
| @ file picker | Type @ | File picker appears |

**Result**: [ ] PASS / [ ] FAIL

---

## 4. Edge Cases

### 4.1 Error Handling

| Test | Action | Expected |
|------|--------|----------|
| Invalid API key | Set wrong key | Clear error message |
| Network disconnect | Kill server mid-response | Graceful error, can retry |
| Long response | Ask for verbose output | Handles without crash |

**Result**: [ ] PASS / [ ] FAIL

---

## Summary

| Section | Result |
|---------|--------|
| 1.1 Plan Approval | |
| 1.2 Thread Click | |
| 1.3 Tool Collapse | |
| 2.1 Basic Sub-Thread | |
| 2.2 Different Models | |
| 2.3 Different Permissions | |
| 2.4 Plan Mode Sub-Thread | |
| 2.5 Parallel Sub-Threads | |
| 3.1 Basic Chat | |
| 3.2 Thread Management | |
| 3.3 File Attachments | |
| 4.1 Error Handling | |

**Overall**: [ ] READY FOR RELEASE / [ ] NEEDS FIXES

---

## Notes

_Record any issues found during validation:_

1.
2.
3.
