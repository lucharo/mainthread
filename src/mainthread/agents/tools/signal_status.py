"""SignalStatus tool for sub-threads to signal completion."""

from typing import Any

from claude_agent_sdk import tool


def create_signal_status_tool():
    """Create the SignalStatus tool for sub-threads to signal completion status.

    This replaces the fragile [BLOCKED]/[DONE] text markers with a structured tool call.
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

        status_msg = "completed" if status == "done" else "blocked and needs attention"
        return {
            "content": [{"type": "text", "text": f"Status signaled: {status_msg}. Reason: {reason}"}]
        }

    return signal_status
