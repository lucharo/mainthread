"""ArchiveThread tool for archiving completed threads."""

from typing import Any

from claude_agent_sdk import tool

from mainthread.agents.registry import get_registry


def create_archive_thread_tool():
    """Create the ArchiveThread tool to archive sub-threads when done."""

    @tool(
        "ArchiveThread",
        "Archive a sub-thread after receiving its results. Use this when a delegated task is complete "
        "and you no longer need the thread visible in the active list.",
        {"thread_id": str},
    )
    async def archive_thread(args: dict[str, Any]) -> dict[str, Any]:
        registry = get_registry()

        if not registry.archive_thread:
            return {
                "content": [{"type": "text", "text": "Error: Thread archiving not available"}],
                "is_error": True,
            }

        try:
            thread_id = args["thread_id"]
            success = await registry.archive_thread(thread_id)
            if success:
                return {
                    "content": [
                        {
                            "type": "text",
                            "text": f"Archived thread {thread_id}. It can be restored later if needed.",
                        }
                    ]
                }
            else:
                return {
                    "content": [
                        {"type": "text", "text": f"Thread {thread_id} was already archived or not found."}
                    ],
                    "is_error": True,
                }
        except Exception as e:
            return {
                "content": [{"type": "text", "text": f"Failed to archive thread: {e}"}],
                "is_error": True,
            }

    return archive_thread
