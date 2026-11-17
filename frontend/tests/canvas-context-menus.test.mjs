import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const read=path=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),'utf8')
const canvas=read('../src/components/TopologyCanvas.vue')
const edge=read('../src/components/CableEdge.vue')
const app=read('../src/App.vue')
test('right click on blank canvas exposes actions at mouse world position',()=>{
  assert.match(canvas,/@pane-context-menu="openPaneContext"/)
  assert.match(canvas,/screenToFlowCoordinate\(\{x:event.clientX,y:event.clientY\}\)/)
  assert.match(canvas,/emit\('add-at'/)
  assert.match(app,/@add-at="openAddAt"/)
  assert.match(app,/requestedNodePosition.value/)
  assert.match(canvas,/contextAddAnnotation\('text'\)/)
  assert.match(canvas,/contextAddAnnotation\('note'\)/)
  assert.match(canvas,/contextFit/)
})
test('right click on selected nodes offers safe group actions and auto align',()=>{
  assert.match(canvas,/kind:selectedDevices.value.length>1\?'selection':'pane'/)
  assert.match(canvas,/selectedDevices.value.includes\(payload.id\)/)
  assert.match(canvas,/store.bulkNodes\(ids,operation\)/)
  assert.match(canvas,/store.moveTopologyItems\(devices.map/)
  assert.match(canvas,/operation==='delete'&&!confirm/)
})
test('Ethernet right click opens cable editor or disconnect via backend',()=>{
  assert.match(edge,/onContext\?:/)
  assert.match(edge,/@contextmenu="context"/)
  assert.match(canvas,/onContext:openCableContext/)
  assert.match(canvas,/contextEditCable/)
  assert.match(canvas,/store.disconnect\(id\)/)
})
test('device context menu exposes cable creation and real QEMU VPCS log API',()=>{
  assert.match(canvas,/startCableFromContext/)
  assert.match(canvas,/runDeviceContextAction\('log'\)/)
  assert.match(app,/case 'log': await showDeviceLog\(device\)/)
  assert.match(app,/nodes\/\$\{device.id\}\/log/)
  assert.match(app,/deviceLogOutput.value=response.output/)
})
