#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"
cd_repo_root

log_info "Running production preflight (build + up + health + smoke tests)..."
log_info "Stopping dev stack first to avoid port/container conflicts..."
docker compose -f docker-compose.dev.yml down --remove-orphans >/dev/null 2>&1 || true
docker compose -f docker-compose.yml up -d --build --remove-orphans

max_wait=240
interval=6
elapsed=0
containers=(gradeview-api gradeview-web gradeview-gradesync gradeview-reverse-proxy)

log_info "Waiting for healthy services..."
while [[ "$elapsed" -lt "$max_wait" ]]; do
  all_healthy=true
  for container in "${containers[@]}"; do
    status="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container" 2>/dev/null || echo missing)"
    if [[ "$status" != "healthy" ]]; then
      all_healthy=false
      break
    fi
  done

  if [[ "$all_healthy" == "true" ]]; then
    log_info "All services are healthy."
    break
  fi

  sleep "$interval"
  elapsed=$((elapsed + interval))
done

if [[ "$elapsed" -ge "$max_wait" ]]; then
  log_info "Preflight failed: services did not become healthy in time."
  docker compose -f docker-compose.yml ps
  docker compose -f docker-compose.yml logs --tail=120 api web gradesync reverseProxy
  exit 1
fi

log_info "Running smoke checks..."
curl -fsS http://localhost/api/health >/dev/null
curl -fsS http://localhost/ >/dev/null
docker compose -f docker-compose.yml ps
log_info "Preflight passed. To stop stack: make preflight-down"
