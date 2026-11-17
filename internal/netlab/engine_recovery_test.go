package netlab

import (
 "errors"
 "net"
 "os"
 "path/filepath"
 "strings"
 "testing"
)

// Recovery is deliberately network-only; the old guest disk is never deleted.
func recoveryFixture(t *testing.T) (*Engine,Lab,string) {
 t.Helper()
 root:=t.TempDir()
 e:=NewEngine(root)
 lab:=Lab{ID:newID(),Name:"Recovery test"}
 node:=Node{ID:newID(),Name:"Debian guest",Engine:"qemu",NICCount:2}
 lab.Nodes=[]Node{node}
 lab.Links=[]Link{{ID:newID(),A:node.ID,B:node.ID}}
 runtime:=filepath.Join(root,"runtime",lab.ID,node.ID)
 if err:=os.MkdirAll(runtime,0750);err!=nil{t.Fatal(err)}
 disk:=filepath.Join(runtime,"disk.qcow2")
 if err:=os.WriteFile(disk,[]byte("guest changes after installation"),0600);err!=nil{t.Fatal(err)}
 return e,lab,disk
}

func TestRecoverSkipsLiveGuestAndKeepsDisk(t *testing.T){
 e,lab,disk:=recoveryFixture(t)
 socket:=filepath.Join(e.data,"runtime",lab.ID,lab.Nodes[0].ID,"monitor.sock")
 ln,err:=net.Listen("unix",socket)
 if err!=nil{t.Fatal(err)}
 defer ln.Close()
 var calls []string
 e.execOp=func(bin string,args ...string)error{
  calls=append(calls,bin+" "+strings.Join(args," "))
  return nil
 }
 err=e.RecoverChecked([]Lab{lab})
 if err==nil||!strings.Contains(err.Error(),"QMP"){t.Fatalf("live QEMU not detected: %v",err)}
 if len(calls)!=0{t.Fatalf("network modified while guest QMP is live: %v",calls)}
 contents,err:=os.ReadFile(disk)
 if err!=nil||string(contents)!="guest changes after installation"{t.Fatalf("disk damaged: %q %v",contents,err)}
}

func TestRecoverCleansStaleNetworkWithoutTouchingDisk(t *testing.T){
 e,lab,disk:=recoveryFixture(t)
 var calls []string
 e.execOp=func(bin string,args ...string)error{
  calls=append(calls,bin+" "+strings.Join(args," "))
  return nil
 }
 if err:=e.RecoverChecked([]Lab{lab});err!=nil{t.Fatal(err)}
 joined:=strings.Join(calls,"\n")
 if !strings.Contains(joined,"ovs-vsctl --if-exists del-br "+bridgeName(lab.Links[0].ID)){
  t.Fatalf("stale bridge not removed: %v",calls)
 }
 for port:=0;port<2;port++ {
  if !strings.Contains(joined,"ip link del "+tapName(lab.Nodes[0].ID,port)){
   t.Fatalf("stale TAP %d not removed: %v",port,calls)
  }
 }
 contents,err:=os.ReadFile(disk)
 if err!=nil||string(contents)!="guest changes after installation"{t.Fatalf("guest overlay damaged: %q %v",contents,err)}
}

func TestRecoverReturnsOVSFailureAndKeepsGuestDisk(t *testing.T){
 e,lab,disk:=recoveryFixture(t)
 var tapDeletes int
 e.execOp=func(bin string,args ...string)error{
  if bin=="ovs-vsctl"{return errors.New("OVS unavailable")}
  if bin=="ip"{tapDeletes++}
  return nil
 }
 err:=e.RecoverChecked([]Lab{lab})
 if err==nil||!strings.Contains(err.Error(),"OVS unavailable"){t.Fatalf("cleanup error hidden: %v",err)}
 if tapDeletes!=0{t.Fatalf("TAP interfaces deleted after OVS failure: %d",tapDeletes)}
 if _,err:=os.Stat(disk);err!=nil{t.Fatalf("guest disk removed: %v",err)}
}
