#!/bin/bash
# start-with-agent.sh — Start x402 backend + community agent companion process
# Usage (Render): Set start command to "bash start-with-agent.sh"
# The backend's lib/agent-process.js handles spawning automatically,
# but this script is an alternative for environments that need explicit process management.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="$SCRIPT_DIR/../x402-community-agent"

# Install agent dependencies if needed
if [ -d "$AGENT_DIR" ] && [ ! -d "$AGENT_DIR/node_modules" ]; then
    echo "[start] Installing community agent dependencies..."
    cd "$AGENT_DIR" && npm install --production
    cd "$SCRIPT_DIR"
fi

# Start backend (agent is spawned automatically via lib/agent-process.js)
echo "[start] Starting x402 backend..."
exec node "$SCRIPT_DIR/server.js"
