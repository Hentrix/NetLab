package netlab

import (
 "fmt"
 "net/http"
 "net/http/httputil"
 "net/url"
 "strings"
 "sync"
 "time"
)

type graphicsTicket struct{
 LabID string
 NodeID string
 Port int
 Expires time.Time
}
var _ sync.Locker = (*sync.Mutex)(nil)

// A one-time random short-lived ticket prevents exposing the administrator's
// Bearer token in WebSocket URLs and never exposes raw VNC ports publicly.
func(s *Server)issueGraphicsTicket(w http.ResponseWriter,r *http.Request){
 var req struct{LabID string `json:"labId"`;NodeID string `json:"nodeId"`}
 if !decode(w,r,&req){return}
 if !validID(req.LabID)||!validID(req.NodeID){fail(w,400,"неверный идентификатор");return}
 s.store.mu.Lock()
 lab:=s.store.findLab(req.LabID)
 var found bool
 if lab!=nil{
  if node:=findNode(lab,req.NodeID);node!=nil&&node.Engine!="vpcs"{found=true}
 }
 s.store.mu.Unlock()
 if !found{fail(w,404,"QEMU узел не найден");return}
 port,err:=s.engine.GraphicsPort(req.LabID,req.NodeID)
 if err!=nil{fail(w,409,err.Error());return}
 ticket:=newID()+newID()
 s.ticketMu.Lock()
 for id,value:=range s.tickets{if time.Now().After(value.Expires){delete(s.tickets,id)}}
 s.tickets[ticket]=graphicsTicket{LabID:req.LabID,NodeID:req.NodeID,Port:port,Expires:time.Now().Add(45*time.Second)}
 s.ticketMu.Unlock()
 respond(w,200,map[string]string{"path":"/api/graphics/"+ticket})
}
func(s *Server)serveGraphics(w http.ResponseWriter,r *http.Request){
 if r.Method!=http.MethodGet||!strings.EqualFold(r.Header.Get("Upgrade"),"websocket"){
  fail(w,400,"требуется WebSocket");return
 }
 // Browser-supplied Origin must refer to this NetLab origin. The one-time
 // ticket is necessary but not sufficient to bypass CSRF checks.
 origin:=r.Header.Get("Origin")
 parsed,err:=url.Parse(origin)
 if err!=nil||origin==""||parsed.Host!=r.Host||!(parsed.Scheme=="http"||parsed.Scheme=="https"){
  fail(w,403,"недопустимый Origin WebSocket");return
 }
 ticket:=strings.TrimPrefix(r.URL.Path,"/api/graphics/")
 if len(ticket)!=32||strings.Contains(ticket,"/"){fail(w,404,"консоль не найдена");return}
 s.ticketMu.Lock();value,exists:=s.tickets[ticket];delete(s.tickets,ticket);s.ticketMu.Unlock()
 if !exists||time.Now().After(value.Expires){fail(w,401,"токен графической консоли истёк");return}
 port,err:=s.engine.GraphicsPort(value.LabID,value.NodeID)
 if err!=nil||port!=value.Port{fail(w,409,"VM больше не запущена");return}
 target:=&url.URL{Scheme:"http",Host:fmt.Sprintf("127.0.0.1:%d",port)}
 proxy:=httputil.NewSingleHostReverseProxy(target)
 original:=proxy.Director
 proxy.Director=func(req *http.Request){
  original(req)
  req.Host=target.Host
  req.URL.Path="/"
  req.URL.RawQuery=""
  req.Header.Del("Authorization")
 }
 proxy.ErrorHandler=func(w http.ResponseWriter,_ *http.Request,_ error){fail(w,502,"VNC WebSocket недоступен")}
 proxy.ServeHTTP(w,r)
}
