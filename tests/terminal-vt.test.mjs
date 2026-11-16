import test from 'node:test';
import assert from 'node:assert/strict';
import {VTBuffer,escapeTerminalHTML} from '../web/terminal-vt.mjs';
test('carriage return overwrites existing device prompt',()=>{const t=new VTBuffer();t.write('router> abc\rrouter> xyz');assert.equal(t.toText(),'router> xyz');});
test('ANSI escape does not show in terminal, styles escape HTML',()=>{const t=new VTBuffer();t.write('\x1b[32m<cisco>&\x1b[0m');assert.ok(t.toHTML().includes('color:#74c991'));assert.ok(t.toHTML().includes('&lt;cisco&gt;&amp;'));assert.ok(!t.toHTML().includes('<cisco>'));});
test('backspace and erase line',()=>{const t=new VTBuffer();t.write('abcdef\x1b[3D\x1b[Kxyz');assert.equal(t.toText(),'abcxyz');});
test('ANSI CSI sequence can straddle chunks',()=>{const t=new VTBuffer();t.write('\x1b[3');t.write('1mOK');assert.ok(t.toHTML().includes('color:#dc6b6b'));});
test('old history drops while retaining latest output',()=>{const t=new VTBuffer({maxLines:5});t.write('0\n1\n2\n3\n4\n5\n6');assert.ok(!t.toText().includes('0'));assert.ok(t.toText().includes('6'));});
test('HTML escape is safe',()=>assert.equal(escapeTerminalHTML('<img onerror="x">'),'&lt;img onerror=&quot;x&quot;&gt;'));
