#!/bin/bash
# Smartsheet On-Demand Runner — one-time installer for the Mac mini.
# Installs a launchd job that checks the "Run pull now" queue every 60s and
# runs your Smartsheet export when a request is waiting.
#
# Usage (from the sync/ directory):
#   bash install-runner.sh "<your export command>"
#
# Example:
#   bash install-runner.sh "/usr/local/bin/node /Users/steve/workpm/smartsheet-export.js"
#
# The export command is whatever performs the 6pm pull today. If you don't have
# a standalone command for it, tell Claude and it will generate a self-contained
# sync/smartsheet-export.js you can point this at.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXPORT_CMD="$1"

if [ -z "$EXPORT_CMD" ]; then
  echo "ERROR: pass your Smartsheet export command as the first argument."
  echo 'Example: bash install-runner.sh "/usr/local/bin/node /Users/steve/workpm/smartsheet-export.js"'
  exit 1
fi

PLIST_SRC="$SCRIPT_DIR/com.steve.smartsheet-runner.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/com.steve.smartsheet-runner.plist"
NODE_PATH="$(which node 2>/dev/null || echo '')"
LOG_FILE="$HOME/Library/Logs/smartsheet-runner.log"
RUNNER_SCRIPT="$SCRIPT_DIR/smartsheet-run-poller.js"

echo "=== Smartsheet On-Demand Runner Installer ==="
echo ""

if [ -z "$NODE_PATH" ]; then
  echo "ERROR: node is not found in PATH. Install Node.js first (brew install node)."
  exit 1
fi
echo "✓ Node.js found at: $NODE_PATH"

echo ""
echo "Installing @supabase/supabase-js…"
cd "$SCRIPT_DIR"
if [ ! -f package.json ]; then npm init -y --quiet > /dev/null 2>&1; fi
npm install @supabase/supabase-js --save --quiet
echo "✓ Dependencies installed"

mkdir -p "$HOME/Library/Logs"
touch "$LOG_FILE"
echo "✓ Log file: $LOG_FILE"

# Escape the export command for safe use as a sed replacement (delimiter is |).
ESC_CMD=$(printf '%s' "$EXPORT_CMD" | sed -e 's/[\\|&]/\\&/g')

sed \
  -e "s|/usr/local/bin/node|$NODE_PATH|g" \
  -e "s|RUNNER_SCRIPT_PATH|$RUNNER_SCRIPT|g" \
  -e "s|EXPORT_CMD_PLACEHOLDER|$ESC_CMD|g" \
  "$PLIST_SRC" > "$PLIST_DEST"
echo "✓ plist installed to: $PLIST_DEST"

launchctl unload "$PLIST_DEST" 2>/dev/null || true
launchctl load "$PLIST_DEST"
echo "✓ launchd job loaded (checks the queue every 60s, starts on login)"

echo ""
echo "=== Installation complete ==="
echo ""
echo "Test now:   SMARTSHEET_EXPORT_CMD='$EXPORT_CMD' node $RUNNER_SCRIPT"
echo "View logs:  tail -f $LOG_FILE"
echo "Uninstall:  launchctl unload $PLIST_DEST && rm $PLIST_DEST"
