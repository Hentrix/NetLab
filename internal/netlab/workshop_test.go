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
