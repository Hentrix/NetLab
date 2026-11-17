<script setup lang="ts">
import { computed } from 'vue'
import type { Annotation } from '@/types'
const props=defineProps<{data:{annotation:Annotation}}>()
const item=computed(()=>props.data.annotation)
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
  <div class="topology-annotation" :class="{'is-note':item.kind==='note'}" :style="style" :title="'Дважды нажмите, чтобы изменить: '+item.text">
    <span>{{item.text|| (item.kind==='note'?'Примечание':'Текст')}}</span>
  </div>
</template>
