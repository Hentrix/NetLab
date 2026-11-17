<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch, computed, markRaw } from 'vue'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { TerminalSquare, X, Minus, Maximize2, RefreshCcw } from '@lucide/vue'
import type { Device } from '@/types'
import { useNetlabStore } from '@/stores/netlab'
const store = useNetlabStore()
const props = defineProps<{theme: 'light' | 'dark'}>()
interface Session {
  id:string; lab:string; node:string; name:string; term:XTerm; fit:FitAddon;
  host:HTMLDivElement; abort:AbortController; cursor:number; decoder:TextDecoder;
  status:'connecting'|'online'|'offline'|'stopped'; pending:Promise<void>; stopped:boolean; stopNoticeShown:boolean
}
const sessions=ref<Session[]>([])
const current=ref<string|null>(null)
const minimized=ref(false)
const maximized=ref(false)
const left=ref<number|null>(null)
const top=ref<number|null>(null)
const dock=ref<HTMLElement|null>(null)
const visible=computed(()=>sessions.value.length>0)
const active=computed(()=>sessions.value.find(s=>s.id===current.value))
const dark=computed(()=>props.theme==='dark')
const palette=(isDark:boolean)=> isDark?{background:'#101c28',foreground:'#dce8f3',cursor:'#c0e4f7',selectionBackground:'#527ca488'}:{background:'#fff',foreground:'#243c52',cursor:'#255a7e',selectionBackground:'#b5d9f6'}
let resize:ResizeObserver|null=null
let dragging:{x:number;y:number;left:number;top:number}|null=null
// Session identity stays bound to lab/node IDs; names follow the live store.
watch(()=>store.labs, labs=>{
  for(const session of sessions.value){
    const updated=labs.find(lab=>lab.id===session.lab)?.nodes.find(node=>node.id===session.node)
    if(updated)session.name=updated.name
  }
},{deep:true})

function showStoppedOnce(s:Session, message:string){
  s.stopped=true
  s.status='stopped'
  if(s.stopNoticeShown)return
  s.stopNoticeShown=true
  s.term.write(`\r\n[NetLab] ${message}\r\n`)
}
function authPath(s:Session){return `/api/labs/${encodeURIComponent(s.lab)}/nodes/${encodeURIComponent(s.node)}`}
function send(s:Session, data:string){
  if(s.stopped)return
  s.pending=s.pending.then(async()=>{
    if(s.stopped||s.abort.signal.aborted)return
    const response=await fetch(`${authPath(s)}/console`,{method:'POST',headers:{Authorization:`Bearer ${store.token}`,'Content-Type':'application/json'},body:JSON.stringify({text:data})})
    if(response.status===409){
      showStoppedOnce(s,'Устройство остановлено или сервер NetLab перезапущен. Запустите устройство и откройте консоль снова.')
      return
    }
    if(!response.ok){
      const detail=await response.json().catch(()=>null) as {error?:string}|null
      throw Error(detail?.error||`HTTP ${response.status}`)
    }
  }).catch(e=>{
    if(s.abort.signal.aborted)return
    if(s.stopped)return
    s.status='offline';s.term.write(`\r\n[NetLab] Ошибка отправки: ${(e as Error).message}\r\n`)
  })
}
async function stream(s:Session){
  let delay=700
  while(!s.abort.signal.aborted&&!s.stopped){
    try{
      s.status='connecting'
      const response=await fetch(`${authPath(s)}/console/stream?cursor=${s.cursor}`,{signal:s.abort.signal,headers:{Authorization:`Bearer ${store.token}`}})
      if(response.status===409){
        const detail=await response.json().catch(()=>null) as {error?:string}|null
        if(s.abort.signal.aborted)break
        showStoppedOnce(s,`${detail?.error||'Устройство не запущено'}. Запустите устройство и откройте консоль заново.`)
        break
      }
      if(!response.ok||!response.body)throw Error(`HTTP ${response.status}`)
      s.status='online'; delay=700
      const reader=response.body.getReader(),decoder=new TextDecoder()
      let buffer=''
      while(!s.abort.signal.aborted){
        const chunk=await reader.read()
        if(chunk.done)throw Error('Поток завершён')
        buffer+=decoder.decode(chunk.value,{stream:true}).replace(/\r\n/g,'\n')
        if(buffer.length>512*1024)throw Error('Слишком большой ответ консоли')
        let pos:number
        while((pos=buffer.indexOf('\n\n'))>=0){
          const event=buffer.slice(0,pos);buffer=buffer.slice(pos+2)
          const kind=event.match(/^event:\s*(.+)$/m)?.[1]
          if(kind==='closed'){showStoppedOnce(s,'Устройство остановлено. Запустите его заново.');break}
          if(kind!=='output')continue
          const raw=event.match(/^data:\s*(.+)$/m)?.[1];if(!raw)continue
          const item=JSON.parse(raw) as {chunk:string;cursor:number;reset?:boolean}
          if(item.reset){s.term.reset();s.decoder=new TextDecoder()}
          s.cursor=item.cursor
          if(item.chunk){const bytes=Uint8Array.from(atob(item.chunk),c=>c.charCodeAt(0));s.term.write(s.decoder.decode(bytes,{stream:true}))}
        }
        if(s.stopped)break
      }
    }catch(error){if(s.abort.signal.aborted||s.stopped)break;s.status='offline';s.term.write(`\r\n[NetLab] ${String((error as Error).message)}. Переподключение…\r\n`)}
    if(s.stopped||s.abort.signal.aborted)break
    await new Promise(resolve=>setTimeout(resolve,delay));delay=Math.min(8000,delay*1.7)
  }
}
async function open(device:Device){
  if(!store.activeLab)return
  const id=`${store.activeLab.id}:${device.id}`
  const existing=sessions.value.find(s=>s.id===id)
  if(existing){if(existing.stopped){close(id)}else{select(id);return}}
  if(sessions.value.length>=12)return
  const term=new XTerm({cursorBlink:true,convertEol:false,scrollback:7000,theme:palette(dark.value),fontSize:13,fontFamily:'Consolas, "Cascadia Code", monospace'})
  const fit=new FitAddon();term.loadAddon(fit)
  const host=document.createElement('div');host.className='terminal-instance';host.style.display='none'
  const s:Session={id,lab:store.activeLab.id,node:device.id,name:device.name,term:markRaw(term),fit:markRaw(fit),host:markRaw(host),abort:markRaw(new AbortController()),cursor:0,decoder:markRaw(new TextDecoder()),status:'connecting',pending:Promise.resolve(),stopped:false,stopNoticeShown:false}
  sessions.value.push(s);current.value=id;minimized.value=false
  await nextTick()
  dock.value?.querySelector('.terminal-hosts')?.appendChild(host)
  term.open(host);term.onData(text=>send(s,text));await nextTick()
  select(id);void stream(s)
}
function fitActive(){const s=active.value;if(!s||minimized.value)return;requestAnimationFrame(()=>{if(s.host.isConnected && s.host.clientWidth>20&&s.host.clientHeight>20){s.fit.fit();s.term.refresh(0,s.term.rows-1)}})}
function select(id:string){current.value=id;minimized.value=false;for(const s of sessions.value)s.host.style.display=s.id===id?'block':'none';fitActive();sessions.value.find(s=>s.id===id)?.term.focus()}
function close(id:string){const s=sessions.value.find(item=>item.id===id);if(!s)return;s.abort.abort();s.term.dispose();s.host.remove();sessions.value=sessions.value.filter(item=>item.id!==id);if(current.value===id){current.value=sessions.value[0]?.id??null;if(current.value)void nextTick(()=>select(current.value!))}}
function closeAll(){for(const s of [...sessions.value])close(s.id)}
function moveStart(event:PointerEvent){if(event.button!==0||maximized.value||(event.target as HTMLElement).closest('button'))return
  dragging={x:event.clientX,y:event.clientY,left:left.value??Math.max(0,window.innerWidth-910),top:top.value??Math.max(0,window.innerHeight-580)}
  const el=event.currentTarget as HTMLElement;el.setPointerCapture(event.pointerId)
}
function move(event:PointerEvent){if(!dragging)return;left.value=Math.min(window.innerWidth-110,Math.max(0,dragging.left+event.clientX-dragging.x));top.value=Math.min(window.innerHeight-50,Math.max(0,dragging.top+event.clientY-dragging.y))}
function moveEnd(){dragging=null}
watch(dark,()=>{for(const s of sessions.value)s.term.options.theme=palette(dark.value)})
watch(minimized,async value=>{if(!value){await nextTick();fitActive()}})
watch(maximized,async()=>{await nextTick();fitActive()})
onBeforeUnmount(()=>{closeAll();resize?.disconnect()})
watch(dock,element=>{resize?.disconnect();if(element&&typeof ResizeObserver!=='undefined'){resize=new ResizeObserver(fitActive);resize.observe(element)}})
defineExpose({open})
</script>
<template>
  <div v-if="visible" ref="dock" class="term-dock" :class="{'is-minimized':minimized,'is-maximized':maximized}" :style="(!maximized&&left!==null)?{left:`${left}px`,top:`${top??20}px`,right:'auto',bottom:'auto'}:{}">
    <div class="term-header" @pointerdown="moveStart" @pointermove="move" @pointerup="moveEnd" @pointercancel="moveEnd">
      <div class="term-header-name"><TerminalSquare :size="18"/> Консоли NetLab</div>
      <div class="term-actions"><button title="Свернуть" @click="minimized=true"><Minus :size="16"/></button><button title="Развернуть" @click="maximized=!maximized"><Maximize2 :size="15"/></button><button title="Закрыть все консоли" @click="closeAll"><X :size="17"/></button></div>
    </div>
    <template v-if="!minimized">
      <nav class="term-tabs"><div v-for="s in sessions" :key="s.id" class="term-tab" :class="{active:current===s.id}"><button @click="select(s.id)"><i :class="s.status"/>{{s.name}}</button><button title="Закрыть вкладку" @click="close(s.id)"><X :size="13"/></button></div></nav>
      <div class="terminal-hosts"></div>
      <footer class="term-footer"><span>{{active?.status==='online'?'Соединение активно':active?.status==='stopped'?'Устройство остановлено':'Подключение / ожидание API'}}</span><button @click="active&&select(active.id)"><RefreshCcw :size="13"/> Обновить отображение</button></footer>
    </template>
    <button v-else class="restore-console" @click="minimized=false">{{sessions.length}} вкладок · Развернуть</button>
  </div>
</template>
