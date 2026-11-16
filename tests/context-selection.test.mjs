import test from 'node:test';
import assert from 'node:assert/strict';
import {selectionForContextMenu,shouldClearCanvasSelection} from '../web/context-selection.mjs';

test('right click on an already selected node keeps entire multi-selection',()=>{
  const before=new Set(['R1','R2','SW1']);
  const after=selectionForContextMenu(before,'R2');
  assert.deepEqual([...after],['R1','R2','SW1']);
  assert.deepEqual([...before],['R1','R2','SW1']);
});
test('right click on unselected device selects only target',()=>{
  assert.deepEqual([...selectionForContextMenu(new Set(['R1','R2']),'PC1')],['PC1']);
});
test('empty space right-click never clears selection',()=>{
  assert.equal(shouldClearCanvasSelection(2),false);
  assert.equal(shouldClearCanvasSelection(1),false);
  assert.equal(shouldClearCanvasSelection(0),true);
});
test('single selected device remains selected after right-click',()=>{
  assert.deepEqual([...selectionForContextMenu(new Set(['R1']),'R1')],['R1']);
});
