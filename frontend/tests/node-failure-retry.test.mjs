import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
const read=path=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),'utf8')
const app=read('../src/App.vue')
const device=read('../src/components/DeviceNode.vue')
const canvas=read('../src/components/TopologyCanvas.vue')
const store=read('../src/stores/netlab.ts')

test('failed nodes are listed separately and may be retried without restarting running nodes',()=>{
 assert.match(app,/const failedNodes=computed\(\(\)=>store\.activeLab\?\.nodes\.filter\(node=>node\.status!=='running'&&!!node\.error\?\.trim\(\)\)/)
 assert.match(app,/async function retryFailedNodes\(\)/)
 assert.match(app,/store\.bulkNodes\(ids,'start'\)/)
 assert.match(app,/Повторить ошибки/)
 assert.match(app,/v-for="node in failedNodes"/)
 assert.match(app,/store\.selectDeviceGroup\(\[node\.id\],node\.id\)/)
 assert.match(store,/async function bulkNodes\(/)
})

test('device and hover tooltip expose backend startup failures',()=>{
 assert.match(device,/const hasError=computed\(/)
 assert.match(device,/class="device-error-marker"/)
 assert.match(device,/device\.error/)
 assert.match(canvas,/Ошибка запуска: /)
 assert.match(app,/showDeviceLog\(store\.selectedNode\)/)
 assert.match(app,/inspector-node-failure/)
})
