import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
const read=name=>readFileSync(fileURLToPath(new URL(name,import.meta.url)),'utf8')
const canvas=read('../src/components/TopologyCanvas.vue')
const app=read('../src/App.vue')
const terminal=read('../src/components/TerminalDock.vue')
test('annotation editor exposes arbitrary fill, border and measured height',()=>{
  assert.match(canvas,/function fitAnnotationHeight\(/)
  assert.match(canvas,/context\.measureText\(next\)/)
  assert.match(canvas,/annotationDraft\.borderColor/)
  assert.match(canvas,/annotationDraft\.borderWidth/)
  assert.match(canvas,/onAnnotationBackground/)
  assert.match(canvas,/fitExistingAnnotation/)
})
test('status bar includes API RTT and server persistence timestamp',()=>{
  assert.match(app,/const apiLatency=ref/)
  assert.match(app,/performance\.now\(\)-start/)
  assert.match(app,/store\.metrics\?\.savedAt/)
  assert.match(app,/telemetryInterval=setInterval/)
})
test('console marks activity on hidden tabs and supports reconnect per device',()=>{
  assert.match(terminal,/unread:boolean/)
  assert.match(terminal,/s\.unread=true/)
  assert.match(terminal,/session\.unread=false/)
  assert.match(terminal,/reconnectActive\(/)
  assert.match(terminal,/title="Новый вывод"/)
})
