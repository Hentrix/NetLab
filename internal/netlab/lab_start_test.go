package netlab

import (
 "errors"
 "strings"
 "testing"
)

func TestLabStartRollsBackOnlyNewProcesses(t *testing.T){
 nodes:=[]Node{
  {ID:newID(),Name:"Already running"},
  {ID:newID(),Name:"Router A"},
  {ID:newID(),Name:"Router B"},
  {ID:newID(),Name:"Router C"},
 }
 lab:=Lab{ID:newID(),Nodes:nodes}
 var started,stopped []string
 inspect:=func(n Node)(bool,error){return n.ID==nodes[0].ID,nil}
 start:=func(n Node)error{
  started=append(started,n.Name)
  if n.ID==nodes[2].ID{return errors.New("QEMU failed")}
  return nil
 }
 stop:=func(n Node)error{stopped=append(stopped,n.Name);return nil}
 err:=startLabTransaction(lab,inspect,start,stop)
 if err==nil||!strings.Contains(err.Error(),"Router B"){t.Fatalf("failure not propagated: %v",err)}
 if strings.Join(started,",")!="Router A,Router B"{t.Fatalf("unexpected starts: %v",started)}
 if strings.Join(stopped,",")!="Router B,Router A"{t.Fatalf("incorrect rollback: %v",stopped)}
}

func TestLabStartChecksAllNodesBeforeLaunching(t *testing.T){
 nodes:=[]Node{{ID:newID(),Name:"Good"},{ID:newID(),Name:"Still cleaning"}}
 lab:=Lab{ID:newID(),Nodes:nodes}
 calls:=0
 err:=startLabTransaction(lab,func(n Node)(bool,error){
  if n.ID==nodes[1].ID{return false,errors.New("cleanup pending")}
  return false,nil
 },func(n Node)error{calls++;return nil},func(n Node)error{return nil})
 if err==nil||!strings.Contains(err.Error(),"cleanup pending"){t.Fatalf("expected preflight error: %v",err)}
 if calls!=0{t.Fatalf("started %d guests before preflight completed",calls)}
}

func TestLabStartRollbackReportsCleanupErrors(t *testing.T){
 nodes:=[]Node{{ID:newID(),Name:"A"},{ID:newID(),Name:"B"}}
 err:=startLabTransaction(Lab{Nodes:nodes},func(Node)(bool,error){return false,nil},func(n Node)error{
  if n.Name=="B"{return errors.New("cannot spawn")}
  return nil
 },func(n Node)error{
  if n.Name=="A"{return errors.New("cannot stop")}
  return nil
 })
 if err==nil||!strings.Contains(err.Error(),"cannot spawn")||!strings.Contains(err.Error(),"откат не завершён")||!strings.Contains(err.Error(),"cannot stop"){
  t.Fatalf("cleanup diagnostic lost: %v",err)
 }
}

func TestLabStartAllSuccessAndAlreadyRunning(t *testing.T){
 nodes:=[]Node{{ID:newID(),Name:"Live"},{ID:newID(),Name:"New"}}
 var started,stopped int
 err:=startLabTransaction(Lab{Nodes:nodes},func(n Node)(bool,error){return n.Name=="Live",nil},func(Node)error{started++;return nil},func(Node)error{stopped++;return nil})
 if err!=nil||started!=1||stopped!=0{t.Fatalf("start=%d stop=%d err=%v",started,stopped,err)}
}

func TestLabPrevalidationRejectsMissingDiskAndISO(t *testing.T){
 s:=newTestServer(t)
 img:=Image{ID:newID(),Name:"Bootable",Format:"qcow2"}
 iso:=Image{ID:newID(),Name:"Installer",Format:"iso",Kind:"iso"}
 s.store.mu.Lock()
 s.store.State.Images=append(s.store.State.Images,img,iso)
 s.store.mu.Unlock()
 nodes:=[]Node{{ID:newID(),Name:"A",Engine:"qemu",ImageID:img.ID},{ID:newID(),Name:"B",Engine:"qemu",ImageID:newID()}}
 lab:=Lab{ID:newID(),Nodes:nodes}
 if err:=s.validateLabStart(lab);err==nil||!strings.Contains(err.Error(),"B:"){t.Fatalf("missing disk accepted: %v",err)}
 lab.Nodes[1].ImageID=img.ID
 lab.Nodes[1].InstallISOID=newID()
 if err:=s.validateLabStart(lab);err==nil||!strings.Contains(err.Error(),"ISO"){t.Fatalf("missing ISO accepted: %v",err)}
 lab.Nodes[1].InstallISOID=iso.ID
 if err:=s.validateLabStart(lab);err!=nil{t.Fatalf("valid topology rejected: %v",err)}
}
