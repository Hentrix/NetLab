import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const read=path=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),'utf8')
const workshop=read('../src/components/Workshop.vue')
const store=read('../src/stores/netlab.ts')

test('published images offer creation of isolated preparation VM revisions',()=>{
 assert.match(workshop,/function chooseRevision\(id:string\)/)
 assert.match(workshop,/async function createRevision\(\)/)
 assert.match(workshop,/store\.createWorkshopRevision\(source\.id,revisionName\.value\.trim\(\),revisionVersion\.value\.trim\(\)\)/)
 assert.match(workshop,/@click="chooseRevision\(image\.id\)"/)
 assert.match(workshop,/Создать ревизию/)
 assert.match(workshop,/publishNodeID\.value=result\.lab\.id\+': '\+result\.node\.id|publishNodeID\.value=result\.lab\.id\+':'\+result\.node\.id/)
})

test('revision API updates the selected lab and refreshes images',()=>{
 assert.match(store,/async function createWorkshopRevision\(imageId:string,name:string,version:string\)/)
 assert.match(store,/workshop\/revise/)
 assert.match(store,/labID\.value=result\.lab\.id/)
 assert.match(store,/selectDeviceGroup\(\[result\.node\.id\],result\.node\.id\)/)
 assert.match(store,/createBlankImage,createWorkshopRevision,publishWorkshop/)
})

test('workshop controls ISO eject and boot preference only when VM stopped',()=>{
 assert.match(workshop,/async function changeMedia\(installISOId:string,bootOrder:'disk'\|'cdrom'\)/)
 assert.match(workshop,/store\.configureNodeMedia\(selected\.lab\.id,selected\.node\.id,installISOId,bootOrder\)/)
 assert.match(workshop,/@click="changeMedia\('','disk'\)"/)
 assert.match(workshop,/Загрузка с диска/)
 assert.match(workshop,/Загрузка с ISO/)
 assert.match(workshop,/Подключить выбранный ISO/)
 assert.match(workshop,/:disabled="!publishReady\|\|mediaBusy\|\|!selectedISO"/)
 assert.match(store,/async function configureNodeMedia\(labId:string,nodeId:string,installISOId:string,bootOrder:'disk'\|'cdrom'\)/)
 assert.match(store,/nodes\/\$\{nodeId\}\/media/)
})
