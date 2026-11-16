package netlab

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestCPUTimesParsing(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "stat")
	if err := os.WriteFile(file, []byte("cpu  10 20 30 40 50 60 70 80\n"), 0600); err != nil {
		t.Fatal(err)
	}
	total, idle, err := cpuTimes(file)
	if err != nil || total != 360 || idle != 90 {
		t.Fatalf("%d %d %v", total, idle, err)
	}
}
func TestMemoryParsing(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "meminfo")
	if err := os.WriteFile(file, []byte("MemTotal: 32768 kB\nMemAvailable: 20480 kB\n"), 0600); err != nil {
		t.Fatal(err)
	}
	used, total, err := memTimes(file)
	if err != nil || used != 12 || total != 32 {
		t.Fatalf("%d %d %v", used, total, err)
	}
}
func TestAnnotationStyleValidation(t *testing.T) {
	a := Annotation{Kind: "note", Text: "Hi", X: 20, Y: 20, Width: 200, Height: 100, Color: "#224466", Background: "#eeeeee", BorderColor: "#cccccc", BorderWidth: 2, FontSize: 18, Bold: true, Align: "center"}
	if err := validateAnnotation(a); err != nil {
		t.Fatal(err)
	}
	a.Color = "red; background:url(javascript:xxx)"
	if err := validateAnnotation(a); err == nil {
		t.Fatal("invalid color accepted")
	}
	a.Color = "#224466"
	a.Align = "justify"
	if err := validateAnnotation(a); err == nil {
		t.Fatal("invalid alignment accepted")
	}
}

func TestMetricsEndpointRequiresAuth(t *testing.T) {
	s := newTestServer(t)
	code, b := httpCall(t, s, "GET", "/api/metrics", nil, false)
	assertStatus(t, code, 401, b)
	code, b = httpCall(t, s, "GET", "/api/metrics", nil, true)
	assertStatus(t, code, 200, b)
	var result HostMetrics
	if err := json.Unmarshal(b, &result); err != nil {
		t.Fatal(err)
	}
}
