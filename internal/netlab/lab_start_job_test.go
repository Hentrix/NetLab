package netlab

import (
 "encoding/json"
 "net/http/httptest"
 "testing"
 "time"
)

func TestStartJobProgressReadableWhileStoreLocked(t *testing.T){
 s:=newTestServer(t)
 id:=newID()
 node:=newID()
 s.jobsMu.Lock()
 s.startJobs[id]=&LabStartJob{ID:newID(),LabID:id,Status:"running",StartedAt:time.Now(),Nodes:[]LabStartNode{{ID:node,Name:"Router",Status:"starting"}}}
 s.jobsMu.Unlock()
 s.store.mu.Lock()
 result:=make(chan int,1)
 go func(){
  request:=httptest.NewRequest("GET","/api/labs/"+id+"/start-job",nil)
  request.Header.Set("Authorization","Bearer "+testToken)
  response:=httptest.NewRecorder()
  s.Handler().ServeHTTP(response,request)
  result<-response.Code
 }()
 select {
 case code:=<-result:
  if code!=200{t.Fatalf("progress HTTP %d",code)}
 case <-time.After(time.Second):
  t.Fatal("progress endpoint blocked on Store.mu during guest startup")
 }
 s.store.mu.Unlock()
}

func TestStartJobDuplicateReturnsConflict(t *testing.T){
 s:=newTestServer(t)
 id:=newID()
 s.jobsMu.Lock()
 s.startJobs[id]=&LabStartJob{ID:newID(),LabID:id,Status:"running",Nodes:[]LabStartNode{}}
 s.jobsMu.Unlock()
 status,body:=httpCall(t,s,"POST","/api/labs/"+id+"/start-job",nil,true)
 if status!=409{t.Fatalf("duplicate launch allowed: %d %s",status,body)}
}

func TestStartJobEmptyLabAndStatus(t *testing.T){
 s:=newTestServer(t)
 lab:=Lab{ID:newID(),Name:"Empty",Nodes:[]Node{},Links:[]Link{}}
 s.store.mu.Lock()
 s.store.State.Labs=append(s.store.State.Labs,lab)
 s.store.mu.Unlock()
 status,body:=httpCall(t,s,"POST","/api/labs/"+lab.ID+"/start-job",nil,true)
 if status!=202{t.Fatalf("async launch not accepted: %d %s",status,body)}
 var job LabStartJob
 if err:=json.Unmarshal(body,&job);err!=nil{t.Fatal(err)}
 if job.ID==""||job.LabID!=lab.ID{t.Fatalf("invalid initial progress: %+v",job)}
 for i:=0;i<100;i++{
  status,body=httpCall(t,s,"GET","/api/labs/"+lab.ID+"/start-job",nil,true)
  if status!=200{t.Fatalf("job not readable: %d %s",status,body)}
  if err:=json.Unmarshal(body,&job);err!=nil{t.Fatal(err)}
  if job.Status=="completed"{
   if job.FinishedAt==nil{t.Fatal("completion timestamp missing")}
   return
  }
  time.Sleep(5*time.Millisecond)
 }
 t.Fatalf("job never finished: %+v",job)
}

func TestStartJobSnapshotDoesNotAliasMutableNodes(t *testing.T){
 s:=newTestServer(t)
 id:=newID()
 s.jobsMu.Lock()
 s.startJobs[id]=&LabStartJob{ID:newID(),LabID:id,Status:"running",Nodes:[]LabStartNode{{ID:newID(),Name:"VM",Status:"pending"}}}
 s.jobsMu.Unlock()
 snapshot,ok:=s.startJobSnapshot(id)
 if !ok{t.Fatal("job not found")}
 snapshot.Nodes[0].Status="failed"
 original,_:=s.startJobSnapshot(id)
 if original.Nodes[0].Status!="pending"{t.Fatal("snapshot mutates live job")}
}
