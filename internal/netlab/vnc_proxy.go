package netlab

import (
 "crypto/rand"
 "encoding/base64"
 "encoding/hex"
 "errors"
 "fmt"
 "io"
 "net"
 "net/http"
 "net/url"
 "os"
 "path/filepath"
 "strings"
 "time"
)

type vncTicket struct {
 LabID string
 NodeID string
 Expires time.Time
}

func (s *Server) issueVNCTicket(w http.ResponseWriter,r *http.Request,labID,nodeID string){
 if r.Method!=http.MethodPost {fail(w,405,"method not allowed");return}
 if !validID(labID)||!validID(nodeID){fail(w,404,"устройство не найдено");return}
 s.store.mu.Lock()
 lab:=s.store.findLab(labID)
 var node *Node
 if lab!=nil{node=findNode(lab,nodeID)}
 allowed:=node!=nil && node.Engine!="vpcs"
 s.store.mu.Unlock()
 if !allowed{fail(w,404,"графическая консоль доступна только для QEMU");return}
 status,_:=s.engine.Status(labID,nodeID)
 if status!="running"{fail(w,409,"сначала запустите устройство");return}
 sock:=filepath.Join(s.data,"runtime",labID,nodeID,"display-ws.sock")
 if _,err:=os.Stat(sock);err!=nil{fail(w,409,"QEMU ещё не открыл графическую консоль");return}
 var random [32]byte
 if _,err:=rand.Read(random[:]);err!=nil{fail(w,500,"не удалось создать билет");return}
 ticket:=hex.EncodeToString(random[:])
 s.ticketsMu.Lock()
 now:=time.Now()
 for key,value:=range s.vncTickets{if now.After(value.Expires){delete(s.vncTickets,key)}}
 if len(s.vncTickets)>=128{s.ticketsMu.Unlock();fail(w,429,"слишком много открытых сеансов");return}
 s.vncTickets[ticket]=vncTicket{LabID:labID,NodeID:nodeID,Expires:now.Add(30*time.Second)}
 s.ticketsMu.Unlock()
 respond(w,200,map[string]string{"ticket":ticket,"wsPath":"/vnc/"+ticket})
}

func (s *Server) takeVNCTicket(token string) (vncTicket,bool){
 s.ticketsMu.Lock()
 defer s.ticketsMu.Unlock()
 item,ok:=s.vncTickets[token]
 delete(s.vncTickets,token) // one-use, even when the connection later fails
 if !ok||time.Now().After(item.Expires){return vncTicket{},false}
 return item,true
}

func (s *Server) proxyVNC(w http.ResponseWriter,r *http.Request){
 if r.Method!=http.MethodGet {fail(w,405,"method not allowed");return}
 if !strings.EqualFold(r.Header.Get("Upgrade"),"websocket") ||
   !strings.Contains(strings.ToLower(r.Header.Get("Connection")),"upgrade") ||
   r.Header.Get("Sec-WebSocket-Version")!="13" {
  fail(w,400,"ожидалось WebSocket-подключение");return
 }
 if origin:=r.Header.Get("Origin");origin!="" {
  parsed,err:=url.Parse(origin)
  if err!=nil||!strings.EqualFold(parsed.Host,r.Host)||
     (parsed.Scheme!="http"&&parsed.Scheme!="https"){
   fail(w,403,"доступ разрешён только с того же сайта");return
  }
 }
 key:=r.Header.Get("Sec-WebSocket-Key")
 decoded,err:=base64.StdEncoding.DecodeString(key)
 if err!=nil||len(decoded)!=16{fail(w,400,"некорректный WebSocket ключ");return}
 token:=strings.TrimPrefix(r.URL.Path,"/vnc/")
 if len(token)!=64||strings.Contains(token,"/"){fail(w,403,"неверный билет");return}
 if _,err:=hex.DecodeString(token);err!=nil{fail(w,403,"неверный билет");return}
 ticket,ok:=s.takeVNCTicket(token)
 if !ok{fail(w,403,"билет истёк или уже использован");return}
 status,_:=s.engine.Status(ticket.LabID,ticket.NodeID)
 if status!="running"{fail(w,409,"устройство остановлено");return}
 sock:=filepath.Join(s.data,"runtime",ticket.LabID,ticket.NodeID,"display-ws.sock")
 backend,err:=net.DialTimeout("unix",sock,3*time.Second)
 if err!=nil{fail(w,502,"графический сокет QEMU недоступен");return}
 defer backend.Close()
 hijacker,ok:=w.(http.Hijacker)
 if !ok{fail(w,500,"WebSocket upgrade не поддерживается сервером");return}
 browser,buf,err:=hijacker.Hijack()
 if err!=nil{return}
 defer browser.Close()
 // QEMU owns the WebSocket handshake and framing. We proxy the binary
 // stream without parsing VNC data or exposing a TCP listener on the host.
 handshake:="GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: "+key+"\r\n"
 if protocol:=r.Header.Get("Sec-WebSocket-Protocol");protocol!=""{
  // The noVNC client requests the well-known 'binary' subprotocol.
  if !strings.Contains(protocol,"binary"){return}
  handshake+="Sec-WebSocket-Protocol: binary\r\n"
 }
 handshake+="\r\n"
 if _,err=io.WriteString(backend,handshake);err!=nil{return}
 done:=make(chan struct{})
 go func(){_,_ = io.Copy(backend,buf.Reader);_ = backend.Close();close(done)}()
 _,err=io.Copy(browser,backend)
 _=err
 _=browser.Close()
 select{case <-done:case <-time.After(time.Second):}
}

// An offline image cannot be displayed by the remote VNC proxy.
var _ = errors.New
var _ = fmt.Sprintf
