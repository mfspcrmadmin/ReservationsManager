import { mountSettingsNavigation } from './document-settings-navigation.js';
// Move existing controls: values, validation and save handlers retain their owners.
export function layoutDocumentSettings(modal) {
  const form=modal.querySelector('form'),heading=form.querySelector('h2'),actions=form.querySelector('.document-create-actions'),status=form.querySelector('[data-status]');
  const header=document.createElement('header');header.className='document-settings-header';
  const close=document.createElement('button');close.type='button';close.className='button tertiary studio-icon-button';close.dataset.settingsClose='';close.title='Close';close.setAttribute('aria-label','Close');close.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';header.append(heading,close);
  const body=document.createElement('div');body.className='document-settings-body';body.tabIndex=-1;
  const footer=document.createElement('footer');footer.className='document-settings-footer';footer.append(status,actions);
  body.append(...form.childNodes);form.append(header,body,footer);
  const helps=[];
  function help(anchor,text,label) {
    const button=document.createElement('button');button.type='button';button.className='studio-settings-help';button.setAttribute('aria-label','Help: '+label);button.textContent='i';
    const popup=document.createElement('div');popup.className='studio-settings-help-popup';popup.setAttribute('popover','auto');popup.id='settings-help-'+helps.length;popup.setAttribute('role','tooltip');popup.textContent=text;
    button.setAttribute('aria-describedby',popup.id);button.setAttribute('aria-controls',popup.id);button.setAttribute('aria-expanded','false');anchor.append(button);modal.append(popup);
    let pinned=false,timer;
    const hide=()=>{clearTimeout(timer);pinned=false;if(popup.matches(':popover-open'))popup.hidePopover();};
    const show=()=>{clearTimeout(timer);if(button.disabled)return;if(!popup.matches(':popover-open'))popup.showPopover();const r=button.getBoundingClientRect();popup.style.left=Math.max(8,Math.min(r.left,innerWidth-popup.offsetWidth-8))+'px';popup.style.top=Math.max(8,r.bottom+8+popup.offsetHeight>innerHeight?r.top-popup.offsetHeight-8:r.bottom+8)+'px';};
    const later=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(!pinned&&document.activeElement!==button&&!popup.matches(':hover'))hide();},150);};
    button.onpointerenter=show;button.onpointerleave=later;button.onfocus=show;button.onblur=later;popup.onpointerenter=()=>clearTimeout(timer);popup.onpointerleave=later;
    button.onclick=event=>{event.preventDefault();if(pinned){hide();button.blur();}else{show();pinned=true;}};
    popup.addEventListener('toggle',()=>{const open=popup.matches(':popover-open');button.setAttribute('aria-expanded',String(open));if(!open)pinned=false;});
    helps.push({popup,button,hide});
  }
  const rep=body.querySelector('[data-hour-rep]'),repHelp=body.querySelector('#document-hour-rep-help');
  if(repHelp){const label=rep.closest('label');rep.setAttribute('aria-label','24h Rep');rep.removeAttribute('aria-describedby');help(label,repHelp.textContent,'24h Rep');repHelp.remove();}
  const description=body.querySelector('.document-settings-description'),presentation=body.querySelector('[name=proposal_type]');presentation.setAttribute('aria-label','Document presentation');presentation.closest('label').append(description);
  const sections=[...body.querySelectorAll(':scope > .studio-document-rules')];
  for(const section of sections){
    const legend=section.querySelector('legend');const paragraphs=[...section.querySelectorAll(':scope > p:not([data-output-date-example])')];
    if(paragraphs.length){help(legend,paragraphs.map(p=>p.textContent).join(' '),legend.textContent);paragraphs.forEach(p=>p.remove());}
    if(section.querySelector('[data-output-date-example]')){const grid=document.createElement('div');grid.className='document-settings-date-grid';grid.append(...section.querySelectorAll(':scope > label'));legend.after(grid);}
  }
  // Label/help on one line, then the original field. Native selects keep explicit names.
  for(const label of body.querySelectorAll('.studio-field')){
    const caption=document.createElement('span');caption.className='document-settings-label';
    for(const node of [...label.childNodes])if(node.nodeType===3||node.classList?.contains('studio-settings-help'))caption.append(node);
    label.prepend(caption);
  }
  for(const label of body.querySelectorAll('.studio-rule-row label')){
    const select=label.querySelector('select');const name=select?.getAttribute('aria-label');
    const text={'Show step':'Hiding the step also hides its items and contacts. Individual step overrides still take priority until you apply settings to the whole document.','Contact Details':'Choose where supplier contacts appear: on the step or inside each visible item.','Contacts included':'Filters use the supplier subcategory when selected, independently of which item details are shown.'}[name];
    if(!text)continue;
    const caption=document.createElement('span');caption.className='document-settings-label';for(const node of [...label.childNodes])if(node.nodeType===3)caption.append(node);label.prepend(caption);help(caption,text,name);
  }
  const hideAll=()=>helps.forEach(h=>h.hide());
  mountSettingsNavigation(modal,body,header,footer,hideAll);
  body.addEventListener('scroll',hideAll);window.addEventListener('resize',hideAll);
  modal.addEventListener('keydown',event=>{if(event.key==='Escape'&&helps.some(h=>h.popup.matches(':popover-open'))){event.preventDefault();event.stopImmediatePropagation();hideAll();}},true);
  let observer;const dispose=()=>{hideAll();window.removeEventListener('resize',hideAll);observer?.disconnect();};
  observer=new MutationObserver(()=>{if(!modal.isConnected)dispose();});observer.observe(document.body,{childList:true,subtree:true});
  return dispose;
}
