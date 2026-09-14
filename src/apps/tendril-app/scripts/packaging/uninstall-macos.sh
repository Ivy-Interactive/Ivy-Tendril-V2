#!/bin/bash
set -euo pipefail

PURGE_DATA=false
for arg in "$@"; do
    if [ "$arg" = "--purge-data" ]; then
        PURGE_DATA=true
    fi
done

echo "==> Uninstalling Tendril Desktop Application..."

# 1. Stop and remove launchd background service if registered
PLIST="$HOME/Library/LaunchAgents/com.spacecorps.tendril.service.plist"
if [ -f "$PLIST" ]; then
    echo "==> Removing launchd service..."
    UID_NUM=$(id -u)
    launchctl bootout "gui/$UID_NUM" "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
fi

# 2. Remove application bundle
APP_PATH="/Applications/Tendril.app"
if [ -d "$APP_PATH" ]; then
    echo "==> Removing Application bundle at $APP_PATH..."
    rm -rf "$APP_PATH"
fi

# 3. Check data retention
TENDRIL_HOME="${TENDRIL_HOME:-$HOME/.tendril}"
if [ "$PURGE_DATA" = true ]; then
    echo "==> CAUTION: Purging user workspace data at $TENDRIL_HOME..."
    rm -rf "$TENDRIL_HOME"
    echo "==> Data directory removed."
else
    echo "==> Preserving user workspace and configuration data at $TENDRIL_HOME."
    echo "    (All plans, repositories, databases, and configs remain untouched)."
fi

echo "==> Tendril uninstallation complete."
