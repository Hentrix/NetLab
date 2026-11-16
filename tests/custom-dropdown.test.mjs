import test from 'node:test';
import assert from 'node:assert/strict';
import {filterChoices,selectedLabel} from '../web/custom-dropdown.mjs';

test('search matches case-insensitively and keeps stable options',()=>{
 const opts=[{index:0,label:'virtio-net-pci'},{index:1,label:'e1000'},{index:2,label:'RTL8139'}];
 assert.deepEqual(filterChoices(opts,'e1000'),[opts[1]]);
 assert.deepEqual(filterChoices(opts,'RTL'),[opts[2]]);
 assert.deepEqual(filterChoices(opts,''),opts);
});

test('select displayed label follows index, not assumed value',()=>{
 const opts=[{index:0,label:'Порт ether1'},{index:1,label:'Порт ether3'}];
 assert.equal(selectedLabel(opts,1),'Порт ether3');
 assert.equal(selectedLabel(opts,-1),'Выберите значение');
});
