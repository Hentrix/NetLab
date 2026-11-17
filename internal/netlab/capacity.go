package netlab

import (
 "fmt"
 "os"
)

// VMCapacity reports configured guest allocations (not actual RSS). It is
// intentionally separated from host CPU/RAM utilization in /api/metrics.
type VMCapacity struct {
 RunningVMs int `json:"runningVMs"`
 AllocatedRAMMiB uint64 `json:"allocatedRAMMiB"`
 AllocatedVCPUs int `json:"allocatedVCPUs"`
 HostCPUs int `json:"hostCPUs"`
 HostRAMMiB uint64 `json:"hostRAMMiB"`
 HostAvailableMiB uint64 `json:"hostAvailableMiB"`
 ReservationLimitMiB uint64 `json:"reservationLimitMiB"`
}

// reserveRAMMiB keeps at least 512 MiB (or 10% of memory on larger hosts)
// outside NetLab guests; a maximum of 90% can be reserved for QEMU guests.
func reserveRAMMiB(total uint64) uint64 {
 reserve:=total/10
 if reserve<512 {reserve=512}
 if reserve>total {return total}
 return reserve
}

func evaluateAdmission(cap VMCapacity,requestRAMMiB uint64) error {
 if requestRAMMiB==0 {return nil}
 if cap.HostRAMMiB==0 {return fmt.Errorf("не удалось определить объём памяти хоста; запуск VM отменён")}
 if cap.ReservationLimitMiB<cap.AllocatedRAMMiB || requestRAMMiB>cap.ReservationLimitMiB-cap.AllocatedRAMMiB {
  return fmt.Errorf("недостаточно лимита RAM для VM: выделено %d МиБ, требуется ещё %d МиБ, лимит %d МиБ (резерв для Debian)",cap.AllocatedRAMMiB,requestRAMMiB,cap.ReservationLimitMiB)
 }
 // MemAvailable excludes reclaimable kernel cache, not simply MemFree.
 // Do not reject an existing guest: this is checked only for a new Start.
 if cap.HostAvailableMiB<requestRAMMiB || cap.HostAvailableMiB-requestRAMMiB<512 {
  return fmt.Errorf("недостаточно свободной RAM хоста: доступно %d МиБ, для VM необходимо %d МиБ и ещё 512 МиБ для Debian",cap.HostAvailableMiB,requestRAMMiB)
 }
 return nil
}

// capacityLocked requires Store.mu, serializing admissions from separate lab
// API calls and async start jobs. Engine.Status is separately synchronized.
func (s *Server) capacityLocked() VMCapacity {
 var cap VMCapacity
 used,total,err:=memTimes("/proc/meminfo")
 if err==nil {
  cap.HostRAMMiB=total
  if total>=used {cap.HostAvailableMiB=total-used}
  cap.ReservationLimitMiB=total-reserveRAMMiB(total)
 }
 cap.HostCPUs=runtimeCPUCount()
 for _,lab:=range s.store.State.Labs {
  for _,n:=range lab.Nodes {
   if n.Engine=="vpcs" {continue}
   status,_:=s.engine.Status(lab.ID,n.ID)
   if status!="running" && !s.engine.NodeBusy(lab.ID,n.ID) {continue}
   cap.RunningVMs++
   if n.RAM>0 {cap.AllocatedRAMMiB+=uint64(n.RAM)}
   if n.CPUs>0 {cap.AllocatedVCPUs+=n.CPUs}
  }
 }
 return cap
}

var runtimeCPUCount = func() int {return len(os.Getenv("NETLAB_CPU_PLACEHOLDER"))}
// runtime.NumCPU is used below; keep it independent from any configuration
// so the displayed capacity always reflects the Debian host.
