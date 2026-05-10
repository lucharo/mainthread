# MainThread development commands

default:
    @just --list

# Install all dependencies
install:
    uv sync
    pnpm install

# Run backend + frontend dev servers in parallel
dev:
    #!/usr/bin/env bash
    trap 'kill $(jobs -p) 2>/dev/null' EXIT
    uv run mainthread serve --reload &
    pnpm --filter @mainthread/web dev

# Run backend server only
serve:
    uv run mainthread serve --reload

# Run frontend dev server only
dev-frontend:
    pnpm --filter @mainthread/web dev

# Run all tests
test:
    uv run pytest tests/ -v
    pnpm --filter @mainthread/web run test

# Lint and format check
lint:
    uv run ruff check src/mainthread
    uv run ruff format --check src/mainthread

# Fix lint issues
lint-fix:
    uv run ruff check --fix src/mainthread
    uv run ruff format src/mainthread

# Type check backend
typecheck:
    uv run mypy src/mainthread

# Build everything (frontend + Python package)
build:
    pnpm --filter @mainthread/web build
    uv build

# Pre-release check: test, lint, build
check: test lint build
    @echo "All checks passed!"

# Build and verify package
build-check: build
    uv run twine check dist/*

# Publish to PyPI
publish: build
    uv publish

# Publish to TestPyPI
publish-test: build
    uv publish --publish-url https://test.pypi.org/legacy/

# Reset database
reset-db:
    rm -f mainthread.db
    @echo "Database reset"

# Clean build artifacts
clean:
    rm -rf dist/ build/ *.egg-info
    @echo "Cleaned"
