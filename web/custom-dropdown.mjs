/* Native <select> remains the form source of truth; the popup is presentation.
   No framework, icon font or external CDN. Works with dynamically created forms. */
export function selectChoices(select) {
  return [...select.options].map((o,index)=>({index, value:o.value, label:o.textContent?.trim()||o.label||o.value, disabled:o.disabled||!!o.closest('optgroup[disabled]'), selected:o.selected}));
}
export function filterChoices(choices,query) {
  const term=String(query||'').trim().toLocaleLowerCase();
  return term ? choices.filter(o=>o.label.toLocaleLowerCase().includes(term)) : choices;
}
export function selectedLabel(choices,selectedIndex,placeholder='Выберите значение') {
  return choices.find(o=>o.index===selectedIndex)?.label||placeholder;
}
export function enhanceDropdowns(root=document){
  const controllers=new Set();
  let active=null,queued=false;
  const doc=root.ownerDocument||root;
  const dropArrow='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
  const stopCurrent=()=>{if(active){active.close();active=null;}};

  function enhance(select){
    if(select.dataset.nlDropdown==='yes'||select.multiple||select.size>1)return;
    const wrapper=doc.createElement('span');wrapper.className='nl-dropdown';
    const trigger=doc.createElement('button');trigger.type='button';trigger.className='nl-dropdown-trigger';trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');
    const label=doc.createElement('span');label.className='nl-dropdown-value';
    const arrow=doc.createElement('span');arrow.className='nl-dropdown-chevron';arrow.innerHTML=dropArrow;
    trigger.append(label,arrow);
    select.parentNode.insertBefore(wrapper,select);
    wrapper.append(select,trigger);select.classList.add('nl-dropdown-native');select.dataset.nlDropdown='yes';select.tabIndex=-1;
    // Do not set aria-hidden on the native control: it remains responsible for
    // required/form semantics and must be discoverable by assistive tech.
    const popup=doc.createElement('div');popup.className='nl-dropdown-popup';popup.hidden=true;
    const search=doc.createElement('input');search.type='search';search.className='nl-dropdown-search';search.placeholder='Поиск…';search.autocomplete='off';search.setAttribute('aria-label','Поиск в списке');
    const options=doc.createElement('div');options.className='nl-dropdown-options';options.setAttribute('role','listbox');
    popup.append(search,options);doc.body.append(popup);
    let highlighted=-1;let isOpen=false;
    function sync(){
      const choices=selectChoices(select);
      label.textContent=selectedLabel(choices,select.selectedIndex);
      trigger.disabled=select.disabled;
      trigger.title=label.textContent;
      trigger.classList.toggle('is-placeholder',select.selectedIndex<0);
      if(isOpen)paint();
    }
    function position(){
      if(!isOpen)return;
      const rect=trigger.getBoundingClientRect();
      const below=window.innerHeight-rect.bottom;
      const above=rect.top;
      const height=Math.min(300,Math.max(110,(Math.max(below,above)-10)));
      const opensUp=below<170&&above>below;
      popup.classList.toggle('is-up',opensUp);
      popup.style.width=`${Math.max(rect.width,185)}px`;
      popup.style.left=`${Math.min(Math.max(8,rect.left),Math.max(8,window.innerWidth-Math.max(rect.width,185)-8))}px`;
      popup.style.maxHeight=`${height}px`;
      popup.style.top=opensUp?'auto':`${rect.bottom+5}px`;
      popup.style.bottom=opensUp?`${window.innerHeight-rect.top+5}px`:'auto';
    }
    function pick(index){
      const choice=selectChoices(select).find(c=>c.index===index);
      if(!choice||choice.disabled)return;
      const changed=select.selectedIndex!==index;
      select.selectedIndex=index;
      if(changed){select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));}
      sync();close();trigger.focus();
    }
    function paint(){
      if(!isOpen)return;
      const choices=filterChoices(selectChoices(select),search.value);
      options.replaceChildren();
      if(!choices.length){const empty=doc.createElement('div');empty.className='nl-dropdown-empty';empty.textContent='Ничего не найдено';options.append(empty);return;}
      for(const choice of choices){
        const item=doc.createElement('button');item.type='button';item.className='nl-dropdown-option';item.setAttribute('role','option');item.dataset.index=String(choice.index);item.textContent=choice.label;
        item.disabled=choice.disabled;item.setAttribute('aria-selected',String(choice.index===select.selectedIndex));
        if(choice.index===highlighted)item.classList.add('is-highlighted');
        if(choice.index===select.selectedIndex)item.classList.add('is-selected');
        item.addEventListener('pointerdown',e=>e.preventDefault());
        item.addEventListener('click',()=>pick(choice.index));options.append(item);
      }
      options.querySelector('.is-highlighted')?.scrollIntoView({block:'nearest'});
    }
    function close(){isOpen=false;popup.hidden=true;popup.classList.remove('is-up');trigger.setAttribute('aria-expanded','false');trigger.classList.remove('is-open');if(active===api)active=null;}
    function open(){
      if(select.disabled)return;
      if(active&&active!==api)active.close();
      active=api;isOpen=true;search.value='';highlighted=select.selectedIndex;
      popup.hidden=false;trigger.setAttribute('aria-expanded','true');trigger.classList.add('is-open');
      const useSearch=select.options.length>=7;
      search.hidden=!useSearch;
      paint();position();
      if(useSearch)search.focus();
    }
    function step(direction,firstLast=false){
      const filtered=filterChoices(selectChoices(select),search.value).filter(o=>!o.disabled);
      if(!filtered.length)return;
      let idx=filtered.findIndex(o=>o.index===highlighted);
      idx=firstLast?(direction>0?0:filtered.length-1):(idx<0?0:Math.max(0,Math.min(filtered.length-1,idx+direction)));
      highlighted=filtered[idx].index;paint();
    }
    const onKey=e=>{
      if(e.key==='Escape'){if(isOpen){e.preventDefault();close();trigger.focus();}return;}
      if(e.key==='Tab'){close();return;}
      if(e.key==='ArrowDown'||e.key==='ArrowUp'||e.key==='Home'||e.key==='End'){
        e.preventDefault();if(!isOpen)open();step(e.key==='ArrowUp'||e.key==='End'?-1:1,e.key==='Home'||e.key==='End');return;
      }
      if(e.key==='Enter'||(e.key===' '&&e.target!==search)){
        e.preventDefault();if(!isOpen){open();return;}
        const first=filterChoices(selectChoices(select),search.value).find(c=>!c.disabled);
        pick(highlighted>=0?highlighted:first?.index);return;
      }
      if(e.target===trigger&&e.key.length===1&&!e.altKey&&!e.ctrlKey&&!e.metaKey){
        if(!isOpen)open();if(!search.hidden){search.value+=e.key;search.focus();paint();}return;
      }
    };
    trigger.addEventListener('click',()=>isOpen?close():open());
    trigger.addEventListener('keydown',onKey);popup.addEventListener('keydown',onKey);
    search.addEventListener('input',()=>{highlighted=-1;paint();});
    select.addEventListener('change',sync);
    select.addEventListener('invalid',()=>{trigger.focus();});
    const observer=new MutationObserver(sync);
    observer.observe(select,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','label','selected','value']});
    const api={node:wrapper,close,position,dispose:()=>{close();observer.disconnect();popup.remove();controllers.delete(api);}};
    controllers.add(api);sync();
  }
  function scan(){queued=false;
    for(const s of root.querySelectorAll('select:not([data-nl-dropdown])'))enhance(s);
    for(const item of [...controllers])if(!item.node.isConnected)item.dispose();
  }
  // Controller cleanup needs its original DOM node, rather than the popup.
  // Initial call and mutation scan are intentionally asynchronous to allow the
  // application to finish populating options before the native select is wrapped.
  const mutationObserver=new MutationObserver(()=>{if(!queued){queued=true;queueMicrotask(scan);}});
  mutationObserver.observe(root,{childList:true,subtree:true});
  scan();
  const outside=e=>{if(active&&!e.target.closest('.nl-dropdown, .nl-dropdown-popup'))stopCurrent();};
  const scrolling=e=>{if(active&&!e.target.closest('.nl-dropdown-popup'))active.close();};
  const resized=()=>active?.position();
  doc.addEventListener('pointerdown',outside,true);doc.addEventListener('scroll',scrolling,true);window.addEventListener('resize',resized);
  return ()=>{mutationObserver.disconnect();doc.removeEventListener('pointerdown',outside,true);doc.removeEventListener('scroll',scrolling,true);window.removeEventListener('resize',resized);for(const item of [...controllers])item.dispose();};
}
