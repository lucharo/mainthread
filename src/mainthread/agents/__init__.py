"""Agent module for MainThread.

This module provides the Claude Agent SDK integration including:
- Service registry for cross-module communication
- Tool factories for agent capabilities
- Core agent execution logic

Architecture:
    server.py
        ↓ registers services
    registry.py (ServiceRegistry singleton)
        ↑ tools query for services
    tools/*.py (SpawnThread, ListThreads, etc.)
        ↑ used by
    core.py (run_agent)
"""

# Re-export everything for backward compatibility
from mainthread.agents.core import (
    AgentMessage,
    AgentResult,
    build_system_prompt,
    determine_status,
    run_agent,
    run_agent_simple,
)
from mainthread.agents.registry import (
    ServiceRegistry,
    get_registry,
    reset_registry,
)
from mainthread.agents.tools import (
    create_archive_thread_tool,
    create_list_threads_tool,
    create_read_thread_tool,
    create_send_to_thread_tool,
    create_signal_status_tool,
    create_spawn_thread_tool,
)

# Legacy callback registration functions (for backward compatibility with server.py)
# These now wrap the service registry


def register_create_thread_callback(callback) -> None:
    """Register the callback for creating threads."""
    get_registry().create_thread = callback


def register_broadcast_question_callback(callback) -> None:
    """Register the callback for broadcasting questions."""
    get_registry().broadcast_question = callback


def register_list_threads_callback(callback) -> None:
    """Register the callback for listing threads."""
    get_registry().list_threads = callback


def register_archive_thread_callback(callback) -> None:
    """Register the callback for archiving threads."""
    get_registry().archive_thread = callback


def register_run_thread_callback(callback) -> None:
    """Register the callback for running threads."""
    get_registry().run_thread = callback


def register_read_thread_callback(callback) -> None:
    """Register the callback for reading threads."""
    get_registry().read_thread = callback


def register_broadcast_subagent_stop_callback(callback) -> None:
    """Register the callback for SubagentStop events."""
    get_registry().broadcast_subagent_stop = callback


def register_broadcast_plan_approval_callback(callback) -> None:
    """Register the callback for plan approval events."""
    get_registry().broadcast_plan_approval = callback


def register_send_to_thread_callback(callback) -> None:
    """Register the callback for SendToThread."""
    get_registry().send_to_thread = callback


def register_broadcast_status_signal_callback(callback) -> None:
    """Register the callback for SignalStatus broadcasts to parent threads."""
    get_registry().broadcast_status_signal = callback


def reset_agent_state() -> None:
    """Reset agent state for hot reload."""
    reset_registry()


async def set_pending_answer(thread_id: str, answers: dict[str, str]) -> None:
    """Set the answer for a pending question."""
    await get_registry().set_pending_answer(thread_id, answers)


async def clear_pending_question(thread_id: str) -> None:
    """Clear any pending question for a thread."""
    await get_registry().clear_pending_question(thread_id)


__all__ = [
    # Core
    "AgentMessage",
    "AgentResult",
    "build_system_prompt",
    "determine_status",
    "run_agent",
    "run_agent_simple",
    # Registry
    "ServiceRegistry",
    "get_registry",
    "reset_registry",
    # Tools
    "create_archive_thread_tool",
    "create_list_threads_tool",
    "create_read_thread_tool",
    "create_send_to_thread_tool",
    "create_signal_status_tool",
    "create_spawn_thread_tool",
    # Legacy compatibility
    "register_create_thread_callback",
    "register_broadcast_question_callback",
    "register_list_threads_callback",
    "register_archive_thread_callback",
    "register_run_thread_callback",
    "register_read_thread_callback",
    "register_broadcast_subagent_stop_callback",
    "register_broadcast_plan_approval_callback",
    "register_send_to_thread_callback",
    "register_broadcast_status_signal_callback",
    "reset_agent_state",
    "set_pending_answer",
    "clear_pending_question",
]
