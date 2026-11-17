package netlab

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
)

type Store struct {
	mu    sync.Mutex
	path  string
	State State
}

func LoadStore(path string) (*Store, error) {
	s := &Store{path: path, State: State{Labs: []Lab{}, Images: []Image{}, Media: []InstallMedia{}, Catalog: []PreparedTemplate{}}}
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	if err = json.Unmarshal(b, &s.State); err != nil {
		return nil, err
	}
	if s.State.Labs == nil {
		s.State.Labs = []Lab{}
	}
	if s.State.Images == nil {s.State.Images = []Image{}}
	if s.State.Media == nil {s.State.Media = []InstallMedia{}}
	if s.State.Catalog == nil {s.State.Catalog = []PreparedTemplate{}}
	for li := range s.State.Labs {
		for ni := range s.State.Labs[li].Nodes {
			s.State.Labs[li].Nodes[ni].Status = "stopped"
			s.State.Labs[li].Nodes[ni].Error = ""
		}
	}
	return s, nil
}
func (s *Store) save() error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0750); err != nil {
		return err
	}
	b, err := json.MarshalIndent(s.State, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(s.path), ".state-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	defer tmp.Close()
	if err = tmp.Chmod(0600); err != nil {
		return err
	}
	if _, err = tmp.Write(b); err != nil {
		return err
	}
	if err = tmp.Sync(); err != nil {
		return err
	}
	if err = tmp.Close(); err != nil {
		return err
	}
	if err = os.Rename(tmp.Name(), s.path); err != nil {
		return err
	}
	dir, err := os.Open(filepath.Dir(s.path))
	if err == nil {
		defer dir.Close()
		_ = dir.Sync()
	}
	return nil
}
func (s *Store) snapshot() State {
	b, _ := json.Marshal(s.State)
	var copy State
	_ = json.Unmarshal(b, &copy)
	return copy
}
func (s *Store) findLab(id string) *Lab {
	for i := range s.State.Labs {
		if s.State.Labs[i].ID == id {
			return &s.State.Labs[i]
		}
	}
	return nil
}
