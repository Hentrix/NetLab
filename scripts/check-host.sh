#!/usr/bin/env bash
# NetLab post-install preflight for Debian 13. Read-only: no VM, TAP or OVS
# network objects are created. Run as root to test the real VM identity.
set -uo pipefail

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'HELP'
Использование: sudo bash scripts/check-host.sh [--strict-kvm]
Проверяет установленный NetLab, запуск QEMU от netlab-vm, доступ
к KVM и хранилищу, Open vSwitch и HTTP health endpoint.
Без --strict-kvm отсутствие KVM — предупреждение (доступен медленный TCG).
Не запускает гостевые VM и не изменяет системные настройки.
HELP
  exit 0
fi
if [[ $# -gt 1 || ( $# -eq 1 && "${1}" != "--strict-kvm" ) ]]; then
  echo "Неизвестный аргумент. Используйте --help." >&2
  exit 2
fi
if [[ ${EUID:-1} -ne 0 ]]; then
  echo "Для проверки прав netlab-vm запустите через sudo." >&2
  exit 2
fi

strict_kvm=0
[[ "${1:-}" == "--strict-kvm" ]] && strict_kvm=1
errors=0
warnings=0
ok(){ printf '[OK] %s\n' "$*"; }
fail(){ printf '[FAIL] %s\n' "$*" >&2; ((errors+=1)); }
warn(){ printf '[WARN] %s\n' "$*"; ((warnings+=1)); }
require_command(){
  if command -v "$1" >/dev/null 2>&1; then ok "Команда $1 найдена"; else fail "Не установлена команда $1"; fi
}
printf '\n=== NetLab preflight (Debian 13, SeaBIOS) ===\n'
if [[ -r /etc/os-release ]]; then
  . /etc/os-release
  printf 'Система: %s\n' "${PRETTY_NAME:-unknown}"
  if [[ "${ID:-}" != debian || "${VERSION_ID:-}" != 13 ]]; then
    warn "Основная поддерживаемая система — Debian 13 Trixie"
  fi
else
  fail "Не обнаружен /etc/os-release"
fi
printf 'Ядро: '; uname -r
printf 'Виртуализация хоста: '
if command -v systemd-detect-virt >/dev/null 2>&1; then
  systemd-detect-virt 2>/dev/null || echo "не обнаружена"
else
  echo "не определена"
fi

for cmd in qemu-system-x86_64 qemu-img ovs-vsctl ip runuser; do
  require_command "$cmd"
done
if ! id netlab-vm >/dev/null 2>&1; then
  fail "Отсутствует системный пользователь netlab-vm"
else
  ok "Пользователь netlab-vm существует"
  if runuser -u netlab-vm -- test -r /var/lib/netlab/images &&
     runuser -u netlab-vm -- test -x /var/lib/netlab/images; then
    ok "netlab-vm может читать каталог образов"
  else
    fail "netlab-vm не может прочитать /var/lib/netlab/images"
  fi
  if runuser -u netlab-vm -- test -x /var/lib/netlab/runtime; then
    ok "netlab-vm может проходить в каталог runtime"
  else
    fail "netlab-vm не может проходить в /var/lib/netlab/runtime"
  fi
  if [[ -e /dev/kvm ]] && runuser -u netlab-vm -- test -r /dev/kvm &&
      runuser -u netlab-vm -- test -w /dev/kvm; then
    ok "netlab-vm имеет доступ на чтение и запись /dev/kvm"
  elif ((strict_kvm)); then
    fail "KVM недоступен пользователю netlab-vm; проверьте /dev/kvm, группу kvm и nested virtualization"
  else
    warn "KVM недоступен пользователю netlab-vm: QEMU использует медленный TCG"
  fi
  if command -v qemu-system-x86_64 >/dev/null 2>&1; then
    begin=$(date +%s%3N)
    if output=$(timeout 8 runuser -u netlab-vm -- qemu-system-x86_64 --version 2>&1); then
      elapsed=$(( $(date +%s%3N) - begin ))
      ok "QEMU запускается от netlab-vm (версия за ${elapsed} мс, без запуска VM)"
    else
      fail "Не удаётся исполнить QEMU от netlab-vm: ${output}"
    fi
  fi
  if command -v vpcs >/dev/null 2>&1; then
    if output=$(timeout 5 runuser -u netlab-vm -- vpcs -v </dev/null 2>&1); then
      ok "VPCS исполняется от netlab-vm"
    else
      warn "VPCS не прошёл проверку -v: ${output}"
    fi
  else
    warn "VPCS не установлен (необязателен для QEMU)"
  fi
fi

if command -v qemu-img >/dev/null 2>&1; then
  if qemu-img --version >/dev/null 2>&1; then
    ok "qemu-img доступен для создания и проверки QCOW2"
  else
    fail "qemu-img не запускается"
  fi
fi
if command -v systemctl >/dev/null 2>&1; then
  if systemctl is-active --quiet openvswitch-switch; then
    ok "Сервис Open vSwitch активен"
    if command -v ovs-vsctl >/dev/null 2>&1 && timeout 5 ovs-vsctl --timeout=4 show >/dev/null 2>&1; then
      ok "Управляющий сокет Open vSwitch отвечает"
    else
      fail "Open vSwitch запущен, но ovs-vsctl не отвечает"
    fi
  else
    fail "Сервис openvswitch-switch не запущен"
  fi
  if systemctl is-active --quiet netlab; then
    ok "Сервис netlab активен"
  else
    fail "Сервис netlab не активен"
  fi
  unit=$(systemctl show netlab -p AmbientCapabilities --value 2>/dev/null || true)
  if [[ "$unit" == *CAP_SETUID* && "$unit" == *CAP_SETGID* ]]; then
    ok "systemd предоставляет CAP_SETUID и CAP_SETGID"
  else
    warn "Проверьте CAP_SETUID/CAP_SETGID: systemctl show = ${unit:-пусто}"
  fi
else
  fail "systemctl недоступен"
fi
if command -v curl >/dev/null 2>&1; then
  health_url="${NETLAB_PREFLIGHT_URL:-http://127.0.0.1:8080/api/health}"
  if response=$(curl -fsS --max-time 4 "$health_url" 2>&1); then
    if [[ "$response" == *'"status":"ok"'* ]]; then
      ok "HTTP /api/health отвечает"
    else
      fail "HTTP ответ не содержит status:ok: $response"
    fi
  else
    fail "HTTP /api/health недоступен ($health_url): $response"
  fi
else
  fail "curl не установлен"
fi

printf '\nРезультат: %d ошибок, %d предупреждений\n' "$errors" "$warnings"
if ((errors)); then
  echo 'NetLab не готов. Исправьте ошибки и повторите preflight.' >&2
  exit 1
fi
echo 'Базовые проверки пройдены. Это не тест загрузки гостевой ОС, TAP, KVM-ускорения или работы интерфейсов.'
