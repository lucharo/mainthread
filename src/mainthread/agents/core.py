"""Core agent execution logic for MainThread.

This module contains the main agent execution loop and message handling.
"""

import json
import logging
import os
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from claude_agent_sdk import (
    ClaudeAgentOptions,
    ClaudeSDKClient,
    HookMatcher,
    create_sdk_mcp_server,
)
from claude_agent_sdk._errors import (
    CLIConnectionError,
    CLIJSONDecodeError,
    CLINotFoundError,
    ProcessError,
)
from claude_agent_sdk.types import (
    AssistantMessage,
    HookContext,
    HookJSONOutput,
    PermissionResultAllow,
    PermissionResultDeny,
    ResultMessage,
    StreamEvent,
    SystemMessage,
    TextBlock,
    ThinkingBlock,
    ToolResultBlock,
    ToolUseBlock,
)

from mainthread.agents.registry import get_registry
from mainthread.db import get_thread_depth
from mainthread.agents.tools import (
    create_archive_thread_tool,
    create_list_threads_tool,
    create_read_thread_tool,
    create_send_to_thread_tool,
    create_signal_status_tool,
    create_spawn_thread_tool,
)

logger = logging.getLogger(__name__)


@dataclass
class AgentMessage:
    """Message from the agent during execution.

    Attributes:
        type: Message type - "text", "tool_use", "tool_result", "status", "error",
              "thinking", "thinking_start", "usage"
        content: The message content
        metadata: Optional additional data (tool info, signatures, etc.)
    """

    type: str
    content: str
    metadata: dict[str, Any] | None = None


@dataclass
class AgentResult:
    """Final result from agent execution.

    Attributes:
        content: The full text response
        status: Thread status - "active", "needs_attention", "done"
        session_id: SDK session ID for resumption
    """

    content: str
    status: str
    session_id: str | None = None


def build_system_prompt(
    thread: dict[str, Any],
    include_compact_context: bool = False,
    conversation_summary: str | None = None,
) -> str:
    """Build system prompt based on thread context.

    The prompt varies based on whether this is a main thread (with delegation
    capabilities) or a sub-thread (with status signaling).

    Args:
        thread: The thread configuration dict
        include_compact_context: If True, includes additional context for post-compaction
        conversation_summary: Optional summary of previous conversation (for post-compaction)
    """
    prompt = f"""You are an AI assistant in the MainThread app.

You are in thread: "{thread['title']}" (ID: {thread['id']})
"""

    if thread.get("parentId"):
        # Sub-thread prompt: focused on task completion, status signaling, and delegation
        prompt += """
This is a SUB-THREAD spawned from a parent thread.
You have a specific task or context for this thread.

DELEGATION:
You can spawn your own sub-threads for parallel work using SpawnThread. This enables
hierarchical task decomposition - break complex tasks into independent sub-tasks.
You also have access to ListThreads, ReadThread, ArchiveThread, and SendToThread.

**CRITICAL - COMPLETION SIGNALING (REQUIRED):**
You MUST call SignalStatus when you finish your task. This is NOT optional.
- Call `SignalStatus(status="done", reason="<brief summary of what you accomplished>")` when complete
- Call `SignalStatus(status="blocked", reason="<what you need>")` if you need human input

Without calling SignalStatus, your parent thread will never know you finished and cannot
continue its work. ALWAYS end your work by calling SignalStatus.
"""
    else:
        # Main thread prompt: delegation and coordination capabilities
        prompt += """
This is the MAIN THREAD - the primary conversation with the human.

You have powerful tools for delegation and context awareness:
- SpawnThread: Create sub-threads for long-running parallel work
- ReadThread: Read any thread's conversation history (use after notifications)
- ListThreads: See all threads and their status
- ArchiveThread: Archive completed threads
- SendToThread: Send follow-up messages to existing child threads
- Task: Quick ephemeral work (Explore, Plan, or general-purpose agents)

IMPORTANT: Sub-threads automatically notify you when they complete (status='done') or need help
(status='needs_attention'). You do NOT need to poll or repeatedly check sub-threads - continue
other work and wait for notifications. Use ReadThread only AFTER receiving a notification to
review detailed results.

## Task Parallelization

When receiving complex tasks, actively look for parallelism opportunities:

1. **Identify orthogonal subtasks** - work that has no shared dependencies or state
2. **Spawn parallel threads** when you find 2+ independent tasks that can run simultaneously
3. **Plan sequentially** only when tasks have strict ordering requirements (e.g., B depends on A's output)

Examples of parallelizable work:
- **Full-stack apps**: Frontend + Backend + Database schema (independent layers)
- **Multi-component systems**: Separate services, modules, or packages
- **Research + Implementation**: Explore options in one thread while building in another
- **Tests + Docs**: Write tests/docs in parallel with feature work
- **Refactoring**: Independent files or modules can be refactored in parallel

When to use each tool:
- `SpawnThread`: Creates a VISIBLE thread in the UI. Use for substantial work that the user
  wants to monitor, interact with, or follow along. The user can send messages to sub-threads,
  view their progress, and see their full conversation history. Use for work >5 min or when
  user visibility is important.

  **SpawnThread optional parameters** (if not specified, inherits from parent):
  - `model`: 'claude-sonnet-4-5', 'claude-opus-4-5', or 'claude-haiku-4-5'
  - `permission_mode`: 'default', 'acceptEdits', 'bypassPermissions', or 'plan'
  - `extended_thinking`: true/false

  Example: To spawn a thread in plan mode:
  ```json
  {"title": "Research task", "permission_mode": "plan", "initial_message": "..."}
  ```

- `Task`: Creates a BACKGROUND agent (not visible in UI). Use for quick, autonomous work like
  research, exploration, file searching, or planning. Results are returned to you directly.
  Use for ephemeral work <2 min where user doesn't need to see the process.
- `SendToThread`: Follow-up questions or additional context to running threads

When the user asks to "launch an agent" or "spawn something", consider:
- If they want to SEE the work happening → use SpawnThread (visible, interactive)
- If they just want RESULTS quickly → use Task (background, fast)

PARALLELISM MINDSET: Before starting any multi-step task, ask yourself:
"Can any of these steps run independently?" If yes, spawn parallel threads.
"""

    if thread.get("workDir"):
        prompt += f"""
Working directory: {thread['workDir']}

## Project Context Awareness

When asked about the current project or "what to work on", examine:
1. **Git status** - uncommitted changes, current branch, recent commits
2. **Project files** - README, package.json/pyproject.toml, TODO files
3. **Issue trackers** - GitHub issues, TODO.md, or any issue files in the project
4. **Recent activity** - recently modified files indicate active work areas

Use Task(subagent_type="Explore") to quickly gather project context before answering.
"""

    # Add plan mode instructions if in plan mode
    if thread.get("permissionMode") == "plan":
        prompt += """

## Plan Mode

You are in PLAN MODE. Before implementing changes:
1. Explore the codebase to understand the current state
2. Design your implementation approach
3. Write your plan to a markdown file (e.g., PLAN.md in the working directory)
4. Call ExitPlanMode to present the plan to the user for approval

The user will see your plan and can:
- Proceed with the plan as-is
- Proceed with "Accept Edits" mode (auto-accept file changes)
- Proceed with "Bypass" mode (skip all permission prompts)
- Request modifications to the plan
- Trigger context compaction

Use TodoWrite to track tasks and progress.
"""

    # Add post-compaction context if requested
    if include_compact_context:
        created_at = thread.get("createdAt", "unknown")
        parent_id = thread.get("parentId")

        prompt += f"""

## Thread Context (Post-Compaction)
This thread's conversation history has been compacted to reduce context size.
Key information from the previous conversation is summarized below.

- Thread ID: {thread['id']}
- Created: {created_at}
- Parent thread: {parent_id or 'None (this is a main thread)'}

## Available Tools Reminder
Thread tools: SpawnThread, ListThreads, ReadThread, ArchiveThread, SendToThread, Task{
    ""
    if not parent_id
    else ", SignalStatus (to notify parent when done or blocked)"
}
"""

        if conversation_summary:
            prompt += f"""
## Previous Conversation Summary
{conversation_summary}
"""

    return prompt


def create_subagent_stop_hook(thread_id: str) -> HookMatcher:
    """Create a SubagentStop hook to notify when background tasks complete.

    When the agent uses Task(run_in_background=true), this hook fires when the
    background task completes, allowing us to notify the main thread via SSE.
    """

    async def handle_subagent_stop(
        input_data: dict[str, Any],
        tool_use_id: str | None,
        context: HookContext,
    ) -> HookJSONOutput:
        """Handle SubagentStop events from background tasks."""
        registry = get_registry()

        agent_type = input_data.get("subagent_type", "unknown")
        result = input_data.get("result")
        error = input_data.get("error")
        is_background = input_data.get("run_in_background", False)

        logger.info(
            f"SubagentStop in thread {thread_id}: agent_type={agent_type}, "
            f"background={is_background}, has_result={result is not None}"
        )

        if registry.broadcast_subagent_stop:
            await registry.broadcast_subagent_stop(
                thread_id,
                {
                    "agentType": agent_type,
                    "result": result,
                    "error": error,
                    "isBackground": is_background,
                    "toolUseId": tool_use_id,
                },
            )

        return {}

    return HookMatcher(matcher=None, hooks=[handle_subagent_stop])


def create_permission_handler(
    thread_id: str,
    question_callback: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    plan_approval_callback: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    work_dir: str | None = None,
):
    """Create a permission handler that handles AskUserQuestion and ExitPlanMode.

    This handler intercepts tool permission requests and for:
    - AskUserQuestion: broadcasts the question and waits for user response
    - ExitPlanMode: broadcasts plan approval and waits for user to proceed/modify

    Args:
        thread_id: The thread ID this handler is for
        question_callback: Legacy callback for questions (uses registry if not provided)
        plan_approval_callback: Legacy callback for plan approval (uses registry if not provided)
        work_dir: Working directory for file fallback when reading plan content
    """

    async def handle_tool_permission(
        tool_name: str,
        input_data: dict[str, Any],
        context: dict[str, Any],
    ) -> PermissionResultAllow | PermissionResultDeny:
        """Handle tool permission requests, especially AskUserQuestion and ExitPlanMode."""
        registry = get_registry()

        if tool_name == "AskUserQuestion":
            questions = input_data.get("questions", [])

            # Broadcast question to frontend via SSE
            if registry.broadcast_question:
                await registry.broadcast_question(thread_id, {"questions": questions})
            elif question_callback:
                await question_callback({"questions": questions})

            # Wait for user answer
            answers = await registry.wait_for_answer(thread_id, timeout=300.0)

            if answers:
                return PermissionResultAllow(updated_input={**input_data, "answers": answers})
            else:
                return PermissionResultDeny(
                    message="User did not respond to question",
                    interrupt=False,
                )

        if tool_name == "ExitPlanMode":
            # ExitPlanMode requires user approval before proceeding
            # Broadcast plan approval request and WAIT for user response
            logger.info(f"[PERMISSION] ExitPlanMode called for thread {thread_id}, waiting for user approval")

            # Get plan content - first try from input_data (SDK passes it directly)
            plan_content = input_data.get("plan", "")

            # If plan content is empty, try reading from file as fallback
            if not plan_content and work_dir:
                plan_file_path = input_data.get("planFilePath", "PLAN.md")
                logger.info(f"[PERMISSION] Plan content empty, trying file fallback: {plan_file_path}")

                plan_path = Path(work_dir) / plan_file_path
                if plan_path.exists():
                    try:
                        plan_content = plan_path.read_text(encoding="utf-8")
                        logger.info(f"[PERMISSION] Loaded plan from file: {plan_path}")
                    except Exception as e:
                        logger.warning(f"[PERMISSION] Error reading plan file {plan_path}: {e}")
                        plan_content = f"[Error reading plan file: {e}]"
                else:
                    # Try common plan file locations
                    for alt_name in ["PLAN.md", "plan.md", ".plan.md"]:
                        alt_path = Path(work_dir) / alt_name
                        if alt_path.exists():
                            try:
                                plan_content = alt_path.read_text(encoding="utf-8")
                                logger.info(f"[PERMISSION] Loaded plan from alternate file: {alt_path}")
                                break
                            except Exception:
                                pass

            if registry.broadcast_plan_approval:
                await registry.broadcast_plan_approval(thread_id, {
                    "planContent": plan_content,
                    "allowedPrompts": input_data.get("allowedPrompts", []),
                    "pushToRemote": input_data.get("pushToRemote", False),
                })

            # Wait for user to approve/modify/compact the plan
            response = await registry.wait_for_answer(thread_id, timeout=600.0)  # 10 min timeout for plan review

            if response:
                action = response.get("action", "proceed")
                logger.info(f"[PERMISSION] ExitPlanMode: user responded with action={action}")

                if action == "proceed":
                    # User approved, continue execution
                    return PermissionResultAllow(updated_input=input_data)
                elif action == "modify":
                    # User wants to modify - deny and let them edit
                    return PermissionResultDeny(
                        message="User requested plan modification",
                        interrupt=False,
                    )
                elif action == "compact":
                    # User wants to compact context
                    return PermissionResultDeny(
                        message="User requested context compaction",
                        interrupt=False,
                    )
            else:
                # Timeout - notify frontend and deny the tool
                logger.warning(f"[PERMISSION] ExitPlanMode: timeout waiting for user approval")

                # Broadcast timeout notification to frontend
                if registry.broadcast_plan_approval:
                    await registry.broadcast_plan_approval(thread_id, {
                        "timeout": True,
                        "message": "Plan approval timed out after 10 minutes",
                    })

                return PermissionResultDeny(
                    message="Timeout waiting for plan approval",
                    interrupt=False,
                )

        # Allow all other tools
        return PermissionResultAllow(updated_input=input_data)

    return handle_tool_permission


async def run_agent(
    thread: dict[str, Any],
    user_message: str,
    question_callback: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    images: list[dict[str, str]] | None = None,
    allow_nested_subthreads: bool = False,
    max_thread_depth: int = 1,
) -> AsyncIterator[AgentMessage]:
    """Run the Claude agent for a thread, yielding messages as they stream.

    Uses ClaudeSDKClient for bidirectional messaging, custom tools, and hooks.

    Message flow:
        1. Build system prompt based on thread type
        2. Configure tools (main thread vs sub-thread)
        3. Create permission handler for AskUserQuestion
        4. Stream messages from SDK
        5. Yield AgentMessage for each event
        6. Determine final status based on tool calls

    Args:
        thread: Thread configuration dict with id, title, parentId, workDir, etc.
        user_message: The user's message to process
        question_callback: Optional callback for AskUserQuestion events
        images: Optional list of image dicts with 'data' (base64) and 'media_type'
        allow_nested_subthreads: Whether sub-threads can spawn their own sub-threads
        max_thread_depth: Maximum nesting depth (1 = only main thread can spawn)

    Yields:
        AgentMessage objects for each streaming event
    """
    system_prompt = build_system_prompt(thread)
    thread_id = thread["id"]

    model = thread.get("model", "claude-opus-4-5")
    permission = thread.get("permissionMode", "acceptEdits")

    # Determine tools based on thread type
    # All available Claude Code tools - no restrictions
    allowed_tools = [
        "Read",
        "Edit",
        "MultiEdit",
        "Bash",
        "Glob",
        "Grep",
        "Write",
        "AskUserQuestion",
        "WebSearch",
        "WebFetch",
        "TodoWrite",
        "NotebookEdit",
        "KillShell",
        "TaskOutput",
        "EnterPlanMode",
        "ExitPlanMode",
        "Skill",
    ]

    # Create MCP server config for custom tools
    mcp_servers = {}

    # Calculate thread depth to determine if spawning is allowed
    current_depth = get_thread_depth(thread_id)
    can_spawn = current_depth < max_thread_depth and (
        current_depth == 0 or allow_nested_subthreads
    )

    logger.debug(
        f"[AGENT] Thread {thread_id}: depth={current_depth}, "
        f"max_depth={max_thread_depth}, allow_nested={allow_nested_subthreads}, "
        f"can_spawn={can_spawn}"
    )

    # Thread management tools (all threads get read-only tools)
    list_threads_tool = create_list_threads_tool()
    archive_thread_tool = create_archive_thread_tool()
    read_thread_tool = create_read_thread_tool()
    send_to_thread_tool = create_send_to_thread_tool(thread_id)

    # Only add SpawnThread if this thread is allowed to spawn
    if can_spawn:
        spawn_tool = create_spawn_thread_tool(
            parent_thread_id=thread_id,
            parent_model=model,
            parent_permission_mode=permission,
            parent_extended_thinking=thread.get("extendedThinking", True),
        )
        mainthread_server = create_sdk_mcp_server(
            name="mainthread",
            version="1.0.0",
            tools=[
                spawn_tool,
                list_threads_tool,
                archive_thread_tool,
                read_thread_tool,
                send_to_thread_tool,
            ],
        )
        allowed_tools.extend(
            [
                "mcp__mainthread__SpawnThread",
                "mcp__mainthread__ListThreads",
                "mcp__mainthread__ArchiveThread",
                "mcp__mainthread__ReadThread",
                "mcp__mainthread__SendToThread",
                "Task",
            ]
        )
    else:
        # Thread can't spawn, but still gets other management tools
        mainthread_server = create_sdk_mcp_server(
            name="mainthread",
            version="1.0.0",
            tools=[
                list_threads_tool,
                archive_thread_tool,
                read_thread_tool,
                send_to_thread_tool,
            ],
        )
        allowed_tools.extend(
            [
                "mcp__mainthread__ListThreads",
                "mcp__mainthread__ArchiveThread",
                "mcp__mainthread__ReadThread",
                "mcp__mainthread__SendToThread",
                "Task",
            ]
        )

    mcp_servers["mainthread"] = mainthread_server

    # Sub-threads also get SignalStatus to notify their parent
    if thread.get("parentId"):
        parent_id = thread.get("parentId")
        signal_status_tool = create_signal_status_tool(
            parent_thread_id=parent_id,
            child_thread_id=thread_id,
        )
        subthread_server = create_sdk_mcp_server(
            name="subthread",
            version="1.0.0",
            tools=[signal_status_tool],
        )
        mcp_servers["subthread"] = subthread_server
        allowed_tools.append("mcp__subthread__SignalStatus")

    permission_handler = create_permission_handler(
        thread_id, question_callback, work_dir=thread.get("workDir")
    )
    subagent_stop_hook = create_subagent_stop_hook(thread_id)

    # Extended thinking configuration
    extended_thinking = thread.get("extendedThinking", True)
    settings_json = json.dumps({"alwaysThinkingEnabled": extended_thinking})

    if extended_thinking and "MAX_THINKING_TOKENS" not in os.environ:
        os.environ["MAX_THINKING_TOKENS"] = "10000"
        logger.debug("[AGENT] Set MAX_THINKING_TOKENS=10000 for extended thinking")

    logger.debug(f"[AGENT] Starting agent for thread {thread_id}, model: {model}")

    # Create client options directly (no caching - fresh client per request)
    options = ClaudeAgentOptions(
        system_prompt=system_prompt,
        allowed_tools=allowed_tools,
        mcp_servers=mcp_servers if mcp_servers else None,
        resume=thread.get("sessionId"),
        cwd=thread.get("workDir") or os.getcwd(),
        permission_mode=permission,
        model=model,
        can_use_tool=permission_handler,
        settings=settings_json,
        hooks={"SubagentStop": [subagent_stop_hook]},
        include_partial_messages=True,
    )

    collected_content: list[str] = []
    collected_tool_calls: list[dict[str, Any]] = []
    final_session_id: str | None = None
    received_streaming_text = False
    received_streaming_thinking = False  # Track if thinking was streamed to avoid duplicates

    try:
        async with ClaudeSDKClient(options=options) as client:
            # Build query content - text only or multimodal with images
            if images:
                # Build multimodal content with images and text
                query_content: list[dict[str, Any]] = []
                for img in images:
                    query_content.append({
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": img["media_type"],
                            "data": img["data"],
                        },
                    })
                query_content.append({"type": "text", "text": user_message})
                await client.query(query_content)
            else:
                await client.query(user_message)

            async for message in client.receive_response():
                logger.debug(f"[AGENT] Received message type: {type(message).__name__}")

                if isinstance(message, AssistantMessage):
                    logger.debug(f"[AGENT] AssistantMessage content has {len(message.content)} blocks")
                    for block in message.content:
                        logger.debug(f"[AGENT] Block type: {type(block).__name__}")
                        if isinstance(block, TextBlock):
                            if not received_streaming_text:
                                collected_content.append(block.text)
                                yield AgentMessage(type="text", content=block.text)

                        elif isinstance(block, ThinkingBlock):
                            # Skip if already emitted via StreamEvent thinking_delta
                            if not received_streaming_thinking:
                                yield AgentMessage(
                                    type="thinking",
                                    content=block.thinking,
                                    metadata={"signature": block.signature},
                                )

                        elif isinstance(block, ToolUseBlock):
                            # Check if already emitted via StreamEvent
                            already_emitted = any(
                                t.get("id") == block.id for t in collected_tool_calls
                            )
                            if already_emitted:
                                # Update the collected tool with full input
                                for t in collected_tool_calls:
                                    if t.get("id") == block.id:
                                        t["input"] = block.input
                                        break
                                # Emit tool_input update with full input (for UI to update)
                                # Only emit if input is non-empty to avoid unnecessary events
                                if block.input:
                                    yield AgentMessage(
                                        type="tool_input",
                                        content="",
                                        metadata={
                                            "id": block.id,
                                            "input": block.input,
                                        },
                                    )
                            else:
                                collected_tool_calls.append(
                                    {
                                        "name": block.name,
                                        "input": block.input,
                                        "id": block.id,
                                    }
                                )
                                yield AgentMessage(
                                    type="tool_use",
                                    content=f"Using tool: {block.name}",
                                    metadata={
                                        "tool": block.name,
                                        "input": block.input,
                                        "id": block.id,
                                    },
                                )

                        elif isinstance(block, ToolResultBlock):
                            content = (
                                block.content
                                if isinstance(block.content, str)
                                else str(block.content)
                            )
                            yield AgentMessage(
                                type="tool_result",
                                content=content,
                                metadata={
                                    "tool_use_id": block.tool_use_id,
                                    "is_error": block.is_error or False,
                                },
                            )

                elif isinstance(message, ResultMessage):
                    final_session_id = message.session_id
                    if message.usage:
                        # Convert usage to dict if it's a dataclass or object
                        usage_data = message.usage
                        if hasattr(usage_data, "__dict__"):
                            usage_data = vars(usage_data)
                        elif hasattr(usage_data, "_asdict"):  # NamedTuple
                            usage_data = usage_data._asdict()
                        yield AgentMessage(
                            type="usage",
                            content="",
                            metadata={
                                "usage": usage_data,
                                "total_cost_usd": message.total_cost_usd,
                            },
                        )
                    if message.is_error:
                        yield AgentMessage(
                            type="error",
                            content=message.result or "Unknown error",
                        )

                elif isinstance(message, SystemMessage):
                    pass  # System messages logged but not streamed

                elif isinstance(message, StreamEvent):
                    event = message.event
                    event_type = event.get("type", "")

                    # Log all event types for debugging
                    logger.debug(f"[AGENT] StreamEvent: {event_type}, event={event}")

                    if event_type == "content_block_delta":
                        delta = event.get("delta", {})
                        delta_type = delta.get("type", "")

                        if delta_type == "thinking_delta":
                            thinking_content = delta.get("thinking", "")
                            if thinking_content:
                                received_streaming_thinking = True
                                yield AgentMessage(
                                    type="thinking",
                                    content=thinking_content,
                                    metadata={"streaming": True},
                                )
                        elif delta_type == "text_delta":
                            text_content = delta.get("text", "")
                            if text_content:
                                received_streaming_text = True
                                collected_content.append(text_content)
                                yield AgentMessage(type="text", content=text_content)
                        # input_json_delta events stream tool input JSON but we don't need
                        # to accumulate it - the full input comes in AssistantMessage

                    elif event_type == "content_block_start":
                        content_block = event.get("content_block", {})
                        block_type = content_block.get("type", "")
                        if block_type == "thinking":
                            signature = content_block.get("signature", "")
                            if signature:
                                yield AgentMessage(
                                    type="thinking_start",
                                    content="",
                                    metadata={"signature": signature},
                                )
                        elif block_type == "tool_use":
                            tool_name = content_block.get("name", "")
                            tool_id = content_block.get("id", "")
                            logger.debug(f"[AGENT] StreamEvent tool_use start: {tool_name} ({tool_id})")
                            # Yield tool_use immediately so UI can show spinner
                            collected_tool_calls.append({
                                "name": tool_name,
                                "input": {},
                                "id": tool_id,
                            })
                            yield AgentMessage(
                                type="tool_use",
                                content=f"Using tool: {tool_name}",
                                metadata={
                                    "tool": tool_name,
                                    "input": {},
                                    "id": tool_id,
                                },
                            )

                    # content_block_stop: No action needed here. Tool completion is
                    # signaled via server.py's auto-completion logic (when text starts
                    # or a new tool starts, previous tools are marked complete).

    except CLINotFoundError:
        yield AgentMessage(
            type="error",
            content="Claude Code CLI not installed. Run: npm install -g @anthropic-ai/claude-code",
        )
        return
    except CLIConnectionError as e:
        yield AgentMessage(type="error", content=f"Connection failed: {e}")
        return
    except ProcessError as e:
        yield AgentMessage(
            type="error",
            content=f"Process error (exit {e.exit_code}): {e.stderr}",
        )
        return
    except CLIJSONDecodeError as e:
        yield AgentMessage(
            type="error",
            content=f"Failed to parse response: {e.line}",
        )
        return
    except Exception as e:
        logger.exception(f"Agent error: {e}")
        yield AgentMessage(type="error", content=str(e))
        return

    # Yield final status
    full_content = "".join(collected_content)
    status = determine_status(full_content, collected_tool_calls)

    yield AgentMessage(
        type="status",
        content=status,
        metadata={"session_id": final_session_id, "full_content": full_content},
    )


def determine_status(content: str, tool_calls: list[dict[str, Any]] | None = None) -> str:
    """Determine thread status based on response content and tool calls.

    Checks for SignalStatus tool calls first (preferred), then falls back to
    text markers [BLOCKED]/[DONE] for backward compatibility.

    Args:
        content: The full text response
        tool_calls: List of tool calls made during execution

    Returns:
        Status string: "active", "needs_attention", or "done"
    """
    # First check for explicit SignalStatus tool calls
    if tool_calls:
        for call in tool_calls:
            tool_name = call.get("name", "")
            if tool_name in ("SignalStatus", "mcp__subthread__SignalStatus"):
                tool_input = call.get("input", {})
                status = tool_input.get("status", "")
                if status == "blocked":
                    logger.info("Status determined from SignalStatus tool: blocked")
                    return "needs_attention"
                if status == "done":
                    logger.info("Status determined from SignalStatus tool: done")
                    return "done"

    # Fallback to text markers for backward compatibility
    if "[BLOCKED]" in content:
        return "needs_attention"
    if "[DONE]" in content:
        return "done"
    return "active"


async def run_agent_simple(
    thread: dict[str, Any],
    user_message: str,
) -> AgentResult:
    """Simplified agent execution that collects all output.

    Use this for non-streaming scenarios.

    Args:
        thread: Thread configuration dict
        user_message: The user's message to process

    Returns:
        AgentResult with collected content, status, and session ID
    """
    collected_content: list[str] = []
    final_session_id: str | None = None
    final_status = "active"

    async for msg in run_agent(thread, user_message):
        if msg.type == "text":
            collected_content.append(msg.content)
        elif msg.type == "status":
            final_status = msg.content
            if msg.metadata:
                final_session_id = msg.metadata.get("session_id")

    return AgentResult(
        content="".join(collected_content),
        status=final_status,
        session_id=final_session_id,
    )
