#!/usr/bin/env bash
# Compatibility shim: uninstall from Antigravity IDE specifically.
#
# The real script is uninstall-extension.sh, which handles the whole VS Code
# family. This entry point is kept because src/scripts/test-skills-manifests.sh
# and older docs reference it by name.
set -euo pipefail
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/uninstall-extension.sh" \
  --ide antigravity-ide,antigravity "$@"
