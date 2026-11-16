#!/usr/bin/env bash
set -u
printf '\nNetLab Debian host diagnostics\n'
printf 'OS: '; . /etc/os-release; printf '%s\n' "${PRETTY_NAME:-unknown}"
printf 'Kernel: '; uname -r
for cmd in qemu-system-x86_64 qemu-img ovs-vsctl ip; do
  if command -v "$cmd" >/dev/null 2>&1; then printf '[ok] %s\n' "$cmd"; else printf '[missing] %s\n' "$cmd"; fi
done
if [[ -r /dev/kvm && -w /dev/kvm ]]; then echo '[ok] /dev/kvm accessible'; else echo '[warn] KVM unavailable (QEMU uses slow TCG)'; fi
if id netlab-vm >/dev/null 2>&1; then id netlab-vm; else echo '[missing] netlab-vm system user'; fi
if command -v systemctl >/dev/null 2>&1; then systemctl is-active --quiet openvswitch-switch && echo '[ok] Open vSwitch active' || echo '[warn] Open vSwitch inactive'; fi
