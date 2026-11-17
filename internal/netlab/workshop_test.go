package netlab

import (
 "bytes"
 "encoding/json"
 "io"
 "mime/multipart"
 "net/http/httptest"
 "os"
 "path/filepath"
 "strings"
 "testing"
)

func TestInstallerISOValidation(t *testing.T){
 path:=filepath.Join(t.TempDir(),"installer.iso")
 valid:=make([]byte,18*2048)
 copy(valid[16*2048+1:],[]byte("CD001"))
 if err:=os.WriteFile(path,valid,0600);err!=nil{t.Fatal(err)}
 if err:=validateInstallerISO(path);err!=nil{t.Fatalf("valid ISO: %v",err)}
 if err:=os.WriteFile(path,[]byte("not an ISO"),0600);err!=nil{t.Fatal(err)}
 if err:=validateInstallerISO(path);err==nil{t.Fatal("invalid ISO accepted")}
}
func uploadTestImage(t *testing.T,s *Server,filename string,payload []byte) (int,Image) {
 t.Helper()
 var buf bytes.Buffer
 form:=multipart.NewWriter(&buf)
 part,err:=form.CreateFormFile("file",filename);if err!=nil{t.Fatal(err)}
 if _,err=part.Write(payload);err!=nil{t.Fatal(err)}
 if err=form.Close();err!=nil{t.Fatal(err)}
 r:=httptest.NewRequest("POST","/api/images",&buf)
 r.Header.Set("Content-Type",form.FormDataContentType())
 r.Header.Set("Authorization","Bearer "+testToken)
 response:=httptest.NewRecorder();s.Handler().ServeHTTP(response,r)
 var image Image
 _=json.Unmarshal(response.Body.Bytes(),&image)
 return response.Code,image
}
func TestUploadISOAndRejectAsNodeDisk(t *testing.T){
 s:=newTestServer(t)
 valid:=make([]byte,18*2048);copy(valid[16*2048+1:],[]byte("CD001"))
 status,iso:=uploadTestImage(t,s,"WindowsServer.iso",valid)
 if status!=201||!iso.isISO()||iso.Format!="iso"{t.Fatalf("ISO upload: %d %+v",status,iso)}
 if _,err:=os.Stat(filepath.Join(s.data,"images",iso.ID+".iso"));err!=nil{t.Fatal(err)}
 status,_=uploadTestImage(t,s,"bad.iso",[]byte("not an installer"))
 if status!=422{t.Fatalf("bad ISO upload %d, want 422",status)}
 node:=Node{Name:"Invalid ISO disk",ImageID:iso.ID,Engine:"qemu",Kind:"server",RAM:512,CPUs:1,NICModel:"e1000",NICCount:2,DiskBus:"ide"}
 s.store.mu.Lock();validMedia:=s.validNodeMedia(node);s.store.mu.Unlock()
 if validMedia{t.Fatal("installer may not be used as system disk")}
}
func TestWorkshopBlankDiskAndPublishVersion(t *testing.T){
 temp:=t.TempDir()
 bin:=filepath.Join(temp,"qemu-img")
 script:="#!/bin/sh\nif [ \"$1\" = create ]; then printf 'base disk' > \"$4\"; elif [ \"$1\" = convert ]; then cp \"$6\" \"$7\"; else exit 2; fi\n"
 if err:=os.WriteFile(bin,[]byte(script),0755);err!=nil{t.Fatal(err)}
 t.Setenv("PATH",temp+string(os.PathListSeparator)+os.Getenv("PATH"))
 s:=newTestServer(t)
 status,body:=httpCall(t,s,"POST","/api/images/blank",[]byte(`{"name":"Preparation","sizeGiB":32}`),true)
 assertStatus(t,status,201,body)
 var base Image
 if err:=json.Unmarshal(body,&base);err!=nil{t.Fatal(err)}
 if base.Format!="qcow2"||!base.Draft||base.isISO(){t.Fatalf("blank disk metadata: %+v",base)}
 lab:=Lab{ID:newID(),Name:"Preparation",Nodes:[]Node{},Links:[]Link{}}
 node:=Node{ID:newID(),Name:"Install VM",Kind:"server",Engine:"qemu",ImageID:base.ID,RAM:2048,CPUs:2,NICModel:"e1000",NICCount:2,DiskBus:"ide"}
 lab.Nodes=append(lab.Nodes,node)
 s.store.mu.Lock();s.store.State.Labs=append(s.store.State.Labs,lab);s.store.mu.Unlock()
 overlay:=filepath.Join(s.data,"runtime",lab.ID,node.ID,"disk.qcow2")
 if err:=os.MkdirAll(filepath.Dir(overlay),0750);err!=nil{t.Fatal(err)}
 if err:=os.WriteFile(overlay,[]byte("installed system"),0640);err!=nil{t.Fatal(err)}
 payload:=[]byte(`{"labId":"`+lab.ID+`","nodeId":"`+node.ID+`","name":"Windows Server 2022","category":"server","family":"Windows Server","version":"2022"}`)
 status,body=httpCall(t,s,"POST","/api/workshop/publish",payload,true)
 assertStatus(t,status,201,body)
 var image Image
 if err:=json.Unmarshal(body,&image);err!=nil{t.Fatal(err)}
 if !image.Published||image.Draft||image.Category!="server"||image.Version!="2022"{t.Fatalf("published image metadata: %+v",image)}
 disk,err:=os.Open(filepath.Join(s.data,"images",image.ID+".qcow2"))
 if err!=nil{t.Fatal(err)}
 data,err:=io.ReadAll(disk);_ = disk.Close()
 if err!=nil||string(data)!="installed system"{t.Fatalf("flattened disk: %q, %v",data,err)}
 status,body=httpCall(t,s,"GET","/api/templates",nil,true)
 assertStatus(t,status,200,body)
 if !strings.Contains(string(body),"image:"+image.ID)||!strings.Contains(string(body),"Windows Server 2022"){t.Fatalf("published template not listed: %s",body)}
 status,body=httpCall(t,s,"POST","/api/workshop/publish",payload,true)
 if status!=409 {t.Fatalf("duplicate published version accepted: %d %s",status,body)}
 // A new version is an independent revision with its own image ID.
 nextPayload:=[]byte(`{"labId":"`+lab.ID+`","nodeId":"`+node.ID+`","name":"Windows Server 2025","category":"server","family":"Windows Server","version":"2025"}`)
 status,body=httpCall(t,s,"POST","/api/workshop/publish",nextPayload,true)
 assertStatus(t,status,201,body)
 var revision Image
 if err:=json.Unmarshal(body,&revision);err!=nil{t.Fatal(err)}
 if revision.ID==image.ID {t.Fatal("new revision reused base image ID")}
 update:=[]byte(`{"name":"Windows Server","category":"server","family":"Windows Server","version":"2022"}`)
 status,body=httpCall(t,s,"PATCH","/api/images/"+revision.ID,update,true)
 if status!=409 {t.Fatalf("conflicting version metadata accepted: %d %s",status,body)}
 status,body=httpCall(t,s,"PATCH","/api/images/"+image.ID,update,true)
 assertStatus(t,status,200,body)
 status,body=httpCall(t,s,"DELETE","/api/images/"+base.ID,nil,true)
 if status!=409{t.Fatalf("in-use preparation image deleted: %d %s",status,body)}
}
func TestPublishRejectsActiveVMAndMissingOverlay(t *testing.T){
 s:=newTestServer(t)
 lab:=Lab{ID:newID(),Name:"L",Nodes:[]Node{{ID:newID(),Name:"Node",Engine:"qemu"}},Links:[]Link{}}
 s.store.mu.Lock();s.store.State.Labs=append(s.store.State.Labs,lab);s.store.mu.Unlock()
 payload:=[]byte(`{"labId":"`+lab.ID+`","nodeId":"`+lab.Nodes[0].ID+`","name":"Template","category":"server","family":"Linux","version":"13"}`)
 status,_:=httpCall(t,s,"POST","/api/workshop/publish",payload,true)
 // If qemu-img is installed, absent overlay is 409. Otherwise 503 is expected.
 if status!=409&&status!=503{t.Fatalf("unexpected response %d",status)}
}

func TestPublishOnlyStoppedWorkshopDraft(t *testing.T) {
 binDir:=t.TempDir()
 bin:=filepath.Join(binDir,"qemu-img")
 if err:=os.WriteFile(bin,[]byte("#!/bin/sh\nexit 0\n"),0755);err!=nil{t.Fatal(err)}
 t.Setenv("PATH",binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
 s:=newTestServer(t)
 regular:=Image{ID:newID(),Name:"Existing VM",Kind:"disk",Format:"qcow2"}
 draft:=Image{ID:newID(),Name:"Preparation",Kind:"disk",Format:"qcow2",Draft:true}
 lab:=Lab{ID:newID(),Name:"Lab",Nodes:[]Node{
  {ID:newID(),Name:"Ordinary",Engine:"qemu",ImageID:regular.ID},
  {ID:newID(),Name:"Workshop",Engine:"qemu",ImageID:draft.ID},
 },Links:[]Link{}}
 s.store.mu.Lock()
 s.store.State.Images=append(s.store.State.Images,regular,draft)
 s.store.State.Labs=append(s.store.State.Labs,lab)
 s.store.mu.Unlock()
 payload:=func(nodeID string)[]byte{
  return []byte(`{"labId":"`+lab.ID+`","nodeId":"`+nodeID+`","name":"Template","category":"server","family":"Linux","version":"13"}`)
 }
 status,body:=httpCall(t,s,"POST","/api/workshop/publish",payload(lab.Nodes[0].ID),true)
 if status!=409||!strings.Contains(string(body),"черновым"){t.Fatalf("ordinary VM accepted: %d %s",status,body)}
 s.engine.mu.Lock()
 s.engine.instances[key(lab.ID,lab.Nodes[1].ID)]=&Instance{status:"running"}
 s.engine.mu.Unlock()
 status,body=httpCall(t,s,"POST","/api/workshop/publish",payload(lab.Nodes[1].ID),true)
 if status!=409||!strings.Contains(string(body),"остановки"){t.Fatalf("running draft accepted: %d %s",status,body)}
 s.engine.mu.Lock()
 s.engine.instances[key(lab.ID,lab.Nodes[1].ID)].status="error"
 s.engine.mu.Unlock()
 status,body=httpCall(t,s,"POST","/api/workshop/publish",payload(lab.Nodes[1].ID),true)
 if status!=409{t.Fatalf("failed VM accepted: %d %s",status,body)}
}

func TestDeleteImageRollsBackOnStateSaveFailure(t *testing.T) {
 s:=newTestServer(t)
 id:=newID()
 image:=Image{ID:id,Name:"Unused",Format:"qcow2",Kind:"disk"}
 path:=filepath.Join(s.data,"images",id+".qcow2")
 if err:=os.WriteFile(path,[]byte("base disk"),0600);err!=nil{t.Fatal(err)}
 s.store.mu.Lock()
 s.store.State.Images=append(s.store.State.Images,image)
 if err:=s.store.save();err!=nil{t.Fatal(err)}
 originalStatePath:=s.store.path
 blockedPath:=filepath.Join(s.data,"blocked-state")
 if err:=os.MkdirAll(blockedPath,0750);err!=nil{t.Fatal(err)}
 s.store.path=blockedPath // atomic rename to an existing directory fails
 s.store.mu.Unlock()
 code,body:=httpCall(t,s,"DELETE","/api/images/"+id,nil,true)
 if code!=500 {t.Fatalf("expected save error, got %d %s",code,body)}
 if data,err:=os.ReadFile(path);err!=nil||string(data)!="base disk"{t.Fatalf("image lost after rollback: %q %v",data,err)}
 if _,err:=os.Stat(path+".deleting");!os.IsNotExist(err){t.Fatalf("staged file remains: %v",err)}
 s.store.mu.Lock()
 if findImage(&s.store.State,id)==nil{t.Fatal("image disappeared from in-memory state")}
 s.store.path=originalStatePath
 s.store.mu.Unlock()
 code,body=httpCall(t,s,"DELETE","/api/images/"+id,nil,true)
 assertStatus(t,code,200,body)
 if _,err:=os.Stat(path);!os.IsNotExist(err){t.Fatalf("deleted file still present: %v",err)}
 if _,err:=os.Stat(path+".deleting");!os.IsNotExist(err){t.Fatalf("staged file still present: %v",err)}
}

func TestRecoverInterruptedImageDeletionOnStartup(t *testing.T) {
 s:=newTestServer(t)
 id:=newID()
 image:=Image{ID:id,Name:"Recoverable",Format:"qcow2",Kind:"disk"}
 path:=filepath.Join(s.data,"images",id+".qcow2")
 s.store.mu.Lock()
 s.store.State.Images=append(s.store.State.Images,image)
 if err:=s.store.save();err!=nil{t.Fatal(err)}
 s.store.mu.Unlock()
 if err:=os.WriteFile(path,[]byte("recoverable disk"),0600);err!=nil{t.Fatal(err)}
 if err:=os.Rename(path,path+".deleting");err!=nil{t.Fatal(err)}
 recovered,err:=NewServer(s.data,s.web,testToken)
 if err!=nil{t.Fatal(err)}
 if recovered==nil{t.Fatal("missing recovered server")}
 data,err:=os.ReadFile(path)
 if err!=nil||string(data)!="recoverable disk"{t.Fatalf("image was not recovered: %q %v",data,err)}
 if _,err:=os.Stat(path+".deleting");!os.IsNotExist(err){t.Fatalf("tombstone not cleared: %v",err)}
}

func TestWorkshopRevisionFromPublishedImage(t *testing.T) {
 temp:=t.TempDir()
 bin:=filepath.Join(temp,"qemu-img")
 script:="#!/bin/sh\nif [ \"$1\" = convert ]; then cp \"$6\" \"$7\"; else exit 2; fi\n"
 if err:=os.WriteFile(bin,[]byte(script),0755);err!=nil{t.Fatal(err)}
 t.Setenv("PATH",temp+string(os.PathListSeparator)+os.Getenv("PATH"))
 s:=newTestServer(t)
 base:=Image{ID:newID(),Name:"Debian 13",Kind:"disk",Format:"qcow2",Published:true,Category:"server",Family:"Debian",Version:"13",RAM:2048,CPUs:2,NICModel:"e1000",NICCount:2,DiskBus:"ide"}
 original:=filepath.Join(s.data,"images",base.ID+".qcow2")
 if err:=os.WriteFile(original,[]byte("published base contents"),0600);err!=nil{t.Fatal(err)}
 s.store.mu.Lock()
 s.store.State.Images=append(s.store.State.Images,base)
 if err:=s.store.save();err!=nil{t.Fatal(err)}
 s.store.mu.Unlock()
 payload:=[]byte(`{"imageId":"`+base.ID+`","name":"Debian 13.1","version":"13.1"}`)
 status,body:=httpCall(t,s,"POST","/api/workshop/revise",payload,true)
 assertStatus(t,status,201,body)
 var result struct{ Image Image `json:"image"`; Lab Lab `json:"lab"`; Node Node `json:"node"` }
 if err:=json.Unmarshal(body,&result);err!=nil{t.Fatal(err)}
 if !result.Image.Draft||result.Image.Published||result.Image.ID==base.ID||result.Image.Version!="13.1"{t.Fatalf("invalid new draft: %+v",result.Image)}
 if len(result.Lab.Nodes)!=1||result.Node.ID!=result.Lab.Nodes[0].ID||result.Node.ImageID!=result.Image.ID||result.Node.Engine!="qemu"||result.Node.InstallISOID!=""{t.Fatalf("invalid revision lab: %+v %+v",result.Lab,result.Node)}
 copied,err:=os.ReadFile(filepath.Join(s.data,"images",result.Image.ID+".qcow2"))
 if err!=nil||string(copied)!="published base contents"{t.Fatalf("new QCOW2 not independent: %q %v",copied,err)}
 source,err:=os.ReadFile(original)
 if err!=nil||string(source)!="published base contents"{t.Fatalf("original changed: %q %v",source,err)}
 status,body=httpCall(t,s,"POST","/api/workshop/revise",[]byte(`{"imageId":"`+base.ID+`","name":"Duplicate","version":"13"}`),true)
 if status!=409 {t.Fatalf("existing published version accepted: %d %s",status,body)}
 status,body=httpCall(t,s,"POST","/api/workshop/revise",[]byte(`{"imageId":"`+result.Image.ID+`","name":"Invalid","version":"14"}`),true)
 if status!=409 {t.Fatalf("non-published draft accepted: %d %s",status,body)}
 iso:=Image{ID:newID(),Name:"Installer",Format:"iso",Kind:"iso",Published:true}
 s.store.mu.Lock()
 s.store.State.Images=append(s.store.State.Images,iso)
 s.store.mu.Unlock()
 status,body=httpCall(t,s,"POST","/api/workshop/revise",[]byte(`{"imageId":"`+iso.ID+`","name":"Invalid ISO","version":"14"}`),true)
 if status!=409 {t.Fatalf("ISO accepted as revision base: %d %s",status,body)}
}
func TestWorkshopRevisionRestoresStateOnSaveFailure(t *testing.T) {
 temp:=t.TempDir()
 bin:=filepath.Join(temp,"qemu-img")
 if err:=os.WriteFile(bin,[]byte("#!/bin/sh\ncp \"$6\" \"$7\"\n"),0755);err!=nil{t.Fatal(err)}
 t.Setenv("PATH",temp+string(os.PathListSeparator)+os.Getenv("PATH"))
 s:=newTestServer(t)
 base:=Image{ID:newID(),Name:"Linux",Format:"qcow2",Kind:"disk",Published:true,Category:"server",Family:"Linux",Version:"1"}
 if err:=os.WriteFile(filepath.Join(s.data,"images",base.ID+".qcow2"),[]byte("base"),0600);err!=nil{t.Fatal(err)}
 s.store.mu.Lock()
 s.store.State.Images=append(s.store.State.Images,base)
 oldStatePath:=s.store.path
 blocked:=filepath.Join(s.data,"blocked-state")
 if err:=os.MkdirAll(blocked,0750);err!=nil{t.Fatal(err)}
 s.store.path=blocked
 s.store.mu.Unlock()
 status,body:=httpCall(t,s,"POST","/api/workshop/revise",[]byte(`{"imageId":"`+base.ID+`","name":"Linux 2","version":"2"}`),true)
 if status!=500 {t.Fatalf("expected save failure: %d %s",status,body)}
 s.store.mu.Lock()
 if len(s.store.State.Images)!=1||len(s.store.State.Labs)!=0{t.Fatalf("state leaked after failure: %+v",s.store.State)}
 s.store.path=oldStatePath
 s.store.mu.Unlock()
 images,err:=os.ReadDir(filepath.Join(s.data,"images"))
 if err!=nil{t.Fatal(err)}
 if len(images)!=1||images[0].Name()!=base.ID+".qcow2"{t.Fatalf("orphaned disk after rollback: %+v",images)}
}


func TestPreparationMediaSwitchAndISOEject(t *testing.T) {
 s:=newTestServer(t)
 disk:=Image{ID:newID(),Name:"System",Format:"qcow2",Kind:"disk",Draft:true}
 iso:=Image{ID:newID(),Name:"Installer",Format:"iso",Kind:"iso"}
 lab:=Lab{ID:newID(),Name:"Preparation",Nodes:[]Node{{
  ID:newID(),Name:"Install VM",Engine:"qemu",ImageID:disk.ID,InstallISOID:iso.ID,
  RAM:2048,CPUs:2,NICModel:"e1000",NICCount:2,DiskBus:"ide",
 }},Links:[]Link{}}
 s.store.mu.Lock()
 s.store.State.Images=append(s.store.State.Images,disk,iso)
 s.store.State.Labs=append(s.store.State.Labs,lab)
 if err:=s.store.save();err!=nil{t.Fatal(err)}
 s.store.mu.Unlock()
 url:="/api/labs/"+lab.ID+"/nodes/"+lab.Nodes[0].ID+"/media"
 code,body:=httpCall(t,s,"PATCH",url,[]byte(`{"installISOId":"`+iso.ID+`","bootOrder":"disk"}`),true)
 assertStatus(t,code,200,body)
 var changed Node
 if err:=json.Unmarshal(body,&changed);err!=nil{t.Fatal(err)}
 if changed.BootOrder!="disk"||changed.InstallISOID!=iso.ID{t.Fatalf("disk boot failed: %+v",changed)}
 code,body=httpCall(t,s,"PATCH",url,[]byte(`{"installISOId":"","bootOrder":"disk"}`),true)
 assertStatus(t,code,200,body)
 s.store.mu.Lock()
 node:=findNode(&s.store.State.Labs[0],lab.Nodes[0].ID)
 if node==nil||node.InstallISOID!=""||node.ImageID!=disk.ID||node.BootOrder!="disk" {
  t.Fatalf("eject damaged disk or media settings: %+v",node)
 }
 s.store.mu.Unlock()
 code,body=httpCall(t,s,"PATCH",url,[]byte(`{"installISOId":"`+iso.ID+`","bootOrder":"cdrom"}`),true)
 assertStatus(t,code,200,body)
 code,body=httpCall(t,s,"PATCH",url,[]byte(`{"installISOId":"bad","bootOrder":"cdrom"}`),true)
 assertStatus(t,code,400,body)
 code,body=httpCall(t,s,"PATCH",url,[]byte(`{"installISOId":"","bootOrder":"network"}`),true)
 assertStatus(t,code,400,body)
 code,body=httpCall(t,s,"PATCH",url,[]byte(`{"installISOId":"","bootOrder":"disk","imageId":"malicious"}`),true)
 assertStatus(t,code,200,body)
 // Only media fields are applied: a forged imageId must not replace the disk.
 s.store.mu.Lock()
 if findNode(&s.store.State.Labs[0],lab.Nodes[0].ID).ImageID!=disk.ID{t.Fatal("media API changed system disk")}
 s.store.mu.Unlock()
 s.engine.mu.Lock()
 s.engine.instances[key(lab.ID,lab.Nodes[0].ID)]=&Instance{status:"running"}
 s.engine.mu.Unlock()
 code,body=httpCall(t,s,"PATCH",url,[]byte(`{"installISOId":"`+iso.ID+`","bootOrder":"cdrom"}`),true)
 assertStatus(t,code,409,body)
}

func TestPreparationMediaSaveRollback(t *testing.T) {
 s:=newTestServer(t)
 disk:=Image{ID:newID(),Name:"Disk",Format:"qcow2"}
 iso:=Image{ID:newID(),Name:"ISO",Format:"iso",Kind:"iso"}
 lab:=Lab{ID:newID(),Name:"Lab",Nodes:[]Node{{
  ID:newID(),Name:"VM",Engine:"qemu",ImageID:disk.ID,InstallISOID:iso.ID,
  RAM:1024,CPUs:1,NICModel:"e1000",NICCount:1,DiskBus:"ide",
 }},Links:[]Link{}}
 s.store.mu.Lock()
 s.store.State.Images=append(s.store.State.Images,disk,iso)
 s.store.State.Labs=append(s.store.State.Labs,lab)
 old:=s.store.path
 blocked:=filepath.Join(s.data,"blocked-state")
 if err:=os.MkdirAll(blocked,0750);err!=nil{t.Fatal(err)}
 s.store.path=blocked
 s.store.mu.Unlock()
 url:="/api/labs/"+lab.ID+"/nodes/"+lab.Nodes[0].ID+"/media"
 code,body:=httpCall(t,s,"PATCH",url,[]byte(`{"installISOId":"","bootOrder":"disk"}`),true)
 assertStatus(t,code,500,body)
 s.store.mu.Lock()
 node:=findNode(&s.store.State.Labs[0],lab.Nodes[0].ID)
 if node==nil||node.InstallISOID!=iso.ID||node.BootOrder!=""{t.Fatalf("rollback failed: %+v",node)}
 s.store.path=old
 s.store.mu.Unlock()
}
