package netlab

import (
 "bytes"
 "errors"
 "fmt"
 "io"
 "net/http"
 "os"
 "os/exec"
 "os/user"
 "path/filepath"
 "strings"
 "time"
)

// ISO9660 primary or supplementary volume descriptor (sector 16 onwards).
// Reject renamed arbitrary files before attaching them as a CD-ROM.
func validateInstallerISO(path string) error {
 f,err:=os.Open(path);if err!=nil{return err};defer f.Close()
 if _,err=f.Seek(16*2048,io.SeekStart);err!=nil{return err}
 block:=make([]byte,2048)
 for i:=0;i<16;i++ {
  if _,err=io.ReadFull(f,block);err!=nil {return errors.New("файл не содержит ISO9660-дескриптор")}
  if bytes.Equal(block[1:6],[]byte("CD001")) {return nil}
 }
 return errors.New("не обнаружен ISO9660: проверьте ISO установщика")
}

// Call under store.mu.
func (s *Server) validNodeMedia(n Node) bool {
 disk:=findImage(&s.store.State,n.ImageID)
 if disk==nil || disk.isISO(){return false}
 if n.InstallISOID=="" {return true}
 iso:=findImage(&s.store.State,n.InstallISOID)
 return iso!=nil&&iso.isISO()
}

func validImageCategory(v string) bool {
 switch v {case "", "server", "desktop", "router", "switch", "firewall", "other":return true}
 return false
}
func validImageText(s string) bool {return len([]rune(strings.TrimSpace(s)))<=80}
func validateImageMetadata(name,category,family,version string) error {
 if err:=validName(name);err!=nil{return err}
 if !validImageCategory(category){return errors.New("неподдерживаемая категория")}
 if !validImageText(family)||!validImageText(version){return errors.New("семейство/версия слишком длинные")}
 return nil
}
func (s *Server) createBlankImage(w http.ResponseWriter,r *http.Request){
 var req struct{Name string `json:"name"`; SizeGiB int `json:"sizeGiB"`}
 if !decode(w,r,&req){return}
 if err:=validName(req.Name);err!=nil{fail(w,400,err.Error());return}
 if req.SizeGiB<4||req.SizeGiB>512{fail(w,400,"размер диска: 4–512 ГиБ");return}
 if _,err:=exec.LookPath("qemu-img");err!=nil{fail(w,503,"не установлен qemu-img");return}
 id:=newID()
 tmp:=filepath.Join(s.data,"images",id+".creating")
 final:=filepath.Join(s.data,"images",id+".qcow2")
 defer os.Remove(tmp)
 if err:=run("qemu-img","create","-f","qcow2",tmp,fmt.Sprintf("%dG",req.SizeGiB));err!=nil{fail(w,500,err.Error());return}
 if err:=os.Rename(tmp,final);err!=nil{fail(w,500,err.Error());return}
 if u,err:=user.Lookup("netlab-vm");err==nil {
  uid,_:=parseInt(u.Uid);gid,_:=parseInt(u.Gid);_ = os.Chown(final,uid,gid)
 }
 info,err:=os.Stat(final);if err!=nil{_ = os.Remove(final);fail(w,500,err.Error());return}
 img:=Image{ID:id,Name:strings.TrimSpace(req.Name),Format:"qcow2",Kind:"disk",Draft:true,Size:info.Size(),CreatedAt:time.Now()}
 s.store.mu.Lock()
 s.store.State.Images=append(s.store.State.Images,img)
 err=s.store.save()
 if err!=nil{s.store.State.Images=s.store.State.Images[:len(s.store.State.Images)-1]}
 s.store.mu.Unlock()
 if err!=nil{_ = os.Remove(final);fail(w,500,err.Error());return}
 respond(w,201,img)
}
func (s *Server) updateImageMetadata(w http.ResponseWriter,r *http.Request,id string){
 var req struct{ Name string `json:"name"`;Category string `json:"category"`;Family string `json:"family"`;Version string `json:"version"`}
 if !decode(w,r,&req){return}
 if err:=validateImageMetadata(req.Name,req.Category,req.Family,req.Version);err!=nil{fail(w,400,err.Error());return}
 s.store.mu.Lock()
 defer s.store.mu.Unlock()
 img:=findImage(&s.store.State,id)
 if img==nil{fail(w,404,"образ не найден");return}
 before:=*img
 img.Name=strings.TrimSpace(req.Name)
 img.Category=req.Category
 img.Family=strings.TrimSpace(req.Family)
 img.Version=strings.TrimSpace(req.Version)
 if err:=s.store.save();err!=nil{*img=before;fail(w,500,err.Error());return}
 respond(w,200,img)
}
func (s *Server) workshopAPI(w http.ResponseWriter,r *http.Request,p []string){
 if len(p)!=2 ||p[1]!="publish" ||r.Method!=http.MethodPost {fail(w,404,"неизвестное действие мастерской");return}
 var req struct{LabID string `json:"labId"`;NodeID string `json:"nodeId"`;Name string `json:"name"`;Category string `json:"category"`;Family string `json:"family"`;Version string `json:"version"`}
 if !decode(w,r,&req){return}
 if !validID(req.LabID)||!validID(req.NodeID){fail(w,400,"неверный ID");return}
 if err:=validateImageMetadata(req.Name,req.Category,req.Family,req.Version);err!=nil{fail(w,400,err.Error());return}
 if _,err:=exec.LookPath("qemu-img");err!=nil{fail(w,503,"требуется qemu-img");return}
 // Keep the state lock while converting. This deliberately serializes QEMU
 // start/stop with snapshot publishing, avoiding corruption from live writes.
 s.store.mu.Lock()
 defer s.store.mu.Unlock()
 lab:=s.store.findLab(req.LabID)
 if lab==nil{fail(w,404,"лаборатория не найдена");return}
 node:=findNode(lab,req.NodeID)
 if node==nil || node.Engine=="vpcs"{fail(w,404,"QEMU узел не найден");return}
 status,_:=s.engine.Status(req.LabID,req.NodeID)
 if status=="running"{fail(w,409,"выключите VM из гостевой ОС и остановите устройство перед публикацией");return}
 overlay:=filepath.Join(s.data,"runtime",req.LabID,req.NodeID,"disk.qcow2")
 if _,err:=os.Stat(overlay);err!=nil{fail(w,409,"диск VM не найден: сначала запустите и установите ОС");return}
 id:=newID()
 tmp:=filepath.Join(s.data,"images",id+".publishing")
 final:=filepath.Join(s.data,"images",id+".qcow2")
 defer os.Remove(tmp)
 // A flattened self-contained qcow2: no backing image and no dependency on the lab.
 if err:=run("qemu-img","convert","-f","qcow2","-O","qcow2",overlay,tmp);err!=nil{fail(w,500,"не удалось сохранить диск: "+err.Error());return}
 if err:=os.Rename(tmp,final);err!=nil{fail(w,500,err.Error());return}
 if u,err:=user.Lookup("netlab-vm");err==nil {
  uid,_:=parseInt(u.Uid);gid,_:=parseInt(u.Gid);_ = os.Chown(final,uid,gid)
 }
 info,err:=os.Stat(final)
 if err!=nil{_ = os.Remove(final);fail(w,500,err.Error());return}
 img:=Image{ID:id,Name:strings.TrimSpace(req.Name),Kind:"disk",Format:"qcow2",Category:req.Category,Family:strings.TrimSpace(req.Family),Version:strings.TrimSpace(req.Version),Published:true,Size:info.Size(),CreatedAt:time.Now()}
 s.store.State.Images=append(s.store.State.Images,img)
 if err:=s.store.save();err!=nil{
  s.store.State.Images=s.store.State.Images[:len(s.store.State.Images)-1]
  _ = os.Remove(final);fail(w,500,err.Error());return
 }
 respond(w,201,img)
}
