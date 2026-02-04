# MainThread Development Commands

# Default recipe - show available commands
default:
    @just --list

# Run both frontend and backend for development
dev:
    #!/usr/bin/env bash
    set -euo pipefail

    # Colors for output
    CYAN='\033[0;36m'
    YELLOW='\033[0;33m'
    GREEN='\033[0;32m'
    NC='\033[0m' # No Color

    cleanup() {
        echo -e "\n${YELLOW}Shutting down...${NC}"
        # Kill all background jobs in this script
        jobs -p | xargs -r kill 2>/dev/null || true
        sleep 1
        jobs -p | xargs -r kill -9 2>/dev/null || true
        echo -e "${GREEN}Done.${NC}"
    }

    trap cleanup SIGINT SIGTERM EXIT

    echo -e "${GREEN}Starting MainThread development servers...${NC}"
    echo -e "${CYAN}Backend:${NC}  http://localhost:2026"
    echo -e "${CYAN}Frontend:${NC} http://localhost:5173 (with HMR)"
    echo -e "${YELLOW}Press Ctrl+C to stop both servers${NC}\n"

    # Start backend with prefixed output
    (uv run mainthread 2>&1 | while IFS= read -r line; do echo -e "${CYAN}[backend]${NC} $line"; done) &

    # Give backend a moment to start
    sleep 2

    # Start frontend with prefixed output (from apps/web directory)
    (cd apps/web && pnpm exec vite 2>&1 | while IFS= read -r line; do echo -e "${YELLOW}[frontend]${NC} $line"; done) &

    # Wait for all background jobs
    wait

# Build frontend for production
build:
    pnpm --filter web build

# Run only the backend
backend:
    uv run mainthread

# Run only the frontend dev server
frontend:
    cd apps/web && pnpm exec vite

# Install all dependencies
install:
    pnpm install
    uv sync

# Lint and format code
lint:
    pnpm --filter web lint

# Fix lint issues
lint-fix:
    pnpm --filter web lint --fix

# Clean build artifacts
clean:
    rm -rf src/mainthread/static/assets
    rm -f src/mainthread/static/index.html
    pnpm --filter web exec rm -rf dist

# Type check frontend
typecheck:
    pnpm --filter web tsc --noEmit
