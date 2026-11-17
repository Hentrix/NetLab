import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api, json } from '@/api/client'
import type { Cable, Device, Annotation, ImageRecord, Lab, Template, HostSystem, HostMetrics } from '@/types'

export const useNetlabStore = defineStore('netlab', () => {
  const token = ref(sessionStorage.getItem('netlabToken') || '')
  const labs = ref<Lab[]>([])
  const images = ref<ImageRecord[]>([])
  const templates = ref<Template[]>([])
  const system = ref<HostSystem>({})
  const metrics = ref<HostMetrics | null>(null)
  const checking = ref(false)
  const labID = ref<string | null>(null)
  const selectedID = ref<string | null>(null)
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
  function logout() { authenticate(''); labs.value = []; labID.value = null; selectedID.value = null }
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
    await action(()=>api<unknown>(token.value,`labs/${current().id}/${operation}`,{method:'POST'})); await refresh()
  }
  return {token,labs,images,templates,system,metrics,checking,labID,selectedID,busy,failure,live,activeLab,selectedNode,
    authenticate,logout,refresh,refreshSystem,bootstrap,createLab,deleteLab,uploadImage,deleteImage,renameLab,createAnnotation,updateAnnotation,removeAnnotation,addNode,addNodesBatch,moveNode,nodePower,renameNode,
    removeNode,updateNode,bulkNodes,connect,disconnect,updateCable,labPower}
})
