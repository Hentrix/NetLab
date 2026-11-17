package netlab

import (
	"unsafe"
	"bytes"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"testing"
)

func TestVPCSPseudoterminal(t *testing.T) {
	master, slave, err := openVPCSPTY()
	if err != nil {
		t.Skipf("PTY unavailable in test environment: %v", err)
	}
	defer master.Close()
	cmd := exec.Command("sh", "-c", "test -t 0 && test -t 1 && printf 'pty-ready\\n'")
	cmd.Stdin = slave
	cmd.Stdout = slave
	cmd.Stderr = slave
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true, Setctty: true, Ctty: 0}
	if err = cmd.Start(); err != nil {
		_ = slave.Close()
		t.Fatal(err)
	}
	_ = slave.Close()
	var output bytes.Buffer
	buffer := make([]byte, 4096)
	for {
		n, readErr := master.Read(buffer)
		if n > 0 {
			output.Write(buffer[:n])
		}
		if readErr != nil {
			break
		}
	}
	if err = cmd.Wait(); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), "pty-ready") {
		t.Fatalf("PTY did not provide a terminal: %q", output.String())
	}
}
func TestVPCSUDPArgumentPorts(t *testing.T) {
	hold, port, err := reserveVPCSPort()
	if err != nil {
		t.Fatal(err)
	}
	defer hold.Close()
	if port <= 0 || port > 65535 {
		t.Fatal("bad port")
	}
	args := strings.Join(vpcsArgs(port, 39501, vpcsMACOffset("example-node")), " ")
	for _, arg := range []string{"-i 1", "-u", "-s " + strconv.Itoa(port), "-c 39501", "-t 127.0.0.1", "-m "} {
		if !strings.Contains(args, arg) {
			t.Errorf("missing %s in %s", arg, args)
		}
	}
	if vpcsMACOffset("one") != vpcsMACOffset("one") {
		t.Fatal("MAC offset must be deterministic")
	}
}

func TestVPCSPTYDisablesKernelGeneratedSIGINT(t *testing.T) {
	master, slave, err := openVPCSPTY()
	if err != nil {
		t.Fatal(err)
	}
	defer master.Close()
	defer slave.Close()
	var term syscall.Termios
	_, _, errno := syscall.Syscall(syscall.SYS_IOCTL, slave.Fd(), syscall.TCGETS, uintptr(unsafe.Pointer(&term)))
	if errno != 0 {
		t.Fatal(errno)
	}
	if term.Lflag&(syscall.ISIG|syscall.ICANON|syscall.ECHO|syscall.IEXTEN) != 0 {
		t.Fatalf("PTY must be raw and must not echo/block Ctrl+C: lflag=%#x", term.Lflag)
	}
	if term.Cc[syscall.VMIN] != 1 || term.Cc[syscall.VTIME] != 0 {
		t.Fatal("VPCS PTY must deliver each input byte without waiting for Enter")
	}
}
