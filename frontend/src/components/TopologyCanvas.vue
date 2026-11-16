<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { VueFlow, useVueFlow, type Connection } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { MousePointer2, Hand, Scan, Cable as CableIcon, Maximize, Plus, Minus, MonitorPlay, Trash2, X } from 'lucide-vue-next'
import { useNetlabStore } from '@/stores/netlab'
import { availablePorts, portLabel } from '@/api/client'
import { layoutCables, type PortAnchor } from '@/topology/cable-layout'
import DeviceNode from './DeviceNode.vue'
import CableEdge from './CableEdge.vue'
import type { Device } from '@/types'

const store = useNetlabStore()
const emit = defineEmits<{ (e:'console', device:Device):void; (e:'add'):void }>()
const { fitView, zoomIn, zoomOut, updateNodeInternals } = useVueFlow({ id:'netlab-topology' })
const panMode = ref(false)
const cableMode = ref(false)
const firstCableNode = ref<string | null>(null)
const pending = ref<{a:string;b:string} | null>(null)
const chosen = ref({ a:0, b:0 })
const saving = ref(false)
const editingID = ref<string | null>(null)
const edit = ref({a:'',b:'',aPort:0,bPort:0,color:'#568bb8',lineWidth:2,lineStyle:'solid' as 'solid'|'dashed'|'dotted'})
const current = computed(() => store.activeLab)
const geometry = computed(() => layoutCables(current.value?.nodes || [], current.value?.links || []))
interface Endpoint { linkId:string; end:'source'|'target'; anchor:PortAnchor }
const portsByNode = computed(() => {
  const map = new Map<string,Endpoint[]>()
  for(const link of current.value?.links || []) {
    const geo = geometry.value.get(link.id)
    if (!geo) continue
    for (const endpoint of [{ id:link.a,end:'source' as const,anchor:geo.source },{ id:link.b,end:'target' as const,anchor:geo.target }]) {
      if (!map.has(endpoint.id)) map.set(endpoint.id,[])
      map.get(endpoint.id)!.push({ linkId:link.id,end:endpoint.end,anchor:endpoint.anchor })
    }
  }
  return map
})
const nodes = computed(() => current.value?.nodes.map(device => ({
  id:device.id, type:'device', position:{x:device.x,y:device.y},
  draggable:!panMode.value, selectable:!panMode.value,
  data:{device,anchors:portsByNode.value.get(device.id)||[]}
})) || [])
const edges = computed(() => current.value?.links.filter(link=>geometry.value.has(link.id)).map(link => ({
  id:link.id,source:link.a,target:link.b,sourceHandle:`source-${link.id}`,targetHandle:`target-${link.id}`,
  type:'cable',selectable:true,
  data:{aLabel:portLabel(current.value?.nodes.find(n=>n.id===link.a),link.aPort),
    bLabel:portLabel(current.value?.nodes.find(n=>n.id===link.b),link.bPort),
    color:link.color,width:link.lineWidth,lineStyle:link.lineStyle,status:link.status,onEdit:editLink}
}))||[])
// After adding/removing a cable, Vue Flow must remeasure DOM handles.
const internalsKey = computed(() => `${store.labID}:${current.value?.nodes.map(n=>`${n.id}:${n.x},${n.y}`).join('|')}:${current.value?.links.map(l=>`${l.id}:${l.a}:${l.b}`).join('|')}`)
watch(internalsKey,async()=>{await nextTick();updateNodeInternals((current.value?.nodes || []).map(n=>n.id))},{flush:'post'})
watch(()=>store.labID,async()=>{firstCableNode.value=null;await nextTick();void fitView({padding:.22,duration:250})})
const startName = computed(() => current.value?.nodes.find(n=>n.id===pending.value?.a)?.name || '')
const endName = computed(() => current.value?.nodes.find(n=>n.id===pending.value?.b)?.name || '')
const firstPorts = computed(() => availablePorts(current.value?.nodes||[],current.value?.links||[],pending.value?.a||''))
const secondPorts = computed(() => availablePorts(current.value?.nodes||[],current.value?.links||[],pending.value?.b||''))
const editCable = computed(() => current.value?.links.find(l=>l.id===editingID.value))
const editFirstPorts = computed(() => availablePorts(current.value?.nodes||[],current.value?.links||[],edit.value.a,editingID.value||undefined))
const editSecondPorts = computed(() => availablePorts(current.value?.nodes||[],current.value?.links||[],edit.value.b,editingID.value||undefined))
const editA = computed(() => current.value?.nodes.find(n=>n.id===edit.value.a))
const editB = computed(() => current.value?.nodes.find(n=>n.id===edit.value.b))
function chooseEnds(a:string,b:string) {
  if (!current.value || a===b || !current.value.nodes.some(n=>n.id===a) || !current.value.nodes.some(n=>n.id===b)) return
  const ap = availablePorts(current.value.nodes,current.value.links,a)
  const bp = availablePorts(current.value.nodes,current.value.links,b)
  if (!ap.length || !bp.length) { store.failure='Нет свободных Ethernet-интерфейсов для соединения'; return }
  pending.value={a,b}; chosen.value={a:ap[0],b:bp[0]};cableMode.value=false;firstCableNode.value=null
}
function onConnect(data:Connection) {if(!panMode.value&&data.source&&data.target) chooseEnds(data.source,data.target)}
async function createLink() {
  if(!pending.value||saving.value||!firstPorts.value.includes(chosen.value.a)||!secondPorts.value.includes(chosen.value.b))return
  saving.value=true
  try { await store.connect(pending.value.a,pending.value.b,chosen.value.a,chosen.value.b);pending.value=null }
  finally {saving.value=false}
}
function editLink(id:string) {
  const link = current.value?.links.find(l=>l.id===id)
  if (!link) return
  editingID.value=id
  edit.value={a:link.a,b:link.b,aPort:link.aPort,bPort:link.bPort,
    color:/^#[0-9a-fA-F]{6}$/.test(link.color||'')?link.color!:'#568bb8',
    lineWidth:link.lineWidth||2,lineStyle:link.lineStyle||'solid'}
}
function changeEndpoint(which:'a'|'b') {
  const device=which==='a'?edit.value.a:edit.value.b
  const open=availablePorts(current.value?.nodes||[],current.value?.links||[],device,editingID.value||undefined)
  const key=which==='a'?'aPort':'bPort'
  if(!open.includes(edit.value[key]))edit.value[key]=open[0]??0
}
async function saveLink() {
  if(!editingID.value||saving.value||!editFirstPorts.value.includes(edit.value.aPort)||!editSecondPorts.value.includes(edit.value.bPort))return
  saving.value=true
  try {await store.updateCable(editingID.value,{...edit.value});editingID.value=null}
  finally {saving.value=false}
}
async function deleteLink() {if(!editingID.value || !confirm('Отключить этот кабель?'))return;await store.disconnect(editingID.value);editingID.value=null}
async function dragStopped(event:{node:{id:string,position:{x:number,y:number}}}) {
  const node=current.value?.nodes.find(n=>n.id===event.node.id)
  if(!node||panMode.value)return
  if(Math.round(node.x)!==Math.round(event.node.position.x)||Math.round(node.y)!==Math.round(event.node.position.y))
    await store.moveNode(node.id,event.node.position.x,event.node.position.y)
}
function picked(event:{node:{id:string}}) {
  if(panMode.value)return
  if(cableMode.value) {
    if(!firstCableNode.value) firstCableNode.value=event.node.id
    else if(firstCableNode.value!==event.node.id) chooseEnds(firstCableNode.value,event.node.id)
    return
  }
  store.selectedID=event.node.id
}
function canvasClick(){if(!panMode.value&&!cableMode.value)store.selectedID=null}
function closeEditor(){editingID.value=null}
</script>
<template>
  <section class="topology-canvas" aria-label="Редактор топологии">
    <VueFlow id="netlab-topology" :nodes="nodes" :edges="edges" :nodes-draggable="!panMode" :nodes-connectable="!panMode"
      :elements-selectable="!panMode" :pan-on-drag="panMode" :selection-on-drag="!panMode"
      :min-zoom=".15" :max-zoom="3" :fit-view-on-init="true"
      @connect="onConnect" @node-drag-stop="dragStopped" @node-click="picked" @pane-click="canvasClick">
      <Background pattern-color="var(--grid)" :gap="20" :size="1" />
      <template #node-device="data"><DeviceNode :data="data.data" /></template>
      <template #edge-cable="data"><CableEdge v-bind="data" /></template>
    </VueFlow>
    <div class="canvas-tools" role="toolbar" aria-label="Инструменты топологии">
      <button type="button" :class="{on:!panMode&&!cableMode}" title="Выделение" @click="panMode=false;cableMode=false;firstCableNode=null"><MousePointer2 :size="17"/></button>
      <button type="button" :class="{on:panMode}" title="Перемещать полотно" @click="panMode=true;cableMode=false;firstCableNode=null"><Hand :size="17"/></button>
      <button type="button" :class="{on:cableMode}" title="Кабель: нажмите два устройства" @click="cableMode=!cableMode;panMode=false;firstCableNode=null"><CableIcon :size="17"/></button>
      <span class="tool-separator" />
      <button type="button" title="Добавить устройство" @click="emit('add')"><Plus :size="18"/></button>
      <button type="button" title="Показать всю топологию" @click="fitView({padding:.2,duration:250})"><Scan :size="17"/></button>
    </div>
    <div class="canvas-scale" aria-label="Масштаб полотна">
      <button type="button" title="Уменьшить" @click="zoomOut({duration:150})"><Minus :size="16"/></button>
      <button type="button" title="Увеличить" @click="zoomIn({duration:150})"><Plus :size="16"/></button>
      <button type="button" title="Показать всё" @click="fitView({padding:.2,duration:250})"><Maximize :size="16"/></button>
    </div>
    <div v-if="cableMode" class="canvas-cable-hint"><CableIcon :size="14"/> {{firstCableNode?'Выберите второе устройство':'Выберите первое устройство'}} <button title="Отменить" @click="cableMode=false;firstCableNode=null"><X :size="13"/></button></div>
    <div v-if="!current?.nodes.length" class="canvas-empty"><MonitorPlay :size="30"/><strong>Лаборатория пуста</strong><span>Нажмите «+», чтобы добавить устройство</span></div>
    <div v-if="pending" class="dialog-overlay" @click.self="pending=null">
      <form class="dialog-card" @submit.prevent="createLink">
        <div class="dialog-heading"><CableIcon :size="18"/><strong>Подключить Ethernet</strong></div>
        <p>{{startName}} ↔ {{endName}}</p>
        <label>Интерфейс {{startName}}<select v-model.number="chosen.a"><option v-for="p in firstPorts" :key="p" :value="p">{{portLabel(current?.nodes.find(n=>n.id===pending?.a),p)}}</option></select></label>
        <label>Интерфейс {{endName}}<select v-model.number="chosen.b"><option v-for="p in secondPorts" :key="p" :value="p">{{portLabel(current?.nodes.find(n=>n.id===pending?.b),p)}}</option></select></label>
        <div class="dialog-actions"><button type="button" @click="pending=null">Отмена</button><button type="submit" class="primary" :disabled="saving||!firstPorts.length||!secondPorts.length">Подключить</button></div>
      </form>
    </div>
    <div v-if="editingID&&editCable" class="dialog-overlay" @click.self="closeEditor">
      <form class="dialog-card cable-dialog" @submit.prevent="saveLink">
        <div class="dialog-heading"><CableIcon :size="18"/><strong>Настройки Ethernet-кабеля</strong></div>
        <p>Смена интерфейсов переподключает Ethernet на горячую. Оформление не влияет на сеть.</p>
        <div class="dialog-columns"><label>Устройство A<select v-model="edit.a" @change="changeEndpoint('a')"><option v-for="device in current?.nodes||[]" :key="device.id" :value="device.id">{{device.name}}</option></select></label>
          <label>Устройство B<select v-model="edit.b" @change="changeEndpoint('b')"><option v-for="device in current?.nodes||[]" :key="device.id" :value="device.id">{{device.name}}</option></select></label></div>
        <div class="dialog-columns"><label>Интерфейс A<select v-model.number="edit.aPort"><option v-for="p in editFirstPorts" :key="p" :value="p">{{portLabel(editA,p)}}</option></select></label>
          <label>Интерфейс B<select v-model.number="edit.bPort"><option v-for="p in editSecondPorts" :key="p" :value="p">{{portLabel(editB,p)}}</option></select></label></div>
        <div class="dialog-columns cable-style"><label>Цвет<input v-model="edit.color" type="color" /></label><label>Толщина<select v-model.number="edit.lineWidth"><option v-for="n in [1,2,3,4]" :key="n" :value="n">{{n}} px</option></select></label>
          <label>Линия<select v-model="edit.lineStyle"><option value="solid">Сплошная</option><option value="dashed">Пунктир</option><option value="dotted">Точки</option></select></label></div>
        <svg class="cable-preview" viewBox="0 0 340 38"><line x1="15" y1="19" x2="325" y2="19" :stroke="edit.color" :stroke-width="edit.lineWidth" :stroke-dasharray="edit.lineStyle==='dashed'?'8 5':edit.lineStyle==='dotted'?'2 5':undefined" stroke-linecap="round"/><circle cx="15" cy="19" r="3" fill="var(--surface)" stroke="var(--accent)"/><circle cx="325" cy="19" r="3" fill="var(--surface)" stroke="var(--accent)"/></svg>
        <div class="dialog-actions"><button type="button" class="cable-delete" @click="deleteLink"><Trash2 :size="14"/> Удалить</button><button type="button" @click="closeEditor">Отмена</button><button class="primary" :disabled="saving||edit.a===edit.b||!editFirstPorts.includes(edit.aPort)||!editSecondPorts.includes(edit.bPort)">Применить</button></div>
      </form>
    </div>
  </section>
</template>
