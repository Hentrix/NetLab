package netlab

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"testing"
)

func TestAnnotationsCRUDAndPersistence(t *testing.T) {
	s := newTestServer(t)
	code, b := httpCall(t, s, "POST", "/api/labs", []byte(`{"name":"Annotated topology"}`), true)
	assertStatus(t, code, 201, b)
	var lab Lab
	if err := json.Unmarshal(b, &lab); err != nil {
		t.Fatal(err)
	}
	url := fmt.Sprintf("/api/labs/%s/annotations", lab.ID)
	code, b = httpCall(t, s, "POST", url, []byte(`{"kind":"note","text":"BGP core","x":100,"y":130,"width":260,"height":110}`), true)
	assertStatus(t, code, 201, b)
	var a Annotation
	if err := json.Unmarshal(b, &a); err != nil {
		t.Fatal(err)
	}
	if !validID(a.ID) {
		t.Fatalf("bad annotation id: %q", a.ID)
	}
	code, b = httpCall(t, s, "PATCH", url+"/"+a.ID, []byte(`{"kind":"note","text":"PE1 ↔ PE2","x":220,"y":150,"width":280,"height":120,"color":"#993344","background":"transparent","borderColor":"#aabbcc","borderWidth":2,"fontSize":18,"bold":true,"align":"center"}`), true)
	assertStatus(t, code, 200, b)
	loaded, err := LoadStore(filepath.Join(s.data, "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	found := loaded.State.Labs[0].Annotations
	if len(found) != 1 || found[0].Text != "PE1 ↔ PE2" || found[0].X != 220 || found[0].FontSize != 18 || !found[0].Bold || found[0].Background != "transparent" || found[0].BorderWidth != 2 {
		t.Fatalf("not persisted: %+v", found)
	}
	code, b = httpCall(t, s, "PATCH", url+"/"+a.ID, []byte(`{"kind":"note","text":"x","x":-1,"y":0,"width":200,"height":80}`), true)
	assertStatus(t, code, 400, b)
	code, b = httpCall(t, s, "PATCH", url+"/"+a.ID, []byte(`{"kind":"note","text":"safe","x":1,"y":1,"width":200,"height":80,"color":"red"}`), true)
	assertStatus(t, code, 400, b)
	code, b = httpCall(t, s, "DELETE", url+"/"+a.ID, nil, true)
	assertStatus(t, code, 200, b)
	if len(s.store.State.Labs[0].Annotations) != 0 {
		t.Fatal("annotation still present")
	}
}

func TestPerPortDescriptorValidationAndRunningMetadata(t *testing.T) {
	s := newTestServer(t)
	imageID := newID()
	n := Node{ID: newID(), Name: "Cisco IOSv", ImageID: imageID, RAM: 512, CPUs: 1, NICModel: "e1000", NICCount: 4, DiskBus: "virtio", Kind: "router", PortStyle: "gi"}
	lab := Lab{ID: newID(), Name: "ports", Nodes: []Node{n}, Links: []Link{}}
	s.store.State.Images = append(s.store.State.Images, Image{ID: imageID, Name: "router.qcow2", Format: "qcow2"})
	s.store.State.Labs = append(s.store.State.Labs, lab)
	endpoint := "/api/labs/" + lab.ID + "/nodes/" + n.ID
	code, b := httpCall(t, s, "PATCH", endpoint, []byte(`{"ports":[{"name":"Fa0/0","speedMbps":100},{"name":"Gi0/1","speedMbps":1000}]}`), true)
	assertStatus(t, code, 200, b)
	if len(s.store.State.Labs[0].Nodes[0].Ports) != 2 {
		t.Fatal("port metadata missing")
	}
	code, b = httpCall(t, s, "PATCH", endpoint, []byte(`{"ports":[{"name":"Fa0/0","speedMbps":123}]}`), true)
	assertStatus(t, code, 400, b)
	code, b = httpCall(t, s, "PATCH", endpoint, []byte(`{"ports":[{"name":"Fa0/0","speedMbps":100},{"name":"Fa0/0","speedMbps":100}]}`), true)
	assertStatus(t, code, 400, b)
	if s.store.State.Labs[0].Nodes[0].Ports[0].SpeedMbps != 100 {
		t.Fatal("invalid update mutated ports")
	}
}
