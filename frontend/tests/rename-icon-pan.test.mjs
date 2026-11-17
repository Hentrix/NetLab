import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
const read=path=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),'utf8')
const app=read('../src/App.vue')
const canvas=read('../src/components/TopologyCanvas.vue')
const css=read('../src/styles/app.css')

test('rename uses a real modal with validation, save and cancel, never window.prompt',()=>{
  assert.doesNotMatch(app,/window\.prompt\('Название устройства'/)
  assert.match(app,/function rename\(device:Device\)/)
  assert.match(app,/renameName\.value=device\.name/)
  assert.match(app,/async function saveRename\(\)/)
  assert.match(app,/store\.renameNode\(device\.id,value\)/)
  assert.match(app,/role="dialog" aria-label="Переименовать устройство"/)
  assert.match(app,/@submit\.prevent="saveRename"/)
  assert.match(app,/:disabled="renameSaving\|\|!renameName\.trim\(\)"/)
})
test('icon picker keeps fixed viewport size across changing category results',()=>{
  assert.match(css,/\.icon-picker-dialog\s*\{[^}]*height:min\(720px,calc\(100dvh - 40px\)\)/)
  assert.match(css,/\.icon-picker-dialog \.icon-picker-list\s*\{[^}]*flex:1 1 0/)
  assert.match(css,/\.icon-picker-dialog \.icon-picker-list\s*\{[^}]*grid-auto-rows:110px/)
  assert.match(app,/class="dialog-card icon-picker-dialog"/)
})
test('middle mouse drag pans canvas in select and hand modes',()=>{
  assert.match(canvas,/:pan-on-drag="panMode \? \[0,1\] : \[1\]"/)
  assert.match(canvas,/@mousedown\.capture="preventMiddleAutoscroll"/)
  assert.match(canvas,/@auxclick="preventMiddleAutoscroll"/)
  assert.match(canvas,/if\(event\.button===1\)event\.preventDefault\(\)/)
})
