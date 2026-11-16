import {portInfo,portCapacity,defaultSpeed,SPEEDS,speedText} from './network-ports.mjs';
import {anchorFor,layoutParallelCables} from './cable-geometry.mjs';
import {deviceStatusLabel,deviceStatusStyle} from './device-status.mjs';
import {annotationLimits,resizeAnnotationRect,MIN_FITTED_FONT_PX} from './annotation-layout.mjs';
import {downloadTopologyPNG} from './topology-snapshot.mjs';
import {translateSelection,worldCoordinates} from './canvas-coordinates.mjs';
const $ = (q, root = document) => root.querySelector(q);
const el = (tag, cls = '', text = '') => { const item = document.createElement(tag); if (cls) item.className = cls; item.textContent = text; return item; };
const state = {token: sessionStorage.getItem('netlabToken') || '', labs: [], images: [], templates: [], selectedLab: null, selectedNode: null, view: 'labs', mode: 'select', linkFrom: null, console: null, poller: null, zoom: 1, panX: 80, panY: 50, spaceHeld: false, contextNode: null, iconCatalogue: [], iconLoaded: false, placement: null, linkPort: null, dragging: false, linkDrag: null, selectedNodes: new Set(), inspectorTab: 'overview', annotationDrag: false, collapsedGroups: new Set(), explorerQuery: '', telemetry: null};
const text = value => String(value ?? '');
const escapeHTML = value => text(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const bytes = size => size >= 1024*1024*1024 ? `${(size/(1024**3)).toFixed(2)} GiB` : `${(size/(1024**2)).toFixed(2)} MiB`;
let toastHandle;
function toast(message, error = false) { const box = $('#toast'); box.textContent = message; box.className = `toast${error ? ' error':''}`; clearTimeout(toastHandle); toastHandle = setTimeout(() => box.classList.add('hidden'), 4700); }
async function api(path, options = {}) {
  const headers = {Authorization: `Bearer ${state.token}`, ...(options.body && !(options.body instanceof FormData) ? {'Content-Type':'application/json'} : {})};
  const response = await fetch('/api/' + path, {...options, headers});
  const json = await response.json().catch(() => ({}));
  if (!response.ok) { if (response.status === 401) showLogin(); throw new Error(json.error || `HTTP ${response.status}`); }
  return json;
}
async function request(path, options = {}) { try { return await api(path, options); } catch (error) { toast(error.message, true); return null; } }
const json = body => JSON.stringify(body);
const currentLab = () => state.labs.find(x => x.id === state.selectedLab);
const currentNode = () => currentLab()?.nodes.find(x => x.id === state.selectedNode);
const nicCount = portCapacity; // existing v0.3 nodes retain their 16-port layout
const getImageName = n => state.images.find(im=>im.id===n?.imageId)?.name||'';
const getPort = (n,index)=>portInfo(n,index,getImageName(n));
const labelPort=(n,index)=>getPort(n,index).name;
const linkLabel = status => ({up:'Активно',waiting:'Ожидает второго узла',down:'Узлы остановлены',error:'Ошибка сети'})[status] || 'Неизвестно';
function updateCableTip(link,a,b){return `${a.name}: ${labelPort(a,link.aPort)} ↔ ${b.name}: ${labelPort(b,link.bPort)} · ${linkLabel(link.status)}`;}

const DEFAULT_ICONS = {router:'Router.png', switch:'Layer 2 Switch.png', firewall:'Firewall.png', server:'Server.png', pc:'Desktop.png'};
const iconURL = name => '/icons/' + encodeURIComponent(name);
const validIcon = name => state.iconCatalogue.includes(name);
function iconFor(node) {
  const kind = kindOf(node);
  if (validIcon(node.icon)) return node.icon;
  if (/linux/i.test(node.name||'')) return 'Desktop_linux.png';
  if (/windows/i.test(node.name||'')) return 'Desktop_Win.png';
  if (/forti/i.test(node.name||'')) return 'Forti_FGT.png';
  if (/nexus/i.test(node.name||'')) return 'Nexus7K.png';
  return DEFAULT_ICONS[kind] || DEFAULT_ICONS.router;
}
function iconImage(name, cls='icon-image') { const img = document.createElement('img'); img.className=cls; img.src=iconURL(name); img.alt=''; img.loading='lazy'; img.draggable=false; return img; }
async function ensureIcons() {
 if (state.iconLoaded) return;
 try {const r=await fetch('/icons.json',{cache:'no-store'});if (!r.ok) throw Error('icons.json');const list=await r.json();state.iconCatalogue=Array.isArray(list)?list:[];state.iconLoaded=true;}
 catch(e){toast('Каталог иконок недоступен: '+e.message,true);}
}
async function refresh() {
  await ensureIcons();
  const [labs,images,templates] = await Promise.all([request('labs'),request('images'),request('templates')]);
  if (!labs || !images) return;
  state.labs = labs; state.images = images; state.templates = templates || [];
  if (state.selectedLab && !labs.some(l => l.id === state.selectedLab)) state.selectedLab = labs[0]?.id || null;
  if (!state.selectedLab && labs.length) state.selectedLab = labs[0].id;
  render();
}
function render() {
  $('#labCount').textContent = state.labs.length;
  $('#imageCount').textContent = state.images.length;
  const sidebar = $('#labList'); sidebar.replaceChildren();
  for (const lab of state.labs) { const button = el('button',lab.id === state.selectedLab ? 'selected':'',`▸  ${lab.name}`);button.onclick=()=>{state.selectedLab=lab.id;state.selectedNode=null;state.selectedNodes.clear();state.linkFrom=null;switchView('labs');render();};sidebar.append(button); }
  $('#viewLabs').classList.toggle('hidden',state.view!=='labs');
  $('#viewImages').classList.toggle('hidden',state.view!=='images');
  $('#viewSystem').classList.toggle('hidden',state.view!=='system');
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active',button.dataset.view===state.view));
  const heading={labs:currentLab()?.name || 'Лаборатории',images:'Библиотека образов',system:'Система'};
  $('#pageTitle').textContent=heading[state.view];
  if (state.view==='labs') renderLab();
  if (state.view==='images') renderImages();
  if (state.view==='system') refreshSystem();
}
function switchView(view){state.view=view;render();}
function renderLab(){
  const lab=currentLab();
  $('#noLab').classList.toggle('hidden',!!lab);$('#labWorkspace').classList.toggle('hidden',!lab);
  $('#startAll').disabled = !lab || lab.nodes.length===0;
  $('#stopAll').disabled = !lab || lab.nodes.length===0;
  $('#newLab').classList.toggle('hidden',!!lab);
  $('#snapshotLab').disabled = !lab;
  $('#labMore').disabled = !lab;
  $('#labTitle').textContent = lab?.name || 'Лаборатории';
  $('#labSubtitle').textContent = lab ? 'Редактор сетевой топологии'  : 'Создайте лабораторию и добавьте виртуальные устройства';
  if (!lab) return;
  $('#labDevices').textContent=`${lab.nodes.length} устройств`;
  $('#labLinks').textContent=`${lab.links.length} соединений`;
  $('#stageEmpty').classList.toggle('hidden',lab.nodes.length!==0);
  renderExplorer(lab);renderCanvas(lab);renderAnnotations(lab);renderDetails(lab);applyView();
}
// Dedicated node navigator, synchronized with the topology rather than a duplicate device catalogue.
const explorerCategories = [
  {id:'router',name:'Маршрутизаторы'},
  {id:'switch',name:'Коммутаторы'},
  {id:'firewall',name:'Межсетевые экраны'},
  {id:'endpoints',name:'Конечные устройства'}
];
function updateExplorerSelection(){
  for(const row of $('#explorerGroups').querySelectorAll('.explorer-device')) {
    row.classList.toggle('active',row.dataset.nodeId===state.selectedNode||state.selectedNodes.has(row.dataset.nodeId));
  }
}
function focusNode(node){
  if(state.mode==='pan'||state.spaceHeld) return;
  state.selectedNode=node.id;state.selectedAnnotation=null;state.selectedNodes=new Set([node.id]);
  const viewport=$('#canvasViewport').getBoundingClientRect();
  state.panX=viewport.width/2-(node.x+49)*state.zoom;
  state.panY=viewport.height/2-(node.y+42)*state.zoom;
  applyView();renderDetails(currentLab());updateExplorerSelection();
  for(const d of $('#nodesLayer').children)d.classList.toggle('active',d.dataset.id===node.id);
  for(const d of $('#annotationsLayer').children)d.classList.remove('is-selected');
}
function renderExplorer(lab){
  $('#explorerCount').textContent=lab.nodes.length;
  const root=$('#explorerGroups');root.replaceChildren();
  const query=state.explorerQuery.trim().toLocaleLowerCase('ru');
  for(const cat of explorerCategories){
    const nodes=lab.nodes.filter(n=>(cat.id==='endpoints'?['server','pc'].includes(kindOf(n)):kindOf(n)===cat.id) && (!query||`${n.name} ${getImageName(n)}`.toLocaleLowerCase('ru').includes(query)));
    if(!nodes.length) continue;
    const section=el('section','explorer-group');
    const heading=el('button','explorer-group-head');heading.type='button';
    const collapsed=state.collapsedGroups.has(cat.id);
    const arrow=el('span','explorer-chevron',collapsed?'›':'⌄');
    heading.append(arrow,el('span','',cat.name),el('span','explorer-group-count',String(nodes.length)));
    heading.setAttribute('aria-expanded',String(!collapsed));
    heading.onclick=()=>{if(collapsed)state.collapsedGroups.delete(cat.id);else state.collapsedGroups.add(cat.id);renderExplorer(currentLab());};
    section.append(heading);
    if(!collapsed) for(const node of nodes){
      const item=el('button','explorer-device');item.type='button';item.dataset.nodeId=node.id;item.draggable=state.mode!=='pan';
      const art=el('div','explorer-device-icon');art.append(iconImage(iconFor(node)));
      const copy=el('div','explorer-device-copy');copy.append(el('strong','',node.name),el('small','',getImageName(node)||'Без образа'));
      item.append(art,copy,el('span','explorer-status '+(node.status==='running'?'is-running':node.status==='error'?'is-error':'is-stopped')));
      item.onclick=()=>focusNode(node);
      item.ondragstart=e=>{if(state.mode==='pan'){e.preventDefault();return;}e.dataTransfer.setData('application/x-netlab-node',node.id);e.dataTransfer.effectAllowed='move';};
      section.append(item);
    }
    root.append(section);
  }
  if(!root.children.length)root.append(el('p','explorer-empty',query?'Ничего не найдено':'Устройства ещё не добавлены'));
  updateExplorerSelection();
}
function kindOf(n){
  if(['router','switch','firewall','server','pc'].includes(n.kind)) return n.kind;
  const t=(n.name||'').toLowerCase();
  if(/switch|l2|sw\d/.test(t))return 'switch';
  if(/forti|palo|firewall|asa|opnsense|pfsense/.test(t))return 'firewall';
  if(/linux|windows|pc|workstation/.test(t))return 'pc';
  if(/server|generic/.test(t))return 'server';
  return 'router';
}
// Port label formats follow virtual appliance conventions. Cosmetic only:
// port indices used by the QEMU/OVS backend remain unchanged.
const PORT_STYLES = [
  ['auto','Автоматически'],['ether','MikroTik · ether1'],
  ['gi','Cisco · Gi0/0'],['e','Cisco EVE · e0/0'],
  ['fa','Cisco · Fa0/0'],['ge','Huawei · GE0/0/0'],
  ['jge','Juniper · ge-0/0/0'],['eth','Linux · eth0'],
  ['ens','Linux · ens3']
];
const portStyleOptions=selected=>PORT_STYLES.map(([value,label])=>`<option value="${value}"${selected===value?' selected':''}>${escapeHTML(label)}</option>`).join('');
function svgEl(tag, attrs, parent){const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))node.setAttribute(k,String(v));parent.append(node);return node;}
// Distinct physical attachment slots for every cable in a parallel bundle.
function drawPortBadge(parent,name,point,toward){
  const dx=toward.x-point.x,dy=toward.y-point.y,dist=Math.hypot(dx,dy)||1;
  const ux=dx/dist,uy=dy/dist,vertical=Math.abs(dy)>Math.abs(dx);
  const width=Math.max(30,name.length*6.35+12),height=17;
  // Place a badge beyond the wire endpoint; not on top of the device image.
  const x=point.x+ux*(vertical?22:23),y=point.y+uy*(vertical?23:18);
  const group=svgEl('g',{'class':'port-badge'},parent);
  svgEl('rect',{x:x-width/2,y:y-height/2,width,height,rx:4},group);
  const t=svgEl('text',{x,y:y+0.7,'text-anchor':'middle','dominant-baseline':'central',class:'wire-label'},group);
  t.textContent=name;
}
function renderWires(lab){
 const svg=$('#linkLayer');svg.replaceChildren();
 const layout=layoutParallelCables(lab);
 for(const link of lab.links){
   const a=lab.nodes.find(n=>n.id===link.a),b=lab.nodes.find(n=>n.id===link.b);
   const geo=layout.get(link.id);if(!a||!b||!geo)continue;
   const {A,B}=geo;
   const cable=svgEl('g',{'class':'cable-group cable-'+(link.status||'down'),'data-link':link.id},svg);
   svgEl('line',{x1:A.x,y1:A.y,x2:B.x,y2:B.y,class:'network-wire'},cable);
   svgEl('circle',{cx:A.x,cy:A.y,r:3,class:'wire-end'},cable);
   svgEl('circle',{cx:B.x,cy:B.y,r:3,class:'wire-end'},cable);
   drawPortBadge(cable,labelPort(a,link.aPort),A,B);
   drawPortBadge(cable,labelPort(b,link.bPort),B,A);
   svgEl('title',{},cable).textContent=updateCableTip(link,a,b);
   const hit=svgEl('line',{x1:A.x,y1:A.y,x2:B.x,y2:B.y,class:'cable-hit'},cable);
   hit.addEventListener('contextmenu',e=>{if(state.mode==='pan'||state.spaceHeld){e.preventDefault();return;}e.preventDefault();e.stopPropagation();showContext(e.clientX,e.clientY,[{label:'Изменить интерфейсы / устройство',icon:'⚙',action:()=>showCableInfo(link,a,b)},{label:'Состояние: '+linkLabel(link.status),icon:'●',disabled:true},{separator:true},{label:`Отключить ${labelPort(a,link.aPort)} ↔ ${labelPort(b,link.bPort)}`,icon:'✕',destructive:true,action:()=>removeLink(link)}]);});
   hit.addEventListener('dblclick',e=>{e.stopPropagation();showCableInfo(link,a,b);});
 }
}
// Presentation annotations have their own, validated style and geometry model.
function annotationDefaults(note){return {
  color:note.color||'#39536b', background:note.background|| (note.kind==='note'?'#f5f7dc':'transparent'),
  borderColor:note.borderColor||'#d5d6a7',borderWidth:note.borderColor?note.borderWidth:(note.kind==='note'?1:0),
  fontSize:note.fontSize|| (note.kind==='note'?13:16),bold:note.bold===true,italic:note.italic===true,
  underline:note.underline===true,align:note.align||'left'
};}
function styleAnnotation(item,note){
  const style=annotationDefaults(note);
  item.style.color=style.color;item.style.backgroundColor=style.background;
  item.style.border=style.borderWidth?`${style.borderWidth}px solid ${style.borderColor}`:'0 solid transparent';
  item.style.fontSize=`${style.fontSize}px`;item.style.fontWeight=style.bold?'700':'400';
  item.style.fontStyle=style.italic?'italic':'normal';item.style.textDecoration=style.underline?'underline':'none';item.style.textAlign=style.align;
}
// Text never disappears when an annotation is made small: first reduce only
// the rendered font (the user's chosen font size is preserved in the model).
// In extreme cases allow scrolling rather than silently clipping content.
function fitAnnotationText(item,note){
 const content=$('.annotation-content',item);
 if(!content)return;
 const base=annotationDefaults(note).fontSize;
 content.style.fontSize=base+'px';
 content.style.overflow='hidden';
 for(let size=base;size>=MIN_FITTED_FONT_PX;size--){
   content.style.fontSize=size+'px';
   if(content.scrollHeight<=content.clientHeight+1 && content.scrollWidth<=content.clientWidth+1)break;
 }
 const clipped=content.scrollHeight>content.clientHeight+1 || content.scrollWidth>content.clientWidth+1;
 content.style.overflowY=clipped?'auto':'hidden';
 content.style.overflowX='hidden';
 item.classList.toggle('annotation-scrollable',clipped);
 item.title=clipped?'Текст длиннее области — прокрутите или увеличьте размер. Двойной клик — оформление.':'Перетащить · потянуть за край для изменения размера · двойной клик — оформление';
}
// Measure how tall the content would be at a still-legible 11px font at a
// proposed width. This accounts for line wrapping, padding, and border.
function minimumAnnotationHeight(item,note,width){
 const content=$('.annotation-content',item),limits=annotationLimits(note.kind);
 const previousWidth=item.style.width,previousHeight=content.style.height;
 const previousFont=content.style.fontSize,previousOverflowX=content.style.overflowX,previousOverflowY=content.style.overflowY;
 item.style.width=width+'px';content.style.height='auto';
 content.style.fontSize=Math.min(annotationDefaults(note).fontSize,MIN_FITTED_FONT_PX)+'px';
 content.style.overflow='visible';
 const cs=getComputedStyle(item);
 const framing=['paddingTop','paddingBottom','borderTopWidth','borderBottomWidth'].reduce((total,key)=>total+(parseFloat(cs[key])||0),0);
 const required=Math.ceil(content.scrollHeight+framing+3);
 item.style.width=previousWidth;content.style.height=previousHeight;
 content.style.fontSize=previousFont;content.style.overflowX=previousOverflowX;content.style.overflowY=previousOverflowY;
 return Math.max(limits.minHeight,Math.min(limits.maxHeight,required));
}
async function commitAnnotation(lab,note,before){
 const updated=await request(`labs/${lab.id}/annotations/${note.id}`,{method:'PATCH',body:json(note)});
 if(!updated){Object.assign(note,before);renderAnnotations(lab);}else{Object.assign(note,updated);refreshTelemetry();}
}
function renderAnnotations(lab){
 const layer=$('#annotationsLayer');layer.replaceChildren();
 for(const note of lab.annotations||[]){
  const item=el('div','canvas-annotation annotation-'+note.kind+(state.selectedAnnotation===note.id?' is-selected':''));
  item.dataset.id=note.id;
  item.style.cssText=`position:absolute;left:${note.x}px;top:${note.y}px;width:${note.width}px;height:${note.height}px`;
  styleAnnotation(item,note);
  const content=el('div','annotation-content',note.text|| (note.kind==='text'?'Текст':'Примечание'));
  item.append(content);
  item.title='Перетащить · потянуть за край для изменения размера · двойной клик — оформление';
  for(const handleName of ['n','ne','e','se','s','sw','w','nw']){
    const handle=el('span','annotation-resize resize-'+handleName);handle.dataset.resize=handleName;
    handle.setAttribute('aria-hidden','true');item.append(handle);
  }
  item.addEventListener('pointerdown',e=>{
   if(e.button!==0||state.mode==='pan'||state.spaceHeld)return;
   e.preventDefault();e.stopPropagation();hideContext();
   state.selectedAnnotation=note.id;state.selectedNode=null;state.selectedNodes.clear();
   renderDetails(currentLab());updateExplorerSelection();
   for(const dom of $('#nodesLayer').children)dom.classList.remove('active');
   for(const dom of layer.children)dom.classList.toggle('is-selected',dom===item);
   const side=e.target.closest('[data-resize]')?.dataset.resize||'';
   const original={...note}, sx=e.clientX,sy=e.clientY;state.annotationDrag=true;
   item.setPointerCapture(e.pointerId);
   let changed=false;
   const move=ev=>{
      const dx=Math.round((ev.clientX-sx)/state.zoom),dy=Math.round((ev.clientY-sy)/state.zoom);
      // First derive the requested width, then measure the minimum height
      // needed to keep all lines legible (at no less than 11px).
      const tentative=resizeAnnotationRect(original,side,dx,dy);
      const minHeight=minimumAnnotationHeight(item,note,tentative.width);
      const {x,y,width:w,height:h}=resizeAnnotationRect(original,side,dx,dy,minHeight);
      Object.assign(note,{x,y,width:w,height:h});
      changed=x!==original.x||y!==original.y||w!==original.width||h!==original.height;
      Object.assign(item.style,{left:x+'px',top:y+'px',width:w+'px',height:h+'px'});
      fitAnnotationText(item,note);
   };
   const finish=async(ev,cancelled=false)=>{
      item.removeEventListener('pointermove',move);item.removeEventListener('pointerup',end);item.removeEventListener('pointercancel',cancel);
      if(item.hasPointerCapture(ev.pointerId))item.releasePointerCapture(ev.pointerId);
      state.annotationDrag=false;
      if(cancelled){Object.assign(note,original);renderAnnotations(lab);return;}
      if(changed) await commitAnnotation(lab,note,original);
   };
   const end=ev=>finish(ev,false),cancel=ev=>finish(ev,true);
   item.addEventListener('pointermove',move);item.addEventListener('pointerup',end);item.addEventListener('pointercancel',cancel);
  });
  item.addEventListener('dblclick',e=>{if(state.mode==='pan'||state.spaceHeld)return;e.stopPropagation();showAnnotationDialog(note);});
  item.addEventListener('contextmenu',e=>{if(state.mode==='pan'||state.spaceHeld){e.preventDefault();return;}e.preventDefault();e.stopPropagation();showContext(e.clientX,e.clientY,[{label:'Изменить оформление и текст',icon:'✎',action:()=>showAnnotationDialog(note)},{label:'Подогнать высоту под текст',icon:'↕',action:()=>fitAnnotationHeight(lab,note,item)},{separator:true},{label:'Удалить',icon:'✕',destructive:true,action:()=>deleteAnnotation(note)}]);});
  layer.append(item);
  fitAnnotationText(item,note);
 }
}
async function fitAnnotationHeight(lab,note,item){
  const target=minimumAnnotationHeight(item,note,note.width);
  const previous={...note};
  if(target>note.height){note.height=target;renderAnnotations(lab);await commitAnnotation(lab,note,previous);}
  else toast('Текст уже помещается в выбранную область');
}
function showAnnotationDialog(annotation){
 const lab=currentLab(),existing=!!annotation?.id;
 const note=annotation||{kind:'text',text:'',x:100,y:100,width:200,height:56};
 const style=annotationDefaults(note);
 const wrap=el('div');wrap.innerHTML=`<form><div class="modal-body annotation-editor">
   <div class="field"><label>${note.kind==='text'?'Текст':'Текст примечания'}</label><textarea name="text" maxlength="1000" rows="4" placeholder="Введите текст…">${escapeHTML(note.text||'')}</textarea></div>
   <div class="annotation-style-section"><strong>Оформление</strong><div class="annotation-color-grid">
      <label class="annotation-color-field"><span>Цвет текста</span><input aria-label="Цвет текста" type="color" name="color" value="${style.color}"/></label>
      <label class="annotation-color-field"><span>Заливка</span><input aria-label="Цвет заливки" type="color" name="background" value="${style.background==='transparent'?'#ffffff':style.background}"/></label>
      <label class="annotation-color-field"><span>Цвет рамки</span><input aria-label="Цвет рамки" type="color" name="borderColor" value="${style.borderColor}"/></label>
   </div><label class="check-row"><input type="checkbox" name="transparent" ${style.background==='transparent'?'checked':''}/> Без заливки (прозрачный фон)</label>
   <div class="annotation-type-controls">
     <label>Размер шрифта <input name="fontSize" type="number" min="9" max="72" value="${style.fontSize}"/></label>
     <label>Рамка <select name="borderWidth">${[0,1,2,3,4].map(i=>`<option value="${i}" ${style.borderWidth===i?'selected':''}>${i===0?'Нет':i+' px'}</option>`).join('')}</select></label>
     <label>Выравнивание <select name="align">${[['left','Слева'],['center','По центру'],['right','Справа']].map(([v,l])=>`<option value="${v}" ${style.align===v?'selected':''}>${l}</option>`).join('')}</select></label>
   </div><div class="annotation-switches"><label><input type="checkbox" name="bold" ${style.bold?'checked':''}/> <b>Жирный</b></label><label><input type="checkbox" name="italic" ${style.italic?'checked':''}/> <i>Курсив</i></label><label><input type="checkbox" name="underline" ${style.underline?'checked':''}/> <u>Подчёркнутый</u></label></div></div>
   <div class="form-grid"><div class="field"><label>Ширина, px</label><input type="number" name="width" min="${annotationLimits(note.kind).minWidth}" max="1200" value="${Math.max(note.width,annotationLimits(note.kind).minWidth)}" required/></div><div class="field"><label>Высота, px</label><input type="number" name="height" min="${annotationLimits(note.kind).minHeight}" max="800" value="${Math.max(note.height,annotationLimits(note.kind).minHeight)}" required/></div></div><p class="annotation-size-help">При уменьшении области текст подстраивается автоматически. Размер шрифта в настройках сохраняется.</p>
   </div><div class="modal-footer"><button type="button" class="secondary cancel">Отмена</button><button type="submit" class="primary">${existing?'Сохранить':'Добавить на схему'}</button></div></form>`;
 $('.cancel',wrap).onclick=hideModal;
 const transparent=$('input[name=transparent]',wrap),background=$('input[name=background]',wrap);function reflectTransparency(){background.disabled=transparent.checked;}
 transparent.onchange=reflectTransparency;reflectTransparency();
 showModal(existing?'Текст и оформление':'Новый объект на топологии',wrap,async data=>{
  const payload={kind:note.kind,text:String(data.get('text')||''),x:note.x,y:note.y,width:Number(data.get('width')),height:Number(data.get('height')),
   color:data.get('color'),background:data.has('transparent')?'transparent':data.get('background'),borderColor:data.get('borderColor'),borderWidth:Number(data.get('borderWidth')),
   fontSize:Number(data.get('fontSize')),bold:data.has('bold'),italic:data.has('italic'),underline:data.has('underline'),align:data.get('align')};
  const res=await request(`labs/${lab.id}/annotations${existing?'/'+note.id:''}`,{method:existing?'PATCH':'POST',body:json(payload)});
  if(res){await refresh();refreshTelemetry();return true;}return false;
 });
}
async function deleteAnnotation(note){const lab=currentLab();if(!confirm('Удалить примечание?'))return;const ok=await request(`labs/${lab.id}/annotations/${note.id}`,{method:'DELETE'});if(ok){state.selectedAnnotation=null;refresh();}}
function renderCanvas(lab){
 const canvas=$('#nodesLayer');canvas.replaceChildren();renderWires(lab);
 for(const node of lab.nodes){
   const selected=state.selectedNodes.has(node.id)||state.selectedNode===node.id;
   const dom=el('div',`node device-${kindOf(node)}${selected?' active':''}${state.linkFrom===node.id?' connect-select':''}`);
   dom.dataset.id=node.id;dom.style.left=`${node.x}px`;dom.style.top=`${node.y}px`;
   const art=el('div','device-illustration');art.append(iconImage(iconFor(node)));
   const caption=el('div','device-caption');const status=el('span','device-status'+(node.status==='running'?' running':''));
   const title=el('span','device-name',node.name);caption.append(status,title);dom.append(art,caption);
   // EVE/PNETLab-style drag handle: appears at the top-right of the device icon.
   const handle=el('button','node-connect-handle');handle.type='button';
   handle.title=`Соединить ${node.name} с другим устройством (зажать и перетащить)`;
   handle.setAttribute('aria-label',`Протянуть кабель от ${node.name}`);
   handle.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 1 0 7.07 7.07l1.71-1.71"/></svg>';
   handle.addEventListener('pointerdown',evt=>{if(evt.button===0&&!state.spaceHeld&&state.mode!=='pan'){evt.preventDefault();evt.stopPropagation();beginCableDrag(node,evt);}});
   handle.addEventListener('click',evt=>{evt.preventDefault();evt.stopPropagation();if(state.mode==='pan'||state.spaceHeld)return;if(evt.detail===0)beginClickToConnect(node);});
   handle.addEventListener('dblclick',evt=>evt.stopPropagation());
   dom.append(handle);
   dom.title=`${node.name} · ${node.status==='running'?'Запущен':'Остановлен'} · Двойной клик: консоль`;
   dom.addEventListener('pointerdown',evt=>onNodePointer(evt,dom,node));
   dom.addEventListener('dblclick',e=>{e.stopPropagation();if(state.mode==='pan'||state.spaceHeld)return;if(node.status==='running')openConsole(node);else toast('Сначала запустите устройство');});
   dom.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();if(state.mode==='pan'||state.spaceHeld)return;state.selectedNode=node.id;state.selectedNodes=new Set([node.id]);renderDetails(lab);showNodeContext(e.clientX,e.clientY,node);});
   canvas.append(dom);
 }
}
function availablePorts(lab,node,excludeID=null){
 const used=new Set();for(const l of lab.links){if(l.id===excludeID)continue;if(l.a===node.id)used.add(l.aPort);if(l.b===node.id)used.add(l.bPort);}
 return Array.from({length:nicCount(node)},(_,i)=>i).filter(i=>!used.has(i));
}
function showCableModal(lab,a,b,edit=null){
 const ap=availablePorts(lab,a,edit?.id),bp=availablePorts(lab,b,edit?.id);
 if(!ap.length||!bp.length){toast('Нет свободных интерфейсов. Измените число портов на остановленной VM.',true);return;}
 const wrap=el('div');
 const options=(node,ports)=>ports.map(p=>`<option value="${p}">${escapeHTML(labelPort(node,p))}</option>`).join('');
 wrap.innerHTML=`<form><div class="modal-body"><p class="cable-description">Обычный Ethernet-кабель L2. Можно подключать и отключать при запущенных QEMU-устройствах, без перезагрузки.</p><div class="cable-ports"><div class="field"><label>${escapeHTML(a.name)}</label><select name="aPort">${options(a,ap)}</select></div><span class="cable-symbol">⟷</span><div class="field"><label>${escapeHTML(b.name)}</label><select name="bPort">${options(b,bp)}</select></div></div><p class="muted">Свободно: ${ap.length} / ${nicCount(a)} и ${bp.length} / ${nicCount(b)}. Один порт — один кабель.</p></div><div class="modal-footer"><button type="button" class="secondary cancel">Отмена</button><button type="submit" class="primary">${edit?'Переподключить':'Соединить'}</button></div></form>`;
 if(edit){$('select[name=aPort]',wrap).value=edit.aPort;$('select[name=bPort]',wrap).value=edit.bPort;}
 if(state.linkPort!==null && ap.includes(state.linkPort))$('select[name=aPort]',wrap).value=state.linkPort;
 state.linkPort=null;
 $('.cancel',wrap).onclick=hideModal;
 showModal(edit?'Изменить кабель':'Подключить Ethernet-кабель',wrap,async data=>{
   const result=await request(`labs/${lab.id}/links${edit?'/'+edit.id:''}`,{method:edit?'PATCH':'POST',body:json({a:a.id,b:b.id,aPort:Number(data.get('aPort')),bPort:Number(data.get('bPort'))})});
   if(result){await refresh();toast('Кабель '+(edit?'переподключён':'подключён')+' · '+linkLabel(result.status));return true;}return false;
 });
}
function setCableHint(text){$('#editorHint').textContent=text;}
function nodeUnderPointer(event){
  const element=document.elementFromPoint(event.clientX,event.clientY);
  const target=element?.closest('.node');
  return currentLab()?.nodes.find(n=>n.id===target?.dataset.id)||null;
}
function beginClickToConnect(node){
  if(state.mode==='pan'||state.spaceHeld)return;
  setMode('link');state.linkFrom=node.id;
  renderLab();setCableHint(`Источник: ${node.name} · нажмите на второе устройство`);
}
function beginCableDrag(node,originEvent){
  if(state.mode==='pan'||state.spaceHeld)return;
  // Do not call renderLab here: that would destroy the button originating the pointer event.
  state.linkDrag?.cleanup?.();hideContext();
  const lab=currentLab();if(!lab)return;
  const from=node.id,labID=lab.id,initialX=originEvent.clientX,initialY=originEvent.clientY;
  state.linkFrom=from;state.mode='link';state.linkPort=null;
  for(const b of $('#canvasToolbar').querySelectorAll('.canvas-tool'))b.classList.remove('selected');
  $('#linkTool').classList.add('selected');
  const source=$(`[data-id="${from}"]`, $('#nodesLayer'));source?.classList.add('connect-select');
  $('#canvasViewport').classList.add('is-connecting');
  let preview=null,dragging=false,lastTarget=null;
  function clearTarget(){if(lastTarget){lastTarget.classList.remove('connect-target');lastTarget=null;}}
  function move(event){
    if(!currentLab()||currentLab().id!==labID){cleanup();return;}
    if(!dragging&&Math.hypot(event.clientX-initialX,event.clientY-initialY)<5)return;
    dragging=true;
    const targetPoint=worldPoint(event.clientX,event.clientY);
    const a=anchorFor(node,targetPoint),svg=$('#linkLayer');
    if(!preview)preview=svgEl('line',{class:'cable-preview'},svg);
    Object.entries({x1:a.x,y1:a.y,x2:targetPoint.x,y2:targetPoint.y}).forEach(([k,v])=>preview.setAttribute(k,String(v)));
    clearTarget();
    const target=nodeUnderPointer(event);
    if(target&&target.id!==from){lastTarget=$(`[data-id="${target.id}"]`, $('#nodesLayer'));lastTarget?.classList.add('connect-target');}
    setCableHint(target&&target.id!==from?`Отпустите на ${target.name} · затем выберите Ethernet-порты`:'Перетащите линию на второе устройство · Esc — отмена');
  }
  function cleanup(){
    document.removeEventListener('pointermove',move);
    document.removeEventListener('pointerup',done);
    document.removeEventListener('pointercancel',cancel);
    preview?.remove();clearTarget();
    source?.classList.remove('connect-select');
    $('#canvasViewport').classList.remove('is-connecting');
    state.linkDrag=null;
  }
  function cancel(){cleanup();setMode('select');}
  function done(event){
    const target=nodeUnderPointer(event),didDrag=dragging;
    cleanup();
    if(!didDrag){beginClickToConnect(node);return;}
    const fromNode=currentLab()?.nodes.find(n=>n.id===from);
    setMode('select');
    if(target&&target.id!==from&&fromNode){showCableModal(currentLab(),fromNode,target);}
    else setCableHint('Соединение отменено · наведите на значок кабеля и перетащите к другому устройству');
  }
  state.linkDrag={cleanup:cancel};
  document.addEventListener('pointermove',move);
  document.addEventListener('pointerup',done);
  document.addEventListener('pointercancel',cancel);
}
function startCablePreview(from,evt){
  const node=currentLab()?.nodes.find(n=>n.id===from);
  if(state.mode==='pan'||state.spaceHeld)return;
  if(node)beginCableDrag(node,evt);
}
function onNodePointer(evt,dom,node){
 if(evt.button!==0||state.spaceHeld||state.mode==='pan')return;
 evt.preventDefault();evt.stopPropagation();hideContext();
 if(state.mode==='link'){
   const lab=currentLab();
   if(state.linkFrom===null){beginCableDrag(node,evt);return;}
   if(state.linkFrom===node.id){state.linkFrom=null;setMode('select');return;}
   const a=lab.nodes.find(n=>n.id===state.linkFrom),chosen=state.linkPort;
   state.linkFrom=null;setMode('select');state.linkPort=chosen;if(a)showCableModal(lab,a,node);return;
 }
 if(state.mode==='text'||state.mode==='note')return;
 if(state.mode==='marquee')setMode('select');
 const additive=evt.shiftKey||evt.ctrlKey||evt.metaKey;
 if(additive){
   if(state.selectedNodes.has(node.id))state.selectedNodes.delete(node.id);else state.selectedNodes.add(node.id);
 }else if(!state.selectedNodes.has(node.id))state.selectedNodes=new Set([node.id]);
 state.selectedNode=state.selectedNodes.size===1?[...state.selectedNodes][0]:null;
 state.selectedAnnotation=null;
 renderDetails(currentLab());
 for(const child of $('#nodesLayer').children)child.classList.toggle('active',state.selectedNodes.has(child.dataset.id));
 if(additive||!state.selectedNodes.has(node.id))return;
 const lab=currentLab(),ids=[...state.selectedNodes],initial=new Map(lab.nodes.filter(n=>ids.includes(n.id)).map(n=>[n.id,{x:n.x,y:n.y}]));
 const sx=evt.clientX,sy=evt.clientY;let moved=false;state.dragging=true;dom.setPointerCapture(evt.pointerId);
 const move=e=>{const dx=(e.clientX-sx)/state.zoom,dy=(e.clientY-sy)/state.zoom;if(Math.abs(dx)>2||Math.abs(dy)>2)moved=true;
  // Apply one shared delta: multi-selected devices must keep their spacing
  // while crossing the old artificial x=0 / y=0 origin.
  const positions=translateSelection(initial,dx,dy);
  for(const [id,pos] of positions){const member=lab.nodes.find(n=>n.id===id);if(!member)continue;member.x=pos.x;member.y=pos.y;
   const element=[...$('#nodesLayer').children].find(d=>d.dataset.id===id);if(element){element.style.left=`${member.x}px`;element.style.top=`${member.y}px`;}}
  renderWires(lab);
 };
 const end=async()=>{state.dragging=false;dom.removeEventListener('pointermove',move);dom.removeEventListener('pointerup',end);dom.removeEventListener('pointercancel',end);
  if(!moved)return;
  const results=await Promise.all([...initial.keys()].map(async id=>{const item=lab.nodes.find(n=>n.id===id);return item?request(`labs/${lab.id}/nodes/${id}`,{method:'PATCH',body:json({x:item.x,y:item.y})}):null;}));
  if(results.some(r=>!r))toast('Не удалось сохранить положение некоторых устройств',true);await refresh();
 };
 dom.addEventListener('pointermove',move);dom.addEventListener('pointerup',end);dom.addEventListener('pointercancel',end);
}
// CSS transform:scale() rasterizes text as a texture at fractional zoom levels.
// Render the topology at its real CSS zoom instead and keep panning unscaled.
// Round the translation to physical display pixels to avoid subpixel text blur.
function applyView(){
 const dpr=window.devicePixelRatio||1;
 const pixel=x=>Math.round(x*dpr)/dpr;
 const position=$('#stagePosition');
 position.style.left=`${pixel(state.panX)}px`;
 position.style.top=`${pixel(state.panY)}px`;
 const stage=$('#stage');
 stage.style.zoom=String(state.zoom);
 stage.style.transform='none';
 $('#zoomValue').textContent=`${Math.round(state.zoom*100)}%`;
}
function worldPoint(clientX,clientY){const r=$('#canvasViewport').getBoundingClientRect();return worldCoordinates(clientX,clientY,r,state.panX,state.panY,state.zoom);}
function setZoom(next,clientX,clientY){
 const viewport=$('#canvasViewport'),r=viewport.getBoundingClientRect();const px=(clientX??(r.left+r.width/2))-r.left,py=(clientY??(r.top+r.height/2))-r.top;
 const beforeX=(px-state.panX)/state.zoom,beforeY=(py-state.panY)/state.zoom;
 state.zoom=Math.max(.25,Math.min(2.5,Math.round(next*100)/100));state.panX=px-beforeX*state.zoom;state.panY=py-beforeY*state.zoom;applyView();
}
function fitTopology(){const lab=currentLab();const rect=$('#canvasViewport').getBoundingClientRect();if(!lab?.nodes.length){state.zoom=1;state.panX=80;state.panY=60;applyView();return;}
 const xs=lab.nodes.map(n=>n.x),ys=lab.nodes.map(n=>n.y),minX=Math.min(...xs),minY=Math.min(...ys),maxX=Math.max(...xs)+98,maxY=Math.max(...ys)+104;
 const zoom=Math.min(1.3,Math.max(.3,Math.min((rect.width-150)/(maxX-minX||1),(rect.height-150)/(maxY-minY||1))));
 state.zoom=zoom;state.panX=(rect.width-(maxX-minX)*zoom)/2-minX*zoom;state.panY=(rect.height-(maxY-minY)*zoom)/2-minY*zoom;applyView();
}
function renderDetails(lab){
  const node=currentNode(),empty=$('#inspectorEmpty'),body=$('#inspectorContent');
  empty.classList.toggle('hidden',!!node);body.classList.toggle('hidden',!node);
  updateExplorerSelection();
  if(!node)return;
  $('#inspectorDeviceName').textContent='СВОЙСТВА УСТРОЙСТВА';
  for(const [tab,pane] of [['overview','#overviewPane'],['interfaces','#interfacesPane']]){
    $(`#${tab}Tab`).classList.toggle('active',state.inspectorTab===tab);
    $(`#${tab}Tab`).setAttribute('aria-selected',String(state.inspectorTab===tab));
    $(pane).classList.toggle('hidden',state.inspectorTab!==tab);
  }
  const overview=$('#overviewPane');overview.replaceChildren();
  const img=state.images.find(x=>x.id===node.imageId);
  const hero=el('div','node-overview-hero');hero.append(iconImage(iconFor(node),'detail-icon'));
  const heroInfo=el('div','node-hero-copy');
  heroInfo.append(el('strong','',node.name),el('span','node-hero-status '+deviceStatusStyle(node),deviceStatusLabel(node)));
  hero.append(heroInfo);overview.append(hero);
  function section(title,rows){
    overview.append(el('h3','inspector-section-title',title));
    const table=el('div','property-table');
    for(const [key,value] of rows){const row=el('div','property-row');row.append(el('span','',key),el('strong','',String(value)));table.append(row);}
    overview.append(table);
  }
  const types={router:'Маршрутизатор',switch:'Коммутатор',firewall:'Межсетевой экран',server:'Сервер',pc:'Компьютер'};
  section('Конфигурация', [['Образ',img?.name||'—'],['Тип',types[kindOf(node)]],['Имя узла',node.name],['Консоль',node.status==='running'?'Serial · открыть':'Serial · неактивна']]);
  section('Ресурсы',[['vCPU',`${node.cpus} ${node.cpus===1?'ядро':'ядра'}`],['Оперативная память',`${node.ram} МБ`],['Сетевая карта',node.nicModel],['Интерфейсы',nicCount(node)]]);
  if(node.error)overview.append(el('p','danger-text node-error',node.error));
  const actions=el('div','overview-actions');
  const toggle=el('button',node.status==='running'?'secondary danger-text':'primary',node.status==='running'?'■ Остановить':'▶ Запустить');
  toggle.onclick=async()=>{const action=node.status==='running'?'stop':'start',ok=await request(`labs/${lab.id}/nodes/${node.id}/${action}`,{method:'POST'});if(ok)refresh();};actions.append(toggle);
  const consoleBtn=el('button','secondary','›_ Консоль');consoleBtn.disabled=node.status!=='running';consoleBtn.onclick=()=>openConsole(node);actions.append(consoleBtn);
  const settings=el('button','secondary','⚙ Параметры');settings.disabled=node.status==='running';settings.onclick=()=>showNodeSettings(node);actions.append(settings);
  const ports=el('button','secondary','⇄ Интерфейсы');ports.onclick=()=>{state.inspectorTab='interfaces';renderDetails(currentLab());};actions.append(ports);
  const icons=el('button','secondary','▧ Значок');icons.onclick=()=>openIconPicker(node.icon||iconFor(node),async file=>{const ok=await request(`labs/${lab.id}/nodes/${node.id}`,{method:'PATCH',body:json({icon:file})});if(ok)refresh();});actions.append(icons);
  const logBtn=el('button','secondary','☷ Лог QEMU');logBtn.onclick=()=>openLog(node);actions.append(logBtn);
  const remove=el('button','secondary danger-text','Удалить устройство');remove.disabled=node.status==='running';remove.onclick=()=>deleteNode(node);actions.append(remove);
  overview.append(actions);
  const container=$('#interfacesPane');container.replaceChildren();
  const links=Array.from({length:nicCount(node)},(_,i)=>lab.links.find(l=>(l.a===node.id&&l.aPort===i)||(l.b===node.id&&l.bPort===i)));
  const up=links.filter(l=>l?.status==='up').length,connected=links.filter(Boolean).length;
  const summary=el('div','ports-heading');summary.append(el('strong','','Интерфейсы'),el('span',up===connected&&up>0?'all-up':'',`${connected} / ${nicCount(node)} подключено · ${up} UP`));container.append(summary);
  const table=el('div','interfaces-table');const headings=el('div','interfaces-th');headings.append(el('span','','ПОРТ'),el('span','','ПОДКЛЮЧЕНИЕ'));table.append(headings);
  for(let i=0;i<nicCount(node);i++){
    const port=getPort(node,i),link=links[i];const peer=link?lab.nodes.find(x=>x.id===(link.a===node.id?link.b:link.a)):null;
    const remotePort=link?(link.a===node.id?link.bPort:link.aPort):null;
    const row=el('button','interface-row');row.title=link?'Изменить соединение':'Выбрать порт для нового кабеля';
    const left=el('div','interface-port');left.append(el('span','port-led '+(link?.status||'down')));
    const labels=el('div','interface-port-copy');labels.append(el('strong','',port.name),el('small','',speedText(port.speedMbps)));left.append(labels);
    const right=el('span','interface-peer',link&&peer?`${peer.name} · ${labelPort(peer,remotePort)}`:'Не подключён');
    row.append(left,right,el('span','interface-chevron','→'));
    row.onclick=()=>{if(link&&peer){const a=lab.nodes.find(x=>x.id===link.a),b=lab.nodes.find(x=>x.id===link.b);showCableInfo(link,a,b);}
      else{setMode('link');state.linkFrom=node.id;state.linkPort=i;state.inspectorTab='interfaces';renderDetails(currentLab());$('#editorHint').textContent=`${node.name}: ${port.name} · выберите второе устройство`;}};
    table.append(row);
  }
  container.append(table);
  const controls=el('div','interface-controls');const edit=el('button','secondary','⚙ Названия и скорости портов');edit.onclick=()=>showPortStyle(node);controls.append(edit);
  const hint=el('p','muted','Скорость здесь — характеристика интерфейса в топологии, а не принудительная настройка скорости сетевой карты QEMU.');controls.append(hint);container.append(controls);
}
function showModal(title,body,onSubmit){$('#modalTitle').textContent=title;$('#modalContent').replaceChildren(body);$('#modalBackdrop').classList.remove('hidden');const form=$('form',body)||body;if(form?.tagName==='FORM'){form.addEventListener('submit',async e=>{e.preventDefault();try{const ok=await onSubmit(new FormData(form));if(ok)hideModal();}catch(err){toast(err.message,true);}});} }
function hideModal(){$('#modalBackdrop').classList.add('hidden');}
function showNewLab(){const wrap=el('div');wrap.innerHTML=`<form><div class="modal-body"><div class="field"><label>Название лаборатории</label><input name="name" required maxlength="80" placeholder="Например, OSPF + BGP Lab" autofocus/></div></div><div class="modal-footer"><button type="button" class="secondary cancel">Отмена</button><button type="submit" class="primary">Создать</button></div></form>`;$('.cancel',wrap).onclick=hideModal;showModal('Новая лаборатория',wrap,async data=>{const lab=await request('labs',{method:'POST',body:json({name:data.get('name')})});if(lab){state.selectedLab=lab.id;await refresh();return true;}return false;});}
function showNodeModal(template=state.templates[0], position=null){
  const lab=currentLab();if(!lab){toast('Сначала создайте лабораторию',true);return;}if(!state.images.length){toast('Сначала загрузите QCOW2/RAW-образ в библиотеку',true);switchView('images');return;}
  const t=template||{id:'generic',name:'QEMU VM',kind:'server',cpus:1,ram:1024,nicModel:'virtio-net-pci',nicCount:4,diskBus:'virtio'};
  const wrap=el('div');wrap.innerHTML=`<form><div class="modal-body"><div class="field"><label>Имя устройства</label><input name="name" required maxlength="80" value="${escapeHTML(t.name)}"/></div><div class="field"><label>Вид устройства на схеме</label><select name="kind"><option value="router">Маршрутизатор</option><option value="switch">Коммутатор</option><option value="firewall">Межсетевой экран</option><option value="server">Сервер</option><option value="pc">Компьютер</option></select></div><div class="field"><label>Значок на схеме</label><input type="hidden" name="icon" value="${escapeHTML(iconFor(t))}"/><button type="button" class="icon-selector"><img class="icon-selector-preview" src="${iconURL(iconFor(t))}" alt=""/><span class="icon-selected-label">${escapeHTML(iconFor(t))}</span><span>Изменить…</span></button></div><div class="field"><label>Дисковый образ</label><select name="imageId" required>${state.images.map(im=>`<option value="${im.id}">${escapeHTML(im.name)} · ${escapeHTML(im.format)}</option>`).join('')}</select></div><div class="form-grid"><div class="field"><label>RAM (MiB)</label><input name="ram" type="number" min="128" max="131072" value="${t.ram}" required/></div><div class="field"><label>vCPU</label><input name="cpus" type="number" min="1" max="64" value="${t.cpus}" required/></div></div><div class="form-grid"><div class="field"><label>Network adapter</label><select name="nicModel"><option value="virtio-net-pci">virtio-net-pci</option><option value="e1000">e1000</option><option value="rtl8139">rtl8139</option></select></div><div class="field"><label>Disk bus</label><select name="diskBus"><option value="virtio">virtio</option><option value="ide">IDE</option><option value="scsi">SCSI</option></select></div></div><div class="field"><label>Обозначения интерфейсов на схеме</label><select name="portStyle">${portStyleOptions(t.portStyle||'auto')}</select></div><div class="field"><label>Ethernet-порты (создаются при запуске VM)</label><input name="nicCount" type="number" min="1" max="16" value="${t.nicCount || 4}" required/><small class="muted">Для горячего подключения кабелей используются заранее созданные сетевые карты. Количество изменяется только при остановленной VM.</small></div><div class="field"><label for="nodeAddQuantity">Количество устройств</label><input id="nodeAddQuantity" name="quantity" type="number" min="1" max="32" step="1" value="1" required/><small class="muted">При добавлении нескольких устройств имена будут пронумерованы, а узлы размещены рядом на полотне.</small></div></div><div class="modal-footer"><button type="button" class="secondary cancel">Отмена</button><button type="submit" class="primary">Добавить устройство</button></div></form>`;
  // No persistent device catalogue on the right: choose template in this dialog.
  const chooser=el('div','field');const chooseLabel=el('label','','Профиль устройства');const choose=el('select');
  for(const tpl of state.templates){const option=el('option','',tpl.name);option.value=tpl.id;choose.append(option);}choose.value=t.id||state.templates[0]?.id;
  chooser.append(chooseLabel,choose);$('.modal-body',wrap).prepend(chooser);
  choose.addEventListener('change',()=>{const next=state.templates.find(x=>x.id===choose.value);if(next)showNodeModal(next,position);});
  $('select[name=kind]',wrap).value=t.kind||'router';$('select[name=nicModel]',wrap).value=t.nicModel;$('select[name=diskBus]',wrap).value=t.diskBus;$('.cancel',wrap).onclick=hideModal;
  $('.icon-selector',wrap).onclick=()=>openIconPicker($('input[name=icon]',wrap).value,file=>{$('input[name=icon]',wrap).value=file;$('.icon-selector-preview',wrap).src=iconURL(file);$('.icon-selected-label',wrap).textContent=file;});
  $('select[name=kind]',wrap).addEventListener('change',e=>{const f=DEFAULT_ICONS[e.target.value];$('input[name=icon]',wrap).value=f;$('.icon-selector-preview',wrap).src=iconURL(f);$('.icon-selected-label',wrap).textContent=f;});
  showModal('Добавление устройства',wrap,async data=>{
    const quantity=Number(data.get('quantity'));
    if(!Number.isInteger(quantity)||quantity<1||quantity>32){toast('Количество устройств должно быть от 1 до 32',true);return false;}
    const count=lab.nodes.length;
    const device={name:data.get('name'),imageId:data.get('imageId'),ram:Number(data.get('ram')),cpus:Number(data.get('cpus')),nicModel:data.get('nicModel'),nicCount:Number(data.get('nicCount')),diskBus:data.get('diskBus'),kind:data.get('kind'),portStyle:data.get('portStyle'),icon:data.get('icon'),x:position?.x??140+(count%5)*190,y:position?.y??100+Math.floor(count/5)*155};
    const result=quantity===1
      ?await request(`labs/${lab.id}/nodes`,{method:'POST',body:json(device)})
      :await request(`labs/${lab.id}/nodes/batch`,{method:'POST',body:json({template:device,count:quantity})});
    if(result){const first=quantity===1?result:result.nodes[0];state.selectedNode=first?.id||null;state.selectedNodes=new Set((quantity===1?[result]:result.nodes).map(node=>node.id));await refresh();return true;}
    return false;
  });
}
// Protected telemetry uses server-side /proc values and an actual API request round trip.
async function refreshTelemetry(){
 if(!state.token)return;
 const started=performance.now();
 try{
   const data=await api('metrics');const rtt=Math.max(0,Math.round(performance.now()-started));
   $('#serverConnection').innerHTML='<i class="telemetry-dot"></i> Сервер подключён';
   $('#serverConnection').classList.remove('is-offline');
   $('#hostCPU').textContent=typeof data.cpuPercent==='number'?`CPU ${Math.round(data.cpuPercent)}%`:'CPU —';
   $('#hostRAM').textContent=data.memoryTotalMiB>0?`RAM ${(data.memoryUsedMiB/1024).toFixed(1)} / ${(data.memoryTotalMiB/1024).toFixed(1)} ГБ`:'RAM —';
   $('#apiLatency').textContent=`Задержка ${rtt} мс`;
   $('#lastSaved').textContent=data.savedAt?`Последнее сохранение ${new Date(data.savedAt).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`:'Последнее сохранение —';
 }catch(err){
   $('#serverConnection').innerHTML='<i class="telemetry-dot"></i> Нет связи с сервером';
   $('#serverConnection').classList.add('is-offline');$('#apiLatency').textContent='Задержка —';
 }
}
function renderImages(){const table=$('#imagesTable');table.replaceChildren();const header=el('div','table-row table-heading');for(const name of ['ОБРАЗ','ФОРМАТ','РАЗМЕР','ДЕЙСТВИЯ'])header.append(el('div','',name));table.append(header);
  for(const img of state.images){const row=el('div','table-row');row.append(el('strong','',img.name));const badge=el('div');badge.append(el('span','filetype',img.format.toUpperCase()));row.append(badge,el('div','muted',bytes(img.size)));const actions=el('div');const remove=el('button','','Удалить');remove.onclick=async()=>{if(!confirm(`Удалить образ ${img.name}?`))return;const ok=await request(`images/${img.id}`,{method:'DELETE'});if(ok)refresh();};actions.append(remove);row.append(actions);table.append(row);}if(!state.images.length)table.append(el('div','modal-body muted','Образов пока нет. Загрузите автономный QCOW2 или RAW диск.'));
}
async function refreshSystem(){const sys=await request('system');if(!sys)return;const area=$('#systemCards');area.replaceChildren();for(const [name,description,key] of [['QEMU','Эмулятор виртуальных машин','qemu'],['QEMU: запуск','Запуск от системного пользователя netlab-vm','qemuSpawn'],['QEMU-IMG','Импорт и overlay-диски','qemuImg'],['Open vSwitch','L2 коммутация','ovs'],['KVM','Аппаратное ускорение','kvm'],['VM user','netlab-vm','vmUser']]){const card=el('div','status-card');card.append(el('strong','',name),el('span',sys[key]?'● Готово':'○ Недоступно'));$('span',card).className=sys[key]?'ok':'not-ok';card.append(el('p','muted',description));if(key==='qemuSpawn'&&!sys[key]&&sys.qemuSpawnError)card.append(el('p','danger-text',sys.qemuSpawnError));area.append(card);}$('#serverHealth').textContent=sys.qemuSpawn&&sys.ovs&&sys.qemuImg&&sys.vmUser?'● Engine ready':'● Требуется проверка';$('#serverHealth').className=`pill ${sys.qemuSpawn&&sys.ovs&&sys.qemuImg&&sys.vmUser?'good-pill':'bad-pill'}`;}
function openConsole(node){const lab=currentLab();if(!lab)return;closeConsole();state.console={lab:lab.id,node:node.id};$('#consoleTitle').textContent=node.name;$('#consoleOutput').textContent='Подключение к Serial...';$('#consoleBackdrop').classList.remove('hidden');$('#consoleInput').focus();pollConsole();state.poller=setInterval(pollConsole,900);}
async function pollConsole(){const c=state.console;if(!c)return;try{const response=await api(`labs/${c.lab}/nodes/${c.node}/console`);if(state.console!==c)return;const target=$('#consoleOutput');const nearBottom=target.scrollHeight-target.scrollTop-target.clientHeight<100;if(target.textContent!==response.output)target.textContent=response.output||'[Serial console: ожидается вывод гостевой ОС]';if(nearBottom)target.scrollTop=target.scrollHeight;}catch(err){if(state.console===c)$('#consoleOutput').textContent=`Ошибка: ${err.message}`;}}
function closeConsole(){state.console=null;if(state.poller){clearInterval(state.poller);state.poller=null;}$('#consoleBackdrop').classList.add('hidden');}
async function openLog(node){const lab=currentLab();if(!lab)return;const response=await request(`labs/${lab.id}/nodes/${node.id}/log`);if(!response)return;const wrap=el('div','modal-body');const pre=el('pre','',response.output||'Лог пока пуст');pre.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;max-height:60vh;overflow:auto;font-size:11px;color:#abccff';wrap.append(pre);showModal(`QEMU log · ${node.name}`,wrap,()=>true);}
function showLogin(){$('#loginBackdrop').classList.remove('hidden');}
function hideLogin(){$('#loginBackdrop').classList.add('hidden');}
async function boot(){try{const resp=await api('labs');state.labs=resp;hideLogin();await refresh();await refreshSystem();await refreshTelemetry();}catch{showLogin();}}
async function startSelectedNodes(){
 const lab=currentLab(), ids=[...state.selectedNodes]; if(!lab||!ids.length)return;
 let ok=0, failed=[];
 for(const id of ids){ const node=lab.nodes.find(n=>n.id===id); if(!node||node.status==='running')continue; const result=await request(`labs/${lab.id}/nodes/${id}/start`,{method:'POST'}); if(result) ok++; else failed.push(node?.name||id); }
 await refresh();
 if(ok) toast(`Запущено устройств: ${ok}`);
 if(failed.length) toast(`Не удалось запустить: ${failed.slice(0,3).join(', ')}${failed.length>3?'…':''}`,true);
}
async function stopSelectedNodes(){
 const lab=currentLab(), ids=[...state.selectedNodes]; if(!lab||!ids.length)return;
 let ok=0, failed=[];
 for(const id of ids){ const node=lab.nodes.find(n=>n.id===id); if(!node||node.status!=='running')continue; const result=await request(`labs/${lab.id}/nodes/${id}/stop`,{method:'POST'}); if(result) ok++; else failed.push(node?.name||id); }
 await refresh();
 if(ok) toast(`Остановлено устройств: ${ok}`);
 if(failed.length) toast(`Не удалось остановить: ${failed.slice(0,3).join(', ')}${failed.length>3?'…':''}`,true);
}
async function deleteSelectedNodes(){
 const lab=currentLab(), ids=[...state.selectedNodes]; if(!lab||!ids.length)return;
 const picked=lab.nodes.filter(n=>ids.includes(n.id));
 const running=picked.filter(n=>n.status==='running');
 if(running.length){ toast('Сначала остановите выбранные запущенные устройства',true); return; }
 if(!confirm(`Удалить выбранные устройства (${picked.length}) вместе с соединениями?`)) return;
 let ok=0, failed=[];
 for(const node of picked){ const result=await request(`labs/${lab.id}/nodes/${node.id}`,{method:'DELETE'}); if(result) ok++; else failed.push(node.name); }
 state.selectedNode=null; state.selectedNodes.clear();
 await refresh();
 if(ok) toast(`Удалено устройств: ${ok}`);
 if(failed.length) toast(`Не удалось удалить: ${failed.slice(0,3).join(', ')}${failed.length>3?'…':''}`,true);
}
async function autoAlignSelection(){
 const lab=currentLab(), ids=[...state.selectedNodes]; if(!lab||ids.length<2) return;
 const nodes=lab.nodes.filter(n=>ids.includes(n.id));
 if(nodes.length<2) return;
 const sorted=[...nodes].sort((a,b)=>a.y===b.y?a.x-b.x:a.y-b.y);
 const left=Math.min(...sorted.map(n=>n.x)), top=Math.min(...sorted.map(n=>n.y));
 const cols=Math.max(1, Math.ceil(Math.sqrt(sorted.length)));
 const gapX=185, gapY=150;
 let moved=0;
 for(let i=0;i<sorted.length;i++){
   const row=Math.floor(i/cols), col=i%cols;
   const x=left + col*gapX, y=top + row*gapY;
   const node=sorted[i];
   if(node.x===x && node.y===y) continue;
   const result=await request(`labs/${lab.id}/nodes/${node.id}`,{method:'PATCH',body:json({x,y})});
   if(result) moved++;
 }
 await refresh();
 toast(moved?`Автовыравнивание выполнено (${sorted.length} узл.)`:'Узлы уже выровнены');
}
function showSelectionContext(x,y){
 const lab=currentLab(), ids=[...state.selectedNodes], nodes=lab?lab.nodes.filter(n=>ids.includes(n.id)):[];
 const running=nodes.filter(n=>n.status==='running').length;
 showContext(x,y,[
  {icon:'▶',label:`Включить все (${nodes.length})`,disabled:!nodes.length||running===nodes.length,action:startSelectedNodes},
  {icon:'■',label:`Остановить все (${nodes.length})`,disabled:!nodes.length||running===0,action:stopSelectedNodes},
  {icon:'≋',label:'Автовыравнивание',disabled:nodes.length<2,action:autoAlignSelection},
  {separator:true},
  {icon:'✕',label:`Удалить все (${nodes.length})`,destructive:true,disabled:!nodes.length||running>0,action:deleteSelectedNodes}
 ]);
}
function showContext(x,y,items){
 const menu=$('#canvasContext');menu.replaceChildren();
 for(const item of items){if(item.separator){menu.append(el('div','context-divider'));continue;}
  const btn=el('button','context-item'+(item.destructive?' destructive':'')+(item.disabled?' disabled':''));btn.disabled=!!item.disabled;
  btn.append(el('span','context-symbol',item.icon||' '),el('span','',item.label));
  btn.onclick=()=>{hideContext();item.action?.();};menu.append(btn);
 }
 menu.classList.remove('hidden');const maxX=window.innerWidth-menu.offsetWidth-8,maxY=window.innerHeight-menu.offsetHeight-8;
 menu.style.left=`${Math.max(6,Math.min(maxX,x))}px`;menu.style.top=`${Math.max(6,Math.min(maxY,y))}px`;
}
function hideContext(){$('#canvasContext').classList.add('hidden');}
function showNodeContext(x,y,node){
 const running=node.status==='running',lab=currentLab();
 if(state.selectedNodes.size>1 && state.selectedNodes.has(node.id)) return showSelectionContext(x,y);
 showContext(x,y,[
  {icon:'›_',label:'Открыть консоль',disabled:!running,action:()=>openConsole(node)},
  {icon:running?'■':'▶',label:running?'Остановить':'Запустить',action:async()=>{await request(`labs/${lab.id}/nodes/${node.id}/${running?'stop':'start'}`,{method:'POST'});refresh();}},
  {separator:true},
  {icon:'↝',label:'Протянуть кабель',action:()=>{setMode('link');state.linkFrom=node.id;renderLab();$('#editorHint').textContent=`Источник: ${node.name} · выберите второе устройство`; }},
  {icon:'✎',label:'Переименовать',action:()=>showRename(node)},
  {icon:'⇄',label:'Интерфейсы и скорости',action:()=>showPortStyle(node)},
  {icon:'▧',label:'Выбрать иконку',action:()=>openIconPicker(node.icon||iconFor(node),async file=>{const ok=await request(`labs/${lab.id}/nodes/${node.id}`,{method:'PATCH',body:json({icon:file})});if(ok)refresh();})},
  {icon:'⚙',label:'Настройки устройства',disabled:running,action:()=>showNodeSettings(node)},
  {icon:'☷',label:'Журнал QEMU',action:()=>openLog(node)},
  {separator:true},
  {icon:'✕',label:'Удалить устройство',destructive:true,disabled:running,action:()=>deleteNode(node)}
 ]);
}
function showPortStyle(node){
 const lab=currentLab(),wrap=el('div'),form=el('form');
 const content=el('div','modal-body');
 const desc=el('p','muted','Названия и скорости отдельных портов в схеме. Не изменяет модель QEMU NIC или скорость линка внутри гостевой ОС. Можно редактировать при работающем узле.');content.append(desc);
 const family=el('div','field');const familyLabel=el('label','','Семейство обозначений интерфейсов');const style=el('select');style.name='portStyle';style.innerHTML=portStyleOptions(node.portStyle||'auto');family.append(familyLabel,style);content.append(family);
 const table=el('div','port-config-table');const header=el('div','port-config-header');header.append(el('span','','ПОРТ'),el('span','','НАЗВАНИЕ'),el('span','','СКОРОСТЬ'));table.append(header);
 for(let i=0;i<nicCount(node);i++){
   const config=node.ports?.[i]||{},row=el('div','port-config-row');row.append(el('span','port-index',`#${i+1}`));
   const input=el('input');input.type='text';input.name=`portName${i}`;input.value=config.name||'';input.maxLength=32;input.placeholder=labelPort({...node,ports:[],portStyle:style.value},i);input.title='Пустое поле — автоматическое имя';
   const speed=el('select');speed.name=`speed${i}`;
   const auto=el('option','','Авто ('+speedText(defaultSpeed(node))+')');auto.value='0';speed.append(auto);
   for(const value of SPEEDS){const option=el('option','',speedText(value));option.value=String(value);speed.append(option);}
   speed.value=String(config.speedMbps||0);row.append(input,speed);table.append(row);
 }
 content.append(table);style.addEventListener('change',()=>{for(let i=0;i<nicCount(node);i++){
   const input=$(`[name="portName${i}"]`,table),speed=Number($(`[name="speed${i}"]`,table).value)||defaultSpeed(node);
   input.placeholder=portInfo({...node,ports:[...Array.from({length:i},()=>({})),{speedMbps:speed}],portStyle:style.value},i).name;
 }});
 const footer=el('div','modal-footer');const cancel=el('button','secondary','Отмена');cancel.type='button';cancel.onclick=hideModal;
 const save=el('button','primary','Сохранить');save.type='submit';footer.append(cancel,save);form.append(content,footer);wrap.append(form);
 showModal('Интерфейсы · '+node.name,wrap,async data=>{
   const ports=Array.from({length:nicCount(node)},(_,i)=>({name:String(data.get(`portName${i}`)||'').trim(),speedMbps:Number(data.get(`speed${i}`))||0}));
   const result=await request(`labs/${lab.id}/nodes/${node.id}`,{method:'PATCH',body:json({portStyle:data.get('portStyle'),ports})});
   if(result){await refresh();return true;}return false;
 });
}
function showRename(node){const lab=currentLab(),wrap=el('div');wrap.innerHTML=`<form><div class="modal-body"><div class="field"><label>Название устройства</label><input name="name" maxlength="80" required value="${escapeHTML(node.name)}"/></div></div><div class="modal-footer"><button type="button" class="secondary cancel">Отмена</button><button type="submit" class="primary">Сохранить</button></div></form>`;
 $('.cancel',wrap).onclick=hideModal;showModal('Переименовать устройство',wrap,async data=>{const result=await request(`labs/${lab.id}/nodes/${node.id}`,{method:'PATCH',body:json({name:data.get('name')})});if(result){await refresh();return true;}return false;});}
async function deleteNode(node){const lab=currentLab();if(!confirm(`Удалить «${node.name}» вместе с соединениями?`))return;const ok=await request(`labs/${lab.id}/nodes/${node.id}`,{method:'DELETE'});if(ok){state.selectedNode=null;refresh();}}
async function removeLink(link){const lab=currentLab();if(!confirm('Отсоединить кабель? Если узлы работают, сеть между ними будет немедленно разорвана.'))return;const ok=await request(`labs/${lab.id}/links/${link.id}`,{method:'DELETE'});if(ok){refresh();toast('Кабель отключён');}}
function showCableInfo(link,a,b){
 const lab=currentLab(),wrap=el('div');
 wrap.innerHTML=`<form><div class="modal-body"><p class="cable-description">${escapeHTML(updateCableTip(link,a,b))}</p><div class="form-grid"><div class="field"><label>Устройство A</label><select name="a"></select></div><div class="field"><label>Устройство B</label><select name="b"></select></div></div><div class="cable-ports"><div class="field"><label>Интерфейс A</label><select name="aPort"></select></div><span class="cable-symbol">⟷</span><div class="field"><label>Интерфейс B</label><select name="bPort"></select></div></div><p class="muted">Кабель переподключается без остановки QEMU. Порты на работающих VM уже созданы.</p></div><div class="modal-footer"><button class="secondary cancel" type="button">Отмена</button><button class="primary" type="submit">Применить</button></div></form>`;
 for(const side of ['a','b']){const select=$(`select[name=${side}]`,wrap);for(const node of lab.nodes){const opt=el('option','',node.name);opt.value=node.id;select.append(opt)}select.value=link[side];}
 function updatePorts(){for(const side of ['a','b']){const node=lab.nodes.find(n=>n.id===$(`select[name=${side}]`,wrap).value),selector=$(`select[name=${side}Port]`,wrap),prev=Number(selector.value);selector.replaceChildren();if(!node)continue;const ports=availablePorts(lab,node,link.id);for(const p of ports){const opt=el('option','',labelPort(node,p));opt.value=p;selector.append(opt);}const original=link[side]===node.id?link[side+'Port']:-1;selector.value=ports.includes(prev)?String(prev):String(ports.includes(original)?original:ports[0]);}}
 for(const side of ['a','b'])$(`select[name=${side}]`,wrap).onchange=updatePorts;
 updatePorts();$('.cancel',wrap).onclick=hideModal;
 showModal('Переподключить Ethernet-кабель',wrap,async data=>{
  const result=await request(`labs/${lab.id}/links/${link.id}`,{method:'PATCH',body:json({a:data.get('a'),b:data.get('b'),aPort:Number(data.get('aPort')),bPort:Number(data.get('bPort'))})});
  if(result){await refresh();toast('Кабель переподключён: '+linkLabel(result.status));return true;}return false;
 });
}
function showNodeSettings(node){const lab=currentLab(),wrap=el('div');wrap.innerHTML=`<form><div class="modal-body"><div class="field"><label>Название</label><input name="name" required maxlength="80" value="${escapeHTML(node.name)}"/></div><div class="form-grid"><div class="field"><label>RAM (MiB)</label><input name="ram" type="number" min="128" max="131072" value="${node.ram}"/></div><div class="field"><label>vCPU</label><input name="cpus" type="number" min="1" max="64" value="${node.cpus}"/></div></div><div class="form-grid"><div class="field"><label>Сетевая карта</label><select name="nicModel"><option>e1000</option><option>virtio-net-pci</option><option>rtl8139</option></select></div><div class="field"><label>Диск</label><select name="diskBus"><option>virtio</option><option>ide</option><option>scsi</option></select></div></div><div class="field"><label>Тип</label><select name="kind">${[['router','Маршрутизатор'],['switch','Коммутатор'],['firewall','Межсетевой экран'],['server','Сервер'],['pc','Компьютер']].map(([k,l])=>`<option value="${k}">${l}</option>`).join('')}</select></div><div class="field"><label>Обозначения интерфейсов</label><select name="portStyle">${portStyleOptions(node.portStyle||'auto')}</select></div><div class="field"><label>Количество Ethernet-интерфейсов (1–16)</label><input name="nicCount" type="number" min="1" max="16" value="${nicCount(node)}"/></div><p class="muted">Число сетевых карт и параметры VM меняются только при остановленной лаборатории. Кабели можно менять на горячую.</p></div><div class="modal-footer"><button class="secondary cancel" type="button">Отмена</button><button class="primary" type="submit">Сохранить</button></div></form>`;
 $('select[name=nicModel]',wrap).value=node.nicModel;$('select[name=diskBus]',wrap).value=node.diskBus;$('select[name=kind]',wrap).value=kindOf(node);$('.cancel',wrap).onclick=hideModal;
 showModal('Параметры '+node.name,wrap,async data=>{const edit={...node,name:data.get('name'),ram:Number(data.get('ram')),cpus:Number(data.get('cpus')),nicModel:data.get('nicModel'),nicCount:Number(data.get('nicCount')),diskBus:data.get('diskBus'),kind:data.get('kind'),portStyle:data.get('portStyle')};const ok=await request(`labs/${lab.id}/nodes/${node.id}`,{method:'PUT',body:json(edit)});if(ok){await refresh();return true;}return false;});}
function iconCategory(name){
 const n=name.toLowerCase();
 if(/router|gateway|asr|csr|isrv|c7200|mikro|routem|vrouter/.test(n))return 'router';
 if(/switch|nexus|catalyst|vss|n2k|n7k|n9k/.test(n))return 'switch';
 if(/firewall|forti|asa|paloalto|srx|checkpoint|security/.test(n))return 'firewall';
 if(/server|nas|storage|ucs|linux|docker|openfiler|freen/.test(n))return 'server';
 if(/desktop|laptop|host|workstation|pc\.|monitor/.test(n))return 'pc';
 if(/cloud|internet|mpls/.test(n))return 'cloud';
 return 'other';
}
function openIconPicker(initial,callback){
 const backdrop=$('#iconPickerBackdrop'),search=$('#iconSearch'),cats=$('#iconCategories'),grid=$('#iconGrid'),count=$('#iconPickerCount');
 let cat='all';search.value='';backdrop.classList.remove('hidden');
 const categories=[['all','Все'],['router','Маршрутизаторы'],['switch','Коммутаторы'],['firewall','Безопасность'],['server','Серверы'],['pc','ПК'],['cloud','Облака'],['other','Прочее']];
 function draw(){const q=search.value.toLowerCase().trim();grid.replaceChildren();const matched=state.iconCatalogue.filter(i=>(cat==='all'||iconCategory(i)===cat)&&i.toLowerCase().includes(q));count.textContent=`${matched.length} значков`;
  for(const filename of matched){const btn=el('button','icon-choice'+(filename===initial?' active':''));btn.title=filename;btn.append(iconImage(filename),el('span','',filename.replace(/\.png$/i,'')));
   btn.onclick=()=>{backdrop.classList.add('hidden');callback(filename);};grid.append(btn);}
 }
 cats.replaceChildren();for(const [id,label] of categories){const b=el('button',id===cat?'active':'',label);b.onclick=()=>{cat=id;for(const x of cats.children)x.classList.toggle('active',x===b);draw();};cats.append(b);}
 search.oninput=draw;draw();search.focus();
}
function hideIconPicker(){$('#iconPickerBackdrop').classList.add('hidden');}
function beginAreaTool(e,mode,viewport){
 e.preventDefault();hideContext();const bounds=viewport.getBoundingClientRect(),sx=e.clientX-bounds.left,sy=e.clientY-bounds.top;
 const start=worldPoint(e.clientX,e.clientY),rect=$('#marqueeRect');
 rect.classList.remove('hidden');rect.classList.toggle('note-outline',mode==='note');
 viewport.setPointerCapture(e.pointerId);
 function move(ev){const x=ev.clientX-bounds.left,y=ev.clientY-bounds.top;
   Object.assign(rect.style,{left:Math.min(sx,x)+'px',top:Math.min(sy,y)+'px',width:Math.abs(x-sx)+'px',height:Math.abs(y-sy)+'px'});
 }
 const finish=(ev)=>{
  viewport.removeEventListener('pointermove',move);viewport.removeEventListener('pointerup',finish);viewport.removeEventListener('pointercancel',cancel);
  if(viewport.hasPointerCapture(ev.pointerId))viewport.releasePointerCapture(ev.pointerId);
  rect.classList.add('hidden');const end=worldPoint(ev.clientX,ev.clientY);
  const x=Math.min(start.x,end.x),y=Math.min(start.y,end.y),w=Math.abs(end.x-start.x),h=Math.abs(end.y-start.y);
  if(mode==='note'){
    setMode('select');showAnnotationDialog({kind:'note',text:'',x,y,width:Math.max(160,w),height:Math.max(80,h)});return;
  }
  const lab=currentLab();if(!lab)return;
  const selected=lab.nodes.filter(n=>n.x+98>=x&&n.x<=x+w&&n.y+90>=y&&n.y<=y+h).map(n=>n.id);
  if(!(ev.ctrlKey||ev.shiftKey))state.selectedNodes.clear();for(const id of selected)state.selectedNodes.add(id);
  state.selectedNode=state.selectedNodes.size===1?[...state.selectedNodes][0]:null;
  setMode('select');
 };
 const cancel=()=>{viewport.removeEventListener('pointermove',move);viewport.removeEventListener('pointerup',finish);viewport.removeEventListener('pointercancel',cancel);rect.classList.add('hidden');};
 viewport.addEventListener('pointermove',move);viewport.addEventListener('pointerup',finish);viewport.addEventListener('pointercancel',cancel);
}
function setupCanvas(){
 const viewport=$('#canvasViewport');applyView();
 viewport.addEventListener('contextmenu',e=>{
  if(state.mode==='pan'||state.spaceHeld){e.preventDefault();return;}
  if(e.target.closest('.node,.cable-hit,.canvas-annotation,.canvas-toolbar,.canvas-zoom'))return;
  e.preventDefault();
  if(state.selectedNodes.size>1){showSelectionContext(e.clientX,e.clientY);return;}
  const point=worldPoint(e.clientX,e.clientY);
  showContext(e.clientX,e.clientY,[
   {icon:'＋',label:'Добавить устройство сюда',action:()=>showNodeModal(state.templates[0],point)},
   {icon:'T',label:'Добавить текст',action:()=>showAnnotationDialog({kind:'text',text:'',...point,width:240,height:55})},
   {icon:'▢',label:'Добавить примечание',action:()=>showAnnotationDialog({kind:'note',text:'',...point,width:230,height:110})},
   {icon:'◎',label:'Показать всю топологию',action:fitTopology}
  ]);
 });
 viewport.addEventListener('pointerdown',e=>{
  if(e.target.closest('.node,.cable-hit,.canvas-annotation,.canvas-toolbar,.canvas-zoom'))return;
  hideContext();
  if(e.button===1||(e.button===0&&(state.spaceHeld||state.mode==='pan'))){
   e.preventDefault();const sx=e.clientX,sy=e.clientY,x0=state.panX,y0=state.panY;
   viewport.setPointerCapture(e.pointerId);viewport.classList.add('panning');
   const move=v=>{state.panX=x0+v.clientX-sx;state.panY=y0+v.clientY-sy;applyView();};
   const done=v=>{viewport.removeEventListener('pointermove',move);viewport.removeEventListener('pointerup',done);viewport.removeEventListener('pointercancel',done);viewport.classList.remove('panning');if(viewport.hasPointerCapture(v.pointerId))viewport.releasePointerCapture(v.pointerId);};
   viewport.addEventListener('pointermove',move);viewport.addEventListener('pointerup',done);viewport.addEventListener('pointercancel',done);return;
  }
  if(e.button!==0)return;
  if(state.mode==='marquee'||state.mode==='note'){beginAreaTool(e,state.mode,viewport);return;}
  if(state.mode==='text'){
   const point=worldPoint(e.clientX,e.clientY);setMode('select');showAnnotationDialog({kind:'text',text:'',...point,width:245,height:52});return;
  }
  state.selectedNode=null;state.selectedAnnotation=null;state.selectedNodes.clear();renderDetails(currentLab());
  for(const c of $('#nodesLayer').children)c.classList.remove('active');
  for(const c of $('#annotationsLayer').children)c.classList.remove('is-selected');
 });
 viewport.addEventListener('dragover',e=>{if(state.mode==='pan'||state.spaceHeld)return;e.preventDefault();e.dataTransfer.dropEffect='copy';viewport.classList.add('drag-over');});
 viewport.addEventListener('dragleave',e=>{if(!viewport.contains(e.relatedTarget))viewport.classList.remove('drag-over');});
 viewport.addEventListener('drop',async e=>{e.preventDefault();viewport.classList.remove('drag-over');if(state.mode==='pan'||state.spaceHeld)return;const existingID=e.dataTransfer.getData('application/x-netlab-node');if(existingID){const lab=currentLab();const node=lab?.nodes.find(n=>n.id===existingID);if(node){const pos=worldPoint(e.clientX,e.clientY);const ok=await request(`labs/${lab.id}/nodes/${existingID}`,{method:'PATCH',body:json({x:pos.x,y:pos.y})});if(ok)refresh();}return;}const id=e.dataTransfer.getData('application/x-netlab-template')||e.dataTransfer.getData('text/plain');const tpl=state.templates.find(t=>t.id===id);if(tpl)showNodeModal(tpl,worldPoint(e.clientX,e.clientY));});
 viewport.addEventListener('wheel',e=>{if(e.target.closest('.canvas-toolbar,.canvas-zoom,.annotation-scrollable .annotation-content'))return;e.preventDefault();setZoom(state.zoom*(e.deltaY>0?.9:1.1),e.clientX,e.clientY);},{passive:false});
 viewport.addEventListener('dblclick',e=>{if(e.target.closest('.node,.cable-hit,.canvas-annotation,.canvas-toolbar,.canvas-zoom'))return;if(state.mode==='select')showNodeModal(state.templates[0],worldPoint(e.clientX,e.clientY));});
}
function toggleInspector(){$('#labWorkspace').classList.toggle('inspector-collapsed');$('#toggleInspector').classList.toggle('selected',!$('#labWorkspace').classList.contains('inspector-collapsed'));}
async function deleteCurrentLab(){
 const lab=currentLab();if(!lab||!confirm(`Удалить лабораторию «${lab.name}»? Все её устройства и кабели будут удалены. Сначала остановите запущенные узлы.`))return;
 const done=await request(`labs/${lab.id}`,{method:'DELETE'});if(done){state.selectedLab=null;state.selectedNode=null;state.selectedNodes.clear();refresh();}
}
function bind(){
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>switchView(b.dataset.view));
  for(const id of ['newLab','quickNew','emptyNew'])$('#'+id).onclick=showNewLab;
  $('#addNodeBtn').onclick=()=>showNodeModal();$('#closeModal').onclick=hideModal;
  $('#modalBackdrop').onclick=e=>{if(e.target===$('#modalBackdrop'))hideModal();};
  $('#closeConsole').onclick=closeConsole;$('#consoleBackdrop').onclick=e=>{if(e.target===$('#consoleBackdrop'))closeConsole();};
  $('#consoleForm').onsubmit=async e=>{e.preventDefault();const val=$('#consoleInput').value;const c=state.console;if(!c)return;$('#consoleInput').value='';const result=await request(`labs/${c.lab}/nodes/${c.node}/console`,{method:'POST',body:json({text:val+'\r'})});if(result)pollConsole();};
  $('#loginForm').onsubmit=async e=>{e.preventDefault();state.token=$('#tokenInput').value.trim();try{await api('labs');sessionStorage.setItem('netlabToken',state.token);hideLogin();await refresh();await refreshSystem();await refreshTelemetry();}catch(err){toast(err.message,true);}};
  $('#signOut').onclick=()=>{state.token='';sessionStorage.removeItem('netlabToken');showLogin();};
  for(const [id,mode] of [['selectTool','select'],['linkTool','link'],['panTool','pan'],['marqueeTool','marquee'],['textTool','text'],['noteTool','note']])$('#'+id).onclick=()=>setMode(mode);
  $('#overviewTab').onclick=()=>{state.inspectorTab='overview';renderDetails(currentLab());};$('#interfacesTab').onclick=()=>{state.inspectorTab='interfaces';renderDetails(currentLab());};
  $('#explorerAdd').onclick=()=>showNodeModal();$('#explorerAddBottom').onclick=()=>showNodeModal();
  $('#explorerSearch').oninput=e=>{state.explorerQuery=e.target.value;const lab=currentLab();if(lab)renderExplorer(lab);};
  $('#toggleInspector').onclick=toggleInspector;$('#zoomFit').onclick=fitTopology;setupCanvas();$('#closeIconPicker').onclick=hideIconPicker;$('#iconPickerBackdrop').onclick=e=>{if(e.target.id==='iconPickerBackdrop')hideIconPicker();};
  $('#startAll').onclick=async()=>{const lab=currentLab();if(!lab)return;const done=await request(`labs/${lab.id}/start`,{method:'POST'});if(done)refresh();};
  $('#stopAll').onclick=async()=>{const lab=currentLab();if(!lab)return;const done=await request(`labs/${lab.id}/stop`,{method:'POST'});if(done)refresh();};
  $('#snapshotLab').onclick=async()=>{
    const lab=currentLab();if(!lab)return;
    const button=$('#snapshotLab');button.disabled=true;
    try{
      await downloadTopologyPNG(lab,{iconFor,iconURL,labelPort,layoutParallelCables,annotationDefaults});
      toast('Снимок топологии PNG сохранён');
    }catch(error){toast('Не удалось сохранить снимок: '+error.message,true);}
    finally{button.disabled=false;}
  };
  $('#labMore').onclick=e=>{const rect=e.currentTarget.getBoundingClientRect();showContext(rect.right-220,rect.bottom+6,[{icon:'☷',label:'Сведения о лаборатории',disabled:true},{separator:true},{icon:'✕',label:'Удалить лабораторию',destructive:true,action:deleteCurrentLab}]);};
  $('#refreshSystem').onclick=refreshSystem;
  $('#zoomIn').onclick=()=>setZoom(state.zoom+.1);$('#zoomOut').onclick=()=>setZoom(state.zoom-.1);$('#zoomReset').onclick=()=>setZoom(1);

  $('#imageFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;toast('Загрузка образа: не закрывайте страницу до завершения');const data=new FormData();data.append('file',file);const result=await request('images',{method:'POST',body:data});e.target.value='';if(result){toast(`Образ ${result.name} загружен`);refresh();}};
  document.addEventListener('pointerdown',e=>{if(!e.target.closest('#canvasContext'))hideContext();});
  document.addEventListener('keydown',e=>{if(e.code==='Space'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&!e.repeat){state.spaceHeld=true;$('#canvasViewport').classList.add('space-pan');e.preventDefault();}
   if(e.key==='Escape'){hideContext();hideIconPicker();hideModal();closeConsole();state.linkFrom=null;setMode('select');}
   if(!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.repeat&&$('#modalBackdrop').classList.contains('hidden')){
      const tool={KeyV:'select',KeyH:'pan',KeyC:'link',KeyM:'marquee',KeyT:'text',KeyN:'note'}[e.code];if(tool&&state.view==='labs')setMode(tool);
   }
   if(e.key==='Delete'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&!$('#modalBackdrop').classList.contains('hidden'))return;
   if(e.key==='Delete'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&state.view==='labs') {
      if(state.selectedNodes.size>1){deleteSelectedNodes();}
      else if(state.selectedNode){const n=currentNode();if(n)deleteNode(n);} 
   }
  });
  document.addEventListener('keyup',e=>{if(e.code==='Space'){state.spaceHeld=false;$('#canvasViewport').classList.remove('space-pan');}});
}
function setMode(mode){
 state.linkDrag?.cleanup?.();state.mode=mode;state.linkFrom=null;state.linkPort=null;
 $('#canvasViewport').classList.toggle('mode-pan',mode==='pan');
 for(const [id,m] of [['selectTool','select'],['linkTool','link'],['panTool','pan'],['marqueeTool','marquee'],['textTool','text'],['noteTool','note']])$('#'+id).classList.toggle('selected',mode===m);
 const hints={select:'Выбор: перетаскивайте устройства · Ctrl/Shift — несколько · ПКМ — действия',link:'Кабель: протяните от значка соединения или выберите два устройства',pan:'Рука: перетаскивайте полотно мышью',marquee:'Выделение рамкой: протяните прямоугольник вокруг устройств',text:'Текст: нажмите на пустом месте топологии',note:'Примечание: протяните прямоугольник на пустом месте'};
 $('#editorHint').textContent=hints[mode]||hints.select;renderLab();
}
async function pollLabStatus(){
 if(!state.token||state.view!=='labs'||!state.selectedLab||state.dragging||state.annotationDrag||state.linkDrag||!$('#modalBackdrop').classList.contains('hidden')||!$('#iconPickerBackdrop').classList.contains('hidden'))return;
 try{
  const lab=await api(`labs/${state.selectedLab}`),idx=state.labs.findIndex(l=>l.id===lab.id);
  if(idx<0)return;
  const previous=state.labs[idx];state.labs[idx]=lab;
  if(previous.nodes.length!==lab.nodes.length||previous.links.length!==lab.links.length){renderLab();return;}
  // Avoid destroying cable hit-targets and inspector buttons every 3 seconds.
  const statusChanged=lab.nodes.some((n,i)=>n.status!==previous.nodes[i]?.status||n.error!==previous.nodes[i]?.error);
  const wiresChanged=lab.links.some((l,i)=>l.status!==previous.links[i]?.status||l.id!==previous.links[i]?.id);
  if(wiresChanged)renderWires(lab);
  if((previous.annotations||[]).length!==(lab.annotations||[]).length)renderAnnotations(lab);
  if(statusChanged){renderExplorer(lab);for(const node of lab.nodes){const dom=[...$('#nodesLayer').children].find(c=>c.dataset.id===node.id);if(!dom)continue;const led=$('.device-status',dom);if(led)led.classList.toggle('running',node.status==='running');}}
  if(state.selectedNode&&(statusChanged||wiresChanged))renderDetails(lab);
 }catch(e){/* status refresh is best-effort; API errors shown by explicit actions */}
}
bind();setInterval(pollLabStatus,3000);setInterval(()=>{if(state.token)refreshTelemetry();},5000);if(state.token)boot();else showLogin();
