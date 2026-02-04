"""ReadThread tool for reading thread conversation history."""

from typing import Any

from claude_agent_sdk import tool

from mainthread.agents.registry import get_registry


def create_read_thread_tool():
    """Create the ReadThread tool to read any thread's conversation history."""

    @tool(
        "ReadThread",
        "Read a thread's conversation history to understand context or review results. "
        "Use this AFTER receiving a notification that a sub-thread completed, to see the detailed results. "
        "NOTE: You do NOT need to poll sub-threads - they automatically notify when done or blocked. "
        "Parameters: thread_id (required), limit (optional, default 200, max 1000 - number of recent messages to retrieve).",
        {"thread_id": str, "limit": int},
    )
    async def read_thread(args: dict[str, Any]) -> dict[str, Any]:
        registry = get_registry()

        if not registry.read_thread:
            return {
                "content": [{"type": "text", "text": "Error: Thread reading not available"}],
                "is_error": True,
            }

        try:
            thread_id = args["thread_id"]
            limit = args.get("limit", 200)
            result = await registry.read_thread(thread_id, limit)

            if result is None:
                return {
                    "content": [{"type": "text", "text": f"Thread {thread_id} not found."}],
                    "is_error": True,
                }

            return {"content": [{"type": "text", "text": result["formatted"]}]}
        except Exception as e:
            return {
                "content": [{"type": "text", "text": f"Failed to read thread: {e}"}],
                "is_error": True,
            }

    return read_thread
