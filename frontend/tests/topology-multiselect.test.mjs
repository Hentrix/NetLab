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
test('topology keyboard hints document marquee and additive selection', () => {
  assert.match(canvas, /Shift \+ перетаскивание/)
  assert.match(canvas, /Ctrl\/Cmd \+ клик/)
})
