package netlab

import (
 "context"
 "errors"
 "fmt"
 "net/http"
 "os"
 "os/exec"
 "os/user"
 "path/filepath"
 "strings"
 "time"
)

const maxInstallerSize int64 = 12 << 30

// ISO installer files are stored separately from VM disks. QEMU always mounts
// them read-only, and they can never be referenced as writable base images.
func (s *Server) mediaAPI(w http.ResponseWriter,r *http.Request,p []string){
 if len(p)==2 && p[1]=="attach" && r.Method==http.MethodPost {
  var req struct{LabID string `json:"labId"`; NodeID string `json:"nodeId"`; MediaID string `json:"mediaId"`}
  if !decode(w,r,&req){return}
  if !validID(req.LabID)||!validID(req.NodeID)||(req.MediaID!=""&&!validID(req.MediaID)){fail(w,400,"неверный идентификатор");return}
  s.store.mu.Lock();defer s.store.mu.Unlock()
  lab:=s.store.findLab(req.LabID)
  if lab==nil {fail(w,404,"лаборатория не найдена");return}
  node:=findNode(lab,req.NodeID)
  if node==nil||node.Engine=="vpcs"{fail(w,404,"QEMU устройство не найдено");return}
  if s.publishing[key(req.LabID,req.NodeID)] {fail(w,409,"образ публикуется");return}
  status,_:=s.engine.Status(req.LabID,req.NodeID)
  if status=="running"{fail(w,409,"остановите VM перед заменой ISO");return}
  if req.MediaID!=""{
   exists:=false
   for _,medium:=range s.store.State.Media {if medium.ID==req.MediaID{exists=true;break}}
   if !exists{fail(w,404,"ISO не найден");return}
  }
  old:=node.InstallISOID
  node.InstallISOID=req.MediaID
  if err:=s.store.save();err!=nil{node.InstallISOID=old;fail(w,500,err.Error());return}
  respond(w,200,map[string]any{"nodeId":req.NodeID,"mediaId":req.MediaID})
  return
 }
 if len(p)==1 {
  if r.Method==http.MethodGet {
   s.store.mu.Lock();list:=append([]InstallMedia{},s.store.State.Media...);s.store.mu.Unlock()
   respond(w,200,list);return
  }
  if r.Method==http.MethodPost{s.uploadISO(w,r);return}
 }
 if len(p)==2&&validID(p[1])&&r.Method==http.MethodDelete{
  s.store.mu.Lock();defer s.store.mu.Unlock()
  for _,lab:=range s.store.State.Labs {for _,node:=range lab.Nodes {
   if node.InstallISOID==p[1]{fail(w,409,"ISO подключён к виртуальной машине");return}
  }}
  for i,medium:=range s.store.State.Media{if medium.ID==p[1]{
   prev:=append([]InstallMedia{},s.store.State.Media...)
   s.store.State.Media=append(s.store.State.Media[:i],s.store.State.Media[i+1:]...)
   if err:=s.store.save();err!=nil{s.store.State.Media=prev;fail(w,500,err.Error());return}
   _=os.Remove(filepath.Join(s.data,"media",medium.ID+".iso"))
   respond(w,200,map[string]bool{"deleted":true});return
  }}
 }
 fail(w,404,"ISO не найден")
}
func (s *Server) uploadISO(w http.ResponseWriter,r *http.Request){
 r.Body=http.MaxBytesReader(w,r.Body,maxInstallerSize+(1<<20))
 reader,err:=r.MultipartReader()
 if err!=nil{fail(w,400,"ожидался multipart/form-data");return}
 part,err:=reader.NextPart()
 if err!=nil{fail(w,400,"ISO файл не передан");return}
 defer part.Close()
 name:=filepath.Base(part.FileName())
 if part.FormName()!="file"||len(name)>150||len(name)<5||!strings.EqualFold(filepath.Ext(name),".iso"){
  fail(w,400,"ожидается установочный файл .iso");return
 }
 id:=newID();temporary:=filepath.Join(s.data,"media",id+".upload")
 defer os.Remove(temporary)
 size,err:=copyFile(temporary,part)
 if err!=nil{fail(w,400,err.Error());return}
 if size<32775||size>maxInstallerSize{fail(w,422,"недопустимый размер ISO (до 12 ГиБ)");return}
 f,err:=os.Open(temporary)
 if err!=nil{fail(w,500,err.Error());return}
 marker:=make([]byte,5)
 _,err=f.ReadAt(marker,32769)
 _=f.Close()
 if err!=nil||string(marker)!="CD001" {
  fail(w,422,"отсутствует ISO9660 дескриптор: проверьте установочный ISO");return
 }
 final:=filepath.Join(s.data,"media",id+".iso")
 if err=os.Rename(temporary,final);err!=nil{fail(w,500,err.Error());return}
 chownForVM(final)
 medium:=InstallMedia{ID:id,Name:name,Size:size,CreatedAt:time.Now()}
 s.store.mu.Lock()
 s.store.State.Media=append(s.store.State.Media,medium)
 err=s.store.save()
 if err!=nil{s.store.State.Media=s.store.State.Media[:len(s.store.State.Media)-1]}
 s.store.mu.Unlock()
 if err!=nil{_ =os.Remove(final);fail(w,500,err.Error());return}
 respond(w,201,medium)
}
func chownForVM(path string){
 if u,err:=user.Lookup("netlab-vm");err==nil {
  uid,e1:=parseInt(u.Uid);gid,e2:=parseInt(u.Gid)
  if e1==nil&&e2==nil{_ =os.Chown(path,uid,gid)}
 }
}

func (s *Server) createBlankImage(w http.ResponseWriter,r *http.Request){
 var req struct{Name string `json:"name"`;SizeGiB int `json:"sizeGiB"`}
 if !decode(w,r,&req){return}
 if err:=validName(req.Name);err!=nil{fail(w,400,err.Error());return}
 if req.SizeGiB<8||req.SizeGiB>256{fail(w,400,"размер диска должен быть от 8 до 256 ГиБ");return}
 if _,err:=exec.LookPath("qemu-img");err!=nil{fail(w,503,"требуется пакет qemu-utils");return}
 id:=newID()
 temporary:=filepath.Join(s.data,"images",id+".preparing")
 ctx,cancel:=context.WithTimeout(r.Context(),30*time.Second);defer cancel()
 cmd:=exec.CommandContext(ctx,"qemu-img","create","-f","qcow2",temporary,fmt.Sprintf("%dG",req.SizeGiB))
 if output,err:=cmd.CombinedOutput();err!=nil{_ =os.Remove(temporary);fail(w,500,"создание диска: "+err.Error()+" "+string(output));return}
 final:=filepath.Join(s.data,"images",id+".qcow2")
 if err:=os.Rename(temporary,final);err!=nil{_ =os.Remove(temporary);fail(w,500,err.Error());return}
 chownForVM(final)
 stat,err:=os.Stat(final);if err!=nil{_ =os.Remove(final);fail(w,500,err.Error());return}
 image:=Image{ID:id,Name:strings.TrimSpace(req.Name)+".qcow2",Size:stat.Size(),Format:"qcow2",CreatedAt:time.Now()}
 s.store.mu.Lock();s.store.State.Images=append(s.store.State.Images,image)
 err=s.store.save()
 if err!=nil{s.store.State.Images=s.store.State.Images[:len(s.store.State.Images)-1]}
 s.store.mu.Unlock()
 if err!=nil{_ =os.Remove(final);fail(w,500,err.Error());return}
 respond(w,201,image)
}

func (s *Server) catalogAPI(w http.ResponseWriter,r *http.Request,p []string){
 if len(p)==1&&r.Method==http.MethodGet{
  s.store.mu.Lock();items:=append([]PreparedTemplate{},s.store.State.Catalog...);s.store.mu.Unlock()
  respond(w,200,items);return
 }
 if len(p)==2&&p[1]=="publish"&&r.Method==http.MethodPost {
  s.publishVM(w,r);return
 }
 if len(p)==2&&validID(p[1])&&r.Method==http.MethodDelete{
  s.store.mu.Lock();defer s.store.mu.Unlock()
  for i,profile:=range s.store.State.Catalog{if profile.ID==p[1]{
   original:=append([]PreparedTemplate{},s.store.State.Catalog...)
   s.store.State.Catalog=append(s.store.State.Catalog[:i],s.store.State.Catalog[i+1:]...)
   if err:=s.store.save();err!=nil{s.store.State.Catalog=original;fail(w,500,err.Error());return}
   respond(w,200,map[string]bool{"deleted":true});return
  }}
 }
 fail(w,404,"шаблон не найден")
}
func (s *Server) publishVM(w http.ResponseWriter,r *http.Request){
 var req struct{
  LabID string `json:"labId"`;NodeID string `json:"nodeId"`
  Name string `json:"name"`;Category string `json:"category"`
  Family string `json:"family"`;Version string `json:"version"`
 }
 if !decode(w,r,&req){return}
 if !validID(req.LabID)||!validID(req.NodeID){fail(w,400,"неверный идентификатор");return}
 if err:=validName(req.Name);err!=nil{fail(w,400,err.Error());return}
 if err:=validName(req.Family);err!=nil{fail(w,400,"укажите семейство ОС");return}
 if err:=validName(req.Version);err!=nil{fail(w,400,"укажите версию ОС");return}
 switch req.Category {case "server","desktop","network","other":default:fail(w,400,"неизвестная категория образов");return}
 if _,err:=exec.LookPath("qemu-img");err!=nil{fail(w,503,"требуется qemu-utils");return}
 k:=key(req.LabID,req.NodeID)
 s.store.mu.Lock()
 lab:=s.store.findLab(req.LabID)
 if lab==nil{s.store.mu.Unlock();fail(w,404,"лаборатория не найдена");return}
 nodePtr:=findNode(lab,req.NodeID)
 if nodePtr==nil||nodePtr.Engine=="vpcs"{s.store.mu.Unlock();fail(w,404,"QEMU узел не найден");return}
 if s.publishing[k]{s.store.mu.Unlock();fail(w,409,"публикация уже выполняется");return}
 status,_:=s.engine.Status(req.LabID,req.NodeID)
 if status=="running"||nodePtr.InstallISOID!="" {
  s.store.mu.Unlock();fail(w,409,"перед публикацией выключите VM и извлеките ISO");return
 }
 node:=*nodePtr
 s.publishing[k]=true
 s.store.mu.Unlock()
 defer func(){s.store.mu.Lock();delete(s.publishing,k);s.store.mu.Unlock()}()
 source:=filepath.Join(s.data,"runtime",req.LabID,req.NodeID,"disk.qcow2")
 if _,err:=os.Stat(source);err!=nil{fail(w,409,"диск узла не инициализирован: сначала запустите VM");return}
 id:=newID();temporary:=filepath.Join(s.data,"images",id+".publishing")
 defer os.Remove(temporary)
 ctx,cancel:=context.WithTimeout(r.Context(),60*time.Minute);defer cancel()
 cmd:=exec.CommandContext(ctx,"qemu-img","convert","-f","qcow2","-O","qcow2","-c",source,temporary)
 if err:=cmd.Run();err!=nil{fail(w,500,"публикация диска: "+err.Error());return}
 if err:=os.Chmod(temporary,0640);err!=nil{fail(w,500,err.Error());return}
 final:=filepath.Join(s.data,"images",id+".qcow2")
 if err:=os.Rename(temporary,final);err!=nil{fail(w,500,err.Error());return}
 chownForVM(final)
 st,err:=os.Stat(final);if err!=nil{_ =os.Remove(final);fail(w,500,err.Error());return}
 image:=Image{ID:id,Name:strings.TrimSpace(req.Name)+".qcow2",Format:"qcow2",Size:st.Size(),CreatedAt:time.Now()}
 tpl:=PreparedTemplate{ID:newID(),ImageID:id,Name:strings.TrimSpace(req.Name),Category:req.Category,Family:strings.TrimSpace(req.Family),Version:strings.TrimSpace(req.Version),Kind:node.Kind,RAM:node.RAM,CPUs:node.CPUs,NICModel:node.NICModel,NICCount:portCapacity(&node),DiskBus:node.DiskBus,PortStyle:node.PortStyle,Icon:node.Icon,CreatedAt:time.Now()}
 s.store.mu.Lock()
 lab=s.store.findLab(req.LabID)
 var current *Node
 if lab!=nil{current=findNode(lab,req.NodeID)}
 status,_=s.engine.Status(req.LabID,req.NodeID)
 if current==nil||status=="running"||current.InstallISOID!=""{
  s.store.mu.Unlock();_ =os.Remove(final);fail(w,409,"устройство изменилось во время публикации");return
 }
 s.store.State.Images=append(s.store.State.Images,image)
 s.store.State.Catalog=append(s.store.State.Catalog,tpl)
 err=s.store.save()
 if err!=nil{
  s.store.State.Images=s.store.State.Images[:len(s.store.State.Images)-1]
  s.store.State.Catalog=s.store.State.Catalog[:len(s.store.State.Catalog)-1]
 }
 s.store.mu.Unlock()
 if err!=nil{_ =os.Remove(final);fail(w,500,err.Error());return}
 respond(w,201,tpl)
}

// Verify that install ISO references exist before accepting a new or updated node.
func (s *Server) checkInstaller(node Node) error{
 if node.InstallISOID==""{return nil}
 if !validID(node.InstallISOID){return errors.New("недопустимый ISO ID")}
 for _,medium:=range s.store.State.Media{if medium.ID==node.InstallISOID{return nil}}
 return errors.New("установочный ISO не найден")
}
