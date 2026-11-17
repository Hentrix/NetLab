package netlab

import (
 "encoding/json"
 "errors"
 "strings"
 "testing"
)

func TestNodeStartFailureRemainsVisibleAfterAPIError(t *testing.T){
 s:=newTestServer(t)
 lab:=Lab{ID:newID(),Name:"Unhealthy lab",Nodes:[]Node{{
  ID:newID(),Name:"Failed router",Engine:"qemu",ImageID:newID(),
 }}}
 s.store.mu.Lock()
 s.store.State.Labs=append(s.store.State.Labs,lab)
 s.store.mu.Unlock()
 err:=s.startNode(lab,lab.Nodes[0])
 if err==nil||!strings.Contains(err.Error(),"образ"){t.Fatalf("missing base did not fail: %v",err)}
 code,body:=httpCall(t,s,"GET","/api/labs/"+lab.ID,nil,true)
 assertStatus(t,code,200,body)
 var state Lab
 if err:=json.Unmarshal(body,&state);err!=nil{t.Fatal(err)}
 if len(state.Nodes)!=1||state.Nodes[0].Error==""||!strings.Contains(state.Nodes[0].Error,"образ"){
  t.Fatalf("error not attached to device: %s",body)
 }
 if state.Nodes[0].Status=="running"{t.Fatalf("failed guest marked running: %s",body)}
}

func TestNodeStartFailureClearsAfterSuccessfulStart(t *testing.T){
 e:=NewEngine(t.TempDir())
 lab,node:=newID(),newID()
 e.SetStartFailure(lab,node,errors.New("QEMU startup failed"))
 status,message:=e.Status(lab,node)
 if status!="stopped"||message!="QEMU startup failed"{t.Fatalf("failure lost: %q %q",status,message)}
 e.SetStartFailure(lab,node,nil)
 _,message=e.Status(lab,node)
 if message!=""{t.Fatalf("old error persisted after successful retry: %s",message)}
}

func TestNodeRunningStateDoesNotShowStaleFailure(t *testing.T){
 e:=NewEngine(t.TempDir())
 lab,node:=newID(),newID()
 e.SetStartFailure(lab,node,errors.New("older failure"))
 e.instances[key(lab,node)]=&Instance{status:"running"}
 status,message:=e.Status(lab,node)
 if status!="running"||message!=""{t.Fatalf("running device has stale failure: %q %q",status,message)}
}
