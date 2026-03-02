#!/usr/bin/env bash

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$COMMON_DIR/../.." && pwd)"

cd_repo_root() {
  cd "$REPO_ROOT"
}

log_info() {
  echo "$1"
}

port_in_use() {
  local port="$1"
  lsof -Pi ":${port}" -sTCP:LISTEN -t >/dev/null 2>&1
}

show_port_usage() {
  local port="$1"
  lsof -Pi ":${port}" -sTCP:LISTEN
}

confirm_and_kill_port() {
  local port="$1"
  local reply

  read -r -p "Kill process on port ${port}? [y/N] " -n 1 reply
  echo

  if [[ "$reply" =~ ^[Yy]$ ]]; then
    lsof -Pi ":${port}" -sTCP:LISTEN -t | xargs kill -9
    echo "✓ Killed process on port ${port}"
  else
    echo "Aborted."
    return 1
  fi
}
