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
  ca-certificates golang-go qemu-system-x86 qemu-utils openvswitch-switch iproute2 openssl vpcs

if ! id netlab-vm &>/dev/null; then
  useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin netlab-vm
fi
if getent group kvm &>/dev/null; then usermod -aG kvm netlab-vm; fi

mkdir -p /opt/netlab /etc/netlab /var/lib/netlab/images /var/lib/netlab/runtime
chmod 0755 /var/lib/netlab /var/lib/netlab/images /var/lib/netlab/runtime
install -m 0644 "$ROOT/README.md" /opt/netlab/README.md
cp -a "$ROOT/web" /opt/netlab/
mkdir -p /opt/netlab/scripts
install -m 0755 "$ROOT/scripts/diagnose-qemu.sh" /opt/netlab/scripts/diagnose-qemu.sh
install -m 0755 "$ROOT/scripts/check-host.sh" /opt/netlab/scripts/check-host.sh
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

echo ''
echo 'NetLab установлен.'
echo 'Адрес: http://127.0.0.1:8080'
echo 'Токен: sudo cat /etc/netlab/netlab.env'
echo 'С другого компьютера: ssh -L 8080:127.0.0.1:8080 <user>@<server>'
echo 'Состояние: sudo systemctl status netlab'
echo 'Диагностика QEMU: sudo bash /opt/netlab/scripts/diagnose-qemu.sh'
