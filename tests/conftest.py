"""
Pytest configuration and fixtures for MainThread API tests.

Key testing philosophy:
- Mock external dependencies (Claude Code SDK)
- Test our own logic (message processing, tool tracking, SSE formatting)
"""

import pytest
from dataclasses import dataclass
from typing import Any


@dataclass
class MockAgentMessage:
    """Mock of the AgentMessage dataclass from agents.py."""
    type: str  # "text", "tool_use", "tool_result", "thinking", "error", "status"
    content: str
    metadata: dict[str, Any] | None = None


# Common tool IDs for testing
TOOL_ID_1 = "toolu_abc123"
TOOL_ID_2 = "toolu_def456"
TOOL_ID_3 = "toolu_ghi789"


@pytest.fixture
def simple_text_sequence():
    """Simple text-only response."""
    return [
        MockAgentMessage(type="text", content="Hello, "),
        MockAgentMessage(type="text", content="world!"),
    ]


@pytest.fixture
def text_tool_interleaved_sequence():
    """
    Realistic sequence: text -> tool -> text -> tool -> text
    This tests chronological ordering.
    """
    return [
        MockAgentMessage(type="text", content="I'll count the characters. "),
        MockAgentMessage(
            type="tool_use",
            content="Using tool: Read",
            metadata={"tool": "Read", "input": {"file": "test.txt"}, "id": TOOL_ID_1},
        ),
        MockAgentMessage(
            type="tool_result",
            content="File content here",
            metadata={"tool_use_id": TOOL_ID_1},
        ),
        MockAgentMessage(type="text", content="Now let me count: "),
        MockAgentMessage(
            type="tool_use",
            content="Using tool: Bash",
            metadata={"tool": "Bash", "input": {"command": "wc -c"}, "id": TOOL_ID_2},
        ),
        MockAgentMessage(
            type="tool_result",
            content="42 characters",
            metadata={"tool_use_id": TOOL_ID_2},
        ),
        MockAgentMessage(type="text", content="The file has 42 characters."),
    ]


@pytest.fixture
def tool_result_without_id_sequence():
    """
    Sequence where tool_result has no tool_use_id.
    Tests the FIFO fallback logic.
    """
    return [
        MockAgentMessage(
            type="tool_use",
            content="Using tool: Read",
            metadata={"tool": "Read", "input": {}, "id": TOOL_ID_1},
        ),
        MockAgentMessage(
            type="tool_result",
            content="Result 1",
            metadata={"tool_use_id": None},  # SDK didn't provide ID
        ),
        MockAgentMessage(
            type="tool_use",
            content="Using tool: Bash",
            metadata={"tool": "Bash", "input": {}, "id": TOOL_ID_2},
        ),
        MockAgentMessage(
            type="tool_result",
            content="Result 2",
            metadata={},  # No tool_use_id key at all
        ),
    ]


@pytest.fixture
def multiple_tools_sequence():
    """Multiple tools executed, testing completion tracking."""
    return [
        MockAgentMessage(
            type="tool_use",
            content="Using tool: Read",
            metadata={"tool": "Read", "id": TOOL_ID_1},
        ),
        MockAgentMessage(
            type="tool_use",
            content="Using tool: Bash",
            metadata={"tool": "Bash", "id": TOOL_ID_2},
        ),
        MockAgentMessage(
            type="tool_use",
            content="Using tool: Write",
            metadata={"tool": "Write", "id": TOOL_ID_3},
        ),
        # Results come back in order
        MockAgentMessage(
            type="tool_result",
            content="Read result",
            metadata={"tool_use_id": TOOL_ID_1},
        ),
        MockAgentMessage(
            type="tool_result",
            content="Bash result",
            metadata={"tool_use_id": TOOL_ID_2},
        ),
        MockAgentMessage(
            type="tool_result",
            content="Write result",
            metadata={"tool_use_id": TOOL_ID_3},
        ),
    ]


@pytest.fixture
def thinking_sequence():
    """Sequence with thinking blocks (extended thinking)."""
    return [
        MockAgentMessage(
            type="thinking",
            content="Let me analyze this problem...",
            metadata={"signature": "sig_abc123"},
        ),
        MockAgentMessage(type="text", content="Based on my analysis, "),
        MockAgentMessage(
            type="tool_use",
            content="Using tool: Read",
            metadata={"tool": "Read", "id": TOOL_ID_1},
        ),
        MockAgentMessage(
            type="tool_result",
            content="Data",
            metadata={"tool_use_id": TOOL_ID_1},
        ),
        MockAgentMessage(type="text", content="the answer is 42."),
    ]
