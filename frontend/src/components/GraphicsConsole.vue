<script setup lang="ts">
import {onBeforeUnmount,onMounted,ref} from 'vue'
import {Monitor,RotateCcw,X,Keyboard} from '@lucide/vue'
import {api} from '@/api/client'
import {useNetlabStore} from '@/stores/netlab'
import type {Device} from '@/types'
const props=defineProps<{device:Device}>()
const emit=defineEmits<{(e:'close'):void}>()
const store=useNetlabStore()
const screen=ref<HTMLElement|null>(null)
const status=ref('Подключение к экрану QEMU…')
const working=ref(false)
type RFBClient={
 scaleViewport:boolean;resizeSession:boolean;viewOnly:boolean
 disconnect():void;sendCtrlAltDel():void
 addEventListener(type:string,callback:(event:Event)=>void):void
}
type RFBConstructor=new(target:HTMLElement,url:string,options?:{shared:boolean})=>RFBClient
let rfb:RFBClient|null=null
let canceled=false
async function connect(){
 if(working.value||!screen.value||!store.activeLab)return
 working.value=true
 status.value='Подключение к экрану QEMU…'
 rfb?.disconnect();rfb=null
 try{
  const labId=store.activeLab.id,nodeId=props.device.id
  const ticket=await api<{wsPath:string}>(store.token,
    `labs/${labId}/nodes/${nodeId}/vnc-ticket`,{method:'POST'})
  if(canceled)return
  const path=new URL(ticket.wsPath,window.location.origin)
  path.protocol=window.location.protocol==='https:'?'wss:':'ws:'
  // noVNC ships with Debian Trixie; it is served from /usr/share/novnc.
  // Do not require a CDN or put the administrator token in the URL.
  const moduleURL=new URL('/novnc/core/rfb.js',window.location.origin).href
  const loaded=await import(/* @vite-ignore */ moduleURL)
  if(canceled||!screen.value)return
  const RFB=loaded.default as RFBConstructor
  if(!RFB)throw Error('Модуль noVNC недоступен: проверьте пакет novnc')
  rfb=new RFB(screen.value,path.href,{shared:true})
  rfb.scaleViewport=true
  rfb.resizeSession=true
  rfb.addEventListener('connect',()=>{status.value='Графическая консоль подключена'})
  rfb.addEventListener('disconnect',()=>{if(!canceled)status.value='Соединение с экраном завершено'})
  rfb.addEventListener('securityfailure',()=>{status.value='Ошибка согласования безопасности VNC'})
 }catch(e){if(!canceled)status.value='Не удалось открыть экран: '+(e as Error).message}
 finally{working.value=false}
}
onMounted(()=>{void connect()})
onBeforeUnmount(()=>{canceled=true;rfb?.disconnect();rfb=null})
</script>
<template>
  <div class="graphics-overlay" @click.self="emit('close')">
    <section class="graphics-dialog" role="dialog" aria-modal="true" :aria-label="'Экран '+device.name">
      <header class="graphics-toolbar">
        <div><Monitor :size="18"/><strong>{{device.name}}</strong><small>{{status}}</small></div>
        <div class="graphics-controls">
          <button type="button" title="Ctrl+Alt+Del" :disabled="!rfb" @click="rfb?.sendCtrlAltDel()"><Keyboard :size="16"/> Ctrl+Alt+Del</button>
          <button type="button" title="Переподключить" :disabled="working" @click="connect"><RotateCcw :size="16"/></button>
          <button type="button" title="Закрыть" @click="emit('close')"><X :size="17"/></button>
        </div>
      </header>
      <div ref="screen" class="graphics-screen" tabindex="0" aria-label="Экран и ввод виртуальной машины"></div>
      <footer>Экран QEMU · noVNC · клавиатура и мышь передаются в гостевую ОС</footer>
    </section>
  </div>
</template>
<style scoped>
.graphics-overlay{position:fixed;inset:0;z-index:200;background:#090e16c9;display:flex;align-items:center;justify-content:center;padding:20px}
.graphics-dialog{width:min(1240px,96vw);max-height:96vh;display:grid;grid-template-rows:auto minmax(250px,1fr) auto;background:var(--surface);border:1px solid var(--border);border-radius:9px;overflow:hidden;box-shadow:0 24px 80px #0009}
.graphics-toolbar{display:flex;gap:14px;justify-content:space-between;align-items:center;padding:12px 14px;background:var(--surface-2)}
.graphics-toolbar>div:first-child{display:flex;align-items:center;gap:9px;min-width:0;flex-wrap:wrap}
.graphics-toolbar strong{font-size:14px}
.graphics-toolbar small{color:var(--muted);font-size:11px}
.graphics-controls{display:flex;gap:7px;align-items:center}
.graphics-controls button{display:flex;align-items:center;gap:7px;min-height:34px;padding:6px 10px;background:var(--surface);color:var(--ink);border:1px solid var(--border);border-radius:6px;cursor:pointer}
.graphics-controls button:disabled{opacity:.5;cursor:default}
.graphics-screen{background:#0b0c11;min-height:300px;height:min(72vh,820px);position:relative;overflow:hidden}
.graphics-screen:focus-visible{outline:2px solid var(--accent)}
.graphics-dialog footer{padding:8px 14px;color:var(--muted);font-size:11px}
@media(max-width:640px){.graphics-overlay{padding:4px}.graphics-dialog{width:100vw}.graphics-toolbar{flex-wrap:wrap}.graphics-screen{height:65vh}}
</style>
