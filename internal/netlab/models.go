package netlab

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

// PortSpec is presentation metadata: the port index is the actual QEMU NIC.
// Name and nominal speed do not change the guest driver or link negotiation.
type PortSpec struct {
	Name      string `json:"name,omitempty"`
	SpeedMbps int    `json:"speedMbps,omitempty"`
}

type Annotation struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"`
	Text        string `json:"text"`
	X           int    `json:"x"`
	Y           int    `json:"y"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
	Color       string `json:"color,omitempty"`
	Background  string `json:"background,omitempty"`
	BorderColor string `json:"borderColor,omitempty"`
	BorderWidth int    `json:"borderWidth,omitempty"`
	FontSize    int    `json:"fontSize,omitempty"`
	Bold        bool   `json:"bold,omitempty"`
	Italic      bool   `json:"italic,omitempty"`
	Underline   bool   `json:"underline,omitempty"`
	Align       string `json:"align,omitempty"`
}

func validateAnnotation(a Annotation) error {
	if a.Kind != "text" && a.Kind != "note" {
		return errors.New("неподдерживаемый тип аннотации")
	}
	if utf8.RuneCountInString(a.Text) > 1000 {
		return errors.New("текст аннотации слишком длинный")
	}
	if a.X < 0 || a.X > 10000 || a.Y < 0 || a.Y > 10000 {
		return errors.New("координаты аннотации вне диапазона")
	}
	if a.Width < 80 || a.Width > 1200 || a.Height < 36 || a.Height > 800 {
		return errors.New("размер аннотации вне диапазона")
	}
	// Style values are strictly validated before being used by the browser.
	for _, color := range []string{a.Color, a.Background, a.BorderColor} {
		if color != "" && color != "transparent" && !safeHexColor.MatchString(color) {
			return errors.New("цвет должен быть в формате #RRGGBB")
		}
	}
	if a.BorderWidth < 0 || a.BorderWidth > 4 {
		return errors.New("толщина рамки должна быть 0–4 px")
	}
	if a.FontSize != 0 && (a.FontSize < 9 || a.FontSize > 72) {
		return errors.New("размер шрифта должен быть 9–72 px")
	}
	if a.Align != "" && a.Align != "left" && a.Align != "center" && a.Align != "right" {
		return errors.New("недопустимое выравнивание текста")
	}
	return nil
}

var safeHexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

type Node struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	ImageID   string     `json:"imageId"`
	RAM       int        `json:"ram"`
	CPUs      int        `json:"cpus"`
	NICModel  string     `json:"nicModel"`
	NICCount  int        `json:"nicCount,omitempty"` // 0 for v0.3 migrated nodes = 16
	DiskBus   string     `json:"diskBus"`
	Kind      string     `json:"kind,omitempty"`
	PortStyle string     `json:"portStyle,omitempty"`
	Ports     []PortSpec `json:"ports,omitempty"`
	Icon      string     `json:"icon,omitempty"`
	X         int        `json:"x"`
	Y         int        `json:"y"`
	Status    string     `json:"status"`
	Error     string     `json:"error,omitempty"`
}

type Link struct {
	ID     string `json:"id"`
	A      string `json:"a"`
	B      string `json:"b"`
	APort  int    `json:"aPort"`
	BPort  int    `json:"bPort"`
	Status string `json:"status,omitempty"` // runtime status, never persisted intentionally
}

type Lab struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	CreatedAt   time.Time    `json:"createdAt"`
	Nodes       []Node       `json:"nodes"`
	Links       []Link       `json:"links"`
	Annotations []Annotation `json:"annotations,omitempty"`
}

type Image struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Format    string    `json:"format"`
	Size      int64     `json:"size"`
	CreatedAt time.Time `json:"createdAt"`
}

type State struct {
	Labs   []Lab   `json:"labs"`
	Images []Image `json:"images"`
}

func newID() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}
func bridgeName(id string) string            { return "nlb" + id[:12] }
func tapName(nodeID string, port int) string { return fmt.Sprintf("nlt%s%x", nodeID[:9], port) }
func validName(s string) error {
	if n := len(strings.TrimSpace(s)); n < 1 || n > 80 {
		return errors.New("имя должно содержать 1–80 символов")
	}
	return nil
}
func validateNode(n Node) error {
	if err := validName(n.Name); err != nil {
		return err
	}
	if n.RAM < 128 || n.RAM > 131072 {
		return errors.New("RAM вне диапазона 128–131072 МиБ")
	}
	if n.CPUs < 1 || n.CPUs > 64 {
		return errors.New("число vCPU должно быть 1–64")
	}
	if n.Kind != "" && n.Kind != "router" && n.Kind != "switch" && n.Kind != "firewall" && n.Kind != "server" && n.Kind != "pc" {
		return errors.New("неподдерживаемый тип значка устройства")
	}
	if n.PortStyle != "" && n.PortStyle != "auto" && n.PortStyle != "ether" && n.PortStyle != "gi" && n.PortStyle != "e" && n.PortStyle != "fa" && n.PortStyle != "ge" && n.PortStyle != "jge" && n.PortStyle != "eth" && n.PortStyle != "ens" {
		return errors.New("неподдерживаемый стиль обозначения портов")
	}
	if len(n.Ports) > 0 {
		if len(n.Ports) > portCapacity(&n) {
			return errors.New("настроено больше портов, чем NIC")
		}
		seen := make(map[string]bool)
		for _, port := range n.Ports {
			if utf8.RuneCountInString(port.Name) > 32 || strings.ContainsAny(port.Name, "\r\n\t<>\\") {
				return errors.New("недопустимое обозначение интерфейса")
			}
			if port.Name != "" {
				if seen[port.Name] {
					return errors.New("обозначения интерфейсов должны быть уникальными")
				}
				seen[port.Name] = true
			}
			switch port.SpeedMbps {
			case 0, 10, 100, 1000, 10000, 25000, 40000, 100000:
			default:
				return errors.New("неподдерживаемая скорость интерфейса")
			}
		}
	}
	if n.Icon != "" && !safeIcon.MatchString(n.Icon) {
		return errors.New("недопустимое имя PNG-иконки")
	}
	if n.ImageID == "" {
		return errors.New("выберите образ")
	}
	if n.NICCount < 0 || n.NICCount > 16 {
		return errors.New("число Ethernet-портов должно быть 1–16")
	}
	if n.NICModel != "virtio-net-pci" && n.NICModel != "e1000" && n.NICModel != "rtl8139" {
		return errors.New("неподдерживаемая модель сетевой карты")
	}
	if n.DiskBus != "virtio" && n.DiskBus != "ide" && n.DiskBus != "scsi" {
		return errors.New("неподдерживаемая дисковая шина")
	}
	return nil
}

// Icon is a filename from the bundled image catalogue, never an absolute path.
// Whitelist also forbids traversal, slashes and URL query strings.
var safeIcon = regexp.MustCompile(`^[\p{L}\p{N}][\p{L}\p{N} _()+.,-]{0,140}\.png$`)

var safeID = regexp.MustCompile(`^[a-f0-9]{16}$`)

func validID(v string) bool { return safeID.MatchString(v) }

// Legacy nodes created before v0.4 had 16 candidate ports; preserve them.
func portCapacity(n *Node) int {
	if n == nil {
		return 0
	}
	if n.NICCount == 0 {
		return 16
	}
	return n.NICCount
}
func nextPort(l Lab, nodeID string) (int, error) {
	used := map[int]bool{}
	for _, e := range l.Links {
		if e.A == nodeID {
			used[e.APort] = true
		}
		if e.B == nodeID {
			used[e.BPort] = true
		}
	}
	for i := 0; i < portCapacity(findNode(&l, nodeID)); i++ {
		if !used[i] {
			return i, nil
		}
	}
	return 0, errors.New("на узле нет свободных Ethernet-интерфейсов")
}
func findNode(l *Lab, id string) *Node {
	for i := range l.Nodes {
		if l.Nodes[i].ID == id {
			return &l.Nodes[i]
		}
	}
	return nil
}
func findImage(s *State, id string) *Image {
	for i := range s.Images {
		if s.Images[i].ID == id {
			return &s.Images[i]
		}
	}
	return nil
}

// portIsFree checks port occupancy for explicit port assignments in a lab link.
func portIsFree(l Lab, nodeID string, port int) bool {
	if port < 0 || port >= portCapacity(findNode(&l, nodeID)) {
		return false
	}
	for _, link := range l.Links {
		if (link.A == nodeID && link.APort == port) || (link.B == nodeID && link.BPort == port) {
			return false
		}
	}
	return true
}
