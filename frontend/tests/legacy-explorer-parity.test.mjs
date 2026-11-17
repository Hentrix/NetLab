import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
const read=path=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),'utf8')
const app=read('../src/App.vue')
const topology=read('../src/components/TopologyCanvas.vue')
test('legacy device explorer categories are separate and search is preserved',()=>{
  for(const id of ['router','switch','firewall','endpoints'])assert.ok(app.includes("id:'"+id+"'"),id)
  assert.match(app,/@click="selectSidebarNode\(node,\$event\)"/)
  assert.match(app,/topology\.value\?\.centerDevice\(device\.id\)/)
  assert.match(topology,/defineExpose\(\{centerDevice\}\)/)
  assert.match(topology,/setCenter\(node\.x\+56,node\.y\+50,/)
})
test('right click in explorer uses same device and bulk actions as legacy',()=>{
  assert.match(app,/@contextmenu="openSidebarMenu\(\$event,node\)"/)
  assert.match(app,/role="menu"\s*\n\s*:aria-label/)
  assert.match(app,/sidebarMenuBulk\(/)
  for(const action of ['console','start','stop','rename','ports','icon','hardware','log','delete'])
    assert.ok(app.includes("sidebarMenuAction('"+action+"')"),action)
})
test('inspector shows device details, image, resources and readable cable ports',()=>{
  assert.match(app,/class="inspector-device-hero"/)
  assert.match(app,/store\.selectedNode\.error/)
  assert.match(app,/store\.selectedNode\.nicModel/)
  assert.match(app,/store\.selectedNode\.diskBus/)
  assert.match(app,/portLabel\(store\.activeLab\?\.nodes\.find\(n=>n\.id===cable\.a\),cable\.aPort\)/)
})
