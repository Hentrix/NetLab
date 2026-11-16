package netlab

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const testToken = "1234567890abcdef1234567890abcdef"

func newTestServer(t *testing.T) *Server {
	t.Helper()
	dir := t.TempDir()
	web := filepath.Join(dir, "web")
	if err := os.MkdirAll(web, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(web, "index.html"), []byte("OK"), 0644); err != nil {
		t.Fatal(err)
	}
	s, err := NewServer(filepath.Join(dir, "data"), web, testToken)
	if err != nil {
		t.Fatal(err)
	}
	return s
}
func httpCall(t *testing.T, s *Server, method, path string, body []byte, auth bool) (int, []byte) {
	t.Helper()
	req := httptest.NewRequest(method, path, bytes.NewReader(body))
	if auth {
		req.Header.Set("Authorization", "Bearer "+testToken)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res := httptest.NewRecorder()
	s.Handler().ServeHTTP(res, req)
	return res.Code, res.Body.Bytes()
}
func assertStatus(t *testing.T, got, want int, b []byte) {
	t.Helper()
	if got != want {
		t.Fatalf("HTTP %d want %d: %s", got, want, b)
	}
}
func TestAuthAndLabCRUD(t *testing.T) {
	s := newTestServer(t)
	code, b := httpCall(t, s, "GET", "/api/labs", nil, false)
	assertStatus(t, code, 401, b)
	code, b = httpCall(t, s, "GET", "/api/health", nil, false)
	assertStatus(t, code, 200, b)
	code, b = httpCall(t, s, "POST", "/api/labs", []byte(`{"name":"Тестовая лаборатория"}`), true)
	assertStatus(t, code, 201, b)
	var l Lab
	if err := json.Unmarshal(b, &l); err != nil {
		t.Fatal(err)
	}
	if !validID(l.ID) {
		t.Fatal("bad lab ID")
	}
	code, b = httpCall(t, s, "GET", "/api/labs/"+l.ID, nil, true)
	assertStatus(t, code, 200, b)
	if !strings.Contains(string(b), "Тестовая лаборатория") {
		t.Fatalf("no lab in response: %s", b)
	}
	code, b = httpCall(t, s, "DELETE", "/api/labs/"+l.ID, nil, true)
	assertStatus(t, code, 200, b)
	code, b = httpCall(t, s, "GET", "/api/labs/"+l.ID, nil, true)
	assertStatus(t, code, 404, b)
}
func TestGraphValidationAndPersistence(t *testing.T) {
	s := newTestServer(t)
	code, b := httpCall(t, s, "POST", "/api/labs", []byte(`{"name":"Links"}`), true)
	assertStatus(t, code, 201, b)
	var l Lab
	_ = json.Unmarshal(b, &l)
	id := newID()
	s.store.mu.Lock()
	s.store.State.Images = append(s.store.State.Images, Image{ID: id, Format: "qcow2", Name: "test.qcow2"})
	if err := s.store.save(); err != nil {
		t.Fatal(err)
	}
	s.store.mu.Unlock()
	nodes := []Node{}
	for i := 0; i < 2; i++ {
		body := []byte(fmt.Sprintf(`{"name":"Router-%d","imageId":%q,"ram":256,"cpus":1,"nicModel":"e1000","diskBus":"ide","x":100,"y":200}`, i, id))
		code, b = httpCall(t, s, "POST", "/api/labs/"+l.ID+"/nodes", body, true)
		assertStatus(t, code, 201, b)
		var n Node
		_ = json.Unmarshal(b, &n)
		nodes = append(nodes, n)
	}
	code, b = httpCall(t, s, "POST", "/api/labs/"+l.ID+"/links", []byte(fmt.Sprintf(`{"a":%q,"b":%q}`, nodes[0].ID, nodes[1].ID)), true)
	assertStatus(t, code, 201, b)
	var link Link
	_ = json.Unmarshal(b, &link)
	if link.APort != 0 || link.BPort != 0 {
		t.Fatal("first link must use port 0")
	}
	code, b = httpCall(t, s, "POST", "/api/labs/"+l.ID+"/links", []byte(fmt.Sprintf(`{"a":%q,"b":%q}`, nodes[0].ID, nodes[1].ID)), true)
	assertStatus(t, code, 201, b)
	_ = json.Unmarshal(b, &link)
	if link.APort != 1 || link.BPort != 1 {
		t.Fatal("second link must use port 1")
	}
	code, b = httpCall(t, s, "POST", "/api/labs/"+l.ID+"/links", []byte(fmt.Sprintf(`{"a":%q,"b":%q}`, nodes[0].ID, nodes[0].ID)), true)
	assertStatus(t, code, 400, b)
	code, b = httpCall(t, s, "DELETE", "/api/images/"+id, nil, true)
	assertStatus(t, code, 409, b)
	reloaded, err := LoadStore(filepath.Join(s.data, "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(reloaded.State.Labs) != 1 || len(reloaded.State.Labs[0].Nodes) != 2 || len(reloaded.State.Labs[0].Links) != 2 {
		t.Fatalf("bad saved state: %+v", reloaded.State)
	}
}
func TestUploadStandaloneQCOW2(t *testing.T) {
	// Stub qemu-img so this isolated test doesn't require QEMU packages.
	dir := t.TempDir()
	qemuImg := filepath.Join(dir, "qemu-img")
	script := "#!/bin/sh\necho '{\"format\":\"qcow2\"}'\n"
	if err := os.WriteFile(qemuImg, []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	s := newTestServer(t)
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	w, err := mw.CreateFormFile("file", "router.qcow2")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.WriteString(w, "dummy qcow2 bytes")
	_ = mw.Close()
	req := httptest.NewRequest("POST", "/api/images", &buf)
	req.Header.Set("Authorization", "Bearer "+testToken)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	res := httptest.NewRecorder()
	s.Handler().ServeHTTP(res, req)
	assertStatus(t, res.Code, 201, res.Body.Bytes())
	var img Image
	_ = json.Unmarshal(res.Body.Bytes(), &img)
	if img.Name != "router.qcow2" || img.Format != "qcow2" {
		t.Fatalf("bad image metadata %+v", img)
	}
	path := filepath.Join(s.data, "images", img.ID+".qcow2")
	if _, err := os.Stat(path); err != nil {
		t.Fatal(err)
	}
}
func TestCredentialsAndBounds(t *testing.T) {
	if _, err := NewServer(t.TempDir(), t.TempDir(), "short"); err == nil {
		t.Error("short token accepted")
	}
	if len(tapName("abcdef1234567890", 15)) > 15 {
		t.Fatal("tap name too long")
	}
	if bridgeName("abcdef1234567890") != "nlbabcdef123456" {
		t.Fatal("bridge name mismatch")
	}
	invalid := Node{Name: "A", ImageID: "abc", RAM: 64, CPUs: 1, NICModel: "e1000", DiskBus: "ide"}
	if validateNode(invalid) == nil {
		t.Fatal("invalid RAM accepted")
	}
	invalid.RAM = 512
	invalid.NICModel = "evil,args"
	if validateNode(invalid) == nil {
		t.Fatal("invalid NIC model accepted")
	}
}

func TestExplicitPortsAndVisualKind(t *testing.T) {
	s := newTestServer(t)
	code, b := httpCall(t, s, "POST", "/api/labs", []byte(`{"name":"Ports"}`), true)
	assertStatus(t, code, 201, b)
	var lab Lab
	if err := json.Unmarshal(b, &lab); err != nil {
		t.Fatal(err)
	}
	imageID := newID()
	s.store.State.Images = append(s.store.State.Images, Image{ID: imageID, Name: "example", Format: "qcow2"})
	ids := []string{}
	for _, kind := range []string{"router", "switch"} {
		body := []byte(fmt.Sprintf(`{"name":"Test","imageId":%q,"kind":%q,"ram":256,"cpus":1,"nicModel":"e1000","diskBus":"ide"}`, imageID, kind))
		code, b = httpCall(t, s, "POST", "/api/labs/"+lab.ID+"/nodes", body, true)
		assertStatus(t, code, 201, b)
		var node Node
		if err := json.Unmarshal(b, &node); err != nil {
			t.Fatal(err)
		}
		if node.Kind != kind {
			t.Fatalf("kind lost: got %q want %q", node.Kind, kind)
		}
		ids = append(ids, node.ID)
	}
	endpoint := "/api/labs/" + lab.ID + "/links"
	body := []byte(fmt.Sprintf(`{"a":%q,"b":%q,"aPort":7,"bPort":3}`, ids[0], ids[1]))
	code, b = httpCall(t, s, "POST", endpoint, body, true)
	assertStatus(t, code, 201, b)
	var link Link
	if err := json.Unmarshal(b, &link); err != nil {
		t.Fatal(err)
	}
	if link.APort != 7 || link.BPort != 3 {
		t.Fatalf("incorrect ports: %+v", link)
	}
	code, b = httpCall(t, s, "POST", endpoint, body, true)
	assertStatus(t, code, 409, b)
	body = []byte(fmt.Sprintf(`{"a":%q,"b":%q,"aPort":16,"bPort":5}`, ids[0], ids[1]))
	code, b = httpCall(t, s, "POST", endpoint, body, true)
	assertStatus(t, code, 409, b)
	body = []byte(fmt.Sprintf(`{"a":%q,"b":%q}`, ids[0], ids[1]))
	code, b = httpCall(t, s, "POST", endpoint, body, true)
	assertStatus(t, code, 201, b)
	if err := json.Unmarshal(b, &link); err != nil {
		t.Fatal(err)
	}
	if link.APort != 0 || link.BPort != 0 {
		t.Fatalf("automatic ports not lowest free: %+v", link)
	}
}

func TestVisualChangesWhileRunningCompatible(t *testing.T) {
	s := newTestServer(t)
	code, b := httpCall(t, s, "POST", "/api/labs", []byte(`{"name":"Visual test"}`), true)
	assertStatus(t, code, 201, b)
	var lab Lab
	_ = json.Unmarshal(b, &lab)
	imageID := newID()
	s.store.State.Images = append(s.store.State.Images, Image{ID: imageID, Name: "router.qcow2", Format: "qcow2"})
	body := []byte(fmt.Sprintf(`{"name":"Router","imageId":%q,"ram":256,"cpus":1,"nicModel":"e1000","diskBus":"ide","kind":"router","icon":"Router Blue.png"}`, imageID))
	code, b = httpCall(t, s, "POST", "/api/labs/"+lab.ID+"/nodes", body, true)
	assertStatus(t, code, 201, b)
	var node Node
	_ = json.Unmarshal(b, &node)
	url := "/api/labs/" + lab.ID + "/nodes/" + node.ID
	code, b = httpCall(t, s, "PATCH", url, []byte(`{"x":265,"y":330,"name":"R1","icon":"Router.png"}`), true)
	assertStatus(t, code, 200, b)
	var changed Lab
	_ = json.Unmarshal(b, &changed)
	if changed.Nodes[0].X != 265 || changed.Nodes[0].Y != 330 || changed.Nodes[0].Icon != "Router.png" || changed.Nodes[0].Name != "R1" {
		t.Fatalf("bad updated node: %+v", changed.Nodes[0])
	}
	code, b = httpCall(t, s, "PATCH", url, []byte(`{"icon":"../../etc/passwd"}`), true)
	assertStatus(t, code, 400, b)
	code, b = httpCall(t, s, "PATCH", url, []byte(`{"x":-10}`), true)
	assertStatus(t, code, 400, b)
	state, err := LoadStore(filepath.Join(s.data, "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	if state.State.Labs[0].Nodes[0].Icon != "Router.png" {
		t.Fatal("icon not persisted")
	}
}

func TestUserIconCatalogueAndValidation(t *testing.T) {
	b, err := os.ReadFile("../../web/icons.json")
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	if err := json.Unmarshal(b, &names); err != nil {
		t.Fatal(err)
	}
	if len(names) != 550 {
		t.Fatalf("expected 550 icons, got %d", len(names))
	}
	for _, name := range names {
		if !safeIcon.MatchString(name) {
			t.Errorf("invalid user image filename %q", name)
		}
		if _, err := os.Stat(filepath.Join("../../web/icons", name)); err != nil {
			t.Errorf("icon %q: %v", name, err)
		}
	}
}

// Interface labels are presentation metadata: they can be changed even while
// VM links exist, without changing the interface indices used by QEMU/OVS.
func TestPortStyleMetadataAndValidation(t *testing.T) {
	s := newTestServer(t)
	imageID := newID()
	n := Node{ID: newID(), Name: "Router", ImageID: imageID, RAM: 256, CPUs: 1, NICModel: "e1000", NICCount: 4, DiskBus: "virtio", Kind: "router", PortStyle: "gi"}
	lab := Lab{ID: newID(), Name: "label", Nodes: []Node{n}, Links: []Link{}}
	s.store.State.Images = append(s.store.State.Images, Image{ID: imageID, Name: "test.qcow2", Format: "qcow2"})
	s.store.State.Labs = append(s.store.State.Labs, lab)
	uri := "/api/labs/" + lab.ID + "/nodes/" + n.ID
	code, response := httpCall(t, s, "PATCH", uri, []byte(`{"portStyle":"ge"}`), true)
	assertStatus(t, code, 200, response)
	if got := s.store.State.Labs[0].Nodes[0].PortStyle; got != "ge" {
		t.Fatalf("port style not saved: %q", got)
	}
	code, response = httpCall(t, s, "PATCH", uri, []byte(`{"portStyle":"../../etc/passwd"}`), true)
	assertStatus(t, code, 400, response)
	if got := s.store.State.Labs[0].Nodes[0].PortStyle; got != "ge" {
		t.Fatalf("invalid port style changed node: %q", got)
	}
}

func TestBatchNodeCreationAndValidation(t *testing.T) {
	s := newTestServer(t)
	status, body := httpCall(t, s, "POST", "/api/labs", []byte(`{"name":"Batch topology"}`), true)
	assertStatus(t, status, 201, body)
	var l Lab
	if err := json.Unmarshal(body, &l); err != nil {
		t.Fatal(err)
	}
	id := newID()
	s.store.mu.Lock()
	s.store.State.Images = append(s.store.State.Images, Image{ID: id, Name: "test.qcow2", Format: "qcow2"})
	if err := s.store.save(); err != nil {
		t.Fatal(err)
	}
	s.store.mu.Unlock()
	node := Node{Name: "MikroTik CHR", ImageID: id, RAM: 256, CPUs: 1, NICModel: "e1000", NICCount: 4, DiskBus: "ide", Kind: "router", X: 100, Y: 100}
	batch := func(count int, n Node) (int, []byte) {
		req, _ := json.Marshal(map[string]any{"count": count, "template": n})
		return httpCall(t, s, "POST", "/api/labs/"+l.ID+"/nodes/batch", req, true)
	}
	status, body = batch(3, node)
	assertStatus(t, status, 201, body)
	var created struct {
		Nodes []Node `json:"nodes"`
	}
	if err := json.Unmarshal(body, &created); err != nil {
		t.Fatal(err)
	}
	if len(created.Nodes) != 3 || created.Nodes[0].Name != "MikroTik CHR 1" || created.Nodes[1].Name != "MikroTik CHR 2" {
		t.Fatalf("unexpected nodes: %+v", created.Nodes)
	}
	if created.Nodes[0].X == created.Nodes[1].X {
		t.Fatal("nodes overlap")
	}
	status, body = batch(2, node)
	assertStatus(t, status, 201, body)
	_ = json.Unmarshal(body, &created)
	if created.Nodes[0].Name != "MikroTik CHR 4" || created.Nodes[1].Name != "MikroTik CHR 5" {
		t.Fatalf("names not unique: %+v", created.Nodes)
	}
	status, body = batch(33, node)
	assertStatus(t, status, 400, body)
	node.NICModel = "broken"
	status, body = batch(2, node)
	assertStatus(t, status, 400, body)
	status, body = httpCall(t, s, "GET", "/api/labs/"+l.ID, nil, true)
	assertStatus(t, status, 200, body)
	_ = json.Unmarshal(body, &l)
	if len(l.Nodes) != 5 {
		t.Fatalf("failed request must not write nodes: got %d", len(l.Nodes))
	}
	reloaded, err := LoadStore(filepath.Join(s.data, "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(reloaded.State.Labs[0].Nodes) != 5 {
		t.Fatal("batch nodes not persisted")
	}
}
