package netlab

import (
	"errors"
	"fmt"
	"hash/fnv"
	"log"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
)

// Debian 13 ships VPCS 0.5b2. UDP mode is supported by both it and newer
// VPCS versions, avoiding the old TAP/TTY limitations of -e -d.
func vpcsArgs(sourcePort, relayPort, macOffset int) []string {
	return []string{"-i", "1", "-u", "-s", strconv.Itoa(sourcePort), "-c", strconv.Itoa(relayPort), "-t", "127.0.0.1", "-m", strconv.Itoa(macOffset)}
}
func vpcsMACOffset(id string) int {
	hash := fnv.New32a()
	_, _ = hash.Write([]byte(id))
	return int(hash.Sum32() % 240)
}

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
	if existing := e.instances[k]; existing != nil {
		if existing.status == "running" {
			return nil
		}
		select {
		case <-existing.done:
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
	transport, err := newVPCSTransport(tap)
	if err != nil {
		cleanup()
		return fmt.Errorf("VPCS UDP↔TAP: %w", err)
	}
	portHold, sourcePort, err := reserveVPCSPort()
	if err != nil {
		transport.close()
		cleanup()
		return err
	}
	master, slave, err := openVPCSPTY()
	if err != nil {
		_ = portHold.Close()
		transport.close()
		cleanup()
		return err
	}
	logFile, err := os.OpenFile(filepath.Join(runtime, "vpcs.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0640)
	if err != nil {
		_ = slave.Close()
		_ = master.Close()
		_ = portHold.Close()
		transport.close()
		cleanup()
		return err
	}
	_, _ = fmt.Fprintf(logFile, "\n[NetLab] VPCS UDP: source=%d relay=%d tap=%s\n", sourcePort, transport.udp.LocalAddr().(*net.UDPAddr).Port, tap)
	cmd := exec.Command("vpcs", vpcsArgs(sourcePort, transport.udp.LocalAddr().(*net.UDPAddr).Port, vpcsMACOffset(n.ID))...)
	cmd.Dir = runtime
	cmd.SysProcAttr = &syscall.SysProcAttr{Credential: cred, Setsid: true, Setctty: true, Ctty: 0}
	cmd.Stdin = slave
	cmd.Stdout = slave
	cmd.Stderr = slave
	_ = portHold.Close() // release reserved UDP port immediately before spawn
	if err = cmd.Start(); err != nil {
		_ = slave.Close()
		_ = master.Close()
		_ = logFile.Close()
		transport.close()
		cleanup()
		return fmt.Errorf("запуск VPCS: %w", err)
	}
	log.Printf("VPCS started: lab=%s node=%s pid=%d source=%d relay=%d", l.ID, n.ID, cmd.Process.Pid, sourcePort, transport.udp.LocalAddr().(*net.UDPAddr).Port)
	_ = slave.Close()
	transport.start(sourcePort)
	ins := &Instance{cmd: cmd, done: make(chan struct{}), engine: "vpcs", taps: []string{tap}, status: "running", console: &Console{writer: master}, vpcsTransport: transport}
	e.instances[k] = ins
	ins.console.append([]byte("[NetLab] VPCS: консоль PTY, Ethernet UDP↔TAP\n"))
	consoleReaderDone := make(chan struct{})
	go func() {
		defer close(consoleReaderDone)
		defer logFile.Close()
		buf := make([]byte, 4096)
		for {
			n, err := master.Read(buf)
			if n > 0 {
				ins.console.append(buf[:n])
				_, _ = logFile.Write(buf[:n])
			}
			if err != nil {
				return
			}
		}
	}()
	go func() {
		waitErr := cmd.Wait()
		log.Printf("VPCS exited: lab=%s node=%s pid=%d result=%v", l.ID, n.ID, cmd.Process.Pid, waitErr)
		transport.close()
		_ = master.Close()
		<-consoleReaderDone // flush PTY output before reporting the exit error
		e.mu.Lock()
		if waitErr != nil {
			ins.err = fmt.Sprintf("VPCS завершился: %v. Журнал: %s", waitErr, tailLog(filepath.Join(runtime, "vpcs.log")))
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
		ins.console.writer = nil
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
