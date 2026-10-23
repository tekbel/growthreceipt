#!/usr/bin/env bash
# Usage: wait_for_deploy.sh <name> <version url> <service path>
# Waits until the live service reports a commit that contains the newest change to its path.
set -uo pipefail
name=$1 url=$2 path=$3
want=$(git log -1 --format=%H "${GITHUB_SHA:-HEAD}" -- "$path")
live=""
for _ in $(seq 1 60); do
  live=$(curl -fsS --max-time 10 "$url" | jq -r '.commit // empty' 2>/dev/null || true)
  if [ -n "$live" ] && git merge-base --is-ancestor "$want" "$live" 2>/dev/null; then
    echo "$name is live at $live"
    exit 0
  fi
  sleep 15
done
echo "::error::$name did not deploy $want within 15 minutes. Live commit: ${live:-unknown}. Open the $name service in Railway and run Deploy latest commit."
exit 1
