import test from 'node:test';
import assert from 'node:assert/strict';
import {portInfo,portCapacity,speedText,automaticPortName} from '../web/network-ports.mjs';
import {layoutParallelCables} from '../web/cable-geometry.mjs';
test('Port names follow device family and nominal speed; overrides are per-port',()=>{
  const c={name:'Cisco IOSv',portStyle:'gi',nicModel:'e1000',nicCount:4,ports:[{speedMbps:100},{speedMbps:1000},{speedMbps:10000},{name:'Mgmt0',speedMbps:100}]};
  assert.deepEqual(Array.from({length:4},(_,i)=>portInfo(c,i).name),['Fa0/0','Gi0/1','Te0/2','Mgmt0']);
  assert.equal(portInfo({name:'MikroTik CHR',portStyle:'ether',nicModel:'rtl8139'},0).name,'ether1');
  assert.equal(portInfo({name:'Huawei AR1000v',portStyle:'ge',nicModel:'e1000',ports:[{speedMbps:100}]},0).name,'FE0/0/0');
  assert.equal(portCapacity({nicCount:0}),16);
  assert.equal(speedText(1000),'1 Gb/s');
});
test('Parallel cable anchors do not overlap, even when link endpoints are reversed',()=>{
  const lab={nodes:[{id:'a',x:100,y:100},{id:'b',x:550,y:150}],links:[]};
  for(let i=0;i<6;i++)lab.links.push({id:'L'+i,a:i%2?'b':'a',b:i%2?'a':'b',aPort:i,bPort:i});
  const positions=layoutParallelCables(lab);
  assert.equal(positions.size,6);
  const aAnchors=lab.links.map(l=>{const p=positions.get(l.id);return l.a==='a'?p.A.y:p.B.y;});
  const bAnchors=lab.links.map(l=>{const p=positions.get(l.id);return l.a==='b'?p.A.y:p.B.y;});
  assert.equal(new Set(aAnchors).size,6);
  assert.equal(new Set(bAnchors).size,6);
});
test('Vertical parallel cables use separate x anchors',()=>{
  const lab={nodes:[{id:'a',x:100,y:100},{id:'b',x:120,y:500}],links:[0,1,2].map(i=>({id:String(i),a:'a',b:'b',aPort:i,bPort:i}))};
  const p=layoutParallelCables(lab);
  assert.equal(new Set([...p.values()].map(x=>x.A.x)).size,3);
});
