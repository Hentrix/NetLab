#!/usr/bin/env bash
set -Eeuo pipefail
# Pinned browser-ready UMD distributions; no runtime CDN calls are necessary.
WEB_DIR="${1:-/opt/netlab/web}"
DEST="$WEB_DIR/vendor"
mkdir -p "$DEST"
fetch() {
  local url="$1" target="$2" staging
  if [[ -s "$DEST/$target" ]]; then return 0; fi
  staging="$(mktemp "$DEST/.xterm.XXXXXXXX")"
  if ! curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location --retry 2 --connect-timeout 12 --max-time 80 "$url" -o "$staging"; then
    rm -f "$staging"
    return 1
  fi
  if [[ ! -s "$staging" ]]; then rm -f "$staging"; return 1; fi
  mv -f "$staging" "$DEST/$target"
  chmod 0644 "$DEST/$target"
}
fetch 'https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.js' 'xterm.js'
fetch 'https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.css' 'xterm.css'
fetch 'https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.js' 'addon-fit.js'
