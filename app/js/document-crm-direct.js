import { applyServiceRules, loadSupplierClassifications, loadSupplierContacts, contactFingerprint } from './document-service-rules.js';
import { canManageDocuments, groupDocumentBlocks } from './documents-api.js';
import { documentPresentation } from './document-presentation.js';

const modules = new Set(['Deals','Booking_Steps','Booking_Services']);
const id = value => /^\d+$/.test(String(value || ''));
const value = (record,name) => String(record[name] ?? '');
export function resolveTransferDirection(raw) {
  const saved=value(raw,'Transfer_Direction').trim().toLowerCase();
  if(saved && saved!=='-none-')return saved==='arrival'?'Arrival':saved==='departure'?'Departure':'Unspecified';
  const marker=/^:(arr|dep)(?=$|[\s:;,./()-])/i.exec(value(raw,'Item_Notes').trim());
  return marker?.[1].toLowerCase()==='arr'?'Arrival':marker?'Departure':'Unspecified';
}
export function projectCRMRecord(previous, raw) {
  const fields=previous.fields.map(field=>({...field,value:value(raw,field.api_name),...(previous.visibility_configured===false && previous.module==='Booking_Steps' && (field.api_name==='Duration' || (value(raw,'Step_Type').trim().toLowerCase()!=='accommodation' && field.api_name==='End_Date_Time'))?{included:false}:{})}));
  const visible=name=>fields.find(field=>field.api_name===name)?.included !== false;
  const shown=name=>visible(name)?value(raw,name):'';
  const service=previous.module==='Booking_Services';
  const transferDirection=service?resolveTransferDirection(raw):'';
  const savedTransferDirection=value(raw,'Transfer_Direction').trim();
  const transferDirectionSource=!service?'':savedTransferDirection&&savedTransferDirection.toLowerCase()!=='-none-'?'field':transferDirection!=='Unspecified'?'item_notes':'none';
  const isTransfer=service && value(raw,'Category').trim().toLowerCase()==='transport' && ['ground transportation','taxi'].includes(value(raw,'Subcategory').trim().toLowerCase());
  const transferLabel=isTransfer?(transferDirection==='Unspecified'?'Transfer':transferDirection+' Transfer'):'';
  const titleField=service?'Product_Description':'Short_Description';
  const title=previous.module==='Deals'?value(raw,'Deal_Name'):(visible(titleField)?(shown(titleField).trim() || (service?'Service':value(raw,'Name'))):'');
  const description=shown(service?'Product_Description':'Long_Description');
  const supplier=service?String(raw.Supplier?.name || raw.Supplier_Name || ''):'';
  const start=value(raw,service?'Service_Date_Time':'Start_Date_Time');
  const details=fields.filter(field=>!field.contact_setting && field.included!==false && field.value.trim() && !['Short_Description','Long_Description','Product_Description'].includes(field.api_name) && field.type!=='datetime').map(field=>field.label+':\n'+field.value);
  const operational=raw.Requires_Operational_Management===true;
  const active=previous.module==='Deals' || (service ? operational && raw.Delete!==true && !['Cancelled','Cancelled with Charges','Optional'].includes(raw.Status_EZUS) && !['Cancelled','Cancelled w/charges','Optional'].includes(raw.Status) : raw.Status==='Active' && value(raw,'Step_Type').trim().toLowerCase()!=='extra');
  const branding=previous.module==='Deals'?{hour_rep:raw.Hour_Rep || {},company:raw.Account_Name?.name || '',contact:raw.Contact_Name?.name || '',designers:[raw.Sales_Rep,raw.Reservation_Rep].map(person=>person?.name || person?.full_name || '').filter(Boolean)}:undefined;
  previous={...previous,supplier_id:service?String(raw.Supplier?.id||''):'',category:service?value(raw,'Category'):'',operational,branding,city:String(raw.Subdestination?.name || (typeof raw.Subdestination==='string'?raw.Subdestination:'')),step_type:previous.module==='Booking_Steps'?value(raw,'Step_Type'):'',step_category:previous.module==='Booking_Steps'?value(raw,'Step_Category'):''};
  const fidFields=fields.some(f=>f.api_name==='FID_Contact_Mode');
  const fid_contact=fidFields?Object.fromEntries(['Name','Phone','Mode','Status','Visibility','Source'].map(key=>[key.toLowerCase(),value(raw,'FID_Contact_'+key)])):undefined;
  return {...previous,...(fidFields?{fid_contact}:{}),transfer_direction_source:transferDirectionSource,transfer_direction:transferDirection,transfer_label:transferLabel,fields,title,label:title||previous.label,description,supplier,start,end:shown('End_Date_Time'),show_start:visible(service?'Service_Date_Time':'Start_Date_Time'),step_id:service?String(raw.Step?.id||''):previous.step_id,active,body:[description,supplier?'Supplier: '+supplier:'',...details].filter(Boolean).join('\n\n'),modified_time:value(raw,'Modified_Time')};
}
export function mergeCRMResponse(response, key, record) {
  const records=applyServiceRules({...response.crm_records,[key]:record},response.blocks,response.document?.settings);
  const bookings=(response.sources||[]).map(source=>records['booking:'+source.booking_id]).filter(Boolean);
  const field=(booking,name)=>{const f=booking?.fields.find(item=>item.api_name===name);return f?.included!==false?String(f?.value||''):'';};
  const arrivals=bookings.map(b=>field(b,'Arrival_Date')).filter(Boolean).sort();
  const departures=bookings.map(b=>field(b,'Departure_Date')).filter(Boolean).sort();
  const dates=[arrivals[0],departures.at(-1)].filter(Boolean).join(' - ');
  const guests=field(bookings[0],'Travellers_Number'), reference=field(bookings[0],'MFSP_Reference');
  const journey=[dates?'Travel dates: '+dates:'',guests?'Number of guests: '+guests:'',reference?'Reference number: '+reference:''].filter(Boolean).join('\n');
  const presentation=documentPresentation(response.document?.settings,bookings[0]?.branding);
  return {...response,document:{...response.document,presentation},crm_records:records,journey_body:journey+presentation.journey_suffix,generation_current:false};
}
export function prepareCRMUpdate(record, changes) {
  if(!modules.has(record.module) || !id(record.id) || !id(record.booking_id))throw new Error('Invalid CRM source. Reopen the document.');
  if(record.module==='Deals' && String(record.id)!==String(record.booking_id))throw new Error('Invalid booking source. Reopen the document.');
  const apiData={id:String(record.id)}, merged=Object.fromEntries(record.fields.map(f=>[f.api_name,String(f.value??'')]));
  if(!Object.keys(changes).length)throw new Error('No CRM changes to save.');
  for(const [name,input] of Object.entries(changes)) {
    const field=record.fields.find(f=>f.api_name===name);
    if(!field || field.read_only || ['id','Booking','Step','Status','Delete'].includes(name))throw new Error('This field is not editable from Document Studio.');
    const text=String(input??'');
    if(text.length>field.max_length)throw new Error(field.label+' is too long.');
    if(text && field.type==='integer' && !/^\d{1,9}$/.test(text))throw new Error(field.label+' requires a non-negative whole number.');
    if(text && field.type==='date' && (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString().slice(0,10)!==text))throw new Error(field.label+' requires a valid date.');
    if(text && field.type==='datetime' && (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(text) || !Number.isFinite(Date.parse(text))))throw new Error(field.label+' requires an ISO date/time with timezone.');
    if(field.type==='picklist' && text && !(field.options||[]).includes(text))throw new Error('Choose a valid '+field.label+'.');
    apiData[name]=text===''?null:field.type==='integer'?Number(text):text;merged[name]=text;
  }
  if(record.fid_contact){
    const mode=merged.FID_Contact_Mode||'Automatic';
    if(changes.FID_Contact_Status==='Pending' && mode!=='Manual'){
      apiData.FID_Contact_Name=null;apiData.FID_Contact_Phone=null;apiData.FID_Contact_Mode='Automatic';
    }else if(Object.hasOwn(changes,'FID_Contact_Name')||Object.hasOwn(changes,'FID_Contact_Phone')||changes.FID_Contact_Mode==='Manual'){
      apiData.FID_Contact_Mode='Manual';
      apiData.FID_Contact_Status=merged.FID_Contact_Name?.trim() && /\d/.test(merged.FID_Contact_Phone||'')?'Resolved':'Needs selection';
    }
  }
  for(const [from,to] of [['Arrival_Date','Departure_Date'],['Hotel_Check_In','Hotel_Check_Out']])if(merged[from]&&merged[to]&&merged[from]>merged[to])throw new Error('The end date cannot be before the start date.');
  return apiData;
}
export async function saveStudioCRM(state, record, changes, options={}) {
  const api=options.api||ZOHO.CRM.API;
  const allowed=()=>canManageDocuments(state) && (!options.isCurrent || options.isCurrent());
  if(!allowed())throw new Error('Document access is no longer available.');
  const data=prepareCRMUpdate(record,changes);
  const get=async()=>{
    const response=await api.getRecord({Entity:record.module,RecordID:String(record.id)});
    const raw=response?.data?.[0];
    if(!raw || String(raw.id)!==String(record.id))throw new Error('CRM record could not be read.');
    if(record.module!=='Deals' && String(raw.Booking?.id)!==String(record.booking_id))throw new Error('This CRM record no longer belongs to the document booking.');
    return raw;
  };
  const before=await get();
  if(!record.modified_time || before.Modified_Time!==record.modified_time)throw new Error('This CRM record changed. Keep your text, reload CRM and review before saving.');
  if(!allowed())throw new Error('Document access is no longer available.');
  let result;
  try { result=await api.updateRecord({Entity:record.module,APIData:data,Trigger:['workflow','approval','blueprint','orchestration']}); }
  catch(cause) {const error=new Error('CRM could not confirm the update. Reload CRM before retrying.');error.requiresReload=true;error.crmMayHaveChanged=true;throw error;}
  const outcome=result?.data?.[0];
  if(outcome?.code!=='SUCCESS' || String(outcome.details?.id)!==String(record.id))throw new Error('CRM rejected the update: '+(outcome?.message||outcome?.code||'Unknown response'));
  let raw;
  try {raw=await get();} catch(cause){const error=new Error('Saved in CRM, but the updated record could not be loaded. Reload CRM before editing again.');error.requiresReload=true;error.crmMayHaveChanged=true;throw error;}
  const projected=projectCRMRecord(record,raw);
  try {if(options.records)await loadSupplierClassifications({...options.records,[projected.key]:projected},api,allowed,options.supplierCache,options.settings,options.blocks);}
  catch(cause){const error=new Error('Saved in CRM, but supplier classification could not be refreshed. Reload CRM before editing again.');error.requiresReload=true;error.crmMayHaveChanged=true;throw error;}
  await loadSupplierContacts({[projected.key]:projected},api,allowed,false,options.supplierCache);
  return {record:projected,raw,module:record.module,booking_id:record.booking_id};
}


// The document gateway supplies authorized links and field definitions, not cached CRM values.
export async function loadStudioCRM(state, response, options={}) {
  if (!response.crm_load_required) return response;
  if (!canManageDocuments(state) || response.document?.type!=='FID' || !(response.document?.status==='Draft' || (response.document?.status==='Published' && response.document?.render_mode==='Versioned'))) throw new Error('Current CRM data is not available for this document.');
  const api=options.api||ZOHO.CRM.API;
  const current=()=>canManageDocuments(state) && (!options.isCurrent || options.isCurrent());
  const groups=groupDocumentBlocks(response.blocks);
  const sources=new Map((response.sources||[]).map(source=>[String(source.id),String(source.booking_id)]));
  const seeds=new Map();
  const journey=groups.find(group=>group.key==='template:journey');
  function seed(key,module,recordId,bookingId,hidden,stepId='',visibilityConfigured=true) {
    if (!id(recordId)||!id(bookingId)||!Array.isArray(response.crm_schema?.[module])) throw new Error('The document CRM configuration is incomplete.');
    seeds.set(key,{key,module,id:String(recordId),booking_id:String(bookingId),step_id:stepId,visibility_configured:visibilityConfigured,fields:response.crm_schema[module].map(field=>({...field,included:!(hidden||[]).includes(key+'|'+field.api_name)}))});
  }
  for (const bookingId of sources.values()) seed('booking:'+bookingId,'Deals',bookingId,bookingId,journey?.hidden_fields);
  for (const group of groups) if(group.origin==='CRM') {
    const bookingId=sources.get(String(group.source_id));
    seed(group.key,group.service_id?'Booking_Services':'Booking_Steps',group.service_id||group.step_id,bookingId,group.hidden_fields,group.step_id,group.visibility_configured!==false);
  }
  if(!current())throw new Error('Document loading was cancelled.');
  const rawCache=options.rawCache||new Map(),stagedRaw=new Map();
  const queue=[...seeds.values()], records={};
  let next=0,complete=0,failure=null;
  await Promise.all(Array.from({length:Math.min(4,queue.length)},async()=>{
    while(!failure && next<queue.length) {
      if(!current()){failure=new Error('Document loading was cancelled.');break;}
      const record=queue[next++];
      try {
        const cacheKey=record.module+':'+record.id;
        const cached=rawCache.get(cacheKey);
        const raw=cached||((await api.getRecord({Entity:record.module,RecordID:record.id}))?.data?.[0]);
        if(!raw || String(raw.id)!==record.id || (record.module!=='Deals' && String(raw.Booking?.id)!==record.booking_id))throw new Error('A CRM record could not be loaded or no longer belongs to this booking.');
        if(!current())throw new Error('Document loading was cancelled.');
        records[record.key]=projectCRMRecord(record,raw);
        stagedRaw.set(cacheKey,raw);
        complete++;options.onProgress?.(complete,queue.length);
      } catch(error){failure ||= error;}
    }
  }));
  if(failure)throw failure;
  // Match the server's parent-activity exclusion policy.
  for(const record of Object.values(records)) if(record.module==='Booking_Services' && record.step_id && records['crm-step:'+record.step_id]?.active!==true)record.active=false;
  await loadSupplierClassifications(records,api,current,options.supplierCache,response.document?.settings,response.blocks);
  Object.assign(records,applyServiceRules(records,response.blocks,response.document?.settings));
  await loadSupplierContacts(records,api,current,true,options.supplierCache);
  if(!current())throw new Error('Document loading was cancelled.');
  for(const [key,raw] of stagedRaw)rawCache.set(key,raw);
  const first=Object.keys(records)[0];
  if(!first)throw new Error('The document has no CRM sources.');
  const loaded=mergeCRMResponse({...response,crm_records:records},first,records[first]);
  const fingerprint=Object.keys(records).sort().map(key=>key+':'+records[key].modified_time+'|').join('')+contactFingerprint(loaded.crm_records);
  return {...loaded,crm_load_required:false,crm_live:true,generation_current:!!response.generated_version_id && Number(response.generated_draft_revision)===Number(response.document.revision) && response.generated_crm_fingerprint===fingerprint};
}

// Read-only booking lookup belongs to CRM. Creator still validates an actual import.
export async function lookupStudioBooking(state,reference,options={}) {
  const current=()=>canManageDocuments(state)&&(!options.isCurrent||options.isCurrent());
  if(!current())throw new Error('Document access is no longer available.');
  reference=String(reference||'').trim().toUpperCase();
  if(!/^[A-Z0-9_-]{1,80}$/.test(reference))throw new Error('Enter a valid MFSP Reference.');
  const api=options.api||ZOHO.CRM.API;
  const response=await api.searchRecord({Entity:'Deals',Type:'criteria',Query:'(MFSP_Reference:equals:'+reference+')',page:1,per_page:200});
  if(!current())throw new Error('Document loading was cancelled.');
  let rows=response?.data;
  if(!Array.isArray(rows)){if(response==null||response===''||response?.status===204||response?.code==='NO_CONTENT')rows=[];else throw new Error('Booking lookup could not be completed.');}
  if(rows.length>=200||response?.info?.more_records===true)throw new Error('Too many bookings matched this reference. Review the MFSP Reference in CRM.');
  const matches=rows.filter(r=>String(r.MFSP_Reference||'').trim().toUpperCase()===reference);
  if(!matches.length)throw new Error('No booking found with this MFSP Reference.');
  if(matches.length!==1)throw new Error('More than one booking has this MFSP Reference.');
  const candidate=matches[0];if(!id(candidate.id))throw new Error('The booking returned an invalid identifier.');
  if(options.sourceBookingIds?.has(String(candidate.id)))throw new Error('This booking is already included.');
  return {status:'OK',booking:{id:String(candidate.id),name:String(candidate.Deal_Name||reference),reference:String(candidate.MFSP_Reference)}};
}
