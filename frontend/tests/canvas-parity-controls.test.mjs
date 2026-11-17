import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
const read=path=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),'utf8')
const c=read('../src/components/TopologyCanvas.vue'),a=read('../src/App.vue')
test('legacy editor keyboard shortcuts remain isolated from form and console input',()=>{
 for(const key of ['KeyV','KeyH','KeyC','KeyM','KeyT','KeyN','Space','Delete'])
  assert.ok(c.includes(key),key)
 assert.match(c,/\.closest\('input,textarea,select,\[contenteditable="true"\],\.dialog-overlay,\.term-dock'\)/)
 assert.match(c,/window\.addEventListener\('keyup',onKeyRelease\)/)
 assert.match(c,/emit\('delete-selection'/)
})
test('device double click opens console and pane double click starts creation',()=>{
 assert.match(c,/function paneDoubleClick\(/)
 assert.match(c,/@pane-double-click="paneDoubleClick"/)
 assert.match(c,/if\(device&&device\.status==='running'\)emit\('console',device\)/)
})
test('sidebar device drag moves its node on canvas and inspector can collapse',()=>{
 assert.match(a,/@dragstart="onDeviceDrag\(\$event,node\)"/)
 assert.match(a,/setData\('application\/x-netlab-node'/)
 assert.match(c,/@drop="onCanvasDrop"/)
 assert.match(c,/store\.moveNode\(nodeID,x,y\)/)
 assert.match(a,/inspectorCollapsed=!inspectorCollapsed/)
})
