#!/usr/bin/env bash
# Rebuild and (re)start the server detached on port 3000.
set -e
cd "$(dirname "$0")/.."
npm run build >/tmp/bl-build.log 2>&1 || { tail -30 /tmp/bl-build.log; exit 1; }
pkill -f "dist-server/server/src/index.js" || true
pkill -f "tsx server/src/index.ts" || true
sleep 1
PORT=3000 setsid nohup node dist-server/server/src/index.js >server.log 2>&1 < /dev/null &
for i in $(seq 1 30); do curl -sf localhost:3000/api/health >/dev/null && { echo "server up (pid $(pgrep -f dist-server/server/src/index.js))"; exit 0; }; sleep 0.5; done
echo "server failed to start"; tail -20 server.log; exit 1
