package netlab

import (
 "strings"
 "testing"
)

func TestRAMAdmissionRespectsHostReserve(t *testing.T) {
 total:=uint64(8192)
 cap:=VMCapacity{HostRAMMiB:total,HostAvailableMiB:6000,AllocatedRAMMiB:4096,ReservationLimitMiB:total-reserveRAMMiB(total)}
 if err:=evaluateAdmission(cap,2048);err!=nil{t.Fatalf("valid reservation rejected: %v",err)}
 if err:=evaluateAdmission(cap,4096);err==nil||!strings.Contains(err.Error(),"лимита RAM"){t.Fatalf("overcommit accepted: %v",err)}
}
func TestRAMAdmissionChecksRealAvailableRAM(t *testing.T){
 cap:=VMCapacity{HostRAMMiB:16384,HostAvailableMiB:1400,ReservationLimitMiB:14000}
 if err:=evaluateAdmission(cap,1024);err==nil||!strings.Contains(err.Error(),"свободной RAM"){t.Fatalf("low available RAM accepted: %v",err)}
 cap.HostAvailableMiB=1536
 if err:=evaluateAdmission(cap,1024);err!=nil{t.Fatalf("512 MiB host reserve rejected: %v",err)}
}
func TestRAMAdmissionRejectsUnknownMemoryAndTinyHosts(t *testing.T){
 if err:=evaluateAdmission(VMCapacity{},512);err==nil{t.Fatal("unknown host RAM accepted")}
 if reserveRAMMiB(256)!=256{t.Fatal("tiny host reserve must cover host")}
 if reserveRAMMiB(8192)!=819{t.Fatal("10% reservation broken")}
 if reserveRAMMiB(2048)!=512{t.Fatal("512 MiB minimum reserve broken")}
}
func TestCapacityCountsOnlyRunningOrCleaningQemu(t *testing.T){
 s:=newTestServer(t)
 l1:=Lab{ID:newID(),Nodes:[]Node{
  {ID:newID(),Name:"Server",Engine:"qemu",RAM:2048,CPUs:2},
  {ID:newID(),Name:"VPCS",Engine:"vpcs",RAM:512,CPUs:1},
 }}
 l2:=Lab{ID:newID(),Nodes:[]Node{
  {ID:newID(),Name:"Desktop",Engine:"qemu",RAM:1024,CPUs:1},
  {ID:newID(),Name:"Stopped",Engine:"qemu",RAM:8192,CPUs:8},
 }}
 s.store.mu.Lock()
 s.store.State.Labs=append(s.store.State.Labs,l1,l2)
 s.engine.instances[key(l1.ID,l1.Nodes[0].ID)]=&Instance{status:"running"}
 s.engine.instances[key(l1.ID,l1.Nodes[1].ID)]=&Instance{status:"running"}
 s.engine.instances[key(l2.ID,l2.Nodes[0].ID)]=&Instance{status:"stopped",done:make(chan struct{})}
 cap:=s.capacityLocked()
 s.store.mu.Unlock()
 if cap.RunningVMs!=2||cap.AllocatedRAMMiB!=3072||cap.AllocatedVCPUs!=3{
  t.Fatalf("incorrect capacity count: %+v",cap)
 }
 if cap.HostCPUs<1{t.Fatalf("invalid host CPUs: %+v",cap)}
}
