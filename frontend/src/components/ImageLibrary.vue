<script setup lang="ts">
import { computed, ref } from 'vue'
import { HardDrive, Plus, Search, RotateCcw, Trash2, Monitor } from '@lucide/vue'
import { useNetlabStore } from '@/stores/netlab'
import type { ImageRecord } from '@/types'

const store=useNetlabStore()
const emit=defineEmits<{(e:'create-node',imageId:string):void}>()
const query=ref('')
const order=ref<'name'|'size'|'newest'>('name')
const file=ref<File|null>(null)
const uploading=ref(false)
const refreshing=ref(false)

const usage=computed(()=>{
  const map=new Map<string,Array<{lab:string;node:string}>>()
  for(const lab of store.labs)for(const node of lab.nodes){
    if(!node.imageId)continue
    const items=map.get(node.imageId)||[]
    items.push({lab:lab.name,node:node.name})
    map.set(node.imageId,items)
  }
  return map
})
const filtered=computed(()=>{
  const term=query.value.trim().toLocaleLowerCase()
  const result=store.images.filter(image=>!term||image.name.toLocaleLowerCase().includes(term)||image.format?.toLocaleLowerCase().includes(term))
  return [...result].sort((a,b)=>order.value==='size'?(b.size||0)-(a.size||0):
    order.value==='newest'? (b.createdAt||'').localeCompare(a.createdAt||'') :
    a.name.localeCompare(b.name,'ru'))
})
const totalBytes=computed(()=>store.images.reduce((sum,image)=>sum+(image.size||0),0))
const formatBytes=(size:number)=>size>=1073741824?`${(size/1073741824).toFixed(2)} ГиБ`:`${(size/1048576).toFixed(1)} МиБ`
function chooseFile(event:Event){file.value=(event.target as HTMLInputElement).files?.[0]||null}
async function upload(){
  if(!file.value||uploading.value)return
  uploading.value=true
  try{await store.uploadImage(file.value);file.value=null}
  catch(e){store.failure=(e as Error).message}
  finally{uploading.value=false}
}
async function reload(){
  if(refreshing.value)return
  refreshing.value=true
  try{await store.refreshImages()}
  catch(e){store.failure=(e as Error).message}
  finally{refreshing.value=false}
}
async function remove(image:ImageRecord){
  const used=usage.value.get(image.id)||[]
  if(used.length){store.failure=`Образ используется устройствами: ${used.map(u=>u.lab+' / '+u.node).join(', ')}`;return}
  if(!confirm(`Удалить образ «${image.name}» с сервера? Действие необратимо.`))return
  try{await store.deleteImage(image.id)}
  catch(e){store.failure=(e as Error).message}
}
</script>
<template>
  <section class="image-library">
    <header class="image-library-heading">
      <div><h1>Библиотека образов</h1><p>QCOW2 и RAW хранятся на сервере, формат проверяется через qemu-img.</p></div>
      <button type="button" class="image-refresh" :disabled="refreshing" @click="reload"><RotateCcw :size="15"/> Обновить</button>
    </header>
    <div class="image-library-summary"><div><strong>{{store.images.length}}</strong><span>Образов</span></div>
      <div><strong>{{formatBytes(totalBytes)}}</strong><span>Объём файлов</span></div>
      <div><strong>{{usage.size}}</strong><span>Используются в лабораториях</span></div>
    </div>
    <form class="image-library-upload" @submit.prevent="upload">
      <label>Добавить образ диска<input type="file" accept=".qcow2,.img,.raw,.qcow" @change="chooseFile"/></label>
      <button type="submit" class="primary" :disabled="uploading||!file"><Plus :size="15"/>{{uploading?'Загрузка…':'Загрузить'}}</button>
      <small>Максимум 8 ГиБ на файл. Загрузка зависит от скорости сети; не закрывайте страницу до завершения.</small>
    </form>
    <div class="image-library-toolbar">
      <label class="image-library-search"><Search :size="16"/><input v-model="query" aria-label="Поиск образов" placeholder="Поиск по имени или формату"/></label>
      <label>Сортировка<select v-model="order" aria-label="Сортировка образов"><option value="name">По названию</option><option value="size">По размеру</option><option value="newest">Сначала новые</option></select></label>
    </div>
    <div class="image-library-results">
      <article v-for="image in filtered" :key="image.id" class="image-library-item">
        <div class="image-library-symbol"><HardDrive :size="22"/></div>
        <div class="image-library-info"><strong>{{image.name}}</strong>
          <span>{{(image.format||'unknown').toUpperCase()}} · {{formatBytes(image.size||0)}}</span>
          <small v-if="usage.get(image.id)?.length" class="image-library-used">Используется: {{usage.get(image.id)?.map(item=>item.lab+' / '+item.node).join(', ')}}</small>
          <small v-else>Нет подключённых устройств</small>
        </div>
        <div class="image-library-actions">
          <button type="button" :disabled="!store.activeLab" :title="store.activeLab?'Добавить устройство с этим образом':'Сначала выберите лабораторию'" @click="emit('create-node',image.id)"><Monitor :size="15"/> Устройство</button>
          <button type="button" class="image-library-delete" :disabled="!!usage.get(image.id)?.length" :title="usage.get(image.id)?.length?'Образ используется устройствами':'Удалить образ'" @click="remove(image)"><Trash2 :size="15"/></button>
        </div>
      </article>
      <p v-if="!filtered.length">{{store.images.length?'Совпадений не найдено':'Образы пока не загружены.'}}</p>
    </div>
  </section>
</template>
