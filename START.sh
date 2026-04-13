#!/bin/bash
# Launch TradingView Desktop with Chrome DevTools Protocol (CDP) on port 9222
# Run this before using Claude Code with TradingView MCP tools

# Kill any existing TradingView process
pkill -f TradingView 2>/dev/null
sleep 1

# Launch with CDP
/Applications/TradingView.app/Contents/MacOS/TradingView --remote-debugging-port=9222 &

# Wait for CDP to be ready
echo "Waiting for TradingView CDP..."
for i in $(seq 1 15); do
  if curl -s http://localhost:9222/json/version > /dev/null 2>&1; then
    echo "TradingView CDP is live on port 9222"
    exit 0
  fi
  sleep 2
done

echo "Warning: CDP did not respond within 30s. TradingView may still be loading."
