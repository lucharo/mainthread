# MainThread development commands

# Default recipe - show available commands
default:
    @just --list

# =============================================================================
# Development
# =============================================================================

# Install all dependencies
install:
    uv sync
    cd apps/web && bun install

# Run backend server (with auto-reload)
serve:
    uv run mainthread serve --reload

# Run backend server on specific port
serve-port port="2026":
    uv run mainthread serve --port {{port}} --reload

# Run frontend dev server (hot reload, proxies to backend)
dev-frontend:
    cd apps/web && bun run dev

# Run both backend and frontend in parallel (with cleanup on exit)
dev:
    #!/usr/bin/env bash
    trap 'kill $(jobs -p) 2>/dev/null' EXIT
    just serve &
    just dev-frontend

# Build frontend (outputs to src/mainthread/static/)
build-frontend:
    cd apps/web && bun run build

# Run backend tests
test:
    uv run pytest tests/ -v

# Run backend tests (quick mode)
test-quick:
    uv run pytest tests/ -q

# Type check backend
typecheck:
    uv run mypy src/mainthread

# Lint and format
lint:
    uv run ruff check src/mainthread
    uv run ruff format --check src/mainthread

# Fix lint issues
lint-fix:
    uv run ruff check --fix src/mainthread
    uv run ruff format src/mainthread

# =============================================================================
# Database & Reset
# =============================================================================

# Reset database (delete mainthread.db)
reset-db:
    rm -f mainthread.db
    @echo "Database reset complete"

# Show command to reset welcome modal (run in browser console)
reset-welcome:
    @echo "Run this in your browser console:"
    @echo "  localStorage.removeItem('mainthread_welcome_shown')"
    @echo "Then refresh the page."

# =============================================================================
# Publishing
# =============================================================================

# Build package for distribution
build:
    uv build

# Build and check package
build-check:
    uv build
    uv run twine check dist/*

# Publish to PyPI (requires TWINE_USERNAME and TWINE_PASSWORD or .pypirc)
publish: build
    uv publish

# Publish to TestPyPI first (for testing)
publish-test: build
    uv publish --publish-url https://test.pypi.org/legacy/

# Clean build artifacts
clean:
    rm -rf dist/ build/ *.egg-info
    @echo "Build artifacts cleaned"

# =============================================================================
# Full workflows
# =============================================================================

# Full build: frontend + backend package
build-all: build-frontend build

# Pre-release check: test, lint, build
check: test lint build-frontend build
    @echo "All checks passed!"

# Fresh environment: reset db and build frontend
fresh: reset-db build-frontend
    @echo "Fresh environment ready. Run 'just serve' to start."

# Fresh start: reset db, build frontend, and start server
fresh-start: reset-db build-frontend serve
