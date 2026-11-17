import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const read=(name)=>readFileSync(fileURLToPath(new URL(name,import.meta.url)),'utf8')
const app=read('../src/App.vue'),store=read('../src/stores/netlab.ts')
test('bulk dialog selects existing nodes and confirms irreversible deletion',()=>{
  assert.match(app,/function selectAllBulk\(/)
  assert.match(app,/function selectRunningBulk\(/)
  assert.match(app,/function selectStoppedBulk\(/)
  assert.match(app,/operation==='delete'&&!confirm\(/)
  assert.match(app,/bulkSelected\.value\.filter\(id=>existing\.has\(id\)\)/)
  assert.match(app,/v-model="bulkSelected"/)
})
test('bulk backend calls are independent, report partial errors and refresh once',()=>{
  assert.match(store,/async function bulkNodes\(/)
  assert.match(store,/const target=\[\.\.\.new Set\(ids\)\]/)
  assert.match(store,/for\(const id of target\)/)
  assert.match(store,/failed\.push\(\{id,error:/)
  assert.match(store,/await refresh\(\)\s*if\(failed\.length\)/)
})
