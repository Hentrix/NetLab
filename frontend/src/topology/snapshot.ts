import type { Lab, Device, Annotation } from '../types'
import { layoutCables, portLabelPoint, DEVICE_WIDTH, DEVICE_HEIGHT } from './cable-layout'
import { portLabel } from '../api/client'

/** Canvas export uses the exact same cable anchors as the Vue Flow editor. */
export async function exportTopology(lab: Lab, dark = false): Promise<void> {
  const margin=90
  const nodes=lab.nodes||[]
  const annotations=lab.annotations||[]
  if(!nodes.length&&!annotations.length) throw Error('На топологии нет устройств или аннотаций')
  const xmin=Math.min(...nodes.map(n=>n.x),...annotations.map(a=>a.x))
  const ymin=Math.min(...nodes.map(n=>n.y),...annotations.map(a=>a.y))
  const xmax=Math.max(...nodes.map(n=>n.x+DEVICE_WIDTH),...annotations.map(a=>a.x+a.width))
  const ymax=Math.max(...nodes.map(n=>n.y+DEVICE_HEIGHT),...annotations.map(a=>a.y+a.height))
  const width=Math.ceil(xmax-xmin+margin*2),height=Math.ceil(ymax-ymin+margin*2)
  const scale=2
  const canvas=document.createElement('canvas');canvas.width=width*scale;canvas.height=height*scale
  const ctx=canvas.getContext('2d')!;if(!ctx)throw Error('Браузер не поддерживает Canvas')
  ctx.scale(scale,scale);ctx.translate(margin-xmin,margin-ymin)
  ctx.fillStyle=dark?'#171f29':'#ffffff';ctx.fillRect(xmin-margin,ymin-margin,width,height)
  ctx.fillStyle=dark?'#3b4858':'#d3dce1'
  for(let x=Math.floor((xmin-margin)/20)*20;x<xmax+margin;x+=20)
    for(let y=Math.floor((ymin-margin)/20)*20;y<ymax+margin;y+=20){ctx.beginPath();ctx.arc(x,y,.7,0,Math.PI*2);ctx.fill()}
  const map=new Map(nodes.map(n=>[n.id,n]))
  const layout=layoutCables(nodes,lab.links||[])
  function badge(text:string,x:number,y:number){
    ctx.font='600 11px Segoe UI,Arial,sans-serif'
    const width=Math.max(46,ctx.measureText(text).width+16)
    ctx.fillStyle=dark?'#263748':'#ffffff';ctx.strokeStyle=dark?'#6592b4':'#aac6e5';ctx.lineWidth=1
    ctx.beginPath();ctx.roundRect(x-width/2,y-10,width,20,5);ctx.fill();ctx.stroke()
    ctx.fillStyle=dark?'#ebf5fd':'#294966';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,x,y+1)
  }
  for(const link of lab.links||[]){
    const a=map.get(link.a),b=map.get(link.b),ends=layout.get(link.id)
    if(!a||!b||!ends)continue
    const A={x:a.x+ends.source.x,y:a.y+ends.source.y},B={x:b.x+ends.target.x,y:b.y+ends.target.y}
    ctx.strokeStyle=link.color|| (dark?'#80b3dc':'#5c91be');ctx.lineWidth=link.lineWidth||2
    ctx.setLineDash(link.lineStyle==='dashed'?[8,5]:link.lineStyle==='dotted'?[2,5]:[])
    ctx.beginPath();ctx.moveTo(A.x,A.y);ctx.lineTo(B.x,B.y);ctx.stroke();ctx.setLineDash([])
    const P=portLabelPoint(A,B),Q=portLabelPoint(B,A)
    badge(portLabel(a,link.aPort),P.x,P.y);badge(portLabel(b,link.bPort),Q.x,Q.y)
  }
  const load=async(n:Device)=>{
    if(!n.icon)return null
    const img=new Image();img.src=`/icons/${encodeURIComponent(n.icon)}`
    try{await img.decode();return img}catch{return null}
  }
  const images=await Promise.all(nodes.map(load))
  for(let i=0;i<nodes.length;i++){
    const n=nodes[i];const icon=images[i]
    if(icon){const f=Math.min(62/icon.width,67/icon.height,1.8);const w=icon.width*f,h=icon.height*f;ctx.drawImage(icon,n.x+(DEVICE_WIDTH-w)/2,n.y+(75-h)/2,w,h)}
    else{ctx.fillStyle=dark?'#5294bd':'#4e89b0';ctx.fillRect(n.x+33,n.y+13,46,49)}
    ctx.fillStyle=n.status==='running'?'#43b789':'#a1afbd';ctx.beginPath();ctx.arc(n.x+12,n.y+87,3,0,Math.PI*2);ctx.fill()
    ctx.font='600 11px Segoe UI,Arial,sans-serif';ctx.fillStyle=dark?'#e4edf5':'#243746';ctx.textAlign='center';ctx.fillText(n.name,n.x+DEVICE_WIDTH/2,n.y+90)
  }
  for(const annotation of annotations) drawAnnotation(ctx,annotation)
  const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/png'))
  if(!blob)throw Error('Не удалось сохранить PNG')
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`netlab-${lab.name.replace(/[^a-zA-Z0-9_-]/g,'_')}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500)
}

/** Match the annotation's world coordinates, size and basic styles in PNG export. */
function drawAnnotation(ctx:CanvasRenderingContext2D,a:Annotation){
  ctx.save()
  const background=a.background||(a.kind==='note'?'#fff4c4':'transparent')
  if(background!=='transparent'){ctx.fillStyle=background;ctx.fillRect(a.x,a.y,a.width,a.height)}
  const borderWidth=a.borderWidth??(a.kind==='note'?1:0)
  if(borderWidth>0){ctx.strokeStyle=a.borderColor||'#d2b869';ctx.lineWidth=borderWidth;ctx.strokeRect(a.x,a.y,a.width,a.height)}
  const fontSize=a.fontSize||14
  ctx.font=`${a.italic?'italic ':''}${a.bold?'700 ':''}${fontSize}px Segoe UI,Arial,sans-serif`
  ctx.fillStyle=a.color||'#253746'
  ctx.textBaseline='top'
  ctx.textAlign=a.align||'left'
  const padding=10
  const maxWidth=Math.max(1,a.width-padding*2)
  const x=a.align==='right'?a.x+a.width-padding:a.align==='center'?a.x+a.width/2:a.x+padding
  const lineHeight=fontSize*1.35
  const maxLines=Math.max(1,Math.floor((a.height-padding*2)/lineHeight))
  const lines:string[]=[]
  for(const paragraph of (a.text||'').split('\n')){
    let line=''
    for(const word of paragraph.split(/\s+/).filter(Boolean)){
      const proposal=line?`${line} ${word}`:word
      if(line&&ctx.measureText(proposal).width>maxWidth){lines.push(line);line=word}else line=proposal
    }
    lines.push(line)
  }
  for(let i=0;i<Math.min(maxLines,lines.length);i++){
    const text=lines[i]
    ctx.fillText(text,x,a.y+padding+i*lineHeight,maxWidth)
    if(a.underline){
      const w=Math.min(maxWidth,ctx.measureText(text).width)
      const offset=a.align==='right'?-w:a.align==='center'?-w/2:0
      ctx.fillRect(x+offset,a.y+padding+(i+1)*lineHeight-3,w,1)
    }
  }
  ctx.restore()
}
