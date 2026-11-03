#!/usr/bin/env bash
# Pornește tot: stack Docker (cu worker + PaddleOCR) + frontend dev.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

# Un backend/worker local consumă din același Redis și fură joburile stack-ului Docker.
pids="$(pgrep -f "$root/packages/backend/node_modules/.*tsx" || true)"
if [ -n "$pids" ]; then
  echo "Rulează deja backend/worker local. Oprește-le cu: kill $(echo $pids)" >&2
  ps -o pid,lstart,command -p $pids >&2
  exit 1
fi

pnpm install
WITH_PADDLE=true docker compose --profile worker up -d --build --remove-orphans --wait
pnpm dev:frontend
