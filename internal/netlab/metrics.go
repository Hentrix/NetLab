package netlab

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// HostMetrics reports genuine Linux host telemetry; no estimates or hard-coded percentages.
// CPU utilisation is calculated between successive requests (first sample is unavailable).
type HostMetrics struct {
	CPUPercent     *float64   `json:"cpuPercent"`
	MemoryUsedMiB  uint64     `json:"memoryUsedMiB"`
	MemoryTotalMiB uint64     `json:"memoryTotalMiB"`
	SavedAt        *time.Time `json:"savedAt"`
	VMCapacity     VMCapacity `json:"vmCapacity"`
}

type metricSampler struct {
	mu      sync.Mutex
	total   uint64
	idle    uint64
	sampled bool
}

func cpuTimes(path string) (uint64, uint64, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, 0, err
	}
	defer f.Close()
	line := bufio.NewScanner(f)
	if !line.Scan() {
		return 0, 0, fmt.Errorf("missing cpu line")
	}
	cols := strings.Fields(line.Text())
	if len(cols) < 5 || cols[0] != "cpu" {
		return 0, 0, fmt.Errorf("invalid cpu stats")
	}
	var total, idle uint64
	for i, v := range cols[1:] {
		n, e := strconv.ParseUint(v, 10, 64)
		if e != nil {
			return 0, 0, e
		}
		total += n
		if i == 3 || i == 4 {
			idle += n
		}
	}
	return total, idle, nil
}
func memTimes(path string) (used, total uint64, err error) {
	f, e := os.Open(path)
	if e != nil {
		return 0, 0, e
	}
	defer f.Close()
	var memTotal, available uint64
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		parts := strings.Fields(sc.Text())
		if len(parts) < 2 {
			continue
		}
		n, e := strconv.ParseUint(parts[1], 10, 64)
		if e != nil {
			continue
		}
		switch parts[0] {
		case "MemTotal:":
			memTotal = n
		case "MemAvailable:":
			available = n
		}
	}
	if e = sc.Err(); e != nil {
		return 0, 0, e
	}
	if memTotal == 0 {
		return 0, 0, fmt.Errorf("no MemTotal")
	}
	if available > memTotal {
		available = memTotal
	}
	return (memTotal - available) / 1024, memTotal / 1024, nil
}
func (m *metricSampler) sampleCPU() *float64 {
	total, idle, err := cpuTimes("/proc/stat")
	if err != nil {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	var value *float64
	if m.sampled && total > m.total && idle >= m.idle {
		busy := float64(total-m.total-(idle-m.idle)) / float64(total-m.total) * 100
		if busy < 0 {
			busy = 0
		}
		if busy > 100 {
			busy = 100
		}
		value = &busy
	}
	m.total, m.idle, m.sampled = total, idle, true
	return value
}
func (s *Server) metrics() HostMetrics {
	var result HostMetrics
	result.CPUPercent = s.sampler.sampleCPU()
	result.MemoryUsedMiB, result.MemoryTotalMiB, _ = memTimes("/proc/meminfo")
	s.store.mu.Lock()
	result.VMCapacity=s.capacityLocked()
	s.store.mu.Unlock()
	if info, err := os.Stat(s.store.path); err == nil {
		timestamp := info.ModTime()
		result.SavedAt = &timestamp
	}
	return result
}
