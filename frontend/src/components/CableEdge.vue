<script setup lang="ts">
import { computed } from 'vue'
import { BaseEdge, getStraightPath } from '@vue-flow/core'
import { portLabelPoint } from '@/topology/cable-layout'
interface CableData {
  aLabel?: string; bLabel?: string; color?: string; width?: number
  lineStyle?: 'solid' | 'dashed' | 'dotted'; status?: string
  onEdit?: (id: string) => void
  onContext?: (id:string,event:MouseEvent) => void
}
const props = defineProps<{
  id: string; sourceX: number; sourceY: number; targetX: number; targetY: number
  data?: CableData
}>()
const path = computed(() => getStraightPath({ sourceX: props.sourceX, sourceY: props.sourceY, targetX: props.targetX, targetY: props.targetY })[0])
const a = computed(() => portLabelPoint({ x: props.sourceX, y: props.sourceY }, { x: props.targetX, y: props.targetY }))
const b = computed(() => portLabelPoint({ x: props.targetX, y: props.targetY }, { x: props.sourceX, y: props.sourceY }))
const dash = computed(() => props.data?.lineStyle === 'dashed' ? '8 5' : props.data?.lineStyle === 'dotted' ? '2 5' : undefined)
const width = computed(() => [1, 2, 3, 4].includes(props.data?.width ?? 2) ? (props.data?.width ?? 2) : 2)
const stroke = computed(() => props.data?.color || (props.data?.status === 'error' ? '#d37772' : props.data?.status === 'waiting' ? '#c2a05e' : 'var(--cable)'))
function edit(event: Event) { event.preventDefault(); event.stopPropagation(); props.data?.onEdit?.(props.id) }
function context(event:MouseEvent){event.preventDefault();event.stopPropagation();props.data?.onContext?.(props.id,event)}
</script>
<template>
  <BaseEdge :id="id" :path="path" :style="{ stroke, strokeWidth: width, strokeDasharray: dash }" />
  <path class="cable-interaction" :d="path" fill="none" stroke="transparent" stroke-width="18" @contextmenu="context" @dblclick="edit" />
  <g v-for="(label,index) in [data?.aLabel||'', data?.bLabel||'']" :key="index"
    class="edge-port-label" :transform="`translate(${index ? b.x : a.x},${index ? b.y : a.y})`" @contextmenu="context" @dblclick="edit">
    <rect :x="-Math.max(23,label.length*3.5+7)" y="-10" :width="Math.max(46,label.length*7+14)" height="20" rx="5" />
    <text y="4" text-anchor="middle">{{ label }}</text>
  </g>
</template>
