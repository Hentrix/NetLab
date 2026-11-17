package netlab

import (
 "errors"
 "fmt"
 "net/http"
 "strings"
 "time"
)

// LabStartJob is a short-lived, in-memory status snapshot. GET requests read
// this independently of Store.mu, which is held while QEMU nodes are started.
type LabStartJob struct {
 ID string `json:"id"`
 LabID string `json:"labId"`
 Status string `json:"status"` // running, completed, failed
 Error string `json:"error,omitempty"`
 Nodes []LabStartNode `json:"nodes"`
 StartedAt time.Time `json:"startedAt"`
 FinishedAt *time.Time `json:"finishedAt,omitempty"`
}
type LabStartNode struct {
 ID string `json:"id"`
 Name string `json:"name"`
 Status string `json:"status"` // pending, starting, running, existing, rolling-back, rolled-back, failed
 Error string `json:"error,omitempty"`
}
func (s *Server) startJobSnapshot(labID string) (LabStartJob,bool) {
 s.jobsMu.Lock()
 defer s.jobsMu.Unlock()
 job:=s.startJobs[labID]
 if job==nil {return LabStartJob{},false}
 snapshot:=*job
 snapshot.Nodes=append([]LabStartNode(nil),job.Nodes...)
 return snapshot,true
}
func (s *Server) jobNode(labID,nodeID,status string,err error) {
 s.jobsMu.Lock()
 defer s.jobsMu.Unlock()
 job:=s.startJobs[labID]
 if job==nil{return}
 for i:=range job.Nodes {
  if job.Nodes[i].ID!=nodeID{continue}
  job.Nodes[i].Status=status
  if err!=nil{job.Nodes[i].Error=err.Error()}else{job.Nodes[i].Error=""}
  break
 }
}
func (s *Server) finishStartJob(labID string,err error) {
 s.jobsMu.Lock()
 defer s.jobsMu.Unlock()
 job:=s.startJobs[labID]
 if job==nil{return}
 now:=time.Now()
 job.FinishedAt=&now
 if err!=nil{job.Status="failed";job.Error=err.Error()}else{job.Status="completed"}
}
// startJobAPI is authorized by the existing /api/ middleware. It must run
// before labsAPI takes Store.mu, otherwise progress polling is blocked.
func (s *Server) startJobAPI(w http.ResponseWriter,r *http.Request,labID string) {
 if !validID(labID){fail(w,404,"лаборатория не найдена");return}
 if r.Method==http.MethodGet {
  snapshot,found:=s.startJobSnapshot(labID)
  if !found{fail(w,404,"операция запуска не найдена");return}
  respond(w,200,snapshot)
  return
 }
 if r.Method!=http.MethodPost{fail(w,405,"method not allowed");return}
 // Lock job state first: two concurrent POST requests cannot both launch the
 // same topology. The job remains queryable after the worker has finished.
 s.jobsMu.Lock()
 if previous:=s.startJobs[labID];previous!=nil && previous.Status=="running" {
  s.jobsMu.Unlock()
  fail(w,409,"запуск лаборатории уже выполняется");return
 }
 s.store.mu.Lock()
 lab:=s.store.findLab(labID)
 if lab==nil{
  s.store.mu.Unlock()
  s.jobsMu.Unlock()
  fail(w,404,"лаборатория не найдена");return
 }
 job:=&LabStartJob{ID:newID(),LabID:labID,Status:"running",StartedAt:time.Now(),Nodes:make([]LabStartNode,0,len(lab.Nodes))}
 for _,n:=range lab.Nodes {job.Nodes=append(job.Nodes,LabStartNode{ID:n.ID,Name:n.Name,Status:"pending"})}
 snapshot:=*lab
 s.startJobs[labID]=job
 s.store.mu.Unlock()
 s.jobsMu.Unlock()
 go s.runStartJob(snapshot)
 respond(w,http.StatusAccepted,job)
}
func (s *Server) runStartJob(snapshot Lab) {
 labID:=snapshot.ID
 // This retains the synchronous API's store lock: metadata cannot change
 // while a topology is being started. Progress reads use jobsMu only.
 s.store.mu.Lock()
 defer s.store.mu.Unlock()
 live:=s.store.findLab(labID)
 if live==nil{s.finishStartJob(labID,errors.New("лаборатория удалена"));return}
 lab:=*live
 if err:=s.validateLabStart(lab);err!=nil{
  for _,n:=range lab.Nodes {
   if strings.HasPrefix(err.Error(),n.Name+":"){
    s.jobNode(labID,n.ID,"failed",err)
    break
   }
  }
  s.finishStartJob(labID,err);return
 }
 // Keep the old rollback behavior, while notifying the UI before and after
 // every Start/Stop. The failed node is included in the rollback attempt.
 failureID:=""
 err:=startLabTransaction(lab,func(n Node)(bool,error){
   status,_:=s.engine.Status(labID,n.ID)
   if status=="running"{s.jobNode(labID,n.ID,"existing",nil);return true,nil}
   if s.engine.NodeBusy(labID,n.ID){
    issue:=errors.New("предыдущий процесс ещё очищает TAP")
    s.jobNode(labID,n.ID,"failed",issue)
    return false,issue
   }
   return false,nil
  },func(n Node)error{
   s.jobNode(labID,n.ID,"starting",nil)
   startErr:=s.startNode(lab,n)
   if startErr!=nil{
    failureID=n.ID
    s.jobNode(labID,n.ID,"failed",startErr)
   }else{s.jobNode(labID,n.ID,"running",nil)}
   return startErr
  },func(n Node)error{
   s.jobNode(labID,n.ID,"rolling-back",nil)
   stopErr:=s.engine.Stop(labID,n.ID)
   if stopErr!=nil{s.jobNode(labID,n.ID,"failed",fmt.Errorf("ошибка отката: %w",stopErr))
   }else if n.ID==failureID{
    s.jobNode(labID,n.ID,"failed",errors.New("не удалось запустить устройство; процесс очищен"))
   }else{s.jobNode(labID,n.ID,"rolled-back",nil)}
   return stopErr
  })
 s.finishStartJob(labID,err)
}
