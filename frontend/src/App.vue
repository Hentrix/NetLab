<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { LayoutDashboard, HardDrive, Activity, Moon, Sun, Plus, Play, Square, RotateCcw, Camera, Router, Monitor, Shield, Server, TerminalSquare, Trash2, Cable, GitBranch, Pencil, LogOut, X, ChevronDown } from '@lucide/vue'
import { useNetlabStore } from '@/stores/netlab'
import { portLabel } from '@/api/client'
import type { Device, Template, PortSpec } from '@/types'
import TopologyCanvas from '@/components/TopologyCanvas.vue'
import SystemOverview from '@/components/SystemOverview.vue'
import { exportTopology } from '@/topology/snapshot'
import TerminalDock from '@/components/TerminalDock.vue'
const store=useNetlabStore()
const tokenEntry=ref(store.token)
const page=ref<'labs'|'images'|'system'>('labs')
const theme=ref<'light' | 'dark'>(localStorage.getItem('netlab-theme')==='dark'?'dark':'light')
const newLab=ref('');const createLabOpen=ref(false)
const addOpen=ref(false)
const batchCount=ref(1)
const templateID=ref('vpcs');const imageID=ref('');const deviceName=ref('');const nicCount=ref(4)
const inFlight=ref(false)
const uploadBusy=ref(false)
const imageFile=ref<File|null>(null)
async function uploadSelectedImage(){
  if(!imageFile.value||uploadBusy.value)return
  uploadBusy.value=true
  try { await store.uploadImage(imageFile.value); imageFile.value=null }
  finally { uploadBusy.value=false }
}
function selectImageFile(event:Event){
  imageFile.value=(event.target as HTMLInputElement).files?.[0]||null
}
async function removeImage(id:string){
  if(!confirm('Удалить образ? Он не должен использоваться устройствами.'))return
  await store.deleteImage(id)
}
async function removeLab(){
  const lab=store.activeLab
  if(!lab||!confirm(`Удалить лабораторию «${lab.name}» со всеми узлами и overlay-дисками? Действие необратимо.`))return
  await store.deleteLab(lab.id)
}
const search=ref('')
const selectedTab=ref<'overview'|'ports'>('overview')
const portEditorOpen=ref(false)
const portEditorDevice=ref('')
const portDraft=ref<PortSpec[]>([])
const portStyleDraft=ref('eth')
const portSaving=ref(false)
const iconPickerOpen=ref(false)
const iconDeviceID=ref('')
const iconSearch=ref('')
const iconCatalog=ref<string[]>([])
const iconMatches=computed(()=>iconCatalog.value.filter(icon=>icon.toLowerCase().includes(iconSearch.value.toLowerCase())).slice(0,120))
async function openIconPicker(device:Device){
  iconDeviceID.value=device.id;iconSearch.value='';iconPickerOpen.value=true
  if(!iconCatalog.value.length){
    try {
      const response=await fetch('/icons.json',{cache:'force-cache'})
      if(!response.ok)throw new Error('Не удалось загрузить каталог иконок')
      const files:unknown=await response.json()
      if(!Array.isArray(files)||!files.every(file=>typeof file==='string'))throw new Error('Неверный каталог иконок')
      iconCatalog.value=files as string[]
    }catch(error){store.failure=(error as Error).message}
  }
}
async function chooseIcon(icon:string){
  await store.updateNode(iconDeviceID.value,{icon});iconPickerOpen.value=false
}
const portStyles=[{value:'eth',name:'eth0, eth1'},{value:'ether',name:'ether1, ether2'},{value:'gi',name:'Gi0/0, Gi0/1'},{value:'fa',name:'Fa0/0, Fa0/1'},{value:'ge',name:'GE0, GE1'},{value:'ens',name:'ens0, ens1'}]
const speeds=[0,10,100,1000,10000,25000,40000,100000]
const terminal=ref<InstanceType<typeof TerminalDock>|null>(null)
const selectedTemplate=computed(()=>store.templates.find(t=>t.id===templateID.value))
const filteredNodes=computed(()=>store.activeLab?.nodes.filter(n=>n.name.toLowerCase().includes(search.value.toLowerCase()))||[])
const deviceGroups=computed(()=>[
  {id:'routers',title:'Маршрутизаторы',devices:filteredNodes.value.filter(n=>['router','switch','firewall'].includes(n.kind||''))},
  {id:'endpoints',title:'Конечные устройства',devices:filteredNodes.value.filter(n=>!['router','switch','firewall'].includes(n.kind||''))}
].filter(group=>group.devices.length))
const folded=ref<Record<string,boolean>>({})
const imageName=(device:Device)=>device.engine==='vpcs'?'VPCS · без образа':store.images.find(img=>img.id===device.imageId)?.name||device.kind||'QEMU'
async function screenshot(){if(store.activeLab)try{await exportTopology(store.activeLab,dark.value)}catch(e){store.failure=(e as Error).message}}

const selectedLinks=computed(()=>store.activeLab?.links.filter(l=>l.a===store.selectedID||l.b===store.selectedID)||[])
const dark=computed(()=>theme.value==='dark')
const liveStatus=computed(()=>store.live?'Сервер подключён':'Нет соединения')
let interval:ReturnType<typeof setInterval>|null=null
function toggleTheme(){theme.value=dark.value?'light':'dark';document.documentElement.dataset.theme=theme.value;localStorage.setItem('netlab-theme',theme.value)}
async function login(){store.authenticate(tokenEntry.value);await store.bootstrap()}
async function submitLab(){if(!newLab.value.trim())return;await store.createLab(newLab.value);createLabOpen.value=false;newLab.value=''}
function openAdd(){batchCount.value=1;templateID.value=store.templates[0]?.id||'vpcs';imageID.value=store.images[0]?.id||'';deviceName.value=selectedTemplate.value?.name||'Устройство';nicCount.value=selectedTemplate.value?.nicCount||4;addOpen.value=true}
function changeTemplate(){deviceName.value=selectedTemplate.value?.name||'Устройство';nicCount.value=selectedTemplate.value?.engine==='vpcs'?1:selectedTemplate.value?.nicCount||4}
async function addDevice(){
  const t:Template|undefined=selectedTemplate.value;if(!t||!store.activeLab)return
  inFlight.value=true
  try{
    const idx=store.activeLab.nodes.length
    const payload: Partial<Device>={name:deviceName.value.trim()||t.name,kind:t.kind||'router',engine:t.engine||'qemu',imageId:t.engine==='vpcs'?'':imageID.value,
      nicCount:t.engine==='vpcs'?1:nicCount.value,portStyle:t.portStyle||'eth',ram:t.ram||256,cpus:t.cpus||1,
      nicModel:t.nicModel||'e1000',diskBus:t.diskBus||'ide',x:100+(idx%5)*185,y:130+Math.floor(idx/5)*150}
    if(batchCount.value>1)await store.addNodesBatch(payload,batchCount.value)
    else await store.addNode(payload)
    addOpen.value=false
  }finally{inFlight.value=false}
}
async function powerNode(device:Device,op:'start'|'stop'){await store.nodePower(device.id,op)}
async function deleteNode(device:Device){if(!window.confirm(`Удалить ${device.name} и его соединения?`))return;await store.removeNode(device.id)}
async function rename(device:Device){const name=window.prompt('Название устройства',device.name);if(name?.trim()&&name!==device.name)await store.renameNode(device.id,name.trim())}
function editPorts(device:Device){
  portEditorDevice.value=device.id
  portStyleDraft.value=device.portStyle||'eth'
  portDraft.value=Array.from({length:device.nicCount||16},(_,i)=>({
    name:device.ports?.[i]?.name||'',
    speedMbps:device.ports?.[i]?.speedMbps||0
  }))
  portEditorOpen.value=true
}
async function savePorts(){
  if(!portEditorDevice.value||portSaving.value)return
  portSaving.value=true
  try{
    await store.updateNode(portEditorDevice.value,{portStyle:portStyleDraft.value,ports:portDraft.value})
    portEditorOpen.value=false
  }finally{portSaving.value=false}
}
async function removeCable(id:string){if(window.confirm('Отключить Ethernet-кабель?'))await store.disconnect(id)}
async function powerLab(op:'start'|'stop'){await store.labPower(op)}
function kindIcon(kind?:string){return kind==='pc'?'pc':kind==='firewall'?'shield':kind==='server'?'server':'router'}
function consoleOpen(device:Device){terminal.value?.open(device)}
onMounted(()=>{document.documentElement.dataset.theme=theme.value;if(store.token)void store.bootstrap();interval=setInterval(()=>{if(store.token&&!inFlight.value&&page.value==='labs')void store.refresh()},3500)})
onBeforeUnmount(()=>{if(interval)clearInterval(interval)})
</script>
<template>
  <div class="app-shell">
    <aside class="side-nav">
      <header class="brand"><span class="brand-mark"><Router :size="23"/></span><span><strong>NETLAB</strong><small>NETWORK EMULATION</small></span></header>
      <div class="side-group-label">РАБОЧАЯ ОБЛАСТЬ</div>
      <button class="nav-link" :class="{active:page==='labs'}" @click="page='labs'"><LayoutDashboard :size="17"/> Лаборатории</button>
      <button class="nav-link" :class="{active:page==='images'}" @click="page='images'"><HardDrive :size="17"/> Библиотека образов</button>
      <button class="nav-link" :class="{active:page==='system'}" @click="page='system'"><Activity :size="17"/> Система</button>
      <div class="side-group-label">ЛАБОРАТОРИИ <button title="Новая лаборатория" @click="createLabOpen=true"><Plus :size="15"/></button></div>
      <div class="lab-list"><button v-for="lab in store.labs" :key="lab.id" :class="{active:store.labID===lab.id}" @click="store.labID=lab.id;page='labs';store.selectedID=null"><span class="lab-dot"/>{{lab.name}}</button><p v-if="!store.labs.length" class="secondary-text">Лабораторий пока нет</p></div>
      <div class="side-bottom"><a href="/" title="Текущий стабильный интерфейс">Старый интерфейс</a><a href="https://github.com/Hentrix/NetLab" target="_blank" rel="noreferrer"><GitBranch :size="16"/></a></div>
    </aside>
    <main class="main-view">
      <header class="top-bar"><span class="breadcrumbs">NETLAB / <strong>{{page==='labs'?(store.activeLab?.name||'Лаборатории'):page==='images'?'Образы':'Система'}}</strong></span>
        <div class="top-actions"><span class="small-status"><i :class="{ok:store.live}"/>{{liveStatus}}</span><button title="Светлая / тёмная тема" @click="toggleTheme"><Sun v-if="dark" :size="17"/><Moon v-else :size="17"/>{{dark?'Светлая':'Тёмная'}}</button><button title="Выйти" @click="store.logout()"><LogOut :size="17"/></button></div>
      </header>
      <template v-if="!store.token">
        <form class="login-card" @submit.prevent="login"><Router :size="34"/><h1>Вход в NetLab</h1><p>Токен администратора хранится только в текущей вкладке браузера.</p><label>Токен<input v-model="tokenEntry" type="password" autocomplete="off" required/></label><button class="primary" type="submit">Войти</button></form>
      </template>
      <template v-else-if="page==='labs'">
        <header class="page-title"><div><h1>{{store.activeLab?.name||'Лаборатории'}}</h1><p>Редактор сетевой топологии · Vue 3 + Vue Flow</p></div><div class="header-commands" v-if="store.activeLab"><button @click="powerLab('start')"><Play :size="16"/> Запустить всё</button><button @click="powerLab('stop')"><Square :size="16"/> Остановить всё</button><button @click="screenshot" title="Сохранить топологию в PNG"><Camera :size="16"/> Снимок</button><button title="Обновить" @click="store.refresh()"><RotateCcw :size="16"/></button><button class="danger" title="Удалить лабораторию" @click="removeLab"><Trash2 :size="16"/></button></div></header>
        <div v-if="store.activeLab" class="workspace">
          <aside class="device-list"><header>Устройства <button title="Добавить устройство" @click="openAdd"><Plus :size="17"/></button></header><input v-model="search" placeholder="Поиск устройств" aria-label="Поиск устройств"/><div class="list-scroll"><div v-for="group in deviceGroups" :key="group.id" class="device-category">
            <button class="device-category-title" @click="folded[group.id]=!folded[group.id]" :aria-expanded="!folded[group.id]"><ChevronDown :size="14" class="device-category-chevron" :class="{folded:folded[group.id]}"/>{{group.title}}<small>{{group.devices.length}}</small></button>
            <template v-if="!folded[group.id]"><button v-for="node in group.devices" :key="node.id" class="device-entry" :class="{selected:store.selectedID===node.id}" @click="store.selectedID=node.id">
              <img v-if="node.icon" :src="`/icons/${encodeURIComponent(node.icon)}`" alt=""/>
              <component :is="kindIcon(node.kind)==='pc'?Monitor:kindIcon(node.kind)==='shield'?Shield:kindIcon(node.kind)==='server'?Server:Router" v-else :size="22"/>
              <span><b>{{node.name}}</b><small>{{imageName(node)}}</small></span><i :class="node.status"/>
            </button></template>
          </div></div><button class="add-row" @click="openAdd"><Plus :size="16"/> Добавить устройство</button></aside>
          <TopologyCanvas @console="consoleOpen" @add="openAdd" />
          <aside class="inspector"><template v-if="store.selectedNode"><h3>СВОЙСТВА УСТРОЙСТВА</h3><div class="inspector-name">{{store.selectedNode.name}}<small><i :class="store.selectedNode.status"/> {{store.selectedNode.status==='running'?'Запущен':'Остановлен'}}</small></div><div class="inspector-tabs"><button :class="{active:selectedTab==='overview'}" @click="selectedTab='overview'">Обзор</button><button :class="{active:selectedTab==='ports'}" @click="selectedTab='ports'">Интерфейсы</button></div>
            <template v-if="selectedTab==='overview'"><div class="inspector-content"><label>Движок</label><strong>{{store.selectedNode.engine==='vpcs'?'VPCS':'QEMU / KVM'}}</strong><label>vCPU / RAM</label><strong>{{store.selectedNode.engine==='vpcs'?'—':`${store.selectedNode.cpus||1} / ${store.selectedNode.ram||256} МБ`}}</strong><label>Интерфейсы</label><strong>{{store.selectedNode.nicCount||16}}</strong></div><div class="node-actions"><button v-if="store.selectedNode.status==='running'" @click="powerNode(store.selectedNode,'stop')"><Square :size="15"/> Остановить</button><button v-else @click="powerNode(store.selectedNode,'start')"><Play :size="15"/> Запустить</button><button @click="consoleOpen(store.selectedNode)"><TerminalSquare :size="15"/> Консоль</button><button @click="rename(store.selectedNode)"><Pencil :size="15"/> Переименовать</button><button @click="openIconPicker(store.selectedNode)"><Router :size="15"/> Выбрать значок</button><button class="danger" @click="deleteNode(store.selectedNode)"><Trash2 :size="15"/> Удалить</button></div></template>
            <template v-else><button class="port-edit-action" @click="editPorts(store.selectedNode)"><Pencil :size="14"/> Настроить имена и скорости</button><div class="port-rows"><div v-for="p in (store.selectedNode.nicCount||16)" :key="p"><span>{{portLabel(store.selectedNode,p-1)}}</span><small>{{selectedLinks.some(l=>(l.a===store.selectedID&&l.aPort===p-1)||(l.b===store.selectedID&&l.bPort===p-1))?'Подключено':'Свободен'}}</small></div></div><h4>Кабели</h4><div v-for="cable in selectedLinks" :key="cable.id" class="cable-row"><Cable :size="14"/>{{cable.aPort}} ↔ {{cable.bPort}}<button title="Отключить кабель" @click="removeCable(cable.id)"><Trash2 :size="14"/></button></div></template>
          </template><div v-else class="inspector-empty">Выберите устройство<br/>на топологии</div></aside>
        </div>
        <div v-else class="empty-panel"><Router :size="38"/><h2>Создайте лабораторию</h2><p>Устройства, кабели и настройки будут сохранены на Debian-сервере.</p><button class="primary" @click="createLabOpen=true"><Plus :size="16"/> Новая лаборатория</button></div>
        <footer class="status-bar"><span><i :class="{ok:store.live}"/>{{liveStatus}}</span><span>{{store.activeLab?.nodes.length||0}} устройств</span><span>{{store.activeLab?.links.length||0}} соединений</span><span>NetLab · экспериментальный Vue-редактор</span></footer>
      </template>
      <template v-else-if="page==='images'"><div class="simple-page"><h1>Библиотека образов</h1><p>QCOW2 и RAW загружаются на сервер. Для импорта используется проверка формата через qemu-img.</p>
        <form class="image-upload" @submit.prevent="uploadSelectedImage"><label>Файл диска<input type="file" accept=".qcow2,.img,.raw,.qcow" @change="selectImageFile"/></label><button class="primary" type="submit" :disabled="uploadBusy||!imageFile">{{uploadBusy?'Загрузка…':'Загрузить образ'}}</button></form>
        <div v-for="image in store.images" :key="image.id" class="list-row"><HardDrive :size="18"/><span>{{image.name}}</span><small>{{image.format}} · {{image.size?Math.round(image.size/1048576)+' МиБ':''}}</small><button class="danger" title="Удалить образ" @click="removeImage(image.id)"><Trash2 :size="15"/></button></div>
        <p v-if="!store.images.length">Образы пока не загружены.</p></div></template>
      <template v-else><SystemOverview /></template>
      <div v-if="store.failure" role="alert" class="error-toast" @click="store.failure=''">{{store.failure}} <X :size="16"/></div>
    </main>
    <TerminalDock ref="terminal" :theme="theme" />
    <div v-if="createLabOpen" class="dialog-overlay" @click.self="createLabOpen=false"><form class="dialog-card" @submit.prevent="submitLab"><h2>Новая лаборатория</h2><label>Название<input v-model="newLab" required maxlength="80" autofocus/></label><div class="dialog-actions"><button type="button" @click="createLabOpen=false">Отмена</button><button class="primary">Создать</button></div></form></div>
    <div v-if="iconPickerOpen" class="dialog-overlay" @click.self="iconPickerOpen=false">
      <div class="dialog-card icon-picker-dialog" role="dialog" aria-label="Каталог иконок">
        <h2>Выбрать иконку устройства</h2>
        <input v-model="iconSearch" placeholder="Поиск среди 550 иконок" aria-label="Поиск иконок"/>
        <div class="icon-picker-list">
          <button v-for="icon in iconMatches" :key="icon" type="button" @click="chooseIcon(icon)" :title="icon">
            <img :src="`/icons/${encodeURIComponent(icon)}`" alt=""/><span>{{icon.replace('.png','')}}</span>
          </button>
          <p v-if="!iconMatches.length">Иконки не найдены</p>
        </div>
        <div class="dialog-actions"><button @click="iconPickerOpen=false">Закрыть</button></div>
      </div>
    </div>
    <div v-if="portEditorOpen" class="dialog-overlay" @click.self="portEditorOpen=false">
      <form class="dialog-card port-editor-dialog" @submit.prevent="savePorts">
        <h2>Настройка интерфейсов</h2>
        <p>Имена и номинальные скорости — подписи топологии, они не меняют скорость сетевой карты QEMU.</p>
        <label>Стиль портов<select v-model="portStyleDraft"><option v-for="style in portStyles" :key="style.value" :value="style.value">{{style.name}}</option></select></label>
        <div class="port-editor-grid">
          <div v-for="(port,i) in portDraft" :key="i" class="port-editor-row">
            <strong>№ {{i+1}}</strong>
            <label>Имя<input v-model.trim="port.name" maxlength="32" :placeholder="'Имя по стилю '+portStyleDraft"/></label>
            <label>Скорость<select v-model.number="port.speedMbps"><option v-for="speed in speeds" :key="speed" :value="speed">{{speed===0?'Не задана':speed+' Мбит/с'}}</option></select></label>
          </div>
        </div>
        <div class="dialog-actions"><button type="button" @click="portEditorOpen=false">Отмена</button><button class="primary" :disabled="portSaving">Сохранить</button></div>
      </form>
    </div>
    <div v-if="addOpen" class="dialog-overlay" @click.self="addOpen=false"><form class="dialog-card" @submit.prevent="addDevice"><h2>Добавить устройство</h2><label>Профиль<select v-model="templateID" @change="changeTemplate"><option v-for="t in store.templates" :key="t.id" :value="t.id">{{t.name}}</option></select></label><label>Название<input v-model="deviceName" required /></label><label>Количество<input v-model.number="batchCount" type="number" min="1" max="32" required /></label><template v-if="selectedTemplate?.engine!=='vpcs'"><label>Образ<select v-model="imageID" required><option v-for="i in store.images" :key="i.id" :value="i.id">{{i.name}}</option></select></label><label>Число Ethernet-портов<input v-model.number="nicCount" type="number" min="1" max="32"/></label></template><p v-else>VPCS не требует образа диска. Доступен один порт eth0.</p><div class="dialog-actions"><button type="button" @click="addOpen=false">Отмена</button><button class="primary" :disabled="inFlight||(selectedTemplate?.engine!=='vpcs'&&!imageID)">Добавить</button></div></form></div>
  </div>
</template>
