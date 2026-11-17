import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
const read=path=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),'utf8')
const app=read('../src/App.vue')
const store=read('../src/stores/netlab.ts')
const types=read('../src/types.ts')

test('lab start reports each device without waiting for whole topology',()=>{
 assert.match(store,/startProgress = ref<LabStartProgress/)
 assert.match(store,/labs\/\$\{lab.id\}\/start-job/)
 assert.match(store,/snapshot\.id!==started\.id/)
 assert.match(store,/snapshot\.status!=='running'/)
 assert.match(types,/export interface LabStartProgress/)
 assert.match(app,/class="lab-start-progress"/)
 assert.match(app,/v-for="node in activeStartProgress.nodes"/)
 assert.match(app,/Запуск топологии/)
})

test('running launch prevents duplicate lab power operations',()=>{
 assert.match(store,/startProgress\.value\?\.status==='running'/)
 assert.match(store,/Запуск этой лаборатории уже выполняется/)
 assert.match(app,/:disabled="activeStartProgress\?\.status==='running'"/)
})

test('rollback state is visible and failed launches preserve the error',()=>{
 assert.match(app,/node\.status==='rolling-back'/)
 assert.match(app,/node\.status==='rolled-back'/)
 assert.match(app,/lab-progress-error/)
 assert.match(store,/failure\.value=\(e as Error\)\.message/)
})
