"""MainThread CLI - Start the server with a single command."""

import os
import socket
from pathlib import Path
from typing import Annotated, Optional

import typer
import uvicorn


def is_port_available(host: str, port: int) -> bool:
    """Check if a port is available for binding."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind((host, port))
            return True
        except OSError:
            return False


def find_available_port(host: str, start_port: int, max_attempts: int = 10) -> int:
    """Find an available port starting from start_port."""
    for offset in range(max_attempts):
        port = start_port + offset
        if is_port_available(host, port):
            return port
    raise RuntimeError(f"No available port found in range {start_port}-{start_port + max_attempts - 1}")

app = typer.Typer(
    name="mainthread",
    help="Multi-threaded Claude conversations with a web UI.",
    no_args_is_help=False,
)


@app.command()
def serve(
    host: Annotated[str, typer.Option("--host", "-h", help="Host to bind to")] = "127.0.0.1",
    port: Annotated[int, typer.Option("--port", "-p", help="Port to bind to")] = 2026,
    reload: Annotated[bool, typer.Option("--reload", "-r", help="Enable auto-reload")] = False,
    work_dir: Annotated[
        Optional[str], typer.Option("--work-dir", "-w", help="Working directory for threads")
    ] = None,
) -> None:
    """Start the MainThread server."""
    # Set working directory environment variable for the server
    if work_dir:
        resolved = Path(work_dir).resolve()
        if not resolved.exists():
            typer.echo(f"Error: Working directory does not exist: {work_dir}", err=True)
            raise typer.Exit(1)
        os.environ["MAINTHREAD_WORK_DIR"] = str(resolved)

    # Find available port if default is taken
    actual_port = port
    if not is_port_available(host, port):
        try:
            actual_port = find_available_port(host, port)
            typer.echo(f"Port {port} is in use, using {actual_port} instead")
        except RuntimeError as e:
            typer.echo(f"Error: {e}", err=True)
            raise typer.Exit(1)

    typer.echo(f"Starting MainThread on http://{host}:{actual_port}")
    typer.echo("Press Ctrl+C to stop")

    uvicorn.run(
        "mainthread.server:app",
        host=host,
        port=actual_port,
        reload=reload,
    )


@app.command()
def version() -> None:
    """Show version information."""
    from mainthread import __version__

    typer.echo(f"MainThread v{__version__}")


@app.command()
def reset(
    force: Annotated[bool, typer.Option("--force", "-f", help="Skip confirmation prompt")] = False,
) -> None:
    """Reset MainThread - delete all threads and messages.

    This permanently deletes all data. Use with caution.
    """
    from mainthread.db import reset_all_threads, DB_PATH

    if not DB_PATH.exists():
        typer.echo("No database found. Nothing to reset.")
        return

    if not force:
        confirm = typer.confirm(
            "This will permanently delete all threads and messages. Continue?",
            default=False,
        )
        if not confirm:
            typer.echo("Aborted.")
            raise typer.Exit(0)

    try:
        count = reset_all_threads()
        typer.echo(f"Reset complete. Deleted {count} thread(s).")
    except Exception as e:
        typer.echo(f"Error resetting database: {e}", err=True)
        raise typer.Exit(1)


@app.command()
def stats() -> None:
    """Show statistics about threads and messages."""
    from mainthread.db import DB_PATH, get_db

    if not DB_PATH.exists():
        typer.echo("No database found.")
        return

    with get_db() as conn:
        # Count threads
        cursor = conn.execute("SELECT COUNT(*) FROM threads")
        thread_count = cursor.fetchone()[0]

        # Count active vs archived threads
        cursor = conn.execute("SELECT COUNT(*) FROM threads WHERE archived_at IS NULL")
        active_threads = cursor.fetchone()[0]
        archived_threads = thread_count - active_threads

        # Count messages
        cursor = conn.execute("SELECT COUNT(*) FROM messages")
        message_count = cursor.fetchone()[0]

        # Get database file size
        db_size = DB_PATH.stat().st_size
        if db_size < 1024:
            size_str = f"{db_size} B"
        elif db_size < 1024 * 1024:
            size_str = f"{db_size / 1024:.1f} KB"
        else:
            size_str = f"{db_size / (1024 * 1024):.1f} MB"

    typer.echo(f"Database: {DB_PATH}")
    typer.echo(f"Size: {size_str}")
    typer.echo(f"Threads: {thread_count} ({active_threads} active, {archived_threads} archived)")
    typer.echo(f"Messages: {message_count}")


@app.callback(invoke_without_command=True)
def main(ctx: typer.Context) -> None:
    """MainThread - Multi-threaded Claude conversations."""
    if ctx.invoked_subcommand is None:
        # Default action: start the server with default options
        serve()


if __name__ == "__main__":
    app()
