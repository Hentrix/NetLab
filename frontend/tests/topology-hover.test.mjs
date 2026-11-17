import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
const read=path=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),'utf8')
const canvas=read('../src/components/TopologyCanvas.vue')
const edge=read('../src/components/CableEdge.vue')
const device=read('../src/components/DeviceNode.vue')
const css=read('../src/styles/app.css')

test('hover over cable highlights cable, attached devices and both port labels',()=>{
  assert.match(edge,/onHover\?:/)
  assert.match(edge,/@mouseenter="hover\(\$event,true\)"/)
  assert.match(edge,/@mouseleave="hover\(\$event,false\)"/)
  assert.match(edge,/data\?\.emphasized/)
  assert.match(edge,/port-label-active/)
  assert.match(canvas,/const connectedHoverDevices=computed/)
  assert.match(canvas,/result\.add\(link\.a\);result\.add\(link\.b\)/)
  assert.match(canvas,/onHover:hoverCable/)
  assert.match(canvas,/connected:connectedHoverDevices\.value\.has\(device\.id\)/)
})
test('hover over device highlights its links and shows contextual tooltip',()=>{
  assert.match(device,/@mouseenter="deviceHover\(\$event,true\)"/)
  assert.match(device,/@mouseleave="deviceHover\(\$event,false\)"/)
  assert.match(device,/:class="\{[^"]*device-hovered/)
  assert.match(canvas,/@device-hover="hoverDevice"/)
  assert.match(canvas,/related:hoveredDeviceID\.value===link\.a\|\|hoveredDeviceID\.value===link\.b/)
  assert.match(canvas,/role="status" :style=/)
  assert.match(css,/\.topology-hover-tip/)
  assert.match(css,/\.device-node\.device-connected-hover/)
})
