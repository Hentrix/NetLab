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

// Restore images whose deletion was interrupted before the state commit.
// Only catalogued images are restored; unreferenced tombstones are left for
// an administrator to inspect rather than removed without confirmation.
func recoverStagedImageDeletes(data string, images []Image) error {
 for _, img := range images {
  if !validID(img.ID) { continue }
  switch img.Format { case "qcow2", "qcow", "raw", "img", "iso": default: continue }
  path:=filepath.Join(data,"images",img.ID+"."+img.Format)
  if _,err:=os.Stat(path);err==nil { continue } else if !errors.Is(err,os.ErrNotExist) { return err }
  staged:=path+".deleting"
  if _,err:=os.Stat(staged);errors.Is(err,os.ErrNotExist) { continue } else if err!=nil { return err }
  if err:=os.Rename(staged,path);err!=nil { return fmt.Errorf("восстановление образа %s: %w",img.ID,err) }
 }
 return nil
}

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
// A published category/family/version identifies one immutable catalog revision.
// Renaming a version is allowed only if it does not collide with another image.
func catalogVersionConflict(images []Image, exceptID, category, family, version string) bool {
 family = strings.TrimSpace(family)
 version = strings.TrimSpace(version)
 if family == "" || version == "" { return false }
 for _, image := range images {
  if image.ID == exceptID || !image.Published || image.Draft || image.isISO() { continue }
  if image.Category == category &&
   strings.EqualFold(strings.TrimSpace(image.Family), family) &&
   strings.EqualFold(strings.TrimSpace(image.Version), version) { return true }
 }
 return false
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
 if img.Published && catalogVersionConflict(s.store.State.Images,id,req.Category,req.Family,req.Version) {
  fail(w,409,"такая версия уже опубликована: выберите другую версию");return
 }
 before:=*img
 img.Name=strings.TrimSpace(req.Name)
 img.Category=req.Category
 img.Family=strings.TrimSpace(req.Family)
 img.Version=strings.TrimSpace(req.Version)
 if err:=s.store.save();err!=nil{*img=before;fail(w,500,err.Error());return}
 respond(w,200,img)
}
// Create a writable preparation VM from an existing published version.
// The new draft is flattened before exposure, so deleting the original
// published version later cannot invalidate the revision's backing chain.
func (s *Server) createWorkshopRevision(w http.ResponseWriter,r *http.Request) {
 var req struct { ImageID string `json:"imageId"`; Name string `json:"name"`; Version string `json:"version"` }
 if !decode(w,r,&req){return}
 if !validID(req.ImageID){fail(w,400,"неверный ID исходного образа");return}
 if err:=validName(req.Name);err!=nil{fail(w,400,err.Error());return}
 if !validImageText(req.Version)||strings.TrimSpace(req.Version)==""{fail(w,400,"укажите версию длиной до 80 символов");return}
 if _,err:=exec.LookPath("qemu-img");err!=nil{fail(w,503,"требуется qemu-img");return}
 s.store.mu.Lock()
 defer s.store.mu.Unlock()
 base:=findImage(&s.store.State,req.ImageID)
 if base==nil {fail(w,404,"исходный образ не найден");return}
 if !base.Published||base.Draft||base.isISO()||base.Format!="qcow2" {
  fail(w,409,"ревизию можно создать только из опубликованного QCOW2");return
 }
 if catalogVersionConflict(s.store.State.Images,"",base.Category,base.Family,req.Version) {
  fail(w,409,"такая версия уже опубликована");return
 }
 original:=filepath.Join(s.data,"images",base.ID+"."+base.Format)
 if _,err:=os.Stat(original);err!=nil{fail(w,409,"файл исходного образа недоступен");return}
 id:=newID()
 tmp:=filepath.Join(s.data,"images",id+".revising")
 final:=filepath.Join(s.data,"images",id+".qcow2")
 defer os.Remove(tmp)
 if err:=run("qemu-img","convert","-f","qcow2","-O","qcow2",original,tmp);err!=nil {
  fail(w,500,"не удалось скопировать образ: "+err.Error());return
 }
 if err:=os.Rename(tmp,final);err!=nil{fail(w,500,err.Error());return}
 if u,err:=user.Lookup("netlab-vm");err==nil {
  uid,_:=parseInt(u.Uid);gid,_:=parseInt(u.Gid);_ = os.Chown(final,uid,gid)
 }
 info,err:=os.Stat(final)
 if err!=nil{_ = os.Remove(final);fail(w,500,err.Error());return}
 disk:=*base
 disk.ID=id
 disk.Name=strings.TrimSpace(req.Name)
 disk.Version=strings.TrimSpace(req.Version)
 disk.Published=false
 disk.Draft=true
 disk.Kind="disk"
 disk.Format="qcow2"
 disk.Size=info.Size()
 disk.CreatedAt=time.Now()
 kind:="server"
 switch base.Category {case "desktop":kind="pc";case "router","switch","firewall":kind=base.Category}
 ram:=base.RAM;if ram<128{ram=2048}
 cpus:=base.CPUs;if cpus<1{cpus=2}
 nicModel:=base.NICModel;if nicModel==""{nicModel="e1000"}
 diskBus:=base.DiskBus;if diskBus==""{diskBus="ide"}
 nicCount:=base.NICCount;if nicCount<1{nicCount=2}
 node:=Node{ID:newID(),Name:disk.Name,Engine:"qemu",ImageID:id,Kind:kind,
  RAM:ram,CPUs:cpus,NICModel:nicModel,NICCount:nicCount,DiskBus:diskBus,
  PortStyle:base.PortStyle,Icon:base.Icon,X:250,Y:180,Status:"stopped"}
 if err:=validateNode(node);err!=nil{_ = os.Remove(final);fail(w,422,err.Error());return}
 lab:=Lab{ID:newID(),Name:"Подготовка · "+disk.Name,CreatedAt:time.Now(),Nodes:[]Node{node},Links:[]Link{},Annotations:[]Annotation{}}
 s.store.State.Images=append(s.store.State.Images,disk)
 s.store.State.Labs=append(s.store.State.Labs,lab)
 if err:=s.store.save();err!=nil{
  s.store.State.Images=s.store.State.Images[:len(s.store.State.Images)-1]
  s.store.State.Labs=s.store.State.Labs[:len(s.store.State.Labs)-1]
  _ = os.Remove(final)
  fail(w,500,err.Error());return
 }
 respond(w,201,map[string]any{"image":disk,"lab":lab,"node":node})
}

func (s *Server) workshopAPI(w http.ResponseWriter,r *http.Request,p []string){
 if len(p)==2 && p[1]=="revise" && r.Method==http.MethodPost {s.createWorkshopRevision(w,r);return}
 if len(p)!=2 ||p[1]!="publish" ||r.Method!=http.MethodPost {fail(w,404,"неизвестное действие мастерской");return}
 var req struct{LabID string `json:"labId"`;NodeID string `json:"nodeId"`;Name string `json:"name"`;Category string `json:"category"`;Family string `json:"family"`;Version string `json:"version"`}
 if !decode(w,r,&req){return}
 if !validID(req.LabID)||!validID(req.NodeID){fail(w,400,"неверный ID");return}
 if err:=validateImageMetadata(req.Name,req.Category,req.Family,req.Version);err!=nil{fail(w,400,err.Error());return}
 if strings.TrimSpace(req.Family)=="" || strings.TrimSpace(req.Version)=="" {
  fail(w,400,"для публикации укажите семейство и версию");return
 }
 if _,err:=exec.LookPath("qemu-img");err!=nil{fail(w,503,"требуется qemu-img");return}
 // Keep the state lock while converting. This deliberately serializes QEMU
 // start/stop with snapshot publishing, avoiding corruption from live writes.
 s.store.mu.Lock()
 defer s.store.mu.Unlock()
 lab:=s.store.findLab(req.LabID)
 if lab==nil{fail(w,404,"лаборатория не найдена");return}
 node:=findNode(lab,req.NodeID)
 if node==nil || node.Engine!="qemu"{fail(w,404,"QEMU узел не найден");return}
 // Only workshop preparation disks may become catalog templates.
 // Ordinary lab nodes must never be published accidentally.
 base:=findImage(&s.store.State,node.ImageID)
 if base==nil || base.isISO() || !base.Draft {
  fail(w,409,"можно публиковать только подготовительную VM с черновым диском");return
 }
 if catalogVersionConflict(s.store.State.Images,"",req.Category,req.Family,req.Version) {
  fail(w,409,"такая версия уже опубликована: укажите новую версию");return
 }
 status,_:=s.engine.Status(req.LabID,req.NodeID)
 if status!="stopped" {
  fail(w,409,"публикация доступна только после полной остановки VM");return
 }
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
 img:=Image{ID:id,Name:strings.TrimSpace(req.Name),Kind:"disk",Format:"qcow2",Category:req.Category,Family:strings.TrimSpace(req.Family),Version:strings.TrimSpace(req.Version),Published:true,RAM:node.RAM,CPUs:node.CPUs,NICModel:node.NICModel,NICCount:node.NICCount,DiskBus:node.DiskBus,PortStyle:node.PortStyle,Icon:node.Icon,Size:info.Size(),CreatedAt:time.Now()}
 s.store.State.Images=append(s.store.State.Images,img)
 if err:=s.store.save();err!=nil{
  s.store.State.Images=s.store.State.Images[:len(s.store.State.Images)-1]
  _ = os.Remove(final);fail(w,500,err.Error());return
 }
 respond(w,201,img)
}

func (s *Server) catalogTemplates() []map[string]any {
 result:=[]map[string]any{
  {"id":"generic","kind":"server","name":"Generic x86 QEMU","portStyle":"eth","ram":1024,"cpus":1,"nicModel":"virtio-net-pci","nicCount":4,"diskBus":"virtio"},
  {"id":"mikrotik-chr","kind":"router","name":"MikroTik CHR","portStyle":"ether","ram":256,"cpus":1,"nicModel":"e1000","nicCount":4,"diskBus":"ide"},
  {"id":"cisco-iosv","kind":"router","name":"Cisco IOSv","portStyle":"gi","ram":768,"cpus":1,"nicModel":"e1000","nicCount":4,"diskBus":"virtio"},
  {"id":"linux","kind":"pc","name":"Linux VM","portStyle":"eth","ram":2048,"cpus":2,"nicModel":"virtio-net-pci","nicCount":4,"diskBus":"virtio"},
  {"id":"vpcs","engine":"vpcs","kind":"pc","name":"VPCS","portStyle":"eth","ram":128,"cpus":1,"nicModel":"e1000","nicCount":1,"diskBus":"ide"},
 }
 s.store.mu.Lock()
 defer s.store.mu.Unlock()
 for _,img:=range s.store.State.Images {
  if !img.Published || img.isISO() || img.Draft {continue}
  kind:="server"
  switch img.Category {case "desktop":kind="pc";case "router","switch","firewall":kind=img.Category}
  name:=strings.TrimSpace(strings.TrimSpace(img.Family+" "+img.Version))
  if name=="" {name=img.Name}
  result=append(result,map[string]any{
    "id":"image:"+img.ID,"name":name,"engine":"qemu","kind":kind,
    "imageId":img.ID,"category":img.Category,"family":img.Family,"version":img.Version,
    "ram":img.RAM,"cpus":img.CPUs,"nicCount":img.NICCount,
    "nicModel":img.NICModel,"diskBus":img.DiskBus,"portStyle":img.PortStyle,"icon":img.Icon,
  })
 }
 return result
}
