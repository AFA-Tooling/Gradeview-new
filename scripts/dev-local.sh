#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"
cd_repo_root

log_info "Starting local frontend/backend with Docker dependencies..."
log_info "Checking ports..."

if port_in_use 5433; then
  echo
  echo "⚠️  Port 5433 is already in use:"
  show_port_usage 5433
  echo "Please free port 5433 (used by cloud-sql-proxy in dev-local mode)."
  exit 1
fi

if port_in_use 8000; then
  echo
  echo "⚠️  Port 8000 is already in use:"
  show_port_usage 8000
  confirm_and_kill_port 8000 || exit 1
fi

if port_in_use 3000; then
  echo
  echo "⚠️  Port 3000 is already in use:"
  show_port_usage 3000
  confirm_and_kill_port 3000 || exit 1
fi

log_info "1. Stopping dockerized frontend/backend if running..."
docker compose -f docker-compose.dev.yml stop reverseProxy web api >/dev/null 2>&1 || true

log_info "2. Starting Docker dependency services (cloud-sql-proxy + gradesync)..."
docker compose -f docker-compose.dev.yml up -d cloud-sql-proxy gradesync

log_info "3. Waiting for database proxy to be ready..."
sleep 5

log_info "4. Starting local API server on :8000 (DB via localhost:5433)..."
(
  cd api
  NODE_ENV=development POSTGRES_HOST=localhost POSTGRES_PORT=5433 npm run dev
) &

log_info "5. Starting local website dev server on :3000..."
cd website
REACT_APP_PROXY_SERVER="http://localhost:8000" npm run react
