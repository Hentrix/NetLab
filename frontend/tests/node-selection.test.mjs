import test from 'node:test'
import assert from 'node:assert/strict'
import { nextNodeSelection } from '../src/topology/node-selection.ts'

test('single click selects one device, Ctrl adds a second and a third',()=>{
  let selected=nextNodeSelection([],'pc1',false)
  assert.deepEqual(selected,['pc1'])
  selected=nextNodeSelection(selected,'pc2',true)
  assert.deepEqual(selected,['pc1','pc2'])
  selected=nextNodeSelection(selected,'pc3',true)
  assert.deepEqual(selected,['pc1','pc2','pc3'])
})
test('Ctrl+click on an already selected device toggles only that device off',()=>{
  let selected=['pc1','pc2','pc3']
  selected=nextNodeSelection(selected,'pc2',true)
  assert.deepEqual(selected,['pc1','pc3'])
  selected=nextNodeSelection(selected,'pc3',true)
  assert.deepEqual(selected,['pc1'])
  selected=nextNodeSelection(selected,'pc1',true)
  assert.deepEqual(selected,[])
})
test('ordinary click replaces group and de-duplicates IDs',()=>{
  assert.deepEqual(nextNodeSelection(['pc1','pc2'],'pc3',false),['pc3'])
  assert.deepEqual(nextNodeSelection(['pc1','pc1'],'pc2',true),['pc1','pc2'])
})
