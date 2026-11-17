package netlab

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

type Console struct {
	mu      sync.Mutex
	content []byte
	start   int64 // absolute offset of first retained byte
	conn    net.Conn
	writer  io.WriteCloser // stdin for process-backed consoles (VPCS)
}

func (c *Console) append(b []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.content = append(c.content, b...)
	if len(c.content) > 128*1024 {
		drop := len(c.content) - 128*1024
		c.start += int64(drop)
		c.content = append([]byte(nil), c.content[drop:]...)
	}
}

// readSince returns a bounded byte delta. A reset tells the subscriber that
// its cursor predates the retained 128 KiB scrollback window.
func (c *Console) readSince(offset int64) ([]byte, int64, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	reset := offset < c.start || offset > c.start+int64(len(c.content))
	if reset {
		offset = c.start
	}
	from := int(offset - c.start)
	// Limit a single message and allow the client to request/stream more.
	to := from + 16*1024
	if to > len(c.content) {
		to = len(c.content)
	}
	return append([]byte(nil), c.content[from:to]...), c.start + int64(to), reset
}
func (c *Console) read() string { c.mu.Lock(); defer c.mu.Unlock(); return string(c.content) }
func (c *Console) write(text string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn != nil {
		_, err := io.WriteString(c.conn, text)
		return err
	}
	if c.writer != nil {
		_, err := io.WriteString(c.writer, text)
		return err
	}
	return errors.New("консоль ещё не готова")
}

type Instance struct {
	cmd           *exec.Cmd
	done          chan struct{}
	console       *Console
	taps          []string
	engine        string // qemu or vpcs
	vpcsTransport *vpcsTransport
	links         []Link
	qmp           string
	err           string
	status        string
	stopRequested bool // guarded by Engine.mu; an intentional Stop is not a VM crash
}
type Engine struct {
	mu         sync.Mutex
	data       string
	instances  map[string]*Instance
	linkActive map[string]bool
	execOp     func(string, ...string) error // injectable for isolated cable tests
}

func NewEngine(data string) *Engine {
	return &Engine{data: data, instances: map[string]*Instance{}, linkActive: map[string]bool{}}
}
func key(lab, node string) string { return lab + "/" + node }
func (e *Engine) Status(lab, node string) (string, string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if i := e.instances[key(lab, node)]; i != nil {
		return i.status, i.err
	}
	return "stopped", ""
}
func (e *Engine) ReadConsoleSince(lab, node string, offset int64) ([]byte, int64, bool, error) {
	e.mu.Lock()
	i := e.instances[key(lab, node)]
	e.mu.Unlock()
	if i == nil {
		return nil, offset, false, errors.New("узел не запускался в этой сессии")
	}
	if i.status != "running" {
		return nil, offset, false, errors.New("устройство остановлено; запустите его снова")
	}
	data, cursor, reset := i.console.readSince(offset)
	return data, cursor, reset, nil
}
func (e *Engine) ReadConsole(lab, node string) (string, error) {
	e.mu.Lock()
	i := e.instances[key(lab, node)]
	e.mu.Unlock()
	if i == nil {
		return "", errors.New("узел не запущен")
	}
	return i.console.read(), nil
}
func (e *Engine) WriteConsole(lab, node, text string) error {
	e.mu.Lock()
	i := e.instances[key(lab, node)]
	e.mu.Unlock()
	if i == nil || i.status != "running" {
		return errors.New("устройство не запущено; запустите его снова")
	}
	if len(text) > 8192 {
		return errors.New("превышен размер ввода")
	}
	if i.engine == "vpcs" {
		if i.cmd == nil || i.cmd.Process == nil {
			return errors.New("процесс VPCS недоступен")
		}
		// VPCS handles Ctrl+C differently in its interactive readline (raw
		// mode, requiring ETX) and running commands (SIGINT handler).
		// Both paths are needed; the VPCS process group is isolated from API.
		return writeVPCSConsole(i.console, text, func() error {
			return syscall.Kill(-i.cmd.Process.Pid, syscall.SIGINT)
		})
	}
	return i.console.write(text)
}

// writeVPCSConsole sends ETX to VPCS' raw-mode readline to cancel the
// current input line, then sends SIGINT to its isolated process group to
// interrupt long-running commands (VPCS 0.5b2 uses both mechanisms).
// StartVPCS uses Setpgid=true, so SIGINT cannot reach NetLab's daemon group.
func writeVPCSConsole(c *Console, input string, interrupt func() error) error {
	for len(input) > 0 {
		index := strings.IndexByte(input, 0x03)
		if index < 0 {
			return c.write(input)
		}
		if index > 0 {
			if err := c.write(input[:index]); err != nil {
				return err
			}
		}
		if err := c.write("\x03"); err != nil {
			return fmt.Errorf("отправка Ctrl+C в PTY VPCS: %w", err)
		}
		if err := interrupt(); err != nil {
			return fmt.Errorf("прерывание команды VPCS: %w", err)
		}
		input = input[index+1:]
	}
	return nil
}
func run(bin string, args ...string) error {
	out, err := exec.Command(bin, args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s %s: %w: %s", bin, strings.Join(args, " "), err, strings.TrimSpace(string(out)))
	}
	return nil
}
func vmCredential() (*syscall.Credential, int, int, error) {
	u, err := user.Lookup("netlab-vm")
	if err != nil {
		return nil, 0, 0, errors.New("не найден пользователь netlab-vm: запустите установщик")
	}
	uid, err := strconv.Atoi(u.Uid)
	if err != nil {
		return nil, 0, 0, err
	}
	gid, err := strconv.Atoi(u.Gid)
	if err != nil {
		return nil, 0, 0, err
	}
	ids, err := u.GroupIds()
	if err != nil {
		return nil, 0, 0, err
	}
	groups := []uint32{}
	for _, g := range ids {
		n, e := strconv.Atoi(g)
		if e == nil {
			groups = append(groups, uint32(n))
		}
	}
	return &syscall.Credential{Uid: uint32(uid), Gid: uint32(gid), Groups: groups}, uid, gid, nil
}
func (e *Engine) exec(bin string, args ...string) error {
	if e.execOp != nil {
		return e.execOp(bin, args...)
	}
	return run(bin, args...)
}

// Start preallocates all configured virtual Ethernet NICs.  QEMU does not
// require a reboot when an existing TAP is joined to or removed from OVS.
func (e *Engine) Start(l Lab, n Node, img Image) error {
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
			return errors.New("предыдущий процесс VM ещё завершается: повторите запуск после очистки TAP")
		}
	}
	if _, err := exec.LookPath("qemu-system-x86_64"); err != nil {
		return errors.New("qemu-system-x86_64 не установлен")
	}
	if _, err := exec.LookPath("qemu-img"); err != nil {
		return errors.New("qemu-img не установлен")
	}
	cred, uid, gid, err := vmCredential()
	if err != nil {
		return err
	}
	base := filepath.Join(e.data, "images", img.ID+"."+img.Format)
	if _, err := os.Stat(base); err != nil {
		return fmt.Errorf("файл образа недоступен: %w", err)
	}
	runtime := filepath.Join(e.data, "runtime", l.ID, n.ID)
	if err := os.MkdirAll(runtime, 0750); err != nil {
		return err
	}
	if err := os.Chown(filepath.Join(e.data, "runtime", l.ID), uid, gid); err != nil {
		return err
	}
	if err := os.Chown(runtime, uid, gid); err != nil {
		return err
	}
	overlay := filepath.Join(runtime, "disk.qcow2")
	if _, err := os.Stat(overlay); errors.Is(err, os.ErrNotExist) {
		if err := run("qemu-img", "create", "-f", "qcow2", "-F", img.Format, "-b", base, overlay); err != nil {
			return err
		}
		if err := os.Chown(overlay, uid, gid); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}
	// Every NIC has its own TAP, including initially disconnected ports.  The
	// TAP does not connect to a physical bridge until the user adds a cable.
	capacity := portCapacity(&n)
	taps := []string{}
	cleanup := func() {
		for _, t := range taps {
			_ = e.exec("ip", "link", "del", t)
		}
	}
	for port := 0; port < capacity; port++ {
		tap := tapName(n.ID, port)
		_ = e.exec("ip", "link", "del", tap) // stale from an aborted VM
		if err := e.exec("ip", "tuntap", "add", "dev", tap, "mode", "tap", "user", strconv.Itoa(uid)); err != nil {
			cleanup()
			return err
		}
		taps = append(taps, tap)
		if err := e.exec("ip", "link", "set", tap, "up"); err != nil {
			cleanup()
			return err
		}
	}
	qmp := filepath.Join(runtime, "monitor.sock")
	serial := filepath.Join(runtime, "serial.sock")
	_ = os.Remove(qmp)
	_ = os.Remove(serial)
	accel := "tcg"
	cpu := "qemu64"
	if canUseKVM(cred) {
		accel = "kvm"
		cpu = "host"
	}
	args := []string{"-name", "netlab-" + n.ID, "-machine", "pc,accel=" + accel, "-cpu", cpu, "-smp", strconv.Itoa(n.CPUs), "-m", strconv.Itoa(n.RAM), "-display", "none", "-monitor", "none", "-no-reboot", "-qmp", "unix:" + qmp + ",server=on,wait=off", "-serial", "unix:" + serial + ",server=on,wait=off", "-drive", "file=" + overlay + ",format=qcow2,if=" + n.DiskBus + ",cache=none"}
	for port := 0; port < capacity; port++ {
		tap := tapName(n.ID, port)
		netID, deviceID := netdevID(port), nicID(port)
		args = append(args, "-netdev", "tap,id="+netID+",ifname="+tap+",script=,downscript=",
			"-device", n.NICModel+",id="+deviceID+",netdev="+netID+",mac="+macFor(n.ID, port))
	}
	logFile, err := os.OpenFile(filepath.Join(runtime, "qemu.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0640)
	if err != nil {
		cleanup()
		return err
	}
	cmd := exec.Command("qemu-system-x86_64", args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{Credential: cred, Setpgid: true}
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	if err := cmd.Start(); err != nil {
		logFile.Close()
		cleanup()
		return fmt.Errorf("запуск QEMU от netlab-vm: %w. Проверьте: sudo -u netlab-vm /usr/bin/qemu-system-x86_64 --version; sudo bash /opt/netlab/scripts/diagnose-qemu.sh; sudo journalctl -u netlab -n 80", err)
	}
	logFile.Close()
	ins := &Instance{cmd: cmd, done: make(chan struct{}), taps: taps, engine: "qemu", qmp: qmp, console: &Console{}, status: "running"}
	e.instances[k] = ins
	go e.readSerial(ins, serial)
	go func() {
		err := cmd.Wait()
		e.mu.Lock()
		if err != nil {
			ins.err = err.Error()
		}
		ins.status = "stopped"
		// An unexpected VM exit must drop carrier on the surviving peer.
		for _, ln := range ins.links {
			delete(e.linkActive, ln.ID)
			peer, pp := ln.A, ln.APort
			if peer == n.ID {
				peer, pp = ln.B, ln.BPort
			}
			if other := e.instances[key(l.ID, peer)]; other != nil && other.status == "running" {
				_ = instanceSetLink(other, pp, false)
			}
		}
		e.mu.Unlock()
		ins.console.mu.Lock()
		if ins.console.conn != nil {
			_ = ins.console.conn.Close()
		}
		if ins.console.writer != nil {
			_ = ins.console.writer.Close()
		}
		ins.console.mu.Unlock()
		for _, t := range taps {
			_ = e.exec("ip", "link", "del", t)
		}
		close(ins.done)
	}()
	if err := awaitQMP(qmp); err != nil {
		_ = cmd.Process.Kill()
		return fmt.Errorf("QMP VM %s: %w; см. %s", n.Name, err, filepath.Join(runtime, "qemu.log"))
	}
	// A disconnected cable must be reflected as carrier down in the guest.
	for port := 0; port < capacity; port++ {
		if err := qmpSetLink(qmp, port, false); err != nil {
			_ = cmd.Process.Kill()
			return fmt.Errorf("установка link-down NIC %d: %w", port, err)
		}
	}
	for _, link := range l.Links {
		if link.A != n.ID && link.B != n.ID {
			continue
		}
		if err := e.connectLocked(l, link); err != nil {
			_ = e.disconnectLocked(l, link) // best-effort cleanup on partial attachment
			_ = cmd.Process.Kill()
			return fmt.Errorf("подключение кабеля при запуске %s: %w", n.Name, err)
		}
	}
	return nil
}
func macFor(id string, port int) string {
	return fmt.Sprintf("52:54:%s:%s:%s:%02x", id[:2], id[2:4], id[4:6], port)
}
func (e *Engine) readSerial(ins *Instance, path string) {
	var conn net.Conn
	for i := 0; i < 50; i++ {
		c, err := net.DialTimeout("unix", path, 100*time.Millisecond)
		if err == nil {
			conn = c
			break
		}
		select {
		case <-ins.done:
			return
		case <-time.After(100 * time.Millisecond):
		}
	}
	if conn == nil {
		ins.console.append([]byte("\n[NetLab] Serial console unavailable. Check qemu.log\n"))
		return
	}
	ins.console.mu.Lock()
	ins.console.conn = conn
	ins.console.mu.Unlock()
	buf := make([]byte, 4096)
	for {
		n, err := conn.Read(buf)
		if n > 0 {
			ins.console.append(buf[:n])
		}
		if err != nil {
			break
		}
	}
	ins.console.mu.Lock()
	ins.console.conn = nil
	ins.console.mu.Unlock()
	_ = conn.Close()
}
func qmpQuit(path string) error {
	c, err := net.DialTimeout("unix", path, 700*time.Millisecond)
	if err != nil {
		return err
	}
	defer c.Close()
	_ = c.SetDeadline(time.Now().Add(1500 * time.Millisecond))
	reader := bufio.NewReader(c)
	if _, err := reader.ReadBytes('\n'); err != nil {
		return err
	}
	for _, cmd := range []string{"{\"execute\":\"qmp_capabilities\"}\n", "{\"execute\":\"quit\"}\n"} {
		if _, err := io.WriteString(c, cmd); err != nil {
			return err
		}
		if _, err := reader.ReadBytes('\n'); err != nil {
			return err
		}
	}
	return nil
}
// waitForInstanceStop never waits indefinitely, even if process reaping or
// transport cleanup is stuck. Force termination after the grace period.
func waitForInstanceStop(done <-chan struct{}, force func(), grace, afterKill time.Duration) error {
	select {
	case <-done:
		return nil
	case <-time.After(grace):
		force()
	}
	select {
	case <-done:
		return nil
	case <-time.After(afterKill):
		return errors.New("процесс принудительно завершён, но очистка NetLab не завершилась; проверьте журнал netlab")
	}
}

func (e *Engine) Stop(lab, node string) error {
	e.mu.Lock()
	ins := e.instances[key(lab, node)]
	if ins == nil || ins.status != "running" {
		e.mu.Unlock()
		return nil
	}
	ins.stopRequested = true
	e.mu.Unlock()
	if ins.cmd == nil || ins.cmd.Process == nil {
		return errors.New("не найден процесс устройства; проверьте журнал NetLab")
	}
	pid := ins.cmd.Process.Pid
	if ins.engine == "vpcs" {
		// Signal only VPCS' own process group; never the API server.
		_ = syscall.Kill(-pid, syscall.SIGTERM)
	} else if err := qmpQuit(ins.qmp); err != nil {
		_ = ins.cmd.Process.Signal(syscall.SIGTERM)
	}
	return waitForInstanceStop(ins.done, func() {
		if ins.engine == "vpcs" {
			_ = syscall.Kill(-pid, syscall.SIGKILL)
		} else {
			_ = ins.cmd.Process.Kill()
		}
	}, 3*time.Second, 2*time.Second)
}
func (e *Engine) Cleanup(l Lab) {
	for _, n := range l.Nodes {
		_ = e.Stop(l.ID, n.ID)
	}
	for _, link := range l.Links {
		_ = e.exec("ovs-vsctl", "--if-exists", "del-br", bridgeName(link.ID))
	}
}
func (e *Engine) Recover(labs []Lab) {
	// Only NetLab-owned interfaces from persisted records; never touch host uplinks.
	for _, l := range labs {
		for _, ln := range l.Links {
			if validID(ln.ID) {
				_ = e.exec("ovs-vsctl", "--if-exists", "del-br", bridgeName(ln.ID))
			}
		}
		// v0.4 allocates even disconnected ports. Clean all of them, not only
		// those named in a saved link. This also handles abrupt process crashes.
		for _, n := range l.Nodes {
			if !validID(n.ID) {
				continue
			}
			for port := 0; port < portCapacity(&n); port++ {
				_ = e.exec("ip", "link", "del", tapName(n.ID, port))
			}
		}
	}
}
func imageInfo(path string) (string, error) {
	out, err := exec.Command("qemu-img", "info", "--output=json", path).Output()
	if err != nil {
		return "", fmt.Errorf("qemu-img info: %w", err)
	}
	var info struct {
		Format      string `json:"format"`
		Backing     string `json:"backing-filename"`
		FullBacking string `json:"full-backing-filename"`
	}
	if err := json.Unmarshal(out, &info); err != nil {
		return "", err
	}
	if info.Backing != "" || info.FullBacking != "" {
		return "", errors.New("образ содержит внешнюю backing-ссылку: импортируйте автономный диск")
	}
	if info.Format != "qcow2" && info.Format != "raw" {
		return "", fmt.Errorf("поддерживаются qcow2/raw; обнаружен %s", info.Format)
	}
	return info.Format, nil
}
func copyFile(dst string, src io.Reader) (int64, error) {
	f, err := os.OpenFile(dst, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0640)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	n, err := io.Copy(f, src)
	if err != nil {
		return n, err
	}
	if err = f.Sync(); err != nil {
		return n, err
	}
	return n, nil
}
func tailLog(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	if len(b) > 8192 {
		b = b[len(b)-8192:]
	}
	return string(bytes.ToValidUTF8(b, []byte("?")))
}

// canUseKVM conservatively checks whether the unprivileged VM user has
// ordinary filesystem access to /dev/kvm. Other restrictions are reported by QEMU.
func canUseKVM(cred *syscall.Credential) bool {
	info, err := os.Stat("/dev/kvm")
	if err != nil {
		return false
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return false
	}
	perms := info.Mode().Perm()
	if perms&0006 == 0006 {
		return true
	}
	if uint32(stat.Uid) == cred.Uid && perms&0600 == 0600 {
		return true
	}
	if perms&0060 != 0060 {
		return false
	}
	if uint32(stat.Gid) == cred.Gid {
		return true
	}
	for _, group := range cred.Groups {
		if group == uint32(stat.Gid) {
			return true
		}
	}
	return false
}

// probeQEMUSpawn runs only --version with exactly the same OS credentials
// as a real guest. A binary on PATH is not sufficient to assert readiness.
func probeQEMUSpawn() (bool, string) {
	bin, err := exec.LookPath("qemu-system-x86_64")
	if err != nil {
		return false, err.Error()
	}
	cred, _, _, err := vmCredential()
	if err != nil {
		return false, err.Error()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin, "--version")
	cmd.SysProcAttr = &syscall.SysProcAttr{Credential: cred, Setpgid: true}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return false, fmt.Sprintf("qemu --version как netlab-vm: %v: %s", err, strings.TrimSpace(string(out)))
	}
	return true, ""
}

// probeVPCSSpawn exercises the same credentials and PTY file descriptors as
// StartVPCS, without spawning a simulator or touching network interfaces.
// This catches missing CAP_SETGID / CAP_SETUID in the systemd service early.
func probeVPCSSpawn() (bool, string) {
	if _, err := exec.LookPath("vpcs"); err != nil {
		return false, "VPCS не установлен: " + err.Error()
	}
	cred, _, _, err := vmCredential()
	if err != nil {
		return false, err.Error()
	}
	master, slave, err := openVPCSPTY()
	if err != nil {
		return false, "PTY: " + err.Error()
	}
	defer master.Close()
	defer slave.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	// /usr/bin/true gives a harmless child exec path with the same SysProcAttr
	// that the VPCS binary will receive. No guest is started.
	cmd := exec.CommandContext(ctx, "/usr/bin/true")
	cmd.SysProcAttr = &syscall.SysProcAttr{Credential: cred, Setpgid: true}
	cmd.Stdin, cmd.Stdout, cmd.Stderr = slave, slave, slave
	if err := cmd.Run(); err != nil {
		return false, fmt.Sprintf("смена пользователя или создание PTY: %v; проверьте CAP_SETUID и CAP_SETGID в netlab.service", err)
	}
	return true, ""
}
