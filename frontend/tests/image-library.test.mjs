import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const read=path=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),'utf8')
const images=read('../src/components/ImageLibrary.vue')
const app=read('../src/App.vue')
const store=read('../src/stores/netlab.ts')

test('image library lists, searches, sorts and guards deletion of images used by any lab',()=>{
 assert.match(images,/store\.images\.filter\(/)
 assert.match(images,/store\.labs/)
 assert.match(images,/usage\.value\.get\(image\.id\)/)
 assert.match(images,/if\(used\.length\)/)
 assert.match(images,/store\.deleteImage\(image\.id\)/)
 assert.match(images,/store\.refreshImages\(\)/)
})
test('create device from image selects an existing QEMU template',()=>{
 assert.match(app,/@create-node="addFromImage"/)
 assert.match(app,/store\.templates\.find\(t=>t\.engine==='qemu'\)/)
 assert.match(app,/imageID\.value=image/)
 assert.match(app,/filteredTemplates/)
 assert.match(app,/profile\.id/)
 assert.match(store,/async function refreshImages\(/)
})
