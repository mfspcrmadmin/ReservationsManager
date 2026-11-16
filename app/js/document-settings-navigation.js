// Settings-only presentation: original selects/checkboxes remain the source of saved values.
export function mountSettingsNavigation(modal,body,header,footer,hideHelp) {
  const form=modal.querySelector('form');
  const rules=[...body.querySelectorAll(':scope > .studio-document-rules')];
  const dates=rules.find(el=>el.querySelector('[data-output-date-example]'));
  const steps=rules.find(el=>el.querySelector('.studio-rule-row'));
  const tabs=document.createElement('nav');tabs.className='settings-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Document settings');
  const general=document.createElement('div');general.className='settings-general-grid';
  for(const child of [...body.children])if(child!==dates&&child!==steps)general.append(child);
  const definitions=[['general','General','<path d="M4 7h16M4 17h16M8 4v6M16 14v6"/>',general],['dates','Dates & times','<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M4 11h16"/>',dates],['steps','Steps & contacts','<path d="M9 5h11M9 12h11M9 19h11"/><circle cx="4" cy="5" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="19" r="1"/>',steps]];
  const panels=[];
  for(const [key,label,icon,content] of definitions){
    const button=document.createElement('button');button.type='button';button.id='settings-tab-'+key;button.setAttribute('role','tab');button.dataset.settingsTab=key;button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+icon+'</svg><span>'+label+'</span>';
    const panel=document.createElement('section');panel.id='settings-panel-'+key;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',button.id);button.setAttribute('aria-controls',panel.id);panel.className='settings-tab-panel';panel.append(content);body.append(panel);tabs.append(button);panels.push({button,panel,scroll:0});
  }
  let selected=null;
  const activate=(entry,focus=false)=>{
    if(selected)selected.scroll=body.scrollTop;hideHelp();selected=entry;
    for(const item of panels){const active=item===entry;item.panel.hidden=!active;item.button.setAttribute('aria-selected',String(active));item.button.tabIndex=active?0:-1;}
    body.scrollTop=entry.scroll;if(focus)entry.button.focus();
  };
  panels.forEach((entry,index)=>{entry.button.onclick=()=>activate(entry);entry.button.onkeydown=event=>{let next;if(event.key==='ArrowRight')next=(index+1)%panels.length;if(event.key==='ArrowLeft')next=(index+panels.length-1)%panels.length;if(event.key==='Home')next=0;if(event.key==='End')next=panels.length-1;if(next!==undefined){event.preventDefault();activate(panels[next],true);}};});
  header.after(tabs);activate(panels[0]);
  // Reveal invalid fields even when their tab is not active.
  form.addEventListener('invalid',event=>{const entry=panels.find(item=>item.panel.contains(event.target));if(entry&&entry!==selected)activate(entry);},true);
  const apply=footer.querySelector('[data-apply-document-rules]'),actions=footer.querySelector('.document-create-actions');
  const applyGroup=document.createElement('div');applyGroup.className='settings-apply-group';
  const consequence=document.createElement('small');consequence.textContent='Replaces individual visibility and contact overrides.';
  applyGroup.append(apply,consequence);actions.prepend(applyGroup);

  const select=steps.querySelector('select[data-settings-navigation]'),mobile=select.closest('label');mobile.classList.add('settings-category-mobile');
  const layout=document.createElement('div');layout.className='settings-categories-layout';
  const sidebar=document.createElement('aside');sidebar.className='settings-category-sidebar';sidebar.setAttribute('aria-label','Step categories');
  const search=document.createElement('input');search.type='search';search.placeholder='Search categories';search.setAttribute('aria-label','Search step categories');search.dataset.settingsNavigation='';
  const list=document.createElement('div');list.className='settings-category-list';
  const empty=document.createElement('p');empty.textContent='No matching categories.';empty.hidden=true;
  sidebar.append(search,list,empty);const editor=document.createElement('div');editor.className='settings-category-editor';
  const rows=[...steps.querySelectorAll('.studio-rule-row')];editor.append(...rows);layout.append(sidebar,editor);steps.append(layout);
  const categoryButtons=[];
  for(const option of select.options){
    const button=document.createElement('button');button.type='button';button.textContent=option.textContent;button.title=option.textContent;button.dataset.category=option.value;
    button.onclick=()=>{select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));hideHelp();};
    list.append(button);categoryButtons.push(button);
  }
  const syncCategory=()=>categoryButtons.forEach(button=>{const active=button.dataset.category===select.value;button.setAttribute('aria-pressed',String(active));});select.addEventListener('change',syncCategory);syncCategory();
  search.onkeydown=event=>{if(event.key==='Enter')event.preventDefault();};
  search.oninput=()=>{const query=search.value.trim().toLowerCase();categoryButtons.forEach(button=>button.hidden=!button.textContent.toLowerCase().includes(query));empty.hidden=categoryButtons.some(button=>!button.hidden);};
  list.onkeydown=event=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;const buttons=categoryButtons.filter(button=>!button.hidden&&!button.disabled),index=buttons.indexOf(document.activeElement);if(index<0)return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:buttons.length-1))%buttons.length;buttons[next].focus();};
  for(const row of rows){
    const step=row.querySelector('select[aria-label="Show step"]'),label=step.closest('label');
    const heading=document.createElement('h5');heading.textContent='Visibility';heading.className='settings-group-heading';label.before(heading);
    const original=document.createElement('span');original.hidden=true;step.before(original);original.append(step);
    const toggle=document.createElement('input');toggle.type='checkbox';toggle.id='settings-step-switch-'+rows.indexOf(row);label.htmlFor=toggle.id;toggle.setAttribute('role','switch');toggle.setAttribute('aria-label','Show step');toggle.checked=step.value==='shown';toggle.dataset.settingsNavigation='';
    const state=document.createElement('span');state.className='settings-switch-state';state.textContent=toggle.checked?'Shown':'Hidden';label.classList.add('settings-step-switch');label.append(toggle,state);
    toggle.onchange=()=>{step.value=toggle.checked?'shown':'hidden';step.dispatchEvent(new Event('change',{bubbles:true}));state.textContent=toggle.checked?'Shown':'Hidden';};
    step.addEventListener('change',()=>{toggle.checked=step.value==='shown';state.textContent=toggle.checked?'Shown':'Hidden';});
    const contacts=row.querySelector('.document-settings-contact-grid'),contactHeading=document.createElement('h5');contactHeading.textContent='Contacts';contactHeading.className='settings-group-heading';contacts.before(contactHeading);
    const multi=[...row.querySelectorAll('.studio-rule-categories')].find(el=>el.querySelector('legend')?.textContent==='Supplier subcategories');
    const toolbar=document.createElement('div');toolbar.className='settings-multi-toolbar';
    const filter=document.createElement('input');filter.type='search';filter.placeholder='Search subcategories';filter.setAttribute('aria-label','Search supplier subcategories');filter.dataset.settingsNavigation='';
    const count=document.createElement('span');count.setAttribute('role','status');toolbar.append(filter,count);
    const options=document.createElement('div');options.className='settings-multi-options';const labels=[...multi.querySelectorAll('label')];options.append(...labels);
    const noMatches=document.createElement('p');noMatches.textContent='No matching subcategories.';noMatches.hidden=true;
    multi.append(toolbar,options,noMatches);multi.classList.add('settings-multi');
    const syncCount=()=>count.textContent=labels.filter(label=>label.querySelector('input').checked).length+' / '+labels.length+' selected';multi.addEventListener('change',syncCount);syncCount();
    filter.onkeydown=event=>{if(event.key==='Enter')event.preventDefault();};
    filter.oninput=()=>{const query=filter.value.trim().toLowerCase();labels.forEach(label=>label.hidden=!label.textContent.toLowerCase().includes(query));noMatches.hidden=labels.some(label=>!label.hidden);};
  }
}
