import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
const read=path=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),'utf8')
const component=read('../src/components/AnnotationNode.vue')
const canvas=read('../src/components/TopologyCanvas.vue')
const css=read('../src/styles/app.css')
test('annotation shrinks rendered font until text fits, then enables scrolling',()=>{
  assert.match(component,/const MIN_FITTED_FONT=11/)
  assert.match(component,/element\.scrollHeight<=element\.clientHeight\+1/)
  assert.match(component,/element\.style\.overflowY=clipped\?'auto':'hidden'/)
  assert.match(component,/class="annotation-content nowheel"/)
  assert.match(component,/element\.style\.fontSize=font\+'px'/)
  assert.match(css,/\.topology-annotation \.annotation-content/)
})
test('editor supports transparent fill without discarding custom background',()=>{
  assert.match(canvas,/function setAnnotationTransparency\(value:boolean\)/)
  assert.match(canvas,/rememberedBackground\.value=color/)
  assert.match(canvas,/@change="setAnnotationTransparency/)
  assert.match(canvas,/:disabled="annotationDraft\.background==='transparent'"/)
  assert.match(canvas,/annotationDraft\.kind==='note'\?144:96/)
  assert.match(canvas,/annotationDraft\.kind==='note'\?58:36/)
})
