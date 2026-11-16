import test from 'node:test';
import assert from 'node:assert/strict';
import {keySequence} from '../web/console-manager.mjs';
test('CLI keys map to real terminal control sequences',()=>{
 const key=(key,ctrlKey=false)=>({key,ctrlKey,metaKey:false,altKey:false});
 assert.equal(keySequence(key('Enter')),'\r');assert.equal(keySequence(key('Backspace')),'\x7f');assert.equal(keySequence(key('ArrowUp')),'\x1b[A');assert.equal(keySequence(key('c',true)),'\x03');assert.equal(keySequence(key('l',true)),'\x0c');assert.equal(keySequence(key('r')),'r');assert.equal(keySequence({...key('x'),altKey:true}),null);
});
