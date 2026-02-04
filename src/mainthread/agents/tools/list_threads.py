"""ListThreads tool for viewing all threads."""

from typing import Any

from claude_agent_sdk import tool

from mainthread.agents.registry import get_registry


def create_list_threads_tool():
    """Create the ListThreads tool to see existing threads."""

    @tool(
        "ListThreads",
        "List all existing threads with their status. Use this to see what threads exist before creating new ones.",
        {},
    )
    async def list_threads(args: dict[str, Any]) -> dict[str, Any]:
        registry = get_registry()

        if not registry.list_threads:
            return {
                "content": [{"type": "text", "text": "Error: Thread listing not available"}],
                "is_error": True,
            }

        try:
            threads = await registry.list_threads()
            thread_info = []
            for t in threads:
                parent_info = (
                    f" (sub-thread of {t.get('parentId')})"
                    if t.get("parentId")
                    else " (main thread)"
                )
                status = t.get("status", "unknown")
                msg_count = len(t.get("messages", []))
                archived_info = f", Archived: {t['archived_at']}" if t.get("archived_at") else ""
                thread_info.append(
                    f"- {t['title']} (ID: {t['id']}){parent_info}\n"
                    f"  Status: {status}, Messages: {msg_count}{archived_info}"
                )

            if not thread_info:
                return {"content": [{"type": "text", "text": "No threads exist yet."}]}

            return {
                "content": [
                    {
                        "type": "text",
                        "text": "Existing threads:\n\n" + "\n".join(thread_info),
                    }
                ]
            }
        except Exception as e:
            return {
                "content": [{"type": "text", "text": f"Failed to list threads: {e}"}],
                "is_error": True,
            }

    return list_threads
