import test from 'node:test';
import assert from 'node:assert/strict';
import {attachmentSide,layoutParallelCables,layoutPortBadges} from '../web/cable-geometry.mjs';

const node=(id,x,y)=>({id,x,y});
const link=(id,a,b,aPort=0,bPort=0)=>({id,a,b,aPort,bPort});
const box=r=>({left:r.x-r.width/2,right:r.x+r.width/2,top:r.y-r.height/2,bottom:r.y+r.height/2});
const overlap=(a,b)=>Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));

test('Several distinct neighbours never share attachment on the same face',()=>{
 const lab={nodes:[node('sw',200,200),node('pc1',540,90),node('pc2',540,210),node('pc3',540,320)],links:[link('a','sw','pc1'),link('b','sw','pc2',1),link('c','sw','pc3',2)]};
 const geometry=layoutParallelCables(lab);
 const starts=[...geometry.values()].map(e=>e.A);
 assert.equal(new Set(starts.map(p=>`${p.x},${p.y}`)).size,3);
 assert.ok(starts.every(p=>p.x===299));
 assert.ok(starts[0].y<starts[1].y&&starts[1].y<starts[2].y);
});

test('Six parallel links split slots even if endpoint order is reversed',()=>{
 const lab={nodes:[node('a',100,100),node('b',500,120)],links:Array.from({length:6},(_,i)=>link('L'+i,i%2?'b':'a',i%2?'a':'b',i,i))};
 const positions=layoutParallelCables(lab);
 const a=[...lab.links].map(l=>(l.a==='a'?positions.get(l.id).A:positions.get(l.id).B).y);
 assert.equal(new Set(a).size,6);
 assert.ok(Math.max(...a)-Math.min(...a)>50);
});

test('Bottom links anchor below device caption; top links above it',()=>{
 const lab={nodes:[node('a',100,100),node('b',100,430)],links:[link('ab','a','b')]};
 const p=layoutParallelCables(lab).get('ab');
 assert.equal(attachmentSide(lab.nodes[0],lab.nodes[1]),'bottom');
 assert.equal(p.A.y,100+37+68);
 assert.equal(p.B.y,430+37-36);
});

test('Port badges separate on a normal three-cable bundle',()=>{
 const lab={nodes:[node('a',30,100),node('b',470,100)],links:[0,1,2].map(i=>link('L'+i,'a','b',i,i))};
 const badges=layoutPortBadges(lab,layoutParallelCables(lab),(node,port)=>`Gi0/${port}`);
 const all=[...badges.values()].flatMap(v=>[v.a,v.b]);
 for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++)assert.equal(overlap(box(all[i]),box(all[j])),0,`Badge collision ${i} ${j}`);
});

test('Geometry and badge placement do not depend on input cable order',()=>{
 const links=[link('first','a','b',0,1),link('second','a','c',1,0),link('third','a','b',2,3)];
 const nodes=[node('a',50,50),node('b',380,60),node('c',380,260)];
 const render=ls=>{
  const lab={nodes,links:ls};
  const points=layoutParallelCables(lab),labels=layoutPortBadges(lab,points,(_n,p)=>`e0/${p}`);
  return {points:Object.fromEntries([...points].sort(([a],[b])=>a.localeCompare(b))),labels:Object.fromEntries([...labels].sort(([a],[b])=>a.localeCompare(b)))};
 };
 assert.deepEqual(render(links),render([...links].reverse()));
});


test('Parallel links remain ordered when local port numbers are reversed',()=>{
 const lab={nodes:[node('left',40,60),node('right',470,60)],links:[
  link('z-link','left','right',0,7),
  link('a-link','right','left',2,5),
  link('m-link','left','right',9,0)
 ]};
 const points=layoutParallelCables(lab);
 const cables=lab.links.map(l=>({id:l.id,left:(l.a==='left'?points.get(l.id).A:points.get(l.id).B).y,right:(l.b==='right'?points.get(l.id).B:points.get(l.id).A).y}));
 for(const a of cables)for(const b of cables)if(a.id!==b.id){
  assert.equal(Math.sign(a.left-b.left),Math.sign(a.right-b.right),'Parallel cable order reversed at an endpoint');
 }
 const changed={...lab,links:lab.links.map(l=>({...l,aPort:10-l.aPort,bPort:10-l.bPort}))};
 const pointsAfter=layoutParallelCables(changed);
 assert.deepEqual(Object.fromEntries(points),Object.fromEntries(pointsAfter),'Changing port numbers must not rearrange attachment points');
});
