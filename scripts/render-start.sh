#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${RENDER_NODE_DIR:-$PWD/.render-node}"
NODE_BIN_DIR="$INSTALL_DIR/bin"

if [ -d "$NODE_BIN_DIR" ]; then
  export PATH="$NODE_BIN_DIR:$PATH"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node runtime not available. Ensure render-build.sh installed Node." >&2
  exit 1
fi

if [ ! -f "server/dist/index.js" ]; then
  echo "Compiled server entry not found at server/dist/index.js. Did the build step run?" >&2
  exit 1
fi

exec env NODE_ENV=${NODE_ENV:-production} node server/dist/index.js
