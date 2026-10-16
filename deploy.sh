#!/usr/bin/env bash
# Deployt MathRacer auf server.local via Docker Compose.
# Nutzung:  SSH_HOST=root@server.local HOST_PORT=3001 ./deploy.sh
set -euo pipefail
HOST="${SSH_HOST:-server.local}"
DIR="${REMOTE_DIR:-/opt/mathracer}"
PORT="${HOST_PORT:-3000}"
echo "Deploye nach $HOST:$DIR (Host-Port $PORT) ..."
ssh "$HOST" "mkdir -p $DIR"
rsync -az --delete --exclude node_modules --exclude .git --exclude .claude ./ "$HOST:$DIR/"
ssh "$HOST" "cd $DIR && HOST_PORT=$PORT docker compose up -d --build"
echo "Fertig. Erreichbar auf http://${HOST#*@}:$PORT"
