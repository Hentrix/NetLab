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
# The lockfile is not tracked in this repository yet. An existing local lock
# can be stale after dependency changes (e.g. lucide-vue-next -> @lucide/vue).
# npm install reconciles it with package.json; npm ci refuses to do that.
npm install --no-audit --no-fund
npm run build
printf '\nVue интерфейс собран: %s/web/next/\n' "$ROOT"
