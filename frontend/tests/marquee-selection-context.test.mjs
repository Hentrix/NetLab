import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
const read=p=>readFileSync(fileURLToPath(new URL(p,import.meta.url)),'utf8')
const canvas=read('../src/components/TopologyCanvas.vue')
const css=read('../src/styles/app.css')
test('M marquee selects by geometry and persists all IDs before right click',()=>{
  assert.match(canvas,/function finishMarquee\(event:PointerEvent\)/)
  assert.match(canvas,/screenToFlowCoordinate\(\{x:gesture\.startX,y:gesture\.startY\}\)/)
  assert.match(canvas,/const devices=\(current\.value\?\.nodes\|\|\[\]\)\.filter/)
  assert.match(canvas,/store\.selectDeviceGroup\(pickedDevices,pickedDevices\.at\(-1\)\|\|null\)/)
  assert.match(canvas,/:selection-on-drag="!panMode&&drawingMode!=='marquee'"/)
  assert.match(canvas,/if\(event\.button===2&&store\.selectedDeviceIDs\.length>1\)event\.stopPropagation\(\)/)
  assert.match(canvas,/canvasContextMenu\.value=\{kind:selectedDevices\.value\.length>1\?'selection':'pane'/)
  assert.match(css,/\.canvas-marquee-preview/)
})
test('middle button pans through Vue Flow viewport directly without relying on browser autoscroll',()=>{
  assert.match(canvas,/function moveMiddlePan\(event:PointerEvent\)/)
  assert.match(canvas,/void setViewport\(\{x:g\.viewportX\+event\.clientX-g\.x,y:g\.viewportY\+event\.clientY-g\.y,zoom:g\.zoom\}\)/)
  assert.match(canvas,/window\.addEventListener\('pointercancel',stopMiddlePan\)/)
  assert.match(canvas,/@pointerdown\.capture="onCanvasPointerDown\(\$event\);startAnnotationGesture\(\$event\)"/)
})
