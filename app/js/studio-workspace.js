import { mountDocumentImagesPicker } from './document-images-picker.js';
import { trackStudioReading } from './studio-scroll-tracking.js';
import { mountStudioPanelResize } from './studio-panel-resize.js';
import { mountStudioInspector } from './studio-inspector.js';
import { documentIcons, formatDocumentDate } from './documents-list.js';
import { escapeHtml as e } from './utils.js';
const svg = paths => '<svg viewBox="0 0 24 24" aria-hidden="true">' + paths + '</svg>';
export const studioIcons = {...documentIcons,
  back:svg('<path d="m14 5-7 7 7 7M7 12h14"/>'),
  section:svg('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
  booking:svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M12 13v5M9.5 15.5h5"/>'),
  shared:svg('<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5M14.5 11v7M11 14.5h7"/>'),
  minus:svg('<path d="M5 12h14"/>')};
function iconControl(element, icon, label) {
  if (!element) return;
  element.classList.add('studio-icon-button');
  element.innerHTML = studioIcons[icon];
  element.title = label; element.setAttribute('aria-label',label);
  if (['Add booking', 'Add shared content', 'Reload CRM', 'Open document preview'].includes(label)) {
    const text = document.createElement('span'); text.className = 'studio-action-label'; text.textContent = label;
    element.append(text);
  }
}
export function mountStudioWorkspace(dialog, group, doc, groups, state, response={}, {imagesAPI}={}) {
  const header=dialog.querySelector('.studio-header');
  iconControl(header.querySelector('[data-close]'),'back','Back to Documents');
  const title=header.querySelector('h1'); title.tabIndex=0;
  header.querySelector('.documents-eyebrow').textContent='Document Studio';
  const badge=document.createElement('span');badge.className='document-status';badge.textContent=doc.type;
  header.insertBefore(badge,header.querySelector('.document-status'));
  const preview=header.querySelector('a');iconControl(preview,'open','Open document preview');
  iconControl(header.querySelector('[data-add-booking]'),'booking','Add booking');
  iconControl(header.querySelector('[data-add-shared]'),'shared','Add shared content');
  const reload=[...header.querySelectorAll('button')].find(button=>button.textContent==='Reload CRM');
  iconControl(reload,'refresh','Reload CRM');
  const actions=document.createElement('div');actions.className='studio-header-actions';
  actions.append(preview,header.querySelector('.studio-import-actions'));
  if(reload)actions.append(reload);
  header.append(actions);
  const status=dialog.querySelector('.studio-save-status');
  header.querySelector('.studio-title').append(status);
  if(doc.updated_at && formatDocumentDate(doc.updated_at)!=='\u2014') {
    const updated=document.createElement('time');updated.className='studio-updated';updated.dateTime=doc.updated_at;updated.textContent='Updated '+formatDocumentDate(doc.updated_at);status.after(updated);
  }
  const outline=dialog.querySelector('.studio-outline');
  const heading=outline.querySelector('.studio-outline-heading');
  heading.innerHTML='Document Navigation <span>'+groups.length+'</span>';
  const tools=document.createElement('div');tools.className='studio-outline-tools';
  heading.replaceWith(tools);tools.append(heading);
  const searchWrap=document.createElement('div');searchWrap.className='studio-outline-search';searchWrap.innerHTML=studioIcons.search;
  const search=document.createElement('input');search.type='search';search.placeholder='Search sections';search.setAttribute('aria-label','Search document navigation');search.value=state.query||'';
  const clear=document.createElement('button');clear.type='button';clear.innerHTML=studioIcons.close;clear.title='Clear search';clear.setAttribute('aria-label','Clear search');searchWrap.append(search,clear);tools.append(searchWrap);
  const tree=document.createElement('div');tree.className='studio-outline-tree';for(const child of [...outline.children])if(child!==tools)tree.append(child);outline.append(tree);
  const noResults=document.createElement('p');noResults.className='studio-outline-empty';noResults.textContent='No matching sections.';tree.append(noResults);
  state.collapsed ||= {};
  const branches=[];
  for(const parent of tree.querySelectorAll('[data-outline-program],[data-outline-day],[data-outline-step]')){
    const list=parent.querySelector(':scope > ul,:scope > .studio-outline-days');if(!list)continue;
    const day=parent.hasAttribute('data-outline-day');
    const key=parent.hasAttribute('data-outline-program')?'program:'+parent.querySelector('[data-section-key]').dataset.sectionKey:day?'day:'+parent.dataset.outlineDay:'step:'+groups[Number(parent.querySelector('[data-section]').dataset.section)].key;
    const toggle=document.createElement('button');toggle.type='button';toggle.className='studio-branch-toggle';toggle.innerHTML=studioIcons.chevron;
    list.id='studio-branch-'+branches.length;toggle.setAttribute('aria-controls',list.id);
    const label=day?parent.querySelector('h3').textContent:parent.querySelector('[data-section]').title;
    if(day)parent.querySelector('h3').prepend(toggle);else{parent.classList.add('studio-has-children');parent.prepend(toggle);}
    const sync=()=>{const expanded=!!search.value.trim() || !state.collapsed[key];list.hidden=!expanded;toggle.disabled=!!search.value.trim();toggle.setAttribute('aria-expanded',String(expanded));toggle.title=(expanded?'Collapse ':'Expand ')+label;toggle.setAttribute('aria-label',toggle.title);};
    toggle.onclick=()=>{state.collapsed[key]=!state.collapsed[key];sync();};branches.push({key,parent,sync});
  }
  function filter(){
    state.query=search.value;clear.hidden=!state.query;const query=state.query.trim().toLowerCase();
    tree.querySelectorAll('[data-section]').forEach(button=>button.hidden=!!query && !String(groups[Number(button.dataset.section)].title||'').toLowerCase().includes(query));
    const program=tree.querySelector('[data-outline-program]');
    const programButton=program?.querySelector(':scope > [data-section]');
    const programMatch=!!query && programButton && !programButton.hidden;
    if(programMatch)program.querySelectorAll('[data-section]').forEach(button=>button.hidden=false);
    tree.querySelectorAll('[data-outline-day]').forEach(day=>{
      const dayMatch=query && (day.dataset.outlineDay+' '+day.querySelector('h3').textContent).toLowerCase().includes(query);
      if(dayMatch)day.querySelectorAll('[data-section]').forEach(button=>button.hidden=false);
      day.querySelectorAll('[data-outline-step]').forEach(step=>{
        const parent=step.querySelector(':scope > [data-section]');const services=[...step.querySelectorAll('.studio-outline-services [data-section]')];
        if(!parent.hidden)services.forEach(button=>button.hidden=false);
        if(services.some(button=>!button.hidden))parent.hidden=false;step.hidden=parent.hidden;
      });
      day.hidden=![...day.querySelectorAll('[data-section]')].some(button=>!button.hidden);
    });
    if(program){
      const hasChildren=[...program.querySelectorAll('[data-outline-day]')].some(day=>!day.hidden);
      if(hasChildren)programButton.hidden=false;
      program.hidden=programButton.hidden && !hasChildren;
    }
    branches.forEach(branch=>branch.sync());noResults.hidden=[...tree.querySelectorAll('[data-section]')].some(button=>!button.hidden);
  }
  search.addEventListener('input',filter);clear.onclick=()=>{search.value='';search.dispatchEvent(new Event('input'));search.focus();};filter();
  const selectedDay=state.navigationDay!==undefined?[...tree.querySelectorAll('[data-jump-day]')].find(button=>button.dataset.jumpDay===state.navigationDay):null;
  if(selectedDay){
    tree.querySelectorAll('[data-section].is-selected').forEach(button=>{button.classList.remove('is-selected');button.setAttribute('aria-current','false');});
    selectedDay.classList.add('is-selected');selectedDay.setAttribute('aria-current','true');
  }
  const selectedRow=tree.querySelector('[aria-current="true"]');
  const selectedProgram=selectedRow?.closest('[data-outline-program]');
  if(selectedProgram && selectedRow!==selectedProgram.querySelector(':scope > [data-section]'))selectedProgram.classList.add('parent-active');
  tree.revealSection=()=>{const row=tree.querySelector('[aria-current="true"]');if(!row)return;for(const branch of branches)if(branch.parent.contains(row)){delete state.collapsed[branch.key];branch.sync();}const bounds=tree.getBoundingClientRect(),rect=row.getBoundingClientRect();if(rect.top<bounds.top)tree.scrollTop+=rect.top-bounds.top;else if(rect.bottom>bounds.bottom)tree.scrollTop+=rect.bottom-bounds.bottom;};
  const inspector=dialog.querySelector('.studio-inspector');
  const stepCategory=String(group.crmRecords?.find(record=>record.module==='Booking_Steps')?.step_category||'').trim();
  const transferLabel=group.crmRecords?.find(record=>record.module==='Booking_Services')?.transfer_label||'';
  const sectionLabel=[inspector.querySelector('h2').textContent,stepCategory,transferLabel].filter(Boolean).join(' \u00b7 ');
  const properties=document.createElement('header');properties.className='studio-properties-heading';properties.innerHTML='<h2 tabindex="0">'+e(group.title||'Untitled section')+'</h2><small>'+studioIcons.section+'<span>'+e(sectionLabel)+'</span></small>';
  inspector.prepend(properties);
  const visibility=inspector.querySelector('[data-visible]').closest('.studio-visibility');properties.after(visibility);
  const note=document.createElement('p');note.className='studio-excluded-note';note.textContent='Not shown in this document. Content stays in the outline so you can restore it. CRM records are unchanged.';note.hidden=visibility.querySelector('input').checked;visibility.after(note);
  visibility.querySelector('input').addEventListener('input',()=>note.hidden=visibility.querySelector('input').checked);
  visibility.lastChild.textContent=' Include in document';visibility.querySelector('input').setAttribute('role','switch');
  const consequence=document.createElement('p');consequence.className='studio-inspector-help studio-visibility-consequence';
  consequence.textContent=group.service_id?'An excluded parent activity also excludes this service.':group.origin==='CRM'?'Excluding this activity also excludes its associated services.':group.type==='Shared_Content'?'Excluding this heading excludes the entire Workshop.':'';
  note.after(consequence);

  inspector.querySelectorAll(':scope > .documents-eyebrow,:scope > h2,:scope > .studio-hint').forEach(el=>el.remove());
  const editor=inspector.querySelector('.studio-section-editor');
  const live=!!group.crmRecords?.length;
  const contentLabel=document.createElement('h3');contentLabel.className='studio-group-label';contentLabel.textContent=live?'Booking data \u00b7 CRM':'Content';editor.prepend(contentLabel);if(editor.querySelector('#studio-block-body').hidden)editor.querySelector('.studio-body-label').hidden=true;
  if(live){editor.querySelector('.studio-field')?.remove();editor.querySelector('#studio-block-title').hidden=true;}
  const layout=document.createElement('section');layout.className='studio-display-group';
  let stopImagePicker=()=>{};
  const image=inspector.querySelector('[data-image]').closest('label');
  if(group.type!=='Cover'){
    layout.innerHTML='<h3 class="studio-group-label">Image</h3>';image.before(layout);layout.append(image);
    if(imagesAPI)stopImagePicker=mountDocumentImagesPicker(layout,image.querySelector('input'),{group,records:response.crm_records,api:imagesAPI});
  }
  const updateInspector=mountStudioInspector(inspector,{group,state});
  // Panels toggle in place: inputs and pending edits are never rebuilt.
  const panels=document.createElement('div');panels.className='studio-panel-switcher';panels.setAttribute('aria-label','Studio panels');
  panels.innerHTML=['outline','preview','properties'].map(name=>'<button type="button" data-studio-panel="'+name+'">'+name[0].toUpperCase()+name.slice(1)+'</button>').join('');
  header.after(panels);
  const setPanel=(name,remember=true)=>{state.scrolls ||= {}; if(remember)for(const selector of ['.studio-outline-tree','.studio-inspector-body','.studio-canvas']) {const el=dialog.querySelector(selector);if(el.clientHeight)state.scrolls[selector]=el.scrollTop;} state.panel=name;dialog.dataset.panel=name; for(const selector of ['.studio-outline-tree','.studio-inspector-body','.studio-canvas']) {const el=dialog.querySelector(selector);if(el.clientHeight)el.scrollTop=state.scrolls[selector]||0;}panels.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.studioPanel===name)));};
  panels.querySelectorAll('button').forEach(button=>button.onclick=()=>setPanel(button.dataset.studioPanel));setPanel(state.panel||'preview',false);
  const canvas=dialog.querySelector('.studio-canvas');
  const paper=canvas.querySelector('.studio-document-preview');
  const frame=document.createElement('div');frame.className='studio-preview-frame';paper.before(frame);frame.append(paper);
  let navigationTarget=null;
  // Retain the destination while images, fonts and panel sizing settle. Manual
  // scrolling releases it immediately; selection does not lock the reading position.
  const releaseNavigation=()=>{navigationTarget=null;};
  const releaseKey=event=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key))releaseNavigation();};
  canvas.addEventListener('wheel',releaseNavigation,{passive:true});
  canvas.addEventListener('touchstart',releaseNavigation,{passive:true});
  canvas.addEventListener('pointerdown',releaseNavigation);
  canvas.addEventListener('keydown',releaseKey);
  function alignNavigation(){
    if(!navigationTarget || !canvas.clientHeight)return;
    const find=key=>[...paper.querySelectorAll('[data-preview-key]')].find(el=>el.dataset.previewKey===key);
    let target=navigationTarget.day!==undefined?[...paper.querySelectorAll('[data-preview-day]')].find(el=>el.dataset.previewDay===navigationTarget.day):find(navigationTarget.key);
    if(!target){
      // Hidden services have no rendered node. Use their visible parent, then
      // the itinerary, instead of leaving an unrelated section on screen.
      const selectedGroup=groups.find(item=>item.key===navigationTarget.key);
      const parent=selectedGroup?.service_id && groups.find(item=>!item.service_id && item.step_id===selectedGroup.step_id && item.origin==='CRM');
      target=(parent && find(parent.key)) || find(groups.find(item=>item.type==='Itinerary')?.key);
    }
    if(!target)return;
    for(let ancestor=target;ancestor && ancestor!==paper;ancestor=ancestor.parentElement)if(ancestor.tagName==='DETAILS')ancestor.open=true;
    // Leave enough trailing room to align even the last short section.
    const remaining=paper.getBoundingClientRect().bottom-target.getBoundingClientRect().top;
    canvas.style.paddingBottom=Math.max(32,canvas.clientHeight-zoom.offsetHeight-remaining)+'px';
    const top=canvas.getBoundingClientRect().top+canvas.clientTop+zoom.offsetHeight;
    canvas.scrollTop+=target.getBoundingClientRect().top-top;
    state.scrolls ||= {};state.scrolls['.studio-canvas']=canvas.scrollTop;
  }
  let previewWidth=doc.type==='FID'?(state.previewDevice==='mobile'?390:1280):820;
  paper.style.width=previewWidth+'px';paper.style.transformOrigin='top left';
  const zoom=document.createElement('div');zoom.className='studio-zoom-toolbar';zoom.innerHTML='<button type="button" data-fit>Fit to width</button><button type="button" data-zoom-out aria-label="Zoom out" title="Zoom out">'+studioIcons.minus+'</button><output aria-label="Preview zoom"></output><button type="button" data-zoom-in aria-label="Zoom in" title="Zoom in">'+studioIcons.add+'</button>';
  canvas.prepend(zoom);
  if(doc.type==='FID') {
    const device=document.createElement('button');device.type='button';device.dataset.previewDevice='';
    const syncDevice=()=>{device.innerHTML=state.previewDevice==='mobile'?studioIcons.monitor:studioIcons.phone;device.title=state.previewDevice==='mobile'?'Switch to desktop preview':'Switch to mobile preview';device.setAttribute('aria-label',state.previewDevice==='mobile'?'Switch to desktop preview':'Switch to mobile preview');};
    device.onclick=()=>{state.previewDevice=state.previewDevice==='mobile'?'desktop':'mobile';previewWidth=state.previewDevice==='mobile'?390:1280;paper.style.width=previewWidth+'px';state.zoom=null;syncDevice();scale();};
    syncDevice();zoom.append(device);
  }
  function scale(){if(!canvas.clientWidth)return;const fit=Math.max(.1,(canvas.clientWidth-32)/previewWidth);const value=state.zoom??Math.min(1,fit);paper.style.transform='scale('+value+')';frame.style.width=(previewWidth*value)+'px';frame.style.height=(paper.scrollHeight*value)+'px';zoom.querySelector('output').value=Math.round(value*100)+'%';zoom.querySelector('[data-fit]').setAttribute('aria-pressed',String(state.zoom==null));alignNavigation();}
  const expand=document.createElement('button');expand.type='button';expand.dataset.expandPreview='';
  const syncExpanded=()=>{dialog.classList.toggle('studio-preview-expanded',!!state.expanded);expand.innerHTML=studioIcons.open;expand.title=state.expanded?'Show panels':'Expand preview';expand.setAttribute('aria-label',expand.title);expand.setAttribute('aria-pressed',String(!!state.expanded));};
  expand.onclick=()=>{state.expanded=!state.expanded;syncExpanded();scale();};
  zoom.append(expand);syncExpanded();
  zoom.querySelector('[data-fit]').onclick=()=>{state.zoom=null;scale();};
  for(const [selector,delta] of [['[data-zoom-out]',-.1],['[data-zoom-in]',.1]])zoom.querySelector(selector).onclick=()=>{state.zoom=Math.max(.25,Math.min(1.5,(state.zoom??parseFloat(zoom.querySelector('output').value)/100)+delta));scale();};
  const observer=new ResizeObserver(scale);observer.observe(canvas);observer.observe(paper);scale();
  const stopResizing=mountStudioPanelResize(dialog,state);
  const stopReading = trackStudioReading({canvas,paper,outline,toolbar:zoom,groups,state});
  // A fixed tooltip lives in the dialog's top layer, outside scrolling panels.
  const tip=document.createElement('div');tip.className='studio-tooltip';tip.id='studio-tooltip';tip.setAttribute('role','tooltip');tip.hidden=true;dialog.append(tip);
  let tipTarget=null, tipTitle='', tipDescription=null;
  const hide=()=>{
    tip.hidden=true;
    if(tipTarget){
      if(!tipTarget.hasAttribute('title'))tipTarget.setAttribute('title',tipTitle);
      tipTarget.removeAttribute('data-studio-tooltip-active');
      if(tipDescription===null)tipTarget.removeAttribute('aria-describedby');
      else tipTarget.setAttribute('aria-describedby',tipDescription);
      tipTarget=null;
    }
  };
  const allowsTooltip=target=>!!target.closest('.studio-outline') || target.matches('.studio-settings-help,[data-tooltip-help],.studio-image-filename') || (target.matches('button,a,[role=button]') && !!target.querySelector('svg') && !target.textContent.trim());
  // Remove native tooltips too: visible labels must not produce a second label.
  dialog.querySelectorAll('[title]').forEach(target=>{if(!allowsTooltip(target))target.removeAttribute('title');});
  const show=event=>{
    const target=event.target.closest('[title],[data-studio-tooltip-active]');
    if(target===tipTarget)return;
    hide();
    if(!target || !dialog.contains(target) || !target.getAttribute('title'))return;
    if(!allowsTooltip(target)){target.removeAttribute('title');return;}
    tipTarget=target;tipTitle=target.getAttribute('title');tipDescription=target.getAttribute('aria-describedby');
    // The widget tooltip replaces the native browser tooltip while it is open.
    target.removeAttribute('title');target.setAttribute('data-studio-tooltip-active','');
    tip.textContent=tipTitle;tip.hidden=false;
    target.setAttribute('aria-describedby',[tipDescription,tip.id].filter(Boolean).join(' '));
    const r=target.getBoundingClientRect();
    tip.style.left=Math.max(8,Math.min(r.left,innerWidth-tip.offsetWidth-8))+'px';
    tip.style.top=(r.bottom+tip.offsetHeight+10<innerHeight?r.bottom+6:Math.max(8,r.top-tip.offsetHeight-6))+'px';
  };
  dialog.addEventListener('focusin',show);dialog.addEventListener('pointerover',show);dialog.addEventListener('focusout',hide);dialog.addEventListener('pointerout',hide);dialog.addEventListener('scroll',hide,true);
  dialog.addEventListener('pointerdown',hide);window.addEventListener('resize',hide);
  const cleanup=()=>{stopImagePicker();hide();stopReading();stopResizing();observer.disconnect();dialog.removeEventListener('focusin',show);dialog.removeEventListener('pointerover',show);dialog.removeEventListener('focusout',hide);dialog.removeEventListener('pointerout',hide);dialog.removeEventListener('scroll',hide,true);dialog.removeEventListener('pointerdown',hide);window.removeEventListener('resize',hide);};
  cleanup.navigatePreview=(key,day)=>{navigationTarget={key,day};scale();};
  cleanup.updateInspector=updateInspector;
  return cleanup;
}
