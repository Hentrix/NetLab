#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ${EUID} -eq 0 ]]; then
  echo 'Собирайте Vue frontend под обычным пользователем, не через sudo.' >&2
  exit 1
fi
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  echo 'Для сборки необходимы Node.js >= 20.19 и npm (серверу для работы они не нужны).' >&2
  exit 1
fi
node -e 'const v=process.versions.node.split(".").map(Number);if(v[0]<20||(v[0]===20&&v[1]<19)){console.error("Требуется Node.js >= 20.19");process.exit(1)}'
cd "$ROOT/frontend"
# Lockfile is created on first install, then reused for deterministic builds.
if [[ -f package-lock.json ]]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
npm run build
printf '\nVue интерфейс собран: %s/web/next/\n' "$ROOT"
