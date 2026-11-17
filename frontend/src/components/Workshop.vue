<script setup lang="ts">
import {computed,ref} from 'vue'
import {Disc3,HardDrive,PackageCheck,Wrench,Plus,RotateCcw} from '@lucide/vue'
import UiSelect from '@/components/UiSelect.vue'
import {useNetlabStore} from '@/stores/netlab'
const store=useNetlabStore()
const emit=defineEmits<{(e:'open-lab'):void}>()
const installers=computed(()=>store.images.filter(i=>i.kind==='iso'||i.format==='iso'))
const draftNodes=computed(()=>store.labs.flatMap(lab=>lab.nodes.filter(n=>
  n.engine!=='vpcs'&&store.images.some(i=>i.id===n.imageId&&i.draft))
  .map(node=>({lab,node}))))
const isoID=ref('')
const isoFile=ref<File|null>(null)
const uploadBusy=ref(false)
const preparing=ref(false)
const publishing=ref(false)
const publishNodeID=ref('')
const name=ref('Новая подготовка')
const family=ref('Windows Server')
const version=ref('2022')
const category=ref('server')
const ram=ref(4096)
const cpus=ref(2)
const sizeGiB=ref(64)
const nicModel=ref('e1000')
const status=ref('')
const published=computed(()=>store.images.filter(i=>i.published&&!i.draft))
const categories=[{id:'server',name:'Серверы'},{id:'desktop',name:'Компьютеры'},{id:'router',name:'Маршрутизаторы'},{id:'switch',name:'Коммутаторы'},{id:'firewall',name:'Безопасность'},{id:'other',name:'Прочее'}]
const families=computed(()=>{
 const groups=new Map<string,{category:string;family:string;images:typeof published.value}>()
 for(const image of published.value){
  const category=image.category||'other',family=image.family||'Без семейства'
  const key=category+':'+family
  if(!groups.has(key))groups.set(key,{category,family,images:[]})
  groups.get(key)!.images.push(image)
 }
 return [...groups.values()].sort((a,b)=>a.category.localeCompare(b.category)||a.family.localeCompare(b.family))
})
const selectedDraft=computed(()=>draftNodes.value.find(({lab,node})=>lab.id+':'+node.id===publishNodeID.value))
async function uploadISO(){
 if(!isoFile.value||uploadBusy.value)return
 const selected=isoFile.value
 if(!selected.name.toLowerCase().endsWith('.iso')){store.failure='Выберите файл установщика .iso';return}
 uploadBusy.value=true;status.value=''
 try{
  const result=await store.uploadImage(selected)
  isoID.value=result.id
  isoFile.value=null
  status.value='ISO сохранён на сервере. Теперь можно создать установочную VM.'
 }catch(e){store.failure=(e as Error).message}
 finally{uploadBusy.value=false}
}
async function createPreparation(){
 if(preparing.value||!isoID.value)return
 if(!name.value.trim()||!family.value.trim()||!version.value.trim())return
 preparing.value=true;status.value=''
 try{
  // Separate base disk and overlay: the ISO is a read-only CD-ROM.
  const blank=await store.createBlankImage('Заготовка · '+family.value+' '+version.value,sizeGiB.value)
  await store.createLab('Подготовка · '+family.value+' '+version.value)
  const lab=store.activeLab
  if(!lab)throw Error('Не удалось создать подготовительную лабораторию')
  await store.addNode({
   name:name.value.trim(),engine:'qemu',kind:category.value==='desktop'?'pc':category.value==='router'?'router':'server',
   imageId:blank.id,installISOId:isoID.value,ram:ram.value,cpus:cpus.value,
   nicModel:nicModel.value,diskBus:'ide',nicCount:2,portStyle:'eth',x:250,y:180
  })
  const node=store.activeLab?.nodes.find(n=>n.imageId===blank.id)
  if(node){store.selectDeviceGroup([node.id],node.id);publishNodeID.value=lab.id+':'+node.id}
  status.value='Установочная VM подготовлена. После установки и выключения ОС вернитесь для публикации.'
  emit('open-lab')
 }catch(e){store.failure=(e as Error).message}
 finally{preparing.value=false}
}
async function publish(){
 if(!selectedDraft.value||publishing.value||!name.value.trim())return
 publishing.value=true;status.value=''
 try{
  const item=selectedDraft.value
  const result=await store.publishWorkshop(item.lab.id,item.node.id,
    name.value.trim(),category.value,family.value.trim(),version.value.trim())
  status.value='Шаблон «'+result.name+'» опубликован. Теперь он доступен в каталоге устройств.'
 }catch(e){store.failure=(e as Error).message}
 finally{publishing.value=false}
}
async function refresh(){
 try{await Promise.all([store.refresh(),store.refreshImages(),store.refreshTemplates()])}
 catch(e){store.failure=(e as Error).message}
}
</script>
<template>
  <section class="image-workshop">
    <header class="workshop-heading">
      <div><h1><Wrench :size="22"/> Мастерская образов</h1><p>Подготовка установочной VM и публикация готового диска в общий каталог</p></div>
      <button type="button" @click="refresh"><RotateCcw :size="15"/> Обновить</button>
    </header>
    <div class="workshop-notice">
      <strong>Административная функция</strong>
      <p>Сейчас API использует единый административный токен. Для доступа 20 студентов потребуется отдельная система ролей и квот.</p>
      <p>Для установки Windows/Linux запустите подготовленную QEMU-VM в лаборатории и нажмите «Экран (VNC)». После штатного выключения гостевой ОС вернитесь сюда и опубликуйте образ.</p>
    </div>
    <div v-if="status" role="status" class="workshop-success">{{status}}</div>
    <div class="workshop-steps">
      <article class="workshop-card">
        <h2><Disc3 :size="18"/> 1. Установочный ISO</h2>
        <label>Добавить ISO на сервер
          <input type="file" accept=".iso,application/x-iso9660-image" @change="isoFile=($event.target as HTMLInputElement).files?.[0]||null"/>
        </label>
        <button type="button" :disabled="!isoFile||uploadBusy" @click="uploadISO">{{uploadBusy?'Загрузка ISO…':'Загрузить ISO'}}</button>
        <label>Использовать ISO
          <UiSelect v-model="isoID"><option value="">Выберите ISO</option><option v-for="item in installers" :key="item.id" :value="item.id">{{item.name}}</option></UiSelect>
        </label>
        <small>Дистрибутив загружается как CD-ROM только для установки, а не как системный диск.</small>
      </article>
      <article class="workshop-card">
        <h2><HardDrive :size="18"/> 2. Создать установочную VM</h2>
        <div class="workshop-grid">
          <label>Название<input v-model="name" maxlength="80" required/></label>
          <label>Категория<UiSelect v-model="category"><option v-for="c in categories" :key="c.id" :value="c.id">{{c.name}}</option></UiSelect></label>
          <label>Семейство<input v-model="family" maxlength="80" placeholder="Windows Server, Ubuntu, Debian…"/></label>
          <label>Версия<input v-model="version" maxlength="80" placeholder="2022, 24.04, 13…"/></label>
          <label>RAM, МиБ<input v-model.number="ram" type="number" min="128" max="131072"/></label>
          <label>vCPU<input v-model.number="cpus" type="number" min="1" max="64"/></label>
          <label>Диск, ГиБ<input v-model.number="sizeGiB" type="number" min="4" max="512"/></label>
          <label>Сетевая карта<UiSelect v-model="nicModel"><option value="e1000">Intel E1000</option><option value="virtio-net-pci">VirtIO</option><option value="rtl8139">RTL8139</option></UiSelect></label>
        </div>
        <button class="primary" type="button" :disabled="!isoID||preparing||!name.trim()||!family.trim()||!version.trim()||ram<128||cpus<1||sizeGiB<4||sizeGiB>512" @click="createPreparation">
          <Plus :size="16"/> {{preparing?'Создание…':'Создать VM для установки'}}
        </button>
        <small>Создаётся отдельная лаборатория с пустым диском QCOW2 и подключённым ISO.</small>
      </article>
      <article class="workshop-card">
        <h2><PackageCheck :size="18"/> 3. Опубликовать установленную ОС</h2>
        <label>Подготовленная VM
          <UiSelect v-model="publishNodeID"><option value="">Выберите устройство</option><option v-for="item in draftNodes" :key="item.lab.id+':'+item.node.id" :value="item.lab.id+':'+item.node.id">{{item.lab.name}} / {{item.node.name}}</option></UiSelect>
        </label>
        <p>После завершения установки выключите гостевую ОС. Сервер объединит рабочий диск с базовым в отдельный QCOW2 и добавит версию в каталог. Исходная VM останется доступна.</p>
        <button class="primary" type="button" :disabled="!selectedDraft||publishing||!name.trim()||!family.trim()||!version.trim()" @click="publish">
          <PackageCheck :size="16"/> {{publishing?'Публикация…':'Опубликовать образ'}}
        </button>
      </article>
    </div>
    <h2>Каталог подготовленных систем</h2>
    <div v-if="families.length" class="workshop-catalogue">
      <article v-for="group in families" :key="group.category+':'+group.family" class="workshop-family">
        <small>{{categories.find(c=>c.id===group.category)?.name||'Прочее'}}</small>
        <h3>{{group.family}}</h3>
        <div v-for="image in group.images" :key="image.id" class="workshop-version">
          <strong>{{image.version||image.name}}</strong><span>{{image.name}}</span><span>{{image.format?.toUpperCase()}}</span>
        </div>
      </article>
    </div>
    <p v-else class="secondary-text">Готовых опубликованных систем пока нет.</p>
  </section>
</template>
<style scoped>
.image-workshop{padding:20px;display:grid;gap:18px;min-width:0}
.workshop-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}
.workshop-heading h1{display:flex;align-items:center;gap:9px;margin:0;font-size:20px}
.workshop-heading p{color:var(--muted);font-size:12px}
.workshop-notice{border:1px solid var(--border);border-radius:8px;padding:14px 16px;background:var(--surface-2)}
.workshop-notice p{color:var(--muted);font-size:12px;margin:7px 0}
.workshop-success{color:var(--accent);padding:10px 12px;border:1px solid var(--border);border-radius:8px}
.workshop-steps{display:grid;grid-template-columns:repeat(3,minmax(245px,1fr));gap:14px;align-items:start}
.workshop-card,.workshop-family{border:1px solid var(--border);background:var(--surface);padding:16px;border-radius:9px;display:grid;gap:13px;min-width:0}
.workshop-card h2{display:flex;align-items:center;gap:8px;font-size:15px;margin:0}
.workshop-card label{display:grid;gap:6px;color:var(--muted);font-size:12px}
.workshop-card input{width:100%;min-width:0;padding:9px;border:1px solid var(--border);border-radius:5px;background:var(--surface-2);color:var(--ink)}
.workshop-card button,.workshop-heading button{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:9px 12px;border:1px solid var(--border);border-radius:6px;background:var(--surface-2);color:var(--ink);cursor:pointer}
.workshop-card button:disabled{opacity:.5;cursor:not-allowed}
.workshop-card button.primary{background:var(--accent);color:white}
.workshop-card small{font-size:11px;color:var(--muted)}
.workshop-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.workshop-grid label:first-child{grid-column:1/-1}
.workshop-catalogue{display:grid;grid-template-columns:repeat(auto-fit,minmax(225px,1fr));gap:12px}
.workshop-family h3{margin:0;font-size:15px}
.workshop-family small{color:var(--muted)}
.workshop-version{display:grid;gap:2px;padding:8px 0;border-top:1px solid var(--border);font-size:12px}
.workshop-version span{font-size:11px;color:var(--muted)}
@media(max-width:1100px){.workshop-steps{grid-template-columns:1fr}}
</style>
