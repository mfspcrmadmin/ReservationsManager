import { documentIcons } from './documents-list.js';

// Move the original inputs and save buttons; their handlers and drafts remain intact.
export function mountStudioInspector(inspector,{group,state}) {
  const heading=inspector.querySelector('.studio-properties-heading');
  const sectionSave=inspector.querySelector('[data-save]');
  const crmSaves=[...inspector.querySelectorAll('[data-crm-save]')];
  const body=document.createElement('div');body.className='studio-inspector-body';
  for(const child of [...inspector.children])if(child!==heading && child!==sectionSave)body.append(child);
  const documentPanel=document.createElement('div');documentPanel.id='studio-document-panel';
  const crmPanel=document.createElement('div');crmPanel.id='studio-crm-panel';
  const visibilityPanel=document.createElement('div');visibilityPanel.id='studio-visibility-panel';
  const editor=body.querySelector('.studio-section-editor');
  const groupSection=(label)=>{const section=document.createElement('section');section.className='studio-inspector-group';const h=document.createElement('h3');h.className='studio-group-label';h.textContent=label;section.append(h);return section;};
  const accordion=(parent,label,key,open=true)=>{
    const details=document.createElement('details');details.className='studio-fields-accordion';details.dataset.fieldGroup=key;
    state.fieldGroups ||= {};details.open=state.fieldGroups[group.key+'|'+key]??open;
    const summary=document.createElement('summary');summary.textContent=label;details.append(summary);parent.append(details);
    details.addEventListener('toggle',()=>state.fieldGroups[group.key+'|'+key]=details.open);
    return {details,summary,label,add:node=>details.append(node),count:()=>{const count=details.children.length-1;summary.textContent=label+' ('+count+')';}};
  };
  if(crmSaves.length){
    for(const node of [...editor.children])if(node.matches('.studio-crm-notice,.studio-crm-record,.studio-crm-snapshot'))crmPanel.append(node);
    editor.hidden=true;documentPanel.append(editor);
    const content=groupSection('Content');const note=document.createElement('p');note.className='studio-inspector-help';note.textContent='This section uses linked CRM data. Edit its text in CRM data.';content.append(note);documentPanel.append(content);
    // Field inclusion belongs to the document, even though the values come from CRM.
    const fields=groupSection('Fields shown');
    const fieldHelp=document.createElement('p');fieldHelp.className='studio-inspector-help';fieldHelp.textContent='Based on saved CRM data. Empty fields have no content to display.';fields.append(fieldHelp);
    const populated=accordion(fields,'Fields with content','document-populated');
    const emptyFields=accordion(fields,'Empty fields','document-empty',false);
    for(const record of crmPanel.querySelectorAll('[data-crm-record]'))for(const field of record.querySelectorAll('.studio-crm-field')){
      const button=field.querySelector('[data-field-eye]');if(!button)continue;
      const row=document.createElement('div');row.className='studio-visibility-field';
      const label=document.createElement('span');label.textContent=(crmSaves.length>1?(group.crmRecords[Number(record.dataset.crmRecord)].label+' \u00b7 '):'')+field.querySelector('label').textContent;
      // Keep the original ancestor for the existing eye handler's field label lookup.
      const savedField=group.crmRecords[Number(record.dataset.crmRecord)].fields.find(item=>item.api_name===field.querySelector('[data-crm-field]')?.dataset.crmField);
      const empty=!String(savedField?.value??'').trim();
      const availability=document.createElement('span');availability.className='studio-field-availability';availability.dataset.empty=String(empty);availability.textContent=empty?'Empty':'Has data';
      availability.title=empty?'The saved CRM value is empty.':'The saved CRM value has content. Visibility and template rules still apply.';
      row.classList.add('studio-crm-field');const name=document.createElement('label');name.textContent=label.textContent;row.append(name,availability,button);(empty?emptyFields:populated).add(row);
    }
    populated.count();emptyFields.count();
    documentPanel.append(fields);
    for(const record of crmPanel.querySelectorAll('[data-crm-record]')){
      const container=record.querySelector('.studio-crm-fields');
      const rows=[...container.querySelectorAll(':scope > .studio-crm-field')];
      container.querySelectorAll(':scope > .studio-crm-group-label').forEach(label=>label.remove());
      const filled=accordion(container,'Populated fields','crm-'+record.dataset.crmRecord+'-populated');
      const blank=accordion(container,'Empty fields','crm-'+record.dataset.crmRecord+'-empty',false);
      for(const row of rows){const input=row.querySelector('[data-crm-field]');(String(input?.value??'').trim()?filled:blank).add(row);}
      filled.count();blank.count();
    }
  }else documentPanel.append(editor);
  const visibility=groupSection('Visibility');
  for(const selector of ['.studio-visibility','.studio-excluded-note','.studio-visibility-consequence']){const node=body.querySelector(selector);if(node)visibility.append(node);}
  heading.append(visibility);
  const layout=body.querySelector('.studio-display-group');if(layout){layout.querySelector('h3').textContent='Image';documentPanel.append(layout);}
  const rules=body.querySelector('.studio-section-rules');if(rules){
    visibilityPanel.append(rules);
    const primary=rules.querySelector('.studio-rule-visibility');if(primary){const original=visibility.querySelector('.studio-visibility');original.hidden=true;visibility.replaceChildren(primary,original);}
  }
  const source=body.querySelector('.studio-origin');
  if(source){const details=document.createElement('details');details.className='studio-source-details';const summary=document.createElement('summary');summary.textContent='Source details';details.append(summary,source);documentPanel.append(details);}
  documentPanel.append(...body.childNodes);body.append(documentPanel,crmPanel,visibilityPanel);
  const scopes=[['document','Document',documentPanel],...(crmSaves.length?[['crm','CRM data',crmPanel]]:[]),...(rules?[['visibility','Visibility & contacts',visibilityPanel]]:[])];
  let active=scopes.some(([key])=>key===state.inspectorTab)?state.inspectorTab:'document';
  const tabs=document.createElement('div');tabs.className='studio-scope-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Editing scope');
  const decorateButtons=()=>{
    for(const [button,scope,icon,label] of [[sectionSave,'document','documentSave','Save section'],...crmSaves.map(b=>[b,'crm','database','Save to CRM'])]){
      button.classList.toggle('primary',(scope===active||(scope==='document'&&active==='visibility')));button.classList.toggle('tertiary',!(scope===active||(scope==='document'&&active==='visibility')));
      if(button.getAttribute('aria-busy')!=='true')button.innerHTML=documentIcons[icon]+'<span>'+label+'</span>';
    }
  };
  const activate=scope=>{active=scope;state.inspectorTab=scope;documentPanel.hidden=scope!=='document';crmPanel.hidden=scope!=='crm';visibilityPanel.hidden=scope!=='visibility';for(const button of tabs.children){const selected=button.dataset.scope===scope;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;}decorateButtons();};
  if(scopes.length>1){
    for(const [scope,label,panel] of scopes){
      const button=document.createElement('button');button.type='button';button.dataset.scope=scope;button.id='studio-tab-'+scope;button.setAttribute('role','tab');button.setAttribute('aria-controls',panel.id);button.textContent=label;
      panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',button.id);button.onclick=()=>activate(scope);tabs.append(button);
      button.onkeydown=event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const index=scopes.findIndex(([key])=>key===active);const next=event.key==='Home'?scopes[0][0]:event.key==='End'?scopes.at(-1)[0]:scopes[(index+(event.key==='ArrowRight'?1:-1)+scopes.length)%scopes.length][0];activate(next);tabs.querySelector('[data-scope='+next+']').focus();}};
    }
    heading.append(tabs);
  }
  const footer=document.createElement('footer');footer.className='studio-inspector-savebar';
  footer.innerHTML='<div class="studio-inspector-feedback" role="status" aria-live="polite" aria-atomic="true"><span class="studio-inspector-state-icon" aria-hidden="true"></span><div><strong data-inspector-state></strong><p data-inspector-help></p></div></div><div class="studio-inspector-save-actions"></div>';
  footer.querySelector('.studio-inspector-save-actions').append(sectionSave,...crmSaves);
  for(const toolbar of body.querySelectorAll('.studio-crm-toolbar'))toolbar.hidden=true;
  inspector.append(body,footer);inspector.classList.add('studio-inspector--fixed-actions');activate(active);
  return ({editable,busy,operation,crmDirty,presentationDirty,reload,error,validation})=>{
    crmSaves.forEach((button,index)=>button.hidden=index!==(crmDirty??0));
    let status='saved',label='All changes saved',message='';
    if(!editable){status='readonly';label='Read-only section';}
    else if(busy){status='saving';label=operation?'Saving\u2026':'Working\u2026';}
    else if(reload){status='error';label='Review required';message='Reload CRM to confirm the saved values. Pending changes are preserved.';}
    else if(error){status='error';label='Save failed';message=error+' Your changes are still here.';}
    else if(validation){status='error';label='Check your changes';message=validation;}
    else if(crmDirty!==null || presentationDirty){status='unsaved';label=crmDirty!==null && presentationDirty?'Unsaved document and CRM changes':crmDirty!==null?'Unsaved CRM changes':'Unsaved document changes';}
    if(status==='unsaved' && crmDirty!==null && crmSaves.length>1)message='CRM: '+group.crmRecords[crmDirty].label;
    footer.dataset.state=status;footer.querySelector('[data-inspector-state]').textContent=label;footer.querySelector('[data-inspector-help]').textContent=message;
    footer.querySelector('.studio-inspector-state-icon').textContent=status==='saved'?'\u2713':status==='unsaved'?'\u2022':status==='error'?'!':'';
    sectionSave.title='Save content, visibility, images and rules for this document';
    crmSaves.forEach((button,index)=>button.title='Save to CRM'+(crmSaves.length>1?' \u00b7 '+group.crmRecords[index].label:''));
    decorateButtons();
  };
}
