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
 assert.match(store,/createBlankImage,prepareWorkshopFromISO,createWorkshopRevision,configureNodeMedia,publishWorkshop/)
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

test('ISO preparation uses one backend request instead of orphanable chained calls',()=>{
 assert.match(workshop,/async function createPreparation\(\)/)
 assert.match(workshop,/store\.prepareWorkshopFromISO\(/)
 assert.doesNotMatch(workshop,/store\.createBlankImage\(/)
 assert.doesNotMatch(workshop,/store\.createLab\(/)
 assert.doesNotMatch(workshop,/store\.addNode\(/)
 assert.match(store,/async function prepareWorkshopFromISO\(/)
 assert.match(store,/workshop\/prepare/)
 assert.match(store,/selectDeviceGroup\(\[result\.node\.id\],result\.node\.id\)/)
})
test('published versions sort numerically within their families',()=>{
 assert.match(workshop,/group\.images\.sort\(/)
 assert.match(workshop,/numeric:true/)
})


test('selecting an existing preparation restores its publication metadata',()=>{
 assert.match(workshop,/watch\(publishNodeID,id=>/)
 assert.match(workshop,/const disk=store\.images\.find\(image=>image\.id===item\.node\.imageId\)/)
 assert.match(workshop,/name\.value=item\.node\.name/)
 assert.match(workshop,/if\(disk\?\.family\)family\.value=disk\.family/)
 assert.match(workshop,/if\(disk\?\.version\)version\.value=disk\.version/)
 assert.match(workshop,/if\(disk\?\.category\)category\.value=disk\.category/)
})
