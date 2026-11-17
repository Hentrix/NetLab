<script setup lang="ts">
import UiSelect from '@/components/UiSelect.vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { LayoutDashboard, HardDrive, Activity, Moon, Sun, Plus, Play, Square, RotateCcw, Camera, Router, Monitor, Shield, Server, TerminalSquare, Trash2, Cable, GitBranch, Pencil, LogOut, X, ChevronDown } from '@lucide/vue'
import { useNetlabStore } from '@/stores/netlab'
import { api, portLabel } from '@/api/client'
import type { Device, Template, PortSpec } from '@/types'
import TopologyCanvas from '@/components/TopologyCanvas.vue'
import SystemOverview from '@/components/SystemOverview.vue'
import { exportTopology } from '@/topology/snapshot'
import TerminalDock from '@/components/TerminalDock.vue'
import ImageLibrary from '@/components/ImageLibrary.vue'
const store=useNetlabStore()
const tokenEntry=ref(store.token)
const page=ref<'labs'|'images'|'system'>('labs')
const theme=ref<'light' | 'dark'>(localStorage.getItem('netlab-theme')==='dark'?'dark':'light')
const newLab=ref('');const createLabOpen=ref(false)
const addOpen=ref(false)
const requestedNodePosition=ref<{x:number;y:number}|null>(null)
const deviceLogOpen=ref(false)
const deviceLogLoading=ref(false)
const deviceLogName=ref('')
const deviceLogOutput=ref('')
async function showDeviceLog(device:Device){
  const lab=store.activeLab
  if(!lab)return
  deviceLogOpen.value=true
  deviceLogLoading.value=true
  deviceLogName.value=device.name
  deviceLogOutput.value=''
  try{
    const response=await api<{output:string}>(store.token,`labs/${lab.id}/nodes/${device.id}/log`)
    deviceLogOutput.value=response.output||'Журнал пуст'
  }catch(error){deviceLogOutput.value=(error as Error).message}
  finally{deviceLogLoading.value=false}
}
const batchCount=ref(1)
const deviceKind=ref('router')
const deviceIcon=ref('')
const deviceRAM=ref(256)
const deviceCPU=ref(1)
const deviceNicModel=ref('e1000')
const deviceDiskBus=ref('ide')
const devicePortStyle=ref('eth')
const deviceKinds=[{id:'router',name:'Маршрутизатор'},{id:'switch',name:'Коммутатор'},{id:'firewall',name:'Межсетевой экран'},{id:'server',name:'Сервер'},{id:'pc',name:'Компьютер'}]
const defaultKindIcon:Record<string,string>={router:'Router.png',switch:'Layer 2 Switch.png',firewall:'Firewall.png',server:'Server.png',pc:'Desktop.png'}
const templateID=ref('vpcs');const imageID=ref('');const deviceName=ref('');const nicCount=ref(4)
const inFlight=ref(false)
async function removeLab(){
  const lab=store.activeLab
  if(!lab||!confirm(`Удалить лабораторию «${lab.name}» со всеми узлами и overlay-дисками? Действие необратимо.`))return
  await store.deleteLab(lab.id)
}
const search=ref('')
const bulkOpen=ref(false)
const bulkSelected=ref<string[]>([])
const bulkBusy=ref(false)
const bulkCandidates=computed(()=>store.activeLab?.nodes||[])
const bulkNames=computed(()=>bulkCandidates.value.filter(n=>bulkSelected.value.includes(n.id)).map(n=>n.name))
function openBulk(){bulkSelected.value=[];bulkOpen.value=true}
function openBulkFromCanvas(ids:string[]){
  const available=new Set(store.activeLab?.nodes.map(n=>n.id)||[])
  bulkSelected.value=[...new Set(ids)].filter(id=>available.has(id))
  bulkOpen.value=true
}
function selectAllBulk(){bulkSelected.value=bulkCandidates.value.map(n=>n.id)}
function selectRunningBulk(){bulkSelected.value=bulkCandidates.value.filter(n=>n.status==='running').map(n=>n.id)}
function selectStoppedBulk(){bulkSelected.value=bulkCandidates.value.filter(n=>n.status!=='running').map(n=>n.id)}
watch(()=>store.labID,()=>{bulkOpen.value=false;bulkSelected.value=[]})
async function performBulk(operation:'start'|'stop'|'delete'){
  if(bulkBusy.value||!bulkSelected.value.length||!store.activeLab)return
  const existing=new Set(store.activeLab.nodes.map(n=>n.id))
  const ids=bulkSelected.value.filter(id=>existing.has(id))
  if(!ids.length)return
  if(operation==='delete'&&!confirm(`Удалить ${ids.length} устройств со всеми их подключениями? Действие необратимо.`))return
  bulkBusy.value=true
  try{
    const result=await store.bulkNodes(ids,operation)
    const failedIds=new Set(result.failed.map(item=>item.id))
    bulkSelected.value=store.activeLab?.nodes.filter(node=>ids.includes(node.id)&&failedIds.has(node.id)).map(node=>node.id)||[]
    if(!result.failed.length)bulkOpen.value=false
  }finally{bulkBusy.value=false}
}
const selectedTab=ref<'overview'|'ports'>('overview')
const inspectorCollapsed=ref(false)
async function deleteCanvasSelection(ids:string[]){
  if(!ids.length||!confirm(`Удалить выбранные устройства (${ids.length}) со всеми кабелями?`))return
  await store.bulkNodes(ids,'delete')
}
function chooseDroppedTemplate(payload:{templateID:string;x:number;y:number}){
  requestedNodePosition.value={x:payload.x,y:payload.y}
  if(store.templates.some(t=>t.id===payload.templateID)){
    templateID.value=payload.templateID
    changeTemplate()
  }
  addOpen.value=true
}
function onDeviceDrag(event:DragEvent,node:Device){
  if(!event.dataTransfer)return
  event.dataTransfer.setData('application/x-netlab-node',node.id)
  event.dataTransfer.effectAllowed='move'
}
const hardwareOpen=ref(false)
const hardwareSaving=ref(false)
const hardwareID=ref('')
const hardwareDraft=ref<Device|null>(null)
const hardwareLocked=computed(()=>store.activeLab?.nodes.some(node=>node.status==='running')||false)
function editHardware(device:Device){
  if(device.engine==='vpcs')return
  hardwareID.value=device.id
  hardwareDraft.value={...device,ports:device.ports?.map(port=>({...port}))}
  hardwareOpen.value=true
}
async function saveHardware(){
  if(!hardwareDraft.value||hardwareLocked.value||hardwareSaving.value)return
  hardwareSaving.value=true
  try{
    await store.configureQemuNode(hardwareID.value,hardwareDraft.value)
    hardwareOpen.value=false
  }finally{hardwareSaving.value=false}
}
const portEditorOpen=ref(false)
const portEditorDevice=ref('')
const portDraft=ref<PortSpec[]>([])
const portStyleDraft=ref('eth')
const portSaving=ref(false)
const iconPickerOpen=ref(false)
const iconDeviceID=ref('')
const iconCategory=ref('all')
const iconLimit=ref(84)
const iconCategories=[
  {id:'all',name:'Все'},{id:'router',name:'Маршрутизаторы'},{id:'switch',name:'Коммутаторы'},
  {id:'firewall',name:'Безопасность'},{id:'server',name:'Серверы'},
  {id:'pc',name:'ПК'},{id:'cloud',name:'Облака'},{id:'other',name:'Прочее'}
]
function categorizeIcon(name:string){
  const lower=name.toLowerCase()
  if(/router|asr|isr|mx|juniper|vmanage|vedge|cedge/.test(lower))return 'router'
  if(/switch|nexus|catalyst|arista|qfx|vss/.test(lower))return 'switch'
  if(/firewall|asa|forti|palo|checkpoint|sonicwall|sophos|f5|security|ips|ids/.test(lower))return 'firewall'
  if(/server|storage|nas|vm|esxi|database|db|proxmox/.test(lower))return 'server'
  if(/desktop|laptop|phone|tablet|android|pc|host/.test(lower))return 'pc'
  if(/cloud|wan|internet|isp/.test(lower))return 'cloud'
  return 'other'
}
async function loadIconCatalogue(){
  if(iconCatalog.value.length)return
  const response=await fetch('/icons.json',{cache:'force-cache'})
  if(!response.ok)throw Error('Не удалось загрузить каталог иконок')
  const files:unknown=await response.json()
  if(!Array.isArray(files)||!files.every(f=>typeof f==='string'))throw Error('Неверный каталог иконок')
  iconCatalog.value=files as string[]
}
function openCreateIconPicker(){iconDeviceID.value='';iconSearch.value='';iconCategory.value='all';iconLimit.value=84;iconPickerOpen.value=true;void loadIconCatalogue().catch(e=>{store.failure=(e as Error).message})}
const iconSearch=ref('')
const iconCatalog=ref<string[]>([])
const allIconMatches=computed(()=>iconCatalog.value.filter(icon=>
  (iconCategory.value==='all'||categorizeIcon(icon)===iconCategory.value)&&
  icon.toLocaleLowerCase().includes(iconSearch.value.trim().toLocaleLowerCase())
))
const iconMatches=computed(()=>allIconMatches.value.slice(0,iconLimit.value))
watch([iconSearch,iconCategory],()=>{iconLimit.value=84})
async function openIconPicker(device:Device){
  iconDeviceID.value=device.id;iconSearch.value='';iconCategory.value='all';iconLimit.value=84;iconPickerOpen.value=true
  try{await loadIconCatalogue()}catch(error){store.failure=(error as Error).message}
}
async function chooseIcon(icon:string){
  if(!iconDeviceID.value){deviceIcon.value=icon;iconPickerOpen.value=false;return}
  await store.updateNode(iconDeviceID.value,{icon})
  iconPickerOpen.value=false
}
const portStyles=[{value:'eth',name:'eth0, eth1'},{value:'ether',name:'ether1, ether2'},{value:'gi',name:'Gi0/0, Gi0/1'},{value:'fa',name:'Fa0/0, Fa0/1'},{value:'ge',name:'GE0, GE1'},{value:'ens',name:'ens0, ens1'}]
const speeds=[0,10,100,1000,10000,25000,40000,100000]
const terminal=ref<InstanceType<typeof TerminalDock>|null>(null)
const selectedTemplate=computed(()=>store.templates.find(t=>t.id===templateID.value))
const profileSearch=ref('')
const filteredTemplates=computed(()=>store.templates.filter(t=>
  !profileSearch.value.trim()||`${t.name} ${t.kind||''} ${t.engine||''}`.toLocaleLowerCase().includes(profileSearch.value.trim().toLocaleLowerCase())
))
function chooseTemplate(id:string){templateID.value=id;changeTemplate()}
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
const apiLatency=ref<number|null>(null)
const telemetryLastSuccess=ref<string|null>(null)
let telemetryInterval:ReturnType<typeof setInterval>|null=null
async function refreshTelemetry(){
  if(!store.token)return
  const start=performance.now()
  try{
    const metrics=await api<import('@/types').HostMetrics>(store.token,'metrics')
    apiLatency.value=Math.max(0,Math.round(performance.now()-start))
    store.metrics=metrics
    telemetryLastSuccess.value=new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})
  }catch{apiLatency.value=null}
}
let interval:ReturnType<typeof setInterval>|null=null
function toggleTheme(){theme.value=dark.value?'light':'dark';document.documentElement.dataset.theme=theme.value;localStorage.setItem('netlab-theme',theme.value)}
async function login(){store.authenticate(tokenEntry.value);await store.bootstrap();await refreshTelemetry()}
async function submitLab(){if(!newLab.value.trim())return;await store.createLab(newLab.value);createLabOpen.value=false;newLab.value=''}
function openAdd(){
  requestedNodePosition.value=null

  batchCount.value=1
  profileSearch.value=''
  templateID.value=store.templates[0]?.id||'vpcs'
  imageID.value=store.images[0]?.id||''
  deviceName.value=selectedTemplate.value?.name||'Устройство'
  changeTemplate()
  addOpen.value=true
}
function openAddAt(position:{x:number;y:number}){
  openAdd()
  requestedNodePosition.value=position
}
function addFromImage(image:string){
  if(!store.activeLab){store.failure='Сначала выберите лабораторию';return}
  const profile=store.templates.find(t=>t.engine==='qemu')
  if(!profile){store.failure='Нет доступных шаблонов QEMU';return}
  openAdd()
  templateID.value=profile.id
  changeTemplate()
  imageID.value=image
  page.value='labs'
}
function changeTemplate(){
  const t=selectedTemplate.value
  deviceName.value=t?.name||'Устройство'
  deviceKind.value=t?.engine==='vpcs'?'pc':t?.kind||'router'
  deviceIcon.value=defaultKindIcon[deviceKind.value]||'Router.png'
  nicCount.value=t?.engine==='vpcs'?1:t?.nicCount||4
  deviceRAM.value=t?.ram||256
  deviceCPU.value=t?.cpus||1
  deviceNicModel.value=t?.nicModel||'e1000'
  deviceDiskBus.value=t?.diskBus||'ide'
  devicePortStyle.value=t?.portStyle||'eth'
}
async function addDevice(){
  const t:Template|undefined=selectedTemplate.value;if(!t||!store.activeLab)return
  inFlight.value=true
  try{
    const idx=store.activeLab.nodes.length
    const payload: Partial<Device>={name:deviceName.value.trim()||t.name,kind:t.engine==='vpcs'?'pc':deviceKind.value,
      icon:deviceIcon.value||defaultKindIcon[deviceKind.value],engine:t.engine||'qemu',imageId:t.engine==='vpcs'?'':imageID.value,
      nicCount:t.engine==='vpcs'?1:nicCount.value,portStyle:devicePortStyle.value,ram:t.engine==='vpcs'?128:deviceRAM.value,
      cpus:t.engine==='vpcs'?1:deviceCPU.value,nicModel:t.engine==='vpcs'?'e1000':deviceNicModel.value,
      diskBus:t.engine==='vpcs'?'ide':deviceDiskBus.value,
      x:requestedNodePosition.value?.x??(100+(idx%5)*185),y:requestedNodePosition.value?.y??(130+Math.floor(idx/5)*150)}
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
type DeviceContextAction='console'|'start'|'stop'|'rename'|'hardware'|'ports'|'icon'|'delete'|'log'
async function deviceContextAction(payload:{id:string;action:DeviceContextAction}){
  // Resolve the current node by ID: polling can replace store objects while a menu is open.
  const device=store.activeLab?.nodes.find(node=>node.id===payload.id)
  if(!device)return
  try{
    switch(payload.action){
      case 'console': consoleOpen(device);break
      case 'start': await powerNode(device,'start');break
      case 'stop': await powerNode(device,'stop');break
      case 'rename': await rename(device);break
      case 'hardware': editHardware(device);break
      case 'ports': editPorts(device);break
      case 'icon': await openIconPicker(device);break
      case 'log': await showDeviceLog(device);break
      case 'delete': await deleteNode(device);break
    }
  }catch(error){store.failure=(error as Error).message}
}
onMounted(()=>{
  document.documentElement.dataset.theme=theme.value
  if(store.token){void store.bootstrap();void refreshTelemetry()}
  interval=setInterval(()=>{if(store.token&&!inFlight.value&&page.value==='labs')void store.refresh()},3500)
  telemetryInterval=setInterval(()=>{if(store.token&&page.value==='labs')void refreshTelemetry()},15000)
})
onBeforeUnmount(()=>{if(interval)clearInterval(interval);if(telemetryInterval)clearInterval(telemetryInterval)})
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
        <header class="page-title"><div><h1>{{store.activeLab?.name||'Лаборатории'}}</h1><p>Редактор сетевой топологии · Vue 3 + Vue Flow</p></div><div class="header-commands" v-if="store.activeLab"><button @click="powerLab('start')"><Play :size="16"/> Запустить всё</button><button @click="powerLab('stop')"><Square :size="16"/> Остановить всё</button><button @click="openBulk"><Monitor :size="16"/> Массовые действия</button><button @click="screenshot" title="Сохранить топологию в PNG"><Camera :size="16"/> Снимок</button><button title="Обновить" @click="store.refresh()"><RotateCcw :size="16"/></button><button class="danger" title="Удалить лабораторию" @click="removeLab"><Trash2 :size="16"/></button></div></header>
        <div v-if="store.activeLab" class="workspace">
          <aside class="device-list"><header>Устройства <button title="Добавить устройство" @click="openAdd"><Plus :size="17"/></button></header><input v-model="search" placeholder="Поиск устройств" aria-label="Поиск устройств"/><div class="list-scroll"><div v-for="group in deviceGroups" :key="group.id" class="device-category">
            <button class="device-category-title" @click="folded[group.id]=!folded[group.id]" :aria-expanded="!folded[group.id]"><ChevronDown :size="14" class="device-category-chevron" :class="{folded:folded[group.id]}"/>{{group.title}}<small>{{group.devices.length}}</small></button>
            <template v-if="!folded[group.id]"><button v-for="node in group.devices" :key="node.id" class="device-entry" draggable="true" @dragstart="onDeviceDrag($event,node)" :class="{selected:store.selectedID===node.id}" @click="store.selectedID=node.id">
              <img v-if="node.icon" :src="`/icons/${encodeURIComponent(node.icon)}`" alt=""/>
              <component :is="kindIcon(node.kind)==='pc'?Monitor:kindIcon(node.kind)==='shield'?Shield:kindIcon(node.kind)==='server'?Server:Router" v-else :size="22"/>
              <span><b>{{node.name}}</b><small>{{imageName(node)}}</small></span><i :class="node.status"/>
            </button></template>
          </div></div><button class="add-row" @click="openAdd"><Plus :size="16"/> Добавить устройство</button></aside>
          <TopologyCanvas @console="consoleOpen" @add="openAdd" @add-at="openAddAt" @template-at="chooseDroppedTemplate" @delete-selection="deleteCanvasSelection" @bulk="openBulkFromCanvas" @device-action="deviceContextAction" />
          <aside class="inspector" :class="{'inspector-collapsed':inspectorCollapsed}">
            <button type="button" class="inspector-collapse-control" :title="inspectorCollapsed?'Развернуть свойства':'Свернуть свойства'" @click="inspectorCollapsed=!inspectorCollapsed">{{inspectorCollapsed?'‹':'›'}}</button>
            <template v-if="!inspectorCollapsed&&store.selectedNode"><h3>СВОЙСТВА УСТРОЙСТВА</h3><div class="inspector-name">{{store.selectedNode.name}}<small><i :class="store.selectedNode.status"/> {{store.selectedNode.status==='running'?'Запущен':'Остановлен'}}</small></div><div class="inspector-tabs"><button :class="{active:selectedTab==='overview'}" @click="selectedTab='overview'">Обзор</button><button :class="{active:selectedTab==='ports'}" @click="selectedTab='ports'">Интерфейсы</button></div>
            <template v-if="selectedTab==='overview'"><div class="inspector-content"><label>Движок</label><strong>{{store.selectedNode.engine==='vpcs'?'VPCS':'QEMU / KVM'}}</strong><label>vCPU / RAM</label><strong>{{store.selectedNode.engine==='vpcs'?'—':`${store.selectedNode.cpus||1} / ${store.selectedNode.ram||256} МБ`}}</strong><label>Интерфейсы</label><strong>{{store.selectedNode.nicCount||16}}</strong></div><div class="node-actions"><button v-if="store.selectedNode.status==='running'" @click="powerNode(store.selectedNode,'stop')"><Square :size="15"/> Остановить</button><button v-else @click="powerNode(store.selectedNode,'start')"><Play :size="15"/> Запустить</button><button @click="consoleOpen(store.selectedNode)"><TerminalSquare :size="15"/> Консоль</button><button @click="rename(store.selectedNode)"><Pencil :size="15"/> Переименовать</button><button @click="openIconPicker(store.selectedNode)"><Router :size="15"/> Выбрать значок</button><button v-if="store.selectedNode.engine!=='vpcs'" @click="editHardware(store.selectedNode)"><HardDrive :size="15"/> Параметры QEMU</button><button class="danger" @click="deleteNode(store.selectedNode)"><Trash2 :size="15"/> Удалить</button></div></template>
            <template v-else><button class="port-edit-action" @click="editPorts(store.selectedNode)"><Pencil :size="14"/> Настроить имена и скорости</button><div class="port-rows"><div v-for="p in (store.selectedNode.nicCount||16)" :key="p"><span>{{portLabel(store.selectedNode,p-1)}}</span><small>{{selectedLinks.some(l=>(l.a===store.selectedID&&l.aPort===p-1)||(l.b===store.selectedID&&l.bPort===p-1))?'Подключено':'Свободен'}}</small></div></div><h4>Кабели</h4><div v-for="cable in selectedLinks" :key="cable.id" class="cable-row"><Cable :size="14"/>{{cable.aPort}} ↔ {{cable.bPort}}<button title="Отключить кабель" @click="removeCable(cable.id)"><Trash2 :size="14"/></button></div></template>
          </template><div v-else-if="!inspectorCollapsed" class="inspector-empty">Выберите устройство<br/>на топологии</div></aside>
        </div>
        <div v-else class="empty-panel"><Router :size="38"/><h2>Создайте лабораторию</h2><p>Устройства, кабели и настройки будут сохранены на Debian-сервере.</p><button class="primary" @click="createLabOpen=true"><Plus :size="16"/> Новая лаборатория</button></div>
        <footer class="status-bar"><span><i :class="{ok:store.live}"/>{{liveStatus}}</span><span>{{store.activeLab?.nodes.length||0}} устройств</span><span>{{store.activeLab?.links.length||0}} соединений</span><span>{{apiLatency===null?'Задержка API —':`Задержка API ${apiLatency} мс`}}</span>
          <span>{{store.metrics?.savedAt?'Последнее сохранение '+new Date(store.metrics.savedAt).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):'Последнее сохранение —'}}</span>
          <span>{{telemetryLastSuccess?'Телеметрия '+telemetryLastSuccess:'NetLab · Vue'}}</span></footer>
      </template>
      <template v-else-if="page==='images'"><ImageLibrary @create-node="addFromImage"/></template>
      <template v-else><SystemOverview /></template>
      <div v-if="store.failure" role="alert" class="error-toast" @click="store.failure=''">{{store.failure}} <X :size="16"/></div>
    </main>
    <TerminalDock ref="terminal" :theme="theme" />
    <div v-if="deviceLogOpen" class="dialog-overlay" @click.self="deviceLogOpen=false">
      <div class="dialog-card device-log-dialog" role="dialog" :aria-label="'Журнал '+deviceLogName">
        <h2>Журнал · {{deviceLogName}}</h2>
        <p v-if="deviceLogLoading">Загрузка журнала…</p>
        <pre v-else>{{deviceLogOutput}}</pre>
        <div class="dialog-actions"><button type="button" @click="deviceLogOpen=false">Закрыть</button></div>
      </div>
    </div>
    <div v-if="hardwareOpen&&hardwareDraft" class="dialog-overlay" @click.self="!hardwareSaving&&(hardwareOpen=false)">
      <form class="dialog-card hardware-dialog" @submit.prevent="saveHardware">
        <h2>Параметры QEMU</h2>
        <p>Изменения применяются при следующем запуске. Для сохранения необходимо остановить все устройства лаборатории.</p>
        <p v-if="hardwareLocked" class="hardware-warning">Остановите лабораторию перед сохранением параметров.</p>
        <label>Название<input v-model.trim="hardwareDraft.name" maxlength="80" required/></label>
        <label>Тип устройства<UiSelect v-model="hardwareDraft.kind"><option v-for="kind in deviceKinds" :key="kind.id" :value="kind.id">{{kind.name}}</option></UiSelect></label>
        <label>Обозначение интерфейсов<UiSelect v-model="hardwareDraft.portStyle"><option v-for="style in portStyles" :key="style.value" :value="style.value">{{style.name}}</option></UiSelect></label>
        <label>Образ диска<UiSelect v-model="hardwareDraft.imageId" required><option v-for="image in store.images" :key="image.id" :value="image.id">{{image.name}}</option></UiSelect></label>
        <div class="dialog-columns"><label>Оперативная память, МиБ<input v-model.number="hardwareDraft.ram" type="number" min="128" max="131072" required/></label>
        <label>vCPU<input v-model.number="hardwareDraft.cpus" type="number" min="1" max="64" required/></label></div>
        <div class="dialog-columns"><label>Ethernet-порты<input v-model.number="hardwareDraft.nicCount" type="number" min="1" max="16" required/></label>
        <label>Сетевая карта<UiSelect v-model="hardwareDraft.nicModel"><option value="virtio-net-pci">VirtIO</option><option value="e1000">Intel E1000</option><option value="rtl8139">RTL8139</option></UiSelect></label></div>
        <label>Дисковая шина<UiSelect v-model="hardwareDraft.diskBus"><option value="virtio">VirtIO</option><option value="ide">IDE</option><option value="scsi">SCSI</option></UiSelect></label>
        <p>Изменение образа после создания overlay-диска запрещено backend. При уменьшении числа портов сначала удалите кабели, подключённые к исключаемым интерфейсам.</p>
        <div class="dialog-actions"><button type="button" :disabled="hardwareSaving" @click="hardwareOpen=false">Отмена</button><button class="primary" :disabled="hardwareSaving||hardwareLocked">Сохранить</button></div>
      </form>
    </div>
    <div v-if="bulkOpen" class="dialog-overlay" @click.self="!bulkBusy&&(bulkOpen=false)">
      <div class="dialog-card bulk-dialog" role="dialog" aria-label="Массовые действия с устройствами">
        <h2>Массовые действия</h2>
        <p>Выберите устройства текущей лаборатории. Операции выполняются последовательно; при ошибке успешные изменения сохраняются.</p>
        <div class="bulk-tools"><button type="button" @click="selectAllBulk">Выбрать все</button><button type="button" @click="selectRunningBulk">Запущенные</button><button type="button" @click="selectStoppedBulk">Остановленные</button><button type="button" @click="bulkSelected=[]">Сбросить</button></div>
        <div class="bulk-node-list"><label v-for="node in bulkCandidates" :key="node.id" class="bulk-node-row"><input v-model="bulkSelected" type="checkbox" :value="node.id" :disabled="bulkBusy"/><span>{{node.name}}</span><small>{{node.status==='running'?'Запущен':'Остановлен'}}</small></label></div>
        <p class="bulk-count">Выбрано: {{bulkNames.length}}</p>
        <div class="dialog-actions"><button type="button" :disabled="bulkBusy" @click="bulkOpen=false">Закрыть</button><button type="button" :disabled="bulkBusy||!bulkSelected.length" @click="performBulk('start')"><Play :size="14"/> Запустить</button><button type="button" :disabled="bulkBusy||!bulkSelected.length" @click="performBulk('stop')"><Square :size="14"/> Остановить</button><button type="button" class="bulk-delete" :disabled="bulkBusy||!bulkSelected.length" @click="performBulk('delete')"><Trash2 :size="14"/> Удалить</button></div>
      </div>
    </div>
    <div v-if="createLabOpen" class="dialog-overlay" @click.self="createLabOpen=false"><form class="dialog-card" @submit.prevent="submitLab"><h2>Новая лаборатория</h2><label>Название<input v-model="newLab" required maxlength="80" autofocus/></label><div class="dialog-actions"><button type="button" @click="createLabOpen=false">Отмена</button><button class="primary">Создать</button></div></form></div>
    <div v-if="iconPickerOpen" class="dialog-overlay" @click.self="iconPickerOpen=false">
      <div class="dialog-card icon-picker-dialog" role="dialog" aria-label="Каталог иконок">
        <h2>Выбрать иконку устройства</h2>
        <input v-model="iconSearch" placeholder="Поиск по названию значка" aria-label="Поиск иконок"/>
        <div class="icon-category-row"><button v-for="category in iconCategories" :key="category.id" type="button"
          :class="{active:iconCategory===category.id}" @click="iconCategory=category.id">{{category.name}}</button></div>
        <small class="icon-result-count">Найдено {{allIconMatches.length}} из {{iconCatalog.length}} значков</small>
        <div class="icon-picker-list">
          <button v-for="icon in iconMatches" :key="icon" type="button" @click="chooseIcon(icon)" :title="icon">
            <img :src="`/icons/${encodeURIComponent(icon)}`" alt=""/><span>{{icon.replace('.png','')}}</span>
          </button>
          <p v-if="!iconMatches.length">Иконки не найдены</p>
        </div>
        <button v-if="iconLimit<allIconMatches.length" type="button" class="icon-load-more" @click="iconLimit+=84">Показать ещё ({{allIconMatches.length-iconMatches.length}})</button>
        <div class="dialog-actions"><button @click="iconPickerOpen=false">Закрыть</button></div>
      </div>
    </div>
    <div v-if="portEditorOpen" class="dialog-overlay" @click.self="portEditorOpen=false">
      <form class="dialog-card port-editor-dialog" @submit.prevent="savePorts">
        <h2>Настройка интерфейсов</h2>
        <p>Имена и номинальные скорости — подписи топологии, они не меняют скорость сетевой карты QEMU.</p>
        <label>Стиль портов<UiSelect v-model="portStyleDraft"><option v-for="style in portStyles" :key="style.value" :value="style.value">{{style.name}}</option></UiSelect></label>
        <div class="port-editor-grid">
          <div v-for="(port,i) in portDraft" :key="i" class="port-editor-row">
            <strong>№ {{i+1}}</strong>
            <label>Имя<input v-model.trim="port.name" maxlength="32" :placeholder="'Имя по стилю '+portStyleDraft"/></label>
            <label>Скорость<UiSelect v-model.number="port.speedMbps"><option v-for="speed in speeds" :key="speed" :value="speed">{{speed===0?'Не задана':speed+' Мбит/с'}}</option></UiSelect></label>
          </div>
        </div>
        <div class="dialog-actions"><button type="button" @click="portEditorOpen=false">Отмена</button><button class="primary" :disabled="portSaving">Сохранить</button></div>
      </form>
    </div>
    <div v-if="addOpen" class="dialog-overlay" @click.self="addOpen=false">
      <form class="dialog-card device-create-dialog" @submit.prevent="addDevice">
        <h2>Добавить устройство</h2>
        <p>Выберите профиль эмулятора. Параметры будут использованы при создании новых устройств.</p>
        <input v-model="profileSearch" placeholder="Поиск профиля" aria-label="Поиск профиля"/>
        <div class="profile-catalog" role="group" aria-label="Профили устройств">
          <button v-for="profile in filteredTemplates" :key="profile.id" type="button" class="profile-card"
            :class="{active:templateID===profile.id}" :aria-pressed="templateID===profile.id" @click="chooseTemplate(profile.id)">
            <Monitor v-if="profile.engine==='vpcs'" :size="20"/><Router v-else :size="20"/>
            <span><strong>{{profile.name}}</strong><small>{{profile.engine==='vpcs'?'VPCS · без образа':'QEMU / KVM'}} · {{profile.nicCount|| (profile.engine==='vpcs'?1:16)}} портов</small></span>
          </button>
          <p v-if="!filteredTemplates.length">Профили не найдены.</p>
        </div>
        <label>Название<input v-model="deviceName" required maxlength="80"/></label>
        <label>Количество<input v-model.number="batchCount" type="number" min="1" max="32" required/></label>
        <label v-if="selectedTemplate?.engine!=='vpcs'">Тип на схеме<UiSelect v-model="deviceKind" @change="deviceIcon=defaultKindIcon[deviceKind]||'Router.png'"><option v-for="kind in deviceKinds" :key="kind.id" :value="kind.id">{{kind.name}}</option></UiSelect></label>
        <label>Значок на схеме<button type="button" class="device-icon-choice" @click="openCreateIconPicker">
          <img v-if="deviceIcon" :src="`/icons/${encodeURIComponent(deviceIcon)}`" alt=""/>{{deviceIcon||'Выбрать значок'}} · Изменить
        </button></label>
        <label>Обозначение интерфейсов<UiSelect v-model="devicePortStyle"><option v-for="style in portStyles" :key="style.value" :value="style.value">{{style.name}}</option></UiSelect></label>
        <template v-if="selectedTemplate?.engine!=='vpcs'">
          <label>Образ<UiSelect v-model="imageID" required><option v-for="image in store.images" :key="image.id" :value="image.id">{{image.name}}</option></UiSelect></label>
          <div class="dialog-columns"><label>RAM (МиБ)<input v-model.number="deviceRAM" type="number" min="128" max="131072" required/></label>
          <label>vCPU<input v-model.number="deviceCPU" type="number" min="1" max="64" required/></label></div>
          <div class="dialog-columns"><label>Сетевая карта<UiSelect v-model="deviceNicModel"><option value="virtio-net-pci">VirtIO</option><option value="e1000">Intel E1000</option><option value="rtl8139">RTL8139</option></UiSelect></label>
          <label>Шина диска<UiSelect v-model="deviceDiskBus"><option value="virtio">VirtIO</option><option value="ide">IDE</option><option value="scsi">SCSI</option></UiSelect></label></div>
          <label>Число Ethernet-портов<input v-model.number="nicCount" type="number" min="1" max="16" required/></label>
          <p v-if="!store.images.length">Для QEMU необходимо сначала загрузить образ в библиотеку.</p>
        </template>
        <p v-else>VPCS не требует образа диска. Доступен один интерфейс eth0.</p>
        <div class="dialog-actions"><button type="button" @click="addOpen=false">Отмена</button>
          <button class="primary" :disabled="inFlight||!selectedTemplate||(selectedTemplate.engine!=='vpcs'&&!imageID)">Добавить</button></div>
      </form>
    </div>
  </div>
</template>
