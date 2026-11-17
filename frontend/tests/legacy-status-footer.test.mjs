import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
const read=p=>readFileSync(fileURLToPath(new URL(p,import.meta.url)),'utf8')
const app=read('../src/App.vue')
const canvas=read('../src/components/TopologyCanvas.vue')
const css=read('../src/styles/app.css')
test('status bar restores CPU and RAM alongside API latency and saved time',()=>{
  assert.match(app,/store\.metrics\?\.cpuPercent/)
  assert.match(app,/store\.metrics\?\.memoryUsedMiB/)
  assert.match(app,/store\.metrics\.memoryTotalMiB/)
  assert.match(app,/apiLatency===null/)
  assert.match(app,/store\.metrics\?\.savedAt/)
})
test('sidebar counts and screen reader hint do not cover canvas',()=>{
  assert.match(app,/class="nav-count".*store\.labs\.length/)
  assert.match(app,/class="nav-count".*store\.images\.length/)
  assert.match(canvas,/class="sr-only" role="status" aria-live="polite"/)
  assert.doesNotMatch(canvas,/class="canvas-selection-hint"/)
  assert.match(css,/\.sr-only\{position:absolute!important/)
})
