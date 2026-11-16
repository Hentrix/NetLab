package netlab

import (
	"errors"
	"fmt"
	"strings"
)

// buildNodeBatch assigns unique, human-readable names and separate canvas
// positions while leaving the supplied template untouched.
func buildNodeBatch(existing []Node, template Node, count int) ([]Node, error) {
	if count < 1 || count > 32 {
		return nil, errors.New("количество устройств должно быть от 1 до 32")
	}
	result := make([]Node, 0, count)
	used := make(map[string]bool, len(existing)+count)
	for _, n := range existing {
		used[strings.ToLower(strings.TrimSpace(n.Name))] = true
	}
	base := strings.TrimSpace(template.Name)
	if base == "" {
		return nil, errors.New("задайте имя устройства")
	}
	suffix := 1
	for i := 0; i < count; i++ {
		n := template
		n.ID = newID()
		n.Status = "stopped"
		n.Error = ""
		if count > 1 {
			// Suffix is stable in the order of creation; avoid existing names.
			for {
				candidate := fmt.Sprintf("%s %d", base, suffix)
				suffix++
				if !used[strings.ToLower(candidate)] {
					n.Name = candidate
					break
				}
			}
		}
		n.X = template.X + (i%5)*190
		n.Y = template.Y + (i/5)*155
		if n.X < -10000 || n.X > 10000 || n.Y < -10000 || n.Y > 10000 {
			return nil, errors.New("положение устройств выходит за пределы полотна")
		}
		if err := validateNode(n); err != nil {
			return nil, err
		}
		used[strings.ToLower(n.Name)] = true
		result = append(result, n)
	}
	return result, nil
}
