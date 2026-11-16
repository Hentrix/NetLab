import test from 'node:test';
import assert from 'node:assert/strict';
import {createXtermSession,xtermAvailable,xtermPalette} from '../web/xterm-support.mjs';

test('xterm palettes include legible light and dark backgrounds',()=>{
  assert.equal(xtermPalette('light').background,'#ffffff');
  assert.equal(xtermPalette('dark').background,'#0b1620');
  assert.notEqual(xtermPalette('light').foreground,xtermPalette('dark').foreground);
});
test('missing vendor assets safely fall back without discarding the tab',()=>{
  assert.equal(xtermAvailable({}),false);
  assert.equal(createXtermSession({},()=>{},'light',{}),null);
});
test('xterm renders per tab, accepts raw input, resizes and rethemes without reset',()=>{
  let input,disposeCount=0,fitCount=0,opens=0,focused=0;
  class FakeTerminal {
    constructor(options){this.options=options;this.rows=24;this.writeLog='';this.disposed=false;}
    loadAddon(addon){this.addon=addon;}
    onData(handler){input=handler;return {dispose:()=>{disposeCount++;}};}
    open(node){opens++;this.node=node;}
    write(value){this.writeLog+=value;}
    focus(){focused++;}
    refresh(){}
    dispose(){this.disposed=true;}
  }
  class FakeFitAddon{fit(){fitCount++;}}
  const win={Terminal:FakeTerminal,FitAddon:{FitAddon:FakeFitAddon}};
  const node={isConnected:true,getBoundingClientRect:()=>({width:480,height:240})};
  let typed='';
  const session=createXtermSession(node,s=>{typed+=s;},'light',win);
  assert.equal(opens,1);
  assert.equal(session.terminal.options.theme.background,'#ffffff');
  session.terminal.write('RouterOS> ');
  input('\r');
  session.theme('dark');session.fit();session.focus();
  assert.equal(session.terminal.writeLog,'RouterOS> ');
  assert.equal(session.terminal.options.theme.background,'#0b1620');
  assert.equal(typed,'\r');assert.equal(fitCount,1);assert.equal(focused,1);
  session.dispose();assert.equal(disposeCount,1);assert.equal(session.terminal.disposed,true);
});
