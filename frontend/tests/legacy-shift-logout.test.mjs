import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
const read=path=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),'utf8')
const app=read('../src/App.vue')
const canvas=read('../src/components/TopologyCanvas.vue')
const store=read('../src/stores/netlab.ts')
test('Shift, Ctrl and Meta all extend device selection as legacy',()=>{
  assert.match(canvas,/event\.event\.ctrlKey\|\|event\.event\.metaKey\|\|event\.event\.shiftKey/)
  assert.match(app,/event\.ctrlKey\|\|event\.metaKey\|\|event\.shiftKey/)
})
test('logout always closes PTY views and clears shared selection',()=>{
  assert.match(app,/function logout\(\)\{[^}]*terminal\.value\?\.closeAll\(\)/)
  assert.match(app,/@click="logout"/)
  assert.match(store,/function logout\(\)[^\n]*selectedDeviceIDs\.value=\[\]/)
})
