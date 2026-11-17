package netlab

import (
	"encoding/binary"
	"errors"
	"fmt"
	"log"
	"net"
	"os"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

// openExistingTAP attaches to the persistent TAP which NetLab already created
// for the unprivileged netlab-vm user. This does not create a new interface.
func openExistingTAP(name string) (*os.File, error) {
	if len(name) == 0 || len(name) > 15 {
		return nil, errors.New("недопустимое имя TAP")
	}
	f, err := os.OpenFile("/dev/net/tun", os.O_RDWR, 0)
	if err != nil {
		return nil, fmt.Errorf("открытие /dev/net/tun: %w", err)
	}
	var request [40]byte // Linux struct ifreq; name at 0, flags at 16.
	copy(request[:16], []byte(name))
	binary.NativeEndian.PutUint16(request[16:18], 0x1002) // IFF_TAP | IFF_NO_PI.
	_, _, errno := syscall.Syscall(syscall.SYS_IOCTL, f.Fd(), syscall.TUNSETIFF, uintptr(unsafe.Pointer(&request[0])))
	if errno != 0 {
		_ = f.Close()
		return nil, fmt.Errorf("подключение к TAP %s: %w", name, errno)
	}
	if err := syscall.SetNonblock(int(f.Fd()), true); err != nil {
		_ = f.Close()
		return nil, err
	}
	return f, nil
}

// VPCS 0.5b2 (shipped by Debian 13) can use UDP Ethernet transport without
// touching TAP itself. The NetLab process acts as a local, scoped UDP↔TAP relay.
// Both VPCS' remote address and the relay listener are loopback-only.
type vpcsTransport struct {
	tap       *os.File
	udp       *net.UDPConn
	peer      *net.UDPAddr
	closed    chan struct{}
	closeOnce sync.Once
	wg        sync.WaitGroup
}

func newVPCSTransport(tapName string) (*vpcsTransport, error) {
	tap, err := openExistingTAP(tapName)
	if err != nil {
		return nil, err
	}
	udp, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 0})
	if err != nil {
		_ = tap.Close()
		return nil, err
	}
	return &vpcsTransport{tap: tap, udp: udp, closed: make(chan struct{})}, nil
}
func (t *vpcsTransport) start(peerPort int) {
	t.peer = &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1), Port: peerPort}
	t.wg.Add(2)
	go func() { defer t.wg.Done(); t.udpToTap() }()
	go func() { defer t.wg.Done(); t.tapToUDP() }()
}
func (t *vpcsTransport) close() {
	t.closeOnce.Do(func() { close(t.closed); _ = t.udp.Close(); _ = t.tap.Close() })
	if !waitForTransportWorkers(t.wg.Wait, 2*time.Second) {
		// Do not block the node's done channel (and API Stop) if an
		// underlying TAP read fails to unblock after its fd was closed.
		log.Print("VPCS UDP/TAP relay: cleanup exceeded 2 seconds")
	}
}

func waitForTransportWorkers(wait func(), timeout time.Duration) bool {
	done := make(chan struct{})
	go func() { wait(); close(done) }()
	select {
	case <-done:
		return true
	case <-time.After(timeout):
		return false
	}
}
func (t *vpcsTransport) udpToTap() {
	buf := make([]byte, 65536)
	for {
		n, source, err := t.udp.ReadFromUDP(buf)
		if err != nil {
			select {
			case <-t.closed:
				return
			default:
				continue
			}
		}
		if source == nil || !source.IP.IsLoopback() || source.Port != t.peer.Port || n < 14 {
			continue
		}
		_, _ = t.tap.Write(buf[:n]) // A UDP datagram is a full Ethernet frame.
	}
}
func (t *vpcsTransport) tapToUDP() {
	buf := make([]byte, 65536)
	for {
		select {
		case <-t.closed:
			return
		default:
		}
		n, err := syscall.Read(int(t.tap.Fd()), buf)
		if err == syscall.EAGAIN || err == syscall.EWOULDBLOCK || err == syscall.EINTR {
			time.Sleep(15 * time.Millisecond)
			continue
		}
		if err != nil {
			return
		}
		if n >= 14 {
			_, _ = t.udp.WriteToUDP(buf[:n], t.peer)
		}
	}
}
func reserveVPCSPort() (*net.UDPConn, int, error) {
	conn, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 0})
	if err != nil {
		return nil, 0, err
	}
	return conn, conn.LocalAddr().(*net.UDPAddr).Port, nil
}

// A real PTY is required for interactive VPCS console behavior, including the
// older Debian binary. stdin/stdout pipes alone are not a terminal.
func openVPCSPTY() (master, slave *os.File, err error) {
	master, err = os.OpenFile("/dev/ptmx", os.O_RDWR|syscall.O_NOCTTY, 0)
	if err != nil {
		return nil, nil, fmt.Errorf("открытие /dev/ptmx: %w", err)
	}
	fail := func(e error) (*os.File, *os.File, error) { _ = master.Close(); return nil, nil, e }
	var unlock int32
	_, _, errno := syscall.Syscall(syscall.SYS_IOCTL, master.Fd(), syscall.TIOCSPTLCK, uintptr(unsafe.Pointer(&unlock)))
	if errno != 0 {
		return fail(fmt.Errorf("разблокировка PTY: %w", errno))
	}
	var number uint32
	_, _, errno = syscall.Syscall(syscall.SYS_IOCTL, master.Fd(), syscall.TIOCGPTN, uintptr(unsafe.Pointer(&number)))
	if errno != 0 {
		return fail(fmt.Errorf("номер PTY: %w", errno))
	}
	slave, err = os.OpenFile(fmt.Sprintf("/dev/pts/%d", number), os.O_RDWR, 0)
	if err != nil {
		return fail(err)
	}
	// VPCS saves the initial termios and restores it after each readline.
	// With the default canonical/echo mode, Ctrl+C is displayed as ^C and
	// held in the line buffer instead of being delivered to VPCS. Start
	// in noncanonical, no-echo, no-ISIG mode; VPCS may toggle its own
	// editor options while keeping these safe baseline flags.
	if err := configureVPCSPTY(slave); err != nil {
		_ = slave.Close()
		return fail(fmt.Errorf("настройка PTY VPCS: %w", err))
	}
	return master, slave, nil
}

func configureVPCSPTY(slave *os.File) error {
	var term syscall.Termios
	_, _, errno := syscall.Syscall(syscall.SYS_IOCTL, slave.Fd(), syscall.TCGETS, uintptr(unsafe.Pointer(&term)))
	if errno != 0 {
		return errno
	}
	// Disable canonical buffering and the kernel's ^C echo; preserve OPOST
	// for VPCS' terminal output. Signal delivery is explicitly scoped to the
	// VPCS process group by the console handler.
	term.Lflag &^= syscall.ICANON | syscall.ECHO | syscall.ISIG | syscall.IEXTEN
	term.Cc[syscall.VMIN] = 1
	term.Cc[syscall.VTIME] = 0
	_, _, errno = syscall.Syscall(syscall.SYS_IOCTL, slave.Fd(), syscall.TCSETS, uintptr(unsafe.Pointer(&term)))
	if errno != 0 {
		return errno
	}
	return nil
}
