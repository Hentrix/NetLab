import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
const read=path=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),'utf8')
const types=read('../src/types.ts')
const overview=read('../src/components/SystemOverview.vue')

test('system overview warns about incomplete recovery of network resources',()=>{
 assert.match(types,/recoveryReady\?: boolean/)
 assert.match(types,/recoveryError\?: string/)
 assert.match(overview,/Восстановление сети после перезапуска/)
 assert.match(overview,/store\.system\.recoveryReady===true/)
 assert.match(overview,/store\.system\.recoveryError/)
})
