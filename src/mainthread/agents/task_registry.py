"""Track active agent tasks for cancellation.

This module provides a simple registry to track running asyncio tasks per thread,
allowing them to be cancelled when a user clicks the stop button.
"""

import asyncio
from dataclasses import dataclass

import logging

logger = logging.getLogger(__name__)


@dataclass
class ActiveTask:
    """Represents an active agent task for a thread."""
    task: asyncio.Task
    thread_id: str


# Registry of active tasks keyed by thread_id
_active_tasks: dict[str, ActiveTask] = {}


def register_task(thread_id: str, task: asyncio.Task) -> None:
    """Register a task for tracking.

    If an existing task is registered for this thread_id, cancel it first
    to avoid orphaned tasks.

    Args:
        thread_id: The thread ID this task belongs to
        task: The asyncio task to track
    """
    existing = _active_tasks.get(thread_id)
    if existing and not existing.task.done():
        existing.task.cancel()
        logger.info(f"Cancelled existing task for thread {thread_id} before registering new one")
    _active_tasks[thread_id] = ActiveTask(task=task, thread_id=thread_id)
    logger.debug(f"Registered task for thread {thread_id}")


def unregister_task(thread_id: str) -> None:
    """Unregister a task when it completes.

    Args:
        thread_id: The thread ID to unregister
    """
    if thread_id in _active_tasks:
        del _active_tasks[thread_id]
        logger.debug(f"Unregistered task for thread {thread_id}")


def stop_task(thread_id: str) -> bool:
    """Stop an active task for a thread.

    Args:
        thread_id: The thread ID whose task should be stopped

    Returns:
        True if a task was found and cancelled, False otherwise
    """
    active = _active_tasks.pop(thread_id, None)
    if active and not active.task.done():
        active.task.cancel()
        logger.info(f"Cancelled task for thread {thread_id}")
        return True
    return False


def has_active_task(thread_id: str) -> bool:
    """Check if a thread has an active task.

    Args:
        thread_id: The thread ID to check

    Returns:
        True if the thread has an active task, False otherwise
    """
    active = _active_tasks.get(thread_id)
    return active is not None and not active.task.done()


def clear_all_tasks() -> None:
    """Clear all tracked tasks (for hot reload/shutdown)."""
    _active_tasks.clear()
    logger.debug("Cleared all tracked tasks")
