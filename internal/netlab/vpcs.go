package netlab

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
)

// vpcsArgs uses a single PC and the persistent TAP created for that node.
// No QEMU image, KVM or libvirt is involved.
func vpcsArgs(tap string) []string { return []string{"-i", "1", "-e", "-d", tap} }

// StartVPCS is an experimental VPCS adapter. It runs the Debian vpcs binary
// as netlab-vm and attaches its one TAP to NetLab's existing isolated OVS L2.
func (e *Engine) StartVPCS(l Lab, n Node) error {
	if n.Engine != "vpcs" || portCapacity(&n) != 1 {
		return errors.New("VPCS требует ровно один Ethernet-порт")
	}
	if _, err := exec.LookPath("vpcs"); err != nil {
		return errors.New("VPCS не установлен: sudo apt install vpcs")
	}
	cred, uid, gid, err := vmCredential()
	if err != nil {
		return err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	k := key(l.ID, n.ID)
	if i := e.instances[k]; i != nil {
		if i.status == "running" {
			return nil
		}
		select {
		case <-i.done:
		default:
			return errors.New("предыдущий процесс VPCS ещё завершается")
		}
	}
	runtime := filepath.Join(e.data, "runtime", l.ID, n.ID)
	if err = os.MkdirAll(runtime, 0750); err != nil {
		return err
	}
	if err = os.Chown(filepath.Dir(runtime), uid, gid); err != nil {
		return err
	}
	if err = os.Chown(runtime, uid, gid); err != nil {
		return err
	}
	tap := tapName(n.ID, 0)
	_ = e.exec("ip", "link", "del", tap)
	if err = e.exec("ip", "tuntap", "add", "dev", tap, "mode", "tap", "user", strconv.Itoa(uid)); err != nil {
		return err
	}
	cleanup := func() { _ = e.exec("ip", "link", "del", tap) }
	if err = e.exec("ip", "link", "set", tap, "up"); err != nil {
		cleanup()
		return err
	}
	logFile, err := os.OpenFile(filepath.Join(runtime, "vpcs.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0640)
	if err != nil {
		cleanup()
		return err
	}
	cmd := exec.Command("vpcs", vpcsArgs(tap)...)
	cmd.Dir = runtime
	cmd.SysProcAttr = &syscall.SysProcAttr{Credential: cred, Setpgid: true}
	cmd.Stderr = logFile
	stdin, err := cmd.StdinPipe()
	if err != nil {
		_ = logFile.Close()
		cleanup()
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		_ = stdin.Close()
		_ = logFile.Close()
		cleanup()
		return err
	}
	if err = cmd.Start(); err != nil {
		_ = stdin.Close()
		_ = stdout.Close()
		_ = logFile.Close()
		cleanup()
		return fmt.Errorf("запуск VPCS: %w", err)
	}
	_ = logFile.Close()
	ins := &Instance{cmd: cmd, done: make(chan struct{}), engine: "vpcs", taps: []string{tap}, status: "running", console: &Console{writer: stdin}}
	e.instances[k] = ins
	ins.console.append([]byte("[NetLab] VPCS запущен, консоль подключается…\n"))
	go func() {
		buf := make([]byte, 4096)
		for {
			count, e := stdout.Read(buf)
			if count > 0 {
				ins.console.append(buf[:count])
			}
			if e != nil {
				if e != io.EOF {
					ins.console.append([]byte(e.Error()))
				}
				return
			}
		}
	}()
	go func() {
		waitErr := cmd.Wait()
		e.mu.Lock()
		if waitErr != nil {
			ins.err = waitErr.Error()
		}
		ins.status = "stopped"
		for _, ln := range ins.links {
			delete(e.linkActive, ln.ID)
			peer, port := ln.A, ln.APort
			if peer == n.ID {
				peer, port = ln.B, ln.BPort
			}
			if other := e.instances[key(l.ID, peer)]; other != nil && other.status == "running" {
				_ = instanceSetLink(other, port, false)
			}
		}
		e.mu.Unlock()
		ins.console.mu.Lock()
		if ins.console.writer != nil {
			_ = ins.console.writer.Close()
			ins.console.writer = nil
		}
		ins.console.mu.Unlock()
		cleanup()
		close(ins.done)
	}()
	for _, ln := range l.Links {
		if ln.A == n.ID || ln.B == n.ID {
			if err = e.connectLocked(l, ln); err != nil {
				_ = e.disconnectLocked(l, ln)
				_ = cmd.Process.Kill()
				return fmt.Errorf("подключение VPCS к сети: %w", err)
			}
		}
	}
	return nil
}
