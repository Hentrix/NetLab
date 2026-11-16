package netlab

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestConsoleCursorAndRetention(t *testing.T) {
	c := &Console{}
	c.append([]byte("hello "))
	b, pos, reset := c.readSince(0)
	if reset || string(b) != "hello " || pos != 6 {
		t.Fatalf("initial %q cursor %d reset %t", b, pos, reset)
	}
	c.append([]byte("router> "))
	b, pos, reset = c.readSince(pos)
	if reset || string(b) != "router> " || pos != 14 {
		t.Fatalf("delta %q cursor %d reset %t", b, pos, reset)
	}
	c.append([]byte(strings.Repeat("x", 150000)))
	b, pos, reset = c.readSince(0)
	if !reset || len(b) != 16*1024 || pos <= 0 {
		t.Fatalf("retention reset=%t bytes=%d cursor=%d", reset, len(b), pos)
	}
}
func TestConsoleStreamAuthenticatedAndNonblocking(t *testing.T) {
	s := newTestServer(t)
	lab := Lab{ID: newID(), Name: "stream", Nodes: []Node{{ID: newID(), Name: "R1"}}}
	s.store.mu.Lock()
	s.store.State.Labs = append(s.store.State.Labs, lab)
	s.store.mu.Unlock()
	s.engine.instances[key(lab.ID, lab.Nodes[0].ID)] = &Instance{console: &Console{}, done: make(chan struct{}), status: "running"}
	addr := fmt.Sprintf("/api/labs/%s/nodes/%s/console/stream", lab.ID, lab.Nodes[0].ID)
	server := httptest.NewServer(s.Handler())
	defer server.Close()
	unauthorized, err := server.Client().Get(server.URL + addr)
	if err != nil {
		t.Fatal(err)
	}
	if unauthorized.StatusCode != 401 {
		t.Fatalf("unauth stream %d", unauthorized.StatusCode)
	}
	unauthorized.Body.Close()
	req, _ := http.NewRequest(http.MethodGet, server.URL+addr, nil)
	req.Header.Set("Authorization", "Bearer "+s.token)
	response, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 || !strings.HasPrefix(response.Header.Get("Content-Type"), "text/event-stream") {
		t.Fatalf("stream response %d %q", response.StatusCode, response.Header.Get("Content-Type"))
	}
	// An open console stream must NOT hold Store.mu and prevent editing/querying labs.
	check := make(chan error, 1)
	go func() {
		r, e := http.NewRequest("GET", server.URL+"/api/labs", nil)
		if e != nil {
			check <- e
			return
		}
		r.Header.Set("Authorization", "Bearer "+s.token)
		out, e := server.Client().Do(r)
		if e != nil {
			check <- e
			return
		}
		out.Body.Close()
		if out.StatusCode != 200 {
			check <- fmt.Errorf("labs HTTP %d", out.StatusCode)
			return
		}
		check <- nil
	}()
	select {
	case err := <-check:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("stream blocked other API requests")
	}
	s.engine.instances[key(lab.ID, lab.Nodes[0].ID)].console.append([]byte("Router>\r\n"))
	reader := bufio.NewReader(response.Body)
	// Header is already flushed; read event fields until a complete SSE block.
	got := false
	deadline := time.After(3 * time.Second)
	for !got {
		select {
		case <-deadline:
			t.Fatal("no console output in streaming response")
		default:
		}
		line, err := reader.ReadString('\n')
		if err != nil {
			t.Fatal(err)
		}
		if strings.HasPrefix(line, "data: ") {
			var msg struct {
				Chunk  string `json:"chunk"`
				Cursor int64  `json:"cursor"`
			}
			if err := json.Unmarshal([]byte(strings.TrimSpace(strings.TrimPrefix(line, "data: "))), &msg); err != nil {
				t.Fatal(err)
			}
			b, err := base64.StdEncoding.DecodeString(msg.Chunk)
			if err != nil {
				t.Fatal(err)
			}
			got = string(b) == "Router>\r\n"
		}
	}
}
func TestVPCSStartFailureKeepsAPIAlive(t *testing.T) {
	s := newTestServer(t)
	lab := Lab{ID: newID(), Name: "VPCS", Nodes: []Node{{ID: newID(), Name: "PC1", Engine: "vpcs", Kind: "pc", NICCount: 1}}}
	s.store.State.Labs = append(s.store.State.Labs, lab)
	path := fmt.Sprintf("/api/labs/%s/nodes/%s/start", lab.ID, lab.Nodes[0].ID)
	code, _ := httpCall(t, s, "POST", path, nil, true)
	if code != 500 {
		t.Fatalf("expected clean VPCS startup error, got %d", code)
	}
	code, _ = httpCall(t, s, "GET", "/api/health", nil, false)
	if code != 200 {
		t.Fatal("API died after failed VPCS start")
	}
}
