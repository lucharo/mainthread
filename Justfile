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

# Run both backend and frontend in parallel
dev:
    just serve & just dev-frontend

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
    rip mainthread.db 2>/dev/null || echo "No database to delete"
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
    rip dist/ 2>/dev/null || true
    rip build/ 2>/dev/null || true
    rip *.egg-info 2>/dev/null || true
    @echo "Build artifacts cleaned"

# =============================================================================
# Full workflows
# =============================================================================

# Full build: frontend + backend package
build-all: build-frontend build

# Pre-release check: test, lint, build
check: test lint build-frontend build
    @echo "All checks passed!"

# Fresh start: reset db, build frontend, start server
fresh: reset-db build-frontend serve
