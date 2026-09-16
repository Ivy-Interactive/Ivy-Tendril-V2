#!/usr/bin/env bash
# Compatibility shim: install into Antigravity IDE specifically.
#
# The real script is install-extension.sh, which handles the whole VS Code
# family. This entry point is kept because src/scripts/test-skills-manifests.sh
# and older docs reference it by name.
#
# Prefers the current data folder (~/.antigravity-ide) and falls back to the
# older one (~/.antigravity). Extra arguments are passed straight through.
set -euo pipefail
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/install-extension.sh" \
  --ide antigravity-ide,antigravity "$@"
