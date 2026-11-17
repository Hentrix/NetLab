package netlab

import (
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Server struct {
	store            *Store
	engine           *Engine
	data, web, token string
	sampler          metricSampler
	ticketsMu        sync.Mutex
	vncTickets       map[string]vncTicket
}

func NewServer(data, web, token string) (*Server, error) {
	if len(token) < 24 {
		return nil, errors.New("NETLAB_ADMIN_TOKEN must be at least 24 characters")
	}
	data, err := filepath.Abs(data)
	if err != nil {
		return nil, err
	}
	for _, dir := range []string{data, filepath.Join(data, "images"), filepath.Join(data, "runtime")} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return nil, err
		}
	}
	store, err := LoadStore(filepath.Join(data, "state.json"))
	if err != nil {
		return nil, err
	}
	if err := recoverStagedImageDeletes(data, store.State.Images); err != nil {
		return nil, err
	}
	e := NewEngine(data)
	// Reconcile stale lab switches only when the system tools are present.
	if _, err := exec.LookPath("ovs-vsctl"); err == nil {
		e.Recover(store.State.Labs)
	}
	return &Server{store: store, engine: e, data: data, web: web, token: token,vncTickets:make(map[string]vncTicket)}, nil
}
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			http.Error(w, "method not allowed", 405)
			return
		}
		respond(w, 200, map[string]any{"status": "ok", "version": "0.8.2"})
	})
	mux.Handle("/api/", s.auth(http.HandlerFunc(s.api)))
	mux.HandleFunc("/vnc/",s.proxyVNC)
	mux.Handle("/novnc/",http.StripPrefix("/novnc/",http.FileServer(http.Dir("/usr/share/novnc"))))
	mux.Handle("/", http.FileServer(http.Dir(s.web)))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Cache-Control", "no-store")
		mux.ServeHTTP(w, r)
	})
}
func (s *Server) auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if len(token) != len(s.token) || subtle.ConstantTimeCompare([]byte(token), []byte(s.token)) != 1 {
			w.Header().Set("WWW-Authenticate", "Bearer")
			fail(w, 401, "требуется токен администратора")
			return
		}
		next.ServeHTTP(w, r)
	})
}
func respond(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, code int, msg string) {
	respond(w, code, map[string]string{"error": msg})
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		fail(w, 400, err.Error())
		return false
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		fail(w, 400, "ожидался один JSON-объект")
		return false
	}
	return true
}
func (s *Server) withStatuses(l Lab) Lab {
	for i := range l.Nodes {
		l.Nodes[i].Status, l.Nodes[i].Error = s.engine.Status(l.ID, l.Nodes[i].ID)
	}
	for i := range l.Links {
		l.Links[i].Status = s.engine.CableStatus(l, l.Links[i])
	}
	return l
}
func (s *Server) hasRunning(l Lab) bool {
	for _, n := range l.Nodes {
		st, _ := s.engine.Status(l.ID, n.ID)
		if st == "running" {
			return true
		}
	}
	return false
}
func (s *Server) api(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/"), "/"), "/")
	if len(parts)==5 && parts[0]=="labs" && parts[2]=="nodes" && parts[4]=="vnc-ticket" {
		s.issueVNCTicket(w,r,parts[1],parts[3])
		return
	}
	if len(parts) == 6 && parts[0] == "labs" && parts[2] == "nodes" && parts[4] == "console" && parts[5] == "stream" {
		s.consoleStream(w, r, parts[1], parts[3])
		return
	}
	switch parts[0] {
	case "metrics":
		if r.Method != http.MethodGet {
			fail(w, 405, "method not allowed")
			return
		}
		respond(w, 200, s.metrics())
		return
	case "system":
		if r.Method != "GET" {
			fail(w, 405, "method not allowed")
			return
		}
		_, q := exec.LookPath("qemu-system-x86_64")
		_, ov := exec.LookPath("ovs-vsctl")
		_, img := exec.LookPath("qemu-img")
		_, vpcsErr := exec.LookPath("vpcs")
		_, userErr := user.Lookup("netlab-vm")
		qemuSpawn, qemuSpawnError := probeQEMUSpawn()
		vpcsSpawn, vpcsSpawnError := probeVPCSSpawn()
		var kvm bool
		if userErr == nil {
			if cred, _, _, credErr := vmCredential(); credErr == nil {
				kvm = canUseKVM(cred)
			}
		}
		respond(w, 200, map[string]any{"qemu": q == nil, "ovs": ov == nil, "qemuImg": img == nil, "vmUser": userErr == nil, "kvm": kvm, "qemuSpawn": qemuSpawn, "qemuSpawnError": qemuSpawnError, "vpcs": vpcsErr == nil, "vpcsSpawn": vpcsSpawn, "vpcsSpawnError": vpcsSpawnError})
		return
	case "templates":
		if r.Method != "GET" {
			fail(w, 405, "method not allowed")
			return
		}
		respond(w, 200, s.catalogTemplates())
		return
	case "images":
		s.imagesAPI(w, r, parts)
		return
	case "workshop":
		s.workshopAPI(w, r, parts)
		return
	case "labs":
		s.labsAPI(w, r, parts)
		return
	default:
		fail(w, 404, "неизвестный API")
		return
	}
}

// consoleStream emits authenticated, bounded incremental console data. It is
// routed before labsAPI, whose store lock cannot be held for a long stream.
func (s *Server) consoleStream(w http.ResponseWriter, r *http.Request, labID, nodeID string) {
	if r.Method != http.MethodGet {
		fail(w, 405, "method not allowed")
		return
	}
	if !validID(labID) || !validID(nodeID) {
		fail(w, 404, "узел не найден")
		return
	}
	s.store.mu.Lock()
	l := s.store.findLab(labID)
	exists := l != nil && findNode(l, nodeID) != nil
	s.store.mu.Unlock()
	if !exists {
		fail(w, 404, "узел не найден")
		return
	}
	cursor := int64(0)
	if raw := r.URL.Query().Get("cursor"); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || parsed < 0 {
			fail(w, 400, "неверная позиция консоли")
			return
		}
		cursor = parsed
	}
	// Validate instance before sending headers (otherwise API errors become 200 SSE).
	_, _, _, err := s.engine.ReadConsoleSince(labID, nodeID, cursor)
	if err != nil {
		fail(w, 409, err.Error())
		return
	}
	flush, ok := w.(http.Flusher)
	if !ok {
		fail(w, 500, "потоковый вывод не поддерживается")
		return
	}
	h := w.Header()
	h.Set("Content-Type", "text/event-stream; charset=utf-8")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Accel-Buffering", "no")
	flush.Flush()
	ticker := time.NewTicker(120 * time.Millisecond)
	keepalive := time.NewTicker(12 * time.Second)
	defer ticker.Stop()
	defer keepalive.Stop()
	for {
		data, next, reset, err := s.engine.ReadConsoleSince(labID, nodeID, cursor)
		if err != nil {
			_, _ = fmt.Fprintf(w, "event: closed\ndata: {}\n\n")
			flush.Flush()
			return
		}
		if len(data) > 0 || reset {
			payload, _ := json.Marshal(map[string]any{"chunk": base64.StdEncoding.EncodeToString(data), "cursor": next, "reset": reset})
			if _, err = fmt.Fprintf(w, "event: output\ndata: %s\n\n", payload); err != nil {
				return
			}
			flush.Flush()
			cursor = next
			continue // drain more than 16 KiB without delaying full scrollback
		}
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
		case <-keepalive.C:
			if _, err = io.WriteString(w, ": keepalive\n\n"); err != nil {
				return
			}
			flush.Flush()
		}
	}
}
func (s *Server) imagesAPI(w http.ResponseWriter, r *http.Request, p []string) {
	if len(p) == 1 {
		if r.Method == "GET" {
			s.store.mu.Lock()
			v := append([]Image{}, s.store.State.Images...)
			s.store.mu.Unlock()
			respond(w, 200, v)
			return
		}
		if r.Method == "POST" {
			s.uploadImage(w, r)
			return
		}
	}
	if len(p)==2 && p[1]=="blank" && r.Method==http.MethodPost { s.createBlankImage(w,r);return }
	if len(p)==2 && validID(p[1]) && r.Method==http.MethodPatch { s.updateImageMetadata(w,r,p[1]);return }
	if len(p) == 2 && r.Method == "DELETE" && validID(p[1]) {
		s.store.mu.Lock()
		defer s.store.mu.Unlock()
		for _, lab := range s.store.State.Labs {
			for _, n := range lab.Nodes {
				if n.ImageID == p[1] || n.InstallISOID == p[1] {
					fail(w, 409, "образ используется лабораторией")
					return
				}
			}
		}
		for i, img := range s.store.State.Images {
			if img.ID == p[1] {
				// Stage the file before changing the database. A failed state save
				// must never leave an in-memory deletion or a broken base image.
				path := filepath.Join(s.data, "images", img.ID+"."+img.Format)
				staged := path + ".deleting"
				if err := os.Rename(path, staged); err != nil {
					fail(w, 500, "не удалось подготовить образ к удалению: "+err.Error())
					return
				}
				previous := s.store.State.Images
				next := make([]Image, 0, len(previous)-1)
				next = append(next, previous[:i]...)
				next = append(next, previous[i+1:]...)
				s.store.State.Images = next
				if err := s.store.save(); err != nil {
					s.store.State.Images = previous
					if restoreErr := os.Rename(staged, path); restoreErr != nil {
						fail(w, 500, "не удалось восстановить образ после ошибки сохранения: "+restoreErr.Error())
						return
					}
					fail(w, 500, err.Error())
					return
				}
				// A cleanup failure leaves an unreferenced staged file, not a
				// corrupted database or a dangling overlay backing file.
				if err := os.Remove(staged); err != nil {
					respond(w, 200, map[string]bool{"deleted": true, "cleanupPending": true})
					return
				}
				respond(w, 200, map[string]bool{"deleted": true})
				return
			}
		}
	}
	fail(w, 404, "образ не найден")
}
func (s *Server) uploadImage(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 16<<30)
	mr, err := r.MultipartReader()
	if err != nil {
		fail(w, 400, "ожидался multipart/form-data")
		return
	}
	part, err := mr.NextPart()
	if err != nil {
		fail(w, 400, "не найден файл")
		return
	}
	defer part.Close()
	if part.FormName() != "file" || part.FileName() == "" {
		fail(w, 400, "первой частью должен быть file")
		return
	}
	filename := filepath.Base(part.FileName())
	if len(filename) > 150 {
		fail(w, 400, "слишком длинное имя файла")
		return
	}
	id := newID()
	tmp := filepath.Join(s.data, "images", id+".upload")
	defer os.Remove(tmp)
	size, err := copyFile(tmp, part)
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	if size == 0 {
		fail(w, 400, "пустой образ")
		return
	}
	format := ""
	if strings.EqualFold(filepath.Ext(filename),".iso") {
		if err := validateInstallerISO(tmp); err != nil { fail(w,422,err.Error());return }
		format="iso"
	}else{
		if _, err := exec.LookPath("qemu-img"); err != nil { fail(w,503,"требуется пакет qemu-utils");return }
		format, err = imageInfo(tmp)
		if err != nil { fail(w,422,err.Error());return }
	}
	final := filepath.Join(s.data, "images", id+"."+format)
	if err := os.Rename(tmp, final); err != nil {
		fail(w, 500, err.Error())
		return
	}
	if u, err := user.Lookup("netlab-vm"); err == nil {
		uid, _ := parseInt(u.Uid)
		gid, _ := parseInt(u.Gid)
		_ = os.Chown(final, uid, gid)
	}
	kind:="disk"
	if format=="iso" { kind="iso" }
	img := Image{ID: id, Name: filename, Size: size, Format: format, Kind: kind, CreatedAt: time.Now()}
	s.store.mu.Lock()
	s.store.State.Images = append(s.store.State.Images, img)
	err = s.store.save()
	s.store.mu.Unlock()
	if err != nil {
		_ = os.Remove(final)
		fail(w, 500, err.Error())
		return
	}
	respond(w, 201, img)
}
func parseInt(s string) (int, error) { var v int; _, err := fmt.Sscanf(s, "%d", &v); return v, err }

// Each node selects its own emulation driver. Legacy saved nodes default to QEMU.
func (s *Server) startNode(l Lab, n Node) error {
	if n.Engine == "vpcs" {
		return s.engine.StartVPCS(l, n)
	}
	img := findImage(&s.store.State, n.ImageID)
	if img == nil || img.isISO() {
		return fmt.Errorf("дисковый образ узла %s не найден", n.Name)
	}
	if n.InstallISOID!="" {
		iso:=findImage(&s.store.State,n.InstallISOID)
		if iso==nil || !iso.isISO() { return fmt.Errorf("ISO установщика узла %s не найден",n.Name) }
	}
	return s.engine.Start(l, n, *img)
}

func (s *Server) labsAPI(w http.ResponseWriter, r *http.Request, p []string) {
	if len(p) == 1 {
		if r.Method == "GET" {
			s.store.mu.Lock()
			labs := append([]Lab{}, s.store.State.Labs...)
			s.store.mu.Unlock()
			for i := range labs {
				labs[i] = s.withStatuses(labs[i])
			}
			respond(w, 200, labs)
			return
		}
		if r.Method == "POST" {
			var req struct {
				Name string `json:"name"`
			}
			if !decode(w, r, &req) {
				return
			}
			if err := validName(req.Name); err != nil {
				fail(w, 400, err.Error())
				return
			}
			lab := Lab{ID: newID(), Name: strings.TrimSpace(req.Name), CreatedAt: time.Now(), Nodes: []Node{}, Links: []Link{}, Annotations: []Annotation{}}
			s.store.mu.Lock()
			s.store.State.Labs = append(s.store.State.Labs, lab)
			err := s.store.save()
			s.store.mu.Unlock()
			if err != nil {
				fail(w, 500, err.Error())
				return
			}
			respond(w, 201, lab)
			return
		}
		fail(w, 405, "method not allowed")
		return
	}
	id := p[1]
	if !validID(id) {
		fail(w, 404, "лаборатория не найдена")
		return
	}
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	lab := s.store.findLab(id)
	if lab == nil {
		fail(w, 404, "лаборатория не найдена")
		return
	}
	if len(p) == 2 {
		if r.Method == "GET" {
			respond(w, 200, s.withStatuses(*lab))
			return
		}
		if r.Method == "DELETE" {
			if s.hasRunning(*lab) {
				fail(w, 409, "сначала остановите лабораторию")
				return
			}
			s.engine.Cleanup(*lab)
			for i := range s.store.State.Labs {
				if s.store.State.Labs[i].ID == id {
					s.store.State.Labs = append(s.store.State.Labs[:i], s.store.State.Labs[i+1:]...)
					break
				}
			}
			if err := s.store.save(); err != nil {
				fail(w, 500, err.Error())
				return
			}
			_ = os.RemoveAll(filepath.Join(s.data, "runtime", id))
			respond(w, 200, map[string]bool{"deleted": true})
			return
		}
	}
	if len(p) == 3 && r.Method == "POST" {
		if p[2] == "start" {
			for _, n := range lab.Nodes {
				if err := s.startNode(*lab, n); err != nil {
					fail(w, 500, n.Name+": "+err.Error())
					return
				}
			}
			respond(w, 200, s.withStatuses(*lab))
			return
		}
		if p[2] == "stop" {
			s.engine.Cleanup(*lab)
			respond(w, 200, s.withStatuses(*lab))
			return
		}
	}
	if len(p) >= 3 && p[2] == "annotations" {
		s.annotationsAPI(w, r, p, lab)
		return
	}
	if len(p) >= 3 && p[2] == "nodes" {
		s.nodesAPI(w, r, p, lab)
		return
	}
	if len(p) >= 3 && p[2] == "links" {
		s.linksAPI(w, r, p, lab)
		return
	}
	fail(w, 404, "неизвестная операция")
}
func (s *Server) nodesAPI(w http.ResponseWriter, r *http.Request, p []string, l *Lab) {
	// Create multiple stopped devices atomically, without starting guest processes.
	if len(p) == 4 && p[3] == "batch" && r.Method == http.MethodPost {
		var req struct {
			Template Node `json:"template"`
			Count    int  `json:"count"`
		}
		if !decode(w, r, &req) {
			return
		}
		if req.Count < 1 || req.Count > 32 {
			fail(w, 400, "количество устройств должно быть от 1 до 32")
			return
		}
		if req.Template.Kind == "" {
			req.Template.Kind = "router"
		}
		if req.Template.NICModel == "" {
			req.Template.NICModel = "virtio-net-pci"
		}
		if req.Template.DiskBus == "" {
			req.Template.DiskBus = "virtio"
		}
		if req.Template.NICCount == 0 {
			if req.Template.Engine == "vpcs" {
				req.Template.NICCount = 1
			} else {
				req.Template.NICCount = 16
			}
		}
		if err := validateNode(req.Template); err != nil {
			fail(w, 400, err.Error())
			return
		}
		if req.Template.Engine != "vpcs" && !s.validNodeMedia(req.Template) {
			fail(w, 404, "образ не найден")
			return
		}
		added, err := buildNodeBatch(l.Nodes, req.Template, req.Count)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		oldCount := len(l.Nodes)
		l.Nodes = append(l.Nodes, added...)
		if err := s.store.save(); err != nil {
			l.Nodes = l.Nodes[:oldCount]
			fail(w, 500, err.Error())
			return
		}
		respond(w, 201, map[string]any{"nodes": added})
		return
	}
	if len(p) == 3 && r.Method == "POST" {
		var req Node
		if !decode(w, r, &req) {
			return
		}
		req.ID = newID()
		req.Status = "stopped"
		if req.Kind == "" {
			req.Kind = "router"
		}
		req.Error = ""
		if req.NICModel == "" {
			req.NICModel = "virtio-net-pci"
		}
		if req.DiskBus == "" {
			req.DiskBus = "virtio"
		}
		if req.NICCount == 0 {
			if req.Engine == "vpcs" {
				req.NICCount = 1
			} else {
				// Older API clients only knew 16 Ethernet ports.
				req.NICCount = 16
			}
		}
		if err := validateNode(req); err != nil {
			fail(w, 400, err.Error())
			return
		}
		if req.Engine != "vpcs" && !s.validNodeMedia(req) {
			fail(w, 404, "образ не найден")
			return
		}
		l.Nodes = append(l.Nodes, req)
		if err := s.store.save(); err != nil {
			fail(w, 500, err.Error())
			return
		}
		respond(w, 201, req)
		return
	}
	if len(p) < 4 || !validID(p[3]) {
		fail(w, 404, "узел не найден")
		return
	}
	node := findNode(l, p[3])
	if node == nil {
		fail(w, 404, "узел не найден")
		return
	}
	if len(p) == 4 {
		// Presentation-only edits may be saved while virtual machines are running.
		// Never replace QEMU settings or image IDs through this endpoint.
		if r.Method == "PATCH" {
			var req struct {
				X         *int        `json:"x"`
				Y         *int        `json:"y"`
				Name      *string     `json:"name"`
				Icon      *string     `json:"icon"`
				PortStyle *string     `json:"portStyle"`
				Ports     *[]PortSpec `json:"ports"`
			}
			if !decode(w, r, &req) {
				return
			}
			next := *node
			if req.X != nil {
				if *req.X < -10000 || *req.X > 10000 {
					fail(w, 400, "x вне диапазона")
					return
				}
				next.X = *req.X
			}
			if req.Y != nil {
				if *req.Y < -10000 || *req.Y > 10000 {
					fail(w, 400, "y вне диапазона")
					return
				}
				next.Y = *req.Y
			}
			if req.Name != nil {
				if err := validName(*req.Name); err != nil {
					fail(w, 400, err.Error())
					return
				}
				next.Name = strings.TrimSpace(*req.Name)
			}
			if req.Icon != nil {
				if *req.Icon != "" && !safeIcon.MatchString(*req.Icon) {
					fail(w, 400, "недопустимое имя PNG-иконки")
					return
				}
				next.Icon = *req.Icon
			}
			if req.Ports != nil {
				next.Ports = append([]PortSpec{}, (*req.Ports)...)
				if err := validateNode(next); err != nil {
					fail(w, 400, err.Error())
					return
				}
			}
			if req.PortStyle != nil {
				next.PortStyle = *req.PortStyle
				if err := validateNode(next); err != nil {
					fail(w, 400, err.Error())
					return
				}
			}
			*node = next
			if err := s.store.save(); err != nil {
				fail(w, 500, err.Error())
				return
			}
			respond(w, 200, s.withStatuses(*l))
			return
		}
		if r.Method == "PUT" {
			if s.hasRunning(*l) {
				fail(w, 409, "остановите лабораторию для изменения топологии")
				return
			}
			var req Node
			if !decode(w, r, &req) {
				return
			}
			req.ID = node.ID
			req.Engine = node.Engine
			req.Status = "stopped"
			if req.Kind == "" {
				req.Kind = node.Kind
			}
			if err := validateNode(req); err != nil {
				fail(w, 400, err.Error())
				return
			}
			if req.Engine != "vpcs" && !s.validNodeMedia(req) {
				fail(w, 404, "образ не найден")
				return
			}
			for _, link := range l.Links {
				if link.A == node.ID && link.APort >= portCapacity(&req) || link.B == node.ID && link.BPort >= portCapacity(&req) {
					fail(w, 409, "сначала удалите кабели с портов, выходящих за новый диапазон")
					return
				}
			}
			if req.ImageID != node.ImageID {
				if _, err := os.Stat(filepath.Join(s.data, "runtime", l.ID, node.ID, "disk.qcow2")); err == nil {
					fail(w, 409, "образ нельзя заменить у уже запущенного ранее узла: создайте новый узел")
					return
				}
			}
			*node = req
			if err := s.store.save(); err != nil {
				fail(w, 500, err.Error())
				return
			}
			respond(w, 200, req)
			return
		}
		if r.Method == "DELETE" {
			if s.hasRunning(*l) {
				fail(w, 409, "остановите лабораторию для удаления узла")
				return
			}
			for i := len(l.Links) - 1; i >= 0; i-- {
				if l.Links[i].A == node.ID || l.Links[i].B == node.ID {
					_ = run("ovs-vsctl", "--if-exists", "del-br", bridgeName(l.Links[i].ID))
					l.Links = append(l.Links[:i], l.Links[i+1:]...)
				}
			}
			for i := range l.Nodes {
				if l.Nodes[i].ID == node.ID {
					l.Nodes = append(l.Nodes[:i], l.Nodes[i+1:]...)
					break
				}
			}
			if err := s.store.save(); err != nil {
				fail(w, 500, err.Error())
				return
			}
			_ = os.RemoveAll(filepath.Join(s.data, "runtime", l.ID, p[3]))
			respond(w, 200, map[string]bool{"deleted": true})
			return
		}
	}
	if len(p) == 5 {
		action := p[4]
		if r.Method == http.MethodPatch && action == "media" {
			if node.Engine == "vpcs" {fail(w,409,"VPCS не поддерживает ISO");return}
			if s.hasRunning(*l) {fail(w,409,"сначала остановите лабораторию");return}
			var req struct {
				InstallISOID *string `json:"installISOId"`
				BootOrder *string `json:"bootOrder"`
			}
			if !decode(w,r,&req) {return}
			if req.InstallISOID==nil || req.BootOrder==nil {
				fail(w,400,"укажите installISOId и bootOrder");return
			}
			next:=*node
			next.InstallISOID=*req.InstallISOID
			next.BootOrder=*req.BootOrder
			if next.InstallISOID!="" && !validID(next.InstallISOID) {
				fail(w,400,"неверный ID ISO");return
			}
			if err:=validateNode(next);err!=nil {fail(w,400,err.Error());return}
			if !s.validNodeMedia(next) {fail(w,404,"ISO установщика не найден");return}
			before:=*node
			*node=next
			if err:=s.store.save();err!=nil {
				*node=before
				fail(w,500,err.Error());return
			}
			respond(w,200,next)
			return
		}
		if r.Method == "POST" && action == "start" {
			if err := s.startNode(*l, *node); err != nil {
				fail(w, 500, err.Error())
				return
			}
			respond(w, 200, s.withStatuses(*l))
			return
		}
		if r.Method == "POST" && action == "stop" {
			if err := s.engine.Stop(l.ID, node.ID); err != nil {
				fail(w, 500, err.Error())
				return
			}
			respond(w, 200, s.withStatuses(*l))
			return
		}
		if action == "console" && r.Method == "GET" {
			output, err := s.engine.ReadConsole(l.ID, node.ID)
			if err != nil {
				fail(w, 409, err.Error())
				return
			}
			respond(w, 200, map[string]string{"output": output})
			return
		}
		if action == "console" && r.Method == "POST" {
			var req struct {
				Text string `json:"text"`
			}
			if !decode(w, r, &req) {
				return
			}
			if err := s.engine.WriteConsole(l.ID, node.ID, req.Text); err != nil {
				fail(w, 409, err.Error())
				return
			}
			respond(w, 200, map[string]bool{"ok": true})
			return
		}
		if action == "log" && r.Method == "GET" {
			respond(w, 200, map[string]string{"output": tailLog(filepath.Join(s.data, "runtime", l.ID, node.ID, map[bool]string{true: "vpcs.log", false: "qemu.log"}[node.Engine == "vpcs"]))})
			return
		}
	}
	fail(w, 404, "неизвестная операция")
}

// linksAPI treats an Ethernet cable change as a host transaction: update
// TAP/OVS/QMP first, persist only when the network operation succeeded.
// Failed database writes trigger best-effort physical rollback.
func (s *Server) linksAPI(w http.ResponseWriter, r *http.Request, p []string, l *Lab) {
	type request struct {
		A         string  `json:"a"`
		B         string  `json:"b"`
		APort     *int    `json:"aPort"`
		BPort     *int    `json:"bPort"`
		Color     *string `json:"color"`
		LineWidth *int    `json:"lineWidth"`
		LineStyle *string `json:"lineStyle"`
	}
	visual := func(old Link, req request) (Link, error) {
		next := old
		if req.Color != nil {
			if *req.Color != "" && !safeHexColor.MatchString(*req.Color) {
				return Link{}, errors.New("цвет линии должен быть #RRGGBB")
			}
			next.Color = *req.Color
		}
		if req.LineWidth != nil {
			if *req.LineWidth < 0 || *req.LineWidth > 4 {
				return Link{}, errors.New("толщина кабеля должна быть от 0 до 4 px")
			}
			next.LineWidth = *req.LineWidth
		}
		if req.LineStyle != nil {
			if *req.LineStyle != "" && *req.LineStyle != "solid" && *req.LineStyle != "dashed" && *req.LineStyle != "dotted" {
				return Link{}, errors.New("недопустимый тип линии")
			}
			next.LineStyle = *req.LineStyle
		}
		return next, nil
	}
	validate := func(req request, exclude string) (Link, error) {
		if req.A == req.B || findNode(l, req.A) == nil || findNode(l, req.B) == nil {
			return Link{}, errors.New("нужны два разных существующих устройства")
		}
		candidate := *l
		candidate.Links = make([]Link, 0, len(l.Links))
		for _, x := range l.Links {
			if x.ID != exclude {
				candidate.Links = append(candidate.Links, x)
			}
		}
		ap, err := nextPort(candidate, req.A)
		if err != nil {
			return Link{}, err
		}
		bp, err := nextPort(candidate, req.B)
		if err != nil {
			return Link{}, err
		}
		if req.APort != nil {
			ap = *req.APort
		}
		if req.BPort != nil {
			bp = *req.BPort
		}
		if !portIsFree(candidate, req.A, ap) || !portIsFree(candidate, req.B, bp) {
			return Link{}, errors.New("интерфейс занят или номер вне диапазона, заданного для узла")
		}
		return Link{ID: exclude, A: req.A, B: req.B, APort: ap, BPort: bp}, nil
	}
	if len(p) == 3 && r.Method == "POST" {
		var req request
		if !decode(w, r, &req) {
			return
		}
		if req.A == req.B || findNode(l, req.A) == nil || findNode(l, req.B) == nil {
			fail(w, 400, "соединение требует два разных существующих узла")
			return
		}
		next, err := validate(req, "")
		if err != nil {
			fail(w, 409, err.Error())
			return
		}
		next.ID = newID()
		next, err = visual(next, req)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		if err = s.engine.ConnectCable(*l, next); err != nil {
			fail(w, 500, err.Error())
			return
		}
		l.Links = append(l.Links, next)
		if err = s.store.save(); err != nil {
			l.Links = l.Links[:len(l.Links)-1]
			_ = s.engine.DisconnectCable(*l, next)
			fail(w, 500, err.Error())
			return
		}
		next.Status = s.engine.CableStatus(*l, next)
		respond(w, 201, next)
		return
	}
	if len(p) == 4 && validID(p[3]) {
		index := -1
		for i, ln := range l.Links {
			if ln.ID == p[3] {
				index = i
				break
			}
		}
		if index < 0 {
			fail(w, 404, "кабель не найден")
			return
		}
		old := l.Links[index]
		if r.Method == "DELETE" {
			if err := s.engine.DisconnectCable(*l, old); err != nil {
				fail(w, 500, err.Error())
				return
			}
			l.Links = append(l.Links[:index], l.Links[index+1:]...)
			if err := s.store.save(); err != nil {
				l.Links = append(l.Links, Link{})
				copy(l.Links[index+1:], l.Links[index:])
				l.Links[index] = old
				_ = s.engine.ConnectCable(*l, old)
				fail(w, 500, err.Error())
				return
			}
			respond(w, 200, map[string]bool{"deleted": true})
			return
		}
		if r.Method == "PATCH" {
			var req request
			if !decode(w, r, &req) {
				return
			}
			if req.A == "" {
				req.A = old.A
			}
			if req.B == "" {
				req.B = old.B
			}
			if req.APort == nil {
				p := old.APort
				req.APort = &p
			}
			if req.BPort == nil {
				p := old.BPort
				req.BPort = &p
			}
			next, err := validate(req, old.ID)
			if err != nil {
				fail(w, 409, err.Error())
				return
			}
			// Preserve custom appearance when a cable is moved to other ports.
			next.Color, next.LineWidth, next.LineStyle = old.Color, old.LineWidth, old.LineStyle
			next, err = visual(next, req)
			if err != nil {
				fail(w, 400, err.Error())
				return
			}
			if next.A == old.A && next.B == old.B && next.APort == old.APort && next.BPort == old.BPort {
				// Appearance-only updates must not interrupt a live OVS/QMP link.
				l.Links[index] = next
				if err := s.store.save(); err != nil {
					l.Links[index] = old
					fail(w, 500, err.Error())
					return
				}
				next.Status = s.engine.CableStatus(*l, old)
				respond(w, 200, next)
				return
			}
			if err = s.engine.DisconnectCable(*l, old); err != nil {
				fail(w, 500, err.Error())
				return
			}
			if err = s.engine.ConnectCable(*l, next); err != nil {
				_ = s.engine.ConnectCable(*l, old)
				fail(w, 500, "переподключение не выполнено: "+err.Error())
				return
			}
			l.Links[index] = next
			if err = s.store.save(); err != nil {
				l.Links[index] = old
				_ = s.engine.DisconnectCable(*l, next)
				_ = s.engine.ConnectCable(*l, old)
				fail(w, 500, err.Error())
				return
			}
			next.Status = s.engine.CableStatus(*l, next)
			respond(w, 200, next)
			return
		}
	}
	fail(w, 404, "неизвестная операция с кабелем")
}

// Annotations are purely visual and may be edited while network nodes run.
func (s *Server) annotationsAPI(w http.ResponseWriter, r *http.Request, p []string, l *Lab) {
	if len(p) == 3 && r.Method == http.MethodPost {
		var item Annotation
		if !decode(w, r, &item) {
			return
		}
		item.ID = newID()
		if err := validateAnnotation(item); err != nil {
			fail(w, 400, err.Error())
			return
		}
		l.Annotations = append(l.Annotations, item)
		if err := s.store.save(); err != nil {
			fail(w, 500, err.Error())
			return
		}
		respond(w, 201, item)
		return
	}
	if len(p) != 4 || !validID(p[3]) {
		fail(w, 404, "аннотация не найдена")
		return
	}
	for i := range l.Annotations {
		if l.Annotations[i].ID != p[3] {
			continue
		}
		switch r.Method {
		case http.MethodDelete:
			l.Annotations = append(l.Annotations[:i], l.Annotations[i+1:]...)
			if err := s.store.save(); err != nil {
				fail(w, 500, err.Error())
				return
			}
			respond(w, 200, map[string]bool{"deleted": true})
			return
		case http.MethodPatch:
			var next Annotation
			if !decode(w, r, &next) {
				return
			}
			next.ID = p[3]
			if err := validateAnnotation(next); err != nil {
				fail(w, 400, err.Error())
				return
			}
			l.Annotations[i] = next
			if err := s.store.save(); err != nil {
				fail(w, 500, err.Error())
				return
			}
			respond(w, 200, next)
			return
		default:
			fail(w, 405, "method not allowed")
			return
		}
	}
	fail(w, 404, "аннотация не найдена")
}
