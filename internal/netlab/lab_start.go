package netlab

import (
 "errors"
 "fmt"
 "strings"
)

// startLabTransaction keeps pre-existing running devices untouched. It checks
// every node before starting any, and rolls back only this request's new
// processes if a later node fails. A failed Start may have spawned a child
// before returning its error, so that node is stopped as well.
func startLabTransaction(l Lab, inspect func(Node) (bool,error), start func(Node) error, stop func(Node) error) error {
 pending:=make([]Node,0,len(l.Nodes))
 for _,n:=range l.Nodes {
  alreadyRunning,err:=inspect(n)
  if err!=nil {return fmt.Errorf("%s: %w",n.Name,err)}
  if !alreadyRunning {pending=append(pending,n)}
 }
 started:=make([]Node,0,len(pending))
 for _,n:=range pending {
  if err:=start(n);err!=nil {
   // The failed node might already own a process or TAP.
   cleanup:=[]Node{n}
   for i:=len(started)-1;i>=0;i-- {cleanup=append(cleanup,started[i])}
   var failed []string
   for _,item:=range cleanup {
    if stopErr:=stop(item);stopErr!=nil {
     failed=append(failed,item.Name+": "+stopErr.Error())
    }
   }
   if len(failed)>0 {
    return errors.Join(fmt.Errorf("%s: %w",n.Name,err),fmt.Errorf("откат не завершён: %s",strings.Join(failed,"; ")))
   }
   return fmt.Errorf("%s: %w (запущенные этим запросом VM остановлены)",n.Name,err)
  }
  started=append(started,n)
 }
 return nil
}

// validateLabStart checks references for the complete topology before any
// QEMU/VPCS child is launched. Runtime errors are handled by rollback above.
func (s *Server) validateLabStart(l Lab) error {
 for _,n:=range l.Nodes {
  if n.Engine=="vpcs" {continue}
  img:=findImage(&s.store.State,n.ImageID)
  if img==nil||img.isISO() {
   err:=errors.New("дисковый образ не найден")
   s.engine.SetStartFailure(l.ID,n.ID,err)
   return fmt.Errorf("%s: %w",n.Name,err)
  }
  if n.InstallISOID!="" {
   iso:=findImage(&s.store.State,n.InstallISOID)
   if iso==nil||!iso.isISO() {
    err:=errors.New("установочный ISO не найден")
    s.engine.SetStartFailure(l.ID,n.ID,err)
    return fmt.Errorf("%s: %w",n.Name,err)
   }
  }
 }
 return nil
}

func (s *Server) startLab(l Lab) error {
 if err:=s.validateLabStart(l);err!=nil{return err}
 return startLabTransaction(l,
  func(n Node)(bool,error){
   status,_:=s.engine.Status(l.ID,n.ID)
   if status=="running" {return true,nil}
   if s.engine.NodeBusy(l.ID,n.ID) {return false,errors.New("предыдущий процесс ещё очищает TAP; повторите запуск после остановки")}
   return false,nil
  },
  func(n Node)error{return s.startNode(l,n)},
  func(n Node)error{return s.engine.Stop(l.ID,n.ID)},
 )
}
