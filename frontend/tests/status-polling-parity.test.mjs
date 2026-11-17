import test from 'node:test'
import assert from 'node:assert/strict'
import {sameTopologyStructure} from '../src/topology/status-reconcile.ts'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
const read=path=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),'utf8')
const node={id:'pc',name:'PC',engine:'vpcs',kind:'pc',x:10,y:20,status:'stopped',nicCount:1}
const lab={id:'lab',name:'Lab',nodes:[node],links:[],annotations:[]}
const clone=()=>JSON.parse(JSON.stringify(lab))
test('status and error changes retain current Vue Flow node objects',()=>{
  const updated=clone()
  updated.nodes[0].status='running'
  updated.nodes[0].error='temporary log'
  assert.equal(sameTopologyStructure(lab,updated),true)
})
test('geometry, connections, image and annotation edits are structural',()=>{
  for(const mutate of [
    v=>v.nodes[0].x++,
    v=>v.nodes[0].name='Renamed',
    v=>v.nodes[0].imageId='disk',
    v=>v.nodes.push({...node,id:'second'}),
    v=>v.links.push({id:'wire',a:'pc',b:'pc',aPort:0,bPort:0}),
    v=>v.annotations.push({id:'t',kind:'text',text:'x',x:0,y:0,width:100,height:40}),
  ]){
    const updated=clone()
    mutate(updated)
    assert.equal(sameTopologyStructure(lab,updated),false)
  }
})
test('poll uses per-lab endpoint without UI destructive refresh while dragging',()=>{
  const store=read('../src/stores/netlab.ts')
  const app=read('../src/App.vue')
  assert.match(store,/async function pollActiveLab\(/)
  assert.match(store,/sameTopologyStructure\(existing,snapshot\)/)
  assert.match(store,/if\(node\.status!==remote\.status\)node\.status=remote\.status/)
  assert.match(store,/if\(labID\.value!==id\)return/)
  assert.match(app,/store\.pollActiveLab\(\)/)
  assert.match(app,/\.vue-flow__node\.dragging/)
})
