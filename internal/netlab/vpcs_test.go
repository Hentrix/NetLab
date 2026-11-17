package netlab

import (
	"encoding/json"
	"bytes"
	"io"
	"errors"
	"strings"
	"testing"
)

func TestVPCSNodeValidation(t *testing.T) {
	node := Node{ID: newID(), Name: "PC1", Engine: "vpcs", Kind: "pc", NICCount: 1, PortStyle: "eth", Icon: "Desktop.png"}
	if err := validateNode(node); err != nil {
		t.Fatalf("VPCS without disk rejected: %v", err)
	}
	invalid := node
	invalid.ImageID = newID()
	if err := validateNode(invalid); err == nil {
		t.Fatal("VPCS imageId accepted")
	}
	invalid = node
	invalid.NICCount = 2
	if err := validateNode(invalid); err == nil {
		t.Fatal("VPCS multiple NICs accepted")
	}
	invalid = node
	invalid.Icon = "../etc/passwd.png"
	if err := validateNode(invalid); err == nil {
		t.Fatal("Unsafe VPCS icon accepted")
	}
	invalid = node
	invalid.PortStyle = "<invalid>"
	if err := validateNode(invalid); err == nil {
		t.Fatal("Unsafe VPCS port style accepted")
	}
	invalid = node
	invalid.Engine = "unknown"
	if err := validateNode(invalid); err == nil {
		t.Fatal("Unknown engine accepted")
	}
	args := strings.Join(vpcsArgs(30101, 30102, 37), " ")
	if args != "-i 1 -u -s 30101 -c 30102 -t 127.0.0.1 -m 37" {
		t.Fatalf("Unexpected VPCS invocation: %s", args)
	}
	if err := instanceSetLink(&Instance{engine: "vpcs"}, 0, true); err != nil {
		t.Fatalf("VPCS link control must use OVS: %v", err)
	}
}
func TestVPCSAPIWithoutDisk(t *testing.T) {
	server := newTestServer(t)
	code, body := httpCall(t, server, "POST", "/api/labs", []byte(`{"name":"VPCS test"}`), true)
	assertStatus(t, code, 201, body)
	var lab Lab
	if err := json.Unmarshal(body, &lab); err != nil {
		t.Fatal(err)
	}
	url := "/api/labs/" + lab.ID + "/nodes"
	payload := []byte(`{"name":"PC1","engine":"vpcs","kind":"pc","nicCount":1,"portStyle":"eth"}`)
	code, body = httpCall(t, server, "POST", url, payload, true)
	assertStatus(t, code, 201, body)
	var pc Node
	if err := json.Unmarshal(body, &pc); err != nil {
		t.Fatal(err)
	}
	if pc.Engine != "vpcs" || pc.ImageID != "" || pc.NICCount != 1 {
		t.Fatalf("Bad VPCS response: %+v", pc)
	}
	code, body = httpCall(t, server, "GET", "/api/labs/"+lab.ID, nil, true)
	assertStatus(t, code, 200, body)
	var persisted Lab
	if err := json.Unmarshal(body, &persisted); err != nil {
		t.Fatal(err)
	}
	if len(persisted.Nodes) != 1 || persisted.Nodes[0].Engine != "vpcs" {
		t.Fatal("VPCS not persisted")
	}
	code, body = httpCall(t, server, "POST", url, []byte(`{"name":"bad","engine":"vpcs","kind":"pc","nicCount":2}`), true)
	assertStatus(t, code, 400, body)
	code, body = httpCall(t, server, "POST", url+"/batch", []byte(`{"template":{"name":"PC","engine":"vpcs","kind":"pc","nicCount":1},"count":3}`), true)
	assertStatus(t, code, 201, body)
}

type captureVPCSInput struct{ bytes.Buffer }
func (w *captureVPCSInput) Close() error { return nil }

func TestVPCSControlCDoesNotReachPTY(t *testing.T) {
	writer := &captureVPCSInput{}
	console := &Console{writer: writer}
	interrupts := 0
	if err := writeVPCSConsole(console, "ping 192.168.100.3\\r\\x03ip 192.168.100.2\\r", func() error {
		interrupts++
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if interrupts != 1 {
		t.Fatalf("expected exactly one VPCS SIGINT, got %d", interrupts)
	}
	if got, want := writer.String(), "ping 192.168.100.3\\r"+"ip 192.168.100.2\\r"; got != want {
		t.Fatalf("unexpected PTY bytes: %q, want %q", got, want)
	}
	if bytes.Contains(writer.Bytes(), []byte{0x03}) {
		t.Fatal("Ctrl+C passed to PTY instead of isolated process group")
	}
}

func TestVPCSControlCInterruptErrorStopsInput(t *testing.T) {
	writer := &captureVPCSInput{}
	console := &Console{writer: writer}
	stop := io.ErrClosedPipe
	err := writeVPCSConsole(console, "before\\x03after", func() error { return stop })
	if err == nil || !errors.Is(err, stop) {
		t.Fatalf("expected signal failure: %v", err)
	}
	if writer.String() != "before" {
		t.Fatalf("input continued after failure: %q", writer.String())
	}
}
