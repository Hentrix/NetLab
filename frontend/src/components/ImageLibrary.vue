<script setup lang="ts">
import UiSelect from '@/components/UiSelect.vue'
import { computed, ref } from 'vue'
import { HardDrive, Disc3, Plus, Search, RotateCcw, Trash2, Monitor, Pencil, Check, X } from '@lucide/vue'
import { useNetlabStore } from '@/stores/netlab'
import type { ImageRecord } from '@/types'

const store=useNetlabStore()
const emit=defineEmits<{(e:'create-node',imageId:string):void}>()
const query=ref('')
const order=ref<'name'|'size'|'newest'>('name')
const typeFilter=ref<'all'|'iso'|'template'|'draft'|'disk'>('all')
const categoryFilter=ref('all')
const editingID=ref<string|null>(null)
const savingMetadata=ref(false)
const editDraft=ref({name:'',category:'other',family:'',version:''})
const categories=[{id:'server',name:'Серверы'},{id:'desktop',name:'Компьютеры'},{id:'router',name:'Маршрутизаторы'},{id:'switch',name:'Коммутаторы'},{id:'firewall',name:'Безопасность'},{id:'other',name:'Прочее'}]
const imageCategories=computed(()=>categories.filter(category=>store.images.some(i=>i.category===category.id)))
function imageType(image:ImageRecord){
  if(image.kind==='iso'||image.format==='iso')return 'iso'
  if(image.published)return 'template'
  if(image.draft)return 'draft'
  return 'disk'
}
function beginEdit(image:ImageRecord){
  editingID.value=image.id
  editDraft.value={name:image.name,category:image.category||'other',family:image.family||'',version:image.version||''}
}
function cancelEdit(){editingID.value=null}
async function saveMetadata(image:ImageRecord){
  if(savingMetadata.value||editingID.value!==image.id)return
  const draft={...editDraft.value,name:editDraft.value.name.trim(),family:editDraft.value.family.trim(),version:editDraft.value.version.trim()}
  if(!draft.name){store.failure='Название образа не может быть пустым';return}
  if(image.published&&(!draft.family||!draft.version)){store.failure='Укажите семейство и версию опубликованного шаблона';return}
  savingMetadata.value=true
  try{
    await store.updateImageMetadata(image.id,draft.name,draft.category,draft.family,draft.version)
    editingID.value=null
  }catch(e){store.failure=(e as Error).message}
  finally{savingMetadata.value=false}
}
const file=ref<File|null>(null)
const uploading=ref(false)
const refreshing=ref(false)

const usage=computed(()=>{
  const map=new Map<string,Array<{lab:string;node:string}>>()
  for(const lab of store.labs)for(const node of lab.nodes){
    for(const id of [node.imageId,node.installISOId]){
      if(!id)continue
      const items=map.get(id)||[]
      items.push({lab:lab.name,node:node.name})
      map.set(id,items)
    }
  }
  return map
})
const filtered=computed(()=>{
  const term=query.value.trim().toLocaleLowerCase()
  const result=store.images.filter(image=>(typeFilter.value==='all'||imageType(image)===typeFilter.value)&&
    (categoryFilter.value==='all'||image.category===categoryFilter.value)&&
    (!term||[image.name,image.format,image.family,image.version,image.category].some(value=>value?.toLocaleLowerCase().includes(term))))
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
      <div><h1>Библиотека образов</h1><p>QCOW2, RAW и установочные ISO сохраняются на сервере. Образы дисков проверяются через qemu-img, ISO — по структуре тома.</p></div>
      <button type="button" class="image-refresh" :disabled="refreshing" @click="reload"><RotateCcw :size="15"/> Обновить</button>
    </header>
    <div class="image-library-summary"><div><strong>{{store.images.length}}</strong><span>Образов</span></div>
      <div><strong>{{formatBytes(totalBytes)}}</strong><span>Объём файлов</span></div>
      <div><strong>{{usage.size}}</strong><span>Используются в лабораториях</span></div>
    </div>
    <form class="image-library-upload" @submit.prevent="upload">
      <label>Добавить диск или установочный ISO<input type="file" accept=".qcow2,.img,.raw,.qcow,.iso" @change="chooseFile"/></label>
      <button type="submit" class="primary" :disabled="uploading||!file"><Plus :size="15"/>{{uploading?'Загрузка…':'Загрузить'}}</button>
      <small>Максимум 16 ГиБ на файл. Загрузка зависит от скорости сети; не закрывайте страницу до завершения.</small>
    </form>
    <div class="image-library-toolbar">
      <label class="image-library-search"><Search :size="16"/><input v-model="query" aria-label="Поиск образов" placeholder="Поиск по имени или формату"/></label>
      <label>Тип<UiSelect v-model="typeFilter" aria-label="Тип образа"><option value="all">Все образы</option><option value="template">Готовые шаблоны</option><option value="iso">ISO установщики</option><option value="draft">Подготовка VM</option><option value="disk">Диски</option></UiSelect></label>
      <label>Категория<UiSelect v-model="categoryFilter" aria-label="Категория образа"><option value="all">Все категории</option><option v-for="item in imageCategories" :key="item.id" :value="item.id">{{item.name}}</option></UiSelect></label>
      <label>Сортировка<UiSelect v-model="order" aria-label="Сортировка образов"><option value="name">По названию</option><option value="size">По размеру</option><option value="newest">Сначала новые</option></UiSelect></label>
    </div>
    <div class="image-library-results">
      <article v-for="image in filtered" :key="image.id" class="image-library-item">
        <div class="image-library-symbol"><Disc3 v-if="image.kind==='iso'||image.format==='iso'" :size="22"/><HardDrive v-else :size="22"/></div>
        <div class="image-library-info"><strong>{{image.name}}</strong>
          <span>{{image.kind==='iso'||image.format==='iso'?'Установочный ISO':image.published?'Готовый шаблон':image.draft?'Диск для подготовки':'Образ диска'}} · {{(image.format||'unknown').toUpperCase()}} · {{formatBytes(image.size||0)}}</span>
          <small v-if="image.published">{{image.category||'Без категории'}} / {{image.family||'Без семейства'}} / {{image.version||'Без версии'}}</small>
          <small v-if="usage.get(image.id)?.length" class="image-library-used">Используется: {{usage.get(image.id)?.map(item=>item.lab+' / '+item.node).join(', ')}}</small>
          <small v-else>Нет подключённых устройств</small>
        </div>
        <div class="image-library-actions">
          <button type="button" :disabled="!store.activeLab||image.kind==='iso'||image.format==='iso'" :title="image.format==='iso'?'Для ISO используйте мастерскую':store.activeLab?'Добавить устройство с этим образом':'Сначала выберите лабораторию'" @click="emit('create-node',image.id)"><Monitor :size="15"/> Устройство</button>
          <button type="button" :disabled="savingMetadata" :aria-label="'Изменить данные '+image.name" @click="beginEdit(image)"><Pencil :size="15"/> Изменить</button>
          <button type="button" class="image-library-delete" :disabled="!!usage.get(image.id)?.length" :title="usage.get(image.id)?.length?'Образ используется устройствами':'Удалить образ'" @click="remove(image)"><Trash2 :size="15"/></button>
        </div>
        <form v-if="editingID===image.id" class="image-library-metadata" @submit.prevent="saveMetadata(image)">
          <label>Название<input v-model.trim="editDraft.name" maxlength="80" required aria-label="Название образа"/></label>
          <label>Категория<UiSelect v-model="editDraft.category" aria-label="Категория редактируемого образа"><option v-for="item in categories" :key="item.id" :value="item.id">{{item.name}}</option></UiSelect></label>
          <label>Семейство<input v-model.trim="editDraft.family" maxlength="80" placeholder="Windows Server, Debian…" aria-label="Семейство образа"/></label>
          <label>Версия<input v-model.trim="editDraft.version" maxlength="80" placeholder="2022, 13…" aria-label="Версия образа"/></label>
          <div class="image-library-metadata-actions"><button type="button" :disabled="savingMetadata" @click="cancelEdit"><X :size="15"/> Отмена</button><button type="submit" class="primary" :disabled="savingMetadata||!editDraft.name.trim()"><Check :size="15"/> {{savingMetadata?'Сохранение…':'Сохранить'}}</button></div>
        </form>
      </article>
      <p v-if="!filtered.length">{{store.images.length?'Совпадений не найдено':'Образы пока не загружены.'}}</p>
    </div>
  </section>
</template>
<style scoped>
.image-library-metadata{grid-column:1/-1;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:14px;border-top:1px solid var(--border);min-width:0}
.image-library-metadata label{display:grid;gap:6px;font-size:12px;color:var(--muted);min-width:0}
.image-library-metadata input{width:100%;min-width:0;padding:9px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface-2);color:var(--ink)}
.image-library-metadata-actions{grid-column:1/-1;display:flex;justify-content:flex-end;gap:8px}
.image-library-metadata-actions button{display:inline-flex;align-items:center;gap:6px;justify-content:center;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--surface-2);color:var(--ink);cursor:pointer}
.image-library-metadata-actions button.primary{background:var(--accent);color:#fff}
@media(max-width:720px){.image-library-metadata{grid-template-columns:1fr}}
</style>
