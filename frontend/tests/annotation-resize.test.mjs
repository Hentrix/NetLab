import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const read=path=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),'utf8')
const component=read('../src/components/AnnotationNode.vue')
const canvas=read('../src/components/TopologyCanvas.vue')
const geometry=read('../src/topology/annotation-geometry.ts')

test('annotation exposes eight drag-safe resize handles',()=>{
  assert.match(component,/\['n','ne','e','se','s','sw','w','nw'\]/)
  assert.match(component,/class="annotation-handle nodrag nopan"/)
  assert.match(component,/@pointerdown\.stop\.prevent="resizeStart\(side,\$event\)"/)
})
test('resize tracks zoom and commits once after pointer release',()=>{
  assert.match(canvas,/viewport\.value\.zoom/)
  assert.match(canvas,/window\.addEventListener\('pointermove',resizeMove\)/)
  assert.match(canvas,/window\.addEventListener\('pointerup',resizeFinish\)/)
  assert.match(canvas,/window\.addEventListener\('pointercancel',resizeCancel\)/)
  assert.match(canvas,/async function resizeFinish/)
  assert.match(canvas,/store\.updateAnnotation\(original\.id,/)
  assert.match(geometry,/original\.x\+original\.width-width/)
  assert.match(geometry,/original\.y\+original\.height-height/)
  assert.match(geometry,/original\.kind==='note'\?144:96/)
  assert.match(geometry,/original\.kind==='note'\?58:36/)
})
test('annotation context menu and placement use the existing backend',()=>{
  assert.match(component,/@contextmenu="showMenu"/)
  assert.match(canvas,/role="menu" aria-label="Аннотация"/)
  assert.match(canvas,/contextDuplicate\(/)
  assert.match(canvas,/contextDelete\(/)
  assert.match(canvas,/screenToFlowCoordinate\(/)
  assert.match(canvas,/store\.createAnnotation\(\{\.\.\.draft,\.\.\.position\}\)/)
  assert.match(canvas,/store\.removeAnnotation\(item\.id\)/)
})
