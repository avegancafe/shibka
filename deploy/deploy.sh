#!/usr/bin/env bash
#
# deploy/deploy.sh — native build-and-deploy on the (arm64) box.
#
# Pulls the latest source, builds the Shibka image locally (no registry, no
# QEMU), runs the idempotent DB migration (also run on container start), and
# (re)starts the app. Idempotent; safe to re-run. This is what the GitHub
# Actions deploy invokes over SSH.
#
#   ./deploy/deploy.sh            # deploy the current branch's latest commit
#   ./deploy/deploy.sh <git-ref>  # deploy/rollback to a specific commit or tag
#
# Requires: a git checkout of this repo on the box, deploy/.env filled in (see
# env.production.sample), and Docker with the compose plugin. Caddy must already
# be routing shibka.kyleholzinger.dev -> shibka:3000 (one-time; see DEPLOY.md).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE="docker compose -p shibka -f $SCRIPT_DIR/docker-compose.app.yml"
REF="${1:-}"

cd "$REPO_ROOT"

if [ ! -f "$SCRIPT_DIR/.env" ]; then
  echo "ERROR: $SCRIPT_DIR/.env not found — copy env.production.sample and fill it in." >&2
  exit 1
fi

echo "==> Updating source"
git fetch --all --prune
if [ -n "$REF" ]; then
  git checkout "$REF"
else
  git pull --ff-only
fi
echo "    HEAD now at $(git rev-parse --short HEAD)"

# Ensure the shared proxy network exists so the app can join it (Caddy owns it;
# create it here if the proxy hasn't been started yet).
docker network inspect proxy_net >/dev/null 2>&1 || docker network create proxy_net

echo "==> Building image natively (arm64)"
$COMPOSE build

echo "==> Starting app"
$COMPOSE up -d --remove-orphans

echo "==> Waiting for health"
for i in $(seq 1 30); do
  if docker exec shibka node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    echo "    healthy — deployed $(git rev-parse --short HEAD)"
    exit 0
  fi
  sleep 2
done

echo "ERROR: app did not become healthy in time. Recent logs:" >&2
docker logs --tail 40 shibka >&2
exit 1
