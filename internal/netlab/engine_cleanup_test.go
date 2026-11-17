package netlab

import (
 "strings"
 "testing"
 "time"
)

func TestNodeBusyUntilTAPCleanupCompletes(t *testing.T) {
 e:=NewEngine(t.TempDir())
 lab,node:=newID(),newID()
 done:=make(chan struct{})
 e.instances[key(lab,node)]=&Instance{status:"stopped",done:done}
 if !e.NodeBusy(lab,node) {t.Fatal("cleanup in progress must block topology edits")}
 close(done)
 if e.NodeBusy(lab,node) {t.Fatal("completed cleanup still reported busy")}
 if e.NodeBusy(lab,newID()) {t.Fatal("absent instance reported busy")}
}

func TestStopWaitsForAlreadyExitedGuestCleanup(t *testing.T) {
 e:=NewEngine(t.TempDir())
 lab,node:=newID(),newID()
 done:=make(chan struct{})
 e.instances[key(lab,node)]=&Instance{status:"stopped",done:done}
 result:=make(chan error,1)
 go func(){result<-e.Stop(lab,node)}()
 select {
 case err:=<-result: t.Fatalf("stop returned before TAP cleanup: %v",err)
 case <-time.After(30*time.Millisecond):
 }
 close(done)
 select {
 case err:=<-result:
  if err!=nil {t.Fatal(err)}
 case <-time.After(time.Second): t.Fatal("stop blocked after TAP cleanup")
 }
}

func TestCleanupCheckedDoesNotRemoveBridgeWhenVMStopFails(t *testing.T) {
 e:=NewEngine(t.TempDir())
 lab,node:=newID(),newID()
 n:=Node{ID:node,Name:"Windows VM"}
 link:=Link{ID:newID()}
 l:=Lab{ID:lab,Nodes:[]Node{n},Links:[]Link{link}}
 e.instances[key(lab,node)]=&Instance{status:"running",done:make(chan struct{}),engine:"qemu"}
 var calls []string
 e.execOp=func(command string,args ...string)error{
  calls=append(calls,command+" "+strings.Join(args," "))
  return nil
 }
 err:=e.CleanupChecked(l)
 if err==nil||!strings.Contains(err.Error(),"Windows VM"){t.Fatalf("stop failure lost: %v",err)}
 if len(calls)>0 {t.Fatalf("bridge removed after failed stop: %v",calls)}
}
