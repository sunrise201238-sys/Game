#!/usr/bin/env bash
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-20.11.1}"
INSTALL_DIR="${RENDER_NODE_DIR:-$PWD/.render-node}"
NODE_BIN_DIR="$INSTALL_DIR/bin"

ensure_node() {
  if command -v node >/dev/null 2>&1; then
    local current
    current=$(node -v 2>/dev/null || echo "")
    if [[ "$current" == v20* ]]; then
      echo "Detected Node ${current}"
      return
    fi
    echo "Found Node ${current:-unknown}; installing Node ${NODE_VERSION} locally to satisfy build requirements..."
  else
    echo "Node not found in PATH. Installing Node ${NODE_VERSION} locally..."
  fi
  mkdir -p "$INSTALL_DIR"
  tmp_archive="node-v${NODE_VERSION}-linux-x64.tar.xz"
  fetch "https://nodejs.org/dist/v${NODE_VERSION}/${tmp_archive}" "$tmp_archive"
  tar -xJf "$tmp_archive" -C "$INSTALL_DIR" --strip-components=1
  rm "$tmp_archive"
  export PATH="$NODE_BIN_DIR:$PATH"
  echo "Installed Node to $INSTALL_DIR"
}

ensure_path() {
  if [ -d "$NODE_BIN_DIR" ] && ! echo ":$PATH:" | grep -q ":$NODE_BIN_DIR:"; then
    export PATH="$NODE_BIN_DIR:$PATH"
  fi
}

ensure_npm() {
  if command -v npm >/dev/null 2>&1; then
    return
  fi
  if command -v corepack >/dev/null 2>&1; then
    corepack enable >/dev/null 2>&1 || true
    corepack prepare npm@10 --activate >/dev/null 2>&1 || true
  fi
  if ! command -v npm >/dev/null 2>&1; then
    echo "npm is still unavailable after attempting to activate via corepack" >&2
    exit 1
  fi
}

fetch() {
  local url="$1"
  local destination="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$destination"
    return
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -qO "$destination" "$url"
    return
  fi
  echo "Neither curl nor wget is available to download $url" >&2
  exit 1
}

ensure_node
ensure_path
ensure_npm

npm config set fund false
npm config set audit false
npm config set registry https://registry.npmjs.org/
npm config delete proxy >/dev/null 2>&1 || true
npm config delete https-proxy >/dev/null 2>&1 || true

npm install --workspaces --no-audit --no-fund

npm run build
