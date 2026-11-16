const escapeRuleHtml=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const normRule=value=>String(value??'').trim().toLowerCase();
export function documentRules(settings={}) {
  const rules=settings.rules || {};
  return {contact_defaults_version:Number(rules.contact_defaults_version)||0,types:rules.types || {},step_categories:rules.step_categories || {},sections:rules.sections || {}};
}
export function ruleForType(rules,type) {
  const key=normRule(type),saved=rules.types?.[key]||rules.types?.['*']||{};
  const experience=['experience','experiences'].includes(key);
  return {step_visibility:saved.step_visibility||'shown',services:saved.services||(experience?'none':'all'),categories:saved.categories||[],suppliers:saved.suppliers||[],contacts:saved.contacts||(key==='accommodation'?'step':experience?'step_items':'service'),contact_filter:saved.contact_filter||'all',contact_categories:saved.contact_categories||[],contact_subcategories:saved.contact_subcategories||[],contact_suppliers:saved.contact_suppliers||[]};
}
// Categories observed in CRM on 2026-10-21. This is text in CRM, so document values are merged into the settings list.
export const documentStepCategories = ['Arrival/Departure Services - Airport','Arrival/Departure Services - Flight','Arrival/Departure Services - Port','Courses','Daily Description','Experience','Flight Service','Flight Service NBTM','Hotel','Hotel NBTM','Hotel not booked MfS&P','ON HOLD Golf','Restaurants','Sales Experience','Ships','Test Experience with train','Train Service','Train Service Highlights','Transfer','Wellbeing'];
// Available choices are separate from the default selection (CRM Vendors.Subcategory, 2026-10-21).
export const contactSupplierSubcategories = ['Host','Guide','Adventure / Outdoor activities','Wineries','Agritourism','Food','Boat Services','Courses / Workshops','Exclusive Access','Restaurants','Solidarity','Wellbeing','Private Visit','Shows','Golf','Tickets','Air Services','Taxi','Ground Transportation','Hospitality & Assistance Services','Train','Car Rental','Parking'];
export const defaultContactSupplierSubcategories = ["Host", "Guide", "Adventure / Outdoor activities", "Wineries", "Agritourism", "Boat Services", "Courses / Workshops", "Solidarity", "Wellbeing", "Private Visit", "Shows", "Golf", "Ground Transportation", "Hospitality & Assistance Services", "Car Rental"];
export function ruleForStepCategory(rules,category,type='') {
  const key=normRule(category),categoryRule=rules.step_categories?.[key]||rules.step_categories?.['*'];
  // Existing documents keep their old type rules until category settings are saved.
  if(!categoryRule && (!key || Object.keys(rules.types||{}).length))return ruleForType(rules,type);
  const hotel=['hotel','hotel nbtm','hotel not booked mfs&p'].includes(key);
  const resolved=ruleForType({types:categoryRule?{'*':categoryRule}:{}},hotel?'accommodation':key);
  if(!categoryRule && key==='restaurants')resolved.contacts='step';
  return resolved;
}
// Only the settings initializer supplies suggested defaults. Rendering reads saved rules.
export function initialStepCategorySettings(rules,category,type='') {
  const saved=ruleForStepCategory(rules,category,type),key=normRule(category);
  if(rules.contact_defaults_version>=1)return saved;
  const hotel=normRule(type)==='accommodation'||['hotel','hotel nbtm','hotel not booked mfs&p'].includes(key);
  if(key==='restaurants'){
    if(!rules.step_categories?.[key])saved.contacts='step';
  }else if(!hotel && saved.contact_filter==='all' && saved.contacts!=='hidden'){
    saved.contact_filter='supplier_subcategories';saved.contact_subcategories=defaultContactSupplierSubcategories.map(normRule);
  }
  return saved;
}
export function supplierContactChoices(record) {
  return (record?.supplier_contacts||[]).filter(c=>/\d/.test(String(c.phone||'')));
}
export function resolveSupplierContact(record,selected='') {
  const choices=supplierContactChoices(record),preferred=choices.filter(c=>c.reservations!==false);
  const contact=selected?choices.find(c=>c.id===selected):preferred.length===1?preferred[0]:null;
  const issue=record?.contact_load_error||(contact?'':selected?'The selected contact is unavailable or has no phone number.':choices.length?'Choose a supplier contact with a phone number.':'No supplier contact with a phone number found.');
  return {contact,choices,issue};
}
export function savedFIDContact(record) {
  const saved=record?.fid_contact;
  if(!saved)return null;
  const name=String(saved.name||'').trim(),phone=String(saved.phone||'').trim();
  if(name && /\d/.test(phone))return {contact:{id:record.module==='Booking_Services'?'fid:'+record.supplier_id+':'+name+'|'+phone:'fid:'+record.id,name,phone,email:'',address:'',modified_time:record.modified_time||'',reservations:true},issue:''};
  const issue=saved.mode==='Manual'?'Manual FID contact is incomplete. Enter a name and phone in CRM data.':
    ['Resolved','Not found','Needs selection'].includes(saved.status)?'FID contact: '+saved.status+'. Edit CRM data or set status to Pending to search again.':
    'FID contact pending. It will be resolved and saved in CRM when generating.';
  return {contact:null,issue};
}
export function applyServiceRules(records,blocks=[],settings={}) {
  const rules=documentRules(settings),result=Object.fromEntries(Object.entries(records).map(([key,r])=>[key,{...r,contact_cards:[],contact_issue:'',contact_candidate_ids:[],contact_step_sources:0,contact_required:false,supplier_classification_required:false,contact_placement:'',document_visible:true}]));
  const hidden=new Set(blocks.filter(b=>b.visibility==='Hidden').map(b=>b.key.replace(/:part:\d+$/,'')));
  const override=key=>rules.sections[key]||{};
  for(const [key,r] of Object.entries(result)) {
    if(r.module==='Booking_Steps' && (normRule(r.step_type)==='extra' || ['agent commission','agent comission'].includes(normRule(r.step_category))))r.active=false;
    const o=override(key);r.document_hidden=hidden.has(key);r.document_visible=r.active!==false && !hidden.has(key) && o.appearance!=='hidden';
    r.rule_reason=r.active===false?'Excluded by CRM status or step type.':hidden.has(key)||o.appearance==='hidden'?'Hidden in this document.':'';
    if(r.module==='Booking_Steps' && r.document_visible && o.appearance!=='shown' && ruleForStepCategory(rules,r.step_category,r.step_type).step_visibility==='hidden'){
      r.document_visible=false;r.rule_reason='Hidden by Step Category settings.';
    }
  }
  for(const r of Object.values(result))if(r.module==='Booking_Steps' && r.document_visible && r.fid_contact?.source==='Step Contact' && r.fid_contact.visibility!=='Hide'){
    const resolved=savedFIDContact(r);r.contact_required=true;r.contact_issue=resolved.issue;
    if(resolved.contact)r.contact_cards.push({...resolved.contact,supplier_id:'',supplier:''});
  }
  for(const [key,r] of Object.entries(result))if(r.module==='Booking_Services') {
    const parent=result['crm-step:'+r.step_id],o=override(key),po=override(parent?.key),rule=ruleForStepCategory(rules,parent?.step_category,parent?.step_type);
    if(!parent?.document_visible){r.document_visible=false;r.rule_reason='The parent step is excluded.';}
    const contactEligible=r.document_visible;
    if(r.document_visible && o.appearance!=='shown') {
      const allowed=rule.services==='all'||(rule.services==='categories' && rule.categories.map(normRule).includes(normRule(r.category)))||(rule.services==='suppliers' && rule.suppliers.includes(r.supplier_id));
      if(!allowed){r.document_visible=false;r.rule_reason='Excluded by the '+(parent?.step_category||'default')+' Step Category rule.';}
    }
    const managed=!!r.fid_contact,fid=r.fid_contact||{},parentFID=parent?.fid_contact||{};
    const explicit=managed?fid.visibility==='Show':['shown','choose'].includes(o.contact_mode),parentExplicit=managed?parentFID.visibility==='Show':['shown','choose'].includes(po.contact_mode);
    let placement=rule.contacts;
    if(parentExplicit)placement=normRule(parent?.step_type)==='accommodation'||normRule(parent?.step_category)==='restaurants'?'step':'step_items';
    if(explicit && (placement==='hidden'||(placement==='service'&&!r.document_visible)))placement=r.document_visible?'service':'step_items';
    if(managed && parentFID.source==='Service Contacts' && placement==='hidden')placement='step_items';
    const onStep=['step','step_items'].includes(placement);
    const eligible=r.active!==false&&parent?.document_visible;
    if(!eligible||(!managed&&(o.contact_mode==='hidden'||po.contact_mode==='hidden'))||placement==='hidden')continue;
    if(managed && (fid.visibility==='Hide'||['None','Step Contact'].includes(parentFID.source)||(onStep&&parentFID.visibility==='Hide')))continue;
    if(!r.document_visible && !(onStep&&(contactEligible||explicit||parentExplicit)))continue;
    r.supplier_classification_required=rule.contact_filter==='supplier_subcategories';
    if(!explicit&&!parentExplicit){
      if(rule.contact_filter==='categories' && !rule.contact_categories.map(normRule).includes(normRule(r.category)))continue;
      if(rule.contact_filter==='supplier_subcategories' && !rule.contact_subcategories.map(normRule).includes(normRule(r.supplier_subcategory)))continue;
      if(rule.contact_filter==='suppliers' && !rule.contact_suppliers.includes(r.supplier_id))continue;
    }
    r.contact_required=true;r.contact_placement=onStep?'step':'item';
    const target=onStep?parent:r;
    if(managed){
      const resolved=savedFIDContact(r);r.contact_issue=resolved.issue;
      if(resolved.issue && target!==r)target.contact_issue=[target.contact_issue,resolved.issue].filter(Boolean).join(' ');
      if(resolved.contact)target.contact_cards.push({...resolved.contact,supplier_id:r.supplier_id,supplier:r.supplier,...(placement==='step_items'?{service_key:key,item_label:r.title||r.label||'Item'}:{})});
      continue;
    }
    const choices=supplierContactChoices(r);
    if(onStep){target.contact_step_sources++;target.contact_candidate_ids.push(...choices.map(c=>c.id));}
    const ownSelected=o.contact_mode==='choose'?o.contact_id:'';
    const parentSelected=po.contact_mode==='choose'?(po.contact_ids?.[r.supplier_id]||(onStep?po.contact_id:'')):'';
    const selected=ownSelected||(onStep&&choices.some(c=>c.id===parentSelected)?parentSelected:'');
    const invalidParentChoice=!ownSelected&&onStep&&po.contact_mode==='choose'&&!!po.contact_ids?.[r.supplier_id]&&!choices.some(c=>c.id===parentSelected);
    const {contact:chosen,issue}=resolveSupplierContact(r,invalidParentChoice?parentSelected:selected);
    r.contact_issue=issue;
    if(issue && target!==r && !target.contact_issue.includes(issue))target.contact_issue=target.contact_issue?target.contact_issue+' '+issue:issue;
    if(chosen && !target.contact_cards.some(c=>c.supplier_id===r.supplier_id && c.id===chosen.id && (placement!=='step_items'||c.service_key===key)))target.contact_cards.push({...chosen,supplier_id:r.supplier_id,supplier:r.supplier,...(placement==='step_items'?{service_key:key,item_label:r.title||r.label||'Item'}:{})});
    r.rule_reason=r.rule_reason || 'Contact Details '+(onStep?'appears on the '+(parent?.step_type||'parent')+' step.':'appears inside this service.');
  }
  for(const r of Object.values(result))if(!r.fid_contact && r.module==='Booking_Steps' && r.contact_step_sources && override(r.key).contact_mode==='choose' && override(r.key).contact_id && !r.contact_candidate_ids.includes(override(r.key).contact_id)){
    r.contact_cards=[];r.contact_issue='The selected contact is no longer a Reservations contact for an included supplier.';
  }
  return result;
}
export function renderSupplierContacts(record) {
  const e=escapeRuleHtml,merged=new Map();
  const normalized=v=>String(v||'').trim().replace(/\s+/g,' ').toLowerCase();
  for(const c of record?.contact_cards||[]){
    const phone=String(c.phone||'').replace(/[^+\d]/g,'');
    // Without an ID require name, supplier, phone AND email; never merge by name/centralita alone.
    const key=c.id?'id:'+c.id:c.name&&phone&&c.email?'data:'+JSON.stringify([normalized(c.name),normalized(c.supplier),phone,normalized(c.email)]):Symbol();
    if(!merged.has(key))merged.set(key,{names:new Set(),suppliers:new Set(),phones:new Set(),emails:new Set(),addresses:new Set(),items:new Set()});
    const m=merged.get(key);
    for(const [key,value] of [['names',c.name],['suppliers',c.supplier],['phones',c.phone],['emails',c.email],['addresses',c.address],['items',c.item_label]])if(String(value||'').trim()&&!([...m[key]].some(v=>key==='phones'?v.replace(/[^+\d]/g,'')===phone:normalized(v)===normalized(value))))m[key].add(String(value).trim());
  }
  if(!merged.size)return '';
  return '<div class="fid-supplier-contacts"><h5>Contact details</h5>'+[...merged.values()].map(c=>'<article class="fid-supplier-contact"><strong>'+e([...c.suppliers].join(' / '))+'</strong>'+([...c.names].join(' / ')!==[...c.suppliers].join(' / ')?'<span class="fid-contact-name">'+e([...c.names].join(' / '))+'</span>':'')+[...c.phones].map(p=>'<a href="tel:'+e(p.replace(/[^+\d]/g,''))+'">'+e(p)+'</a>').join('')+(c.addresses.size?'<p class="fid-contact-address">'+e([...c.addresses].join(' / '))+'</p>':'')+'</article>').join('')+'</div>';
}
export async function loadSupplierClassifications(records,api,isCurrent=()=>true,sessionCache=null,settings={},blocks=[]) {
  const rules=documentRules(settings);
  const unfiltered=map=>Object.fromEntries(Object.entries(map).map(([key,rule])=>[key,{...rule,...(rule.contact_filter==='supplier_subcategories'?{contact_filter:'all'}:{})}]));
  const categoryRules={...rules.step_categories};
  for(const parent of Object.values(records).filter(r=>r.module==='Booking_Steps')){const key=normRule(parent.step_category);if(!categoryRules[key])categoryRules[key]=ruleForStepCategory(rules,key,parent.step_type);}
  const eligible=applyServiceRules(records,blocks,{...settings,rules:{...settings.rules,types:unfiltered(rules.types),step_categories:unfiltered(categoryRules)}});
  const needed=Object.values(records).filter(r=>{
    if(r.module!=='Booking_Services'||r.active===false||!/^\d+$/.test(r.supplier_id||''))return false;
    const parent=eligible['crm-step:'+r.step_id];
    const rule=ruleForStepCategory(rules,parent?.step_category,parent?.step_type);
    return eligible[r.key]?.contact_required && rule.contact_filter==='supplier_subcategories';
  });
  const ids=[...new Set(needed.map(r=>r.supplier_id))],staged=new Map();let next=0;
  await Promise.all(Array.from({length:Math.min(4,ids.length)},async()=>{
    while(next<ids.length){
      if(!isCurrent())throw new Error('Document loading was cancelled.');
      const id=ids[next++],key='classification:'+id;
      let data=sessionCache?.get(key);
      if(!data){
        const raw=(await api.getRecord({Entity:'Vendors',RecordID:id}))?.data?.[0];
        if(String(raw?.id)!==id)throw new Error('Supplier classification could not be loaded. Retry loading the document.');
        data={subcategory:String(raw.Subcategory||''),modified_time:String(raw.Modified_Time||'')};
      }
      staged.set(key,data);
    }
  }));
  if(!isCurrent())throw new Error('Document loading was cancelled.');
  for(const [key,data] of staged)sessionCache?.set(key,data);
  for(const r of needed){const data=staged.get('classification:'+r.supplier_id);r.supplier_subcategory=data.subcategory;r.supplier_classification_modified=data.modified_time;}
}
export async function loadSupplierContacts(records,api,isCurrent=()=>true,onlyRequired=false,sessionCache=null) {
  const suppliers=[...new Set(Object.values(records).filter(r=>r.module==='Booking_Services' && !r.fid_contact && r.active!==false && (!onlyRequired || r.contact_required) && /^\d+$/.test(r.supplier_id||'')).map(r=>r.supplier_id))];
  const cache=new Map();let next=0;
  await Promise.all(Array.from({length:Math.min(4,suppliers.length)},async()=>{
    while(next<suppliers.length){const supplier=suppliers[next++];const contacts=[];
      if(!isCurrent())throw new Error('Document loading was cancelled.');
      if(sessionCache?.has(supplier)){cache.set(supplier,sessionCache.get(supplier));continue;}
      try{
        for(let page=1;page<=10;page++) {
          if(!isCurrent())throw new Error('Document loading was cancelled.');
          const response=await api.searchRecord({Entity:'Contacts',Type:'criteria',Query:'(Vendor_Name:equals:'+supplier+')',page,per_page:200},page,200);
          const batch=response?.data;
          if(!Array.isArray(batch)){if(response==null || response==='' || response?.status===204 || response?.code==='NO_CONTENT')break;throw new Error('Supplier contacts could not be loaded.');}
          for(const c of batch){
            const types=Array.isArray(c.Contact_Type)?c.Contact_Type:[c.Contact_Type];
            if(String(c.Vendor_Name?.id)!==supplier || !/^\d+$/.test(String(c.id)))continue;
            const phone=[c.Phone,c.Mobile].map(v=>String(v||'').trim()).find(v=>/\d/.test(v))||'';
            if(!phone)continue;
            contacts.push({reservations:types.includes('RE - Reservas'),id:String(c.id),name:String(c.Full_Name||[c.First_Name,c.Last_Name].filter(Boolean).join(' ')),phone,email:String(c.Email||''),address:[c.Mailing_Street,c.Mailing_City,c.Mailing_State,c.Mailing_Zip,c.Mailing_Country].filter(Boolean).join(', '),modified_time:String(c.Modified_Time||'')});
          }
          if(response?.info?.more_records===false || (response?.info?.more_records!==true && batch.length<200))break;
          if(page===10)throw new Error('Too many supplier contacts to confirm the selection.');
        }
        cache.set(supplier,{contacts:[...new Map(contacts.map(c=>[c.id,c])).values()].sort((a,b)=>a.id.localeCompare(b.id))});
      }catch(error){cache.set(supplier,{contacts:[],error:error.message});}
    }
  }));
  if(!isCurrent())throw new Error('Document loading was cancelled.');
  for(const [supplier,found] of cache)if(!found.error)sessionCache?.set(supplier,found);
  for(const r of Object.values(records))if(r.module==='Booking_Services'){const found=cache.get(r.supplier_id);r.supplier_contacts=found?.contacts||[];r.contact_load_error=found?.error||'';r.supplier_contacts_loaded=!!found&&!found.error;}
  return records;
}
export function contactFingerprint(records) {
  const contacts=new Map(),classifications=new Map();let failed=false;
  for(const r of Object.values(records)){if(r.fid_contact && r.contact_required!==false){const resolved=savedFIDContact(r);if(resolved.contact)contacts.set(resolved.contact.id,r.modified_time||'');}if(r.supplier_classification_required && r.supplier_classification_modified!==undefined)classifications.set(r.supplier_id,r.supplier_classification_modified);if(r.contact_required===false)continue;failed ||= !!r.contact_load_error;for(const c of r.supplier_contacts||[])contacts.set(c.id,c.modified_time);}
  return [...classifications.keys()].sort().map(id=>'supplier:'+id+':'+classifications.get(id)+'|').join('')+(failed?'contacts:unconfirmed|':'')+[...contacts.keys()].sort().map(id=>'contact:'+id+':'+contacts.get(id)+'|').join('');
}
