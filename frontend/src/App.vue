<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { LayoutDashboard, HardDrive, Activity, Moon, Sun, Plus, Play, Square, RotateCcw, Router, Monitor, Shield, Server, TerminalSquare, Trash2, Cable, Github, Pencil, LogOut, X } from 'lucide-vue-next'
import { useNetlabStore } from '@/stores/netlab'
import { portLabel } from '@/api/client'
import type { Device, Template } from '@/types'
import TopologyCanvas from '@/components/TopologyCanvas.vue'
import TerminalDock from '@/components/TerminalDock.vue'
const store=useNetlabStore()
const tokenEntry=ref(store.token)
const page=ref<'labs'|'images'|'system'>('labs')
const theme=ref(localStorage.getItem('netlab-theme')==='dark'?'dark':'light')
const newLab=ref('');const createLabOpen=ref(false)
const addOpen=ref(false)
const templateID=ref('vpcs');const imageID=ref('');const deviceName=ref('');const nicCount=ref(4)
const inFlight=ref(false)
const search=ref('')
const selectedTab=ref<'overview'|'ports'>('overview')
const terminal=ref<InstanceType<typeof TerminalDock>|null>(null)
const selectedTemplate=computed(()=>store.templates.find(t=>t.id===templateID.value))
const filteredNodes=computed(()=>store.activeLab?.nodes.filter(n=>n.name.toLowerCase().includes(search.value.toLowerCase()))||[])
const selectedLinks=computed(()=>store.activeLab?.links.filter(l=>l.a===store.selectedID||l.b===store.selectedID)||[])
const dark=computed(()=>theme.value==='dark')
const liveStatus=computed(()=>store.live?'Сервер подключён':'Нет соединения')
let interval:ReturnType<typeof setInterval>|null=null
function toggleTheme(){theme.value=dark.value?'light':'dark';document.documentElement.dataset.theme=theme.value;localStorage.setItem('netlab-theme',theme.value)}
async function login(){store.authenticate(tokenEntry.value);await store.bootstrap()}
async function submitLab(){if(!newLab.value.trim())return;await store.createLab(newLab.value);createLabOpen.value=false;newLab.value=''}
function openAdd(){templateID.value=store.templates[0]?.id||'vpcs';imageID.value=store.images[0]?.id||'';deviceName.value=selectedTemplate.value?.name||'Устройство';nicCount.value=selectedTemplate.value?.nicCount||4;addOpen.value=true}
function changeTemplate(){deviceName.value=selectedTemplate.value?.name||'Устройство';nicCount.value=selectedTemplate.value?.engine==='vpcs'?1:selectedTemplate.value?.nicCount||4}
async function addDevice(){
  const t:Template|undefined=selectedTemplate.value;if(!t||!store.activeLab)return
  inFlight.value=true
  try{
    const idx=store.activeLab.nodes.length
    await store.addNode({name:deviceName.value.trim()||t.name,kind:t.kind||'router',engine:t.engine||'qemu',imageId:t.engine==='vpcs'?'':imageID.value,
      nicCount:t.engine==='vpcs'?1:nicCount.value,portStyle:t.portStyle||'eth',ram:t.ram||256,cpus:t.cpus||1,
      nicModel:t.nicModel||'e1000',diskBus:t.diskBus||'ide',x:100+(idx%5)*185,y:130+Math.floor(idx/5)*150})
    addOpen.value=false
  }finally{inFlight.value=false}
}
async function powerNode(device:Device,op:'start'|'stop'){await store.nodePower(device.id,op)}
async function deleteNode(device:Device){if(!window.confirm(`Удалить ${device.name} и его соединения?`))return;await store.removeNode(device.id)}
async function rename(device:Device){const name=window.prompt('Название устройства',device.name);if(name?.trim()&&name!==device.name)await store.renameNode(device.id,name.trim())}
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
      <div class="side-bottom"><a href="/" title="Текущий стабильный интерфейс">Старый интерфейс</a><a href="https://github.com/Hentrix/NetLab" target="_blank" rel="noreferrer"><Github :size="16"/></a></div>
    </aside>
    <main class="main-view">
      <header class="top-bar"><span class="breadcrumbs">NETLAB / <strong>{{page==='labs'?(store.activeLab?.name||'Лаборатории'):page==='images'?'Образы':'Система'}}</strong></span>
        <div class="top-actions"><span class="small-status"><i :class="{ok:store.live}"/>{{liveStatus}}</span><button title="Светлая / тёмная тема" @click="toggleTheme"><Sun v-if="dark" :size="17"/><Moon v-else :size="17"/>{{dark?'Светлая':'Тёмная'}}</button><button title="Выйти" @click="store.logout()"><LogOut :size="17"/></button></div>
      </header>
      <template v-if="!store.token">
        <form class="login-card" @submit.prevent="login"><Router :size="34"/><h1>Вход в NetLab</h1><p>Токен администратора хранится только в текущей вкладке браузера.</p><label>Токен<input v-model="tokenEntry" type="password" autocomplete="off" required/></label><button class="primary" type="submit">Войти</button></form>
      </template>
      <template v-else-if="page==='labs'">
        <header class="page-title"><div><h1>{{store.activeLab?.name||'Лаборатории'}}</h1><p>Редактор сетевой топологии · Vue 3 + Vue Flow</p></div><div class="header-commands" v-if="store.activeLab"><button @click="powerLab('start')"><Play :size="16"/> Запустить всё</button><button @click="powerLab('stop')"><Square :size="16"/> Остановить всё</button><button title="Обновить" @click="store.refresh()"><RotateCcw :size="16"/></button></div></header>
        <div v-if="store.activeLab" class="workspace">
          <aside class="device-list"><header>Устройства <button title="Добавить устройство" @click="openAdd"><Plus :size="17"/></button></header><input v-model="search" placeholder="Поиск устройств" aria-label="Поиск устройств"/><div class="list-scroll"><button v-for="node in filteredNodes" :key="node.id" class="device-entry" :class="{selected:store.selectedID===node.id}" @click="store.selectedID=node.id"><img v-if="node.icon" :src="`/icons/${encodeURIComponent(node.icon)}`" alt=""/><component :is="kindIcon(node.kind)==='pc'?Monitor:kindIcon(node.kind)==='shield'?Shield:kindIcon(node.kind)==='server'?Server:Router" v-else :size="22"/><span><b>{{node.name}}</b><small>{{node.engine==='vpcs'?'VPCS':node.kind||'QEMU'}}</small></span><i :class="node.status"/></button></div><button class="add-row" @click="openAdd"><Plus :size="16"/> Добавить устройство</button></aside>
          <TopologyCanvas @console="consoleOpen" @add="openAdd" />
          <aside class="inspector"><template v-if="store.selectedNode"><h3>СВОЙСТВА УСТРОЙСТВА</h3><div class="inspector-name">{{store.selectedNode.name}}<small><i :class="store.selectedNode.status"/> {{store.selectedNode.status==='running'?'Запущен':'Остановлен'}}</small></div><div class="inspector-tabs"><button :class="{active:selectedTab==='overview'}" @click="selectedTab='overview'">Обзор</button><button :class="{active:selectedTab==='ports'}" @click="selectedTab='ports'">Интерфейсы</button></div>
            <template v-if="selectedTab==='overview'"><div class="inspector-content"><label>Движок</label><strong>{{store.selectedNode.engine==='vpcs'?'VPCS':'QEMU / KVM'}}</strong><label>vCPU / RAM</label><strong>{{store.selectedNode.engine==='vpcs'?'—':`${store.selectedNode.cpus||1} / ${store.selectedNode.ram||256} МБ`}}</strong><label>Интерфейсы</label><strong>{{store.selectedNode.nicCount||16}}</strong></div><div class="node-actions"><button v-if="store.selectedNode.status==='running'" @click="powerNode(store.selectedNode,'stop')"><Square :size="15"/> Остановить</button><button v-else @click="powerNode(store.selectedNode,'start')"><Play :size="15"/> Запустить</button><button @click="consoleOpen(store.selectedNode)"><TerminalSquare :size="15"/> Консоль</button><button @click="rename(store.selectedNode)"><Pencil :size="15"/> Переименовать</button><button class="danger" @click="deleteNode(store.selectedNode)"><Trash2 :size="15"/> Удалить</button></div></template>
            <template v-else><div class="port-rows"><div v-for="p in (store.selectedNode.nicCount||16)" :key="p"><span>{{portLabel(store.selectedNode,p-1)}}</span><small>{{selectedLinks.some(l=>(l.a===store.selectedID&&l.aPort===p-1)||(l.b===store.selectedID&&l.bPort===p-1))?'Подключено':'Свободен'}}</small></div></div><h4>Кабели</h4><div v-for="cable in selectedLinks" :key="cable.id" class="cable-row"><Cable :size="14"/>{{cable.aPort}} ↔ {{cable.bPort}}<button title="Отключить кабель" @click="removeCable(cable.id)"><Trash2 :size="14"/></button></div></template>
          </template><div v-else class="inspector-empty">Выберите устройство<br/>на топологии</div></aside>
        </div>
        <div v-else class="empty-panel"><Router :size="38"/><h2>Создайте лабораторию</h2><p>Устройства, кабели и настройки будут сохранены на Debian-сервере.</p><button class="primary" @click="createLabOpen=true"><Plus :size="16"/> Новая лаборатория</button></div>
        <footer class="status-bar"><span><i :class="{ok:store.live}"/>{{liveStatus}}</span><span>{{store.activeLab?.nodes.length||0}} устройств</span><span>{{store.activeLab?.links.length||0}} соединений</span><span>NetLab · экспериментальный Vue-редактор</span></footer>
      </template>
      <template v-else-if="page==='images'"><div class="simple-page"><h1>Библиотека образов</h1><p>Диски QEMU остаются на сервере и доступны обоим интерфейсам.</p><div v-for="image in store.images" :key="image.id" class="list-row"><HardDrive :size="18"/> {{image.name}} <small>{{image.format}}</small></div><p>Загрузка образов и расширенные операции пока доступны в <a href="/">основном интерфейсе</a>.</p></div></template>
      <template v-else><div class="simple-page"><h1>Состояние системы</h1><div v-for="(value,key) in store.system" :key="key" class="list-row"><Activity :size="17"/> {{key}} <b>{{value?'Готово':'Нет'}}</b></div></div></template>
      <div v-if="store.failure" role="alert" class="error-toast" @click="store.failure=''">{{store.failure}} <X :size="16"/></div>
    </main>
    <TerminalDock ref="terminal" :theme="theme" />
    <div v-if="createLabOpen" class="dialog-overlay" @click.self="createLabOpen=false"><form class="dialog-card" @submit.prevent="submitLab"><h2>Новая лаборатория</h2><label>Название<input v-model="newLab" required maxlength="80" autofocus/></label><div class="dialog-actions"><button type="button" @click="createLabOpen=false">Отмена</button><button class="primary">Создать</button></div></form></div>
    <div v-if="addOpen" class="dialog-overlay" @click.self="addOpen=false"><form class="dialog-card" @submit.prevent="addDevice"><h2>Добавить устройство</h2><label>Профиль<select v-model="templateID" @change="changeTemplate"><option v-for="t in store.templates" :key="t.id" :value="t.id">{{t.name}}</option></select></label><label>Название<input v-model="deviceName" required /></label><template v-if="selectedTemplate?.engine!=='vpcs'"><label>Образ<select v-model="imageID" required><option v-for="i in store.images" :key="i.id" :value="i.id">{{i.name}}</option></select></label><label>Число Ethernet-портов<input v-model.number="nicCount" type="number" min="1" max="32"/></label></template><p v-else>VPCS не требует образа диска. Доступен один порт eth0.</p><div class="dialog-actions"><button type="button" @click="addOpen=false">Отмена</button><button class="primary" :disabled="inFlight||(selectedTemplate?.engine!=='vpcs'&&!imageID)">Добавить</button></div></form></div>
  </div>
</template>
