#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

echo "Running production preflight (build + up + health + smoke tests)..."
echo "Stopping dev stack first to avoid port/container conflicts..."
docker compose -f docker-compose.dev.yml down --remove-orphans >/dev/null 2>&1 || true
docker compose -f docker-compose.yml up -d --build --remove-orphans

max_wait=240
interval=6
elapsed=0
containers=(gradeview-api gradeview-web gradeview-gradesync gradeview-reverse-proxy)

echo "Waiting for healthy services..."
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
    echo "All services are healthy."
    break
  fi

  sleep "$interval"
  elapsed=$((elapsed + interval))
done

if [[ "$elapsed" -ge "$max_wait" ]]; then
  echo "Preflight failed: services did not become healthy in time."
  docker compose -f docker-compose.yml ps
  docker compose -f docker-compose.yml logs --tail=120 api web gradesync reverseProxy
  exit 1
fi

echo "Running smoke checks..."
curl -fsS http://localhost/api/health >/dev/null
curl -fsS http://localhost/ >/dev/null
docker compose -f docker-compose.yml ps
echo "Preflight passed. To stop stack: make preflight-down"
