import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
const read=path=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),'utf8')
const overview=read('../src/components/SystemOverview.vue')
const types=read('../src/types.ts')

test('system panel shows QEMU allocation separately from host usage',()=>{
 assert.match(types,/export interface VMCapacity/)
 assert.match(types,/allocatedRAMMiB:number/)
 assert.match(types,/hostAvailableMiB:number/)
 assert.match(types,/vmCapacity\?: VMCapacity/)
 assert.match(overview,/Ресурсы виртуальных машин/)
 assert.match(overview,/capacity\.allocatedRAMMiB/)
 assert.match(overview,/capacity\.reservationLimitMiB/)
 assert.match(overview,/capacity\.allocatedVCPUs/)
 assert.match(overview,/capacity\.hostAvailableMiB/)
 assert.match(overview,/переподписка/)
})
