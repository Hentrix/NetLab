import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api, json } from '@/api/client'
import { sameTopologyStructure } from '@/topology/status-reconcile'
import type { Cable, Device, Annotation, ImageRecord, Lab, Template, HostSystem, HostMetrics, LabStartProgress } from '@/types'

export const useNetlabStore = defineStore('netlab', () => {
  const token = ref(sessionStorage.getItem('netlabToken') || '')
  const labs = ref<Lab[]>([])
  const images = ref<ImageRecord[]>([])
  const templates = ref<Template[]>([])
  const system = ref<HostSystem>({})
  const metrics = ref<HostMetrics | null>(null)
  const checking = ref(false)
  const startProgress = ref<LabStartProgress | null>(null)
  const labID = ref<string | null>(null)
  const selectedID = ref<string | null>(null)
  // IDs of all devices selected in the active lab; selectedID is the inspector's primary node.
  const selectedDeviceIDs = ref<string[]>([])
  function selectDeviceGroup(ids: string[], primary?: string | null) {
    const allowed = new Set(activeLab.value?.nodes.map(node=>node.id)||[])
    selectedDeviceIDs.value=[...new Set(ids)].filter(id=>allowed.has(id))
    const chosen=primary===undefined?selectedDeviceIDs.value.at(-1)||null:primary
    selectedID.value=chosen&&allowed.has(chosen)?chosen:null
  }
  function clickDeviceInSidebar(id: string, additive: boolean) {
    const before=selectedDeviceIDs.value.length?selectedDeviceIDs.value:selectedID.value?[selectedID.value]:[]
    const next=additive?(before.includes(id)?before.filter(value=>value!==id):[...before,id]):[id]
    selectDeviceGroup(next,next.includes(id)?id:next.at(-1)||null)
  }
  const busy = ref(false)
  const failure = ref('')
  const live = ref(false)
  const activeLab = computed(() => labs.value.find(l => l.id === labID.value) || null)
  const selectedNode = computed(() => activeLab.value?.nodes.find(n => n.id === selectedID.value) || null)
  const current = () => { const l = activeLab.value; if (!l) throw Error('Сначала выберите лабораторию'); return l }
  async function action<T>(fn: () => Promise<T>): Promise<T> {
    failure.value = ''
    try { return await fn() } catch (e) { failure.value = (e as Error).message; throw e }
  }
  function authenticate(value: string) { token.value = value.trim(); sessionStorage.setItem('netlabToken', token.value) }
  function logout() { authenticate(''); labs.value = []; labID.value = null; selectedID.value = null; selectedDeviceIDs.value=[] }
  async function refresh() {
    if (!token.value) return
    await action(async () => {
      const result = await api<Lab[]>(token.value, 'labs')
      labs.value = result
      if (!labID.value || !result.some(l=>l.id===labID.value)) labID.value = result[0]?.id ?? null
      if (selectedID.value && !activeLab.value?.nodes.some(n=>n.id===selectedID.value)) selectedID.value = null
      live.value = true
    }).catch(() => { live.value = false })
  }
  let polling=false
  /** Cheap, best-effort 3.5s tick. Preserve existing reactive node identities
   * while only statuses change, so Vue Flow does not re-create a drag target.
   */
  async function pollActiveLab(){
    const id=labID.value
    if(!token.value||!id||polling)return
    polling=true
    try{
      const snapshot=await api<Lab>(token.value,`labs/${id}`)
      if(labID.value!==id)return // The user switched labs while the request was in flight.
      const index=labs.value.findIndex(lab=>lab.id===id)
      if(index<0)return
      const existing=labs.value[index]
      if(!sameTopologyStructure(existing,snapshot)){
        // Remote edits/new nodes require a full update, unlike pure status ticks.
        labs.value[index]=snapshot
        const available=new Set(snapshot.nodes.map(node=>node.id))
        selectedDeviceIDs.value=selectedDeviceIDs.value.filter(nodeId=>available.has(nodeId))
        if(selectedID.value&&!available.has(selectedID.value))selectedID.value=null
      }else{
        for(let i=0;i<existing.nodes.length;i++){
          const node=existing.nodes[i],remote=snapshot.nodes[i]
          if(node.status!==remote.status)node.status=remote.status
          if(node.error!==remote.error)node.error=remote.error
        }
        for(let i=0;i<existing.links.length;i++){
          const cable=existing.links[i],remote=snapshot.links[i]
          if(cable.status!==remote.status)cable.status=remote.status
        }
      }
      live.value=true
    }catch{
      // Do not overwrite a user-visible action error with background polling noise.
      live.value=false
    }finally{polling=false}
  }
  async function bootstrap() {
    busy.value = true
    try {
      await refresh()
      if (!live.value) return
      const [imgs, tpls, sys, met] = await Promise.all([
        api<ImageRecord[]>(token.value,'images'), api<Template[]>(token.value,'templates'),
        api<HostSystem>(token.value,'system'), api<HostMetrics>(token.value,'metrics')
      ])
      images.value = imgs; templates.value = tpls; system.value = sys; metrics.value = met
    } catch(e) { failure.value = (e as Error).message }
    finally { busy.value = false }
  }
  async function refreshSystem() {
    if (!token.value || checking.value) return
    checking.value = true
    try {
      const [sys, met] = await Promise.all([
        api<HostSystem>(token.value, 'system'), api<HostMetrics>(token.value, 'metrics')
      ])
      system.value = sys; metrics.value = met
    } catch (error) { failure.value = (error as Error).message }
    finally { checking.value = false }
  }
  async function deleteLab(id: string) {
    await action(()=>api<unknown>(token.value,`labs/${id}`,{method:'DELETE'}))
    if(labID.value===id){labID.value=null;selectedID.value=null}
    await refresh()
  }
  async function uploadImage(file: File) {
    const body=new FormData();body.append('file',file)
    const image=await action(()=>api<ImageRecord>(token.value,'images',{method:'POST',body}))
    images.value=await api<ImageRecord[]>(token.value,'images')
    return image
  }
  async function createBlankImage(name:string,sizeGiB:number){
    const image=await action(()=>api<ImageRecord>(token.value,'images/blank',{method:'POST',body:json({name,sizeGiB})}))
    await refreshImages()
    return image
  }
  async function prepareWorkshopFromISO(payload:{
    name:string;isoId:string;category:string;family:string;version:string;
    sizeGiB:number;ram:number;cpus:number;nicModel:string
  }){
    const result=await action(()=>api<{image:ImageRecord;lab:Lab;node:Device}>(token.value,'workshop/prepare',{
      method:'POST',body:json(payload)
    }))
    labID.value=result.lab.id
    await Promise.all([refresh(),refreshImages()])
    selectDeviceGroup([result.node.id],result.node.id)
    return result
  }
  async function createWorkshopRevision(imageId:string,name:string,version:string){
    const result=await action(()=>api<{image:ImageRecord;lab:Lab;node:Device}>(token.value,'workshop/revise',{
      method:'POST',body:json({imageId,name,version})
    }))
    labID.value=result.lab.id
    await Promise.all([refresh(),refreshImages()])
    selectDeviceGroup([result.node.id],result.node.id)
    return result
  }
  async function configureNodeMedia(labId:string,nodeId:string,installISOId:string,bootOrder:'disk'|'cdrom'){
    await action(()=>api<Device>(token.value,`labs/${labId}/nodes/${nodeId}/media`,{
      method:'PATCH',body:json({installISOId,bootOrder})
    }))
    await refresh()
  }
  async function publishWorkshop(labId:string,nodeId:string,name:string,category:string,family:string,version:string){
    const image=await action(()=>api<ImageRecord>(token.value,'workshop/publish',{method:'POST',
      body:json({labId,nodeId,name,category,family,version})}))
    await Promise.all([refreshImages(),refreshTemplates()])
    return image
  }
  async function updateImageMetadata(id:string,name:string,category:string,family:string,version:string){
    const image=await action(()=>api<ImageRecord>(token.value,`images/${id}`,{method:'PATCH',
      body:json({name,category,family,version})}))
    await Promise.all([refreshImages(),refreshTemplates()])
    return image
  }
  async function refreshTemplates(){
    templates.value=await action(()=>api<Template[]>(token.value,'templates'))
  }
  async function refreshImages(){
    images.value=await action(()=>api<ImageRecord[]>(token.value,'images'))
  }
  async function deleteImage(id: string) {
    await action(()=>api<unknown>(token.value,`images/${id}`,{method:'DELETE'}))
    images.value=await api<ImageRecord[]>(token.value,'images')
  }
  async function createLab(name: string) {
    const item = await action(()=>api<Lab>(token.value,'labs',{method:'POST',body:json({name})}))
    await refresh(); labID.value = item.id
  }
  async function createAnnotation(payload: Omit<Annotation, 'id'>) {
    await action(()=>api<Annotation>(token.value,`labs/${current().id}/annotations`,{method:'POST',body:json(payload)}))
    await refresh()
  }
  async function updateAnnotation(id: string, payload: Omit<Annotation, 'id'>) {
    await action(()=>api<Annotation>(token.value,`labs/${current().id}/annotations/${id}`,{method:'PATCH',body:json(payload)}))
    await refresh()
  }
  async function removeAnnotation(id: string) {
    await action(()=>api<unknown>(token.value,`labs/${current().id}/annotations/${id}`,{method:'DELETE'}))
    await refresh()
  }
  async function renameLab(name: string) {
    await action(()=>api<Lab>(token.value,`labs/${current().id}`,{method:'PATCH',body:json({name})})); await refresh()
  }
  async function addNode(payload: Partial<Device>) {
    const lab = current()
    await action(()=>api<Device>(token.value,`labs/${lab.id}/nodes`,{method:'POST',body:json(payload)})); await refresh()
  }
  async function addNodesBatch(template: Partial<Device>, count: number) {
    await action(()=>api<unknown>(token.value,`labs/${current().id}/nodes/batch`,{method:'POST',body:json({template,count})}))
    await refresh()
  }
  // Persist Vue Flow group drag in one batch of requests, then refresh once.
  // The existing Go endpoints validate coordinates and annotation shape.
  async function moveTopologyItems(items: Array<{id:string;x:number;y:number}>): Promise<void> {
    const lab=current()
    const nodes=new Map(lab.nodes.map(node=>[node.id,node]))
    const annotations=new Map((lab.annotations||[]).map(note=>[note.id,note]))
    const unique=new Map(items.map(item=>[item.id,item]))
    const errors:string[]=[]
    let completed=0
    for(const item of unique.values()){
      const x=Math.round(item.x),y=Math.round(item.y)
      const annotationID=item.id.startsWith('annotation:')?item.id.slice('annotation:'.length):null
      const annotation=annotationID?annotations.get(annotationID):null
      const node=nodes.get(item.id)
      if(!node&&!annotation)continue
      if((node?node.x:annotation!.x)===x&&(node?node.y:annotation!.y)===y)continue
      try {
        if(annotation&&annotationID){
          const {id:_,...fields}=annotation
          await api<Annotation>(token.value,`labs/${lab.id}/annotations/${annotationID}`,{
            method:'PATCH',body:json({...fields,x,y})
          })
        }else if(node){
          await api<Device>(token.value,`labs/${lab.id}/nodes/${node.id}`,{method:'PATCH',body:json({x,y})})
        }
        completed++
      }catch(error){
        errors.push(`${node?.name||'Примечание'}: ${(error as Error).message}`)
      }
    }
    await refresh()
    if(errors.length)failure.value=`Не удалось переместить ${errors.length} элементов (перемещено: ${completed}): ${errors.join('; ')}`
  }
  async function moveNode(id: string, x: number, y: number) {
    const lab = current()
    await action(()=>api<Device>(token.value,`labs/${lab.id}/nodes/${id}`,{method:'PATCH',body:json({x: Math.round(x), y: Math.round(y)})}))
    await refresh()
  }
  // Bulk operations target a snapshot of lab/node IDs. Refresh once at the
  // end even after partial failure, so the UI reflects committed operations.
  async function bulkNodes(ids: string[], operation: 'start' | 'stop' | 'delete'): Promise<{completed:number; failed:{id:string;error:string}[]}> {
    const lab=current()
    const allowed=new Set(lab.nodes.map(node=>node.id))
    const target=[...new Set(ids)].filter(id=>allowed.has(id))
    const failed:{id:string;error:string}[]=[]
    let completed=0
    for(const id of target){
      try{
        const suffix=operation==='delete'?'':`/${operation}`
        await api<unknown>(token.value,`labs/${lab.id}/nodes/${id}${suffix}`,{method:operation==='delete'?'DELETE':'POST'})
        completed++
      }catch(e){failed.push({id,error:`${lab.nodes.find(n=>n.id===id)?.name||id}: ${(e as Error).message}`})}
    }
    await refresh()
    if(failed.length)failure.value=`Не выполнено (${failed.length}): ${failed.map(item=>item.error).join('; ')}`
    return {completed,failed}
  }
  async function nodePower(id: string, operation: 'start' | 'stop') {
    await action(()=>api<unknown>(token.value,`labs/${current().id}/nodes/${id}/${operation}`,{method:'POST'})); await refresh()
  }
  // Full hardware edits require all devices in the lab to be stopped.
  // PUT is intentionally distinct from live presentation-only PATCH.
  async function configureQemuNode(id:string, payload:Device){
    const lab=current()
    if(lab.nodes.some(node=>node.status==='running'))throw Error('Сначала остановите всю лабораторию')
    await action(()=>api<Device>(token.value,`labs/${lab.id}/nodes/${id}`,{method:'PUT',body:json(payload)}))
    await refresh()
  }
  async function updateNode(id: string, payload: Pick<Partial<Device>, "icon" | "portStyle" | "ports">) {
    await action(()=>api<Device>(token.value,`labs/${current().id}/nodes/${id}`,{method:"PATCH",body:json(payload)})); await refresh()
  }
  async function renameNode(id: string, name: string) {
    const lab = current()
    await action(()=>api<Device>(token.value,`labs/${lab.id}/nodes/${id}`,{method:'PATCH',body:json({name})})); await refresh()
  }
  async function removeNode(id: string) {
    const lab = current()
    await action(()=>api<unknown>(token.value,`labs/${lab.id}/nodes/${id}`,{method:'DELETE'})); await refresh()
  }
  async function connect(a: string, b: string, aPort: number, bPort: number) {
    await action(()=>api<Cable>(token.value,`labs/${current().id}/links`,{method:'POST',body:json({a,b,aPort,bPort})})); await refresh()
  }
  async function disconnect(id: string) {
    await action(()=>api<unknown>(token.value,`labs/${current().id}/links/${id}`,{method:'DELETE'})); await refresh()
  }
  async function updateCable(id: string, payload: Partial<Cable>) {
    await action(()=>api<Cable>(token.value,`labs/${current().id}/links/${id}`,{method:'PATCH',body:json(payload)})); await refresh()
  }
  async function labPower(operation: 'start' | 'stop') {
    const lab=current()
    if(operation==='stop'){
      if(startProgress.value?.status==='running'&&startProgress.value.labId===lab.id)
        throw Error('Завершите запуск лаборатории перед остановкой всей топологии')
      await action(()=>api<unknown>(token.value,`labs/${lab.id}/stop`,{method:'POST'}))
      await refresh()
      return
    }
    if(startProgress.value?.status==='running'&&startProgress.value.labId===lab.id)
      throw Error('Запуск этой лаборатории уже выполняется')
    const started=await action(()=>api<LabStartProgress>(token.value,`labs/${lab.id}/start-job`,{method:'POST'}))
    startProgress.value=started
    try{
      for(let attempt=0;attempt<1200;attempt++){
        const snapshot=await api<LabStartProgress>(token.value,`labs/${lab.id}/start-job`)
        if(snapshot.id!==started.id)throw Error('Операция запуска была заменена другой')
        startProgress.value=snapshot
        if(snapshot.status!=='running'){
          if(snapshot.status==='failed')throw Error(snapshot.error||'Не удалось запустить лабораторию')
          return
        }
        await new Promise<void>(resolve=>setTimeout(resolve,500))
      }
      throw Error('Превышено время отслеживания запуска; проверьте состояние сервера')
    }catch(e){
      failure.value=(e as Error).message
      throw e
    }finally{
      await refresh()
    }
  }
  return {token,labs,images,templates,system,metrics,checking,labID,selectedID,selectedDeviceIDs,selectDeviceGroup,clickDeviceInSidebar,busy,failure,live,activeLab,selectedNode,
    authenticate,logout,refresh,pollActiveLab,refreshSystem,bootstrap,createLab,deleteLab,uploadImage,deleteImage,refreshImages,refreshTemplates,createBlankImage,prepareWorkshopFromISO,createWorkshopRevision,configureNodeMedia,publishWorkshop,updateImageMetadata,renameLab,createAnnotation,updateAnnotation,removeAnnotation,addNode,addNodesBatch,moveNode,nodePower,renameNode,
    removeNode,updateNode,configureQemuNode,bulkNodes,moveTopologyItems,connect,disconnect,updateCable,labPower,startProgress}
})
