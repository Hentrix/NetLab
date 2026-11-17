<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { computed } from 'vue'
import { PlugZap, Router, Monitor } from '@lucide/vue'
import type { Device } from '@/types'
import type { PortAnchor, Side } from '@/topology/cable-layout'

interface LinkHandle { linkId: string; end: 'source' | 'target'; anchor: PortAnchor }
const props = defineProps<{ data: { device: Device; anchors?: LinkHandle[]; hovered?:boolean; connected?:boolean; selected?:boolean } }>()
const emit=defineEmits<{(e:'device-context',payload:{id:string;event:MouseEvent}):void;(e:'device-hover',payload:{id:string;active:boolean;event:MouseEvent}):void}>()
function openContext(event:MouseEvent){
  event.preventDefault()
  event.stopPropagation()
  emit('device-context',{id:props.data.device.id,event})
}
function deviceHover(event:MouseEvent,active:boolean){emit('device-hover',{id:props.data.device.id,active,event})}
const device = computed(() => props.data.device)
const icon = computed(() => device.value.icon ? `/icons/${encodeURIComponent(device.value.icon)}` : '')
const position = (side: Side) => ({ left: Position.Left, right: Position.Right, top: Position.Top, bottom: Position.Bottom })[side]
const pointStyle = (point: PortAnchor) => ({
  left: `${point.x - 4}px`, top: `${point.y - 4}px`, right: 'auto', bottom: 'auto', transform: 'none',
})
</script>
<template>
  <div class="device-node" @mouseenter="deviceHover($event,true)" @mousemove="deviceHover($event,true)" @mouseleave="deviceHover($event,false)"
    @contextmenu="openContext" :class="{'device-running': device.status === 'running','device-hovered':data.hovered,'device-connected-hover':data.connected,'device-selected':data.selected}" :title="device.name">
    <!-- Existing cables use private, stable handles. Different interface numbers
         cannot snap three cables onto one generic VueFlow source handle. -->
    <Handle v-for="h in data.anchors || []" :key="`${h.end}-${h.linkId}`"
      :id="`${h.end}-${h.linkId}`" :type="h.end" :position="position(h.anchor.side)"
      :style="pointStyle(h.anchor)" class="network-handle attached-handle" :class="{'port-handle-highlight':data.hovered||data.connected}" />
    <!-- Interactive connection handles: drag to connect, choose ports in dialog. -->
    <Handle id="create-target" type="target" :position="Position.Left" class="network-handle create-target" />
    <div class="device-image">
      <img v-if="icon" :src="icon" alt="" draggable="false" />
      <Monitor v-else-if="device.kind === 'pc'" :size="47" stroke-width="1.5" />
      <Router v-else :size="47" stroke-width="1.5" />
    </div>
    <div class="device-label"><i class="device-led" :class="device.status" />{{ device.name }}</div>
    <Handle id="create-source" type="source" :position="Position.Right" class="network-handle create-source" title="Соединить с другим устройством">
      <PlugZap :size="13" stroke-width="2.5" />
    </Handle>
  </div>
</template>
