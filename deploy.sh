#!/usr/bin/env bash
# Deployt MathRacer auf server.local via Docker Compose.
# Nutzung:  SSH_HOST=benutzer@server.local ./deploy.sh
set -euo pipefail
HOST="${SSH_HOST:-server.local}"
DIR="${REMOTE_DIR:-~/mathracer}"
echo "Deploye nach $HOST:$DIR ..."
ssh "$HOST" "mkdir -p $DIR"
rsync -az --delete --exclude node_modules --exclude .git --exclude .claude ./ "$HOST:$DIR/"
ssh "$HOST" "cd $DIR && docker compose up -d --build"
echo "Fertig. Erreichbar auf http://server.local:3000"
