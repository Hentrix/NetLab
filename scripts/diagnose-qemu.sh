#!/usr/bin/env bash
# Read-only investigation of QEMU spawn failures. Does not start a guest or alter host networking.
set -u
printf '\n=== NetLab QEMU diagnostics ===\n'
printf 'Date: '; date -Is
printf 'Kernel: '; uname -sr
printf 'Virtualized host: '; systemd-detect-virt 2>/dev/null || true
printf '\n-- NetLab service --\n'
systemctl show netlab -p User -p Group -p AmbientCapabilities -p NoNewPrivileges -p ProtectSystem -p ProtectHome -p PrivateDevices -p RestrictNamespaces -p SystemCallFilter -p ExecStart -p FragmentPath --no-pager 2>&1 || true
printf '\n-- qemu command and permissions --\n'
command -v qemu-system-x86_64 || true
if command -v qemu-system-x86_64 >/dev/null 2>&1; then
  bin=$(command -v qemu-system-x86_64)
  ls -l "${bin}" || true
  command -v getcap >/dev/null 2>&1 && getcap "${bin}" || true
  command -v namei >/dev/null 2>&1 && namei -l "${bin}" || true
  printf '\n-- QEMU binary as netlab-vm (no guest) --\n'
  if id netlab-vm >/dev/null 2>&1; then
    runuser -u netlab-vm -- "${bin}" --version 2>&1 || true
  fi
fi
printf '\n-- VPCS binary and user permissions --\n'
if command -v vpcs >/dev/null 2>&1; then
  bin=$(command -v vpcs)
  ls -l "$bin" || true
  command -v namei >/dev/null 2>&1 && namei -l "$bin" || true
  if id netlab-vm >/dev/null 2>&1; then
    runuser -u netlab-vm -- "$bin" -v </dev/null 2>&1 || true
  fi
else
  echo 'VPCS binary not found'
fi
printf '\n-- VM service user and KVM --\n'
id netlab-vm 2>&1 || true
ls -l /dev/kvm 2>&1 || true
printf '\n-- Service process security state --\n'
pid=$(systemctl show -P MainPID netlab 2>/dev/null || true)
if [[ "$pid" =~ ^[0-9]+$ ]] && ((pid > 0)) && [[ -r /proc/${pid}/status ]]; then
  grep -E '^(Uid|Gid|Groups|CapPrm|CapEff|CapBnd|CapAmb|NoNewPrivs|Seccomp):' "/proc/${pid}/status" || true
  cap_eff=$(awk '/^CapEff:/ {print $2}' "/proc/${pid}/status")
  if [[ $cap_eff =~ ^[[:xdigit:]]+$ ]]; then
    if (( (16#$cap_eff & 128) != 0 )); then
      echo 'CAP_SETUID (effective): yes; Go may switch to netlab-vm'
    else
      echo 'CAP_SETUID (effective): NO; Go syscall.Credential will fail with EPERM'
    fi
  fi
  if (( (16#$cap_eff & 64) != 0 )); then
    echo 'CAP_SETGID (effective): yes; Go may switch group and supplementary groups'
  else
    echo 'CAP_SETGID (effective): NO; Go syscall.Credential may fail with EPERM'
  fi
fi
printf '\n-- Last NetLab messages --\n'
journalctl -u netlab --no-pager -n 35 2>&1 || true
printf '\n=== End of report ===\n'
