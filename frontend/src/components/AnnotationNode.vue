<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { Annotation } from '@/types'
const props=defineProps<{data:{annotation:Annotation}}>()
const emit=defineEmits<{
  (e:'resize-start',payload:{annotation:Annotation;side:string;event:PointerEvent}):void
  (e:'context',payload:{annotation:Annotation;event:MouseEvent}):void
}>()
const handles=['n','ne','e','se','s','sw','w','nw']
function resizeStart(side:string,event:PointerEvent){
  if(event.button!==0)return
  emit('resize-start',{annotation:props.data.annotation,side,event})
}
function showMenu(event:MouseEvent){
  event.preventDefault()
  event.stopPropagation()
  emit('context',{annotation:props.data.annotation,event})
}
const item=computed(()=>props.data.annotation)
const textElement=ref<HTMLElement|null>(null)
const MIN_FITTED_FONT=11
// Follow legacy: preserve the configured font size, shrink only the rendering
// when the note is small; if still clipped at 11px, allow internal scrolling.
function fitText(){
  const element=textElement.value
  if(!element)return
  const size=Math.max(9,Math.min(72,item.value.fontSize||14))
  element.style.overflowY='hidden'
  for(let font=size;font>=MIN_FITTED_FONT;font--){
    element.style.fontSize=font+'px'
    if(element.scrollHeight<=element.clientHeight+1&&element.scrollWidth<=element.clientWidth+1)break
  }
  const clipped=element.scrollHeight>element.clientHeight+1||element.scrollWidth>element.clientWidth+1
  element.style.overflowY=clipped?'auto':'hidden'
  element.title=clipped?'Текст длиннее области — прокрутите или увеличьте размер':''
}
watch(()=>[item.value.text,item.value.width,item.value.height,item.value.fontSize,
  item.value.bold,item.value.italic,item.value.underline],async()=>{await nextTick();fitText()},{flush:'post'})
onMounted(()=>{void nextTick(fitText)})

const style=computed(()=>({
  width:`${item.value.width}px`,height:`${item.value.height}px`,
  color:item.value.color||'var(--ink)',
  background:item.value.background||(item.value.kind==='note'?'#fff4c4':'transparent'),
  border:item.value.kind==='note'? `${item.value.borderWidth??1}px solid ${item.value.borderColor||'#d2b869'}` :
    item.value.borderWidth? `${item.value.borderWidth}px solid ${item.value.borderColor||'#728e9c'}`:'1px solid transparent',
  fontSize:`${item.value.fontSize||14}px`,
  fontWeight:item.value.bold?'700':'400',
  fontStyle:item.value.italic?'italic':'normal',
  textDecoration:item.value.underline?'underline':'none',
  textAlign:item.value.align||'left'
}))
</script>
<template>
  <div class="topology-annotation" :class="{'is-note':item.kind==='note'}" :style="style" :title="'Дважды нажмите, чтобы изменить: '+item.text" @contextmenu="showMenu">
    <div ref="textElement" class="annotation-content nowheel" :aria-label="item.text||'Пустая аннотация'">{{item.text|| (item.kind==='note'?'Примечание':'Текст')}}</div>
    <button v-for="side in handles" :key="side" type="button" class="annotation-handle nodrag nopan" :class="'annotation-handle-'+side"
      :aria-label="'Изменить размер: '+side" :title="'Изменить размер'" @pointerdown.stop.prevent="resizeStart(side,$event)" @click.stop.prevent></button>
  </div>
</template>
