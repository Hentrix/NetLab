import test from 'node:test';
import assert from 'node:assert/strict';
import {worldCoordinates,translateSelection,clampCoordinate} from '../web/canvas-coordinates.mjs';

test('world coordinates allow panning above and left of origin',()=>{
  assert.deepEqual(worldCoordinates(120,75,{left:100,top:50},100,75,0.5),{x:-160,y:-100});
  assert.deepEqual(worldCoordinates(120,75,{left:100,top:50},-20,-25,0.5),{x:80,y:100});
});

test('moving one node through y=0 does not stop there',()=>{
  const positions=translateSelection(new Map([['node',{x:20,y:0}]]),0,-220);
  assert.deepEqual(positions.get('node'),{x:20,y:-220});
});

test('selected devices retain their distance while moving above origin',()=>{
  const initial=new Map([['a',{x:0,y:30}],['b',{x:130,y:210}]]);
  const next=translateSelection(initial,-175,-345);
  assert.deepEqual(next.get('a'),{x:-175,y:-315});
  assert.deepEqual(next.get('b'),{x:-45,y:-135});
  assert.equal(next.get('b').y-next.get('a').y,180);
});

test('shared delta clamps whole group together, not individual nodes',()=>{
  const initial=new Map([['a',{x:-9900,y:1}],['b',{x:-9600,y:300}]]);
  const next=translateSelection(initial,-1000,-200);
  assert.deepEqual(next.get('a'),{x:-10000,y:-199});
  assert.deepEqual(next.get('b'),{x:-9700,y:100});
  assert.equal(clampCoordinate(-999999),-10000);
});
