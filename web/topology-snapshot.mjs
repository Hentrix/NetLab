// A self-contained, dependency-free topology PNG renderer.
// It renders the entire model, not the panned/clipped viewport. This means
// users get all cables, port labels, appliance images and annotations even if
// some of them are currently outside the browser's visible canvas.
const PADDING=85;

export function topologyBounds(lab, padding=PADDING){
  const rects=[];
  for(const n of lab?.nodes||[]){
    // Name labels are wider than the underlying 98px device element.
    rects.push({left:n.x-34,top:n.y-12,right:n.x+133,bottom:n.y+112});
  }
  for(const a of lab?.annotations||[]){
    rects.push({left:a.x,top:a.y,right:a.x+(a.width||180),bottom:a.y+(a.height||75)});
  }
  if(!rects.length)return {minX:0,minY:0,width:900,height:550};
  const left=Math.min(...rects.map(r=>r.left))-padding;
  const top=Math.min(...rects.map(r=>r.top))-padding;
  const right=Math.max(...rects.map(r=>r.right))+padding;
  const bottom=Math.max(...rects.map(r=>r.bottom))+padding;
  return {minX:Math.floor(left),minY:Math.floor(top),width:Math.max(440,Math.ceil(right-left)),height:Math.max(260,Math.ceil(bottom-top))};
}

export function topologyFilename(name, when=new Date()){
  const label=String(name||'lab').normalize('NFKC').replace(/[\\/:*?"<>|\x00-\x1f]/g,'').trim().replace(/\s+/g,'_').slice(0,72)||'lab';
  const y=when.getFullYear(),m=String(when.getMonth()+1).padStart(2,'0'),d=String(when.getDate()).padStart(2,'0');
  return `NetLab_${label}_${y}-${m}-${d}.png`;
}

function roundedRect(ctx,x,y,w,h,r){
  r=Math.min(r,w/2,h/2);
  ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();
}
function loadImage(src){return new Promise(resolve=>{
  const image=new Image();
  image.onload=()=>resolve(image);image.onerror=()=>resolve(null);
  image.src=src;
});}
function drawBackground(ctx,box){
  ctx.fillStyle='#ffffff';ctx.fillRect(box.minX,box.minY,box.width,box.height);
  ctx.fillStyle='#d4dfe9';
  const endX=box.minX+box.width,endY=box.minY+box.height;
  for(let y=Math.ceil(box.minY/20)*20;y<=endY;y+=20)
    for(let x=Math.ceil(box.minX/20)*20;x<=endX;x+=20){ctx.beginPath();ctx.arc(x,y,.7,0,Math.PI*2);ctx.fill();}
}
function drawPortLabel(ctx,point,toward,name){
  const dx=toward.x-point.x,dy=toward.y-point.y,len=Math.hypot(dx,dy)||1;
  const vertical=Math.abs(dy)>Math.abs(dx);
  const x=point.x+dx/len*(vertical?22:23),y=point.y+dy/len*(vertical?23:18);
  ctx.font='600 10.5px "Segoe UI",Arial,sans-serif';
  const w=Math.max(30,ctx.measureText(name).width+12),h=17;
  roundedRect(ctx,x-w/2,y-h/2,w,h,4);
  ctx.fillStyle='rgba(255,255,255,.97)';ctx.fill();ctx.lineWidth=.85;ctx.strokeStyle='#e0e7ed';ctx.stroke();
  ctx.fillStyle='#314b63';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(name,x,y+.3);
}
function drawCables(ctx,lab,layout,labelPort){
  const nodeMap=new Map(lab.nodes.map(n=>[n.id,n]));
  for(const link of lab.links||[]){
    const a=nodeMap.get(link.a),b=nodeMap.get(link.b),geo=layout.get(link.id);
    if(!a||!b||!geo)continue;
    const {A,B}=geo;
    const colors={up:'#627f9d',waiting:'#cb8730',down:'#8194a5',error:'#bd4f4f'};
    const color=colors[link.status]||colors.down;
    ctx.save();ctx.strokeStyle=color;ctx.lineWidth=2;ctx.lineCap='round';
    ctx.setLineDash(link.status==='waiting'?[8,5]:link.status==='up'?[]:[5,4]);
    ctx.beginPath();ctx.moveTo(A.x,A.y);ctx.lineTo(B.x,B.y);ctx.stroke();ctx.setLineDash([]);
    for(const p of [A,B]){ctx.beginPath();ctx.arc(p.x,p.y,3,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();ctx.lineWidth=1.8;ctx.strokeStyle='#95a9b8';ctx.stroke();}
    drawPortLabel(ctx,A,B,String(labelPort(a,link.aPort)));
    drawPortLabel(ctx,B,A,String(labelPort(b,link.bPort)));
    ctx.restore();
  }
}
function fitLine(ctx,value,maxWidth){
  if(ctx.measureText(value).width<=maxWidth)return value;
  const chars=[...value];
  while(chars.length&&ctx.measureText(chars.join('')+'…').width>maxWidth)chars.pop();
  return chars.join('')+'…';
}
function drawDevice(ctx,n,image){
  const center=n.x+49;
  if(image){
    const factor=Math.min(84/image.naturalWidth,69/image.naturalHeight,1.5);
    const w=image.naturalWidth*factor,h=image.naturalHeight*factor;
    ctx.drawImage(image,center-w/2,n.y+40-h/2,w,h);
  }else{
    roundedRect(ctx,center-27,n.y+10,54,54,11);ctx.fillStyle='#dae8f7';ctx.fill();
    ctx.strokeStyle='#6894bf';ctx.lineWidth=1;ctx.stroke();
    ctx.font='700 20px "Segoe UI",Arial,sans-serif';ctx.fillStyle='#32638e';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText((n.kind||'V').slice(0,2).toUpperCase(),center,n.y+37);
  }
  ctx.save();
  ctx.font='600 13px "Segoe UI",Arial,sans-serif';
  const caption=fitLine(ctx,String(n.name||'Устройство'),138);
  const tw=ctx.measureText(caption).width;
  ctx.fillStyle='rgba(255,255,255,.96)';roundedRect(ctx,center-tw/2-5,n.y+75,tw+10,23,3);ctx.fill();
  ctx.fillStyle='#263747';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(caption,center,n.y+86);
  ctx.beginPath();ctx.arc(center-tw/2-12,n.y+86,3.5,0,Math.PI*2);
  ctx.fillStyle=n.status==='running'?'#1b9b64':n.status==='error'?'#c66055':'#a9b3bc';ctx.fill();
  ctx.restore();
}
function wrapParagraph(ctx,paragraph,width){
  const lines=[];let line='';
  for(const word of (paragraph.match(/\S+|\s+/gu)||[])){
    const candidate=line+word;
    if(ctx.measureText(candidate).width<=width){line=candidate;continue;}
    if(line.trim()) {lines.push(line.trimEnd());line='';}
    if(ctx.measureText(word).width<=width){line=word.trimStart();continue;}
    for(const character of Array.from(word)){
      if(line&&ctx.measureText(line+character).width>width){lines.push(line);line='';}
      line+=character;
    }
  }
  lines.push(line.trimEnd());return lines;
}
function wrapText(ctx,text,maxWidth){return String(text||'').split(/\r?\n/).flatMap(p=>wrapParagraph(ctx,p,Math.max(10,maxWidth)));}
function drawAnnotation(ctx,n,defaults){
  const style=defaults(n),w=n.width||180,h=n.height||80,pad=n.kind==='note'?12:7;
  ctx.save();
  if(style.background&&style.background!=='transparent'){ctx.fillStyle=style.background;ctx.fillRect(n.x,n.y,w,h);}
  if(style.borderWidth){ctx.strokeStyle=style.borderColor;ctx.lineWidth=style.borderWidth;ctx.strokeRect(n.x+style.borderWidth/2,n.y+style.borderWidth/2,w-style.borderWidth,h-style.borderWidth);}
  const availableW=Math.max(10,w-pad*2),availableH=Math.max(10,h-pad*2);
  const text=n.text||(n.kind==='note'?'Примечание':'Текст');
  let fontSize=style.fontSize||13,lines=[];
  const makeFont=size=>`${style.italic?'italic ':''}${style.bold?'700':'400'} ${size}px "Segoe UI",Arial,sans-serif`;
  while(fontSize>=11){ctx.font=makeFont(fontSize);lines=wrapText(ctx,text,availableW);if(lines.length*fontSize*1.4<=availableH+1)break;fontSize--;}
  ctx.font=makeFont(fontSize);lines=wrapText(ctx,text,availableW);
  ctx.beginPath();ctx.rect(n.x+pad,n.y+pad,availableW,availableH);ctx.clip();
  ctx.fillStyle=style.color;ctx.textAlign=style.align==='center'?'center':style.align==='right'?'right':'left';
  ctx.textBaseline='top';
  const x=style.align==='center'?n.x+w/2:style.align==='right'?n.x+w-pad:n.x+pad;
  const lineHeight=fontSize*1.4;
  for(let i=0;i<lines.length;i++){
    const y=n.y+pad+i*lineHeight;
    if(y+fontSize>n.y+h-pad)break;
    ctx.fillText(lines[i],x,y);
    if(style.underline){const ww=ctx.measureText(lines[i]).width;const start=style.align==='center'?x-ww/2:style.align==='right'?x-ww:x;ctx.beginPath();ctx.moveTo(start,y+fontSize+1);ctx.lineTo(start+ww,y+fontSize+1);ctx.lineWidth=1;ctx.strokeStyle=style.color;ctx.stroke();}
  }
  ctx.restore();
}

export async function renderTopologyPNG(lab,{iconFor,iconURL,labelPort,layoutParallelCables,annotationDefaults}){
  if(!lab)throw new Error('Нет активной лаборатории');
  const box=topologyBounds(lab);
  // Stay within practical browser canvas limits; keep the drawing resolution
  // high on normal networks, but do not exhaust memory on huge laboratories.
  const ratio=Math.max(.4,Math.min(2,8192/box.width,8192/box.height,Math.sqrt(22e6/(box.width*box.height))));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.floor(box.width*ratio));
  canvas.height=Math.max(1,Math.floor(box.height*ratio));
  const ctx=canvas.getContext('2d',{alpha:false});
  if(!ctx)throw new Error('Canvas 2D недоступен в браузере');
  ctx.setTransform(ratio,0,0,ratio,-box.minX*ratio,-box.minY*ratio);
  drawBackground(ctx,box);
  drawCables(ctx,lab,layoutParallelCables(lab),labelPort);
  const icons=await Promise.all((lab.nodes||[]).map(n=>loadImage(iconURL(iconFor(n)))));
  for(let i=0;i<(lab.nodes||[]).length;i++)drawDevice(ctx,lab.nodes[i],icons[i]);
  for(const note of lab.annotations||[])drawAnnotation(ctx,note,annotationDefaults);
  return canvas;
}

export async function downloadTopologyPNG(lab,dependencies){
  const canvas=await renderTopologyPNG(lab,dependencies);
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Браузер не смог создать PNG')),'image/png'));
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=topologyFilename(lab.name);
  document.body.append(link);
  try{link.click();}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  return {name:link.download,size:blob.size,width:canvas.width,height:canvas.height};
}
