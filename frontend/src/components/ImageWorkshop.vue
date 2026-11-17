<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Disc3, HardDrive, Play, Square, Monitor, PackageCheck, Trash2, RefreshCcw, Plus, Wrench, X } from '@lucide/vue'
import UiSelect from '@/components/UiSelect.vue'
import GraphicsConsole from '@/components/GraphicsConsole.vue'
import { useNetlabStore } from '@/stores/netlab'
import { api } from '@/api/client'
import type { Device, ImageRecord, InstallMedia, Lab, PreparedTemplate } from '@/types'
const store=useNetlabStore()
const media=ref<InstallMedia[]>([])
const busy=ref(false)
const uploading=ref(false)
const file=ref<File|null>(null)
const name=ref('Windows Server 2022')
const category=ref<'desktop'|'server'|'network'|'other'>('server')
const family=ref('Windows Server')
const version=ref('2022')
const installer=ref('')
const sizeGiB=ref(64)
const ram=ref(4096)
const cpu=ref(2)
const display=ref<{labId:string;nodeId:string;name:string}|null>(null)
const publishName=ref('')
const publishFamily=ref('')
const publishVersion=ref('')
const publishCategory=ref<'desktop'|'server'|'network'|'other'>('server')
const draftLabs=computed(()=>store.labs.filter(lab=>lab.workshop))
const categoryLabels:Record<string,string>={desktop:'Рабочие станции',server:'Серверы',network:'Сетевые устройства',other:'Прочее'}
const formatBytes=(b:number)=>b>=1073741824?(b/1073741824).toFixed(2)+' ГиБ':(b/1048576).toFixed(1)+' МиБ'
function device(lab:Lab):Device|undefined{return lab.nodes[0]}
function selectFile(event:Event){file.value=(event.target as HTMLInputElement).files?.[0]||null}
async function reload(){
  try{
    const [list]=await Promise.all([api<InstallMedia[]>(store.token,'media'),store.refresh(),store.refreshImages(),store.refreshCatalog(),store.refreshTemplates()])
    media.value=list
    if(!installer.value&&list.length)installer.value=list[0].id
  }catch(e){store.failure=(e as Error).message}
}
onMounted(()=>{void reload()})
async function uploadISO(){
  if(!file.value||uploading.value)return
  uploading.value=true
  try{
    const form=new FormData();form.append('file',file.value)
    const result=await api<InstallMedia>(store.token,'media',{method:'POST',body:form})
    installer.value=result.id;file.value=null
    await reload()
  }catch(e){store.failure=(e as Error).message}
  finally{uploading.value=false}
}
async function deleteISO(item:InstallMedia){
  if(!confirm('Удалить установочный ISO «'+item.name+'»?'))return
  try{await api(store.token,'media/'+item.id,{method:'DELETE'});await reload()}
  catch(e){store.failure=(e as Error).message}
}
async function createDraft(){
  if(busy.value||!installer.value)return
  busy.value=true
  try{
    const disk=await api<ImageRecord>(store.token,'images/blank',{method:'POST',body:JSON.stringify({
      name:name.value+' (установка)',sizeGiB:sizeGiB.value})})
    const lab=await api<Lab>(store.token,'labs',{method:'POST',body:JSON.stringify({
      name:'Подготовка: '+name.value,workshop:true})})
    await api<Device>(store.token,'labs/'+lab.id+'/nodes',{method:'POST',body:JSON.stringify({
      name:name.value,engine:'qemu',kind:category.value==='server'?'server':'pc',
      imageId:disk.id,installIsoId:installer.value,ram:ram.value,cpus:cpu.value,
      nicModel:'e1000',nicCount:1,diskBus:'ide',portStyle:'eth',
      x:160,y:160,status:'stopped'})})
    publishName.value=name.value;publishFamily.value=family.value
    publishVersion.value=version.value;publishCategory.value=category.value
    await reload()
  }catch(e){store.failure=(e as Error).message}
  finally{busy.value=false}
}
async function power(lab:Lab,op:'start'|'stop'){
  const node=device(lab)
  if(!node||busy.value)return
  busy.value=true
  try{await api(store.token,`labs/${lab.id}/nodes/${node.id}/${op}`,{method:'POST'});await reload()}
  catch(e){store.failure=(e as Error).message}
  finally{busy.value=false}
}
async function eject(lab:Lab,mediaId:string){
  const node=device(lab)
  if(!node||busy.value)return
  busy.value=true
  try{await api(store.token,'media/attach',{method:'POST',body:JSON.stringify({labId:lab.id,nodeId:node.id,mediaId})});await reload()}
  catch(e){store.failure=(e as Error).message}
  finally{busy.value=false}
}
async function publish(lab:Lab){
  const node=device(lab)
  if(!node||busy.value)return
  if(node.status==='running'){store.failure='Остановите VM перед публикацией';return}
  if(node.installIsoId){store.failure='Извлеките ISO перед публикацией';return}
  busy.value=true
  try{
    await api<PreparedTemplate>(store.token,'catalog/publish',{method:'POST',body:JSON.stringify({
      labId:lab.id,nodeId:node.id,name:publishName.value||node.name,category:publishCategory.value,
      family:publishFamily.value||'ОС',version:publishVersion.value||'1.0'})})
    await reload()
  }catch(e){store.failure=(e as Error).message}
  finally{busy.value=false}
}
async function deleteDraft(lab:Lab){
  if(busy.value||!confirm('Удалить мастерскую «'+lab.name+'» и её рабочий диск? Опубликованные образы сохранятся.'))return
  busy.value=true
  try{await api(store.token,'labs/'+lab.id,{method:'DELETE'});await reload()}
  catch(e){store.failure=(e as Error).message}
  finally{busy.value=false}
}
async function deleteProfile(item:PreparedTemplate){
  if(!confirm('Удалить профиль «'+item.name+'» из каталога? Диск останется в библиотеке.'))return
  try{await api(store.token,'catalog/'+item.id,{method:'DELETE'});await reload()}
  catch(e){store.failure=(e as Error).message}
}
function preparePublication(lab:Lab){
  const node=device(lab)
  publishName.value=node?.name||'Новая ОС'
  publishFamily.value=family.value||'ОС'
  publishVersion.value=version.value||'1.0'
  publishCategory.value=category.value
}
</script>
<template>
  <section class="workshop-page">
    <header class="image-library-heading"><div><h1>Мастерская образов</h1>
      <p>Подготовка установочных VM и публикация многоразовых шаблонов ОС.</p></div>
      <button class="image-refresh" type="button" @click="reload"><RefreshCcw :size="15"/> Обновить</button>
    </header>
    <div class="workshop-notice"><Wrench :size="17"/> Этот раздел доступен по административному токену. Рабочие диски мастерской изолированы от опубликованных шаблонов.</div>
    <div class="workshop-grid">
      <section class="workshop-panel">
        <h2><Disc3 :size="19"/> Установочные ISO</h2>
        <form class="workshop-upload" @submit.prevent="uploadISO"><label>Загрузить ISO с компьютера
          <input type="file" accept=".iso" @change="selectFile"/></label>
          <button type="submit" class="primary" :disabled="!file||uploading">{{uploading?'Загрузка…':'Загрузить ISO'}}</button></form>
        <small>Файлы хранятся на Debian-сервере. Максимальный размер одного ISO — 12 ГиБ.</small>
        <div v-for="medium in media" :key="medium.id" class="workshop-item">
          <Disc3 :size="22"/><div><strong>{{medium.name}}</strong><small>{{formatBytes(medium.size)}}</small></div>
          <button type="button" title="Удалить ISO" @click="deleteISO(medium)"><Trash2 :size="15"/></button></div>
        <p v-if="!media.length" class="secondary-text">ISO пока не загружены.</p>
      </section>
      <section class="workshop-panel">
        <h2><Plus :size="19"/> Новая установочная VM</h2>
        <form class="workshop-create" @submit.prevent="createDraft">
          <label>Название<input v-model.trim="name" maxlength="80" required/></label>
          <div class="workshop-two"><label>Семейство ОС<input v-model.trim="family" maxlength="80" required placeholder="Windows Server"/></label>
            <label>Версия<input v-model.trim="version" maxlength="80" required placeholder="2022"/></label></div>
          <label>Категория<UiSelect v-model="category"><option v-for="(label,key) in categoryLabels" :key="key" :value="key">{{label}}</option></UiSelect></label>
          <label>Установочный ISO<UiSelect v-model="installer" :disabled="!media.length"><option v-for="medium in media" :key="medium.id" :value="medium.id">{{medium.name}}</option></UiSelect></label>
          <div class="workshop-three"><label>Диск, ГиБ<input v-model.number="sizeGiB" type="number" min="8" max="256" required/></label>
            <label>RAM, МиБ<input v-model.number="ram" type="number" min="128" max="131072" required/></label>
            <label>vCPU<input v-model.number="cpu" type="number" min="1" max="64" required/></label></div>
          <p class="workshop-help">Для совместимости установщиков используется IDE-диск и Intel E1000. После установки драйверов можно создать оптимизированный профиль.</p>
          <button type="submit" class="primary" :disabled="busy||!installer"><Plus :size="16"/> Создать VM для установки</button>
        </form>
      </section>
    </div>
    <section class="workshop-panel">
      <h2><Monitor :size="19"/> Подготовка операционных систем</h2>
      <p class="workshop-help">Запустите VM, откройте графический экран, установите ОС, выключите её, извлеките ISO и опубликуйте. Рабочая VM может сохраняться между сеансами.</p>
      <article v-for="lab in draftLabs" :key="lab.id" class="workshop-draft">
        <div class="workshop-draft-main"><strong>{{lab.name}}</strong>
          <small>Состояние: {{device(lab)?.status==='running'?'Запущена':device(lab)?.status==='error'?'Ошибка запуска':'Выключена'}}
          · ISO: {{device(lab)?.installIsoId?'подключён':'извлечён'}}</small></div>
        <div v-if="device(lab)" class="workshop-actions">
          <button v-if="device(lab)?.status!=='running'" type="button" :disabled="busy" @click="power(lab,'start')"><Play :size="15"/> Запустить</button>
          <button v-else type="button" :disabled="busy" @click="power(lab,'stop')"><Square :size="15"/> Выключить</button>
          <button type="button" :disabled="device(lab)?.status!=='running'" @click="display={labId:lab.id,nodeId:device(lab)!.id,name:device(lab)!.name}"><Monitor :size="15"/> Экран ОС</button>
          <button type="button" :disabled="busy||device(lab)?.status==='running'||!device(lab)?.installIsoId" @click="eject(lab,'')"><X :size="15"/> Извлечь ISO</button>
          <button type="button" @click="preparePublication(lab)" class="workshop-prepare">Параметры публикации</button>
          <button type="button" title="Удалить VM мастерской" :disabled="busy||device(lab)?.status==='running'" @click="deleteDraft(lab)"><Trash2 :size="15"/></button>
        </div>
        <form class="workshop-publish" @submit.prevent="publish(lab)">
          <label>Название<input v-model.trim="publishName" maxlength="80" required/></label>
          <label>Семейство<input v-model.trim="publishFamily" maxlength="80" required/></label>
          <label>Версия<input v-model.trim="publishVersion" maxlength="80" required/></label>
          <label>Категория<UiSelect v-model="publishCategory"><option v-for="(label,key) in categoryLabels" :key="key" :value="key">{{label}}</option></UiSelect></label>
          <button type="submit" class="primary" :disabled="busy||device(lab)?.status==='running'||!!device(lab)?.installIsoId"><PackageCheck :size="15"/>{{busy?'Обработка…':'Опубликовать шаблон'}}</button>
        </form>
      </article>
      <p v-if="!draftLabs.length" class="secondary-text">Здесь появятся подготовительные виртуальные машины.</p>
    </section>
    <section class="workshop-panel">
      <h2><HardDrive :size="19"/> Опубликованные шаблоны</h2>
      <div v-for="profile in store.catalog" :key="profile.id" class="workshop-item">
        <PackageCheck :size="20"/><div><strong>{{profile.name}}</strong>
          <small>{{categoryLabels[profile.category]||'Прочее'}} / {{profile.family}} / {{profile.version}}</small></div>
        <button type="button" title="Убрать профиль из каталога" @click="deleteProfile(profile)"><Trash2 :size="15"/></button>
      </div>
      <p v-if="!store.catalog.length" class="secondary-text">Сначала подготовьте и опубликуйте хотя бы один образ.</p>
    </section>
    <GraphicsConsole v-if="display" :lab-id="display.labId" :node-id="display.nodeId" :name="display.name" @close="display=null"/>
  </section>
</template>
