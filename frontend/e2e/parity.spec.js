import { test, expect } from '@playwright/test'

function sampleLab() {
  return {
    id:'lab1',name:'Браузерная лаборатория',links:[],annotations:[],
    nodes:[
      {id:'pc1',name:'PC1',kind:'pc',engine:'vpcs',status:'running',x:160,y:160,nicCount:1,portStyle:'eth'},
      {id:'pc2',name:'PC2',kind:'pc',engine:'vpcs',status:'running',x:390,y:160,nicCount:1,portStyle:'eth'}
    ]
  }
}
async function mockNetLab(page) {
  const lab=sampleLab()
  const inputs=[]
  const added=[]
  await page.addInitScript(()=>sessionStorage.setItem('netlabToken','test-local-token'))
  await page.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname
    let body=null
    const method=request.method()
    if(method==='POST'&&path.endsWith('/console')){
      const data=request.postDataJSON()
      inputs.push({path,text:data?.text})
      body={}
    }else if(method==='GET'&&path.endsWith('/console/stream')){
      const text='Welcome to Virtual PC Simulator\r\nVPCS> '
      const chunk=Buffer.from(text,'utf8').toString('base64')
      return route.fulfill({status:200,headers:{'Content-Type':'text/event-stream','Cache-Control':'no-store'},
        body:`event: output\ndata: ${JSON.stringify({cursor:1,chunk})}\n\n`})
    }else if(method==='POST'&&path==='/api/labs/lab1/nodes'){
      const data=request.postDataJSON()
      added.push(data)
      const node={...data,id:'created-'+added.length,status:'stopped'}
      lab.nodes.push(node);body=node
    }else if(path==='/api/labs')body=[lab]
    else if(path==='/api/labs/lab1')body=lab
    else if(path==='/api/templates')body=[
      {id:'vpcs',name:'VPCS',kind:'pc',engine:'vpcs',nicCount:1},
      {id:'generic',name:'Generic QEMU',kind:'router',engine:'qemu',
        ram:256,cpus:1,nicCount:4,nicModel:'e1000',diskBus:'ide',portStyle:'ether'}
    ]
    else if(path==='/api/images')body=[{id:'disk1',name:'router.qcow2',size:10485760,format:'qcow2'}]
    else if(path==='/api/system')body={qemu:true,qemuImg:true,ovs:true,kvm:true,vpcs:true,vmUser:true,qemuSpawn:true,vpcsSpawn:true}
    else if(path==='/api/metrics')body={cpuPercent:12,memoryTotalMiB:4096,memoryUsedMiB:1024,savedAt:new Date().toISOString()}
    else if(path.endsWith('/log'))body={output:'test log'}
    else body={}
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)})
  })
  return {lab,inputs,added}
}
async function openLab(page){
  await page.goto('/next/')
  await expect(page.locator('.device-entry')).toHaveCount(2)
  await expect(page.locator('.vue-flow__node-device')).toHaveCount(2)
}

test('QEMU creation shows and sends complete hardware and presentation settings',async({page})=>{
  const state=await mockNetLab(page)
  await openLab(page)
  await page.locator('.device-list header button').click()
  const dialog=page.locator('.device-create-dialog')
  await expect(dialog).toBeVisible()
  await dialog.locator('.profile-card').filter({hasText:'Generic QEMU'}).click()
  await expect(dialog.getByText('RAM (МиБ)')).toBeVisible()
  await expect(dialog.getByText('vCPU',{exact:true})).toBeVisible()
  await expect(dialog.getByText('Шина диска')).toBeVisible()
  await expect(dialog.getByText('Тип на схеме')).toBeVisible()
  await expect(dialog.getByText('Обозначение интерфейсов')).toBeVisible()
  await dialog.locator('label').filter({hasText:'Название'}).locator('input').fill('CHR Browser')
  await dialog.locator('label').filter({hasText:'RAM (МиБ)'}).locator('input').fill('512')
  await dialog.locator('button.primary').click()
  await expect.poll(()=>state.added.length).toBe(1)
  expect(state.added[0]).toMatchObject({name:'CHR Browser',engine:'qemu',ram:512,cpus:1,portStyle:'ether',diskBus:'ide'})
})

test('right click on a device opens its existing context actions',async({page})=>{
  await mockNetLab(page)
  await openLab(page)
  await page.locator('.vue-flow__node-device').first().click({button:'right'})
  const menu=page.locator('.device-context-menu').filter({hasText:'PC1'})
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem',{name:/Открыть консоль/})).toBeVisible()
  await expect(menu.getByRole('menuitem',{name:/Протянуть кабель/})).toBeVisible()
})

test('switching between two VPCS console tabs preserves keyboard input focus',async({page})=>{
  const state=await mockNetLab(page)
  await openLab(page)
  await page.locator('.device-entry').filter({hasText:'PC1'}).click()
  await page.locator('.node-actions button').filter({hasText:'Консоль'}).click()
  await expect(page.locator('.term-tab')).toHaveCount(1)
  await page.keyboard.type('abc')
  await page.locator('.device-entry').filter({hasText:'PC2'}).click()
  await page.locator('.node-actions button').filter({hasText:'Консоль'}).click()
  await expect(page.locator('.term-tab')).toHaveCount(2)
  await page.keyboard.type('xyz')
  await page.locator('.term-tab').first().locator('button').first().click()
  await page.keyboard.type('123')
  await expect.poll(()=>state.inputs.filter(i=>i.path.includes('/pc1/')).map(i=>i.text).join('')).toContain('abc123')
  await expect.poll(()=>state.inputs.filter(i=>i.path.includes('/pc2/')).map(i=>i.text).join('')).toContain('xyz')
})
