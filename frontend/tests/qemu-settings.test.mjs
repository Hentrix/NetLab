import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const read=(path)=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),'utf8')
const app=read('../src/App.vue')
const store=read('../src/stores/netlab.ts')
test('QEMU hardware settings use PUT only while whole lab is stopped',()=>{
  assert.match(store,/async function configureQemuNode\(/)
  assert.match(store,/lab\.nodes\.some\(node=>node\.status==='running'\)/)
  assert.match(store,/method:'PUT',body:json\(payload\)/)
  assert.match(app,/hardwareLocked=computed\(/)
  assert.match(app,/:disabled="hardwareSaving\|\|hardwareLocked"/)
})
test('hardware editor exposes supported QEMU fields and warnings',()=>{
  for(const field of ['hardwareDraft.ram','hardwareDraft.cpus','hardwareDraft.nicCount','hardwareDraft.nicModel','hardwareDraft.diskBus','hardwareDraft.imageId'])assert.ok(app.includes(field),field)
  assert.match(app,/Изменение образа после создания overlay-диска запрещено/)
  assert.match(app,/store.selectedNode.engine!=='vpcs'/)
})
