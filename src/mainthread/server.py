"""MainThread API - FastAPI backend with Claude Agent SDK and SSE."""

import asyncio
import json
import logging
import os
import subprocess
from collections import defaultdict
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from mainthread.agents import (
    clear_pending_question,
    register_archive_thread_callback,
    register_broadcast_plan_approval_callback,
    register_broadcast_question_callback,
    register_broadcast_status_signal_callback,
    register_broadcast_subagent_stop_callback,
    register_create_thread_callback,
    register_list_threads_callback,
    register_read_thread_callback,
    register_run_thread_callback,
    register_send_to_thread_callback,
    reset_agent_state,
    run_agent,
    set_pending_answer,
)
from mainthread.agents.task_registry import (
    clear_all_tasks,
    register_task,
    stop_task,
    unregister_task,
)
from mainthread.db import (
    add_event,
    add_message,
    archive_thread,
    cleanup_old_events,
    clear_thread_events,
    clear_thread_messages,
    create_ephemeral_thread,
    create_thread,
    estimate_thread_tokens,
    get_all_threads,
    get_events_since,
    get_messages_paginated,
    get_recent_work_dirs,
    get_thread,
    get_thread_messages_formatted,
    get_thread_usage_with_children,
    reset_all_threads,
    unarchive_thread,
    update_message,
    update_thread_config,
    update_thread_session,
    update_thread_status,
    update_thread_title,
    update_thread_usage,
)

load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# SSE event queues for each thread (declared early for lifespan access)
thread_subscribers: dict[str, list[asyncio.Queue[dict[str, Any]]]] = defaultdict(list)

# SSE event persistence is now SQLite-backed (db.events table).
# Events survive server restarts and support reconnection recovery.
# Periodic cleanup removes events older than 24 hours.
_event_cleanup_task: asyncio.Task | None = None
EVENT_CLEANUP_INTERVAL_SECONDS = 3600  # Run cleanup every hour

# Per-parent notification queues to process notifications sequentially without dropping
_notification_queues: dict[str, asyncio.Queue[str]] = {}
_notification_workers: dict[str, asyncio.Task] = {}

# Concurrency control: limit concurrent Claude agent processes
MAX_CONCURRENT_AGENTS = int(os.environ.get("MAINTHREAD_MAX_AGENTS", "10"))
_agent_semaphore = asyncio.Semaphore(MAX_CONCURRENT_AGENTS)

# Agent execution timeout (default 30 min - complex tasks like full-stack builds need time)
AGENT_TIMEOUT_SECONDS = int(os.environ.get("MAINTHREAD_AGENT_TIMEOUT", "1800"))

# Watchdog for stuck threads
_watchdog_task: asyncio.Task | None = None
WATCHDOG_INTERVAL_SECONDS = 15  # Check frequently for fast detection
WATCHDOG_STUCK_THRESHOLD_SECONDS = AGENT_TIMEOUT_SECONDS + 60  # timeout + 1 min buffer


async def _periodic_event_cleanup() -> None:
    """Periodically clean up old SSE events from SQLite to prevent unbounded growth."""
    while True:
        try:
            await asyncio.sleep(EVENT_CLEANUP_INTERVAL_SECONDS)
            deleted = cleanup_old_events(max_age_hours=24)
            if deleted > 0:
                logger.info(f"[EVENT_CLEANUP] Removed {deleted} events older than 24h")
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.debug(f"[EVENT_CLEANUP] Error during cleanup: {e}")


async def _stuck_thread_watchdog() -> None:
    """Periodically check for threads stuck in running status and recover them.

    Only checks 'running' threads - not 'pending', which may legitimately be
    waiting for the agent semaphore under high concurrency.

    Instead of just logging, this watchdog actively recovers stuck threads by:
    1. Setting their status to 'needs_attention'
    2. Broadcasting an error event to SSE subscribers
    3. Notifying the parent thread if it's a sub-thread
    """
    while True:
        try:
            await asyncio.sleep(WATCHDOG_INTERVAL_SECONDS)
            now = datetime.now(timezone.utc)
            all_threads = get_all_threads(include_archived=False)
            for thread in all_threads:
                status = thread.get("status")
                if status != "running":
                    continue
                updated_at = thread.get("updatedAt") or thread.get("createdAt", "")
                if not updated_at:
                    continue
                try:
                    updated = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
                    if updated.tzinfo is None:
                        updated = updated.replace(tzinfo=timezone.utc)
                    elapsed = (now - updated).total_seconds()
                    if elapsed > WATCHDOG_STUCK_THRESHOLD_SECONDS:
                        thread_id = thread["id"]
                        has_subscribers = bool(thread_subscribers.get(thread_id))
                        logger.warning(
                            f"[WATCHDOG] Recovering thread {thread_id} ({thread['title']!r}) "
                            f"stuck in '{status}' for {int(elapsed)}s, "
                            f"subscribers={has_subscribers}"
                        )

                        # Actively recover: set to needs_attention
                        update_thread_status(thread_id, "needs_attention")

                        # Broadcast error to SSE subscribers so UI updates
                        await broadcast_to_thread(thread_id, {
                            "type": "error",
                            "data": {"error": f"Process appears to have died (stuck in '{status}' for {int(elapsed)}s). You can retry by sending a new message."},
                        })
                        await broadcast_to_thread(thread_id, {
                            "type": "status_change",
                            "data": {"status": "needs_attention"},
                        })

                        # Notify parent if this is a sub-thread
                        parent_id = thread.get("parentId")
                        if parent_id:
                            await _notify_parent_of_stuck_child(parent_id, thread)

                except (ValueError, TypeError):
                    pass
        except asyncio.CancelledError:
            return
        except Exception as e:
            logger.debug(f"[WATCHDOG] Error during check: {e}")


async def _notify_parent_of_stuck_child(parent_id: str, child_thread: dict[str, Any]) -> None:
    """Notify parent thread that a child thread appears stuck/dead.

    Broadcasts a subthread_status event and injects a notification message
    so the parent agent (on next activation) knows the child failed.
    """
    child_id = child_thread["id"]
    child_title = child_thread.get("title", "Unknown")

    # Broadcast status event to parent's SSE subscribers
    await broadcast_to_thread(parent_id, {
        "type": "subthread_status",
        "data": {
            "threadId": child_id,
            "status": "needs_attention",
            "title": child_title,
        },
    })

    # Inject notification message into parent thread
    notification_content = (
        f'[notification] Sub-thread "{child_title}" appears to have crashed '
        f"or timed out. It has been marked as needing attention. "
        f"You can retry by sending a message to it."
    )
    user_notification = add_message(parent_id, "user", notification_content)
    await broadcast_to_thread(parent_id, {
        "type": "message",
        "data": {"message": user_notification},
    })


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan handler for hot reload compatibility.

    Resets asyncio state on startup to ensure primitives are bound
    to the current event loop after hot reload.
    """
    # Startup: reset state for new event loop
    thread_subscribers.clear()
    _notification_queues.clear()
    _notification_workers.clear()
    await clear_all_tasks()
    reset_agent_state()

    # Reset any stale pending threads to active (from previous server instance)
    try:
        all_threads = get_all_threads(include_archived=False)
        for thread in all_threads:
            if thread.get("status") == "pending":
                logger.debug(f"Resetting stale pending thread {thread['id']} to active")
                update_thread_status(thread["id"], "active")
    except Exception as e:
        logger.warning(f"Failed to reset stale pending threads: {e}")

    # Start watchdog for stuck threads
    global _watchdog_task
    _watchdog_task = asyncio.create_task(_stuck_thread_watchdog())

    # Start periodic event cleanup (remove events older than 24h)
    global _event_cleanup_task
    if _event_cleanup_task:
        _event_cleanup_task.cancel()
    _event_cleanup_task = asyncio.create_task(_periodic_event_cleanup())

    logger.info("MainThread API started - SSE events persisted to SQLite")
    yield
    # Shutdown: cleanup
    logger.info("MainThread API shutting down")

    # Gather all background tasks for clean cancellation
    tasks_to_cancel: list[asyncio.Task] = []
    if _watchdog_task:
        _watchdog_task.cancel()
        tasks_to_cancel.append(_watchdog_task)
        _watchdog_task = None
    if _event_cleanup_task:
        _event_cleanup_task.cancel()
        tasks_to_cancel.append(_event_cleanup_task)
        _event_cleanup_task = None

    thread_subscribers.clear()
    # Cancel notification workers
    worker_count = len(_notification_workers)
    for tid, worker in _notification_workers.items():
        worker.cancel()
        tasks_to_cancel.append(worker)
        logger.debug(f"Cancelled notification worker for thread {tid}")
    _notification_queues.clear()
    _notification_workers.clear()
    if worker_count:
        logger.info(f"Cancelled {worker_count} notification workers")

    # Await all cancelled tasks to ensure clean shutdown
    if tasks_to_cancel:
        await asyncio.gather(*tasks_to_cancel, return_exceptions=True)
    await clear_all_tasks()
    logger.info("MainThread API shutdown complete")


app = FastAPI(
    title="MainThread API",
    description="Backend API for MainThread - multi-threaded Claude conversations",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS configuration
# NOTE: This application is designed for LOCAL DEVELOPMENT ONLY.
# It has no authentication - anyone with network access can read/write all threads.
# Do not expose to untrusted networks without adding authentication.
_cors_env = os.getenv("CORS_ORIGINS")
if not _cors_env:
    logger.warning(
        "CORS_ORIGINS not set - defaulting to localhost. "
        "Set CORS_ORIGINS environment variable for non-local deployments."
    )
ALLOWED_ORIGINS = (_cors_env or "http://localhost:5173,http://localhost:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)

# Static file serving setup - routes defined at end of file after API routes
_static_dir = Path(__file__).parent / "static"


def validate_work_dir(work_dir: str | None) -> str:
    """Validate and normalize a working directory path.

    Prevents path traversal attacks by resolving to absolute path and
    validating the directory exists.

    Args:
        work_dir: The directory path to validate, or None to use cwd.

    Returns:
        Validated absolute path string.

    Raises:
        ValueError: If path doesn't exist or is not a directory.
    """
    if not work_dir:
        return os.getcwd()

    # Resolve to absolute path (handles .. and symlinks)
    resolved = Path(work_dir).resolve()

    if not resolved.exists():
        raise ValueError(f"Working directory does not exist: {work_dir}")

    if not resolved.is_dir():
        raise ValueError(f"Path is not a directory: {work_dir}")

    return str(resolved)


# Global exception handler for better error messages
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    error_msg = str(exc) or type(exc).__name__
    logger.exception(f"Unhandled error: {error_msg}")
    return JSONResponse(
        status_code=500,
        content={"detail": error_msg, "type": type(exc).__name__},
    )


# SPA fallback for 404s on non-API routes
@app.exception_handler(404)
async def spa_fallback_handler(request: Request, exc: HTTPException):
    """Serve index.html for 404s on non-API routes (SPA client-side routing)."""
    # Let API 404s return normal JSON error
    if request.url.path.startswith("/api/"):
        return JSONResponse(
            status_code=404,
            content={"detail": exc.detail or "Not found"},
        )

    # Serve SPA for frontend routes
    index_path = _static_dir / "index.html"
    if index_path.exists():
        return FileResponse(index_path)

    return JSONResponse(
        status_code=404,
        content={"detail": "Not found"},
    )


# Maximum retries when a Claude process dies mid-execution
MAX_AGENT_RETRIES = int(os.environ.get("MAINTHREAD_MAX_RETRIES", "2"))
RETRY_DELAY_SECONDS = 3


# Shared message processing logic to reduce duplication
class MessageStreamProcessor:
    """Process agent message stream and broadcast events.

    This class extracts the common message processing logic used by
    send_message(), run_thread_for_agent(), and run_parent_thread_notification().

    Messages are saved incrementally to the database after each event,
    so content is preserved even if the browser is refreshed mid-stream.
    """

    def __init__(self, thread_id: str):
        self.thread_id = thread_id
        self.collected_content: list[str] = []
        self.collected_blocks: list[dict[str, Any]] = []
        self.pending_tool_ids: list[str] = []
        self.final_status = "active"
        self.final_session_id: str | None = None
        # Create assistant message immediately so it persists through refresh
        self._message = add_message(thread_id, "assistant", "[streaming...]")
        self.message_id = self._message["id"]

    def _save_current_state(self) -> None:
        """Save current content to database (called after each event)."""
        content = self.get_full_content()
        content_blocks = self.get_content_blocks_json()
        updated = update_message(self.message_id, content, content_blocks)
        if updated:
            self._message = updated

    async def _complete_pending_tool(self) -> None:
        """Mark first pending tool as complete (FIFO fallback)."""
        if self.pending_tool_ids:
            tool_id = self.pending_tool_ids.pop(0)
            for block in self.collected_blocks:
                if block.get("type") == "tool_use" and block.get("id") == tool_id:
                    block["isComplete"] = True
                    break
            await broadcast_to_thread(self.thread_id, {
                "type": "tool_result",
                "data": {"tool_use_id": tool_id},
            })

    async def process_message(self, msg) -> None:
        """Process a single message from the agent stream."""
        logger.debug(f"[MSG] type={msg.type}, metadata={msg.metadata}")
        if msg.type == "text":
            self.collected_content.append(msg.content)
            if self.collected_blocks and self.collected_blocks[-1].get("type") == "text":
                self.collected_blocks[-1]["content"] += msg.content
            else:
                self.collected_blocks.append({"type": "text", "content": msg.content})
            await broadcast_to_thread(self.thread_id, {
                "type": "text_delta",
                "data": {"content": msg.content},
            })

        elif msg.type == "thinking":
            if self.collected_blocks and self.collected_blocks[-1].get("type") == "thinking":
                self.collected_blocks[-1]["content"] = (
                    self.collected_blocks[-1].get("content") or ""
                ) + msg.content
                if msg.metadata and msg.metadata.get("signature"):
                    self.collected_blocks[-1]["signature"] = msg.metadata.get("signature")
            else:
                self.collected_blocks.append({
                    "type": "thinking",
                    "content": msg.content,
                    "signature": msg.metadata.get("signature") if msg.metadata else None,
                })
            await broadcast_to_thread(self.thread_id, {
                "type": "thinking",
                "data": {
                    "content": msg.content,
                    "signature": msg.metadata.get("signature") if msg.metadata else None,
                },
            })

        elif msg.type == "tool_use":
            tool_data = msg.metadata or {}
            tool_id = tool_data.get("id")
            tool_name = tool_data.get("tool") or tool_data.get("name")
            logger.debug(f"[SSE] tool_use: name={tool_name}, id={tool_id}")

            if tool_id:
                self.pending_tool_ids.append(tool_id)
            self.collected_blocks.append({
                "type": "tool_use",
                "name": tool_name,
                "input": tool_data.get("input"),
                "id": tool_id,
                "isComplete": False,
            })
            await broadcast_to_thread(self.thread_id, {
                "type": "tool_use",
                "data": tool_data,
            })

            # Detect Task tool invocations and create ephemeral thread records
            if tool_name == "Task" and tool_id:
                tool_input = tool_data.get("input") or {}
                task_description = tool_input.get("description", "")
                subagent_type = tool_input.get("subagent_type", "general")
                ephemeral_title = f"Task: {subagent_type}"
                if task_description:
                    # Use first 60 chars of description as title
                    ephemeral_title = task_description[:60] + ("..." if len(task_description) > 60 else "")

                try:
                    parent_thread = get_thread(self.thread_id)
                    work_dir = parent_thread.get("workDir") if parent_thread else None
                    create_ephemeral_thread(
                        thread_id=tool_id,
                        title=ephemeral_title,
                        parent_id=self.thread_id,
                        work_dir=work_dir,
                    )
                    await broadcast_to_thread(self.thread_id, {
                        "type": "subagent_start",
                        "data": {
                            "threadId": tool_id,
                            "title": ephemeral_title,
                            "subagentType": subagent_type,
                        },
                    })
                except Exception as e:
                    logger.warning(f"Failed to create ephemeral thread for Task {tool_id}: {e}")

            # Note: ExitPlanMode plan_approval broadcast is handled by the permission handler
            # in core.py (create_permission_handler). That handler blocks waiting for user
            # approval before allowing the tool to proceed. We don't broadcast here to avoid
            # duplicate events - the permission handler is the authoritative source.

        elif msg.type == "tool_input":
            # Update tool block input when full input arrives from AssistantMessage
            tool_id = msg.metadata.get("id") if msg.metadata else None
            tool_input = msg.metadata.get("input") if msg.metadata else None
            logger.debug(f"[SSE] tool_input: updating id={tool_id} with full input")
            if tool_id and tool_input:
                # Update collected block with full input
                for block in self.collected_blocks:
                    if block.get("type") == "tool_use" and block.get("id") == tool_id:
                        block["input"] = tool_input
                        break
                # Broadcast input update to frontend
                await broadcast_to_thread(self.thread_id, {
                    "type": "tool_input",
                    "data": {"id": tool_id, "input": tool_input},
                })

        elif msg.type == "tool_result":
            tool_use_id = msg.metadata.get("tool_use_id") if msg.metadata else None
            is_error = msg.metadata.get("is_error", False) if msg.metadata else False
            logger.debug(f"[SSE] tool_result: tool_use_id={tool_use_id}, is_error={is_error}, pending={self.pending_tool_ids}")
            # FIFO fallback: if SDK doesn't provide tool_use_id, use first pending
            if not tool_use_id and self.pending_tool_ids:
                tool_use_id = self.pending_tool_ids.pop(0)
                logger.debug(f"[SSE] tool_result: used FIFO fallback, got id={tool_use_id}")
            elif tool_use_id and tool_use_id in self.pending_tool_ids:
                self.pending_tool_ids.remove(tool_use_id)
            if tool_use_id:
                for block in self.collected_blocks:
                    if block.get("type") == "tool_use" and block.get("id") == tool_use_id:
                        block["isComplete"] = True
                        if is_error:
                            block["isError"] = True
                        logger.debug(f"[SSE] tool_result: marked block {tool_use_id} as complete (error={is_error})")
                        break
            # Include result content for tools that return structured data
            result_data: dict[str, Any] = {"tool_use_id": tool_use_id, "is_error": is_error}
            if msg.content:
                result_data["content"] = msg.content
                # Extract thread_id from SpawnThread tool result (embedded as <!--SPAWN_DATA:uuid-->)
                import re
                spawn_match = re.search(r"<!--SPAWN_DATA:([a-f0-9-]+)-->", str(msg.content))
                if spawn_match:
                    result_data["thread_id"] = spawn_match.group(1)
            await broadcast_to_thread(self.thread_id, {
                "type": "tool_result",
                "data": result_data,
            })

        elif msg.type == "error":
            logger.error(f"Agent error in thread {self.thread_id}: {msg.content}")
            await broadcast_to_thread(self.thread_id, {
                "type": "error",
                "data": {"error": msg.content},
            })

        elif msg.type == "usage":
            # Broadcast actual token usage from SDK and persist cumulatively
            if msg.metadata:
                usage_data = msg.metadata.get("usage") or {}
                cost = msg.metadata.get("total_cost_usd") or 0.0
                input_tok = usage_data.get("input_tokens", 0) if isinstance(usage_data, dict) else 0
                output_tok = usage_data.get("output_tokens", 0) if isinstance(usage_data, dict) else 0

                # Persist cumulative usage to DB
                if input_tok or output_tok or cost:
                    update_thread_usage(self.thread_id, input_tok, output_tok, cost)

                await broadcast_to_thread(self.thread_id, {
                    "type": "usage",
                    "data": {
                        "usage": usage_data,
                        "totalCostUsd": cost,
                    },
                })

        elif msg.type == "status":
            self.final_status = msg.content
            if msg.metadata:
                self.final_session_id = msg.metadata.get("session_id")

        # Save after every event so content survives browser refresh
        self._save_current_state()

    async def finalize(self) -> None:
        """Complete remaining pending tools at end of stream."""
        while self.pending_tool_ids:
            await self._complete_pending_tool()

    def get_full_content(self) -> str:
        """Get concatenated text content."""
        return "".join(self.collected_content) or "No response generated"

    def get_content_blocks_json(self) -> str | None:
        """Get JSON-serialized content blocks."""
        return json.dumps(self.collected_blocks) if self.collected_blocks else None


async def run_agent_with_retry(
    thread_id: str,
    user_message: str,
    *,
    images: list[dict[str, str]] | None = None,
    broadcast_status: bool = True,
) -> MessageStreamProcessor:
    """Run a Claude agent with automatic retry on process death.

    If the Claude process dies mid-execution, this function:
    1. Saves whatever partial content was collected
    2. Re-fetches the thread to get the latest session_id
    3. Sends a continuation message to resume the conversation
    4. Retries up to MAX_AGENT_RETRIES times

    This gives MainThread the same resilience as `claude --continue` in the CLI.

    Args:
        thread_id: The thread to run
        user_message: The user message to process
        images: Optional images for multimodal input
        broadcast_status: Whether to broadcast status changes via SSE

    Returns:
        The final MessageStreamProcessor with results
    """
    last_error: Exception | None = None

    for attempt in range(MAX_AGENT_RETRIES + 1):
        thread = get_thread(thread_id)
        if not thread:
            raise ValueError(f"Thread {thread_id} not found")

        # On retry, send a continuation message instead of the original
        if attempt > 0:
            logger.info(
                f"[RETRY] Attempt {attempt + 1}/{MAX_AGENT_RETRIES + 1} for thread {thread_id}, "
                f"session_id={thread.get('sessionId', 'none')}"
            )
            await asyncio.sleep(RETRY_DELAY_SECONDS)

            # Add a system note about the retry
            retry_note = (
                f"[system] Previous execution was interrupted ({last_error}). "
                f"Automatically retrying with session resumption (attempt {attempt + 1})."
            )
            retry_msg = add_message(thread_id, "system", retry_note)
            await broadcast_to_thread(thread_id, {
                "type": "message",
                "data": {"message": retry_msg},
            })

            # The continuation message tells the agent to pick up where it left off
            effective_message = (
                "Your previous execution was interrupted. "
                "Please continue where you left off and complete the task."
            )
            effective_images = None  # Don't resend images on retry
        else:
            effective_message = user_message
            effective_images = images

        processor = MessageStreamProcessor(thread_id)

        try:
            if broadcast_status:
                update_thread_status(thread_id, "running")
                await broadcast_to_thread(thread_id, {
                    "type": "status_change",
                    "data": {"status": "running"},
                })

            async with asyncio.timeout(AGENT_TIMEOUT_SECONDS):
                async for msg in run_agent(
                    thread,
                    effective_message,
                    images=effective_images,
                    allow_nested_subthreads=thread.get("allowNestedSubthreads", False),
                    max_thread_depth=thread.get("maxThreadDepth", 1),
                ):
                    await processor.process_message(msg)

            # Success - finalize and return
            await processor.finalize()
            processor._save_current_state()
            return processor

        except asyncio.CancelledError:
            # User-initiated cancel - don't retry
            raise

        except TimeoutError:
            # Timeout - don't retry (already waited long enough)
            processor._save_current_state()
            raise

        except Exception as e:
            last_error = e
            processor._save_current_state()

            if attempt < MAX_AGENT_RETRIES:
                logger.warning(
                    f"[RETRY] Agent process died in thread {thread_id} "
                    f"(attempt {attempt + 1}): {e}. Will retry with session resumption."
                )
                # Save session_id if we got one before the crash
                if processor.final_session_id:
                    update_thread_session(thread_id, processor.final_session_id)
                # Touch updatedAt to reset the watchdog timer so it doesn't
                # fire during retry attempts and send premature parent notifications
                update_thread_status(thread_id, "running")
                continue
            else:
                # Out of retries
                logger.error(
                    f"[RETRY] All {MAX_AGENT_RETRIES + 1} attempts failed for thread {thread_id}: {e}"
                )
                raise

    # Should never reach here, but satisfy type checker
    raise RuntimeError("Unexpected: retry loop completed without return or raise")


# Callback implementations for agents module
async def create_thread_for_agent(
    title: str,
    parent_id: str | None = None,
    work_dir: str | None = None,
    model: str | None = None,
    permission_mode: str | None = None,
    extended_thinking: bool | None = None,
    initial_message: str | None = None,
    use_worktree: bool = False,
    worktree_subdir: str = ".mainthread/worktrees/",
) -> dict[str, Any]:
    """Create a thread - async wrapper for the agent's SpawnThread tool.

    If parent_id is provided and optional params not specified, inherits from parent.
    If use_worktree is True and the thread is a sub-thread in a git repo, creates an
    isolated worktree for the sub-thread to work in.

    Args:
        initial_message: If provided, adds this as the first user message BEFORE
                        broadcasting thread_created. This prevents the race condition
                        where frontend receives thread with 0 messages.
        use_worktree: If True, create an isolated git worktree for the sub-thread (default: False).
        worktree_subdir: Relative path within work_dir for git worktrees (default: .mainthread/worktrees/)
    """
    # Validate and normalize working directory
    validated_work_dir = validate_work_dir(work_dir)
    # Detect git info from working directory
    git_info = await detect_git_info(validated_work_dir)

    # If parent_id provided and params not explicit, inherit from parent
    parent_allow_nested = False
    parent_max_depth = 1
    if parent_id:
        parent = get_thread(parent_id)
        if parent:
            if model is None:
                model = parent.get("model", "claude-opus-4-5")
            if permission_mode is None:
                permission_mode = parent.get("permissionMode", "acceptEdits")
            if extended_thinking is None:
                extended_thinking = parent.get("extendedThinking", True)
            parent_allow_nested = parent.get("allowNestedSubthreads", False)
            parent_max_depth = parent.get("maxThreadDepth", 1)

    # For sub-threads in git repos, create an isolated worktree if requested
    worktree_info: dict[str, Any] = {"success": False, "worktree_path": None, "branch_name": None, "error": None}
    final_work_dir = validated_work_dir
    final_is_worktree = git_info["is_worktree"]
    worktree_branch: str | None = None

    if use_worktree and parent_id and git_info["git_branch"] and not git_info["is_worktree"]:
        # Generate a temporary thread_id for worktree naming (will be the actual thread_id)
        import uuid
        temp_thread_id = str(uuid.uuid4())
        worktree_info = await create_git_worktree(validated_work_dir, temp_thread_id, worktree_subdir)

        if worktree_info["success"]:
            # Use the worktree path as the working directory
            final_work_dir = worktree_info["worktree_path"]
            final_is_worktree = True
            worktree_branch = worktree_info["branch_name"]
            logger.info(f"Sub-thread will use worktree at {final_work_dir} on branch {worktree_branch}")
        else:
            # Fallback to original work_dir, log warning
            logger.warning(f"Worktree creation failed for sub-thread, using original work_dir: {worktree_info['error']}")

    # If worktree was created, construct git info from what we already know
    # instead of calling detect_git_info again (avoids ~7 extra subprocess calls)
    if worktree_info["success"]:
        git_info = {
            "git_branch": worktree_branch,
            "git_repo": git_info["git_repo"],  # repo name unchanged
            "is_worktree": True,
        }

    thread = create_thread(
        title=title,
        parent_id=parent_id,
        work_dir=final_work_dir,
        model=model or "claude-opus-4-5",
        extended_thinking=extended_thinking if extended_thinking is not None else True,
        permission_mode=permission_mode or "acceptEdits",
        git_branch=git_info["git_branch"],
        git_repo=git_info["git_repo"],
        is_worktree=final_is_worktree,
        worktree_branch=worktree_branch,
        allow_nested_subthreads=parent_allow_nested,
        max_thread_depth=parent_max_depth,
    )

    # Store worktree info in thread metadata for response messages
    thread["_worktree_info"] = worktree_info

    # Add initial message BEFORE broadcasting so it's included in thread_created event
    # This prevents the race condition where frontend receives thread with 0 messages
    if initial_message:
        add_message(thread["id"], "user", initial_message)
        # Set status to pending since the thread will be run immediately
        update_thread_status(thread["id"], "pending")
        # Refresh thread to include the message and updated status in the broadcast
        thread = get_thread(thread["id"]) or thread
        thread["_worktree_info"] = worktree_info

    # Broadcast thread_created to parent thread so frontend gets full thread data
    # (including permissionMode). The frontend filters out duplicate notifications
    # for SpawnThread-created threads, so this won't cause duplicate UI display.
    if parent_id:
        # Create a clean copy without internal metadata
        thread_data = {k: v for k, v in thread.items() if not k.startswith("_")}

        async def _broadcast_thread_created():
            try:
                await broadcast_to_thread(parent_id, {
                    "type": "thread_created",
                    "data": {"thread": thread_data},
                })
            except Exception as e:
                # Broadcast failure is non-critical - frontend will get data on next fetch
                logger.debug(f"Failed to broadcast thread_created to {parent_id}: {e}")

        task = asyncio.create_task(_broadcast_thread_created())
        task.add_done_callback(
            lambda t: logger.error(f"broadcast_thread_created failed: {t.exception()}")
            if t.exception() else None
        )

    return thread


async def broadcast_question_to_thread(thread_id: str, question_data: dict[str, Any]) -> None:
    """Broadcast a question event to a thread's subscribers.

    Also bubbles up the question to the parent thread as a child_question event,
    so the parent UI can display questions from sub-threads.
    """
    await broadcast_to_thread(thread_id, {
        "type": "question",
        "data": question_data,
    })

    # Bubble up to parent thread if this is a sub-thread
    thread = get_thread(thread_id)
    if thread and thread.get("parentId"):
        parent_id = thread["parentId"]
        await broadcast_to_thread(parent_id, {
            "type": "child_question",
            "data": {
                "childThreadId": thread_id,
                "childTitle": thread.get("title", "Unknown"),
                "questions": question_data.get("questions", []),
            },
        })


async def broadcast_plan_approval_to_thread(thread_id: str, plan_data: dict[str, Any]) -> None:
    """Broadcast a plan approval event to a thread's subscribers.

    This is called from the permission handler when ExitPlanMode is invoked.
    The permission handler will block waiting for user approval.
    """
    await broadcast_to_thread(thread_id, {
        "type": "plan_approval",
        "data": plan_data,
    })


async def list_threads_for_agent() -> list[dict[str, Any]]:
    """List all threads - async wrapper for the agent's ListThreads tool."""
    return await asyncio.to_thread(get_all_threads)


async def archive_thread_for_agent(thread_id: str) -> bool:
    """Archive a thread - async wrapper for the agent's ArchiveThread tool."""
    success = archive_thread(thread_id)

    if success:
        # Notify all subscribers about the archive
        for queues in thread_subscribers.values():
            for queue in queues:
                await queue.put({
                    "type": "thread_archived",
                    "data": {"threadId": thread_id},
                })

    return success


async def read_thread_for_agent(thread_id: str, limit: int = 50) -> dict[str, Any] | None:
    """Read a thread's messages - async wrapper for the agent's ReadThread tool."""
    return await asyncio.to_thread(get_thread_messages_formatted, thread_id, limit)


async def notify_parent_of_subthread_completion(
    thread: dict[str, Any],
    thread_id: str,
    final_status: str,
) -> None:
    """Notify parent thread when a subthread completes.

    If the subthread finished with 'active' status (agent didn't call SignalStatus),
    auto-signal 'done' to the parent. This ensures parents always get notified.

    Args:
        thread: The subthread's thread dict (must have parentId)
        thread_id: The subthread's ID
        final_status: The final status from the agent processor
    """
    parent_id = thread.get("parentId")
    if not parent_id:
        return

    parent_thread = get_thread(parent_id)

    # Determine effective status for notification
    # "active" means agent finished without explicit SignalStatus - treat as "done"
    effective_status = final_status
    if effective_status == "active":
        effective_status = "done"
        logger.info(f"Sub-thread {thread_id} finished without SignalStatus, auto-signaling 'done' to parent")
        # Also update the thread's stored status to "done"
        update_thread_status(thread_id, "done")

    # Broadcast subthread_status to frontend. Skip only when SignalStatus was
    # used (final_status != "active"), since broadcast_status_signal_to_parent
    # already sent the event in that case.
    if final_status == "active":
        await broadcast_to_thread(parent_id, {
            "type": "subthread_status",
            "data": {
                "threadId": thread_id,
                "status": effective_status,
                "title": thread["title"],
            },
        })

    # Inject user message into parent thread for agent visibility (user role so agent responds)
    status_msg = "completed" if effective_status == "done" else "needs attention"
    notification_content = f'[notification] Sub-thread "{thread["title"]}" {status_msg}.'
    user_notification = add_message(parent_id, "user", notification_content)

    # Broadcast the notification to parent thread subscribers
    await broadcast_to_thread(parent_id, {
        "type": "message",
        "data": {"message": user_notification},
    })

    # Only trigger parent thread agent if auto-react is enabled
    if parent_thread and parent_thread.get("autoReact", True):
        task = asyncio.create_task(run_parent_thread_notification(parent_id, notification_content))
        task.add_done_callback(
            lambda t: logger.error(f"Parent notification task failed for {parent_id}: {t.exception()}")
            if t.exception() else None
        )
    else:
        logger.info(f"Skipping auto-react for parent thread {parent_id} (disabled)")


async def run_parent_thread_notification(thread_id: str, notification_content: str) -> None:
    """Enqueue a notification for sequential processing on a parent thread.

    Uses a per-parent asyncio.Queue so notifications are processed one at a time
    but none are dropped. A background worker drains the queue sequentially.
    """
    # Ensure queue and worker exist for this parent thread
    if thread_id not in _notification_queues:
        _notification_queues[thread_id] = asyncio.Queue()
        worker = asyncio.create_task(_notification_worker(thread_id))
        def _on_worker_done(t):
            if t.exception():
                logger.error(f"Notification worker for {thread_id} failed: {t.exception()}")
        worker.add_done_callback(_on_worker_done)
        _notification_workers[thread_id] = worker

    await _notification_queues[thread_id].put(notification_content)
    logger.info(f"Enqueued notification for parent thread {thread_id}")


async def _notification_worker(thread_id: str) -> None:
    """Background worker that processes notifications sequentially for a parent thread."""
    queue = _notification_queues[thread_id]
    while True:
        try:
            notification_content = await queue.get()
        except asyncio.CancelledError:
            return

        try:
            thread = get_thread(thread_id)
            if not thread:
                logger.error(f"Thread {thread_id} not found for notification processing")
                continue

            # Don't add message - it's already added by the caller
            update_thread_status(thread_id, "pending")

            async with _agent_semaphore:
                processor = await run_agent_with_retry(
                    thread_id,
                    notification_content,
                    broadcast_status=True,
                )

            assistant_message = processor._message

            # Update thread status and session
            update_thread_status(thread_id, processor.final_status)
            if processor.final_session_id:
                update_thread_session(thread_id, processor.final_session_id)

            # Notify subscribers of completion
            await broadcast_to_thread(thread_id, {
                "type": "complete",
                "data": {"assistantMessage": assistant_message, "status": processor.final_status},
            })

        except TimeoutError:
            logger.error(f"Agent timeout in thread {thread_id} (notification)")
            update_thread_status(thread_id, "needs_attention")
            await broadcast_to_thread(thread_id, {
                "type": "error",
                "data": {"error": f"Request timed out after {AGENT_TIMEOUT_SECONDS // 60} minutes"},
            })

        except Exception as e:
            error_msg = str(e) or type(e).__name__
            logger.exception(f"Error processing notification in thread {thread_id}: {error_msg}")
            update_thread_status(thread_id, "needs_attention")
            await broadcast_to_thread(thread_id, {
                "type": "error",
                "data": {"error": error_msg},
            })


async def run_thread_for_agent(thread_id: str, message: str, skip_add_message: bool = False) -> None:
    """Run a thread with a message - fire-and-forget for SpawnThread with initial_message.

    Args:
        thread_id: The thread to run
        message: The user message to process
        skip_add_message: If True, skip adding the user message (already added by SpawnThread)
    """
    thread = get_thread(thread_id)
    if not thread:
        logger.error(f"Thread {thread_id} not found for initial message")
        return

    # Add the user message (unless already added by SpawnThread to fix race condition)
    if not skip_add_message:
        add_message(thread_id, "user", message)
    update_thread_status(thread_id, "pending")

    # Broadcast status change so UI shows processing indicator
    await broadcast_to_thread(thread_id, {
        "type": "status_change",
        "data": {"status": "pending"},
    })

    # Register current task for cancellation support
    current_task = asyncio.current_task()
    if current_task:
        register_task(thread_id, current_task)

    try:
        # Notify frontend if waiting for semaphore slot
        await broadcast_to_thread(thread_id, {
            "type": "queue_waiting",
            "data": {"message": "Waiting for available slot..."},
        })
        async with _agent_semaphore:
            await broadcast_to_thread(thread_id, {
                "type": "queue_acquired",
                "data": {},
            })
            processor = await run_agent_with_retry(
                thread_id,
                message,
                broadcast_status=True,
            )

        assistant_message = processor._message

        # Update thread status and session
        update_thread_status(thread_id, processor.final_status)
        if processor.final_session_id:
            update_thread_session(thread_id, processor.final_session_id)

        # Handle sub-thread completion signals (auto-signal if agent didn't call SignalStatus)
        thread = get_thread(thread_id)  # Re-fetch for latest state
        if thread:
            await notify_parent_of_subthread_completion(thread, thread_id, processor.final_status)

        # Notify subscribers of completion
        await broadcast_to_thread(thread_id, {
            "type": "complete",
            "data": {"assistantMessage": assistant_message, "status": processor.final_status},
        })

    except asyncio.CancelledError:
        logger.info(f"Task cancelled for thread {thread_id}")
        update_thread_status(thread_id, "active")
        await broadcast_to_thread(thread_id, {
            "type": "stopped",
            "data": {},
        })

    except TimeoutError:
        logger.error(f"Agent timeout in thread {thread_id} (sub-thread)")
        update_thread_status(thread_id, "needs_attention")
        await broadcast_to_thread(thread_id, {
            "type": "error",
            "data": {"error": f"Request timed out after {AGENT_TIMEOUT_SECONDS // 60} minutes"},
        })
        # Notify parent so it knows the sub-thread failed
        if thread:
            await _notify_parent_on_subthread_error(thread, thread_id, f"timed out after {AGENT_TIMEOUT_SECONDS // 60} minutes")

    except Exception as e:
        error_msg = str(e) or type(e).__name__
        logger.exception(f"Error processing initial message in thread {thread_id}: {error_msg}")
        update_thread_status(thread_id, "needs_attention")
        await broadcast_to_thread(thread_id, {
            "type": "error",
            "data": {"error": error_msg},
        })
        # Notify parent so it knows the sub-thread failed
        if thread:
            await _notify_parent_on_subthread_error(thread, thread_id, error_msg)

    finally:
        unregister_task(thread_id)


async def _notify_parent_on_subthread_error(
    thread: dict[str, Any],
    thread_id: str,
    error_msg: str,
) -> None:
    """Notify parent thread when a sub-thread encounters an error.

    This ensures the parent always knows when a child fails, even on crashes/timeouts.
    Without this, a parent can hang forever waiting for a SignalStatus that never comes.
    """
    parent_id = thread.get("parentId")
    if not parent_id:
        return

    # Broadcast subthread_status event to parent's SSE subscribers
    await broadcast_to_thread(parent_id, {
        "type": "subthread_status",
        "data": {
            "threadId": thread_id,
            "status": "needs_attention",
            "title": thread.get("title", "Unknown"),
        },
    })

    # Inject notification message into parent so agent sees it on next activation
    notification_content = (
        f'[notification] Sub-thread "{thread.get("title", "Unknown")}" encountered an error: '
        f"{error_msg}. You may need to retry or handle this manually."
    )
    user_notification = add_message(parent_id, "user", notification_content)
    await broadcast_to_thread(parent_id, {
        "type": "message",
        "data": {"message": user_notification},
    })

    # Trigger parent auto-react if enabled
    parent_thread = get_thread(parent_id)
    if parent_thread and parent_thread.get("autoReact", True):
        task = asyncio.create_task(run_parent_thread_notification(parent_id, notification_content))
        task.add_done_callback(
            lambda t: logger.error(f"Parent error notification task failed for {parent_id}: {t.exception()}")
            if t.exception() else None
        )


async def broadcast_subagent_stop_to_thread(thread_id: str, event_data: dict[str, Any]) -> None:
    """Broadcast a SubagentStop event to a thread's subscribers.

    This is called when a background Task completes, allowing the frontend
    to show the user that a background task has finished.
    Also updates the ephemeral thread status if one exists.
    """
    # Update ephemeral thread status if it exists
    tool_use_id = event_data.get("toolUseId")
    if tool_use_id:
        try:
            ephemeral = get_thread(tool_use_id)
            if ephemeral and ephemeral.get("isEphemeral"):
                new_status = "done" if not event_data.get("error") else "needs_attention"
                update_thread_status(tool_use_id, new_status)
        except Exception as e:
            logger.debug(f"Could not update ephemeral thread {tool_use_id}: {e}")

    await broadcast_to_thread(thread_id, {
        "type": "subagent_stop",
        "data": event_data,
    })


async def broadcast_status_signal_to_parent(
    parent_thread_id: str,
    child_thread_id: str,
    status: str,
    reason: str,
) -> None:
    """Broadcast a status signal from a child thread to its parent.

    This is called when a sub-thread calls SignalStatus to notify
    its parent that it's done or needs attention.
    """
    # Get child thread info for the notification
    child_thread = get_thread(child_thread_id)
    child_title = child_thread.get("title", "Unknown") if child_thread else "Unknown"

    # Update the child thread's status
    new_status = "done" if status == "done" else "needs_attention"
    update_thread_status(child_thread_id, new_status)

    # Broadcast to parent thread subscribers
    await broadcast_to_thread(parent_thread_id, {
        "type": "subthread_status",
        "data": {
            "threadId": child_thread_id,
            "title": child_title,
            "status": new_status,
            "reason": reason,
        },
    })

    logger.info(f"Sub-thread {child_thread_id} signaled '{status}' to parent {parent_thread_id}: {reason}")


async def send_to_thread_for_agent(
    target_thread_id: str,
    message: str,
    source_thread_id: str,
) -> dict[str, Any] | None:
    """Send a message to an existing thread - async wrapper for the agent's SendToThread tool.

    Args:
        target_thread_id: The thread to send the message to
        message: The message content
        source_thread_id: The thread making the request (for validation)

    Returns:
        Thread info dict on success, None if thread not found or not a valid target
    """
    target_thread = get_thread(target_thread_id)
    if not target_thread:
        return None

    # Security check: only allow sending to child threads of the source
    if target_thread.get("parentId") != source_thread_id:
        logger.warning(
            f"Thread {source_thread_id} attempted to send to non-child thread {target_thread_id}"
        )
        return None

    # Don't send to archived threads
    if target_thread.get("archivedAt"):
        logger.warning(f"Cannot send to archived thread {target_thread_id}")
        return None

    # Fire-and-forget: start processing the message in background
    task = asyncio.create_task(run_thread_for_agent(target_thread_id, message))
    task.add_done_callback(
        lambda t: logger.error(f"SendToThread background task failed for {target_thread_id}: {t.exception()}")
        if t.exception() else None
    )

    return {
        "id": target_thread["id"],
        "title": target_thread["title"],
        "status": target_thread.get("status", "active"),
    }


# Register agent callbacks at module load time
register_create_thread_callback(create_thread_for_agent)
register_broadcast_question_callback(broadcast_question_to_thread)
register_broadcast_plan_approval_callback(broadcast_plan_approval_to_thread)
register_list_threads_callback(list_threads_for_agent)
register_archive_thread_callback(archive_thread_for_agent)
register_run_thread_callback(run_thread_for_agent)
register_read_thread_callback(read_thread_for_agent)
register_broadcast_subagent_stop_callback(broadcast_subagent_stop_to_thread)
register_broadcast_status_signal_callback(broadcast_status_signal_to_parent)
register_send_to_thread_callback(send_to_thread_for_agent)


# Pydantic models with validation
ThreadStatus = Literal["active", "pending", "running", "needs_attention", "done", "new_message"]
ModelType = Literal["claude-sonnet-4-5", "claude-opus-4-5", "claude-opus-4-6", "claude-haiku-4-5"]


PermissionMode = Literal["default", "acceptEdits", "bypassPermissions", "plan"]


class CreateThreadRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    parentId: str | None = Field(None, pattern=r"^[a-f0-9-]{36}$")
    workDir: str | None = None
    model: ModelType = "claude-opus-4-5"
    extendedThinking: bool = True
    permissionMode: PermissionMode = "acceptEdits"  # Default to acceptEdits (like Claude Code build mode)
    useWorktree: bool = False  # If True, create an isolated git worktree for the thread
    allowNestedSubthreads: bool = False  # Per-thread nesting setting (set at creation, immutable)
    maxThreadDepth: int = Field(1, ge=1, le=5)  # Per-thread max depth (set at creation, immutable)


class UpdateConfigRequest(BaseModel):
    model: ModelType | None = None
    extendedThinking: bool | None = None
    permissionMode: PermissionMode | None = None
    autoReact: bool | None = None


class ImageAttachment(BaseModel):
    """Image attachment for messages."""
    data: str = Field(..., description="Base64-encoded image data")
    media_type: str = Field(..., pattern=r"^image/(png|jpeg|gif|webp)$", description="Image MIME type")


class SendMessageRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=100000)
    images: list[ImageAttachment] | None = Field(None, max_length=10, description="Optional image attachments (max 10)")
    file_references: list[str] | None = Field(None, max_length=20, description="Optional file paths to include as context")


class UpdateStatusRequest(BaseModel):
    status: ThreadStatus


class AnswerRequest(BaseModel):
    """Request model for submitting answers to agent questions."""
    answers: dict[str, str] = Field(..., description="Map of question text to answer string")


class PlanActionRequest(BaseModel):
    """Request model for plan approval actions."""
    action: Literal["proceed", "modify", "compact"] = Field(..., description="Action to take on the plan")
    permissionMode: PermissionMode | None = Field(None, description="Permission mode for proceed action")


class CreateDirectoryRequest(BaseModel):
    """Request body for creating a directory."""
    path: str = Field(..., min_length=1)


class UpdateTitleRequest(BaseModel):
    """Request body for updating thread title."""
    title: str = Field(..., min_length=1, max_length=255)


class MessageResponse(BaseModel):
    id: str
    thread_id: str
    role: str
    content: str
    content_blocks: str | None = None
    timestamp: str


class ThreadResponse(BaseModel):
    id: str
    title: str
    status: str
    parentId: str | None
    workDir: str | None
    sessionId: str | None
    model: str
    extendedThinking: bool
    permissionMode: str
    allowNestedSubthreads: bool = False
    maxThreadDepth: int = 1
    gitBranch: str | None
    gitRepo: str | None
    isWorktree: bool
    archivedAt: str | None
    createdAt: str
    updatedAt: str
    messages: list[MessageResponse]


def _run_git_command(args: list[str], cwd: str, timeout: int = 5) -> tuple[bool, str]:
    """Run a git command and return (success, stdout)."""
    try:
        result = subprocess.run(
            args,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return result.returncode == 0, result.stdout.strip()
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError) as e:
        logger.debug(f"Git command failed: {args} - {e}")
        return False, ""


def _detect_git_info_sync(work_dir: str | None) -> dict[str, Any]:
    """Synchronous helper for git detection (runs in thread pool).

    Detects git branch, repository name, and worktree status.
    Handles edge cases like detached HEAD and symlinked paths.
    """
    if not work_dir:
        return {"git_branch": None, "git_repo": None, "is_worktree": False}

    path = Path(work_dir)
    if not path.exists():
        return {"git_branch": None, "git_repo": None, "is_worktree": False}

    try:
        # Check if it's a git repo
        success, _ = _run_git_command(
            ["git", "rev-parse", "--is-inside-work-tree"],
            work_dir,
        )
        if not success:
            return {"git_branch": None, "git_repo": None, "is_worktree": False}

        # Get branch name
        success, branch = _run_git_command(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            work_dir,
        )
        if not success:
            branch = None
        elif branch == "HEAD":
            # Detached HEAD state - get short commit hash instead
            success, short_hash = _run_git_command(
                ["git", "rev-parse", "--short", "HEAD"],
                work_dir,
            )
            branch = f"({short_hash})" if success else "(detached)"

        # Get repo name from remote or directory name
        success, url = _run_git_command(
            ["git", "remote", "get-url", "origin"],
            work_dir,
        )
        if success and url:
            # Extract repo name from URL (handles SSH, HTTPS, and various formats)
            # Examples:
            #   git@github.com:user/repo.git -> repo
            #   https://github.com/user/repo.git -> repo
            #   ssh://git@github.com/user/repo -> repo
            repo_part = url.rstrip("/").split("/")[-1]
            repo = repo_part.removesuffix(".git")
        else:
            repo = path.name

        # Check if it's a worktree by comparing git directories
        # Use realpath to resolve symlinks for accurate comparison
        success1, common_dir = _run_git_command(
            ["git", "rev-parse", "--git-common-dir"],
            work_dir,
        )
        success2, git_dir = _run_git_command(
            ["git", "rev-parse", "--git-dir"],
            work_dir,
        )

        is_worktree = False
        if success1 and success2:
            # Normalize paths: resolve to absolute and resolve symlinks
            common_path = os.path.realpath(os.path.join(work_dir, common_dir))
            git_path = os.path.realpath(os.path.join(work_dir, git_dir))
            is_worktree = common_path != git_path

        logger.debug(
            f"Git info detected for {work_dir}: branch={branch}, repo={repo}, worktree={is_worktree}"
        )
        return {"git_branch": branch, "git_repo": repo, "is_worktree": is_worktree}

    except Exception as e:
        logger.warning(f"Git detection failed for {work_dir}: {e}")
        return {"git_branch": None, "git_repo": None, "is_worktree": False}


async def detect_git_info(work_dir: str | None) -> dict[str, Any]:
    """Detect git information from a working directory (non-blocking)."""
    return await asyncio.to_thread(_detect_git_info_sync, work_dir)


def _browse_directory_sync(path: str, type_filter: str) -> list[dict[str, str]]:
    """Synchronous helper for directory browsing (runs in thread pool)."""
    # Expand ~ to home directory
    base = Path(path).expanduser() if path else Path.home()

    # If path is partial (doesn't exist), get parent and filter by prefix
    if not base.exists():
        parent = base.parent
        prefix = base.name.lower()
        if not parent.exists():
            return []
        entries = [e for e in parent.iterdir() if e.name.lower().startswith(prefix)]
    else:
        # If path exists, list its contents
        if base.is_file():
            # If it's a file, list parent directory filtered by file prefix
            parent = base.parent
            prefix = base.name.lower()
            entries = [e for e in parent.iterdir() if e.name.lower().startswith(prefix)]
        else:
            entries = list(base.iterdir())
            prefix = ""

    # Filter by type
    if type_filter == "directory":
        entries = [e for e in entries if e.is_dir()]

    # Sort and limit results
    entries = sorted(entries, key=lambda e: e.name.lower())[:20]

    return [{"path": str(e), "name": e.name, "isDir": e.is_dir()} for e in entries]


def _get_git_branches_sync(repo_path: str) -> list[str]:
    """Get list of local branches for a git repo."""
    try:
        result = subprocess.run(
            ["git", "branch", "--format=%(refname:short)"],
            cwd=repo_path,
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            return [b.strip() for b in result.stdout.strip().split("\n") if b.strip()]
        return []
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return []


def _get_git_info_detailed_sync(work_dir: str) -> dict[str, Any]:
    """Get detailed git info including list of branches."""
    basic_info = _detect_git_info_sync(work_dir)

    if not basic_info.get("git_branch"):
        return {
            "isGitRepo": False,
            "repoRoot": None,
            "repoName": None,
            "currentBranch": None,
            "branches": [],
            "isWorktree": False,
            "worktreeBranch": None,
        }

    # Get repo root
    success, repo_root = _run_git_command(
        ["git", "rev-parse", "--show-toplevel"],
        work_dir,
    )
    repo_root = repo_root if success else work_dir

    # Get list of branches
    branches = _get_git_branches_sync(work_dir)

    # Get worktree branch if applicable
    worktree_branch = None
    if basic_info.get("is_worktree"):
        # In a worktree, the current branch is the worktree branch
        worktree_branch = basic_info.get("git_branch")

    return {
        "isGitRepo": True,
        "repoRoot": repo_root,
        "repoName": basic_info.get("git_repo"),
        "currentBranch": basic_info.get("git_branch"),
        "branches": branches,
        "isWorktree": basic_info.get("is_worktree", False),
        "worktreeBranch": worktree_branch,
    }


def _get_directory_suggestions_sync() -> list[dict[str, Any]]:
    """Get smart directory suggestions based on common patterns.

    Returns suggestions from:
    1. Common project folder locations (~/Projects, ~/Code, etc.)
    2. Git repositories within common locations (1 level deep)
    3. Recently used working directories from thread history
    """
    suggestions = []
    home = os.path.expanduser("~")

    # 1. Common project locations
    common_paths = [
        os.path.join(home, "Projects"),
        os.path.join(home, "Code"),
        os.path.join(home, "Developer"),
        os.path.join(home, "repos"),
        os.path.join(home, "workspace"),
        os.path.join(home, "src"),
    ]

    # Check which common paths exist and find git repos within them
    for base in common_paths:
        if os.path.isdir(base):
            suggestions.append({"path": base, "type": "folder", "reason": "project folder"})
            # Look for git repos 1 level deep (limit scan to 20 items)
            try:
                for item in sorted(os.listdir(base))[:20]:
                    item_path = os.path.join(base, item)
                    if os.path.isdir(item_path):
                        if os.path.exists(os.path.join(item_path, ".git")):
                            suggestions.append({"path": item_path, "type": "git", "reason": "git repo"})
            except PermissionError:
                pass

    # 2. Recent directories from thread history
    try:
        recent = get_recent_work_dirs(limit=5)
        for path in recent:
            # Avoid duplicates
            if not any(s["path"] == path for s in suggestions):
                suggestions.append({"path": path, "type": "recent", "reason": "recently used"})
    except Exception:
        pass

    logger.debug(f"Directory suggestions: found {len(suggestions)} suggestions")
    return suggestions


def _create_git_worktree_sync(
    base_work_dir: str,
    thread_id: str,
    worktree_subdir: str = ".mainthread/worktrees/",
) -> dict[str, Any]:
    """Synchronous helper for git worktree creation (runs in thread pool).

    Creates a git worktree for isolated sub-thread development.

    Args:
        base_work_dir: The parent thread's working directory (must be a git repo)
        thread_id: The thread ID (used for branch and directory naming)
        worktree_subdir: Relative path within base_work_dir for worktrees

    Returns:
        Dict with success, worktree_path, branch_name, and error (if any)
    """
    result: dict[str, Any] = {
        "success": False,
        "worktree_path": None,
        "branch_name": None,
        "error": None,
    }

    try:
        # 1. Verify base_work_dir is a git repo
        success, _ = _run_git_command(
            ["git", "rev-parse", "--is-inside-work-tree"],
            base_work_dir,
        )
        if not success:
            result["error"] = "Not a git repository"
            return result

        # 2. Create worktree directory path with path traversal protection
        id_prefix = thread_id[:8]
        branch_name = f"mainthread/{id_prefix}"

        # Validate worktree_subdir to prevent path traversal
        clean_subdir = worktree_subdir.strip().strip("/\\")
        if not clean_subdir:
            clean_subdir = ".mainthread/worktrees"

        # Reject absolute paths
        if os.path.isabs(clean_subdir):
            result["error"] = "Worktree directory must be a relative path"
            return result

        # Resolve paths and verify target is within base_work_dir
        base_path = Path(base_work_dir).resolve()

        def _validate_worktree_path(wt_path: Path) -> str | None:
            """Validate worktree path is within base_path and doesn't traverse symlinks.
            Returns error message or None if valid."""
            try:
                wt_path.relative_to(base_path)
            except ValueError:
                return "Worktree directory must be within the working directory"
            # Reject paths that traverse symlinks (defense against symlink attacks)
            for parent in wt_path.relative_to(base_path).parents:
                candidate = base_path / parent
                if candidate.is_symlink():
                    return "Worktree path cannot traverse symlinks"
            return None

        worktree_dir = (base_path / clean_subdir / id_prefix).resolve()
        validation_error = _validate_worktree_path(worktree_dir)
        if validation_error:
            result["error"] = validation_error
            return result

        # Ensure parent directory exists
        worktree_dir.parent.mkdir(parents=True, exist_ok=True)

        # 3. Check if branch already exists and try alternative names
        success, _ = _run_git_command(
            ["git", "rev-parse", "--verify", f"refs/heads/{branch_name}"],
            base_work_dir,
        )
        if success:
            # Branch exists, try with a suffix
            for i in range(2, 10):
                alt_branch = f"{branch_name}-{i}"
                success, _ = _run_git_command(
                    ["git", "rev-parse", "--verify", f"refs/heads/{alt_branch}"],
                    base_work_dir,
                )
                if not success:
                    branch_name = alt_branch
                    worktree_dir = (base_path / clean_subdir / f"{id_prefix}-{i}").resolve()
                    # Re-verify path after collision retry
                    validation_error = _validate_worktree_path(worktree_dir)
                    if validation_error:
                        result["error"] = validation_error
                        return result
                    break
            else:
                result["error"] = "Could not find available branch name"
                return result

        # 4. Create the worktree with a new branch from HEAD
        success, output = _run_git_command(
            ["git", "worktree", "add", "-b", branch_name, str(worktree_dir)],
            base_work_dir,
            timeout=30,
        )
        if not success:
            result["error"] = f"Failed to create worktree: {output}"
            return result

        result["success"] = True
        result["worktree_path"] = str(worktree_dir)
        result["branch_name"] = branch_name
        logger.debug(f"Created git worktree at {worktree_dir} on branch {branch_name}")
        return result

    except Exception as e:
        result["error"] = str(e)
        logger.warning(f"Git worktree creation failed: {e}")
        return result


async def create_git_worktree(
    base_work_dir: str,
    thread_id: str,
    worktree_subdir: str = ".mainthread/worktrees/",
) -> dict[str, Any]:
    """Create a git worktree for a thread (non-blocking).

    Args:
        base_work_dir: The parent thread's working directory
        thread_id: The thread ID for naming
        worktree_subdir: Relative path within base_work_dir for worktrees

    Returns:
        Dict with success, worktree_path, branch_name, error
    """
    return await asyncio.to_thread(
        _create_git_worktree_sync, base_work_dir, thread_id, worktree_subdir
    )


def _cleanup_git_worktree_sync(worktree_path: str, branch_name: str | None) -> bool:
    """Synchronous helper for git worktree cleanup (runs in thread pool).

    Removes a git worktree and optionally its branch.

    Args:
        worktree_path: Path to the worktree directory
        branch_name: Optional branch name to delete after removing worktree

    Returns:
        True if cleanup succeeded, False otherwise
    """
    try:
        worktree_dir = Path(worktree_path)
        if not worktree_dir.exists():
            logger.debug(f"Worktree path does not exist, skipping cleanup: {worktree_path}")
            return True

        # Find the git repo root by looking at parent directories
        # The worktree is in .mainthread/worktrees/{id}/, so repo root is 3 levels up
        repo_root = worktree_dir.parent.parent.parent
        if not (repo_root / ".git").exists() and not (repo_root / ".git").is_file():
            # .git might be a file for worktrees, check if it's a valid repo
            success, _ = _run_git_command(
                ["git", "rev-parse", "--is-inside-work-tree"],
                str(repo_root),
            )
            if not success:
                logger.warning(f"Could not find git repo root for worktree cleanup: {worktree_path}")
                return False

        # 1. Remove the worktree
        success, output = _run_git_command(
            ["git", "worktree", "remove", str(worktree_dir), "--force"],
            str(repo_root),
            timeout=30,
        )
        if not success:
            logger.warning(f"Failed to remove worktree {worktree_path}: {output}")
            # Try to remove directory manually if git command fails
            import shutil
            try:
                shutil.rmtree(worktree_dir)
            except OSError as e:
                logger.warning(f"Failed to manually remove worktree directory: {e}")

        # 2. Prune any orphaned worktree references
        _run_git_command(["git", "worktree", "prune"], str(repo_root))

        # 3. Optionally delete the branch (non-critical, don't fail if this fails)
        if branch_name:
            success, _ = _run_git_command(
                ["git", "branch", "-d", branch_name],
                str(repo_root),
            )
            if not success:
                # Try force delete if normal delete fails
                _run_git_command(
                    ["git", "branch", "-D", branch_name],
                    str(repo_root),
                )

        logger.info(f"Cleaned up git worktree: {worktree_path}")
        return True

    except Exception as e:
        logger.error(f"Error cleaning up git worktree {worktree_path}: {e}")
        return False


async def cleanup_git_worktree(worktree_path: str, branch_name: str | None) -> bool:
    """Clean up a thread's git worktree on archive (non-blocking).

    Args:
        worktree_path: Path to the worktree directory
        branch_name: Optional branch name to delete

    Returns:
        True if cleanup succeeded, False otherwise
    """
    return await asyncio.to_thread(_cleanup_git_worktree_sync, worktree_path, branch_name)


# Health check
@app.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}


# Simple metrics endpoint for local dev
@app.get("/api/metrics")
async def get_metrics() -> dict[str, Any]:
    """Get basic thread and SSE counts."""
    all_threads = await asyncio.to_thread(get_all_threads, True)

    return {
        "threads": {
            "total": len(all_threads),
            "active": sum(1 for t in all_threads if not t.get("archivedAt")),
            "archived": sum(1 for t in all_threads if t.get("archivedAt")),
        },
        "sse": {
            "subscribers": sum(len(q) for q in thread_subscribers.values()),
        },
    }


def _collect_system_stats_sync() -> dict[str, Any]:
    """Collect system stats synchronously (runs in thread pool to avoid blocking)."""
    import psutil

    # CPU (interval=None uses cached value from background thread)
    cpu_percent = psutil.cpu_percent(interval=None)

    # Memory
    mem = psutil.virtual_memory()

    # Claude processes (subprocess count)
    # Claude Agent SDK spawns "claude" CLI processes
    # We look for processes where the binary/first arg is "claude" or process name is "claude"
    claude_processes: list[dict[str, Any]] = []
    for proc in psutil.process_iter(["pid", "name", "cmdline", "memory_percent", "cpu_percent"]):
        try:
            cmdline = proc.info.get("cmdline") or []
            proc_name = (proc.info.get("name") or "").lower()

            # Check multiple ways a Claude process might appear:
            # 1. Process name is "claude"
            # 2. First cmdline arg is "claude" or ends with "/claude"
            # 3. Any cmdline arg contains "claude" binary path (for spawned subprocesses)
            first_arg = cmdline[0] if cmdline else ""
            is_claude_binary = (
                proc_name == "claude"
                or first_arg == "claude"
                or first_arg.endswith("/claude")
                or any("bin/claude" in arg or "/claude" == arg for arg in cmdline[:2])
            )

            # Exclude Chrome extension processes
            cmdline_str = " ".join(cmdline).lower()
            is_chrome_extension = "chrome" in cmdline_str or "native-host" in cmdline_str

            if is_claude_binary and not is_chrome_extension:
                claude_processes.append({
                    "pid": proc.info["pid"],
                    "name": proc.info.get("name", "unknown"),
                    "memory_percent": proc.info["memory_percent"],
                    "cpu_percent": proc.info["cpu_percent"],
                })
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass

    return {
        "cpu_percent": cpu_percent,
        "memory_percent": mem.percent,
        "memory_used_gb": round(mem.used / (1024**3), 2),
        "memory_total_gb": round(mem.total / (1024**3), 2),
        "claude_process_count": len(claude_processes),
        "claude_processes": claude_processes,
    }


@app.get("/api/stats")
async def get_system_stats() -> dict[str, Any]:
    """Get system resource usage stats.

    Returns CPU/memory usage and Claude process count.
    Useful for monitoring system health during agent execution.
    """
    try:
        import psutil  # noqa: F401 - check if available
    except ImportError:
        return {"error": "psutil not installed"}

    # Run process iteration in thread pool to avoid blocking event loop
    stats = await asyncio.to_thread(_collect_system_stats_sync)
    return stats


@app.get("/api/time")
async def get_current_time() -> dict[str, Any]:
    """Get the current server time in UTC.

    Returns ISO 8601 timestamp, Unix timestamp, and timezone info.
    Useful for time synchronization and debugging.
    """
    now = datetime.now(timezone.utc)

    return {
        "timestamp": now.isoformat(),
        "unix_timestamp": now.timestamp(),
        "timezone": "UTC",
    }


# =============================================================================
# Path browsing and directory endpoints
# =============================================================================


@app.get("/api/cwd")
async def get_current_directory() -> dict[str, str]:
    """Get the server's current working directory."""
    cwd = os.getcwd()
    logger.debug(f"Get CWD: {cwd}")
    return {"path": cwd}


@app.get("/api/browse")
async def browse_directory(path: str = "", type: str = "directory") -> list[dict[str, Any]]:
    """List directories for path autocomplete.

    Args:
        path: Partial or complete directory path (supports ~ for home)
        type: Filter type - "directory" for dirs only, "all" for everything

    Returns:
        List of matching entries with path, name, and isDir fields.
    """
    try:
        results = await asyncio.to_thread(_browse_directory_sync, path, type)
        logger.debug(f"Browse directory: path={path}, found {len(results)} items")
        return results
    except PermissionError:
        logger.warning(f"Browse directory permission denied: {path}")
        return []
    except Exception as e:
        logger.warning(f"Browse directory error for {path}: {e}")
        return []


@app.post("/api/directories")
async def create_directory(request: CreateDirectoryRequest) -> dict[str, Any]:
    """Create a directory (with parents if needed).

    Args:
        path: The directory path to create (supports ~ for home)

    Returns:
        Created path and success status.
    """
    try:
        path = Path(request.path).expanduser().resolve()

        # Security: don't create in system directories
        system_dirs = ["/", "/bin", "/sbin", "/usr", "/etc", "/var", "/tmp", "/dev", "/proc", "/sys"]
        if str(path) in system_dirs or any(str(path).startswith(d + "/") for d in ["/bin", "/sbin", "/usr/bin", "/usr/sbin", "/etc"]):
            raise HTTPException(status_code=400, detail="Cannot create directory in system paths")

        path.mkdir(parents=True, exist_ok=True)
        logger.debug(f"Created directory: {path}")
        return {"path": str(path), "created": True}

    except PermissionError:
        logger.warning(f"Create directory permission denied: {request.path}")
        raise HTTPException(status_code=403, detail="Permission denied")
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Create directory error: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/directories/suggestions")
async def get_directory_suggestions() -> list[dict[str, Any]]:
    """Get smart directory suggestions for the create thread modal.

    Returns suggestions based on:
    - Common project locations (~/Projects, ~/Code, etc.)
    - Git repositories within those locations
    - Recently used working directories from thread history
    """
    try:
        return await asyncio.to_thread(_get_directory_suggestions_sync)
    except Exception as e:
        logger.warning(f"Directory suggestions error: {e}")
        return []


@app.get("/api/git/info")
async def get_git_info(path: str) -> dict[str, Any]:
    """Get detailed git information for a directory.

    Args:
        path: Directory path to check (supports ~ for home)

    Returns:
        Git repo info including branches, current branch, worktree status.
    """
    try:
        expanded_path = str(Path(path).expanduser().resolve())
        if not Path(expanded_path).exists():
            logger.debug(f"Git info: path does not exist: {path}")
            return {
                "isGitRepo": False,
                "repoRoot": None,
                "repoName": None,
                "currentBranch": None,
                "branches": [],
                "isWorktree": False,
                "worktreeBranch": None,
            }
        result = await asyncio.to_thread(_get_git_info_detailed_sync, expanded_path)
        if result.get("isGitRepo"):
            logger.debug(f"Git info: {path} is repo '{result.get('repoName')}' on branch '{result.get('currentBranch')}'")
        else:
            logger.debug(f"Git info: {path} is not a git repository")
        return result
    except Exception as e:
        logger.warning(f"Git info error for {path}: {e}")
        return {
            "isGitRepo": False,
            "repoRoot": None,
            "repoName": None,
            "currentBranch": None,
            "branches": [],
            "isWorktree": False,
            "worktreeBranch": None,
        }


# Thread routes
@app.get("/api/threads", response_model=list[ThreadResponse])
async def list_threads(include_archived: bool = False) -> list[dict[str, Any]]:
    """Get all threads with their messages."""
    return await asyncio.to_thread(get_all_threads, include_archived)


@app.get("/api/threads/{thread_id}", response_model=ThreadResponse)
async def get_thread_by_id(thread_id: str) -> dict[str, Any]:
    """Get a single thread by ID."""
    thread = await asyncio.to_thread(get_thread, thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    return thread


@app.post("/api/threads", response_model=ThreadResponse, status_code=201)
async def create_new_thread(request: CreateThreadRequest) -> dict[str, Any]:
    """Create a new thread."""
    try:
        # Validate and normalize working directory (prevents path traversal)
        work_dir = validate_work_dir(request.workDir)
        # Detect git info from working directory
        git_info = await detect_git_info(work_dir)

        final_work_dir = work_dir
        final_is_worktree = git_info["is_worktree"]
        worktree_branch: str | None = None

        # Create an isolated git worktree if requested
        if request.useWorktree and request.parentId and git_info["git_branch"] and not git_info["is_worktree"]:
            import uuid
            temp_thread_id = str(uuid.uuid4())
            worktree_info = await create_git_worktree(work_dir, temp_thread_id)
            if worktree_info["success"]:
                final_work_dir = worktree_info["worktree_path"]
                final_is_worktree = True
                worktree_branch = worktree_info["branch_name"]
                git_info = {
                    "git_branch": worktree_branch,
                    "git_repo": git_info["git_repo"],
                    "is_worktree": True,
                }

        thread = create_thread(
            title=request.title,
            parent_id=request.parentId,
            work_dir=final_work_dir,
            model=request.model,
            extended_thinking=request.extendedThinking,
            permission_mode=request.permissionMode,
            git_branch=git_info["git_branch"],
            git_repo=git_info["git_repo"],
            is_worktree=final_is_worktree,
            worktree_branch=worktree_branch,
            allow_nested_subthreads=request.allowNestedSubthreads,
            max_thread_depth=request.maxThreadDepth,
        )
        return thread
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/threads/{thread_id}/messages")
async def get_thread_messages(
    thread_id: str,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    """Get paginated messages for a thread.

    Args:
        thread_id: The thread ID
        limit: Maximum messages to return (default 50, max 100)
        offset: Number of messages to skip from the end (for loading older messages)

    Returns messages in chronological order (oldest first), with pagination info.
    Use offset to load older messages (e.g., offset=50 loads the 50 messages before the most recent 50).
    """
    thread = get_thread(thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    result = await asyncio.to_thread(get_messages_paginated, thread_id, limit, offset)
    return result


@app.post("/api/threads/{thread_id}/messages")
async def send_message(thread_id: str, request: SendMessageRequest) -> dict[str, Any]:
    """Send a message to a thread and get Claude's response."""
    thread = get_thread(thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    # Build the full message content with file references
    message_content = request.content
    file_context = ""

    if request.file_references and thread.get("workDir"):
        file_context = await asyncio.to_thread(
            _read_file_contents,
            thread["workDir"],
            request.file_references,
        )
        if file_context:
            message_content = f"{file_context}\n\n{request.content}"

    # Convert images to the format expected by run_agent
    images: list[dict[str, str]] | None = None
    if request.images:
        images = [{"data": img.data, "media_type": img.media_type} for img in request.images]

    # Store user message (store original content, but pass full content to agent)
    # Include metadata about attachments for display
    message_metadata = {}
    if request.images:
        message_metadata["images"] = len(request.images)
    if request.file_references:
        message_metadata["file_references"] = request.file_references

    # Add user message
    try:
        user_message = add_message(
            thread_id,
            "user",
            request.content,
            json.dumps(message_metadata) if message_metadata else None,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    update_thread_status(thread_id, "pending")

    # Register current task for cancellation support
    current_task = asyncio.current_task()
    if current_task:
        register_task(thread_id, current_task)

    try:
        async with _agent_semaphore:
            processor = await run_agent_with_retry(
                thread_id,
                message_content,
                images=images,
                broadcast_status=True,
            )

        assistant_message = processor._message

        # Update thread status and session
        update_thread_status(thread_id, processor.final_status)
        if processor.final_session_id:
            update_thread_session(thread_id, processor.final_session_id)

        # Handle sub-thread completion signals (auto-signal if agent didn't call SignalStatus)
        thread = get_thread(thread_id)  # Re-fetch for latest state
        if thread:
            await notify_parent_of_subthread_completion(thread, thread_id, processor.final_status)

        # Notify subscribers of completion (single source of truth for messages)
        await broadcast_to_thread(thread_id, {
            "type": "complete",
            "data": {
                "userMessage": user_message,
                "assistantMessage": assistant_message,
                "status": processor.final_status,
            },
        })

        return {"status": "ok"}

    except asyncio.CancelledError:
        logger.info(f"Task cancelled for thread {thread_id}")
        update_thread_status(thread_id, "active")
        await broadcast_to_thread(thread_id, {
            "type": "stopped",
            "data": {},
        })
        raise HTTPException(status_code=499, detail="Request cancelled by user")

    except TimeoutError:
        logger.error(f"Agent timeout in thread {thread_id}")
        update_thread_status(thread_id, "needs_attention")
        await broadcast_to_thread(thread_id, {
            "type": "error",
            "data": {"error": f"Request timed out after {AGENT_TIMEOUT_SECONDS // 60} minutes"},
        })
        # Notify parent if this is a sub-thread (consistent with run_thread_for_agent)
        thread = get_thread(thread_id)
        if thread and thread.get("parentId"):
            await _notify_parent_on_subthread_error(thread, thread_id, f"timed out after {AGENT_TIMEOUT_SECONDS // 60} minutes")
        raise HTTPException(status_code=504, detail="Agent execution timed out")

    except Exception as e:
        error_msg = str(e) or type(e).__name__
        logger.exception(f"Error processing message in thread {thread_id}: {error_msg}")
        update_thread_status(thread_id, "needs_attention")
        await broadcast_to_thread(thread_id, {
            "type": "error",
            "data": {"error": error_msg},
        })
        # Notify parent if this is a sub-thread (consistent with run_thread_for_agent)
        thread = get_thread(thread_id)
        if thread and thread.get("parentId"):
            await _notify_parent_on_subthread_error(thread, thread_id, error_msg)
        raise HTTPException(status_code=500, detail=error_msg)

    finally:
        unregister_task(thread_id)


@app.patch("/api/threads/{thread_id}/status")
async def update_status(thread_id: str, request: UpdateStatusRequest) -> dict[str, bool]:
    """Update a thread's status."""
    thread = get_thread(thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    try:
        update_thread_status(thread_id, request.status)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Notify subscribers
    await broadcast_to_thread(thread_id, {
        "type": "status_change",
        "data": {"status": request.status},
    })

    return {"success": True}


@app.patch("/api/threads/{thread_id}/config")
async def update_config(thread_id: str, request: UpdateConfigRequest) -> dict[str, bool]:
    """Update a thread's configuration (model, thinking mode, auto-react)."""
    thread = get_thread(thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    update_thread_config(
        thread_id,
        model=request.model,
        extended_thinking=request.extendedThinking,
        permission_mode=request.permissionMode,
        auto_react=request.autoReact,
    )

    # Notify subscribers of config change - only include fields that were actually set
    config_data: dict[str, Any] = {}
    if request.model is not None:
        config_data["model"] = request.model
    if request.extendedThinking is not None:
        config_data["extendedThinking"] = request.extendedThinking
    if request.permissionMode is not None:
        config_data["permissionMode"] = request.permissionMode
    if request.autoReact is not None:
        config_data["autoReact"] = request.autoReact

    await broadcast_to_thread(thread_id, {
        "type": "config_change",
        "data": config_data,
    })

    return {"success": True}


@app.patch("/api/threads/{thread_id}/title")
async def update_title(thread_id: str, request: UpdateTitleRequest) -> dict[str, bool]:
    """Update a thread's title."""
    thread = get_thread(thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    try:
        success = update_thread_title(thread_id, request.title)
        if not success:
            raise HTTPException(status_code=404, detail="Thread not found")
        logger.info(f"Updated thread title: {thread_id} -> '{request.title}'")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Notify subscribers of title change
    await broadcast_to_thread(thread_id, {
        "type": "title_change",
        "data": {"title": request.title},
    })

    return {"success": True}


@app.delete("/api/threads/{thread_id}/messages")
async def clear_messages(thread_id: str) -> dict[str, bool]:
    """Clear all messages from a thread and reset session for fresh start."""
    thread = get_thread(thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    clear_thread_messages(thread_id)

    # Notify subscribers that messages were cleared
    await broadcast_to_thread(thread_id, {
        "type": "messages_cleared",
        "data": {"threadId": thread_id},
    })

    return {"success": True}


async def close_thread_subscribers(thread_id: str) -> None:
    """Close all SSE subscribers for a thread and signal them to disconnect.

    This is called when a thread is archived to clean up resources.
    """
    # Atomic removal to avoid race conditions
    queues = thread_subscribers.pop(thread_id, [])
    for queue in queues:
        await queue.put({"type": "shutdown", "data": {}})
    if queues:
        logger.info(f"Closed {len(queues)} SSE subscribers for thread {thread_id}")


async def cleanup_thread_resources(thread_id: str) -> None:
    """Clean up all resources associated with a thread.

    Called when archiving a thread to prevent memory/resource leaks.
    """
    # 1. Clear SSE events for this thread from DB
    clear_thread_events(thread_id)

    # 2. Close SSE subscribers
    await close_thread_subscribers(thread_id)

    # 3. Clear any pending questions for this thread
    await clear_pending_question(thread_id)

    # 4. Clean up notification queue/worker if present
    if thread_id in _notification_workers:
        _notification_workers[thread_id].cancel()
        del _notification_workers[thread_id]
    if thread_id in _notification_queues:
        del _notification_queues[thread_id]

    # 5. Cancel any active agent task for this thread
    stop_task(thread_id)

    logger.info(f"Cleaned up resources for thread {thread_id}")


@app.post("/api/threads/{thread_id}/archive")
async def archive_thread_endpoint(thread_id: str) -> dict[str, bool]:
    """Archive a thread and clean up associated resources."""
    thread = get_thread(thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    if thread.get("archivedAt"):
        raise HTTPException(status_code=400, detail="Thread is already archived")

    # Clean up git worktree if this thread has one
    if thread.get("isWorktree") and thread.get("workDir"):
        worktree_branch = thread.get("worktreeBranch")
        cleanup_success = await cleanup_git_worktree(thread["workDir"], worktree_branch)
        if not cleanup_success:
            # Log error but continue with archive - don't fail the operation
            logger.warning(f"Failed to cleanup worktree for thread {thread_id}, continuing with archive")

    # Clean up resources before archiving
    await cleanup_thread_resources(thread_id)

    # Mark as archived in DB
    archive_thread(thread_id)

    # Notify all subscribers about the archive
    for queues in thread_subscribers.values():
        for queue in queues:
            await queue.put({
                "type": "thread_archived",
                "data": {"threadId": thread_id},
            })

    return {"success": True}


@app.post("/api/threads/{thread_id}/unarchive")
async def unarchive_thread_endpoint(thread_id: str) -> dict[str, bool]:
    """Unarchive a thread."""
    thread = get_thread(thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    if not thread.get("archivedAt"):
        raise HTTPException(status_code=400, detail="Thread is not archived")

    unarchive_thread(thread_id)

    # Notify all subscribers about the unarchive
    for queues in thread_subscribers.values():
        for queue in queues:
            await queue.put({
                "type": "thread_unarchived",
                "data": {"threadId": thread_id},
            })

    return {"success": True}


@app.delete("/api/threads/all")
async def reset_all_threads_endpoint(confirm: bool = False) -> dict[str, Any]:
    """Reset all threads - delete everything. Requires confirm=true."""
    if not confirm:
        raise HTTPException(
            status_code=400,
            detail="This action will delete ALL threads. Pass confirm=true to proceed."
        )

    deleted_count = reset_all_threads()

    # Notify all subscribers about the reset
    for queues in thread_subscribers.values():
        for queue in queues:
            await queue.put({
                "type": "all_threads_reset",
                "data": {},
            })

    return {"success": True, "deletedCount": deleted_count}


@app.get("/api/threads/{thread_id}/tokens")
async def get_thread_tokens(thread_id: str) -> dict[str, Any]:
    """Get token usage estimate for a thread.

    Returns estimated token count and breakdown by role.
    Useful for monitoring context usage and deciding when to compact.
    """
    thread = get_thread(thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    return await asyncio.to_thread(estimate_thread_tokens, thread_id)


@app.get("/api/threads/{thread_id}/usage")
async def get_thread_usage(thread_id: str) -> dict[str, Any]:
    """Get actual token usage for a thread (including child thread aggregation).

    Returns persisted input/output tokens and cost, plus aggregated child usage.
    """
    thread = get_thread(thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    return await asyncio.to_thread(get_thread_usage_with_children, thread_id)


@app.post("/api/threads/{thread_id}/answer")
async def submit_answer(thread_id: str, request: AnswerRequest) -> dict[str, bool]:
    """Submit answers to agent questions.

    This endpoint is called when a user responds to an AskUserQuestion from the agent.
    The answer is passed back to the agent through the can_use_tool hook.
    """
    thread = get_thread(thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    # Set the pending answer, which will unblock the waiting agent
    await set_pending_answer(thread_id, request.answers)

    return {"success": True}


@app.post("/api/threads/{thread_id}/plan-action")
async def handle_plan_action(thread_id: str, request: PlanActionRequest) -> dict[str, Any]:
    """Handle plan approval actions.

    This endpoint is called when the user responds to a plan approval prompt.

    Actions:
        - proceed: Continue with the plan using the specified permission mode
        - modify: Allow user to modify the plan (re-enable input)
        - compact: Trigger context compaction
    """
    thread = get_thread(thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    if request.action == "proceed":
        # Update permission mode if specified
        if request.permissionMode:
            update_thread_config(thread_id, permission_mode=request.permissionMode)

        # Unblock the waiting permission handler by setting the pending answer
        # This allows the agent to continue without starting a new agent instance
        await set_pending_answer(thread_id, {
            "action": "proceed",
            "permissionMode": request.permissionMode or thread.get("permissionMode", "default"),
        })

        await broadcast_to_thread(thread_id, {
            "type": "plan_action",
            "data": {"action": "proceed", "permissionMode": request.permissionMode},
        })

        return {"success": True, "action": "proceed"}

    elif request.action == "modify":
        # Unblock the waiting permission handler with modify action
        # This will cause the permission handler to deny the tool and let user edit
        await set_pending_answer(thread_id, {"action": "modify"})
        update_thread_status(thread_id, "active")

        await broadcast_to_thread(thread_id, {
            "type": "plan_action",
            "data": {"action": "modify"},
        })

        return {"success": True, "action": "modify"}

    elif request.action == "compact":
        # Unblock the waiting permission handler with compact action
        await set_pending_answer(thread_id, {"action": "compact"})

        # Trigger context compaction
        # For now, just clear messages and add a summary note
        # In production, this would use Claude to summarize the conversation

        # Get current messages for summarization context
        messages = get_thread_messages_formatted(thread_id)

        # Clear messages
        clear_thread_messages(thread_id)

        # Add a summary note
        summary = f"[Context compacted. Previous conversation had {len(messages.get('messages', []))} messages.]"
        add_message(thread_id, "system", summary)

        update_thread_status(thread_id, "active")

        await broadcast_to_thread(thread_id, {
            "type": "plan_action",
            "data": {"action": "compact"},
        })

        await broadcast_to_thread(thread_id, {
            "type": "messages_cleared",
            "data": {"threadId": thread_id},
        })

        return {"success": True, "action": "compact"}

    else:
        raise HTTPException(status_code=400, detail=f"Unknown action: {request.action}")


def _list_files_sync(work_dir: str, query: str | None, limit: int) -> list[dict[str, Any]]:
    """Synchronous helper for listing files (runs in thread pool).

    Lists files in the working directory, respecting .gitignore patterns.
    Filters by query if provided (case-insensitive fuzzy match on filename).

    Args:
        work_dir: Directory to search
        query: Optional search query
        limit: Maximum files to return

    Returns:
        List of file info dicts with path and name
    """
    import fnmatch

    work_path = Path(work_dir)
    if not work_path.exists():
        return []

    # Load .gitignore patterns
    gitignore_patterns: list[str] = []
    gitignore_path = work_path / ".gitignore"
    if gitignore_path.exists():
        try:
            with open(gitignore_path) as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#"):
                        gitignore_patterns.append(line)
        except OSError:
            pass

    # Common patterns to always ignore
    always_ignore = [
        ".git", ".git/**", "__pycache__", "__pycache__/**",
        "node_modules", "node_modules/**", ".venv", ".venv/**",
        "*.pyc", "*.pyo", ".DS_Store", "*.swp", "*.swo",
        ".mainthread", ".mainthread/**",
    ]
    gitignore_patterns.extend(always_ignore)

    def should_ignore(rel_path: str) -> bool:
        """Check if path matches any ignore pattern."""
        for pattern in gitignore_patterns:
            if fnmatch.fnmatch(rel_path, pattern):
                return True
            if fnmatch.fnmatch(rel_path.split("/")[-1], pattern):
                return True
        return False

    files: list[dict[str, Any]] = []
    query_lower = query.lower() if query else None

    try:
        for item in work_path.rglob("*"):
            if not item.is_file():
                continue

            rel_path = str(item.relative_to(work_path))

            if should_ignore(rel_path):
                continue

            # Filter by query if provided
            if query_lower:
                if query_lower not in rel_path.lower():
                    continue

            files.append({
                "path": rel_path,
                "name": item.name,
            })

            if len(files) >= limit:
                break

    except OSError:
        pass

    return files


def _read_file_contents(work_dir: str, file_paths: list[str], max_size: int = 100000) -> str:
    """Read contents of multiple files and format them for context.

    Args:
        work_dir: Base working directory
        file_paths: List of relative file paths
        max_size: Maximum total content size in characters

    Returns:
        Formatted string with file contents
    """
    work_path = Path(work_dir)
    contents: list[str] = []
    total_size = 0

    for rel_path in file_paths:
        try:
            file_path = work_path / rel_path
            # Security: ensure file is within work_dir
            resolved = file_path.resolve()
            if not str(resolved).startswith(str(work_path.resolve())):
                contents.append(f"<file path=\"{rel_path}\">\n[Error: Path outside working directory]\n</file>")
                continue

            if not resolved.exists():
                contents.append(f"<file path=\"{rel_path}\">\n[Error: File not found]\n</file>")
                continue

            if not resolved.is_file():
                contents.append(f"<file path=\"{rel_path}\">\n[Error: Not a file]\n</file>")
                continue

            file_size = resolved.stat().st_size
            if total_size + file_size > max_size:
                contents.append(f"<file path=\"{rel_path}\">\n[Truncated: Total context size exceeded]\n</file>")
                break

            with open(resolved, encoding="utf-8", errors="replace") as f:
                file_content = f.read()
                total_size += len(file_content)
                contents.append(f"<file path=\"{rel_path}\">\n{file_content}\n</file>")

        except Exception as e:
            contents.append(f"<file path=\"{rel_path}\">\n[Error reading file: {e}]\n</file>")

    return "\n\n".join(contents)


@app.get("/api/threads/{thread_id}/files")
async def list_thread_files(
    thread_id: str,
    query: str | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    """List files in a thread's working directory for @ mentions.

    Args:
        thread_id: The thread ID
        query: Optional search query to filter files
        limit: Maximum files to return (default 20, max 100)

    Returns:
        List of file info dicts with path and name
    """
    thread = get_thread(thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    work_dir = thread.get("workDir")
    if not work_dir:
        return []

    limit = min(limit, 100)  # Cap at 100

    return await asyncio.to_thread(_list_files_sync, work_dir, query, limit)


@app.post("/api/threads/{thread_id}/stop")
async def stop_thread(thread_id: str) -> dict[str, bool]:
    """Stop a running thread's agent execution.

    Cancels the active task for the thread if one exists.
    """
    thread = get_thread(thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    stopped = stop_task(thread_id)
    if not stopped:
        raise HTTPException(status_code=400, detail="No active task for this thread")

    # Status update and SSE broadcast are handled by the CancelledError handler
    return {"success": True}


# SSE endpoint for real-time updates
@app.get("/api/threads/{thread_id}/stream")
async def stream_thread_events(
    thread_id: str,
    last_event_id: int | None = None,  # Query param for reconnection recovery
) -> EventSourceResponse:
    """SSE endpoint for real-time thread updates.

    Supports reconnection recovery via last_event_id query parameter.
    On reconnect, client sends last received event ID to replay missed events.
    """
    thread = get_thread(thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    thread_subscribers[thread_id].append(queue)

    async def event_generator():
        try:
            # Send initial connection event
            yield {
                "event": "connected",
                "data": json.dumps({"threadId": thread_id}),
            }

            # Replay missed events from SQLite (survives server restarts)
            if last_event_id is not None:
                missed_events = get_events_since(thread_id, last_event_id)
                if missed_events:
                    logger.info(
                        f"[SSE] Replaying {len(missed_events)} missed events for thread {thread_id} from DB"
                    )
                for event in missed_events:
                    yield {
                        "event": event["event_type"],
                        "data": event["data"],  # Already JSON string from DB
                        "id": str(event["seq_id"]),
                    }

            while True:
                try:
                    # Wait for events with timeout
                    event = await asyncio.wait_for(queue.get(), timeout=30.0)

                    # Check for shutdown signal
                    if event.get("type") == "shutdown":
                        break

                    # Include event ID for reconnection tracking
                    seq_id = event.get("_seq_id", 0)
                    yield {
                        "event": event["type"],
                        "data": json.dumps(event["data"]),
                        "id": str(seq_id),
                    }
                except TimeoutError:
                    # Send heartbeat as SSE comment
                    yield {"comment": "heartbeat"}
        finally:
            # Clean up subscriber on disconnect
            if queue in thread_subscribers[thread_id]:
                thread_subscribers[thread_id].remove(queue)
            if not thread_subscribers[thread_id]:
                del thread_subscribers[thread_id]

    return EventSourceResponse(event_generator())


async def broadcast_to_thread(thread_id: str, event: dict[str, Any]) -> None:
    """Broadcast an event to all subscribers of a thread.

    Events are persisted to SQLite for reconnection recovery.
    Survives server restarts - clients replay from last seq_id.
    """
    # Persist event to SQLite (survives server restarts)
    event_type = event.get("type", "unknown")
    data_json = json.dumps(event.get("data", {}))
    seq_id = add_event(thread_id, event_type, data_json)
    event_with_id = {**event, "_seq_id": seq_id}

    for queue in thread_subscribers.get(thread_id, []):
        await queue.put(event_with_id)


@app.on_event("shutdown")
async def shutdown():
    """Clean up SSE connections on shutdown."""
    for _thread_id, queues in list(thread_subscribers.items()):
        for queue in queues:
            await queue.put({"type": "shutdown", "data": {}})
    thread_subscribers.clear()


# =============================================================================
# Static file serving for SPA frontend
# IMPORTANT: These routes MUST be defined AFTER all API routes to avoid
# the catch-all path from intercepting API requests.
# =============================================================================

# Mount static assets (JS, CSS, etc.) if they exist
if _static_dir.exists() and (_static_dir / "assets").exists():
    app.mount("/assets", StaticFiles(directory=_static_dir / "assets"), name="assets")


# SPA root route - serve index.html for root path
@app.get("/", include_in_schema=False)
async def serve_spa_root():
    """Serve the SPA index.html for the root path."""
    index_path = _static_dir / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return JSONResponse({"error": "Frontend not built"}, status_code=404)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=2026)
