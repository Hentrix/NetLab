<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import RFB from '@novnc/novnc/core/rfb'
import { api } from '@/api/client'
import { useNetlabStore } from '@/stores/netlab'
import { Monitor, RefreshCcw, X } from '@lucide/vue'
const props=defineProps<{labId:string;nodeId:string;name:string}>()
const emit=defineEmits<{(e:'close'):void}>()
const store=useNetlabStore()
const surface=ref<HTMLElement|null>(null)
const error=ref('')
const status=ref('Подключение к графической консоли…')
const connecting=ref(false)
let rfb:RFB|null=null
let revision=0
function disconnect(){
  revision++
  try{rfb?.disconnect()}catch{/* QEMU process may already have ended */}
  rfb=null
}
async function connect(){
  disconnect()
  const request=revision
  error.value=''
  status.value='Запрашиваем одноразовый доступ к QEMU…'
  connecting.value=true
  try{
    const response=await api<{path:string}>(store.token,'graphics-ticket',{method:'POST',
      body:JSON.stringify({labId:props.labId,nodeId:props.nodeId})})
    if(revision!==request)return
    await nextTick()
    if(!surface.value)return
    const proto=location.protocol==='https:'?'wss:':'ws:'
    const client=new RFB(surface.value,proto+'//'+location.host+response.path)
    if(revision!==request){client.disconnect();return}
    rfb=client
    client.scaleViewport=true
    client.resizeSession=false
    client.viewOnly=false
    client.addEventListener('connect',()=>{status.value='Графический экран подключён'})
    client.addEventListener('disconnect',()=>{status.value='Соединение закрыто';error.value='VNC отключён. Проверьте состояние VM.'})
    status.value='Ожидание ответа QEMU…'
  }catch(e){
    if(revision===request){error.value=(e as Error).message;status.value='Нет подключения'}
  }finally{if(revision===request)connecting.value=false}
}
onMounted(()=>{void connect()})
watch(()=>[props.labId,props.nodeId],()=>{void connect()})
onBeforeUnmount(disconnect)
</script>
<template>
  <div class="graphics-backdrop" @click.self="emit('close')">
    <section class="graphics-window" role="dialog" :aria-label="'Графический экран: '+name" aria-modal="true">
      <header><div><Monitor :size="19"/><strong>{{name}}</strong><small>{{status}}</small></div>
        <div><button type="button" :disabled="connecting" title="Переподключить" @click="connect"><RefreshCcw :size="17"/></button>
          <button type="button" title="Закрыть экран" @click="emit('close')"><X :size="18"/></button></div></header>
      <div ref="surface" class="graphics-screen" tabindex="0" aria-label="Экран виртуальной машины QEMU"/>
      <footer><span v-if="error" class="graphics-error">{{error}}</span><span v-else>Кликните внутри экрана, чтобы передавать клавиатуру и мышь в гостевую ОС.</span></footer>
    </section>
  </div>
</template>
