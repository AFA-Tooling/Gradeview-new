#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"
cd_repo_root

NO_CACHE=""
if [[ "${1:-}" == "--no-cache" ]]; then
	NO_CACHE="--no-cache"
fi

build_with_retry() {
	local attempts=3
	local delay=5
	local count=1

	until docker compose -f docker-compose.dev.yml build $NO_CACHE; do
		if [[ $count -ge $attempts ]]; then
			echo "Build failed after $attempts attempts."
			return 1
		fi
		echo "Build failed (attempt $count/$attempts). Retrying in ${delay}s..."
		sleep "$delay"
		count=$((count + 1))
	done
}

docker compose -f docker-compose.dev.yml down
build_with_retry
docker compose -f docker-compose.dev.yml up -d --force-recreate -V
