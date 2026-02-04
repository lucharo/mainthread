"""SendToThread tool for sending follow-up messages to existing threads."""

from typing import Any

from claude_agent_sdk import tool

from mainthread.agents.registry import get_registry


def create_send_to_thread_tool(source_thread_id: str):
    """Create the SendToThread tool for sending follow-up messages.

    Args:
        source_thread_id: ID of the thread making the request (for rate limiting)
    """

    @tool(
        "SendToThread",
        "Send a follow-up message to an existing thread. Use this to ask additional questions "
        "or provide more context to a sub-thread that's already running. The message is sent "
        "asynchronously - you don't wait for a response. The thread will process it and notify "
        "you when complete. NOTE: You can only send to child threads (sub-threads you spawned).",
        {"thread_id": str, "message": str},
    )
    async def send_to_thread(args: dict[str, Any]) -> dict[str, Any]:
        registry = get_registry()

        if not registry.send_to_thread:
            return {
                "content": [{"type": "text", "text": "Error: SendToThread not available"}],
                "is_error": True,
            }

        # Check rate limit (thread-safe)
        allowed, error_msg = await registry.check_rate_limit(source_thread_id)
        if not allowed:
            return {
                "content": [{"type": "text", "text": f"Error: {error_msg}"}],
                "is_error": True,
            }

        thread_id = args.get("thread_id", "")
        message = args.get("message", "")

        if not thread_id or not message:
            return {
                "content": [{"type": "text", "text": "Error: thread_id and message are required"}],
                "is_error": True,
            }

        try:
            result = await registry.send_to_thread(thread_id, message, source_thread_id)

            if result is None:
                return {
                    "content": [
                        {"type": "text", "text": f"Error: Thread {thread_id} not found or not a child thread"}
                    ],
                    "is_error": True,
                }

            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"Message sent to thread '{result.get('title', thread_id)}'. "
                        f"The thread will process your message and notify you when complete.",
                    }
                ]
            }
        except Exception as e:
            return {
                "content": [{"type": "text", "text": f"Error sending to thread: {e}"}],
                "is_error": True,
            }

    return send_to_thread
