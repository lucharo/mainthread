"""Agent tools for MainThread.

Tools are created by factory functions that take context (thread ID, etc.)
and return tool implementations that can be registered with the Claude SDK.
"""

from mainthread.agents.tools.archive_thread import create_archive_thread_tool
from mainthread.agents.tools.list_threads import create_list_threads_tool
from mainthread.agents.tools.read_thread import create_read_thread_tool
from mainthread.agents.tools.send_to_thread import create_send_to_thread_tool
from mainthread.agents.tools.signal_status import create_signal_status_tool
from mainthread.agents.tools.spawn_thread import create_spawn_thread_tool

__all__ = [
    "create_spawn_thread_tool",
    "create_list_threads_tool",
    "create_archive_thread_tool",
    "create_read_thread_tool",
    "create_send_to_thread_tool",
    "create_signal_status_tool",
]
