import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const read=(path)=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),'utf8')
const canvas=read('../src/components/TopologyCanvas.vue')
const node=read('../src/components/DeviceNode.vue')
const app=read('../src/App.vue')

test('right click on device opens only its own Vue Flow menu',()=>{
  assert.match(node,/@contextmenu="openContext"/)
  assert.match(node,/event\.preventDefault\(\)/)
  assert.match(node,/emit\('device-context',\{id:props\.data\.device\.id,event\}\)/)
  assert.match(canvas,/@device-context="openDeviceContext"/)
  assert.match(canvas,/store\.selectDeviceGroup\(\[payload\.id\],payload\.id\)/)
  assert.match(canvas,/closeDeviceContext\(\)/)
  assert.match(canvas,/dismissContextMenu\(\)/)
})
test('context actions use existing App handlers for the exact device ID',()=>{
  assert.match(canvas,/emit\('device-action',\{id:item\.id,action\}\)/)
  assert.match(app,/@device-action="deviceContextAction"/)
  assert.match(app,/store\.activeLab\?\.nodes\.find\(node=>node\.id===payload\.id\)/)
  for(const action of ['console','start','stop','rename','hardware','ports','icon','delete'])
    assert.match(canvas,new RegExp("runDeviceContextAction\\('"+action+"'\\)"))
  assert.match(app,/case 'console': consoleOpen\(device\)/)
  assert.match(app,/case 'hardware': editHardware\(device\)/)
  assert.match(app,/case 'ports': editPorts\(device\)/)
  assert.match(app,/case 'delete': await deleteNode\(device\)/)
})
test('unsafe deletion and irrelevant QEMU settings are guarded',()=>{
  assert.match(canvas,/:disabled="labHasRunningDevices"/)
  assert.match(canvas,/contextDevice\.engine!=='vpcs'/)
  assert.match(canvas,/contextDevice\.status!=='running'/)
  assert.match(canvas,/event\.key==='Escape'/)
})
