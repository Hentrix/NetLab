package netlab

import (
 "encoding/json"
 "os"
 "path/filepath"
 "strings"
 "testing"
 "time"
)
func TestVNCTicketAuthAndSingleUse(t *testing.T){
 s:=newTestServer(t)
 lab:=Lab{ID:newID(),Name:"Installer",Nodes:[]Node{{ID:newID(),Name:"Windows install",Engine:"qemu"}},Links:[]Link{}}
 s.store.mu.Lock();s.store.State.Labs=append(s.store.State.Labs,lab);s.store.mu.Unlock()
 endpoint:="/api/labs/"+lab.ID+"/nodes/"+lab.Nodes[0].ID+"/vnc-ticket"
 status,body:=httpCall(t,s,"POST",endpoint,nil,false)
 if status!=401{t.Fatalf("missing token: %d %s",status,body)}
 status,body=httpCall(t,s,"POST",endpoint,nil,true)
 if status!=409{t.Fatalf("stopped VM: %d %s",status,body)}
 sock:=filepath.Join(s.data,"runtime",lab.ID,lab.Nodes[0].ID,"display-ws.sock")
 if err:=os.MkdirAll(filepath.Dir(sock),0750);err!=nil{t.Fatal(err)}
 if err:=os.WriteFile(sock,[]byte("mock socket"),0600);err!=nil{t.Fatal(err)}
 s.engine.mu.Lock()
 s.engine.instances[key(lab.ID,lab.Nodes[0].ID)]=&Instance{status:"running",engine:"qemu"}
 s.engine.mu.Unlock()
 status,body=httpCall(t,s,"POST",endpoint,nil,true)
 assertStatus(t,status,200,body)
 var v struct{Ticket string `json:"ticket"`;WsPath string `json:"wsPath"`}
 if err:=json.Unmarshal(body,&v);err!=nil{t.Fatal(err)}
 if len(v.Ticket)!=64 || !strings.HasSuffix(v.WsPath,v.Ticket){t.Fatalf("invalid ticket data: %+v",v)}
 s.ticketsMu.Lock()
 item,ok:=s.vncTickets[v.Ticket]
 s.ticketsMu.Unlock()
 if !ok||time.Until(item.Expires)>31*time.Second{t.Fatal("ticket is not short-lived")}
 if _,ok=s.takeVNCTicket(v.Ticket);!ok{t.Fatal("valid ticket rejected")}
 if _,ok=s.takeVNCTicket(v.Ticket);ok{t.Fatal("ticket reused")}
}
func TestVNCTicketExpired(t *testing.T){
 s:=newTestServer(t)
 token:=strings.Repeat("a",64)
 s.ticketsMu.Lock();s.vncTickets[token]=vncTicket{Expires:time.Now().Add(-time.Second)};s.ticketsMu.Unlock()
 if _,ok:=s.takeVNCTicket(token);ok{t.Fatal("expired ticket accepted")}
}
