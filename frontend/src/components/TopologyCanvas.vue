<script setup lang="ts">
import UiSelect from '@/components/UiSelect.vue'
import { computed, nextTick, ref, watch, onBeforeUnmount, onMounted } from 'vue'
import { VueFlow, useVueFlow, type Connection, type NodeMouseEvent } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { MousePointer2, Hand, Scan, Cable as CableIcon, Maximize, Plus, Minus, MonitorPlay, Trash2, X, StickyNote, Type, Play, Square } from '@lucide/vue'
import { useNetlabStore } from '@/stores/netlab'
import { availablePorts, portLabel } from '@/api/client'
import { layoutCables, type PortAnchor } from '@/topology/cable-layout'
import DeviceNode from './DeviceNode.vue'
import CableEdge from './CableEdge.vue'
import AnnotationNode from './AnnotationNode.vue'
import type { Device, Annotation } from '@/types'
import { resizeAnnotation, clampAnnotationPosition, type ResizeSide, type AnnotationRect } from '@/topology/annotation-geometry'
import { nextNodeSelection } from '@/topology/node-selection'

const store = useNetlabStore()
type DeviceContextAction='console'|'graphics'|'start'|'stop'|'rename'|'hardware'|'ports'|'icon'|'delete'|'log'
const emit = defineEmits<{ (e:'console', device:Device):void; (e:'add'):void; (e:'add-at',position:{x:number;y:number}):void; (e:'bulk', ids:string[]):void; (e:'device-action', payload:{id:string;action:DeviceContextAction}):void; (e:'delete-selection',ids:string[]):void; (e:'template-at',payload:{templateID:string;x:number;y:number}):void }>()
const { fitView, zoomIn, zoomOut, setViewport, updateNodeInternals, viewport, screenToFlowCoordinate } = useVueFlow({ id:'netlab-topology' })
const {setCenter}=useVueFlow({id:'netlab-topology'})
function centerDevice(id:string){
  const node=store.activeLab?.nodes.find(device=>device.id===id)
  if(node)void setCenter(node.x+56,node.y+50,{zoom:viewport.value.zoom,duration:240})
}
defineExpose({centerDevice})

const canvasElement=ref<HTMLElement|null>(null)
// Keep the native browser middle-click autoscroll from competing with Vue Flow.
function preventMiddleAutoscroll(event:MouseEvent){
  if(event.button===1)event.preventDefault()
}
const hoveredDeviceID=ref<string|null>(null)
const hoveredCableID=ref<string|null>(null)
const hoverTip=ref<{left:number;top:number;text:string}|null>(null)
const activeCable=computed(()=>current.value?.links.find(link=>link.id===hoveredCableID.value))
const connectedHoverDevices=computed(()=>{
  const result=new Set<string>()
  const link=activeCable.value
  if(link){result.add(link.a);result.add(link.b)}
  return result
})
function positionHoverTip(event:MouseEvent,text:string){
  const bounds=canvasElement.value?.getBoundingClientRect()
  if(!bounds)return
  hoverTip.value={
    left:Math.max(8,Math.min(bounds.width-260,event.clientX-bounds.left+14)),
    top:Math.max(8,Math.min(bounds.height-72,event.clientY-bounds.top+16)),
    text
  }
}
function hoverDevice(payload:{id:string;active:boolean;event:MouseEvent}){
  if(!payload.active){
    if(hoveredDeviceID.value===payload.id){hoveredDeviceID.value=null;hoverTip.value=null}
    return
  }
  hoveredDeviceID.value=payload.id
  hoveredCableID.value=null
  const device=current.value?.nodes.find(node=>node.id===payload.id)
  if(!device)return
  const activePorts=(current.value?.links||[]).filter(link=>link.a===device.id||link.b===device.id).length
  positionHoverTip(payload.event,`${device.name} · ${device.status==='running'?'Запущен':'Остановлен'} · Соединений: ${activePorts}`)
}
function hoverCable(id:string,active:boolean,event:MouseEvent){
  if(!active){
    if(hoveredCableID.value===id){hoveredCableID.value=null;hoverTip.value=null}
    return
  }
  hoveredCableID.value=id
  hoveredDeviceID.value=null
  const cable=current.value?.links.find(link=>link.id===id)
  if(!cable)return
  const first=current.value?.nodes.find(node=>node.id===cable.a)
  const second=current.value?.nodes.find(node=>node.id===cable.b)
  positionHoverTip(event,`${first?.name||'Устройство'}: ${portLabel(first,cable.aPort)} ↔ ${second?.name||'Устройство'}: ${portLabel(second,cable.bPort)} · ${cable.status||'Соединено'}`)
}
function clearHover(){hoveredDeviceID.value=null;hoveredCableID.value=null;hoverTip.value=null}
const panMode = ref(false)
const drawingMode=ref<'select'|'marquee'|'text'|'note'>('select')
const drawingBox=ref<{left:number;top:number;width:number;height:number}|null>(null)
let noteGesture:{startX:number;startY:number}|null=null
let suppressPaneClick=false
function startAnnotationGesture(event:PointerEvent){
  if(drawingMode.value!=='note'||event.button!==0)return
  const target=event.target as HTMLElement
  if(!target.closest('.vue-flow__pane'))return
  event.preventDefault()
  event.stopPropagation()
  noteGesture={startX:event.clientX,startY:event.clientY}
  updateAnnotationGesture(event)
  window.addEventListener('pointermove',updateAnnotationGesture)
  window.addEventListener('pointerup',finishAnnotationGesture)
  window.addEventListener('pointercancel',cancelAnnotationGesture)
}
function updateAnnotationGesture(event:PointerEvent){
  if(!noteGesture)return
  const bounds=canvasElement.value?.getBoundingClientRect()
  if(!bounds)return
  drawingBox.value={
    left:Math.min(noteGesture.startX,event.clientX)-bounds.left,
    top:Math.min(noteGesture.startY,event.clientY)-bounds.top,
    width:Math.abs(event.clientX-noteGesture.startX),
    height:Math.abs(event.clientY-noteGesture.startY)
  }
}
function cancelAnnotationGesture(){
  window.removeEventListener('pointermove',updateAnnotationGesture)
  window.removeEventListener('pointerup',finishAnnotationGesture)
  window.removeEventListener('pointercancel',cancelAnnotationGesture)
  drawingBox.value=null
  noteGesture=null
}
function finishAnnotationGesture(event:PointerEvent){
  if(!noteGesture)return
  const start=screenToFlowCoordinate({x:noteGesture.startX,y:noteGesture.startY})
  const end=screenToFlowCoordinate({x:event.clientX,y:event.clientY})
  const width=Math.abs(end.x-start.x),height=Math.abs(end.y-start.y)
  const position=clampAnnotationPosition(Math.min(start.x,end.x),Math.min(start.y,end.y))
  suppressPaneClick=true
  cancelAnnotationGesture()
  drawingMode.value='select'
  newAnnotation('note',position)
  if(width>=8&&height>=8){
    annotationDraft.value.width=Math.max(160,Math.min(1200,Math.round(width)))
    annotationDraft.value.height=Math.max(80,Math.min(800,Math.round(height)))
  }
}
const spacePan=ref(false)
function setCanvasMode(mode:'select'|'pan'|'cable'|'marquee'|'text'|'note'){
  panMode.value=mode==='pan'
  cableMode.value=mode==='cable'
  drawingMode.value=mode==='marquee'?'marquee':mode==='text'?'text':mode==='note'?'note':'select'
  firstCableNode.value=null
}
function resetZoom(){void setViewport({x:0,y:0,zoom:1},{duration:150})}
function ignoreEditorKey(event:KeyboardEvent){
  const el=event.target as HTMLElement|null
  if(!el||event.ctrlKey||event.metaKey||event.altKey)return true
  if(el.closest('input,textarea,select,[contenteditable="true"],.dialog-overlay,.term-dock'))return true
  if(document.querySelector('.dialog-overlay'))return true
  return !store.activeLab
}
function paneDoubleClick(event:MouseEvent){
  if(panMode.value||cableMode.value)return
  const point=screenToFlowCoordinate({x:event.clientX,y:event.clientY})
  emit('add-at',{x:Math.round(point.x),y:Math.round(point.y)})
}
function paneClickAt(event:MouseEvent){
  if(suppressPaneClick){suppressPaneClick=false;return}
  if(drawingMode.value==='text'||drawingMode.value==='note'){
    newAnnotation(drawingMode.value,screenToFlowCoordinate({x:event.clientX,y:event.clientY}))
    drawingMode.value='select'
  }
  canvasClick()
}
function onCanvasDragOver(event:DragEvent){
  if(!current.value||panMode.value)return
  if(event.dataTransfer?.types.includes('application/x-netlab-node')||event.dataTransfer?.types.includes('application/x-netlab-template')){
    event.preventDefault()
    if(event.dataTransfer)event.dataTransfer.dropEffect='move'
  }
}
async function onCanvasDrop(event:DragEvent){
  const payload=event.dataTransfer
  if(!payload||!current.value||panMode.value)return
  const nodeID=payload.getData('application/x-netlab-node')
  const templateID=payload.getData('application/x-netlab-template')
  if(!nodeID&&!templateID)return
  event.preventDefault()
  const position=screenToFlowCoordinate({x:event.clientX,y:event.clientY})
  const x=Math.round(position.x),y=Math.round(position.y)
  if(nodeID){
    const device=current.value.nodes.find(n=>n.id===nodeID)
    if(device)try{await store.moveNode(nodeID,x,y)}catch(error){store.failure=(error as Error).message}
  }else if(templateID){
    emit('template-at',{templateID,x,y})
  }
}
const cableMode = ref(false)
const firstCableNode = ref<string | null>(null)
const pending = ref<{a:string;b:string} | null>(null)
const chosen = ref({ a:0, b:0 })
const saving = ref(false)
const selectedOnCanvas=ref<string[]>([])
// The inspector/sidebar uses store.selectedID, while Vue Flow owns a separate
// selection-change event. Both must produce the same persistent visual outline.
function isDeviceSelected(id:string){
  return store.selectedDeviceIDs.includes(id)||selectedOnCanvas.value.includes(id)
}
const selectedDevices=computed(()=>{
  const ids=new Set(store.selectedDeviceIDs)
  for(const id of selectedOnCanvas.value){
    if(current.value?.nodes.some(device=>device.id===id))ids.add(id)
  }
  return [...ids]
})
const movingGroup=ref(false)
const selectingArea=ref(false)
let selectingWithMouse=false
// Vue Flow emits selection-change also while handling Ctrl-click. Those events
// can contain a partially updated selection and would overwrite our own toggle.
// Only accept them while the user is actively drawing a selection rectangle.
function selectionChanged(event:{nodes:Array<{id:string}>}){
  if(!selectingArea.value||panMode.value||cableMode.value)return
  const selected=event.nodes.map(node=>node.id)
  selectedOnCanvas.value=selected
  const primary=event.nodes.find(node=>current.value?.nodes.some(device=>device.id===node.id))
  selectingWithMouse=true
  store.selectDeviceGroup(selected.filter(id=>current.value?.nodes.some(device=>device.id===id)),primary?.id||null)
  selectingWithMouse=false
}
// Keep the sidebar and canvas in sync for both single and group selection.
watch(()=>store.selectedDeviceIDs,ids=>{
  if(!selectingWithMouse)selectedOnCanvas.value=[...ids]
},{flush:'sync'})
// Other inspector actions can still set the primary ID directly.
watch(()=>store.selectedID,id=>{
  if(selectingWithMouse)return
  if(id===null){store.selectedDeviceIDs=[];selectedOnCanvas.value=[]}
  else if(!store.selectedDeviceIDs.includes(id)){
    store.selectedDeviceIDs=[id]
    selectedOnCanvas.value=[id]
  }
},{flush:'sync'})
function bulkSelectedDevices(){
  if(selectedDevices.value.length)emit('bulk', [...selectedDevices.value])
}
const editingID = ref<string | null>(null)
const edit = ref({a:'',b:'',aPort:0,bPort:0,color:'#568bb8',lineWidth:2,lineStyle:'solid' as 'solid'|'dashed'|'dotted'})
const current = computed(() => store.activeLab)
const annotationOpen=ref(false)
const annotationID=ref<string|null>(null)
const annotationSaving=ref(false)
const rememberedBackground=ref('#fff4c4')
function setAnnotationTransparency(value:boolean){
  if(value){
    if(annotationDraft.value.background!=='transparent')rememberedBackground.value=annotationDraft.value.background||'#ffffff'
    annotationDraft.value.background='transparent'
  }else{
    annotationDraft.value.background=rememberedBackground.value
  }
}
watch(()=>annotationOpen.value,open=>{
  if(open&&annotationDraft.value.background!=='transparent')
    rememberedBackground.value=annotationDraft.value.background||'#ffffff'
})

function onAnnotationBackground(event:Event){
  const color=(event.target as HTMLInputElement).value
  rememberedBackground.value=color
  annotationDraft.value.background=color
}
function fitAnnotationHeight(annotation:Omit<Annotation,'id'>):number{
  // Mirror the snapshot's line wrapping, with a larger safety margin for glyphs.
  const fontSize=Math.max(9,Math.min(72,annotation.fontSize||14))
  const font=`${annotation.italic?'italic ':''}${annotation.bold?'700 ':''}${fontSize}px Segoe UI,Arial,sans-serif`
  const context=document.createElement('canvas').getContext('2d')
  if(!context)return annotation.height
  context.font=font
  const contentWidth=Math.max(1,annotation.width-20)
  let lines=0
  for(const paragraph of (annotation.text||'').split('\n')){
    let line=''
    for(const word of paragraph.split(/\s+/).filter(Boolean)){
      const next=line?`${line} ${word}`:word
      if(line&&context.measureText(next).width>contentWidth){lines++;line=word}else line=next
    }
    lines++
  }
  const min=annotation.kind==='note'?58:36
  return Math.max(min,Math.min(800,Math.ceil(lines*fontSize*1.35+24)))
}
function fitDraftHeight(){annotationDraft.value.height=fitAnnotationHeight(annotationDraft.value)}
async function fitExistingAnnotation(){
  const item=editingAnnotation.value
  dismissContextMenu()
  if(!item)return
  const {id:_,...draft}=item
  const height=fitAnnotationHeight(draft)
  if(height!==item.height)try{await store.updateAnnotation(item.id,{...draft,height})}
  catch(e){store.failure=(e as Error).message}
}
const resizePreview=ref<{id:string;rect:AnnotationRect}|null>(null)
const contextMenu=ref<{id:string;x:number;y:number}|null>(null)
const deviceContextMenu=ref<{id:string;x:number;y:number}|null>(null)
const canvasContextMenu=ref<{kind:'pane'|'selection'|'cable';id?:string;x:number;y:number;world:{x:number;y:number}}|null>(null)
const selectedContextNodes=computed(()=>current.value?.nodes.filter(n=>selectedDevices.value.includes(n.id))||[])
const selectedRunning=computed(()=>selectedContextNodes.value.filter(n=>n.status==='running').length)
const selectedStopped=computed(()=>selectedContextNodes.value.filter(n=>n.status!=='running').length)
const contextCable=computed(()=>current.value?.links.find(l=>l.id===canvasContextMenu.value?.id))
function closeCanvasContext(){canvasContextMenu.value=null}
function contextPosition(event:MouseEvent,width=220,height=250){
  const rect=canvasElement.value?.getBoundingClientRect()
  if(!rect)return null
  return {
    x:Math.max(8,Math.min(Math.max(8,rect.width-width-8),event.clientX-rect.left)),
    y:Math.max(8,Math.min(Math.max(8,rect.height-height-8),event.clientY-rect.top)),
    world:screenToFlowCoordinate({x:event.clientX,y:event.clientY})
  }
}
function openPaneContext(event:MouseEvent){
  event.preventDefault()
  if(panMode.value||cableMode.value)return
  closeCanvasContext()
  closeDeviceContext();dismissContextMenu()
  const position=contextPosition(event)
  if(!position)return
  canvasContextMenu.value={kind:selectedDevices.value.length>1?'selection':'pane',...position}
}
function openCableContext(id:string,event:MouseEvent){
  if(panMode.value||cableMode.value)return
  closeDeviceContext();dismissContextMenu()
  const position=contextPosition(event,250,168)
  if(position)canvasContextMenu.value={kind:'cable',id,...position}
}
async function runSelectionContext(operation:'start'|'stop'|'delete'){
  const ids=selectedContextNodes.value.map(n=>n.id)
  closeCanvasContext()
  if(!ids.length)return
  if(operation==='delete'&&!confirm(`Удалить ${ids.length} устройств и их соединения?`))return
  try{await store.bulkNodes(ids,operation)}
  catch(error){store.failure=(error as Error).message}
}
async function alignContextSelection(){
  const devices=[...selectedContextNodes.value].sort((a,b)=>a.y-b.y||a.x-b.x)
  closeCanvasContext()
  if(devices.length<2)return
  const left=Math.min(...devices.map(n=>n.x)),top=Math.min(...devices.map(n=>n.y))
  const columns=Math.ceil(Math.sqrt(devices.length))
  try{await store.moveTopologyItems(devices.map((n,i)=>({
    id:n.id,x:left+(i%columns)*185,y:top+Math.floor(i/columns)*150
  })))}
  catch(error){store.failure=(error as Error).message}
}
function contextAddDevice(){
  const position=canvasContextMenu.value?.world
  closeCanvasContext()
  if(position)emit('add-at',{x:Math.round(position.x),y:Math.round(position.y)})
}
function contextAddAnnotation(kind:'text'|'note'){
  const position=canvasContextMenu.value?.world
  closeCanvasContext()
  newAnnotation(kind,position)
}
function contextFit(){closeCanvasContext();void fitView({padding:.2,duration:250})}
function contextEditCable(){const id=contextCable.value?.id;closeCanvasContext();if(id)editLink(id)}
async function contextDeleteCable(){
  const id=contextCable.value?.id
  closeCanvasContext()
  if(!id||!confirm('Отключить Ethernet-кабель?'))return
  try{await store.disconnect(id)}catch(error){store.failure=(error as Error).message}
}
const contextDevice=computed(()=>current.value?.nodes.find(node=>node.id===deviceContextMenu.value?.id))
const labHasRunningDevices=computed(()=>current.value?.nodes.some(node=>node.status==='running')||false)
function closeDeviceContext(){deviceContextMenu.value=null}
function openDeviceContext(payload:{id:string;event:MouseEvent}){
  if(panMode.value||cableMode.value)return
  closeCanvasContext()
  if(!current.value?.nodes.some(node=>node.id===payload.id))return
  if(selectedDevices.value.length>1&&selectedDevices.value.includes(payload.id)){
    dismissContextMenu()
    const position=contextPosition(payload.event,220,250)
    if(position)canvasContextMenu.value={kind:'selection',...position}
    return
  }
  dismissContextMenu()
  const rect=canvasElement.value?.getBoundingClientRect()
  if(!rect)return
  const menuWidth=215,menuHeight=322
  deviceContextMenu.value={
    id:payload.id,
    x:Math.max(8,Math.min(Math.max(8,rect.width-menuWidth-8),payload.event.clientX-rect.left)),
    y:Math.max(8,Math.min(Math.max(8,rect.height-menuHeight-8),payload.event.clientY-rect.top))
  }
  store.selectedID=payload.id
}
function startCableFromContext(){
  const item=contextDevice.value
  closeDeviceContext()
  if(!item)return
  panMode.value=false
  cableMode.value=true
  firstCableNode.value=item.id
}
function runDeviceContextAction(action:DeviceContextAction){
  const item=contextDevice.value
  closeDeviceContext()
  if(!item)return
  emit('device-action',{id:item.id,action})
}
const resizeState=ref<{original:Annotation;side:ResizeSide;startX:number;startY:number}|null>(null)
const editingAnnotation=computed(()=>current.value?.annotations?.find(note=>note.id===contextMenu.value?.id))
function dismissContextMenu(){contextMenu.value=null}
function openAnnotationContext(payload:{annotation:Annotation;event:MouseEvent}){
  if(panMode.value||cableMode.value)return
  closeDeviceContext()
  const rect=canvasElement.value?.getBoundingClientRect()
  if(!rect)return
  contextMenu.value={
    id:payload.annotation.id,
    x:Math.max(8,Math.min(rect.width-190,payload.event.clientX-rect.left)),
    y:Math.max(8,Math.min(rect.height-155,payload.event.clientY-rect.top))
  }
}
function contextEdit(){
  const item=editingAnnotation.value
  dismissContextMenu()
  if(item)editAnnotation(item)
}
async function contextDuplicate(){
  const item=editingAnnotation.value
  dismissContextMenu()
  if(!item)return
  const {id:_,...draft}=item
  const position=clampAnnotationPosition(item.x+26,item.y+26)
  try{await store.createAnnotation({...draft,...position})}
  catch(e){store.failure=(e as Error).message}
}
async function contextDelete(){
  const item=editingAnnotation.value
  dismissContextMenu()
  if(!item||!confirm('Удалить аннотацию?'))return
  try{await store.removeAnnotation(item.id)}
  catch(e){store.failure=(e as Error).message}
}
function resizeStart(payload:{annotation:Annotation;side:string;event:PointerEvent}){
  if(panMode.value||cableMode.value||resizeState.value)return
  if(payload.event.button!==0)return
  dismissContextMenu()
  const side=payload.side as ResizeSide
  resizeState.value={original:payload.annotation,side,startX:payload.event.clientX,startY:payload.event.clientY}
  resizePreview.value={id:payload.annotation.id,rect:{
    x:payload.annotation.x,y:payload.annotation.y,width:payload.annotation.width,height:payload.annotation.height
  }}
  window.addEventListener('pointermove',resizeMove)
  window.addEventListener('pointerup',resizeFinish)
  window.addEventListener('pointercancel',resizeCancel)
}
function resizeMove(event:PointerEvent){
  const state=resizeState.value
  if(!state)return
  const zoom=Math.max(.15,viewport.value.zoom||1)
  const rect=resizeAnnotation(state.original,state.side,
    (event.clientX-state.startX)/zoom,(event.clientY-state.startY)/zoom)
  resizePreview.value={id:state.original.id,rect}
}
function stopResizeListeners(){
  window.removeEventListener('pointermove',resizeMove)
  window.removeEventListener('pointerup',resizeFinish)
  window.removeEventListener('pointercancel',resizeCancel)
}
function resizeCancel(){
  stopResizeListeners()
  resizeState.value=null
  resizePreview.value=null
}
async function resizeFinish(event:PointerEvent){
  if(!resizeState.value)return
  resizeMove(event)
  const original=resizeState.value.original
  const next=resizePreview.value?.rect
  resizeCancel()
  if(!next||(['x','y','width','height'] as const).every(k=>original[k]===next[k]))return
  const {id:_,...draft}=original
  try{await store.updateAnnotation(original.id,{...draft,...next})}
  catch(e){store.failure=(e as Error).message}
}
function onKeyboard(event:KeyboardEvent){
  if(event.key==='Escape'){
    if(noteGesture)cancelAnnotationGesture()
    dismissContextMenu();closeDeviceContext();closeCanvasContext()
    if(resizeState.value)resizeCancel()
    setCanvasMode('select')
    return
  }
  if(ignoreEditorKey(event)||event.repeat)return
  if(event.code==='Space'){
    if(!spacePan.value){
      spacePan.value=true
      panMode.value=true
      cableMode.value=false
      event.preventDefault()
    }
    return
  }
  const shortcuts:Record<string,'select'|'pan'|'cable'|'marquee'|'text'|'note'>={
    KeyV:'select',KeyH:'pan',KeyC:'cable',KeyM:'marquee',KeyT:'text',KeyN:'note'
  }
  const mode=shortcuts[event.code]
  if(mode){event.preventDefault();setCanvasMode(mode);return}
  if(event.code==='Delete'&&selectedDevices.value.length){
    event.preventDefault()
    emit('delete-selection',[...selectedDevices.value])
  }
}
function onKeyRelease(event:KeyboardEvent){
  if(event.code==='Space'&&spacePan.value){spacePan.value=false;panMode.value=false}
}
onMounted(()=>{window.addEventListener('keydown',onKeyboard);window.addEventListener('keyup',onKeyRelease)})
onBeforeUnmount(()=>{window.removeEventListener('keydown',onKeyboard);window.removeEventListener('keyup',onKeyRelease);resizeCancel();cancelAnnotationGesture()})

const annotationDraft=ref<Omit<Annotation,'id'>>({
  kind:'note',text:'',x:160,y:160,width:220,height:100,
  color:'#253746',background:'#fff4c4',borderColor:'#d2b869',
  borderWidth:1,fontSize:14,bold:false,italic:false,underline:false,align:'left'
})
function newAnnotation(kind:'text'|'note',world?:{x:number;y:number}){
  dismissContextMenu()
  const bounds=canvasElement.value?.getBoundingClientRect()
  const center=world|| (bounds?screenToFlowCoordinate({x:bounds.left+bounds.width/2,y:bounds.top+bounds.height/2}):{x:160,y:160})
  const position=clampAnnotationPosition(center.x-110,center.y-45)
  annotationID.value=null
  annotationDraft.value={
    kind,text:kind==='note'?'Новое примечание':'Текст',...position,
    width:kind==='note'?220:200,height:kind==='note'?100:48,
    color:'#253746',background:kind==='note'?'#fff4c4':'transparent',
    borderColor:kind==='note'?'#d2b869':'#728e9c',
    borderWidth:kind==='note'?1:0,fontSize:14,bold:false,italic:false,underline:false,align:'left'
  }
  annotationOpen.value=true
}
function editAnnotation(annotation:Annotation){
  annotationID.value=annotation.id
  const {id:_id,...fields}=annotation
  annotationDraft.value={...fields}
  annotationOpen.value=true
}
async function saveAnnotation(){
  if(annotationSaving.value)return
  annotationSaving.value=true
  try{
    if(annotationID.value)await store.updateAnnotation(annotationID.value,annotationDraft.value)
    else await store.createAnnotation(annotationDraft.value)
    annotationOpen.value=false
  }finally{annotationSaving.value=false}
}
async function deleteAnnotation(){
  if(!annotationID.value||!confirm('Удалить аннотацию?'))return
  await store.removeAnnotation(annotationID.value)
  annotationOpen.value=false
}
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
const nodes = computed(() => [
  ...(current.value?.nodes.map(device=>({
    id:device.id,type:'device',position:{x:device.x,y:device.y},
    selected:isDeviceSelected(device.id),
    draggable:!panMode.value,selectable:!panMode.value,
    data:{device,anchors:portsByNode.value.get(device.id)||[],
      hovered:hoveredDeviceID.value===device.id,
      connected:connectedHoverDevices.value.has(device.id),
      selected:isDeviceSelected(device.id)}
  }))||[]),
  ...(current.value?.annotations||[]).map(annotation=>{
    const preview=resizePreview.value?.id===annotation.id?resizePreview.value.rect:null
    const shown=preview?{...annotation,...preview}:annotation
    return {
      id:`annotation:${annotation.id}`,type:'annotation',
      selected:selectedOnCanvas.value.includes(`annotation:${annotation.id}`),
      position:{x:shown.x,y:shown.y},draggable:!panMode.value&&!resizeState.value,
      selectable:!panMode.value,data:{annotation:shown}
    }
  })
])
const edges = computed(() => current.value?.links.filter(link=>geometry.value.has(link.id)).map(link => ({
  id:link.id,source:link.a,target:link.b,sourceHandle:`source-${link.id}`,targetHandle:`target-${link.id}`,
  type:'cable',selectable:true,
  data:{aLabel:portLabel(current.value?.nodes.find(n=>n.id===link.a),link.aPort),
    bLabel:portLabel(current.value?.nodes.find(n=>n.id===link.b),link.bPort),
    color:link.color,width:link.lineWidth,lineStyle:link.lineStyle,status:link.status,onEdit:editLink,onContext:openCableContext,onHover:hoverCable,
    emphasized:hoveredCableID.value===link.id,
    related:hoveredDeviceID.value===link.a||hoveredDeviceID.value===link.b}
}))||[])
// After adding/removing a cable, Vue Flow must remeasure DOM handles.
const internalsKey = computed(() => `${store.labID}:${current.value?.nodes.map(n=>`${n.id}:${n.x},${n.y}`).join('|')}:${current.value?.links.map(l=>`${l.id}:${l.a}:${l.b}`).join('|')}`)
watch(internalsKey,async()=>{await nextTick();updateNodeInternals((current.value?.nodes || []).map(n=>n.id))},{flush:'post'})
watch(()=>store.labID,async()=>{clearHover();firstCableNode.value=null;selectedOnCanvas.value=[];store.selectDeviceGroup([],null);dismissContextMenu();closeDeviceContext();closeCanvasContext();resizeCancel();await nextTick();void fitView({padding:.22,duration:250})})
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
async function dragStopped(event:{node:{id:string;position:{x:number;y:number}};nodes?:Array<{id:string;position:{x:number;y:number}}>}){
  if(panMode.value||movingGroup.value)return
  const dragged=event.nodes?.length?event.nodes:[event.node]
  movingGroup.value=true
  try{
    await store.moveTopologyItems(dragged.map(node=>({id:node.id,x:node.position.x,y:node.position.y})))
  }finally{movingGroup.value=false}
}
function picked(event:NodeMouseEvent) {
  if(panMode.value)return
  const id=event.node.id
  if(cableMode.value) {
    if(id.startsWith('annotation:'))return
    if(!firstCableNode.value)firstCableNode.value=id
    else if(firstCableNode.value!==id)chooseEnds(firstCableNode.value,id)
    return
  }
  const additive=event.event.ctrlKey||event.event.metaKey||event.event.shiftKey
  // The input must include the inspector's currently selected device as well
  // as the canvas selection; otherwise the second Ctrl-click loses the first.
  const before=[...new Set([...selectedOnCanvas.value,...store.selectedDeviceIDs])]
  const selected=nextNodeSelection(before,id,additive)
  selectingWithMouse=true
  selectedOnCanvas.value=selected
  const selectedDevices=selected.filter(nodeId=>current.value?.nodes.some(node=>node.id===nodeId))
  const primary=id.startsWith('annotation:')
    ? (additive?store.selectedID:null)
    : (selectedDevices.includes(id)?id:selectedDevices.at(-1)||null)
  store.selectDeviceGroup(selectedDevices,primary)
  selectingWithMouse=false
}
function canvasClick(){
  dismissContextMenu();closeDeviceContext();closeCanvasContext()
  if(!panMode.value&&!cableMode.value){
    selectedOnCanvas.value=[]
    store.selectDeviceGroup([],null)
  }
}
function doubleClick(event:{node:{id:string}}){
  if(event.node.id.startsWith('annotation:')){
    const annotation=current.value?.annotations?.find(item=>item.id===event.node.id.slice('annotation:'.length))
    if(annotation)editAnnotation(annotation)
    return
  }
  const device=current.value?.nodes.find(node=>node.id===event.node.id)
  if(device&&device.status==='running')emit('console',device)
  else if(device)store.failure='Сначала запустите устройство'
}
function closeEditor(){editingID.value=null}
</script>
<template>
  <section ref="canvasElement" class="topology-canvas" aria-label="Редактор топологии" @pointerdown.capture="startAnnotationGesture" @mousedown.capture="preventMiddleAutoscroll" @auxclick="preventMiddleAutoscroll" @dragover="onCanvasDragOver" @drop="onCanvasDrop" @click.self="dismissContextMenu();closeDeviceContext();closeCanvasContext()">
    <VueFlow id="netlab-topology" :nodes="nodes" :edges="edges" :nodes-draggable="!panMode" :nodes-connectable="!panMode"
       :elements-selectable="!panMode" :pan-on-drag="panMode ? [0,1] : [1]" :selection-on-drag="!panMode"
      :multi-selection-key-code="['Control','Meta']"
      :min-zoom=".15" :max-zoom="3" :fit-view-on-init="true"
      @connect="onConnect" @node-drag-stop="dragStopped" @node-click="picked" @node-double-click="doubleClick" @pane-click="paneClickAt" @pane-double-click="paneDoubleClick" @pane-context-menu="openPaneContext" @selection-start="selectingArea=true" @selection-end="selectingArea=false" @selection-change="selectionChanged">
      <Background pattern-color="var(--grid)" :gap="20" :size="1" />
      <template #node-device="data"><DeviceNode :data="data.data" @device-context="openDeviceContext" @device-hover="hoverDevice"/></template>
      <template #node-annotation="data"><AnnotationNode :data="data.data" @resize-start="resizeStart" @context="openAnnotationContext" /></template>
      <template #edge-cable="data"><CableEdge v-bind="data" /></template>
    </VueFlow>
    <div v-if="hoverTip" class="topology-hover-tip" role="status" :style="{left:hoverTip.left+'px',top:hoverTip.top+'px'}">{{hoverTip.text}}</div>
    <!-- Exact tool order of the legacy editor: select, hand, cable / marquee, text, note / add. -->
    <div class="canvas-tools" role="toolbar" aria-label="Инструменты топологии">
      <button type="button" :class="{on:!panMode&&!cableMode&&drawingMode==='select'}" title="Выбор и перемещение (V)" aria-label="Выбор и перемещение" @click="setCanvasMode('select')"><MousePointer2 :size="17"/></button>
      <button type="button" :class="{on:panMode}" title="Перемещение полотна (H / Space)" aria-label="Перемещение полотна" @click="setCanvasMode('pan')"><Hand :size="17"/></button>
      <button type="button" :class="{on:cableMode}" title="Соединение устройств (C)" aria-label="Соединить устройства" @click="setCanvasMode(cableMode?'select':'cable')"><CableIcon :size="17"/></button>
      <span class="tool-separator" aria-hidden="true"/>
      <button type="button" :class="{on:drawingMode==='marquee'}" title="Выделить несколько устройств рамкой (M)" aria-label="Выделение рамкой" @click="setCanvasMode('marquee')"><Scan :size="17"/></button>
      <button type="button" :class="{on:drawingMode==='text'}" title="Добавить текст на поле (T)" aria-label="Добавить текст" @click="setCanvasMode('text')"><Type :size="17"/></button>
      <button type="button" :class="{on:drawingMode==='note'}" title="Добавить примечание (N)" aria-label="Добавить примечание" @click="setCanvasMode('note')"><StickyNote :size="17"/></button>
      <span class="tool-separator" aria-hidden="true"/>
      <button type="button" title="Добавить устройство (+)" aria-label="Добавить устройство" @click="emit('add')"><Plus :size="18"/></button>
    </div>
    <div v-if="selectedDevices.length>1" class="canvas-selection-actions">
      <span>Выбрано: {{selectedDevices.length}}</span>
      <button type="button" @click="bulkSelectedDevices">Действия</button>
    </div>
    <div class="canvas-scale" aria-label="Масштаб полотна">
      <button type="button" title="Уменьшить" @click="zoomOut({duration:150})"><Minus :size="16"/></button>
      <button type="button" title="Увеличить" @click="zoomIn({duration:150})"><Plus :size="16"/></button>
      <button type="button" title="Масштаб 100%" @click="resetZoom">100%</button>
      <button type="button" title="Показать всё" @click="fitView({padding:.2,duration:250})"><Maximize :size="16"/></button>
    </div>
    <div v-if="drawingBox" class="canvas-annotation-preview" :style="{left:drawingBox.left+'px',top:drawingBox.top+'px',width:drawingBox.width+'px',height:drawingBox.height+'px'}"></div>
    <div v-if="cableMode" class="canvas-cable-hint"><CableIcon :size="14"/> {{firstCableNode?'Выберите второе устройство':'Выберите первое устройство'}} <button title="Отменить" @click="cableMode=false;firstCableNode=null"><X :size="13"/></button></div>
    <div v-if="!current?.nodes.length" class="canvas-empty"><MonitorPlay :size="30"/><strong>Лаборатория пуста</strong><span>Нажмите «+», чтобы добавить устройство</span></div>
    <div v-if="canvasContextMenu" class="device-context-menu canvas-context-menu" role="menu" aria-label="Действия на топологии" :style="{left:`${canvasContextMenu.x}px`,top:`${canvasContextMenu.y}px`}">
      <template v-if="canvasContextMenu.kind==='pane'">
        <button role="menuitem" type="button" @click="contextAddDevice"><Plus :size="15"/> Добавить устройство сюда</button>
        <button role="menuitem" type="button" @click="contextAddAnnotation('text')"><Type :size="15"/> Добавить текст</button>
        <button role="menuitem" type="button" @click="contextAddAnnotation('note')"><StickyNote :size="15"/> Добавить примечание</button>
        <div class="device-context-divider"/>
        <button role="menuitem" type="button" @click="contextFit"><Scan :size="15"/> Показать всю топологию</button>
      </template>
      <template v-else-if="canvasContextMenu.kind==='selection'">
        <div class="device-context-heading">Выбрано устройств: {{selectedContextNodes.length}}</div>
        <button role="menuitem" type="button" :disabled="!selectedStopped" @click="runSelectionContext('start')"><Play :size="15"/> Запустить выбранные</button>
        <button role="menuitem" type="button" :disabled="!selectedRunning" @click="runSelectionContext('stop')"><Square :size="15"/> Остановить выбранные</button>
        <button role="menuitem" type="button" @click="alignContextSelection"><Scan :size="15"/> Автовыравнивание</button>
        <div class="device-context-divider"/>
        <button role="menuitem" type="button" class="danger" :disabled="!!selectedRunning" @click="runSelectionContext('delete')"><Trash2 :size="15"/> Удалить выбранные</button>
      </template>
      <template v-else-if="canvasContextMenu.kind==='cable'&&contextCable">
        <div class="device-context-heading">Ethernet-соединение <small>{{contextCable.status||'Подключено'}}</small></div>
        <button role="menuitem" type="button" @click="contextEditCable"><CableIcon :size="15"/> Изменить соединение и оформление</button>
        <div class="device-context-divider"/>
        <button role="menuitem" type="button" class="danger" @click="contextDeleteCable"><Trash2 :size="15"/> Отключить кабель</button>
      </template>
    </div>
    <div v-if="deviceContextMenu&&contextDevice" class="device-context-menu" role="menu" :aria-label="'Действия с устройством '+contextDevice.name" :style="{left:`${deviceContextMenu.x}px`,top:`${deviceContextMenu.y}px`}">
      <div class="device-context-heading">{{contextDevice.name}} <small>{{contextDevice.status==='running'?'Запущено':'Остановлено'}}</small></div>
      <button v-if="contextDevice.status!=='running'" type="button" role="menuitem" @click="runDeviceContextAction('start')"><Play :size="15"/> Запустить</button>
      <button v-else type="button" role="menuitem" @click="runDeviceContextAction('stop')"><Square :size="15"/> Остановить</button>
      <button type="button" role="menuitem" :disabled="contextDevice.status!=='running'" @click="runDeviceContextAction('console')"><MonitorPlay :size="15"/> Открыть консоль</button>
      <button v-if="contextDevice.engine!=='vpcs'" type="button" role="menuitem" :disabled="contextDevice.status!=='running'" @click="runDeviceContextAction('graphics')"><MonitorPlay :size="15"/> Экран VNC</button>
      <div class="device-context-divider"></div>
      <button type="button" role="menuitem" @click="startCableFromContext"><CableIcon :size="15"/> Протянуть кабель</button>
      <button type="button" role="menuitem" @click="runDeviceContextAction('rename')"><Type :size="15"/> Переименовать</button>
      <button type="button" role="menuitem" @click="runDeviceContextAction('ports')"><CableIcon :size="15"/> Интерфейсы</button>
      <button v-if="contextDevice.engine!=='vpcs'" type="button" role="menuitem" @click="runDeviceContextAction('hardware')"><Scan :size="15"/> Параметры QEMU</button>
      <button type="button" role="menuitem" @click="runDeviceContextAction('icon')"><StickyNote :size="15"/> Выбрать значок</button>
      <button type="button" role="menuitem" @click="runDeviceContextAction('log')"><Type :size="15"/> Журнал устройства</button>
      <div class="device-context-divider"></div>
      <button type="button" role="menuitem" class="danger" :disabled="labHasRunningDevices" :title="labHasRunningDevices?'Для удаления остановите лабораторию':'Удалить узел и его соединения'" @click="runDeviceContextAction('delete')"><Trash2 :size="15"/> Удалить устройство</button>
    </div>
    <div v-if="contextMenu&&editingAnnotation" class="annotation-context-menu" role="menu" aria-label="Аннотация" :style="{left:`${contextMenu.x}px`,top:`${contextMenu.y}px`}">
      <button type="button" role="menuitem" @click="contextEdit">Изменить оформление</button>
      <button type="button" role="menuitem" @click="contextDuplicate">Дублировать</button>
      <button type="button" role="menuitem" @click="fitExistingAnnotation">Подогнать высоту под текст</button>
      <button type="button" role="menuitem" class="danger" @click="contextDelete">Удалить</button>
    </div>
    <div v-if="annotationOpen" class="dialog-overlay" @click.self="annotationOpen=false">
      <form class="dialog-card annotation-dialog" @submit.prevent="saveAnnotation">
        <div class="dialog-heading"><StickyNote :size="18"/><strong>{{annotationID?'Редактировать':'Добавить'}} {{annotationDraft.kind==='note'?'примечание':'текст'}}</strong></div>
        <label>Текст<textarea v-model="annotationDraft.text" maxlength="1000" rows="3"/></label>
        <div class="dialog-columns"><label>Ширина, px<input v-model.number="annotationDraft.width" type="number" :min="annotationDraft.kind==='note'?144:96" max="1200" required/></label>
        <label>Высота, px<input v-model.number="annotationDraft.height" type="number" :min="annotationDraft.kind==='note'?58:36" max="800" required/></label></div>
        <div class="dialog-columns"><label>Цвет текста<input v-model="annotationDraft.color" type="color"/></label>
        <label>Размер шрифта<input v-model.number="annotationDraft.fontSize" type="number" min="9" max="72" required/></label></div>
        <div class="dialog-columns"><label>Цвет заливки<input type="color" :disabled="annotationDraft.background==='transparent'" :value="annotationDraft.background==='transparent'?rememberedBackground:annotationDraft.background" @input="onAnnotationBackground"/></label>
        <label>Цвет рамки<input v-model="annotationDraft.borderColor" type="color"/></label></div>
        <label class="annotation-transparency"><input type="checkbox" :checked="annotationDraft.background==='transparent'"
          @change="setAnnotationTransparency(($event.target as HTMLInputElement).checked)"/> Без заливки (прозрачный фон)</label>
        <div class="dialog-columns"><label>Толщина рамки<input v-model.number="annotationDraft.borderWidth" type="number" min="0" max="4"/></label>
        <label>Подгонка высоты<button type="button" @click="fitDraftHeight">Подогнать под текст</button></label></div>
        <div class="dialog-columns"><label>Готовые цвета<UiSelect v-model="annotationDraft.background"><option value="transparent">Прозрачный</option><option value="#fff4c4">Жёлтый</option><option value="#e4f1ff">Голубой</option><option value="#f2eaff">Фиолетовый</option><option value="#ffffff">Белый</option></UiSelect></label>
        <label>Выравнивание<UiSelect v-model="annotationDraft.align"><option value="left">Слева</option><option value="center">По центру</option><option value="right">Справа</option></UiSelect></label></div>
        <div class="annotation-format"><label><input v-model="annotationDraft.bold" type="checkbox"/> Жирный</label><label><input v-model="annotationDraft.italic" type="checkbox"/> Курсив</label><label><input v-model="annotationDraft.underline" type="checkbox"/> Подчёркнутый</label></div>
        <div class="dialog-actions"><button v-if="annotationID" type="button" class="cable-delete" @click="deleteAnnotation"><Trash2 :size="14"/> Удалить</button><button type="button" @click="annotationOpen=false">Отмена</button>
          <button class="primary" :disabled="annotationSaving||annotationDraft.width<(annotationDraft.kind==='note'?144:96)||annotationDraft.width>1200||annotationDraft.height<(annotationDraft.kind==='note'?58:36)||annotationDraft.height>800">Сохранить</button></div>
      </form>
    </div>
    <div v-if="pending" class="dialog-overlay" @click.self="pending=null">
      <form class="dialog-card" @submit.prevent="createLink">
        <div class="dialog-heading"><CableIcon :size="18"/><strong>Подключить Ethernet</strong></div>
        <p>{{startName}} ↔ {{endName}}</p>
        <label>Интерфейс {{startName}}<UiSelect v-model.number="chosen.a"><option v-for="p in firstPorts" :key="p" :value="p">{{portLabel(current?.nodes.find(n=>n.id===pending?.a),p)}}</option></UiSelect></label>
        <label>Интерфейс {{endName}}<UiSelect v-model.number="chosen.b"><option v-for="p in secondPorts" :key="p" :value="p">{{portLabel(current?.nodes.find(n=>n.id===pending?.b),p)}}</option></UiSelect></label>
        <div class="dialog-actions"><button type="button" @click="pending=null">Отмена</button><button type="submit" class="primary" :disabled="saving||!firstPorts.length||!secondPorts.length">Подключить</button></div>
      </form>
    </div>
    <div v-if="editingID&&editCable" class="dialog-overlay" @click.self="closeEditor">
      <form class="dialog-card cable-dialog" @submit.prevent="saveLink">
        <div class="dialog-heading"><CableIcon :size="18"/><strong>Настройки Ethernet-кабеля</strong></div>
        <p>Смена интерфейсов переподключает Ethernet на горячую. Оформление не влияет на сеть.</p>
        <div class="dialog-columns"><label>Устройство A<UiSelect v-model="edit.a" @change="changeEndpoint('a')"><option v-for="device in current?.nodes||[]" :key="device.id" :value="device.id">{{device.name}}</option></UiSelect></label>
          <label>Устройство B<UiSelect v-model="edit.b" @change="changeEndpoint('b')"><option v-for="device in current?.nodes||[]" :key="device.id" :value="device.id">{{device.name}}</option></UiSelect></label></div>
        <div class="dialog-columns"><label>Интерфейс A<UiSelect v-model.number="edit.aPort"><option v-for="p in editFirstPorts" :key="p" :value="p">{{portLabel(editA,p)}}</option></UiSelect></label>
          <label>Интерфейс B<UiSelect v-model.number="edit.bPort"><option v-for="p in editSecondPorts" :key="p" :value="p">{{portLabel(editB,p)}}</option></UiSelect></label></div>
        <div class="dialog-columns cable-style"><label>Цвет<input v-model="edit.color" type="color" /></label><label>Толщина<UiSelect v-model.number="edit.lineWidth"><option v-for="n in [1,2,3,4]" :key="n" :value="n">{{n}} px</option></UiSelect></label>
          <label>Линия<UiSelect v-model="edit.lineStyle"><option value="solid">Сплошная</option><option value="dashed">Пунктир</option><option value="dotted">Точки</option></UiSelect></label></div>
        <svg class="cable-preview" viewBox="0 0 340 38"><line x1="15" y1="19" x2="325" y2="19" :stroke="edit.color" :stroke-width="edit.lineWidth" :stroke-dasharray="edit.lineStyle==='dashed'?'8 5':edit.lineStyle==='dotted'?'2 5':undefined" stroke-linecap="round"/><circle cx="15" cy="19" r="3" fill="var(--surface)" stroke="var(--accent)"/><circle cx="325" cy="19" r="3" fill="var(--surface)" stroke="var(--accent)"/></svg>
        <div class="dialog-actions"><button type="button" class="cable-delete" @click="deleteLink"><Trash2 :size="14"/> Удалить</button><button type="button" @click="closeEditor">Отмена</button><button class="primary" :disabled="saving||edit.a===edit.b||!editFirstPorts.includes(edit.aPort)||!editSecondPorts.includes(edit.bPort)">Применить</button></div>
      </form>
    </div>
  </section>
</template>
