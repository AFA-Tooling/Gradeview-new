#!/usr/bin/env bash
# Build all images locally for linux/amd64, ship them to the GCE VM, and bring up the stack.
# Usage: ./scripts/deploy-local.sh

set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-eecs-gradeview}"
ZONE="${GCP_ZONE:-us-west1-a}"
INSTANCE="${GCE_INSTANCE:-gradeview-vm}"
DEPLOY_DIR="${DEPLOY_DIR:-/home/gradeview/Grades}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

TAG="local-$(git rev-parse --short HEAD 2>/dev/null || date +%s)"
PLATFORM="linux/amd64"
TARBALL="/tmp/gradeview-images-${TAG}.tar.gz"

echo "==> Repo: $REPO_ROOT"
echo "==> Tag:  $TAG"
echo "==> VM:   $INSTANCE @ $ZONE ($PROJECT_ID)"
echo

# ---------- Build (linux/amd64) ----------
build_one() {
  local service="$1" context="$2" image="$3"
  local dockerfile_args=()
  if [[ -n "${4:-}" ]]; then
    dockerfile_args+=(-f "$4")
  fi
  echo "==> Building $service ($image)"
  docker buildx build \
    --platform "$PLATFORM" \
    -t "$image" \
    --load \
    "${dockerfile_args[@]}" \
    "$context"
}

API_IMG="gradeview/server:${TAG}"
WEB_IMG="gradeview/web:${TAG}"
GRADESYNC_IMG="gradeview/gradesync:${TAG}"
RP_IMG="gradeview/reverse-proxy:${TAG}"

build_one api        "./api"        "$API_IMG"
build_one web        "./website"    "$WEB_IMG"        "./website/server/Dockerfile"
build_one gradesync  "./gradesync"  "$GRADESYNC_IMG"
build_one reverse-proxy "./reverseProxy" "$RP_IMG"

# ---------- Save ----------
echo "==> Saving images to $TARBALL"
docker save "$API_IMG" "$WEB_IMG" "$GRADESYNC_IMG" "$RP_IMG" | gzip > "$TARBALL"
ls -lh "$TARBALL"

# ---------- Ship to VM ----------
echo "==> Uploading tarball + compose files to VM"
gcloud compute scp "$TARBALL" "$INSTANCE:~/gradeview-images.tar.gz" \
  --project "$PROJECT_ID" --zone "$ZONE"
gcloud compute scp docker-compose.yml docker-compose.prod.yml "$INSTANCE:~/" \
  --project "$PROJECT_ID" --zone "$ZONE"

# ---------- Apply on VM ----------
echo "==> Loading images and restarting stack on VM"
gcloud compute ssh "$INSTANCE" --project "$PROJECT_ID" --zone "$ZONE" \
  --command "TAG='$TAG' DEPLOY_DIR='$DEPLOY_DIR' bash -se" <<'REMOTE'
set -euo pipefail

CONTAINERS="gradeview-api gradeview-web gradeview-gradesync gradeview-reverse-proxy"

echo "[1/5] Loading images"
sudo docker load < ~/gradeview-images.tar.gz
rm -f ~/gradeview-images.tar.gz

echo "[2/5] Updating compose files in $DEPLOY_DIR"
sudo mkdir -p "$DEPLOY_DIR"
sudo mv ~/docker-compose.yml      "$DEPLOY_DIR/docker-compose.yml"
sudo mv ~/docker-compose.prod.yml "$DEPLOY_DIR/docker-compose.prod.yml"
sudo chown gradeview:gradeview "$DEPLOY_DIR/docker-compose.yml" "$DEPLOY_DIR/docker-compose.prod.yml"

cd "$DEPLOY_DIR"

echo "[3/5] Removing old containers"
sudo docker rm -f $CONTAINERS gradeview-cloud-sql-proxy 2>/dev/null || true

echo "[4/5] Starting stack with tag $TAG"
export CI_REGISTRY_IMAGE=gradeview
export REVERSE_PROXY_VERSION="$TAG"
export WEB_VERSION="$TAG"
export API_VERSION="$TAG"
export GRADESYNC_VERSION="$TAG"
sudo -E docker compose -p gradeview \
  -f docker-compose.yml -f docker-compose.prod.yml \
  up -d --no-build --remove-orphans

echo "[5/5] Waiting for health (max 6 min)"
for i in $(seq 1 60); do
  all_healthy=true
  for c in $CONTAINERS; do
    status=$(sudo docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$c" 2>/dev/null || echo missing)
    if [ "$status" != "healthy" ]; then
      all_healthy=false
      break
    fi
  done
  if [ "$all_healthy" = true ]; then
    echo "[OK] All services healthy at tag $TAG"
    sudo docker image prune -f >/dev/null 2>&1 || true
    exit 0
  fi
  sleep 6
done

echo "[ERROR] Services did not become healthy"
sudo docker compose -p gradeview -f docker-compose.yml -f docker-compose.prod.yml ps || true
for c in $CONTAINERS; do
  echo "--- logs for $c (last 30 lines) ---"
  sudo docker logs --tail 30 "$c" 2>&1 || true
done
exit 1
REMOTE

echo
echo "==> Cleaning up local tarball"
rm -f "$TARBALL"
echo "==> Done. Live at https://gradeview.eecs.berkeley.edu"
