import {VTBuffer} from './terminal-vt.mjs';

const esc=(id)=>encodeURIComponent(id);
const ic={terminal:'<path d="m4 7 5 5-5 5M12 17h8"/>',minus:'<path d="M4 12h16"/>',close:'<path d="M5 5l14 14M19 5L5 19"/>',maximize:'<rect x="4" y="4" width="16" height="16" rx="2"/>',connect:'<path d="M7 7a8 8 0 0 1 11-1M18 2v4h-4M17 17a8 8 0 0 1-11 1M6 22v-4h4"/>',grip:'<path d="M4 19h15V4M10 19l9-9M16 19l3-3"/>'};
const svg=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ic[name]}</svg>`;
export function keySequence(event){
 if(event.metaKey||event.altKey)return null;
 if(event.ctrlKey){const key=event.key?.toLowerCase();if(key?.length===1&&key>='a'&&key<='z')return String.fromCharCode(key.charCodeAt(0)-96);if(key==='[')return '\x1b';if(key==='\\')return '\x1c';return null;}
 const named={Enter:'\r',Backspace:'\x7f',Tab:'\t',Escape:'\x1b',ArrowUp:'\x1b[A',ArrowDown:'\x1b[B',ArrowRight:'\x1b[C',ArrowLeft:'\x1b[D',Home:'\x1b[H',End:'\x1b[F',Delete:'\x1b[3~',PageUp:'\x1b[5~',PageDown:'\x1b[6~'};
 if(Object.hasOwn(named,event.key))return named[event.key];
 if(event.key?.length===1)return event.key;
 return null;
}
export class ConsoleWorkspace {
 constructor(root,{getToken,notify=()=>{}}){
  this.root=root;this.getToken=getToken;this.notify=notify;this.tabs=new Map();this.active=null;this.minimized=false;this.maximized=false;
  this.win=root.querySelector('#consoleWindow');this.tabBar=root.querySelector('#consoleTabs');this.output=root.querySelector('#consoleOutput');this.input=root.querySelector('#consoleKeyInput');this.status=root.querySelector('#consoleStatus');this.title=root.querySelector('#consoleTitle');this.dock=root.querySelector('#consoleRestore');
  this.initControls();
 }
 key(lab,node){return `${lab}:${node}`;}
 open({lab,node,name,engine='qemu'}){
  const key=this.key(lab,node);
  if(!this.tabs.has(key)){
   if(this.tabs.size>=12){this.notify('Открыто максимально допустимое число консолей (12)',true);return;}
   const tab={key,lab,node,name,engine,term:new VTBuffer(),cursor:0,decoder:new TextDecoder('utf-8'),abort:new AbortController(),status:'connecting',error:'',pending:'',sendTimer:null,closed:false,started:false,unread:false};
   this.tabs.set(key,tab);this.stream(tab);
  }else{
   this.tabs.get(key).name=name;
  }
  this.active=key;this.minimized=false;this.root.classList.remove('hidden','minimized');this.renderTabs();this.renderOutput();this.input.focus({preventScroll:true});
 }
 closeTab(key=this.active){const tab=this.tabs.get(key);if(!tab)return;tab.closed=true;tab.abort.abort();clearTimeout(tab.sendTimer);this.tabs.delete(key);
  if(this.active===key)this.active=this.tabs.keys().next().value||null;
  if(!this.tabs.size){this.closeAll();return;}
  this.renderTabs();this.renderOutput();
 }
 closeAll(){for(const tab of this.tabs.values()){tab.closed=true;tab.abort.abort();clearTimeout(tab.sendTimer);}this.tabs.clear();this.active=null;this.root.classList.add('hidden');this.root.classList.remove('minimized');}
 select(key){if(!this.tabs.has(key))return;this.active=key;this.tabs.get(key).unread=false;this.minimized=false;this.root.classList.remove('minimized');this.renderTabs();this.renderOutput();this.input.focus({preventScroll:true});}
 minimize(){this.minimized=true;this.root.classList.add('minimized');this.dock.focus({preventScroll:true});}
 restore(){this.minimized=false;this.root.classList.remove('minimized');this.input.focus({preventScroll:true});this.renderOutput();}
 toggleMaximize(){this.maximized=!this.maximized;this.root.classList.toggle('maximized',this.maximized);this.root.querySelector('#consoleMaximize').title=this.maximized?'Вернуть размер':'Развернуть';}
 renderTabs(){this.tabBar.replaceChildren();
  for(const tab of this.tabs.values()){
   const item=document.createElement('div');item.className='console-tab'+(tab.key===this.active?' is-active':'');item.setAttribute('role','presentation');
   const button=document.createElement('button');button.type='button';button.className='console-tab-select';button.setAttribute('role','tab');button.setAttribute('aria-selected',String(tab.key===this.active));button.title=tab.name;
   const dot=document.createElement('span');dot.className='console-tab-dot '+(tab.status==='online'?'online':tab.status==='offline'?'offline':'connecting');
   const label=document.createElement('span');label.className='console-tab-name';label.textContent=tab.name;
   button.append(dot,label);if(tab.unread){const unread=document.createElement('span');unread.className='console-tab-unread';button.append(unread);}
   button.onclick=()=>this.select(tab.key);
   const close=document.createElement('button');close.type='button';close.className='console-tab-close';close.innerHTML=svg('close');close.title=`Закрыть вкладку ${tab.name}`;close.setAttribute('aria-label',`Закрыть вкладку ${tab.name}`);close.onclick=()=>this.closeTab(tab.key);
   item.append(button,close);this.tabBar.append(item);
  }
  this.root.querySelector('#consoleTabCount').textContent=String(this.tabs.size);
 }
 renderOutput(){const tab=this.tabs.get(this.active);if(!tab)return;
  this.title.textContent=tab.name;
  this.output.innerHTML=tab.term.toHTML();
  this.output.parentElement.scrollTop=this.output.parentElement.scrollHeight;
  this.renderStatus();
 }
 renderStatus(){const tab=this.tabs.get(this.active);if(!tab)return;this.status.textContent=tab.status==='online'?`${tab.engine==='vpcs'?'VPCS':'Serial'} · соединение активно`:tab.status==='connecting'?'Подключение к консоли…':`Ожидание сервера: ${tab.error||'нет соединения'}`;
  this.status.className='console-connection '+tab.status;
 }
 onOutput(tab,chunk){tab.term.write(chunk);if(tab.key===this.active&&!this.minimized){const parent=this.output.parentElement;const follow=parent.scrollHeight-parent.scrollTop-parent.clientHeight<90;
   // Coalesce bursts of terminal output in one animation frame.
   if(!tab.paintPending){tab.paintPending=true;requestAnimationFrame(()=>{tab.paintPending=false;if(tab.key!==this.active||this.minimized)return;this.output.innerHTML=tab.term.toHTML();if(follow)parent.scrollTop=parent.scrollHeight;});}
  }else{tab.unread=true;this.renderTabs();}}
 async stream(tab){if(tab.started)return;tab.started=true;
  let delay=700;
  while(!tab.closed){try{
   tab.status='connecting';this.renderTabs();if(this.active===tab.key)this.renderStatus();
   const url=`/api/labs/${esc(tab.lab)}/nodes/${esc(tab.node)}/console/stream?cursor=${tab.cursor}`;
   const response=await fetch(url,{headers:{Authorization:`Bearer ${this.getToken()}`},signal:tab.abort.signal,cache:'no-store'});
   if(!response.ok){let errorText=`HTTP ${response.status}`;try{const body=await response.json();errorText=body.error||errorText;}catch{}throw Error(errorText);}
   tab.status='online';tab.error='';delay=700;this.renderTabs();if(this.active===tab.key)this.renderStatus();
   const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
   while(!tab.closed){const {value,done}=await reader.read();if(done)throw Error('поток завершён');buffer+=decoder.decode(value,{stream:true});
    let end;while((end=buffer.indexOf('\n\n'))!==-1){const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);this.eventFrame(tab,frame);}
    if(buffer.length>512*1024)throw Error('слишком большой ответ консоли');
   }
  }catch(error){if(tab.closed||tab.abort.signal.aborted)break;tab.status='offline';tab.error=error.message||'связь потеряна';this.renderTabs();if(this.active===tab.key)this.renderStatus();}
   await new Promise(resolve=>setTimeout(resolve,delay));delay=Math.min(8000,Math.ceil(delay*1.7));
  }
 }
 eventFrame(tab,frame){const lines=frame.split('\n');const type=lines.find(s=>s.startsWith('event:'))?.slice(6).trim();if(type==='closed'){tab.status='offline';return;}
  if(type!=='output')return;const json=lines.find(s=>s.startsWith('data:'))?.slice(5).trim();if(!json)return;
  try{const payload=JSON.parse(json);if(payload.reset){tab.term.reset();tab.decoder=new TextDecoder('utf-8');}
    tab.cursor=payload.cursor;
    if(payload.chunk){const binary=atob(payload.chunk);const array=Uint8Array.from(binary,c=>c.charCodeAt(0));this.onOutput(tab,tab.decoder.decode(array,{stream:true}));}
  }catch(error){tab.error='повреждённый блок терминала';}
 }
 send(sequence){const tab=this.tabs.get(this.active);if(!tab||tab.closed||!sequence)return;
  tab.pending+=sequence;if(tab.pending.length>4096)tab.pending=tab.pending.slice(0,4096);
  if(!tab.sendTimer)tab.sendTimer=setTimeout(()=>this.flush(tab),18);
 }
 async flush(tab){clearTimeout(tab.sendTimer);tab.sendTimer=null;if(!tab.pending||tab.closed)return;
  const text=tab.pending;tab.pending='';
  // Guarantee key order even if a prior POST is still in flight.
  tab.sendChain=(tab.sendChain||Promise.resolve()).then(async()=>{
   const response=await fetch(`/api/labs/${esc(tab.lab)}/nodes/${esc(tab.node)}/console`,{method:'POST',headers:{Authorization:`Bearer ${this.getToken()}`,'Content-Type':'application/json'},body:JSON.stringify({text})});
   if(!response.ok)throw Error(`ввод: HTTP ${response.status}`);
  }).catch(error=>{tab.status='offline';tab.error=error.message;if(tab.key===this.active)this.renderStatus();});
 }
 initControls(){
  this.root.querySelector('#consoleCloseAll').onclick=()=>this.closeAll();
  this.root.querySelector('#consoleMinimize').onclick=()=>this.minimize();
  this.root.querySelector('#consoleMaximize').onclick=()=>this.toggleMaximize();
  this.dock.onclick=()=>this.restore();
  this.root.querySelector('#consoleReconnect').onclick=()=>{const tab=this.tabs.get(this.active);if(!tab)return;this.closeTab(tab.key);this.open({lab:tab.lab,node:tab.node,name:tab.name,engine:tab.engine});};
  const screen=this.root.querySelector('#consoleScreen');screen.addEventListener('click',()=>{if(window.getSelection()?.toString())return;this.input.focus({preventScroll:true});});
  this.input.addEventListener('keydown',event=>{
   if(event.ctrlKey&&event.key==='Tab'){event.preventDefault();const keys=[...this.tabs.keys()];const idx=keys.indexOf(this.active);this.select(keys[(idx+(event.shiftKey?-1:1)+keys.length)%keys.length]);return;}
   if(event.ctrlKey&&event.key.toLowerCase()==='c'&&window.getSelection()?.toString())return;
   if(event.ctrlKey&&(event.key.toLowerCase()==='v'||event.key.toLowerCase()==='a'))return;
   const sequence=keySequence(event);if(sequence!==null){event.preventDefault();this.send(sequence);}
  });
  this.input.addEventListener('paste',event=>{event.preventDefault();const text=event.clipboardData?.getData('text/plain');if(text)this.send(text.replace(/\r?\n/g,'\r'));});
  this.input.addEventListener('input',event=>{if(event.isComposing)return;if(this.input.value){this.send(this.input.value);this.input.value='';}});
  this.input.addEventListener('compositionend',()=>{if(this.input.value){this.send(this.input.value);this.input.value='';}});
  // Header dragging (title, not tabs or window buttons), clamped into viewport.
  const handle=this.root.querySelector('#consoleDrag');let drag=null;
  handle.addEventListener('pointerdown',event=>{if(event.button!==0||this.maximized||event.target.closest('button'))return;const r=this.win.getBoundingClientRect();drag={id:event.pointerId,startX:event.clientX,startY:event.clientY,left:r.left,top:r.top};handle.setPointerCapture(event.pointerId);this.win.classList.add('is-dragging');event.preventDefault();});
  handle.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.id)return;const left=Math.max(0,Math.min(window.innerWidth-100,drag.left+event.clientX-drag.startX)),top=Math.max(0,Math.min(window.innerHeight-56,drag.top+event.clientY-drag.startY));this.win.style.left=`${left}px`;this.win.style.top=`${top}px`;this.win.style.right='auto';this.win.style.bottom='auto';});
  const finish=event=>{if(!drag||event.pointerId!==drag.id)return;drag=null;this.win.classList.remove('is-dragging');if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);};
  handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);
 }
}
