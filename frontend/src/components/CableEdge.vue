<script setup lang="ts">
import { computed } from 'vue'
import { BaseEdge, getStraightPath } from '@vue-flow/core'
const props=defineProps<{
  id: string; sourceX: number; sourceY:number; targetX:number; targetY:number;
  data?: {aLabel?:string;bLabel?:string;color?:string;width?:number;lineStyle?:string;status?:string}
}>()
const path = computed(()=>getStraightPath({sourceX:props.sourceX,sourceY:props.sourceY,targetX:props.targetX,targetY:props.targetY})[0])
const left = computed(()=>({x:props.sourceX+(props.targetX-props.sourceX)*.23,y:props.sourceY+(props.targetY-props.sourceY)*.23}))
const right = computed(()=>({x:props.sourceX+(props.targetX-props.sourceX)*.77,y:props.sourceY+(props.targetY-props.sourceY)*.77}))
const dash = computed(()=>props.data?.lineStyle==='dashed'?'7 4':props.data?.lineStyle==='dotted'?'2 4':undefined)
</script>
<template>
  <BaseEdge :id="id" :path="path" :style="{stroke:data?.color||'var(--cable)',strokeWidth:data?.width||2,strokeDasharray:dash}" />
  <g v-for="(label,index) in [data?.aLabel||'',data?.bLabel||'']" :key="index" class="edge-port-label" :transform="`translate(${index?right.x:left.x},${index?right.y:left.y})`">
    <rect :x="-Math.max(23,label.length*3.5+7)" y="-10" :width="Math.max(46,label.length*7+14)" height="20" rx="5" />
    <text y="4" text-anchor="middle">{{label}}</text>
  </g>
</template>
