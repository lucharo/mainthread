"""SQLite database operations for MainThread."""

import os
import shutil
import sqlite3
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


def _get_db_path() -> Path:
    """Get the database path, migrating from old location if needed.

    Default location: ~/.mainthread/mainthread.db
    Can be overridden with DATABASE_PATH environment variable.
    """
    # Check for explicit override first
    env_path = os.getenv("DATABASE_PATH")
    if env_path:
        return Path(env_path)

    # Default to ~/.mainthread/mainthread.db
    default_dir = Path.home() / ".mainthread"
    default_path = default_dir / "mainthread.db"

    # Check for old location (package directory) and migrate if needed
    old_path = Path(__file__).parent / "mainthread.db"

    if old_path.exists() and not default_path.exists():
        # Migrate from old location to new location
        default_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(old_path, default_path)
        # Remove old database after successful migration
        old_path.unlink()

    # Ensure the directory exists
    default_dir.mkdir(parents=True, exist_ok=True)

    return default_path


DB_PATH = _get_db_path()

VALID_ROLES = {"user", "assistant", "system"}
VALID_STATUSES = {"active", "pending", "running", "needs_attention", "done", "new_message"}


@contextmanager
def get_db() -> Iterator[sqlite3.Connection]:
    """Get a database connection with proper cleanup."""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_database() -> None:
    """Initialize database schema."""
    with get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS threads (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                status TEXT DEFAULT 'active',
                parent_id TEXT,
                work_dir TEXT,
                session_id TEXT,
                model TEXT DEFAULT 'claude-opus-4-5',
                extended_thinking INTEGER DEFAULT 1,
                plan_mode INTEGER DEFAULT 1,
                git_branch TEXT,
                git_repo TEXT,
                is_worktree INTEGER DEFAULT 0,
                archived_at TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                thread_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                content_blocks TEXT,
                timestamp TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
            CREATE INDEX IF NOT EXISTS idx_threads_parent ON threads(parent_id);

            CREATE TABLE IF NOT EXISTS events (
                seq_id INTEGER PRIMARY KEY AUTOINCREMENT,
                thread_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                data TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_events_thread_seq ON events(thread_id, seq_id);
        """)

        # Migration: Add content_blocks column if it doesn't exist
        cursor = conn.execute("PRAGMA table_info(messages)")
        columns = [row[1] for row in cursor.fetchall()]
        if "content_blocks" not in columns:
            conn.execute("ALTER TABLE messages ADD COLUMN content_blocks TEXT")

        # Migration: Add permission_mode column and migrate from plan_mode
        cursor = conn.execute("PRAGMA table_info(threads)")
        thread_columns = [row[1] for row in cursor.fetchall()]
        if "permission_mode" not in thread_columns:
            conn.execute("ALTER TABLE threads ADD COLUMN permission_mode TEXT DEFAULT 'acceptEdits'")
            # Migrate existing plan_mode values: plan_mode=1 -> 'plan', plan_mode=0 -> 'acceptEdits'
            conn.execute("""
                UPDATE threads SET permission_mode = CASE
                    WHEN plan_mode = 1 THEN 'plan'
                    ELSE 'acceptEdits'
                END
            """)

        # Migration: Add auto_react column (defaults to enabled)
        cursor = conn.execute("PRAGMA table_info(threads)")
        thread_columns = [row[1] for row in cursor.fetchall()]
        if "auto_react" not in thread_columns:
            conn.execute("ALTER TABLE threads ADD COLUMN auto_react INTEGER DEFAULT 1")

        # Migration: Add worktree_branch column for git worktree tracking
        cursor = conn.execute("PRAGMA table_info(threads)")
        thread_columns = [row[1] for row in cursor.fetchall()]
        if "worktree_branch" not in thread_columns:
            conn.execute("ALTER TABLE threads ADD COLUMN worktree_branch TEXT")

        # Migration: Add token usage columns for tracking costs
        cursor = conn.execute("PRAGMA table_info(threads)")
        thread_columns = [row[1] for row in cursor.fetchall()]
        if "input_tokens" not in thread_columns:
            conn.execute("ALTER TABLE threads ADD COLUMN input_tokens INTEGER DEFAULT 0")
        if "output_tokens" not in thread_columns:
            conn.execute("ALTER TABLE threads ADD COLUMN output_tokens INTEGER DEFAULT 0")
        if "total_cost_usd" not in thread_columns:
            conn.execute("ALTER TABLE threads ADD COLUMN total_cost_usd REAL DEFAULT 0.0")

        # Migration: Add is_ephemeral column for Task threads
        cursor = conn.execute("PRAGMA table_info(threads)")
        thread_columns = [row[1] for row in cursor.fetchall()]
        if "is_ephemeral" not in thread_columns:
            conn.execute("ALTER TABLE threads ADD COLUMN is_ephemeral INTEGER DEFAULT 0")

        # Migration: Add per-thread nesting settings
        cursor = conn.execute("PRAGMA table_info(threads)")
        thread_columns = [row[1] for row in cursor.fetchall()]
        if "allow_nested_subthreads" not in thread_columns:
            conn.execute("ALTER TABLE threads ADD COLUMN allow_nested_subthreads INTEGER DEFAULT 0")
        if "max_thread_depth" not in thread_columns:
            conn.execute("ALTER TABLE threads ADD COLUMN max_thread_depth INTEGER DEFAULT 1")


def _format_thread(row: dict[str, Any], messages: list[dict[str, Any]]) -> dict[str, Any]:
    """Format thread row to match frontend expectations."""
    # Get permission mode, with backward compatibility for plan_mode
    permission_mode = row.get("permission_mode")
    if not permission_mode:
        permission_mode = "plan" if row.get("plan_mode", 1) else "acceptEdits"

    return {
        "id": row["id"],
        "title": row["title"],
        "status": row["status"],
        "parentId": row["parent_id"],
        "workDir": row["work_dir"],
        "sessionId": row["session_id"],
        "model": row.get("model", "claude-opus-4-5"),
        "extendedThinking": bool(row.get("extended_thinking", 1)),
        "permissionMode": permission_mode,
        "autoReact": bool(row.get("auto_react", 1)),
        "gitBranch": row.get("git_branch"),
        "gitRepo": row.get("git_repo"),
        "isWorktree": bool(row.get("is_worktree", 0)),
        "worktreeBranch": row.get("worktree_branch"),
        "isEphemeral": bool(row.get("is_ephemeral", 0)),
        "allowNestedSubthreads": bool(row.get("allow_nested_subthreads", 0)),
        "maxThreadDepth": row.get("max_thread_depth", 1) or 1,
        "inputTokens": row.get("input_tokens", 0) or 0,
        "outputTokens": row.get("output_tokens", 0) or 0,
        "totalCostUsd": row.get("total_cost_usd", 0.0) or 0.0,
        "archivedAt": row.get("archived_at"),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "messages": messages,
    }


def get_all_threads(include_archived: bool = False) -> list[dict[str, Any]]:
    """Get all threads with their messages using a single query."""
    with get_db() as conn:
        # Fetch all threads and messages in one go to avoid N+1
        where_clause = "" if include_archived else "WHERE t.archived_at IS NULL"
        cursor = conn.execute(f"""
            SELECT
                t.id, t.title, t.status, t.parent_id, t.work_dir,
                t.session_id, t.model, t.extended_thinking, t.plan_mode, t.permission_mode,
                t.auto_react, t.git_branch, t.git_repo, t.is_worktree, t.worktree_branch,
                t.is_ephemeral, t.allow_nested_subthreads, t.max_thread_depth,
                t.input_tokens, t.output_tokens, t.total_cost_usd,
                t.archived_at, t.created_at, t.updated_at,
                m.id as msg_id, m.role, m.content, m.content_blocks, m.timestamp as msg_timestamp
            FROM threads t
            LEFT JOIN messages m ON t.id = m.thread_id
            {where_clause}
            ORDER BY t.created_at DESC, m.timestamp ASC
        """)
        rows = cursor.fetchall()

        # Group messages by thread
        threads_map: dict[str, dict[str, Any]] = {}
        for row in rows:
            row_dict = dict(row)
            thread_id = row_dict["id"]

            if thread_id not in threads_map:
                threads_map[thread_id] = {
                    "id": row_dict["id"],
                    "title": row_dict["title"],
                    "status": row_dict["status"],
                    "parent_id": row_dict["parent_id"],
                    "work_dir": row_dict["work_dir"],
                    "session_id": row_dict["session_id"],
                    "model": row_dict.get("model", "claude-opus-4-5"),
                    "extended_thinking": row_dict.get("extended_thinking", 1),
                    "plan_mode": row_dict.get("plan_mode", 1),
                    "permission_mode": row_dict.get("permission_mode"),
                    "auto_react": row_dict.get("auto_react", 1),
                    "git_branch": row_dict.get("git_branch"),
                    "git_repo": row_dict.get("git_repo"),
                    "is_worktree": row_dict.get("is_worktree", 0),
                    "worktree_branch": row_dict.get("worktree_branch"),
                    "is_ephemeral": row_dict.get("is_ephemeral", 0),
                    "allow_nested_subthreads": row_dict.get("allow_nested_subthreads", 0),
                    "max_thread_depth": row_dict.get("max_thread_depth", 1),
                    "input_tokens": row_dict.get("input_tokens", 0),
                    "output_tokens": row_dict.get("output_tokens", 0),
                    "total_cost_usd": row_dict.get("total_cost_usd", 0.0),
                    "archived_at": row_dict.get("archived_at"),
                    "created_at": row_dict["created_at"],
                    "updated_at": row_dict["updated_at"],
                    "messages": [],
                }

            # Add message if it exists (LEFT JOIN may produce null message rows)
            if row_dict["msg_id"]:
                threads_map[thread_id]["messages"].append({
                    "id": row_dict["msg_id"],
                    "thread_id": thread_id,
                    "role": row_dict["role"],
                    "content": row_dict["content"],
                    "content_blocks": row_dict.get("content_blocks"),
                    "timestamp": row_dict["msg_timestamp"],
                })

        return [
            _format_thread(t, t["messages"])
            for t in threads_map.values()
        ]


def get_thread(thread_id: str) -> dict[str, Any] | None:
    """Get a single thread by ID."""
    with get_db() as conn:
        cursor = conn.execute("SELECT * FROM threads WHERE id = ?", (thread_id,))
        row = cursor.fetchone()
        if row is None:
            return None

        messages = get_messages_by_thread_internal(conn, thread_id)
        return _format_thread(dict(row), messages)


def get_thread_depth(thread_id: str) -> int:
    """Calculate the depth of a thread in the hierarchy.

    Returns:
        0 for main threads (no parent)
        1 for direct sub-threads
        2+ for nested sub-threads
    """
    depth = 0
    current_id = thread_id

    with get_db() as conn:
        while True:
            cursor = conn.execute(
                "SELECT parent_id FROM threads WHERE id = ?", (current_id,)
            )
            row = cursor.fetchone()
            if row is None or row["parent_id"] is None:
                break
            depth += 1
            current_id = row["parent_id"]
            # Safety limit to prevent infinite loops
            if depth > 10:
                break

    return depth


def get_messages_by_thread_internal(
    conn: sqlite3.Connection, thread_id: str
) -> list[dict[str, Any]]:
    """Get all messages for a thread (internal, uses existing connection)."""
    cursor = conn.execute(
        "SELECT * FROM messages WHERE thread_id = ? ORDER BY timestamp ASC",
        (thread_id,),
    )
    return [dict(row) for row in cursor.fetchall()]


VALID_PERMISSION_MODES = {"default", "acceptEdits", "bypassPermissions", "plan"}


def create_thread(
    title: str,
    parent_id: str | None = None,
    work_dir: str | None = None,
    model: str = "claude-opus-4-5",
    extended_thinking: bool = True,
    permission_mode: str = "acceptEdits",
    git_branch: str | None = None,
    git_repo: str | None = None,
    is_worktree: bool = False,
    worktree_branch: str | None = None,
    allow_nested_subthreads: bool = False,
    max_thread_depth: int = 1,
) -> dict[str, Any]:
    """Create a new thread."""
    if not title or len(title) > 255:
        raise ValueError("Title must be between 1 and 255 characters")
    if permission_mode not in VALID_PERMISSION_MODES:
        raise ValueError(f"Invalid permission mode: {permission_mode}. Must be one of {VALID_PERMISSION_MODES}")

    thread_id = str(uuid.uuid4())
    now = datetime.now().isoformat()

    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO threads (id, title, parent_id, work_dir, model, extended_thinking,
                                 permission_mode, git_branch, git_repo, is_worktree, worktree_branch,
                                 allow_nested_subthreads, max_thread_depth,
                                 created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (thread_id, title, parent_id, work_dir, model, int(extended_thinking),
             permission_mode, git_branch, git_repo, int(is_worktree), worktree_branch,
             int(allow_nested_subthreads), max_thread_depth, now, now),
        )

    thread = get_thread(thread_id)
    if thread is None:
        raise RuntimeError(f"Failed to create thread {thread_id}")
    return thread


def update_thread_status(thread_id: str, status: str) -> None:
    """Update a thread's status."""
    if status not in VALID_STATUSES:
        raise ValueError(f"Invalid status: {status}. Must be one of {VALID_STATUSES}")

    now = datetime.now().isoformat()
    with get_db() as conn:
        conn.execute(
            "UPDATE threads SET status = ?, updated_at = ? WHERE id = ?",
            (status, now, thread_id),
        )


def update_thread_session(thread_id: str, session_id: str) -> None:
    """Update a thread's session ID for resumption."""
    now = datetime.now().isoformat()
    with get_db() as conn:
        conn.execute(
            "UPDATE threads SET session_id = ?, updated_at = ? WHERE id = ?",
            (session_id, now, thread_id),
        )


def update_thread_config(
    thread_id: str,
    model: str | None = None,
    extended_thinking: bool | None = None,
    permission_mode: str | None = None,
    auto_react: bool | None = None,
) -> None:
    """Update a thread's configuration (model, thinking mode, permission mode, auto-react)."""
    now = datetime.now().isoformat()
    updates = ["updated_at = ?"]
    params: list[Any] = [now]

    if model is not None:
        updates.append("model = ?")
        params.append(model)
    if extended_thinking is not None:
        updates.append("extended_thinking = ?")
        params.append(int(extended_thinking))
    if permission_mode is not None:
        if permission_mode not in VALID_PERMISSION_MODES:
            raise ValueError(f"Invalid permission mode: {permission_mode}")
        updates.append("permission_mode = ?")
        params.append(permission_mode)
    if auto_react is not None:
        updates.append("auto_react = ?")
        params.append(int(auto_react))

    params.append(thread_id)

    with get_db() as conn:
        conn.execute(
            f"UPDATE threads SET {', '.join(updates)} WHERE id = ?",
            tuple(params),
        )


def get_messages_by_thread(thread_id: str) -> list[dict[str, Any]]:
    """Get all messages for a thread."""
    with get_db() as conn:
        return get_messages_by_thread_internal(conn, thread_id)


def get_messages_paginated(
    thread_id: str,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    """Get messages for a thread with pagination.

    Args:
        thread_id: The thread to get messages from
        limit: Maximum number of messages to return (default 50, max 100)
        offset: Number of messages to skip from the end (for loading older messages)

    Returns:
        Dict with messages, total count, and pagination info.
        Messages are returned in chronological order (oldest first).
    """
    # Validate and clamp limit
    limit = max(1, min(limit, 100))
    offset = max(0, offset)

    with get_db() as conn:
        # Get total count
        cursor = conn.execute(
            "SELECT COUNT(*) FROM messages WHERE thread_id = ?",
            (thread_id,),
        )
        total = cursor.fetchone()[0]

        # Calculate the actual offset from the start for chronological order
        # We want the most recent `limit` messages, offset from the end
        # If total=100, limit=50, offset=0 -> we want messages 50-99 (most recent 50)
        # If total=100, limit=50, offset=50 -> we want messages 0-49 (older 50)
        start_from = max(0, total - limit - offset)
        actual_limit = min(limit, total - start_from)

        if actual_limit <= 0:
            return {
                "messages": [],
                "total": total,
                "limit": limit,
                "offset": offset,
                "hasMore": False,
            }

        cursor = conn.execute(
            """
            SELECT * FROM messages
            WHERE thread_id = ?
            ORDER BY timestamp ASC
            LIMIT ? OFFSET ?
            """,
            (thread_id, actual_limit, start_from),
        )
        messages = [dict(row) for row in cursor.fetchall()]

        # There are more older messages if start_from > 0
        has_more = start_from > 0

        return {
            "messages": messages,
            "total": total,
            "limit": limit,
            "offset": offset,
            "hasMore": has_more,
        }


def add_message(
    thread_id: str,
    role: str,
    content: str,
    content_blocks: str | None = None,
) -> dict[str, Any]:
    """Add a message to a thread.

    Args:
        thread_id: The thread to add the message to
        role: Message role ('user' or 'assistant')
        content: Plain text content (for backward compatibility)
        content_blocks: JSON string of structured content blocks (for assistant messages)
    """
    if role not in VALID_ROLES:
        raise ValueError(f"Invalid role: {role}. Must be one of {VALID_ROLES}")

    if not content:
        raise ValueError("Content cannot be empty")

    message_id = str(uuid.uuid4())
    now = datetime.now().isoformat()

    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO messages (id, thread_id, role, content, content_blocks, timestamp)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (message_id, thread_id, role, content, content_blocks, now),
        )

        cursor = conn.execute("SELECT * FROM messages WHERE id = ?", (message_id,))
        row = cursor.fetchone()
        if row is None:
            raise RuntimeError(f"Failed to create message {message_id}")
        return dict(row)


def update_message(
    message_id: str,
    content: str,
    content_blocks: str | None = None,
) -> dict[str, Any] | None:
    """Update an existing message's content.

    Args:
        message_id: The message to update
        content: New plain text content
        content_blocks: New JSON string of structured content blocks

    Returns:
        Updated message dict or None if not found
    """
    with get_db() as conn:
        conn.execute(
            """
            UPDATE messages
            SET content = ?, content_blocks = ?
            WHERE id = ?
            """,
            (content, content_blocks, message_id),
        )
        cursor = conn.execute("SELECT * FROM messages WHERE id = ?", (message_id,))
        row = cursor.fetchone()
        return dict(row) if row else None


def delete_thread(thread_id: str) -> bool:
    """Delete a thread and its messages."""
    with get_db() as conn:
        cursor = conn.execute("DELETE FROM threads WHERE id = ?", (thread_id,))
        return cursor.rowcount > 0


def clear_thread_messages(thread_id: str) -> bool:
    """Clear all messages from a thread and reset session_id for fresh start."""
    now = datetime.now().isoformat()
    with get_db() as conn:
        # Delete all messages for this thread
        cursor = conn.execute("DELETE FROM messages WHERE thread_id = ?", (thread_id,))
        deleted_count = cursor.rowcount

        # Clear session_id to prevent resumption (starts fresh)
        conn.execute(
            "UPDATE threads SET session_id = NULL, updated_at = ? WHERE id = ?",
            (now, thread_id),
        )

        return deleted_count > 0


def archive_thread(thread_id: str) -> bool:
    """Archive a thread by setting archived_at timestamp."""
    now = datetime.now().isoformat()
    with get_db() as conn:
        cursor = conn.execute(
            "UPDATE threads SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL",
            (now, now, thread_id),
        )
        return cursor.rowcount > 0


def unarchive_thread(thread_id: str) -> bool:
    """Unarchive a thread by clearing archived_at timestamp."""
    now = datetime.now().isoformat()
    with get_db() as conn:
        cursor = conn.execute(
            "UPDATE threads SET archived_at = NULL, updated_at = ? WHERE id = ? AND archived_at IS NOT NULL",
            (now, thread_id),
        )
        return cursor.rowcount > 0


def reset_all_threads() -> int:
    """Delete all threads and messages. Returns count of deleted threads."""
    with get_db() as conn:
        # Messages are deleted via CASCADE, but let's be explicit
        conn.execute("DELETE FROM messages")
        cursor = conn.execute("DELETE FROM threads")
        return cursor.rowcount


MAX_MESSAGE_DISPLAY_LENGTH = 2000
MAX_THREAD_MESSAGES_LIMIT = 1000

# Token estimation constants
# Roughly 4 characters per token for English text (conservative estimate)
CHARS_PER_TOKEN = 4


def estimate_tokens(text: str) -> int:
    """Estimate token count for text using character-based approximation.

    Uses ~4 chars per token as a conservative estimate for English text.
    Claude's actual tokenization may vary, but this gives a reasonable ballpark.
    """
    if not text:
        return 0
    return len(text) // CHARS_PER_TOKEN


def estimate_thread_tokens(thread_id: str) -> dict[str, Any]:
    """Estimate token usage for a thread's conversation.

    Returns:
        Dict with total tokens, message breakdown, and context warnings.
    """
    messages = get_messages_by_thread(thread_id)

    total_tokens = 0
    user_tokens = 0
    assistant_tokens = 0
    system_tokens = 0

    for msg in messages:
        content = msg.get("content", "")
        content_blocks = msg.get("content_blocks")
        role = msg.get("role", "")

        # Estimate tokens for content
        tokens = estimate_tokens(content)

        # Add extra for content_blocks if present (they often contain more data)
        if content_blocks:
            tokens += estimate_tokens(content_blocks) // 2  # Partial count to avoid double-counting

        total_tokens += tokens

        if role == "user":
            user_tokens += tokens
        elif role == "assistant":
            assistant_tokens += tokens
        elif role == "system":
            system_tokens += tokens

    # Generate warnings based on token thresholds
    warnings = []
    if total_tokens > 100000:
        warnings.append("High context usage (>100K tokens) - consider compacting")
    elif total_tokens > 50000:
        warnings.append("Moderate context usage (>50K tokens)")

    return {
        "totalTokens": total_tokens,
        "userTokens": user_tokens,
        "assistantTokens": assistant_tokens,
        "systemTokens": system_tokens,
        "messageCount": len(messages),
        "warnings": warnings,
    }


def get_thread_messages_formatted(thread_id: str, limit: int = 50) -> dict[str, Any] | None:
    """Get a thread's messages formatted for agent consumption.

    Args:
        thread_id: The ID of the thread to read
        limit: Maximum number of recent messages to return (default 50, max 1000)

    Returns:
        Dict with thread metadata, formatted conversation, and message count,
        or None if the thread doesn't exist.
    """
    # Validate and clamp limit
    if limit <= 0:
        limit = 200
    elif limit > MAX_THREAD_MESSAGES_LIMIT:
        limit = MAX_THREAD_MESSAGES_LIMIT

    thread = get_thread(thread_id)
    if not thread:
        return None

    all_messages = thread.get("messages", [])
    total_count = len(all_messages)

    # Apply limit (most recent messages)
    messages = all_messages[-limit:] if total_count > limit else all_messages

    # Calculate time ago
    created_at = thread.get("createdAt", "")
    time_ago = _format_time_ago(created_at)

    # Format header - show actual/total when limited
    if len(messages) < total_count:
        msg_info = f"{len(messages)}/{total_count} (showing last {limit})"
    else:
        msg_info = str(total_count)

    header = f"""Thread: "{thread['title']}" (ID: {thread['id']})
Status: {thread['status']} | Messages: {msg_info} | Created: {time_ago}
"""

    # Format messages
    formatted_messages = []
    for msg in messages:
        role = msg.get("role", "unknown")
        content = msg.get("content", "")
        # Truncate very long messages for readability
        if len(content) > MAX_MESSAGE_DISPLAY_LENGTH:
            content = content[:MAX_MESSAGE_DISPLAY_LENGTH] + "... [truncated]"
        formatted_messages.append(f"[{role}] {content}")

    formatted = header + "\n" + "\n\n".join(formatted_messages)

    return {
        "thread": thread,
        "formatted": formatted,
        "message_count": len(messages),
    }


def _format_time_ago(iso_timestamp: str) -> str:
    """Format an ISO timestamp as a human-readable 'time ago' string.

    Handles both timezone-aware and naive timestamps consistently.
    """
    if not iso_timestamp:
        return "unknown"

    try:
        # Parse timestamp - handle both naive and UTC ('Z' suffix) timestamps
        created = datetime.fromisoformat(iso_timestamp.replace("Z", "+00:00"))

        # Use consistent comparison: if created has timezone, compare in UTC
        now = datetime.now(UTC) if created.tzinfo else datetime.now()

        delta = now - created
        seconds = delta.total_seconds()

        # Handle future timestamps gracefully
        if seconds < 0:
            return "just now"

        if seconds < 60:
            return "just now"
        elif seconds < 3600:
            mins = int(seconds / 60)
            return f"{mins}m ago"
        elif seconds < 86400:
            hours = int(seconds / 3600)
            return f"{hours}h ago"
        else:
            days = int(seconds / 86400)
            return f"{days}d ago"
    except (ValueError, TypeError):
        return "unknown"


def update_thread_title(thread_id: str, title: str) -> bool:
    """Update a thread's title.

    Args:
        thread_id: The thread to update
        title: New title (1-255 characters)

    Returns:
        True if thread was found and updated, False otherwise.

    Raises:
        ValueError: If title is invalid.
    """
    if not title or len(title) > 255:
        raise ValueError("Title must be between 1 and 255 characters")

    now = datetime.now().isoformat()
    with get_db() as conn:
        cursor = conn.execute(
            "UPDATE threads SET title = ?, updated_at = ? WHERE id = ?",
            (title, now, thread_id),
        )
        return cursor.rowcount > 0


def create_ephemeral_thread(
    thread_id: str,
    title: str,
    parent_id: str,
    work_dir: str | None = None,
) -> dict[str, Any]:
    """Create an ephemeral thread record for a Task subagent.

    These threads are read-only in the UI and represent background Task executions.

    Args:
        thread_id: Pre-generated thread ID (from tool_use_id or similar)
        title: Display title for the ephemeral thread
        parent_id: The parent thread that spawned this task
        work_dir: Working directory (inherited from parent if not specified)

    Returns:
        The created thread dict.
    """
    now = datetime.now().isoformat()

    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO threads (id, title, parent_id, work_dir, status, is_ephemeral,
                                 created_at, updated_at)
            VALUES (?, ?, ?, ?, 'pending', 1, ?, ?)
            """,
            (thread_id, title, parent_id, work_dir, now, now),
        )

    thread = get_thread(thread_id)
    if thread is None:
        raise RuntimeError(f"Failed to create ephemeral thread {thread_id}")
    return thread


def update_thread_usage(
    thread_id: str,
    input_tokens: int = 0,
    output_tokens: int = 0,
    total_cost_usd: float = 0.0,
) -> None:
    """Cumulatively add token usage to a thread's stored values.

    Args:
        thread_id: The thread to update
        input_tokens: Input tokens to add
        output_tokens: Output tokens to add
        total_cost_usd: Cost in USD to add
    """
    now = datetime.now().isoformat()
    with get_db() as conn:
        conn.execute(
            """
            UPDATE threads SET
                input_tokens = COALESCE(input_tokens, 0) + ?,
                output_tokens = COALESCE(output_tokens, 0) + ?,
                total_cost_usd = COALESCE(total_cost_usd, 0.0) + ?,
                updated_at = ?
            WHERE id = ?
            """,
            (input_tokens, output_tokens, total_cost_usd, now, thread_id),
        )


def get_thread_usage_with_children(thread_id: str) -> dict[str, Any]:
    """Get aggregated token usage for a thread including all child threads.

    Returns:
        Dict with own usage, children usage, and total.
    """
    with get_db() as conn:
        # Get own usage
        cursor = conn.execute(
            "SELECT input_tokens, output_tokens, total_cost_usd FROM threads WHERE id = ?",
            (thread_id,),
        )
        row = cursor.fetchone()
        if not row:
            return {
                "inputTokens": 0,
                "outputTokens": 0,
                "totalCostUsd": 0.0,
                "childrenInputTokens": 0,
                "childrenOutputTokens": 0,
                "childrenTotalCostUsd": 0.0,
            }

        own_input = row[0] or 0
        own_output = row[1] or 0
        own_cost = row[2] or 0.0

        # Get children usage
        cursor = conn.execute(
            """
            SELECT
                COALESCE(SUM(input_tokens), 0),
                COALESCE(SUM(output_tokens), 0),
                COALESCE(SUM(total_cost_usd), 0.0)
            FROM threads WHERE parent_id = ?
            """,
            (thread_id,),
        )
        child_row = cursor.fetchone()
        child_input = child_row[0] or 0
        child_output = child_row[1] or 0
        child_cost = child_row[2] or 0.0

        return {
            "inputTokens": own_input,
            "outputTokens": own_output,
            "totalCostUsd": own_cost,
            "childrenInputTokens": child_input,
            "childrenOutputTokens": child_output,
            "childrenTotalCostUsd": child_cost,
        }


def get_recent_work_dirs(limit: int = 5) -> list[str]:
    """Get unique working directories from recent threads.

    Args:
        limit: Maximum number of directories to return

    Returns:
        List of unique work directory paths, most recent first.
    """
    with get_db() as conn:
        cursor = conn.execute(
            """
            SELECT DISTINCT work_dir FROM threads
            WHERE work_dir IS NOT NULL AND work_dir != ''
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,),
        )
        return [row[0] for row in cursor.fetchall()]


# ---------------------------------------------------------------------------
# SSE Event persistence (replaces in-memory SSEEventStore)
# ---------------------------------------------------------------------------

def add_event(thread_id: str, event_type: str, data: str) -> int:
    """Persist an SSE event and return its sequence ID.

    Args:
        thread_id: The thread this event belongs to
        event_type: Event type (text_delta, thinking, tool_use, etc.)
        data: JSON-serialized event payload

    Returns:
        The auto-incremented seq_id for this event.
    """
    with get_db() as conn:
        cursor = conn.execute(
            "INSERT INTO events (thread_id, event_type, data) VALUES (?, ?, ?)",
            (thread_id, event_type, data),
        )
        return cursor.lastrowid  # type: ignore[return-value]


def get_events_since(thread_id: str, last_seq_id: int) -> list[dict[str, Any]]:
    """Get events after the given sequence ID for replay on reconnect.

    Returns events ordered by seq_id ascending, each with
    seq_id, thread_id, event_type, data (JSON string), created_at.
    """
    with get_db() as conn:
        cursor = conn.execute(
            """
            SELECT seq_id, thread_id, event_type, data, created_at
            FROM events
            WHERE thread_id = ? AND seq_id > ?
            ORDER BY seq_id ASC
            """,
            (thread_id, last_seq_id),
        )
        return [dict(row) for row in cursor.fetchall()]


def get_latest_seq_id(thread_id: str) -> int:
    """Get the latest sequence ID for a thread (0 if no events)."""
    with get_db() as conn:
        cursor = conn.execute(
            "SELECT MAX(seq_id) FROM events WHERE thread_id = ?",
            (thread_id,),
        )
        row = cursor.fetchone()
        return row[0] or 0


def clear_thread_events(thread_id: str) -> int:
    """Clear all events for a thread. Returns count of deleted events."""
    with get_db() as conn:
        cursor = conn.execute(
            "DELETE FROM events WHERE thread_id = ?",
            (thread_id,),
        )
        return cursor.rowcount


def cleanup_old_events(max_age_hours: int = 24) -> int:
    """Remove events older than max_age_hours. Returns count deleted.

    Called periodically to prevent the events table from growing unbounded.
    Events are only needed for SSE reconnection recovery, so keeping
    24 hours is more than sufficient.
    """
    with get_db() as conn:
        cursor = conn.execute(
            "DELETE FROM events WHERE created_at < datetime('now', ?)",
            (f"-{max_age_hours} hours",),
        )
        return cursor.rowcount


# Initialize database on module load
init_database()
