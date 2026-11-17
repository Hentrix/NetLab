<script setup lang="ts">
import { computed, Fragment, isVNode, nextTick, onBeforeUnmount, ref, useAttrs, useSlots, watch, type VNode } from 'vue'
import { ChevronDown, Check } from '@lucide/vue'

defineOptions({inheritAttrs:false})
const props=withDefaults(defineProps<{
  modelValue:string|number|undefined|null
  modelModifiers?:{number?:boolean}
  disabled?:boolean
  required?:boolean
}>(),{disabled:false,required:false})
const emit=defineEmits<{
  (e:'update:modelValue',value:string|number):void
  (e:'change',value:string|number):void
}>()
const attrs=useAttrs(),slots=useSlots()
type Choice={value:string|number;label:string;disabled:boolean}
function plainText(children:unknown):string{
  if(typeof children==='string'||typeof children==='number')return String(children)
  if(Array.isArray(children))return children.map(plainText).join('')
  if(isVNode(children))return plainText(children.children)
  return ''
}
function collect(vnodes:VNode[],items:Choice[]){
  for(const vnode of vnodes){
    if(vnode.type===Fragment&&Array.isArray(vnode.children)){
      collect(vnode.children.filter(isVNode),items)
    }else if(vnode.type==='option'){
      const value=vnode.props?.value??plainText(vnode.children)
      items.push({value:typeof value==='number'?value:String(value),label:plainText(vnode.children).trim(),disabled:!!vnode.props?.disabled})
    }else if(Array.isArray(vnode.children)){
      collect(vnode.children.filter(isVNode),items)
    }
  }
}
const choices=computed(()=>{
  const result:Choice[]=[]
  collect((slots.default?.()||[]).filter(isVNode),result)
  return result
})
const current=computed(()=>choices.value.find(item=>String(item.value)===String(props.modelValue)))
const expanded=ref(false),highlighted=ref(0),button=ref<HTMLButtonElement|null>(null),popup=ref<HTMLElement|null>(null)
const location=ref({top:0,left:0,width:160,maxHeight:270})
const popupId='netlab-menu-'+Math.random().toString(36).slice(2,10)
function position(){
  if(!button.value)return
  const rect=button.value.getBoundingClientRect()
  const below=window.innerHeight-rect.bottom
  const above=rect.top
  const menuHeight=Math.min(280,Math.max(100,(choices.value.length*34)+12))
  const aboveSide=below<menuHeight&&above>below
  location.value={
    top:aboveSide?Math.max(8,rect.top-Math.min(menuHeight,above-8)-4):rect.bottom+4,
    left:Math.max(8,Math.min(rect.left,window.innerWidth-Math.max(rect.width,150)-8)),
    width:Math.min(Math.max(rect.width,150),window.innerWidth-16),
    maxHeight:Math.max(80,Math.min(menuHeight,(aboveSide?above:below)-12))
  }
}
async function open(){
  if(props.disabled)return
  position()
  highlighted.value=Math.max(0,choices.value.findIndex(item=>String(item.value)===String(props.modelValue)))
  expanded.value=true
  await nextTick()
  popup.value?.querySelector<HTMLElement>('[data-highlighted="true"]')?.scrollIntoView({block:'nearest'})
}
function close(restoreFocus=false){
  expanded.value=false
  if(restoreFocus)button.value?.focus({preventScroll:true})
}
function select(item:Choice){
  if(item.disabled)return
  const value=props.modelModifiers?.number?Number(item.value):item.value
  emit('update:modelValue',value)
  emit('change',value)
  close(true)
}
function move(delta:number){
  if(!expanded.value){void open();return}
  if(!choices.value.length)return
  let next=highlighted.value
  for(let i=0;i<choices.value.length;i++){
    next=(next+delta+choices.value.length)%choices.value.length
    if(!choices.value[next].disabled){highlighted.value=next;break}
  }
  void nextTick(()=>popup.value?.querySelector<HTMLElement>('[data-highlighted="true"]')?.scrollIntoView({block:'nearest'}))
}
function keyDown(event:KeyboardEvent){
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){
    event.preventDefault()
    move(event.key==='ArrowDown'?1:-1)
  }else if(event.key==='Enter'||event.key===' '){
    event.preventDefault()
    if(!expanded.value)void open()
    else if(choices.value[highlighted.value])select(choices.value[highlighted.value])
  }else if(event.key==='Escape'&&expanded.value){
    event.preventDefault();event.stopPropagation();close(true)
  }else if(event.key==='Tab'){close()}
  else if(event.key==='Home'&&expanded.value){event.preventDefault();highlighted.value=0}
  else if(event.key==='End'&&expanded.value){event.preventDefault();highlighted.value=choices.value.length-1}
}
function externalPointer(event:PointerEvent){
  const target=event.target as Node
  if(!button.value?.contains(target)&&!popup.value?.contains(target))close()
}
function reposition(){
  if(expanded.value)position()
}
watch(expanded,isOpen=>{
  if(isOpen){
    document.addEventListener('pointerdown',externalPointer,true)
    window.addEventListener('resize',reposition)
    window.addEventListener('scroll',reposition,true)
  }else{
    document.removeEventListener('pointerdown',externalPointer,true)
    window.removeEventListener('resize',reposition)
    window.removeEventListener('scroll',reposition,true)
  }
})
onBeforeUnmount(()=>{
  document.removeEventListener('pointerdown',externalPointer,true)
  window.removeEventListener('resize',reposition)
  window.removeEventListener('scroll',reposition,true)
})
</script>
<template>
  <div class="ui-select" :class="{'ui-select-disabled':disabled,'ui-select-open':expanded}">
    <button ref="button" type="button" class="ui-select-trigger" :disabled="disabled"
      :aria-label="(attrs['aria-label'] as string)||undefined"
      :aria-expanded="expanded" aria-haspopup="listbox" :aria-controls="popupId"
      :aria-required="required" @click="expanded?close():open()" @keydown="keyDown">
      <span class="ui-select-text">{{current?.label||'Выберите значение'}}</span>
      <ChevronDown :size="16" class="ui-select-chevron"/>
    </button>
    <Teleport to="body">
      <div v-if="expanded" :id="popupId" ref="popup" class="ui-select-popup" role="listbox"
        :style="{top:location.top+'px',left:location.left+'px',width:location.width+'px',maxHeight:location.maxHeight+'px'}"
        :aria-label="(attrs['aria-label'] as string)||undefined" @keydown="keyDown">
        <button v-for="(choice,index) in choices" :key="index" type="button" role="option" class="ui-select-option"
          :disabled="choice.disabled" :aria-selected="String(choice.value)===String(modelValue)"
          :data-highlighted="highlighted===index" :class="{'is-current':String(choice.value)===String(modelValue),'is-highlighted':highlighted===index}"
          @mouseenter="highlighted=index" @click="select(choice)">
          <span>{{choice.label}}</span><Check v-if="String(choice.value)===String(modelValue)" :size="15"/>
        </button>
      </div>
    </Teleport>
  </div>
</template>
