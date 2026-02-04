"""Service registry for cross-module communication.

Replaces the callback pattern with a centralized registry that tools
can query for services they need.
"""

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class ServiceRegistry:
    """Central registry for services used by agent tools.

    Instead of registering callbacks at module load time, tools
    query this registry for the services they need. This makes
    dependencies explicit and testable.
    """

    # Thread operations
    create_thread: Callable[..., Awaitable[dict[str, Any]]] | None = None
    list_threads: Callable[[], Awaitable[list[dict[str, Any]]]] | None = None
    archive_thread: Callable[[str], Awaitable[bool]] | None = None
    read_thread: Callable[[str, int], Awaitable[dict[str, Any] | None]] | None = None
    run_thread: Callable[[str, str], Awaitable[None]] | None = None
    send_to_thread: Callable[[str, str, str], Awaitable[dict[str, Any] | None]] | None = None

    # Broadcasting
    broadcast_question: Callable[[str, dict[str, Any]], Awaitable[None]] | None = None
    broadcast_subagent_stop: Callable[[str, dict[str, Any]], Awaitable[None]] | None = None
    broadcast_plan_approval: Callable[[str, dict[str, Any]], Awaitable[None]] | None = None
    broadcast_status_signal: Callable[[str, str, str, str], Awaitable[None]] | None = None  # parent_id, child_id, status, reason

    # Question handling state
    _pending_questions: dict[str, tuple[asyncio.Event, dict[str, str] | None]] = field(
        default_factory=dict
    )
    _pending_questions_lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    # Rate limiting for SendToThread
    _message_timestamps: dict[str, list[float]] = field(default_factory=dict)
    _rate_limit_lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    # Rate limit config
    message_rate_limit: int = 5  # Max messages per minute per source thread
    message_window: float = 60.0  # Window in seconds

    def reset(self) -> None:
        """Reset all state for hot reload compatibility."""
        self._pending_questions = {}
        self._pending_questions_lock = asyncio.Lock()
        self._message_timestamps = {}
        self._rate_limit_lock = asyncio.Lock()
        logger.info("Service registry state reset for new event loop")

    async def set_pending_answer(self, thread_id: str, answers: dict[str, str]) -> None:
        """Set the answer for a pending question (thread-safe)."""
        async with self._pending_questions_lock:
            if thread_id in self._pending_questions:
                event, _ = self._pending_questions[thread_id]
                self._pending_questions[thread_id] = (event, answers)
                event.set()
            else:
                logger.warning(f"Answer submitted for thread {thread_id} but no question pending")

    async def clear_pending_question(self, thread_id: str) -> None:
        """Clear any pending question for a thread (used during archive cleanup)."""
        async with self._pending_questions_lock:
            if thread_id in self._pending_questions:
                event, _ = self._pending_questions[thread_id]
                self._pending_questions[thread_id] = (event, None)
                event.set()
                del self._pending_questions[thread_id]
                logger.info(f"Cleared pending question for thread {thread_id}")

    async def wait_for_answer(
        self, thread_id: str, timeout: float = 300.0
    ) -> dict[str, str] | None:
        """Wait for user to answer a question (thread-safe)."""
        event = asyncio.Event()
        async with self._pending_questions_lock:
            self._pending_questions[thread_id] = (event, None)
        try:
            await asyncio.wait_for(event.wait(), timeout=timeout)
            async with self._pending_questions_lock:
                _, answers = self._pending_questions.get(thread_id, (None, None))
                return answers
        except TimeoutError:
            return None
        finally:
            async with self._pending_questions_lock:
                self._pending_questions.pop(thread_id, None)

    async def check_rate_limit(self, source_thread_id: str) -> tuple[bool, str]:
        """Check if rate limit allows sending (thread-safe). Returns (allowed, message)."""
        async with self._rate_limit_lock:
            now = time.time()

            # Clean up old timestamps
            if source_thread_id in self._message_timestamps:
                self._message_timestamps[source_thread_id] = [
                    ts
                    for ts in self._message_timestamps[source_thread_id]
                    if now - ts < self.message_window
                ]
            else:
                self._message_timestamps[source_thread_id] = []

            # Check rate limit
            if len(self._message_timestamps[source_thread_id]) >= self.message_rate_limit:
                return False, f"Rate limit exceeded: max {self.message_rate_limit} messages per minute"

            # Record this message
            self._message_timestamps[source_thread_id].append(now)
            return True, ""


# Global singleton instance
_registry: ServiceRegistry | None = None


def get_registry() -> ServiceRegistry:
    """Get the global service registry instance."""
    global _registry
    if _registry is None:
        _registry = ServiceRegistry()
    return _registry


def reset_registry() -> None:
    """Reset the global registry state (for hot reload)."""
    global _registry
    if _registry is not None:
        _registry.reset()
    else:
        _registry = ServiceRegistry()
