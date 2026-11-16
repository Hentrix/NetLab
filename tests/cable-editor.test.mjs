import test from 'node:test';
import assert from 'node:assert/strict';
import {selectedCablePort} from '../web/cable-editor.mjs';

test('opening edit dialog preserves originally selected port',()=>{
 assert.equal(selectedCablePort([0,1,2,3], '', 3), '3');
 assert.equal(selectedCablePort([0,1,2,3], undefined, 2), '2');
});
test('deliberately changed port remains selected while changing devices',()=>{
 assert.equal(selectedCablePort([0,1,2,3], '1', 3), '1');
});
test('unavailable port falls back to first available port',()=>{
 assert.equal(selectedCablePort([4,5], '1', 2), '4');
 assert.equal(selectedCablePort([], '', 3), '');
});
