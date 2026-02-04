"""SignalStatus tool for sub-threads to signal completion."""

from typing import Any

from claude_agent_sdk import tool

from mainthread.agents.registry import get_registry


def create_signal_status_tool(parent_thread_id: str, child_thread_id: str):
    """Create the SignalStatus tool for sub-threads to signal completion status.

    Args:
        parent_thread_id: ID of the parent thread to notify
        child_thread_id: ID of this sub-thread (for identification in notifications)
    """

    @tool(
        "SignalStatus",
        "Signal your completion status to the parent thread. "
        "Call this when your task is complete (status='done') or when you are blocked "
        "and need human input (status='blocked'). Include a reason explaining the status.",
        {"status": str, "reason": str},
    )
    async def signal_status(args: dict[str, Any]) -> dict[str, Any]:
        status = args.get("status", "")
        reason = args.get("reason", "")

        if status not in ("done", "blocked"):
            return {
                "content": [
                    {"type": "text", "text": f"Invalid status '{status}'. Must be 'done' or 'blocked'."}
                ],
                "is_error": True,
            }

        # Actually notify the parent thread via registry
        registry = get_registry()
        if not registry.broadcast_status_signal:
            return {
                "content": [
                    {"type": "text", "text": "Warning: No broadcast mechanism available, parent thread was NOT notified. Status signal may not work correctly."}
                ],
                "is_error": True,
            }

        try:
            await registry.broadcast_status_signal(
                parent_thread_id, child_thread_id, status, reason
            )
        except Exception as e:
            return {
                "content": [
                    {"type": "text", "text": f"Failed to signal parent: {e}"}
                ],
                "is_error": True,
            }

        status_msg = "completed" if status == "done" else "blocked and needs attention"
        return {
            "content": [{"type": "text", "text": f"Status signaled: {status_msg}. Reason: {reason}"}]
        }

    return signal_status
