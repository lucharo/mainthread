"""
Tests for streaming message processing logic.

These tests validate:
1. FIFO tool completion tracking (tool_use_id fallback)
2. Message type routing
3. SSE event formatting
"""

import pytest
from tests.conftest import MockAgentMessage, TOOL_ID_1, TOOL_ID_2, TOOL_ID_3


class TestFIFOToolTracking:
    """Test the FIFO fallback logic for tool completion tracking."""

    def test_tool_ids_tracked_in_order(self, text_tool_interleaved_sequence):
        """Tool IDs should be tracked in FIFO order as tool_use events arrive."""
        pending_tool_ids: list[str] = []

        for msg in text_tool_interleaved_sequence:
            if msg.type == "tool_use":
                tool_id = msg.metadata.get("id") if msg.metadata else None
                if tool_id:
                    pending_tool_ids.append(tool_id)

        # Should have collected both tool IDs in order
        assert pending_tool_ids == [TOOL_ID_1, TOOL_ID_2]

    def test_tool_result_with_id_removes_from_queue(self, text_tool_interleaved_sequence):
        """When tool_result has tool_use_id, it should be removed from pending queue."""
        pending_tool_ids: list[str] = []
        completed_tools: list[str] = []

        for msg in text_tool_interleaved_sequence:
            if msg.type == "tool_use":
                tool_id = msg.metadata.get("id") if msg.metadata else None
                if tool_id:
                    pending_tool_ids.append(tool_id)
            elif msg.type == "tool_result":
                tool_use_id = msg.metadata.get("tool_use_id") if msg.metadata else None
                if tool_use_id and tool_use_id in pending_tool_ids:
                    pending_tool_ids.remove(tool_use_id)
                    completed_tools.append(tool_use_id)

        # All tools should be completed
        assert len(pending_tool_ids) == 0
        assert completed_tools == [TOOL_ID_1, TOOL_ID_2]

    def test_fifo_fallback_when_no_tool_use_id(self, tool_result_without_id_sequence):
        """When tool_result has no tool_use_id, FIFO fallback should match first pending."""
        pending_tool_ids: list[str] = []
        completed_tools: list[str] = []

        for msg in tool_result_without_id_sequence:
            if msg.type == "tool_use":
                tool_id = msg.metadata.get("id") if msg.metadata else None
                if tool_id:
                    pending_tool_ids.append(tool_id)
            elif msg.type == "tool_result":
                tool_use_id = msg.metadata.get("tool_use_id") if msg.metadata else None

                # FIFO fallback logic (matching main.py implementation)
                if not tool_use_id and pending_tool_ids:
                    tool_use_id = pending_tool_ids.pop(0)  # FIFO: pop from front
                elif tool_use_id and tool_use_id in pending_tool_ids:
                    pending_tool_ids.remove(tool_use_id)

                if tool_use_id:
                    completed_tools.append(tool_use_id)

        # Both tools should be completed via FIFO fallback
        assert len(pending_tool_ids) == 0
        assert completed_tools == [TOOL_ID_1, TOOL_ID_2]

    def test_multiple_tools_all_complete(self, multiple_tools_sequence):
        """All tools in a multi-tool sequence should be marked complete."""
        pending_tool_ids: list[str] = []
        completed_tools: list[str] = []

        for msg in multiple_tools_sequence:
            if msg.type == "tool_use":
                tool_id = msg.metadata.get("id") if msg.metadata else None
                if tool_id:
                    pending_tool_ids.append(tool_id)
            elif msg.type == "tool_result":
                tool_use_id = msg.metadata.get("tool_use_id") if msg.metadata else None

                if not tool_use_id and pending_tool_ids:
                    tool_use_id = pending_tool_ids.pop(0)
                elif tool_use_id and tool_use_id in pending_tool_ids:
                    pending_tool_ids.remove(tool_use_id)

                if tool_use_id:
                    completed_tools.append(tool_use_id)

        assert len(pending_tool_ids) == 0
        assert set(completed_tools) == {TOOL_ID_1, TOOL_ID_2, TOOL_ID_3}


class TestMessageTypeRouting:
    """Test that different message types are correctly identified and routed."""

    def test_text_messages_collected(self, text_tool_interleaved_sequence):
        """All text content should be collected in order."""
        collected_text = []

        for msg in text_tool_interleaved_sequence:
            if msg.type == "text":
                collected_text.append(msg.content)

        assert len(collected_text) == 3
        assert "I'll count" in collected_text[0]
        assert "Now let me count" in collected_text[1]
        assert "42 characters" in collected_text[2]

    def test_tool_use_has_required_metadata(self, text_tool_interleaved_sequence):
        """Tool use messages should have tool name and ID in metadata."""
        for msg in text_tool_interleaved_sequence:
            if msg.type == "tool_use":
                assert msg.metadata is not None
                assert "tool" in msg.metadata or "name" in msg.metadata
                assert "id" in msg.metadata

    def test_thinking_messages_have_content(self, thinking_sequence):
        """Thinking messages should have content and optional signature."""
        thinking_msgs = [m for m in thinking_sequence if m.type == "thinking"]

        assert len(thinking_msgs) == 1
        assert thinking_msgs[0].content
        assert thinking_msgs[0].metadata.get("signature")


class TestChronologicalOrdering:
    """Test that message ordering is preserved for UI rendering."""

    def test_block_order_preserved(self, text_tool_interleaved_sequence):
        """Blocks should maintain their arrival order."""
        block_types = [msg.type for msg in text_tool_interleaved_sequence]

        expected = ["text", "tool_use", "tool_result", "text", "tool_use", "tool_result", "text"]
        assert block_types == expected

    def test_interleaved_text_and_tools(self, text_tool_interleaved_sequence):
        """Text should be interleaved with tools, not grouped."""
        # Get indices of each type
        text_indices = [i for i, m in enumerate(text_tool_interleaved_sequence) if m.type == "text"]
        tool_indices = [i for i, m in enumerate(text_tool_interleaved_sequence) if m.type == "tool_use"]

        # Text should appear before, between, and after tools
        assert text_indices[0] < tool_indices[0]  # Text before first tool
        assert text_indices[1] > tool_indices[0]  # Text after first tool
        assert text_indices[1] < tool_indices[1]  # Text before second tool
        assert text_indices[2] > tool_indices[1]  # Text after second tool


class TestSSEEventFormatting:
    """Test SSE event data formatting."""

    def test_tool_use_event_data(self, text_tool_interleaved_sequence):
        """Tool use events should have correct data structure for SSE."""
        for msg in text_tool_interleaved_sequence:
            if msg.type == "tool_use":
                # This is what we broadcast via SSE
                tool_data = msg.metadata or {}

                assert "tool" in tool_data or "name" in tool_data
                assert "id" in tool_data
                # input is optional but commonly present
                assert isinstance(tool_data.get("input", {}), dict)

    def test_tool_result_event_data(self, text_tool_interleaved_sequence):
        """Tool result events should include tool_use_id for completion tracking."""
        for msg in text_tool_interleaved_sequence:
            if msg.type == "tool_result":
                tool_use_id = msg.metadata.get("tool_use_id") if msg.metadata else None
                # In real SDK this might be None, which triggers FIFO fallback
                # But in our well-formed fixture, it should be present
                assert tool_use_id is not None
