import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
const canvas=readFileSync(fileURLToPath(new URL('../src/components/TopologyCanvas.vue',import.meta.url)),'utf8')
test('N note tool supports rectangle gesture in world coordinates',()=>{
  assert.match(canvas,/@pointerdown\.capture="onCanvasPointerDown\(\$event\);startAnnotationGesture\(\$event\)"/)
  assert.match(canvas,/drawingMode\.value!=='note'/)
  assert.match(canvas,/window\.addEventListener\('pointermove',updateAnnotationGesture\)/)
  assert.match(canvas,/window\.addEventListener\('pointerup',finishAnnotationGesture\)/)
  assert.match(canvas,/screenToFlowCoordinate\(\{x:noteGesture\.startX,y:noteGesture\.startY\}\)/)
  assert.match(canvas,/annotationDraft\.value\.width=Math\.max\(160/)
  assert.match(canvas,/annotationDraft\.value\.height=Math\.max\(80/)
  assert.match(canvas,/pointercancel',cancelAnnotationGesture/)
  assert.match(canvas,/class="canvas-annotation-preview"/)
})
