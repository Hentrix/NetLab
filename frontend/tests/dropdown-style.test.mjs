import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
const read=path=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),'utf8')
const select=read('../src/components/UiSelect.vue')
const css=read('../src/styles/app.css')
const app=read('../src/App.vue')
const canvas=read('../src/components/TopologyCanvas.vue')
const library=read('../src/components/ImageLibrary.vue')

test('all dropdown fields use unified styled listbox and never native popup',()=>{
  for(const [label,source,amount] of [['app',app,12],['topology',canvas,10],['images',library,4]]){
    assert.equal((source.match(/<UiSelect\b/g)||[]).length,amount,label)
    assert.doesNotMatch(source,/<select\b/)
    assert.match(source,/import UiSelect from/)
  }
  assert.match(select,/<Teleport to="body">/)
  assert.match(select,/role="listbox"/)
  assert.match(select,/role="option"/)
  assert.match(css,/\.ui-select-popup\{[^}]*var\(--surface\)/)
})
test('styled listbox preserves v-model number, change events and keyboard interactions',()=>{
  assert.match(select,/modelModifiers\?:\{number\?:boolean\}/)
  assert.match(select,/emit\('update:modelValue',value\)/)
  assert.match(select,/emit\('change',value\)/)
  for(const key of ['ArrowDown','ArrowUp','Escape','Enter','Home','End','Tab'])assert.ok(select.includes(key))
  assert.match(select,/document\.addEventListener\('pointerdown',externalPointer,true\)/)
  assert.match(select,/onBeforeUnmount/)
})
test('toolbar uses exact legacy tool order without bottom hint',()=>{
  const toolbar=canvas.slice(canvas.indexOf('class="canvas-tools"'),canvas.indexOf('class="canvas-scale"'))
  let last=-1
  for(const label of ['Выбор и перемещение','Перемещение полотна','Соединить устройства','Выделение рамкой','Добавить текст','Добавить примечание','Добавить устройство']){
    const index=toolbar.indexOf('aria-label="'+label+'"')
    assert.ok(index>last,label)
    last=index
  }
  assert.doesNotMatch(canvas,/class="canvas-selection-hint"/)
})
