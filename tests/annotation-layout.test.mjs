import test from 'node:test';
import assert from 'node:assert/strict';
import {annotationLimits,resizeAnnotationRect,MIN_FITTED_FONT_PX} from '../web/annotation-layout.mjs';
const note={kind:'note',x:100,y:100,width:240,height:160};
test('Notes cannot shrink below legible dimensions',()=>{
 const b=annotationLimits('note');
 assert.deepEqual([b.minWidth,b.minHeight,MIN_FITTED_FONT_PX],[144,58,11]);
 assert.deepEqual(resizeAnnotationRect(note,'se',-200,-200,70),{x:100,y:100,width:144,height:70});
});
test('Dragging NW keeps the opposite corner anchored',()=>{
 const r=resizeAnnotationRect(note,'nw',999,999,90);
 assert.deepEqual(r,{x:196,y:170,width:144,height:90});
 assert.equal(r.x+r.width,340);assert.equal(r.y+r.height,260);
});
test('Drag from north respects height dictated by wrapped text',()=>{
 const r=resizeAnnotationRect(note,'n',0,200,116);
 assert.equal(r.height,116);assert.equal(r.y,144);
});
test('Text objects and notes have different minimum sizes',()=>{
 assert.deepEqual(annotationLimits('text').minWidth,96);
 const r=resizeAnnotationRect({kind:'text',x:10,y:10,width:160,height:60},'s',0,-100);
 assert.equal(r.height,36);
});

test('Notes may move and resize above the old y=0 boundary',()=>{
 const original={kind:'note',x:5,y:5,width:230,height:140};
 assert.deepEqual(resizeAnnotationRect(original,'',-20,-110),{x:-15,y:-105,width:230,height:140});
 const top=resizeAnnotationRect(original,'n',0,-110);
 assert.equal(top.y,-105);assert.equal(top.height,250);
});
