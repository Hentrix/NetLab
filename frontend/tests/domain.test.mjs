import test from 'node:test'
import assert from 'node:assert/strict'
import {availablePorts, portLabel, json} from '../src/api/client.ts'

test('one physical Ethernet port cannot be reused by a new link',()=>{
 const nodes=[{id:'a',nicCount:4},{id:'b',nicCount:2}]
 const links=[{id:'x',a:'a',b:'b',aPort:1,bPort:0}]
 assert.deepEqual(availablePorts(nodes,links,'a'),[0,2,3])
 assert.deepEqual(availablePorts(nodes,links,'b'),[1])
})
test('VPCS defaults to a single Ethernet port',()=>{
 assert.deepEqual(availablePorts([{id:'a',engine:'vpcs',nicCount:1}],[],'a'),[0])
})
test('interface names follow the virtual-device family',()=>{
 assert.equal(portLabel({portStyle:'ether'},0),'ether1')
 assert.equal(portLabel({portStyle:'gi'},2),'Gi0/2')
 assert.equal(portLabel({engine:'vpcs'},0),'eth0')
})
test('JSON transport does not change the port numbers',()=>{
 const data={a:'1',b:'2',aPort:0,bPort:3}
 assert.deepEqual(JSON.parse(json(data)),data)
})
