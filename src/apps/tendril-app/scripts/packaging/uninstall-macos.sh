#!/bin/bash
# Uninstall Tendril Desktop from a Mac.
#
# The macOS counterpart to the NSIS hooks in `../../src-tauri/nsis/installer.nsh`. A .dmg has no
# uninstall hook at all - dragging the app to the Trash removes `Tendril.app` and nothing else - so
# everything the app provisioned outside its bundle has to be cleaned up here: the LaunchAgent it
# registers and the `tendril`/`opencode` sidecars it copies into `<tendril home>/bin` on first run
# (see `src-tauri/src/service/provision.rs`).
#
# User data is preserved unless `--purge-data` is passed.
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

# 2. Remove application bundle.
#
# `APP_PATH` is overridable so the test suite can point this at a scratch directory. Without it,
# running these tests on a machine with Tendril installed would uninstall the developer's own copy.
APP_PATH="${TENDRIL_APP_PATH:-/Applications/Tendril.app}"
if [ -d "$APP_PATH" ]; then
    echo "==> Removing Application bundle at $APP_PATH..."
    rm -rf "$APP_PATH"
fi

TENDRIL_HOME="${TENDRIL_HOME:-$HOME/.tendril}"

# 3. Remove the sidecars the app provisioned into <tendril home>/bin.
#
# Named files rather than `rm -rf` on the directory, because `bin` is what Tendril puts on the PATH
# it hands to coding agents - a user may keep their own tools there, and those are not ours to
# delete. The trailing `rmdir` only succeeds if nothing else is left.
BIN_DIR="$TENDRIL_HOME/bin"
if [ -d "$BIN_DIR" ]; then
    echo "==> Removing background service binaries at $BIN_DIR..."
    rm -f "$BIN_DIR/tendril" "$BIN_DIR/opencode" "$BIN_DIR/.provisioned"
    # Staging leftovers from a provisioning run that was interrupted part-way.
    rm -f "$BIN_DIR/.tendril.new" "$BIN_DIR/.tendril.old"
    rm -f "$BIN_DIR/.opencode.new" "$BIN_DIR/.opencode.old"
    rmdir "$BIN_DIR" 2>/dev/null || echo "    (kept $BIN_DIR - it still holds files we did not install)"
fi

# 4. Check data retention
if [ "$PURGE_DATA" = true ]; then
    echo "==> CAUTION: Purging user workspace data at $TENDRIL_HOME..."
    rm -rf "$TENDRIL_HOME"
    echo "==> Data directory removed."
else
    echo "==> Preserving user workspace and configuration data at $TENDRIL_HOME."
    echo "    (All plans, repositories, databases, and configs remain untouched)."
fi

echo "==> Tendril uninstallation complete."
