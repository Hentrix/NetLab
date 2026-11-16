import test from 'node:test'
import assert from 'node:assert/strict'
import { layoutCables, portLabelPoint, DEVICE_WIDTH } from '../src/topology/cable-layout.ts'
const device=(id,x,y)=>({id,x,y,nicCount:8})
const wire=(id,a,b,aPort,bPort)=>({id,a,b,aPort,bPort})
test('parallel cables never swap or reverse due to crossed interface assignments',()=>{
  const nodes=[device('A',100,100),device('B',600,100)]
  const links=[wire('a','A','B',1,8),wire('b','B','A',2,7),wire('c','A','B',5,1),wire('d','B','A',4,3)]
  const layout=layoutCables(nodes,links)
  const lineY=links.map(l=>({id:l.id,left:(l.a==='A'?layout.get(l.id).source:layout.get(l.id).target).y,right:(l.b==='B'?layout.get(l.id).target:layout.get(l.id).source).y}))
  for(const a of lineY)for(const b of lineY)if(a!==b)assert.equal(Math.sign(a.left-b.left),Math.sign(a.right-b.right))
  const swapped=layoutCables(nodes,links.map(l=>({...l,aPort:9-l.aPort,bPort:9-l.bPort})))
  assert.deepEqual([...layout],[...swapped]);
  assert.ok([...layout.values()].every(g=>[0,DEVICE_WIDTH].includes(g.source.x)))
})
test('different neighbours do not share the same socket',()=>{
  const nodes=[device('r',0,110),device('pc1',400,30),device('pc2',430,130),device('pc3',400,220)]
  const links=['pc1','pc2','pc3'].map((n,i)=>wire(`l${i}`,'r',n,i,0))
  const layout=layoutCables(nodes,links)
  assert.equal(new Set([...layout.values()].map(g=>`${g.source.x}:${g.source.y}`)).size,3)
})
test('labels are always centered on straight cable even diagonal',()=>{
  const a={x:13,y:11},b={x:315,y:189}
  for(const [from,to] of [[a,b],[b,a]]){
    const p=portLabelPoint(from,to)
    assert.ok(Math.abs((p.x-a.x)*(b.y-a.y)-(p.y-a.y)*(b.x-a.x))<1e-7)
  }
})
test('link removal rebuilds sockets without stale IDs',()=>{
  const nodes=[device('a',0,0),device('b',360,0)]
  const links=[wire('1','a','b',0,0),wire('2','a','b',1,1)]
  assert.equal(layoutCables(nodes,links).size,2)
  assert.equal(layoutCables(nodes,links.slice(1)).size,1)
})
