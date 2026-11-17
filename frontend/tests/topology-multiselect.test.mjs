import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = name => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')
const canvas = read('../src/components/TopologyCanvas.vue')
const app = read('../src/App.vue')
const store = read('../src/stores/netlab.ts')

test('Vue Flow selection can feed actions for selected devices', () => {
  assert.match(canvas, /@selection-change="selectionChanged"/)
  assert.match(canvas, /event\.nodes\.map\(node=>node\.id\)/)
  assert.match(canvas, /emit\('bulk', \[\.\.\.selectedDevices\.value\]\)/)
  assert.match(app, /@bulk="openBulkFromCanvas"/)
  assert.match(app, /bulkSelected\.value=\[\.\.\.new Set\(ids\)\]\.filter\(id=>available\.has\(id\)\)/)
})
test('group drag persists all moved node positions through existing endpoints', () => {
  assert.match(canvas, /event\.nodes\?\.length\?event\.nodes:\[event\.node\]/)
  assert.match(canvas, /store\.moveTopologyItems\(dragged\.map/)
  assert.match(store, /async function moveTopologyItems\(/)
  assert.match(store, /new Map\(items\.map\(item=>\[item\.id,item\]\)\)/)
  assert.match(store, /labs\/\$\{lab\.id\}\/annotations\//)
  assert.match(store, /labs\/\$\{lab\.id\}\/nodes\//)
  assert.match(store, /await refresh\(\)\s*if\(errors\.length\)/)
})
test('toolbar matches legacy order without overlap-prone keyboard hint', () => {
  const names=['Выбор и перемещение','Перемещение полотна','Соединить устройства','Выделение рамкой','Добавить текст','Добавить примечание','Добавить устройство']
  const toolbar=canvas.slice(canvas.indexOf('class="canvas-tools"'),canvas.indexOf('class="canvas-scale"'))
  let previous=-1
  for(const name of names){
    const next=toolbar.indexOf('aria-label="'+name+'"')
    assert.ok(next>previous,name)
    previous=next
  }
  assert.doesNotMatch(canvas,/class="canvas-selection-hint"/)
})

test('left Ctrl and Meta click preserve selection across device hover updates', () => {
  assert.match(canvas, /:multi-selection-key-code="\['Control','Meta'\]"/)
  assert.match(canvas, /selected:selectedOnCanvas\.value\.includes\(device\.id\)/)
  assert.match(canvas, /selected:selectedOnCanvas\.value\.includes\(`annotation:\$\{annotation\.id\}`\)/)
  assert.match(canvas, /@selection-change="selectionChanged"/)
  assert.match(canvas, /selectedOnCanvas\.value=event\.nodes\.map\(node=>node\.id\)/)
})

test('device click keeps a visible selection border after mouse leaves', () => {
  const css=read('../src/styles/app.css')
  const device=read('../src/components/DeviceNode.vue')
  assert.match(canvas,/selected:selectedOnCanvas\.value\.includes\(device\.id\)/)
  assert.match(canvas,/selected:selectedOnCanvas\.value\.includes\(device\.id\)\}/)
  assert.match(device,/device-selected':data\.selected/)
  assert.match(css,/\.vue-flow__node-device\.selected \.device-node/)
  assert.match(css,/\.device-node\.device-selected/)
})
