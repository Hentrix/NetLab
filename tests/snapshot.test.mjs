import test from 'node:test';
import assert from 'node:assert/strict';
import {topologyBounds,topologyFilename} from '../web/topology-snapshot.mjs';

test('snapshot covers off-screen nodes and annotations',()=>{
  const lab={nodes:[{x:10,y:20},{x:3000,y:1300}],annotations:[{x:5000,y:100,width:280,height:180}]};
  const b=topologyBounds(lab);
  assert.ok(b.minX<=10-34);
  assert.ok(b.minY<=20-12);
  assert.ok(b.minX+b.width>=5280);
  assert.ok(b.minY+b.height>=1430);
});
test('empty snapshot still has printable bounds',()=>{
  assert.deepEqual(topologyBounds({nodes:[],annotations:[]}),{minX:0,minY:0,width:900,height:550});
});
test('snapshot filename sanitizes reserved filesystem characters',()=>{
  const f=topologyFilename('OSPF / BGP: тест*',new Date(2026,10,16));
  assert.equal(f,'NetLab_OSPF_BGP_тест_2026-11-16.png');
  assert.doesNotMatch(f,/[\\/:*?"<>|]/);
});

test('snapshot bounds include negative world coordinates',()=>{
 const lab={nodes:[{x:-320,y:-240,name:'R1'},{x:120,y:180,name:'R2'}],annotations:[]};
 const b=topologyBounds(lab);
 assert.ok(b.minX<-320);assert.ok(b.minY<-240);
 assert.ok(b.minX+b.width>120);assert.ok(b.minY+b.height>180);
});
