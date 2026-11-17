package netlab

import (
 "os"
 "path/filepath"
 "strings"
 "testing"
)

func overlayMockQEMU(t *testing.T) {
 t.Helper()
 bin := filepath.Join(t.TempDir(), "qemu-img")
 script := `#!/bin/sh
case "$1" in
 create)
   printf '%s' "$7" > "$8" || exit 1
   if [ "${NETLAB_TEST_CREATE_FAIL:-}" = "1" ]; then exit 12; fi
   ;;
 info)
   backing=$(sed -n "1p" "$3") || exit 1
   printf '{"format":"qcow2","backing-filename":"%s"}\n' "$backing"
   ;;
 *) exit 2 ;;
esac
`
 if err:=os.WriteFile(bin,[]byte(script),0755);err!=nil{t.Fatal(err)}
 t.Setenv("PATH",filepath.Dir(bin)+string(os.PathListSeparator)+os.Getenv("PATH"))
}

func TestNodeOverlayIsolatedAndPreservedAcrossRestart(t *testing.T) {
 overlayMockQEMU(t)
 root:=t.TempDir()
 base:=filepath.Join(root,"published.qcow2")
 if err:=os.WriteFile(base,[]byte("base"),0600);err!=nil{t.Fatal(err)}
 first:=filepath.Join(root,"lab-a","disk.qcow2")
 second:=filepath.Join(root,"lab-b","disk.qcow2")
 for _,overlay:=range []string{first,second} {
  if err:=os.MkdirAll(filepath.Dir(overlay),0750);err!=nil{t.Fatal(err)}
  if err:=ensureNodeOverlay(overlay,base,"qcow2",os.Getuid(),os.Getgid());err!=nil{t.Fatal(err)}
  if _,err:=os.Stat(overlay+".creating");!os.IsNotExist(err){t.Fatalf("creation temp left behind: %v",err)}
 }
 if first==second{t.Fatal("overlays not isolated")}
 // Simulate a guest modifying its own writable disk; a restart must not
 // discard the data and the second VM must retain an independent overlay.
 if err:=os.WriteFile(first,[]byte(base+"\nguest changes"),0600);err!=nil{t.Fatal(err)}
 if err:=ensureNodeOverlay(first,base,"qcow2",os.Getuid(),os.Getgid());err!=nil{t.Fatal(err)}
 stored,err:=os.ReadFile(first)
 if err!=nil||!strings.Contains(string(stored),"guest changes"){t.Fatalf("guest changes lost: %q %v",stored,err)}
 other,err:=os.ReadFile(second)
 if err!=nil||strings.Contains(string(other),"guest changes"){t.Fatalf("other node modified: %q %v",other,err)}
 original,err:=os.ReadFile(base)
 if err!=nil||string(original)!="base"{t.Fatalf("shared template modified: %q %v",original,err)}
}

func TestNodeOverlayFailedCreateIsNotReused(t *testing.T) {
 overlayMockQEMU(t)
 dir:=t.TempDir()
 base:=filepath.Join(dir,"base.qcow2")
 overlay:=filepath.Join(dir,"disk.qcow2")
 t.Setenv("NETLAB_TEST_CREATE_FAIL","1")
 if err:=ensureNodeOverlay(overlay,base,"qcow2",os.Getuid(),os.Getgid());err==nil{t.Fatal("failed create accepted")}
 for _,path:=range []string{overlay,overlay+".creating"}{
  if _,err:=os.Lstat(path);!os.IsNotExist(err){t.Fatalf("left broken overlay %s: %v",path,err)}
 }
 t.Setenv("NETLAB_TEST_CREATE_FAIL","0")
 if err:=ensureNodeOverlay(overlay,base,"qcow2",os.Getuid(),os.Getgid());err!=nil{t.Fatalf("retry failed: %v",err)}
}

func TestNodeOverlayRefusesOtherBackingAndSymlinks(t *testing.T) {
 overlayMockQEMU(t)
 dir:=t.TempDir()
 base:=filepath.Join(dir,"expected.qcow2")
 other:=filepath.Join(dir,"other.qcow2")
 overlay:=filepath.Join(dir,"disk.qcow2")
 if err:=os.WriteFile(overlay,[]byte(other),0600);err!=nil{t.Fatal(err)}
 if err:=ensureNodeOverlay(overlay,base,"qcow2",os.Getuid(),os.Getgid());err==nil{t.Fatal("wrong backing accepted")}
 kept,err:=os.ReadFile(overlay)
 if err!=nil||string(kept)!=other{t.Fatalf("overlay overwritten on rejection: %q %v",kept,err)}
 if err:=os.Remove(overlay);err!=nil{t.Fatal(err)}
 if err:=os.Symlink(other,overlay);err!=nil{t.Fatal(err)}
 if err:=ensureNodeOverlay(overlay,base,"qcow2",os.Getuid(),os.Getgid());err==nil{t.Fatal("symlink overlay accepted")}
}
