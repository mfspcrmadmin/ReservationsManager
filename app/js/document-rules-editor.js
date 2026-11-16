import { documentRules, ruleForStepCategory, initialStepCategorySettings, documentStepCategories, contactSupplierSubcategories, loadSupplierContacts, supplierContactChoices, resolveSupplierContact, applyServiceRules } from './document-service-rules.js';
function sectionRuleStatus(record,records) {
  const item=record.module==='Booking_Services';
  const included=!item&&record.fid_contact?.source==='Step Contact'&&record.contact_required?[record]:item?(record.contact_required?[record]:[]):Object.values(records).filter(r=>r.module==='Booking_Services'&&r.step_id===record.step_id&&r.contact_required);
  const pending=included.some(r=>r.contact_issue);
  const placement=[...new Set(included.map(r=>r.contact_placement))];
  const contactText=!included.length?'Contacts hidden':pending?'Contact pending — load or select a valid supplier contact':placement.length>1?'Contacts on step and items':placement[0]==='step'?'Contact shown on step':'Contact shown inside items';
  const parent=records['crm-step:'+record.step_id];
  const reason=record.document_visible===false?(record.active===false?'Excluded by CRM status or step type':item&&parent?.document_visible===false?'Hidden because the step is hidden':record.document_hidden||record.rule_reason==='Hidden in this document.'?'Hidden individually':'Hidden by document settings'):'';
  return {hidden:record.document_visible===false,reason,contactText,hasContacts:!!included.length,pending,summary:(item?'Item':'Step')+(record.document_visible===false?' hidden':' shown')+' · '+contactText};
}
export function updateStudioOutlineStatus(studio,records,pendingKey='') {
  if(!studio)return;
  for(const row of studio.querySelectorAll('.studio-outline [data-section-key]')){
    const record=records[row.dataset.sectionKey];if(!record)continue;
    const state=sectionRuleStatus(record,records);
    row.classList.toggle('is-hidden',state.hidden);
    const icon=row.querySelector('.studio-section-icon');if(icon)icon.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+(record.module==='Booking_Services'?'<path d="M10 12h4"/>':'<path d="m12 3 9 9-9 9-9-9Z"/>')+'</svg>';
    let badges=row.querySelector('.studio-outline-status');
    if(!badges){badges=document.createElement('span');badges.className='studio-outline-status';row.append(badges);}
    badges.replaceChildren();
    const badge=(kind,label,path)=>{const el=document.createElement('span');el.className='studio-outline-badge '+kind;el.setAttribute('aria-label',label);el.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+path+'</svg>';badges.append(el);};
    if(state.hidden)badge('is-excluded',state.reason,'<path d="m3 3 18 18M10 5c5-1 9 7 9 7l-3 4M6 6c-3 2-5 6-5 6s4 7 11 7l4-1"/>');
    if(state.hasContacts)badge(state.pending?'is-warning':'is-contact',state.contactText,'<path d="M5 3h4l2 5-3 2c2 3 3 4 6 6l2-3 5 2v4c-8 4-22-10-16-16Z"/>'+(state.pending?'<path d="M19 2v5M19 10v1"/>':''));
    const dot=document.createElement('span');dot.className='studio-outline-pending';dot.textContent='●';dot.setAttribute('aria-label','Unsaved changes');dot.hidden=row.dataset.sectionKey!==pendingKey;badges.append(dot);
    // One tooltip per row avoids competing native and application tooltips.
    const title=row.querySelector('.studio-section-title')?.textContent||'';
    row.title=[title,state.reason,state.hasContacts?state.contactText:''].filter(Boolean).join(' · ');
    row.setAttribute('aria-label',[title,state.summary,row.dataset.sectionKey===pendingKey?'Unsaved changes':''].filter(Boolean).join(' · '));
    const small=row.querySelector('.studio-section-copy small');if(small){small.textContent=small.textContent.replace(/\s*·\s*(Hidden|Excluded)\s*$/,'');}
  }
}
function control(label,values,value){const wrap=document.createElement('label');wrap.append(label);const select=document.createElement('select');for(const [key,text] of values){const o=document.createElement('option');o.value=key;o.textContent=text;select.append(o);}select.value=value;select.setAttribute('aria-label',label);wrap.append(select);return {wrap,select};}
function ruleChoices(title,entries,selected=[]) {
  const field=document.createElement('fieldset');field.className='studio-rule-categories';
  const legend=document.createElement('legend');legend.textContent=title;field.append(legend);
  for(const [value,text] of entries){const label=document.createElement('label'),box=document.createElement('input');box.type='checkbox';box.value=value;box.checked=selected.includes(value);label.append(box,document.createTextNode(text));field.append(label);}
  if(!entries.length){const empty=document.createElement('p');empty.textContent='No options in this document yet.';field.append(empty);}
  return field;
}
const checkedRules=field=>[...field.querySelectorAll('input:checked')].map(input=>input.value);
export function mountDocumentRulesSettings(form,settings,records={}) {
  const rules=documentRules(settings),section=document.createElement('fieldset');section.className='studio-document-rules';const legend=document.createElement('legend');legend.textContent='Steps, items & contacts';section.append(legend);
  const help=document.createElement('p');help.textContent='Defaults by Step Category for this document. Items and contacts are independent. Individual sections can override appearance and contact selection. CRM exclusions and hidden parents still apply.';section.append(help);
  if(rules.contact_defaults_version<1){const notice=document.createElement('div');notice.className='studio-inspector-help';notice.textContent='Review the selected supplier subcategories below. Save settings to use these defaults in this document. Individual overrides are preserved.';section.append(notice);}
  const categoryNames=new Map(documentStepCategories.map(name=>[name.toLowerCase(),name]));
  const steps=Object.values(records).filter(r=>r.module==='Booking_Steps');
  const blockedCategories=new Set(['agent commission','agent comission']);
  for(const record of steps){
    const key=String(record.step_category||'').trim().toLowerCase();
    if(key && !categoryNames.has(key) && steps.filter(r=>String(r.step_category||'').trim().toLowerCase()===key).every(r=>String(r.step_type||'').trim().toLowerCase()==='extra'))blockedCategories.add(key);
  }
  for(const r of steps)if(r.step_category?.trim()&&!blockedCategories.has(r.step_category.trim().toLowerCase())&&String(r.step_type||'').trim().toLowerCase()!=='extra')categoryNames.set(r.step_category.trim().toLowerCase(),r.step_category.trim());
  for(const key of Object.keys(rules.step_categories))if(key!=='*'&&!blockedCategories.has(key.trim().toLowerCase())&&!categoryNames.has(key))categoryNames.set(key,key);
  const types=['*',...categoryNames.keys()];
  const categorySelector=control('Step Category',types.map(key=>[key,key==='*'?'Other / uncategorized steps':categoryNames.get(key)]),'*');
  categorySelector.select.dataset.settingsNavigation='';section.append(categorySelector.wrap);
  const rows=[];
  for(const type of types){
    const row=document.createElement('div');row.className='studio-rule-row';const h=document.createElement('h4');h.textContent=type==='*'?'Other / uncategorized steps':categoryNames.get(type);row.append(h);
    const matching=Object.values(records).find(r=>r.module==='Booking_Steps'&&String(r.step_category||'').trim().toLowerCase()===type&&r.step_type!=='extra');
    const legacyType=matching?.step_type||(['hotel','hotel nbtm','hotel not booked mfs&p'].includes(type)?'accommodation':type==='agent commission'?'extra':'activity');
    const saved=initialStepCategorySettings(rules,type,legacyType);
    const step=control('Show step',[['shown','Show'],['hidden','Hide']],saved.step_visibility);
    const details=document.createElement('div');details.className='studio-category-details';
    const hiddenNote=document.createElement('p');hiddenNote.className='studio-inspector-help';hiddenNote.textContent='The step, its items and their contacts will be hidden. Their settings are kept for when the step is shown again.';
    const services=control('Items shown',[['all','All eligible items'],['categories','Only selected categories'],['suppliers','Only selected suppliers'],['none','No items']],saved.services);
    const contacts=control('Contact Details',[['step','On the step, grouped by supplier'],['step_items','On the step, identified by item'],['service','Inside each item'],['hidden','Hidden']],saved.contacts);
    const contactFilter=control('Contacts included',[['all','All eligible suppliers'],['supplier_subcategories','Only selected supplier subcategories'],['categories','Only selected item categories'],['suppliers','Only selected suppliers']],saved.contact_filter);
    const available=[...new Set([...Object.values(records).map(r=>String(r.category||'').trim().toLowerCase()).filter(Boolean),...saved.categories,...saved.contact_categories])].sort().map(value=>[value,value]);
    const supplierNames=new Map(Object.values(records).filter(r=>r.supplier_id).map(r=>[r.supplier_id,r.supplier||r.supplier_id]));
    for(const id of [...saved.suppliers,...saved.contact_suppliers])if(!supplierNames.has(id))supplierNames.set(id,'Supplier '+id+' (not in this document)');
    const availableSuppliers=[...supplierNames].sort((a,b)=>a[1].localeCompare(b[1]));
    const categories=ruleChoices('Item categories',available,saved.categories),suppliers=ruleChoices('Item suppliers',availableSuppliers,saved.suppliers);
    const contactCategories=ruleChoices('Contact item categories',available,saved.contact_categories),contactSuppliers=ruleChoices('Contact suppliers',availableSuppliers,saved.contact_suppliers);
    const contactSubcategories=ruleChoices('Supplier subcategories',[...new Set([...contactSupplierSubcategories.map(v=>v.toLowerCase()),...Object.values(records).map(r=>String(r.supplier_subcategory||'').trim().toLowerCase()).filter(Boolean),...saved.contact_subcategories])].map(value=>[value,contactSupplierSubcategories.find(v=>v.toLowerCase()===value)||value]),saved.contact_subcategories);
    const note=document.createElement('p');note.className='studio-inspector-help';
    const sync=()=>{details.hidden=step.select.value==='hidden';hiddenNote.hidden=!details.hidden;categories.hidden=services.select.value!=='categories';suppliers.hidden=services.select.value!=='suppliers';contactFilter.wrap.hidden=contacts.select.value==='hidden';contactSubcategories.hidden=contactFilter.wrap.hidden||contactFilter.select.value!=='supplier_subcategories';contactCategories.hidden=contactFilter.wrap.hidden||contactFilter.select.value!=='categories';contactSuppliers.hidden=contactFilter.wrap.hidden||contactFilter.select.value!=='suppliers';const warnings=[];
      if(contacts.select.value==='service'&&services.select.value!=='all')warnings.push(services.select.value==='none'?'No contacts will appear inside items hidden by this rule. Choose a placement on the step to show them.':'Only visible items can show their contacts.');
      if(services.select.value==='categories'&&!checkedRules(categories).length||services.select.value==='suppliers'&&!checkedRules(suppliers).length)warnings.push('No items match until you select at least one option.');
      if(contacts.select.value!=='hidden'&&(contactFilter.select.value==='categories'&&!checkedRules(contactCategories).length||contactFilter.select.value==='suppliers'&&!checkedRules(contactSuppliers).length))warnings.push('No contacts match until you select at least one option.');
      if(contacts.select.value!=='hidden'&&contactFilter.select.value==='supplier_subcategories'&&!checkedRules(contactSubcategories).length)warnings.push('No contacts match until you select at least one supplier subcategory.');note.textContent=warnings.join(' ');note.hidden=!note.textContent;};
    for(const input of [step.select,services.select,contacts.select,contactFilter.select])input.onchange=sync;sync();const contactGrid=document.createElement('div');contactGrid.className='document-settings-contact-grid';contactGrid.append(contacts.wrap,contactFilter.wrap);details.append(services.wrap,categories,suppliers,contactGrid,contactCategories,contactSuppliers,contactSubcategories,note);row.append(step.wrap,hiddenNote,details);row.addEventListener('change',sync);section.append(row);rows.push({type,row,step:step.select,services:services.select,contacts:contacts.select,contactFilter:contactFilter.select,categories,suppliers,contactCategories,contactSuppliers,contactSubcategories});
  }
  const showCategory=()=>rows.forEach(entry=>entry.row.hidden=entry.type!==categorySelector.select.value);categorySelector.select.onchange=showCategory;showCategory();
  const note=document.createElement('p');note.textContent='Hotel categories start with all room items and one contact per supplier on the step. Experience starts with contacts by item and no item details. Restaurants group the supplier contact on the step. Other categories start with contacts from the selected supplier subcategories; contacts inside items require those items to be visible. Existing saved rules take priority. Extra steps remain excluded. Contacts inside items appear only when those items are visible. Contacts placed on the step can remain visible without item details.';section.append(note);
  form.querySelector('.document-create-actions').before(section);
  return ()=>({contact_defaults_version:1,types:rules.types,step_categories:Object.fromEntries(rows.map(row=>[row.type,{step_visibility:row.step.value,services:row.services.value,categories:checkedRules(row.categories),suppliers:checkedRules(row.suppliers),contacts:row.contacts.value,contact_filter:row.contactFilter.value,contact_categories:checkedRules(row.contactCategories),contact_subcategories:checkedRules(row.contactSubcategories),contact_suppliers:checkedRules(row.contactSuppliers)}])),sections:rules.sections});
}
export function mountSectionRules(inspector,group,doc,records,onChange,options={}) {
  if(!group.crmRecords?.length || group.origin!=='CRM')return {read:()=>undefined,dirty:()=>false,sync:()=>{}};
  if(records[group.key]?.fid_contact){
    const settings=document.createElement('section');settings.className='studio-section-rules';
    const heading=document.createElement('h3');heading.textContent='FID contact saved in CRM';
    const help=document.createElement('p');help.className='studio-inspector-help';help.textContent='Edit FID Contact Source, Visibility, Mode, Name and Phone in CRM data. Save to CRM shares this contact across all FID documents. Automatic Pending contacts are resolved on generation. Set Automatic and Pending to clear the saved result and search again.';
    const savedAppearance=documentRules(doc.settings).sections[group.key]?.appearance;
    const initialAppearance=group.visible===false?'hidden':savedAppearance||'automatic';
    const appearance=control(group.service_id?'Show item':'Show step',[['automatic','Document default'],['shown','Show'],['hidden','Hide']],initialAppearance);
    const visible=inspector.querySelector('[data-visible]');
    appearance.select.onchange=()=>{if(visible)visible.checked=appearance.select.value!=='hidden';onChange();};
    visible?.addEventListener('change',()=>{appearance.select.value=visible.checked?'shown':'hidden';onChange();});
    settings.append(appearance.wrap,heading,help);inspector.querySelector('.studio-section-editor').after(settings);
    return {read:()=>({appearance:appearance.select.value,contact_mode:'automatic',contact_id:'',contact_ids:{}}),dirty:()=>appearance.select.value!==initialAppearance,sync:locked=>{appearance.select.disabled=locked;}};
  }
  const rules=documentRules(doc.settings),saved=rules.sections[group.key]||{};
  const initial={appearance:group.visible===false?'hidden':saved.appearance||'automatic',contact_mode:saved.contact_mode||'automatic',contact_id:saved.contact_id||'',contact_ids:saved.contact_mode==='choose'?(saved.contact_ids||{}):{}};
  let legacyContactId=initial.contact_id,loading=false,locked=false;
  const section=document.createElement('section');section.className='studio-section-rules';section.innerHTML='<h3>Visibility & contacts</h3>';
  const appearance=control(group.service_id?'Show item':'Show step',[['automatic','Document default'],['shown','Show'],['hidden','Hide']],initial.appearance);
  const contact=control('Show contact',[['automatic','Document default'],['shown','Show'],['hidden','Hide'],['choose','Choose contact']],initial.contact_mode);
  const related=(group.service_id?[records[group.key]]:Object.values(records).filter(r=>r.module==='Booking_Services'&&r.step_id===group.step_id)).filter(Boolean);
  const suppliers=[...new Map(related.filter(r=>r.supplier_id).map(r=>[r.supplier_id,r])).values()];
  const choicesContainer=document.createElement('div');choicesContainer.className='studio-contact-choices';const choices=new Map();
  for(const record of suppliers){const choice=control(group.service_id?'Supplier contact':(record.supplier||'Supplier')+' contact',[],group.service_id?initial.contact_id:initial.contact_ids[record.supplier_id]||'');choice.select.dataset.supplierContact=record.supplier_id;choices.set(record.supplier_id,choice);choicesContainer.append(choice.wrap);}
  const load=document.createElement('button');load.type='button';load.className='button tertiary';load.textContent='Load supplier contacts';
  const preview=document.createElement('div');preview.className='studio-contact-preview';preview.setAttribute('aria-live','polite');
  const help=document.createElement('p');help.className='studio-inspector-help';
  const summary=document.createElement('p');summary.className='studio-rule-summary';summary.setAttribute('role','status');
  const switchControl=(label,select)=>{
    const box=document.createElement('div');box.className='studio-rule-switch';
    const wrap=document.createElement('label');wrap.className='studio-visibility';
    const input=document.createElement('input');input.type='checkbox';input.setAttribute('role','switch');input.setAttribute('aria-label',label);
    wrap.append(input,document.createTextNode(' '+label));
    const status=document.createElement('small');status.className='studio-rule-inheritance';
    const reset=document.createElement('button');reset.type='button';reset.className='studio-use-default';reset.textContent='Use document default';
    reset.onclick=()=>{if(locked)return;select.value='automatic';select.dispatchEvent(new Event('change',{bubbles:true}));};
    input.oninput=()=>{if(locked)return;select.value=input.checked?'shown':'hidden';select.dispatchEvent(new Event('change',{bubbles:true}));};
    box.append(wrap,status,reset);return {box,input,status,reset};
  };
  const mainSwitch=switchControl('Include in document',appearance.select),contactSwitch=switchControl('Show supplier contacts',contact.select);
  mainSwitch.input.dataset.ruleVisibility='';contactSwitch.input.dataset.ruleContacts='';
  const visibilityCard=document.createElement('section');visibilityCard.className='studio-rule-visibility';
  const visibilityHeading=document.createElement('h3');visibilityHeading.className='studio-group-label';visibilityHeading.textContent=group.service_id?'Item visibility':'Step visibility';
  visibilityCard.append(visibilityHeading,mainSwitch.box,summary);
  const contactsCard=document.createElement('section');contactsCard.className='studio-supplier-contacts';
  const contactsHeading=document.createElement('h3');contactsHeading.className='studio-group-label';contactsHeading.textContent='Supplier contacts';
  contactsCard.append(contactsHeading,contactSwitch.box,choicesContainer,load,preview,help);
  appearance.wrap.hidden=true;contact.wrap.hidden=true;
  section.replaceChildren(visibilityCard,appearance.wrap,contact.wrap,contactsCard);inspector.querySelector('.studio-section-editor').after(section);
  const read=()=>({appearance:appearance.select.value,contact_mode:contact.select.value,contact_id:group.service_id?(contact.select.value==='choose'?choices.values().next().value?.select.value||legacyContactId:''):(contact.select.value==='choose'?legacyContactId:''),contact_ids:group.service_id||contact.select.value!=='choose'?{}:Object.fromEntries([...choices].map(([id,c])=>[id,c.select.value]).filter(([,id])=>id))});
  const refill=initializing=>{
    for(const [id,choice] of choices){
      const record=suppliers.find(r=>r.supplier_id===id),selected=initializing?(group.service_id?initial.contact_id:initial.contact_ids[id]||''):choice.select.value;
      const resolved=resolveSupplierContact(record);const automatic=resolved.contact?'Automatic - '+resolved.contact.name+' - '+resolved.contact.phone:'Automatic - selection required';
      choice.select.replaceChildren();
      for(const [value,text] of [['',automatic],...supplierContactChoices(record).map(c=>[c.id,[c.name,c.phone,c.reservations?'RE - Reservas':''].filter(Boolean).join(' - ')])]){const o=document.createElement('option');o.value=value;o.textContent=text;choice.select.append(o);}
      if(selected&&!supplierContactChoices(record).some(c=>c.id===selected)){const o=document.createElement('option');o.value=selected;o.textContent='Previously selected contact unavailable';choice.select.append(o);}
      choice.select.value=selected;
    }
  };
  const update=()=>{
    const enabled=contact.select.value!=='hidden';choicesContainer.hidden=!enabled;
    load.hidden=!enabled||!related.some(r=>r.supplier_id&&!r.supplier_contacts_loaded&&(!r.supplier_contacts?.length||r.contact_load_error));load.disabled=locked||loading;
    preview.replaceChildren();
    const override=read(),blocks=Object.values(records).filter(r=>r.document_hidden&&r.key!==group.key).map(r=>({key:r.key,visibility:'Hidden'}));
    const resolve=sectionOverride=>applyServiceRules(records,blocks,{...doc.settings,rules:{...doc.settings?.rules,sections:{...rules.sections,[group.key]:sectionOverride}}});
    const effective=resolve(override);
    const pending=JSON.stringify(override)!==JSON.stringify(initial);
    updateStudioOutlineStatus(inspector.closest('.document-studio'),effective,pending?group.key:'');
    if(effective[group.key])summary.textContent=sectionRuleStatus(effective[group.key],effective).summary+(pending?' · Unsaved changes':'');
    // Resolve each inherited option independently of its current explicit override.
    // Contact inclusion must not depend on whether a phone has been loaded or selected.
    const defaultAppearance=override.appearance==='automatic'?effective:resolve({...override,appearance:'automatic'});
    const defaultContacts=override.contact_mode==='automatic'?effective:resolve({...override,contact_mode:'automatic',contact_id:'',contact_ids:{}});
    appearance.select.options[0].textContent=(defaultAppearance[group.key]?.document_visible?'Show':'Hide')+' (document default)';
    contact.select.options[0].textContent=(related.some(r=>defaultContacts[r.key]?.contact_required)?'Show':'Hide')+' (document default)';
    mainSwitch.input.checked=effective[group.key]?.document_visible!==false;
    contactSwitch.input.checked=related.some(r=>effective[r.key]?.contact_required);
    for(const [control,mode,inherited] of [[mainSwitch,override.appearance,defaultAppearance[group.key]?.document_visible],[contactSwitch,override.contact_mode,related.some(r=>defaultContacts[r.key]?.contact_required)]]){
      control.input.disabled=locked;
      control.status.textContent=mode==='automatic'?'Document default: '+(inherited?'Shown':'Hidden'):'Individual override';
      control.reset.hidden=mode==='automatic';control.reset.disabled=locked;
    }
    for(const [id,choice] of choices){
      let hint=choice.wrap.querySelector('.studio-contact-selection-hint');
      if(!hint){hint=document.createElement('small');hint.className='studio-contact-selection-hint';choice.wrap.append(hint);}
      const record=suppliers.find(r=>r.supplier_id===id);
      hint.textContent=choice.select.value?'Manually selected contact':!record.supplier_contacts_loaded&&!record.supplier_contacts?.length?'Load contacts to resolve automatic selection':resolveSupplierContact(record).contact?'Automatic: RE - Reservas with a phone number':'Automatic - selection required';
      choice.wrap.dataset.assignment=choice.select.value?'manual':'automatic';
    }
    const current=effective[group.key];const cards=group.service_id?(current?.contact_required===false?[]:[...(current?.contact_cards||[]),...(effective['crm-step:'+group.step_id]?.contact_cards||[]).filter(c=>c.service_key===group.key||(c.supplier_id===current?.supplier_id&&!c.service_key))]):current?.contact_cards||[];
    for(const card of cards){const row=document.createElement('div'),name=document.createElement('strong'),phone=document.createElement('span');name.textContent=card.supplier;phone.textContent=card.phone;row.append(name,phone);preview.append(row);}
    const issues=[...new Set(related.map(r=>effective[r.key]?.contact_issue).filter(Boolean))];
    help.textContent=loading?'Loading supplier contacts...':!enabled?'Contacts hidden for this '+(group.service_id?'item.':'step and its items.'):group.service_id&&rules.sections['crm-step:'+group.step_id]?.contact_mode==='hidden'?'Contacts are hidden on the parent step. Enable them there first.':current?.document_visible===false&&!cards.length?'This section is hidden or excluded. Contacts cannot appear under a hidden step.':issues.join(' ')||(!cards.length?'No contacts included by the current settings.':'Supplier and phone shown above. Changes apply after Save section.');
  };
  load.onclick=async()=>{
    if(loading||locked)return;loading=true;load.setAttribute('aria-busy','true');update();
    try{
      const api=options.api||globalThis.ZOHO?.CRM?.API;if(!api)throw new Error('Supplier contacts are not available. Reopen the document.');
      await loadSupplierContacts(Object.fromEntries(related.map(r=>[r.key,r])),api,()=>section.isConnected,false,options.supplierCache);
      if(!section.isConnected)return;refill(false);
    }catch(error){if(section.isConnected)related.forEach(r=>r.contact_load_error=error.message);}
    finally{loading=false;load.removeAttribute('aria-busy');if(section.isConnected)update();}
  };
  refill(true);update();
  const visibility=inspector.querySelector('[data-visible]');let changingAppearance=false;
  appearance.select.onchange=()=>{if(visibility&&!visibility.disabled){changingAppearance=true;visibility.checked=appearance.select.value!=='hidden';visibility.dispatchEvent(new Event('input',{bubbles:true}));changingAppearance=false;}update();onChange();};
  visibility?.addEventListener('input',()=>{if(changingAppearance)return;appearance.select.value=visibility.checked?'shown':'hidden';update();onChange();});
  contact.select.onchange=()=>{if(contact.select.value!=='choose'){legacyContactId='';for(const c of choices.values())c.select.value='';}update();onChange();if(['shown','choose'].includes(contact.select.value)&&!load.hidden)load.onclick();};
  for(const choice of choices.values())choice.select.onchange=()=>{legacyContactId='';contact.select.value=[...choices.values()].some(c=>c.select.value)?'choose':'shown';update();onChange();};
  return {read,dirty:()=>JSON.stringify(read())!==JSON.stringify(initial),sync:value=>{locked=value;section.querySelectorAll('select').forEach(s=>s.disabled=locked);update();}};
}
