#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID:-1} -ne 0 ]]; then echo 'Запустите установщик через sudo'; exit 1; fi
# Works with the source tree, not an arbitrary working directory.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source /etc/os-release
if [[ "${ID:-}" != debian || "${VERSION_ID:-}" != 13 ]]; then
  echo "Поддерживается Debian 13 Trixie; обнаружено ${PRETTY_NAME:-неизвестно}." >&2
  exit 1
fi
if [[ "$(uname -m)" != x86_64 ]]; then echo 'MVP поддерживает только amd64/x86_64' >&2; exit 1; fi
if [[ "${ROOT}" == /opt/netlab ]]; then echo 'Установщик запущен из рабочего каталога /opt/netlab, используйте исходники из другого места' >&2; exit 1; fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates golang-go qemu-system-x86 qemu-utils openvswitch-switch iproute2 openssl curl vpcs novnc

if ! id netlab-vm &>/dev/null; then
  useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin netlab-vm
fi
if getent group kvm &>/dev/null; then usermod -aG kvm netlab-vm; fi

mkdir -p /opt/netlab /etc/netlab /var/lib/netlab/images /var/lib/netlab/runtime
chmod 0755 /var/lib/netlab /var/lib/netlab/images /var/lib/netlab/runtime
install -m 0644 "$ROOT/README.md" /opt/netlab/README.md
cp -a "$ROOT/web" /opt/netlab/
if [[ -f "$ROOT/web/next/index.html" ]]; then
  echo "Vue-редактор будет доступен по /next/"
else
  echo "Vue-редактор не собран: запустите от обычного пользователя scripts/build-frontend.sh до установки."
fi
# Xterm assets are served from the same origin (works behind a reverse proxy).
# Cached files are retained when offline to avoid breaking existing consoles.
if ! bash "$ROOT/scripts/install-xterm-assets.sh" /opt/netlab/web; then
  echo "ПРЕДУПРЕЖДЕНИЕ: xterm.js не загружен. Консоль будет работать в резервном режиме." >&2
fi
mkdir -p /opt/netlab/scripts
install -m 0755 "$ROOT/scripts/diagnose-qemu.sh" /opt/netlab/scripts/diagnose-qemu.sh
install -m 0755 "$ROOT/scripts/check-host.sh" /opt/netlab/scripts/check-host.sh
install -m 0755 "$ROOT/scripts/install-xterm-assets.sh" /opt/netlab/scripts/install-xterm-assets.sh
install -m 0755 "$ROOT/scripts/build-frontend.sh" /opt/netlab/scripts/build-frontend.sh
chmod -R a+rX /opt/netlab/web
(cd "$ROOT" && GOTOOLCHAIN=local go build -trimpath -ldflags='-s -w' -o /usr/local/bin/netlab.new ./cmd/netlab)
mv -f /usr/local/bin/netlab.new /usr/local/bin/netlab
chmod 0755 /usr/local/bin/netlab

if [[ ! -e /etc/netlab/netlab.env ]]; then
  umask 077
  printf 'NETLAB_ADMIN_TOKEN=%s\n' "$(openssl rand -hex 32)" > /etc/netlab/netlab.env
fi
chmod 0600 /etc/netlab/netlab.env
install -m 0644 "$ROOT/packaging/netlab.service" /etc/systemd/system/netlab.service
systemctl daemon-reload
systemctl enable --now openvswitch-switch
systemctl enable netlab
systemctl restart netlab

# Check the deployed service using the same user as actual QEMU/VPCS guests.
# A warning does not roll back an otherwise successful installation.
echo ''
echo 'Проверка работоспособности NetLab после установки...'
for attempt in 1 2 3 4 5; do
  if curl -fsS --max-time 2 http://127.0.0.1:8080/api/health >/dev/null 2>&1; then break; fi
  sleep 1
done
if ! bash /opt/netlab/scripts/check-host.sh; then
  echo 'ПРЕДУПРЕЖДЕНИЕ: preflight обнаружил неполадки; подробности выше.' >&2
  echo 'Повторная проверка: sudo bash /opt/netlab/scripts/check-host.sh' >&2
fi

echo ''
echo 'NetLab установлен.'
echo 'Адрес: http://<IP_сервера>:8080 (по умолчанию 0.0.0.0:8080)'
echo 'ОГРАНИЧЬТЕ порт 8080 межсетевым экраном. Для внешнего доступа используйте HTTPS reverse proxy.'
echo 'Токен: sudo cat /etc/netlab/netlab.env'
echo 'С другого компьютера: ssh -L 8080:127.0.0.1:8080 <user>@<server>'
echo 'Состояние: sudo systemctl status netlab'
echo 'Проверка готовности: sudo bash /opt/netlab/scripts/check-host.sh'
echo 'Диагностика QEMU: sudo bash /opt/netlab/scripts/diagnose-qemu.sh'
