package netlab

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"strings"
	"time"
)

func nicID(port int) string    { return fmt.Sprintf("nic%d", port) }
func netdevID(port int) string { return fmt.Sprintf("net%d", port) }

// Each QMP command uses an independent short-lived monitor session. QMP
// greetings and asynchronous events are parsed, never mistaken for responses.
func qmpCommand(path, command string, arguments map[string]any) error {
	c, err := net.DialTimeout("unix", path, 650*time.Millisecond)
	if err != nil {
		return err
	}
	defer c.Close()
	_ = c.SetDeadline(time.Now().Add(2500 * time.Millisecond))
	rd := bufio.NewReader(c)
	read := func() (map[string]json.RawMessage, error) {
		for j := 0; j < 32; j++ {
			line, e := rd.ReadBytes('\n')
			if e != nil {
				return nil, e
			}
			var msg map[string]json.RawMessage
			if e = json.Unmarshal(line, &msg); e != nil {
				return nil, e
			}
			if _, event := msg["event"]; event {
				continue
			}
			return msg, nil
		}
		return nil, errors.New("слишком много QMP событий")
	}
	greeting, e := read()
	if e != nil {
		return e
	}
	if _, ok := greeting["QMP"]; !ok {
		return errors.New("нет приветствия QMP")
	}
	send := func(cmd string, args map[string]any) error {
		request := map[string]any{"execute": cmd}
		if len(args) > 0 {
			request["arguments"] = args
		}
		payload, e := json.Marshal(request)
		if e != nil {
			return e
		}
		if _, e = c.Write(append(payload, '\n')); e != nil {
			return e
		}
		response, e := read()
		if e != nil {
			return e
		}
		if v, ok := response["error"]; ok {
			return fmt.Errorf("QMP %s: %s", cmd, strings.TrimSpace(string(v)))
		}
		if _, ok := response["return"]; !ok {
			return fmt.Errorf("QMP %s: ответа нет", cmd)
		}
		return nil
	}
	if e = send("qmp_capabilities", nil); e != nil {
		return e
	}
	return send(command, arguments)
}
func awaitQMP(path string) error {
	var last error
	for tries := 0; tries < 50; tries++ {
		if last = qmpCommand(path, "query-status", nil); last == nil {
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return fmt.Errorf("QMP не готов: %w", last)
}
func qmpSetLink(path string, port int, up bool) error {
	return qmpCommand(path, "set_link", map[string]any{"name": nicID(port), "up": up})
}
func (e *Engine) running(labID, nodeID string) *Instance {
	i := e.instances[key(labID, nodeID)]
	if i == nil || i.status != "running" {
		return nil
	}
	return i
}
func updateInstanceLinks(i *Instance, link Link, attach bool) {
	if i == nil {
		return
	}
	for j, old := range i.links {
		if old.ID == link.ID {
			if attach {
				i.links[j] = link
			} else {
				i.links = append(i.links[:j], i.links[j+1:]...)
			}
			return
		}
	}
	if attach {
		i.links = append(i.links, link)
	}
}

// connectLocked is serialized under Engine.mu. A TAP exists for every configured
// NIC of a running QEMU instance. Connecting a cable attaches those existing TAPs
// to an isolated OVS bridge and toggles guest carrier via QMP. No guest reboot.
func (e *Engine) connectLocked(l Lab, link Link) error {
	a, b := e.running(l.ID, link.A), e.running(l.ID, link.B)
	if a == nil && b == nil {
		delete(e.linkActive, link.ID)
		return nil
	}
	bridge := bridgeName(link.ID)
	if err := e.exec("ovs-vsctl", "--may-exist", "add-br", bridge); err != nil {
		return err
	}
	for _, ep := range []struct {
		i    *Instance
		id   string
		port int
	}{{a, link.A, link.APort}, {b, link.B, link.BPort}} {
		if ep.i == nil {
			continue
		}
		if ep.port >= len(ep.i.taps) {
			return fmt.Errorf("порт %d не создан в работающей VM; измените число портов после остановки узла", ep.port)
		}
		if err := e.exec("ovs-vsctl", "--may-exist", "add-port", bridge, tapName(ep.id, ep.port)); err != nil {
			return err
		}
	}
	up := a != nil && b != nil
	for _, ep := range []struct {
		i    *Instance
		port int
	}{{a, link.APort}, {b, link.BPort}} {
		if ep.i == nil {
			continue
		}
		if err := qmpSetLink(ep.i.qmp, ep.port, up); err != nil {
			return err
		}
	}
	for _, i := range []*Instance{a, b} {
		updateInstanceLinks(i, link, true)
	}
	if up {
		e.linkActive[link.ID] = true
	} else {
		delete(e.linkActive, link.ID)
	}
	return nil
}
func (e *Engine) disconnectLocked(l Lab, link Link) error {
	a, b := e.running(l.ID, link.A), e.running(l.ID, link.B)
	var problems []error
	// Always finish L2 cleanup even if one guest's QMP is unreachable.
	for _, ep := range []struct {
		i    *Instance
		port int
	}{{a, link.APort}, {b, link.BPort}} {
		if ep.i != nil {
			if err := qmpSetLink(ep.i.qmp, ep.port, false); err != nil {
				problems = append(problems, err)
			}
		}
	}
	bridge := bridgeName(link.ID)
	if a != nil {
		if err := e.exec("ovs-vsctl", "--if-exists", "del-port", bridge, tapName(link.A, link.APort)); err != nil {
			problems = append(problems, err)
		}
	}
	if b != nil {
		if err := e.exec("ovs-vsctl", "--if-exists", "del-port", bridge, tapName(link.B, link.BPort)); err != nil {
			problems = append(problems, err)
		}
	}
	if a != nil || b != nil {
		if err := e.exec("ovs-vsctl", "--if-exists", "del-br", bridge); err != nil {
			problems = append(problems, err)
		}
	}
	for _, i := range []*Instance{a, b} {
		updateInstanceLinks(i, link, false)
	}
	delete(e.linkActive, link.ID)
	return errors.Join(problems...)
}
func (e *Engine) ConnectCable(l Lab, link Link) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if err := e.connectLocked(l, link); err != nil {
		_ = e.disconnectLocked(l, link)
		return err
	}
	return nil
}
func (e *Engine) DisconnectCable(l Lab, link Link) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if err := e.disconnectLocked(l, link); err != nil {
		_ = e.connectLocked(l, link) // rollback old connection on partial failure
		return err
	}
	return nil
}
func (e *Engine) CableStatus(l Lab, ln Link) string {
	e.mu.Lock()
	defer e.mu.Unlock()
	a, b := e.running(l.ID, ln.A), e.running(l.ID, ln.B)
	if a == nil && b == nil {
		return "down"
	}
	if a == nil || b == nil {
		return "waiting"
	}
	if e.linkActive[ln.ID] {
		return "up"
	}
	return "error"
}
