import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const read=(path)=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),'utf8')
const canvas=read('../src/components/TopologyCanvas.vue')
const store=read('../src/stores/netlab.ts')
const snapshot=read('../src/topology/snapshot.ts')
const model=read('../src/types.ts')

test('annotation model retains the legacy API geometry and style fields',()=>{
  for(const field of ['kind','text','x','y','width','height','color','background','borderColor','borderWidth','fontSize','bold','italic','underline','align']){
    assert.match(model,new RegExp('\\b'+field+'\\b'))
  }
  assert.match(model,/annotations\?: Annotation\[\]/)
})
test('annotation CRUD uses the existing laboratory backend',()=>{
  assert.match(store,/method:'POST'.*body:json\(payload\)/)
  assert.match(store,/labs\/\$\{current\(\)\.id\}\/annotations/)
  assert.match(store,/method:'PATCH'.*body:json\(payload\)/)
  assert.match(store,/removeAnnotation\(id: string\)/)
})
test('annotation nodes are integrated with Vue Flow, dragging and editing',()=>{
  assert.match(canvas,/#node-annotation/)
  assert.match(canvas,/@node-double-click="doubleClick"/)
  assert.match(canvas,/event\.node\.id\.startsWith\('annotation:'\)/)
  assert.match(canvas,/store\.moveTopologyItems\(dragged\.map/)
  assert.match(store,/async function moveTopologyItems\(/)
  assert.match(store,/annotations\.get\(annotationID\)/)
  assert.match(canvas,/drawingMode\.value==='text'/)
  assert.match(canvas,/newAnnotation\(drawingMode\.value,screenToFlowCoordinate/)
  assert.match(canvas,/store\.removeAnnotation\(annotationID\.value\)/)
})
test('PNG snapshot draws annotations and includes them in bounds',()=>{
  assert.match(snapshot,/const annotations=lab\.annotations\|\|\[\]/)
  assert.match(snapshot,/annotations\.map\(a=>a\.x\+a\.width\)/)
  assert.match(snapshot,/annotations\.map\(a=>a\.y\+a\.height\)/)
  assert.match(snapshot,/for\(const annotation of annotations\) drawAnnotation\(ctx,annotation\)/)
})
