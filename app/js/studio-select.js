// Presentation adapter: the original select owns values, validation and events.
const scope='.document-studio select,.document-settings-dialog select,.document-import-dialog select';
let started=false,serial=0,frame=0;
const controls=new Map();
const set=(node,key,value)=>{if(node.getAttribute(key)!==String(value))node.setAttribute(key,String(value));};
const normalized=text=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function initStudioSelects() {
  if(started || !HTMLElement.prototype.showPopover)return;
  started=true;
  function scan(){
    document.querySelectorAll(scope).forEach(select=>{
      if(!controls.has(select))controls.set(select,enhance(select));
    });
    if(controls.size && !frame)frame=requestAnimationFrame(tick);
  }
  function tick(){
    frame=0;
    for(const [select,control] of controls){
      if(!select.isConnected){control.destroy();controls.delete(select);}
      else control.sync();
    }
    if(controls.size)frame=requestAnimationFrame(tick);
  }
  new MutationObserver(scan).observe(document.body,{childList:true,subtree:true});
  scan();
}
function enhance(select) {
  const id='studio-select-'+(++serial);
  const trigger=document.createElement('button');
  trigger.type='button';trigger.className='studio-select-trigger';trigger.id=id;
  trigger.innerHTML='<span class="studio-select-value"></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  const caption=trigger.firstElementChild;
  set(trigger,'role','combobox');set(trigger,'aria-haspopup','listbox');set(trigger,'aria-expanded',false);
  const menu=document.createElement('div');
  menu.className='studio-select-menu';menu.setAttribute('popover','auto');
  menu.innerHTML='<input class="studio-select-search" type="search" placeholder="Search options" aria-label="Search options" autocomplete="off"><div class="studio-select-options" role="listbox"></div><p class="studio-select-empty" role="status"></p>';
  const search=menu.firstElementChild,list=menu.children[1],status=menu.lastElementChild;
  list.id=id+'-options';set(trigger,'aria-controls',list.id);
  select.before(trigger);
  const error=document.createElement('span');
  error.id=id+'-error';error.className='studio-select-error';error.hidden=true;
  set(error,'aria-live','assertive');select.after(error);
  (select.closest('dialog')||document.body).append(menu);
  const originalTab=select.getAttribute('tabindex');
  const originalAria=select.getAttribute('aria-hidden');
  select.classList.add('studio-select-native');select.tabIndex=-1;set(select,'aria-hidden',true);
  let signature='',opened=false,typeahead='',lastKey=0;
  const label=()=>{
    if(select.getAttribute('aria-label'))return select.getAttribute('aria-label');
    if(select.getAttribute('aria-labelledby'))return select.getAttribute('aria-labelledby').split(/\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' ').trim();
    return [...(select.labels||[])].map(l=>{
      const copy=l.cloneNode(true);
      copy.querySelectorAll('select,button,svg,input,textarea,.studio-select-menu,.studio-select-error').forEach(n=>n.remove());
      return copy.textContent.trim();
    }).join(' ')||select.name||'Choose an option';
  };
  const rows=()=>[...list.querySelectorAll('[role=option]:not(:disabled)')];
  const focusRow=(row)=>{if(!row)return;rows().forEach(r=>r.tabIndex=r===row?0:-1);row.focus({preventScroll:true});row.scrollIntoView({block:'nearest'});};
  const position=()=>{
    if(!opened)return;
    const r=trigger.getBoundingClientRect(),width=Math.min(Math.max(r.width,220),innerWidth-16);
    menu.style.width=width+'px';
    menu.style.left=Math.max(8,Math.min(r.left,innerWidth-width-8))+'px';
    const below=innerHeight-r.bottom-12,above=r.top-12,up=below<280 && above>below;
    menu.style.maxHeight=Math.max(48,Math.min(360,up?above:below))+'px';
    menu.style.top=Math.max(8,up?r.top-menu.offsetHeight-4:r.bottom+4)+'px';
  };
  const close=(restore=false)=>{if(menu.matches(':popover-open'))menu.hidePopover();opened=false;set(trigger,'aria-expanded',false);if(restore&&trigger.isConnected)trigger.focus({preventScroll:true});};
  const render=()=>{
    const activeIndex=document.activeElement?.dataset?.optionIndex;
    list.replaceChildren();
    set(list,'aria-label',label());set(list,'aria-multiselectable',select.multiple);
    let group=null;
    [...select.options].forEach((option,index)=>{
      if(option.hidden || option.parentElement.hidden || !normalized(option.textContent).includes(normalized(search.value.trim())))return;
      if(option.parentElement.tagName==='OPTGROUP' && group!==option.parentElement){
        group=option.parentElement;const heading=document.createElement('div');heading.className='studio-select-group';heading.textContent=group.label;list.append(heading);
      }
      const row=document.createElement('button');row.type='button';row.className='studio-select-option';row.tabIndex=-1;
      row.dataset.optionIndex=index;set(row,'role','option');set(row,'aria-selected',option.selected);
      row.disabled=option.disabled || !!option.closest('optgroup:disabled');
      const text=document.createElement('span');text.textContent=option.label;
      const check=document.createElement('span');check.className='studio-select-check';check.textContent=option.selected?'\u2713':'';set(check,'aria-hidden',true);row.append(text,check);
      row.onclick=()=>{
        if(select.matches(':disabled') || row.disabled)return;
        const changed=select.multiple || !option.selected;
        if(select.multiple)option.selected=!option.selected;else select.selectedIndex=index;
        if(!select.multiple)close(true);
        if(changed){select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));}
        sync();
        if(opened){render();focusRow(list.querySelector('[data-option-index="'+index+'"]'));}
      };
      list.append(row);
    });
    status.textContent=list.querySelector('[role=option]')?'':'No matching options.';
    if(activeIndex!==undefined)focusRow(list.querySelector('[data-option-index="'+activeIndex+'"]'));
    position();
  };
  function sync(){
    const hidden=select.hidden;
    trigger.hidden=hidden;
    trigger.disabled=select.matches(':disabled');
    set(trigger,'aria-busy',select.getAttribute('aria-busy')==='true');
    set(trigger,'aria-required',select.required);
    const description=select.getAttribute('aria-describedby');
    const descriptions=[description,!error.hidden?error.id:null].filter(Boolean).join(' ');
    if(descriptions)set(trigger,'aria-describedby',descriptions);else trigger.removeAttribute('aria-describedby');
    const value=[...select.selectedOptions].map(o=>o.label).join(', ')||'Choose an option';
    if(caption.textContent!==value)caption.textContent=value;
    set(trigger,'aria-label',label()+': '+value);
    if(opened && (hidden || trigger.disabled || !trigger.getClientRects().length || trigger.closest('[hidden]') || (select.closest('dialog')&&!select.closest('dialog').open)))close();
    const next=JSON.stringify([select.multiple,[...select.options].map(o=>[o.value,o.label,o.selected,o.disabled,o.hidden,o.parentElement.disabled,o.parentElement.hidden,o.parentElement.label])]);
    if(next!==signature){signature=next;if(opened){search.hidden=select.options.length<=8;if(search.hidden)search.value='';render();}}
    if(select.validity.valid){trigger.removeAttribute('aria-invalid');error.hidden=true;error.textContent='';}
    else if(!error.hidden)error.textContent=select.validationMessage;
  }
  const open=(keyboard=false)=>{
    sync();if(trigger.disabled||trigger.hidden)return;
    search.value='';search.hidden=select.options.length<=8;
    if(menu.parentElement!==select.closest('dialog') && select.closest('dialog'))select.closest('dialog').append(menu);
    menu.showPopover();opened=true;set(trigger,'aria-expanded',true);render();
    if(!search.hidden)search.focus();else if(keyboard)focusRow(list.querySelector('[aria-selected=true]:not(:disabled)')||rows()[0]);
  };
  trigger.onclick=()=>opened?close():open(true);
  trigger.onkeydown=event=>{
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();open(true);if(event.key==='End')focusRow(rows().at(-1));if(event.key==='Home')focusRow(rows()[0]);
    }else if(event.key.length===1 && !event.ctrlKey && !event.metaKey && event.key!==' '){open(true);if(!search.hidden){search.value=event.key;render();}else typeKey(event);}
  };
  function typeKey(event){
    if(event.key.length!==1||event.ctrlKey||event.metaKey)return;
    typeahead=Date.now()-lastKey<700?typeahead+event.key:event.key;lastKey=Date.now();
    focusRow(rows().find(r=>normalized(r.firstChild.textContent).startsWith(normalized(typeahead))));
  }
  menu.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);return;}
    if(event.key==='Tab'){close(true);return;}
    const available=rows(),index=available.indexOf(document.activeElement);
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key) && !(event.target===search&&['Home','End'].includes(event.key))){
      event.preventDefault();
      const nextIndex=index<0?(event.key==='ArrowUp'?available.length-1:0):(index+(event.key==='ArrowUp'?-1:1)+available.length)%available.length;
      focusRow(event.key==='Home'?available[0]:event.key==='End'?available.at(-1):available[nextIndex]);
    }else if(event.target!==search)typeKey(event);
  });
  search.oninput=render;
  menu.addEventListener('toggle',()=>{opened=menu.matches(':popover-open');set(trigger,'aria-expanded',opened);});
  const scroll=event=>{if(opened&&!menu.contains(event.target))close();};
  const forwardFocus=()=>trigger.focus({preventScroll:true});
  const invalid=event=>{event.preventDefault();set(trigger,'aria-invalid',true);error.textContent=select.validationMessage;error.hidden=false;sync();trigger.focus();};
  select.addEventListener('focus',forwardFocus);select.addEventListener('invalid',invalid);
  window.addEventListener('resize',position);document.addEventListener('scroll',scroll,true);
  sync();
  return {sync,destroy(){
    close();menu.remove();trigger.remove();error.remove();select.classList.remove('studio-select-native');
    for(const [attr,value] of [['tabindex',originalTab],['aria-hidden',originalAria]])value===null?select.removeAttribute(attr):select.setAttribute(attr,value);
    select.removeEventListener('focus',forwardFocus);select.removeEventListener('invalid',invalid);
    window.removeEventListener('resize',position);document.removeEventListener('scroll',scroll,true);
  }};
}
