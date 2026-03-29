#!/bin/bash
# Work Clip Sync — one-time installer for Mac mini
# Run from the sync/ directory: bash install.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST_SRC="$SCRIPT_DIR/com.steve.worksync.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/com.steve.worksync.plist"
NODE_PATH="$(which node 2>/dev/null || echo '')"
LOG_FILE="$HOME/Library/Logs/worksync.log"

echo "=== Work Clip Sync Installer ==="
echo ""

# Check node
if [ -z "$NODE_PATH" ]; then
  echo "ERROR: node is not found in PATH. Install Node.js first (brew install node)."
  exit 1
fi
echo "✓ Node.js found at: $NODE_PATH"

# Install @supabase/supabase-js if needed
echo ""
echo "Installing @supabase/supabase-js…"
cd "$SCRIPT_DIR"
if [ ! -f package.json ]; then
  npm init -y --quiet > /dev/null 2>&1
fi
npm install @supabase/supabase-js --save --quiet
echo "✓ Dependencies installed"

# Create log file
mkdir -p "$HOME/Library/Logs"
touch "$LOG_FILE"
echo "✓ Log file: $LOG_FILE"

# Patch the plist with the real node path and script path
SYNC_SCRIPT="$SCRIPT_DIR/sync.js"
sed \
  -e "s|/usr/local/bin/node|$NODE_PATH|g" \
  -e "s|SYNC_SCRIPT_PATH|$SYNC_SCRIPT|g" \
  "$PLIST_SRC" > "$PLIST_DEST"
echo "✓ plist installed to: $PLIST_DEST"

# Unload existing job if running
launchctl unload "$PLIST_DEST" 2>/dev/null || true

# Load the job
launchctl load "$PLIST_DEST"
echo "✓ launchd job loaded (runs every 5 minutes, starts on login)"

echo ""
echo "=== Installation complete ==="
echo ""
echo "Test it now by running:  node $SYNC_SCRIPT"
echo "View logs:               tail -f $LOG_FILE"
echo "Uninstall:               launchctl unload $PLIST_DEST && rm $PLIST_DEST"
