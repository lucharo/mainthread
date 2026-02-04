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
    add_message,
    archive_thread,
    clear_thread_messages,
    create_thread,
    estimate_thread_tokens,
    get_all_threads,
    get_messages_paginated,
    get_recent_work_dirs,
    get_thread,
    get_thread_messages_formatted,
    reset_all_threads,
    unarchive_thread,
    update_thread_config,
    update_thread_session,
    update_thread_status,
    update_thread_title,
)

load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# SSE event queues for each thread (declared early for lifespan access)
thread_subscribers: dict[str, list[asyncio.Queue[dict[str, Any]]]] = defaultdict(list)

# SSE event store for reconnection recovery
# Stores recent events per thread with sequence IDs for replay on reconnect
class SSEEventStore:
    """In-memory store for recent SSE events to support reconnection recovery."""

    def __init__(self, max_events_per_thread: int = 100):
        self.max_events = max_events_per_thread
        self.events: dict[str, list[dict[str, Any]]] = defaultdict(list)
        self.sequence: dict[str, int] = defaultdict(int)

    def add_event(self, thread_id: str, event: dict[str, Any]) -> int:
        """Add an event and return its sequence ID."""
        self.sequence[thread_id] += 1
        seq_id = self.sequence[thread_id]
        event_with_id = {**event, "_seq_id": seq_id}
        self.events[thread_id].append(event_with_id)
        # Trim old events
        if len(self.events[thread_id]) > self.max_events:
            self.events[thread_id] = self.events[thread_id][-self.max_events :]
        return seq_id

    def get_events_since(self, thread_id: str, last_id: int) -> list[dict[str, Any]]:
        """Get events after the given sequence ID."""
        return [e for e in self.events[thread_id] if e["_seq_id"] > last_id]

    def clear_thread(self, thread_id: str) -> None:
        """Clear events for a thread (e.g., when thread is deleted)."""
        self.events.pop(thread_id, None)
        self.sequence.pop(thread_id, None)

    def clear(self) -> None:
        """Clear all events (for hot reload)."""
        self.events.clear()
        self.sequence.clear()


sse_event_store = SSEEventStore()

# Track parent threads currently processing notifications to prevent duplicates
_processing_notifications: set[str] = set()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan handler for hot reload compatibility.

    Resets asyncio state on startup to ensure primitives are bound
    to the current event loop after hot reload.
    """
    # Startup: reset state for new event loop
    thread_subscribers.clear()
    _processing_notifications.clear()
    sse_event_store.clear()
    clear_all_tasks()
    reset_agent_state()
    logger.info("MainThread API started - asyncio state reset")
    yield
    # Shutdown: cleanup
    thread_subscribers.clear()
    _processing_notifications.clear()
    sse_event_store.clear()
    clear_all_tasks()
    logger.info("MainThread API shutting down")


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


# Shared message processing logic to reduce duplication
class MessageStreamProcessor:
    """Process agent message stream and broadcast events.

    This class extracts the common message processing logic used by
    send_message(), run_thread_for_agent(), and run_parent_thread_notification().
    """

    def __init__(self, thread_id: str):
        self.thread_id = thread_id
        self.collected_content: list[str] = []
        self.collected_blocks: list[dict[str, Any]] = []
        self.pending_tool_ids: list[str] = []
        self.final_status = "active"
        self.final_session_id: str | None = None

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

            # Note: ExitPlanMode plan_approval broadcast is handled by the permission handler
            # in core.py (create_permission_handler). That handler blocks waiting for user
            # approval before allowing the tool to proceed. We don't broadcast here to avoid
            # duplicate events - the permission handler is the authoritative source.

        elif msg.type == "tool_result":
            tool_use_id = msg.metadata.get("tool_use_id") if msg.metadata else None
            # FIFO fallback: if SDK doesn't provide tool_use_id, use first pending
            if not tool_use_id and self.pending_tool_ids:
                tool_use_id = self.pending_tool_ids.pop(0)
            elif tool_use_id and tool_use_id in self.pending_tool_ids:
                self.pending_tool_ids.remove(tool_use_id)
            if tool_use_id:
                for block in self.collected_blocks:
                    if block.get("type") == "tool_use" and block.get("id") == tool_use_id:
                        block["isComplete"] = True
                        break
            # Include result content for tools that return structured data
            result_data: dict[str, Any] = {"tool_use_id": tool_use_id}
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
            # Broadcast actual token usage from SDK
            if msg.metadata:
                await broadcast_to_thread(self.thread_id, {
                    "type": "usage",
                    "data": {
                        "usage": msg.metadata.get("usage"),
                        "totalCostUsd": msg.metadata.get("total_cost_usd"),
                    },
                })

        elif msg.type == "status":
            self.final_status = msg.content
            if msg.metadata:
                self.final_session_id = msg.metadata.get("session_id")

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


# Callback implementations for agents module
async def create_thread_for_agent(
    title: str,
    parent_id: str | None = None,
    work_dir: str | None = None,
    permission_mode: str | None = None,
) -> dict[str, Any]:
    """Create a thread - async wrapper for the agent's SpawnThread tool.

    If parent_id is provided and no explicit permission_mode, inherits from parent.
    For sub-threads (with parent_id) in git repos, automatically creates an isolated worktree.
    """
    # Validate and normalize working directory
    validated_work_dir = validate_work_dir(work_dir)
    # Detect git info from working directory
    git_info = await detect_git_info(validated_work_dir)

    # If parent_id provided and no explicit mode, inherit from parent
    if parent_id and not permission_mode:
        parent = get_thread(parent_id)
        permission_mode = parent.get("permissionMode", "acceptEdits") if parent else "acceptEdits"

    # For sub-threads in git repos, automatically create an isolated worktree
    worktree_info: dict[str, Any] = {"success": False, "worktree_path": None, "branch_name": None, "error": None}
    final_work_dir = validated_work_dir
    final_is_worktree = git_info["is_worktree"]
    worktree_branch: str | None = None

    if parent_id and git_info["git_branch"] and not git_info["is_worktree"]:
        # Generate a temporary thread_id for worktree naming (will be the actual thread_id)
        import uuid
        temp_thread_id = str(uuid.uuid4())
        worktree_info = await create_git_worktree(validated_work_dir, temp_thread_id)

        if worktree_info["success"]:
            # Use the worktree path as the working directory
            final_work_dir = worktree_info["worktree_path"]
            final_is_worktree = True
            worktree_branch = worktree_info["branch_name"]
            logger.info(f"Sub-thread will use worktree at {final_work_dir} on branch {worktree_branch}")
        else:
            # Fallback to original work_dir, log warning
            logger.warning(f"Worktree creation failed for sub-thread, using original work_dir: {worktree_info['error']}")

    # Re-detect git info for the final work directory (may be worktree)
    if worktree_info["success"]:
        git_info = await detect_git_info(final_work_dir)

    thread = create_thread(
        title=title,
        parent_id=parent_id,
        work_dir=final_work_dir,
        git_branch=git_info["git_branch"],
        git_repo=git_info["git_repo"],
        is_worktree=final_is_worktree,
        worktree_branch=worktree_branch,
        permission_mode=permission_mode or "acceptEdits",
    )

    # Store worktree info in thread metadata for response messages
    thread["_worktree_info"] = worktree_info

    # Notify parent thread subscribers about the new sub-thread
    # Only broadcast to parent, not all threads
    if parent_id and parent_id in thread_subscribers:
        for queue in thread_subscribers[parent_id]:
            await queue.put({
                "type": "thread_created",
                "data": {"thread": thread},
            })

    return thread


async def broadcast_question_to_thread(thread_id: str, question_data: dict[str, Any]) -> None:
    """Broadcast a question event to a thread's subscribers."""
    await broadcast_to_thread(thread_id, {
        "type": "question",
        "data": question_data,
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


async def run_parent_thread_notification(thread_id: str, notification_content: str) -> None:
    """Run agent on parent thread to process a sub-thread notification.

    This is called when a sub-thread completes and the parent thread agent
    should be notified to read the results. Unlike run_thread_for_agent,
    this doesn't add a new message (it's already added).

    Uses a simple lock to prevent concurrent notification processing on the same
    parent thread. If a notification arrives while already processing, just skip
    triggering the agent (the running agent will see the new message).
    """
    # Skip if already processing notifications for this thread
    if thread_id in _processing_notifications:
        logger.info(f"Skipping notification for {thread_id} - already processing")
        return

    _processing_notifications.add(thread_id)
    try:
        thread = get_thread(thread_id)
        if not thread:
            logger.error(f"Thread {thread_id} not found for notification processing")
            return

        # Don't add message - it's already added by the caller
        update_thread_status(thread_id, "pending")

        # Use shared message processor
        processor = MessageStreamProcessor(thread_id)

        async with asyncio.timeout(300):
            async for msg in run_agent(thread, notification_content):
                await processor.process_message(msg)

        await processor.finalize()

        # Save assistant message
        assistant_message = add_message(
            thread_id, "assistant",
            processor.get_full_content(),
            processor.get_content_blocks_json()
        )

        # Update thread status and session
        update_thread_status(thread_id, processor.final_status)
        if processor.final_session_id:
            update_thread_session(thread_id, processor.final_session_id)

        # Notify subscribers of completion
        await broadcast_to_thread(thread_id, {
            "type": "complete",
            "data": {"message": assistant_message, "status": processor.final_status},
        })

    except TimeoutError:
        logger.error(f"Agent timeout in thread {thread_id} (notification)")
        update_thread_status(thread_id, "needs_attention")
        await broadcast_to_thread(thread_id, {
            "type": "error",
            "data": {"error": "Request timed out after 5 minutes"},
        })

    except Exception as e:
        error_msg = str(e) or type(e).__name__
        logger.exception(f"Error processing notification in thread {thread_id}: {error_msg}")
        update_thread_status(thread_id, "needs_attention")
        await broadcast_to_thread(thread_id, {
            "type": "error",
            "data": {"error": error_msg},
        })

    finally:
        _processing_notifications.discard(thread_id)


async def run_thread_for_agent(thread_id: str, message: str) -> None:
    """Run a thread with a message - fire-and-forget for SpawnThread with initial_message."""
    thread = get_thread(thread_id)
    if not thread:
        logger.error(f"Thread {thread_id} not found for initial message")
        return

    # Add the user message
    add_message(thread_id, "user", message)
    update_thread_status(thread_id, "pending")

    # Register current task for cancellation support
    current_task = asyncio.current_task()
    if current_task:
        register_task(thread_id, current_task)

    try:
        # Use shared message processor
        processor = MessageStreamProcessor(thread_id)

        async with asyncio.timeout(300):  # 5 minute timeout
            async for msg in run_agent(thread, message):
                await processor.process_message(msg)

        await processor.finalize()

        # Save assistant message with content blocks
        assistant_message = add_message(
            thread_id, "assistant",
            processor.get_full_content(),
            processor.get_content_blocks_json()
        )

        # Update thread status and session
        update_thread_status(thread_id, processor.final_status)
        if processor.final_session_id:
            update_thread_session(thread_id, processor.final_session_id)

        # Handle sub-thread completion signals
        if thread.get("parentId") and processor.final_status in ("needs_attention", "done"):
            parent_id = thread["parentId"]
            parent_thread = get_thread(parent_id)
            # Broadcast status update to frontend
            await broadcast_to_thread(parent_id, {
                "type": "subthread_status",
                "data": {
                    "threadId": thread_id,
                    "status": processor.final_status,
                    "title": thread["title"],
                },
            })
            # Inject user message into parent thread for agent visibility (user role so agent responds)
            status_msg = "completed" if processor.final_status == "done" else "needs attention"
            notification_content = f'[notification] Sub-thread "{thread["title"]}" {status_msg}.'
            user_notification = add_message(parent_id, "user", notification_content)
            # Broadcast the notification to parent thread subscribers
            await broadcast_to_thread(parent_id, {
                "type": "message",
                "data": {"message": user_notification},
            })
            # Only trigger parent thread agent if auto-react is enabled
            if parent_thread and parent_thread.get("autoReact", True):
                asyncio.create_task(run_parent_thread_notification(parent_id, notification_content))
            else:
                logger.info(f"Skipping auto-react for parent thread {parent_id} (disabled)")

        # Notify subscribers of completion
        await broadcast_to_thread(thread_id, {
            "type": "complete",
            "data": {"message": assistant_message, "status": processor.final_status},
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
            "data": {"error": "Request timed out after 5 minutes"},
        })

    except Exception as e:
        error_msg = str(e) or type(e).__name__
        logger.exception(f"Error processing initial message in thread {thread_id}: {error_msg}")
        update_thread_status(thread_id, "needs_attention")
        await broadcast_to_thread(thread_id, {
            "type": "error",
            "data": {"error": error_msg},
        })

    finally:
        unregister_task(thread_id)


async def broadcast_subagent_stop_to_thread(thread_id: str, event_data: dict[str, Any]) -> None:
    """Broadcast a SubagentStop event to a thread's subscribers.

    This is called when a background Task completes, allowing the frontend
    to show the user that a background task has finished.
    """
    await broadcast_to_thread(thread_id, {
        "type": "subagent_stop",
        "data": event_data,
    })


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
    asyncio.create_task(run_thread_for_agent(target_thread_id, message))

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
register_send_to_thread_callback(send_to_thread_for_agent)


# Pydantic models with validation
ThreadStatus = Literal["active", "pending", "needs_attention", "done", "new_message"]
ModelType = Literal["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5"]


PermissionMode = Literal["default", "acceptEdits", "bypassPermissions", "plan"]


class CreateThreadRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    parentId: str | None = Field(None, pattern=r"^[a-f0-9-]{36}$")
    workDir: str | None = None
    model: ModelType = "claude-opus-4-5"
    extendedThinking: bool = True
    permissionMode: PermissionMode = "acceptEdits"  # Default to acceptEdits (like Claude Code build mode)


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

    logger.info(f"Directory suggestions: found {len(suggestions)} suggestions")
    return suggestions


def _create_git_worktree_sync(base_work_dir: str, thread_id: str) -> dict[str, Any]:
    """Synchronous helper for git worktree creation (runs in thread pool).

    Creates a git worktree for isolated sub-thread development.

    Args:
        base_work_dir: The parent thread's working directory (must be a git repo)
        thread_id: The thread ID (used for branch and directory naming)

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

        # 2. Create worktree directory path
        id_prefix = thread_id[:8]
        worktree_dir = Path(base_work_dir) / ".mainthread" / "worktrees" / id_prefix
        branch_name = f"mainthread/{id_prefix}"

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
                    worktree_dir = Path(base_work_dir) / ".mainthread" / "worktrees" / f"{id_prefix}-{i}"
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
        logger.info(f"Created git worktree at {worktree_dir} on branch {branch_name}")
        return result

    except Exception as e:
        result["error"] = str(e)
        logger.warning(f"Git worktree creation failed: {e}")
        return result


async def create_git_worktree(base_work_dir: str, thread_id: str) -> dict[str, Any]:
    """Create a git worktree for a thread (non-blocking).

    Args:
        base_work_dir: The parent thread's working directory
        thread_id: The thread ID for naming

    Returns:
        Dict with success, worktree_path, branch_name, error
    """
    return await asyncio.to_thread(_create_git_worktree_sync, base_work_dir, thread_id)


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
    logger.info(f"Get CWD: {cwd}")
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
        logger.info(f"Browse directory: path={path}, found {len(results)} items")
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
        logger.info(f"Created directory: {path}")
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
            logger.info(f"Git info: path does not exist: {path}")
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
            logger.info(f"Git info: {path} is repo '{result.get('repoName')}' on branch '{result.get('currentBranch')}'")
        else:
            logger.info(f"Git info: {path} is not a git repository")
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

        thread = create_thread(
            title=request.title,
            parent_id=request.parentId,
            work_dir=work_dir,
            model=request.model,
            extended_thinking=request.extendedThinking,
            permission_mode=request.permissionMode,
            git_branch=git_info["git_branch"],
            git_repo=git_info["git_repo"],
            is_worktree=git_info["is_worktree"],
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
        # Use shared message processor
        processor = MessageStreamProcessor(thread_id)

        async with asyncio.timeout(300):  # 5 minute timeout
            async for msg in run_agent(thread, message_content, images=images):
                await processor.process_message(msg)

        await processor.finalize()

        # Save assistant message with content blocks
        assistant_message = add_message(
            thread_id, "assistant",
            processor.get_full_content(),
            processor.get_content_blocks_json()
        )

        # Update thread status and session
        update_thread_status(thread_id, processor.final_status)
        if processor.final_session_id:
            update_thread_session(thread_id, processor.final_session_id)

        # Handle sub-thread completion signals
        if thread.get("parentId") and processor.final_status in ("needs_attention", "done"):
            parent_id = thread["parentId"]
            parent_thread = get_thread(parent_id)
            # Notify parent thread of sub-thread status change
            await broadcast_to_thread(parent_id, {
                "type": "subthread_status",
                "data": {
                    "threadId": thread_id,
                    "status": processor.final_status,
                    "title": thread["title"],
                },
            })
            # Inject user message into parent thread for agent visibility (user role so agent responds)
            status_msg = "completed" if processor.final_status == "done" else "needs attention"
            notification_content = f'[notification] Sub-thread "{thread["title"]}" {status_msg}.'
            user_notification = add_message(parent_id, "user", notification_content)
            # Broadcast the notification to parent thread subscribers
            await broadcast_to_thread(parent_id, {
                "type": "message",
                "data": {"message": user_notification},
            })
            # Only trigger parent thread agent if auto-react is enabled
            if parent_thread and parent_thread.get("autoReact", True):
                asyncio.create_task(run_parent_thread_notification(parent_id, notification_content))
            else:
                logger.info(f"Skipping auto-react for parent thread {parent_id} (disabled)")

        # Notify subscribers of completion
        await broadcast_to_thread(thread_id, {
            "type": "complete",
            "data": {"message": assistant_message, "status": processor.final_status},
        })

        return {"userMessage": user_message, "assistantMessage": assistant_message}

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
            "data": {"error": "Request timed out after 5 minutes"},
        })
        raise HTTPException(status_code=504, detail="Agent execution timed out")

    except Exception as e:
        error_msg = str(e) or type(e).__name__
        logger.exception(f"Error processing message in thread {thread_id}: {error_msg}")
        update_thread_status(thread_id, "needs_attention")
        await broadcast_to_thread(thread_id, {
            "type": "error",
            "data": {"error": error_msg},
        })
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

    # Notify subscribers of config change
    await broadcast_to_thread(thread_id, {
        "type": "config_change",
        "data": {
            "model": request.model,
            "extendedThinking": request.extendedThinking,
            "permissionMode": request.permissionMode,
            "autoReact": request.autoReact,
        },
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
    # 1. Clear SSE event store for this thread
    sse_event_store.clear_thread(thread_id)

    # 2. Close SSE subscribers
    await close_thread_subscribers(thread_id)

    # 3. Clear any pending questions for this thread
    await clear_pending_question(thread_id)

    # 4. Remove from processing notifications set if present
    _processing_notifications.discard(thread_id)

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

            # Replay missed events if reconnecting
            if last_event_id is not None:
                missed_events = sse_event_store.get_events_since(thread_id, last_event_id)
                if missed_events:
                    logger.info(
                        f"[SSE] Replaying {len(missed_events)} missed events for thread {thread_id}"
                    )
                for event in missed_events:
                    seq_id = event.get("_seq_id", 0)
                    yield {
                        "event": event["type"],
                        "data": json.dumps(event["data"]),
                        "id": str(seq_id),
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

    Events are stored for reconnection recovery. Clients can use Last-Event-Id
    header to replay missed events after reconnection.
    """
    # Store event with sequence ID for reconnection recovery
    seq_id = sse_event_store.add_event(thread_id, event)
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
