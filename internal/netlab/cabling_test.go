package netlab

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

type fakeMonitor struct {
	mu       sync.Mutex
	events   []string
	listener net.Listener
	failSet  bool
}

func newFakeMonitor(t *testing.T) (*fakeMonitor, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "qmp.sock")
	ln, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	m := &fakeMonitor{listener: ln}
	t.Cleanup(func() { _ = ln.Close() })
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				_, _ = c.Write([]byte(`{"QMP":{"version":{},"capabilities":[]}}` + "\n"))
				sc := bufio.NewScanner(c)
				for sc.Scan() {
					var request struct {
						Execute   string         `json:"execute"`
						Arguments map[string]any `json:"arguments"`
					}
					if json.Unmarshal(sc.Bytes(), &request) != nil {
						return
					}
					m.mu.Lock()
					m.events = append(m.events, fmt.Sprintf("%s %v", request.Execute, request.Arguments))
					fail := m.failSet && request.Execute == "set_link"
					m.mu.Unlock()
					if fail {
						_, _ = c.Write([]byte(`{"error":{"class":"GenericError","desc":"fake QMP failure"}}` + "\n"))
					} else {
						_, _ = c.Write([]byte(`{"return":{}}` + "\n"))
					}
				}
			}(conn)
		}
	}()
	return m, path
}
func (m *fakeMonitor) joined() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return strings.Join(m.events, "\n")
}
func fakeRunning(path string) *Instance {
	return &Instance{status: "running", qmp: path, taps: make([]string, 16)}
}
func TestLiveCableConnectDisconnectAndStatuses(t *testing.T) {
	ma, pa := newFakeMonitor(t)
	mb, pb := newFakeMonitor(t)
	e := NewEngine(t.TempDir())
	var system []string
	e.execOp = func(bin string, args ...string) error {
		system = append(system, bin+" "+strings.Join(args, " "))
		return nil
	}
	lab := Lab{ID: newID()}
	a, b := Node{ID: newID()}, Node{ID: newID()}
	lab.Nodes = []Node{a, b}
	ln := Link{ID: newID(), A: a.ID, B: b.ID, APort: 0, BPort: 2}
	e.instances[key(lab.ID, a.ID)] = fakeRunning(pa)
	e.instances[key(lab.ID, b.ID)] = fakeRunning(pb)
	if err := e.ConnectCable(lab, ln); err != nil {
		t.Fatal(err)
	}
	if got := e.CableStatus(lab, ln); got != "up" {
		t.Fatalf("status %q", got)
	}
	if !strings.Contains(ma.joined(), "map[name:nic0 up:true]") || !strings.Contains(mb.joined(), "map[name:nic2 up:true]") {
		t.Fatalf("no QMP up: %s\n%s", ma.joined(), mb.joined())
	}
	if !strings.Contains(strings.Join(system, "\n"), "add-port "+bridgeName(ln.ID)+" "+tapName(a.ID, 0)) {
		t.Fatal("missing OVS port")
	}
	if err := e.DisconnectCable(lab, ln); err != nil {
		t.Fatal(err)
	}
	if got := e.CableStatus(lab, ln); got != "error" {
		t.Fatalf("disconnected unsaved cable: got %s", got)
	}
	if !strings.Contains(ma.joined(), "map[name:nic0 up:false]") || !strings.Contains(mb.joined(), "map[name:nic2 up:false]") {
		t.Fatal("missing QMP carrier down")
	}
	if !strings.Contains(strings.Join(system, "\n"), "del-br "+bridgeName(ln.ID)) {
		t.Fatal("bridge not removed")
	}
}
func TestLiveCableWaitingForPeer(t *testing.T) {
	ma, pa := newFakeMonitor(t)
	_, pb := newFakeMonitor(t)
	e := NewEngine(t.TempDir())
	e.execOp = func(string, ...string) error { return nil }
	lab := Lab{ID: newID()}
	a, b := Node{ID: newID()}, Node{ID: newID()}
	lab.Nodes = []Node{a, b}
	ln := Link{ID: newID(), A: a.ID, B: b.ID, APort: 1, BPort: 0}
	e.instances[key(lab.ID, a.ID)] = fakeRunning(pa)
	if err := e.ConnectCable(lab, ln); err != nil {
		t.Fatal(err)
	}
	if got := e.CableStatus(lab, ln); got != "waiting" {
		t.Fatalf("want waiting, got %s", got)
	}
	if !strings.Contains(ma.joined(), "map[name:nic1 up:false]") {
		t.Fatal("unconnected peer should mean carrier down")
	}
	e.instances[key(lab.ID, b.ID)] = fakeRunning(pb)
	if err := e.ConnectCable(lab, ln); err != nil {
		t.Fatal(err)
	}
	if got := e.CableStatus(lab, ln); got != "up" {
		t.Fatalf("want up, got %s", got)
	}
}
func TestLiveCableFailureDoesNotPersist(t *testing.T) {
	ma, pa := newFakeMonitor(t)
	_, pb := newFakeMonitor(t)
	s := newTestServer(t)
	lab := Lab{ID: newID(), Name: "live", Nodes: []Node{{ID: newID(), Name: "A", NICCount: 4}, {ID: newID(), Name: "B", NICCount: 4}}, Links: []Link{}}
	s.store.mu.Lock()
	s.store.State.Labs = append(s.store.State.Labs, lab)
	if err := s.store.save(); err != nil {
		t.Fatal(err)
	}
	s.store.mu.Unlock()
	a, b := lab.Nodes[0].ID, lab.Nodes[1].ID
	s.engine.instances[key(lab.ID, a)] = fakeRunning(pa)
	s.engine.instances[key(lab.ID, b)] = fakeRunning(pb)
	failed := false
	s.engine.execOp = func(bin string, args ...string) error {
		if bin == "ovs-vsctl" && len(args) > 0 && args[len(args)-3] == "add-port" && !failed {
			failed = true
			return errors.New("test OVS rejection")
		}
		return nil
	}
	body := []byte(fmt.Sprintf(`{"a":%q,"b":%q,"aPort":0,"bPort":0}`, a, b))
	code, response := httpCall(t, s, "POST", "/api/labs/"+lab.ID+"/links", body, true)
	if code != 500 {
		t.Fatalf("want 500, got %d: %s", code, response)
	}
	if len(s.store.State.Labs[0].Links) != 0 {
		t.Fatal("failed cable persisted")
	}
	if !strings.Contains(ma.joined(), "map[name:nic0 up:false]") {
		t.Fatal("rollback did not drop carrier")
	}
}
func TestRewireCableWithoutStoppingGuests(t *testing.T) {
	s := newTestServer(t)
	lab := Lab{ID: newID(), Name: "rewire", Nodes: []Node{{ID: newID(), Name: "A", NICCount: 4}, {ID: newID(), Name: "B", NICCount: 4}, {ID: newID(), Name: "C", NICCount: 4}}}
	s.store.mu.Lock()
	s.store.State.Labs = append(s.store.State.Labs, lab)
	if err := s.store.save(); err != nil {
		t.Fatal(err)
	}
	s.store.mu.Unlock()
	s.engine.execOp = func(string, ...string) error { return nil }
	for _, n := range lab.Nodes {
		_, p := newFakeMonitor(t)
		s.engine.instances[key(lab.ID, n.ID)] = fakeRunning(p)
	}
	a, b, c := lab.Nodes[0].ID, lab.Nodes[1].ID, lab.Nodes[2].ID
	body := []byte(fmt.Sprintf(`{"a":%q,"b":%q,"aPort":0,"bPort":0}`, a, b))
	code, response := httpCall(t, s, "POST", "/api/labs/"+lab.ID+"/links", body, true)
	assertStatus(t, code, 201, response)
	var link Link
	if err := json.Unmarshal(response, &link); err != nil {
		t.Fatal(err)
	}
	if link.Status != "up" {
		t.Fatalf("want up, got %+v", link)
	}
	change := []byte(fmt.Sprintf(`{"a":%q,"b":%q,"aPort":1,"bPort":2}`, a, c))
	code, response = httpCall(t, s, "PATCH", "/api/labs/"+lab.ID+"/links/"+link.ID, change, true)
	assertStatus(t, code, 200, response)
	var rewired Link
	if err := json.Unmarshal(response, &rewired); err != nil {
		t.Fatal(err)
	}
	if rewired.B != c || rewired.APort != 1 || rewired.BPort != 2 || rewired.Status != "up" {
		t.Fatalf("incorrect live rewire: %+v", rewired)
	}
	code, response = httpCall(t, s, "POST", "/api/labs/"+lab.ID+"/links", []byte(fmt.Sprintf(`{"a":%q,"b":%q,"aPort":1,"bPort":0}`, a, b)), true)
	assertStatus(t, code, 409, response) // already occupied port
	code, response = httpCall(t, s, "DELETE", "/api/labs/"+lab.ID+"/links/"+link.ID, nil, true)
	assertStatus(t, code, 200, response)
	if len(s.store.State.Labs[0].Links) != 0 {
		t.Fatal("cable not removed")
	}
}
func TestLegacyPortCapacityAndBounds(t *testing.T) {
	old := Node{ID: newID()}
	if portCapacity(&old) != 16 {
		t.Fatal("legacy 16 ports lost")
	}
	new := Node{ID: newID(), NICCount: 4}
	lab := Lab{Nodes: []Node{new}}
	if portIsFree(lab, new.ID, 4) || !portIsFree(lab, new.ID, 3) {
		t.Fatal("port capacity ignored")
	}
}
func TestFakeQMPErrorPropagation(t *testing.T) {
	monitor, path := newFakeMonitor(t)
	monitor.failSet = true
	if err := qmpSetLink(path, 1, true); err == nil || !strings.Contains(err.Error(), "fake QMP failure") {
		t.Fatalf("expected QMP error, got %v", err)
	}
}
func TestMain(m *testing.M) { os.Exit(m.Run()) }

// Styling is metadata. Even while guests are online, updating it must not
// call OVS, change a TAP interface or ask QEMU to drop carrier.
func TestCableAppearanceUpdateDoesNotTouchLiveNetwork(t *testing.T) {
	s := newTestServer(t)
	lab := Lab{ID: newID(), Name: "style", Nodes: []Node{{ID: newID(), Name: "R1", NICCount: 4}, {ID: newID(), Name: "R2", NICCount: 4}}}
	original := Link{ID: newID(), A: lab.Nodes[0].ID, B: lab.Nodes[1].ID, APort: 0, BPort: 0}
	lab.Links = []Link{original}
	s.store.mu.Lock()
	s.store.State.Labs = append(s.store.State.Labs, lab)
	if err := s.store.save(); err != nil {
		t.Fatal(err)
	}
	s.store.mu.Unlock()
	s.engine.execOp = func(string, ...string) error { t.Fatal("Style-only update called OVS"); return nil }
	uri := "/api/labs/" + lab.ID + "/links/" + original.ID
	code, body := httpCall(t, s, "PATCH", uri, []byte(`{"color":"#2f77bb","lineWidth":3,"lineStyle":"dashed"}`), true)
	assertStatus(t, code, 200, body)
	var modified Link
	if err := json.Unmarshal(body, &modified); err != nil {
		t.Fatal(err)
	}
	if modified.Color != "#2f77bb" || modified.LineWidth != 3 || modified.LineStyle != "dashed" || modified.APort != 0 {
		t.Fatalf("incorrect styled cable: %+v", modified)
	}
	reloaded, err := LoadStore(filepath.Join(s.data, "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	saved := reloaded.State.Labs[0].Links[0]
	if saved.Color != "#2f77bb" || saved.LineWidth != 3 || saved.LineStyle != "dashed" {
		t.Fatalf("style not persisted: %+v", saved)
	}
	for _, v := range []string{`{"color":"red"}`, `{"lineWidth":9}`, `{"lineStyle":"<script>"}`} {
		code, body = httpCall(t, s, "PATCH", uri, []byte(v), true)
		assertStatus(t, code, 400, body)
	}
	if len(s.store.State.Labs[0].Links) != 1 {
		t.Fatal("failed validation modified links")
	}
}
