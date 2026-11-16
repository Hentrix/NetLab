import test from 'node:test';
import assert from 'node:assert/strict';
import {THEME_KEY,normalizeTheme,readTheme,nextTheme,applyTheme,initThemeToggle} from '../web/theme.mjs';

test('theme defaults to light and ignores unsupported preference',()=>{
  assert.equal(normalizeTheme(undefined),'light');
  assert.equal(normalizeTheme('system'),'light');
  assert.equal(readTheme({getItem:()=>null}),'light');
  assert.equal(readTheme({getItem:()=>{throw Error('blocked')}}),'light');
});
test('dark mode is stored and restored',()=>{
  const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};
  const root={dataset:{},style:{}};
  applyTheme(root,'dark',storage);
  assert.equal(root.dataset.theme,'dark');
  assert.equal(root.style.colorScheme,'dark');
  assert.equal(data.get(THEME_KEY),'dark');
  assert.equal(readTheme(storage),'dark');
  assert.equal(nextTheme(readTheme(storage)),'light');
});
test('private storage errors do not prevent appearance changes',()=>{
  const root={dataset:{},style:{}};
  assert.equal(applyTheme(root,'dark',{setItem:()=>{throw Error('denied')}}),'dark');
  assert.equal(root.dataset.theme,'dark');
});
test('toggle updates accessible state and persists new selection',()=>{
  const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};
  const root={dataset:{theme:'light'},style:{}};
  const attributes=new Map(),label={textContent:''};let click;
  const button={setAttribute:(k,v)=>attributes.set(k,v),querySelector:()=>label,addEventListener:(ev,cb)=>{if(ev==='click')click=cb}};
  initThemeToggle(button,root,storage);
  assert.equal(attributes.get('aria-pressed'),'false');
  click();
  assert.equal(attributes.get('aria-pressed'),'true');
  assert.equal(label.textContent,'Светлая');
  assert.equal(data.get(THEME_KEY),'dark');
  click();
  assert.equal(label.textContent,'Тёмная');
  assert.equal(root.dataset.theme,'light');
});
