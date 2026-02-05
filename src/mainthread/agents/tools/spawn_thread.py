"""SpawnThread tool for creating sub-threads."""

import asyncio
import logging
from typing import Any

from claude_agent_sdk import tool

from mainthread.agents.registry import get_registry

logger = logging.getLogger(__name__)


def create_spawn_thread_tool(
    parent_thread_id: str,
    parent_model: str = "claude-opus-4-5",
    parent_permission_mode: str = "acceptEdits",
    parent_extended_thinking: bool = True,
):
    """Create the SpawnThread tool for a specific parent thread.

    Args:
        parent_thread_id: ID of the parent thread that will spawn sub-threads
        parent_model: Model of the parent thread (inherited if not specified)
        parent_permission_mode: Permission mode of the parent thread (inherited if not specified)
        parent_extended_thinking: Extended thinking setting of parent (inherited if not specified)
    """

    @tool(
        "SpawnThread",
        "Create a new sub-thread for a specific task. Use this to delegate work to a separate agent context. "
        "If initial_message is provided, the sub-thread will start processing immediately. "
        "IMPORTANT: Sub-threads automatically notify the parent when they complete (status='done') or need attention "
        "(status='needs_attention'). You do NOT need to poll or repeatedly check sub-thread status - just continue "
        "other work and you will be notified when the sub-thread finishes.\n\n"
        "Optional configuration (inherits from parent if not specified):\n"
        "- model: 'claude-sonnet-4-5', 'claude-opus-4-5', or 'claude-haiku-4-5'\n"
        "- permission_mode: 'default', 'acceptEdits', 'bypassPermissions', or 'plan'\n"
        "- extended_thinking: true/false for extended thinking mode",
        {
            "title": str,
            "work_dir": str,
            "initial_message": str,
            "model": str,
            "permission_mode": str,
            "extended_thinking": bool,
        },
    )
    async def spawn_thread(args: dict[str, Any]) -> dict[str, Any]:
        registry = get_registry()

        if not registry.create_thread:
            return {
                "content": [{"type": "text", "text": "Error: Thread creation not available"}],
                "is_error": True,
            }

        # Valid options for validation
        VALID_MODELS = {"claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5"}
        VALID_PERMISSION_MODES = {"default", "acceptEdits", "bypassPermissions", "plan"}

        # Use provided values or inherit from parent (explicit key check for booleans)
        model = args["model"] if "model" in args and args["model"] else parent_model
        permission_mode = args["permission_mode"] if "permission_mode" in args and args["permission_mode"] else parent_permission_mode
        extended_thinking = args["extended_thinking"] if "extended_thinking" in args else parent_extended_thinking

        # Validate model
        if model not in VALID_MODELS:
            return {
                "content": [{"type": "text", "text": f"Invalid model '{model}'. Must be one of: {', '.join(sorted(VALID_MODELS))}"}],
                "is_error": True,
            }

        # Validate permission mode
        if permission_mode not in VALID_PERMISSION_MODES:
            return {
                "content": [{"type": "text", "text": f"Invalid permission_mode '{permission_mode}'. Must be one of: {', '.join(sorted(VALID_PERMISSION_MODES))}"}],
                "is_error": True,
            }

        try:
            initial_message = args.get("initial_message")

            new_thread = await registry.create_thread(
                title=args["title"],
                parent_id=parent_thread_id,
                work_dir=args.get("work_dir"),
                model=model,
                permission_mode=permission_mode,
                extended_thinking=extended_thinking,
                initial_message=initial_message,  # Added BEFORE broadcast to fix race condition
            )

            # Build worktree status message
            worktree_info = new_thread.get("_worktree_info", {})
            worktree_msg = ""
            if worktree_info.get("success"):
                branch = new_thread.get("worktreeBranch", "unknown")
                worktree_msg = f" Created in isolated worktree on branch `{branch}`."
            elif worktree_info.get("error"):
                worktree_msg = f" (Worktree creation skipped: {worktree_info['error']})"

            if initial_message:
                if registry.run_thread:
                    # Fire-and-forget: start the sub-thread in background
                    # Yield to event loop (frontend uses lastEventId='0' for replay)
                    async def delayed_run():
                        await asyncio.sleep(0)
                        # Skip adding message since we already added it above
                        await registry.run_thread(new_thread["id"], initial_message, skip_add_message=True)

                    task = asyncio.create_task(delayed_run())
                    task.add_done_callback(
                        lambda t: logger.error(f"SpawnThread background task failed: {t.exception()}")
                        if t.exception() else None
                    )
                # Include thread_id in JSON format at end of text for server to parse
                return {
                    "content": [
                        {
                            "type": "text",
                            "text": f"Created and started sub-thread '{args['title']}' (ID: {new_thread['id']}).{worktree_msg} "
                            f"Initial message: \"{initial_message[:100]}{'...' if len(initial_message) > 100 else ''}\". "
                            f"The sub-thread is now running in parallel and will notify you when complete or blocked."
                            f"\n<!--SPAWN_DATA:{new_thread['id']}-->",
                        }
                    ],
                }

            # Include thread_id in JSON format at end of text for server to parse
            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"Created sub-thread '{args['title']}' (ID: {new_thread['id']}).{worktree_msg} "
                        f"The sub-thread is ready but not started. Open the thread to interact with it, "
                        f"or use SpawnThread with initial_message to start it immediately. "
                        f"You will be notified automatically when the sub-thread completes or needs attention."
                        f"\n<!--SPAWN_DATA:{new_thread['id']}-->",
                    }
                ],
            }
        except Exception as e:
            return {
                "content": [{"type": "text", "text": f"Failed to create thread: {e}"}],
                "is_error": True,
            }

    return spawn_thread
