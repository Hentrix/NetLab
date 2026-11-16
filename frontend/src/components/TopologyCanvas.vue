<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { VueFlow, useVueFlow, type Connection } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { MousePointer2, Hand, Scan, Cable as CableIcon, Maximize, Plus, Minus, MonitorPlay } from 'lucide-vue-next'
import { useNetlabStore } from '@/stores/netlab'
import { availablePorts, portLabel } from '@/api/client'
import DeviceNode from './DeviceNode.vue'
import CableEdge from './CableEdge.vue'
import type { Device } from '@/types'
const store = useNetlabStore()
const emit=defineEmits<{(e:'console',device:Device):void,(e:'add'):void}>()
const { fitView, zoomIn, zoomOut }=useVueFlow({id:'netlab-topology'})
const panMode=ref(false)
const pending=ref<{a:string;b:string}|null>(null)
const chosen=ref({a:0,b:0})
const saving=ref(false)
const nodes=computed(()=>store.activeLab?.nodes.map(device=>({
  id:device.id, type:'device', position:{x:device.x,y:device.y},
  draggable:!panMode.value, selectable:!panMode.value,
  data:{device,onConsole:(d:Device)=>emit('console',d)}
}))||[])
const edges=computed(()=>store.activeLab?.links.map(link=>({
  id:link.id, source:link.a,target:link.b,sourceHandle:'source',targetHandle:'target',
  type:'cable',selectable:!panMode.value,data:{
    aLabel:portLabel(store.activeLab?.nodes.find(n=>n.id===link.a),link.aPort),
    bLabel:portLabel(store.activeLab?.nodes.find(n=>n.id===link.b),link.bPort),
    color:link.color,width:link.lineWidth,lineStyle:link.lineStyle,status:link.status
  }
}))||[])
const startName=computed(()=>store.activeLab?.nodes.find(n=>n.id===pending.value?.a)?.name||'')
const endName=computed(()=>store.activeLab?.nodes.find(n=>n.id===pending.value?.b)?.name||'')
const firstPorts=computed(()=>availablePorts(store.activeLab?.nodes||[],store.activeLab?.links||[],pending.value?.a||''))
const secondPorts=computed(()=>availablePorts(store.activeLab?.nodes||[],store.activeLab?.links||[],pending.value?.b||''))
function onConnect(data:Connection){
  if(panMode.value||!data.source||!data.target||data.source===data.target)return
  pending.value={a:data.source,b:data.target}
  chosen.value={a:firstPorts.value[0]??0,b:secondPorts.value[0]??0}
}
async function createLink(){
  if(!pending.value||saving.value||!firstPorts.value.includes(chosen.value.a)||!secondPorts.value.includes(chosen.value.b))return
  saving.value=true
  try{await store.connect(pending.value.a,pending.value.b,chosen.value.a,chosen.value.b);pending.value=null}
  finally{saving.value=false}
}
async function dragStopped(event:{node:{id:string,position:{x:number,y:number}}}){
  const node=store.activeLab?.nodes.find(n=>n.id===event.node.id)
  if(!node||panMode.value)return
  if(Math.round(node.x)===Math.round(event.node.position.x)&&Math.round(node.y)===Math.round(event.node.position.y))return
  await store.moveNode(node.id,event.node.position.x,event.node.position.y)
}
function picked(event:{node:{id:string}}){if(!panMode.value)store.selectedID=event.node.id}
function canvasClick(){if(!panMode.value)store.selectedID=null}
watch(()=>store.labID,async()=>{await nextTick();void fitView({padding:.22,duration:300})})
</script>
<template>
  <section class="topology-canvas" aria-label="Редактор топологии">
    <VueFlow id="netlab-topology" :nodes="nodes" :edges="edges" :nodes-draggable="!panMode" :nodes-connectable="!panMode" :elements-selectable="!panMode"
      :pan-on-drag="panMode" :selection-on-drag="!panMode" :min-zoom=".15" :max-zoom="3" :fit-view-on-init="true"
      @connect="onConnect" @node-drag-stop="dragStopped" @node-click="picked" @pane-click="canvasClick">
      <Background pattern-color="var(--grid)" :gap="20" :size="1" />
      <template #node-device="data"><DeviceNode :data="data.data" /></template>
      <template #edge-cable="data"><CableEdge v-bind="data" /></template>
    </VueFlow>
    <div class="canvas-tools" role="toolbar" aria-label="Инструменты топологии">
      <button type="button" :class="{on:!panMode}" title="Выделение" @click="panMode=false"><MousePointer2 :size="17"/></button>
      <button type="button" :class="{on:panMode}" title="Рука: только перемещение полотна" @click="panMode=true"><Hand :size="17"/></button>
      <span class="tool-separator" />
      <button type="button" title="Добавить устройство" @click="emit('add')"><Plus :size="18"/></button>
      <button type="button" title="Показать всю схему" @click="fitView({padding:.2,duration:250})"><Scan :size="17"/></button>
    </div>
    <div class="canvas-scale">
      <button type="button" title="Уменьшить" @click="zoomOut({duration:150})"><Minus :size="16"/></button>
      <button type="button" title="Увеличить" @click="zoomIn({duration:150})"><Plus :size="16"/></button>
      <button type="button" title="Показать всё" @click="fitView({padding:.2,duration:250})"><Maximize :size="16"/></button>
    </div>
    <div v-if="!store.activeLab?.nodes.length" class="canvas-empty"><MonitorPlay :size="30"/><strong>Лаборатория пуста</strong><span>Нажмите «+», чтобы добавить устройство</span></div>
    <div v-if="pending" class="dialog-overlay" @click.self="pending=null">
      <form class="dialog-card" @submit.prevent="createLink">
        <div class="dialog-heading"><CableIcon :size="18"/><strong>Подключить Ethernet</strong></div>
        <p>{{startName}} → {{endName}}</p>
        <label>Интерфейс {{startName}}<select v-model.number="chosen.a"><option v-for="p in firstPorts" :key="p" :value="p">{{portLabel(store.activeLab?.nodes.find(n=>n.id===pending?.a),p)}}</option></select></label>
        <label>Интерфейс {{endName}}<select v-model.number="chosen.b"><option v-for="p in secondPorts" :key="p" :value="p">{{portLabel(store.activeLab?.nodes.find(n=>n.id===pending?.b),p)}}</option></select></label>
        <div class="dialog-actions"><button type="button" @click="pending=null">Отмена</button><button type="submit" class="primary" :disabled="saving||!firstPorts.length||!secondPorts.length">Подключить</button></div>
      </form>
    </div>
  </section>
</template>
