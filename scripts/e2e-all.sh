#!/usr/bin/env bash
# Run e2e scripts strictly one after another (they share the bestx account). Usage: scripts/e2e-all.sh jobs clothes police …
cd "$(dirname "$0")/.."
for n in "$@"; do
  echo "=== $n $(date +%H:%M:%S)"
  timeout 1800 npx tsx "scripts/e2e-$n.ts" > "/tmp/e2e-$n.log" 2>&1; code=$?
  echo "exit $code" >> "/tmp/e2e-$n.log"
  echo "    $n exit=$code pass=$(grep -c '^PASS' /tmp/e2e-$n.log) fail=$(grep -c '^FAIL' /tmp/e2e-$n.log)"
done
echo "=== done $(date +%H:%M:%S)"
