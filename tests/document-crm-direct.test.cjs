const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const c=vm.createContext({canManageDocuments:state=>state.admin});
const grouping=fs.readFileSync(require('node:path').join(__dirname,'../app/js/documents-api.js'),'utf8');
vm.runInContext(grouping.slice(grouping.indexOf('export function groupDocumentBlocks'),grouping.indexOf('export function buildBlockEdit')).replace(/^export /gm,''),c);
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../app/js/document-presentation.js'),'utf8').replace(/^export /gm,''),c);
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../app/js/document-service-rules.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''),c);
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../app/js/document-crm-direct.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''),c);
const record=()=>({module:'Booking_Steps',id:'12',booking_id:'34',key:'crm-step:12',step_id:'12',modified_time:'v1',fields:[{api_name:'Long_Description',label:'Description',type:'textarea',max_length:32000,value:'Old',included:false},{api_name:'Start_Date_Time',label:'Start',type:'datetime',max_length:120,value:''}]});
const raw=()=>({id:'12',Booking:{id:'34'},Modified_Time:'v1',Status:'Active',Long_Description:'Old',Short_Description:'A visit'});

test('transfer direction prefers the CRM field and falls back only when empty',()=>{
 for(const [field,notes,expected] of [
  ['Arrival',':dep old','Arrival'],['Departure',':arr old','Departure'],
  ['Unspecified',':arr old','Unspecified'],['Other',':dep','Unspecified'],
  [null,'  :ARR\nMeeting point','Arrival'],['',':dep: additional notes','Departure'],
  ['-None-',':arr','Arrival'],['','Text :arr','Unspecified'],
  ['',':departure','Unspecified'],['',':arrival','Unspecified'],['',null,'Unspecified']
 ])assert.equal(c.resolveTransferDirection({Transfer_Direction:field,Item_Notes:notes}),expected);
 const service={...record(),module:'Booking_Services',fields:[]};
 assert.equal(c.projectCRMRecord(service,{...raw(),Item_Notes:':arr notes'}).transfer_direction,'Arrival');
 assert.equal(c.projectCRMRecord(service,{...raw(),Transfer_Direction:'Departure',Item_Notes:':arr'}).transfer_direction,'Departure');
});

test('accommodation presentation uses the CRM type and refreshes it after changes',()=>{
 const hotel=c.projectCRMRecord(record(),{...raw(),Step_Type:'accommodation'});
 assert.equal(hotel.step_type,'accommodation');
 assert.equal(c.projectCRMRecord(hotel,{...raw(),Step_Type:'transport'}).step_type,'transport');
 assert.equal(c.projectCRMRecord(hotel,raw()).step_type,'');
});
test('only ground transportation and taxis receive transfer labels',()=>{
 const service={...record(),module:'Booking_Services',fields:[]};
 for(const subcategory of ['Ground Transportation','Taxi']) {
  const base={...raw(),Category:'Transport',Subcategory:subcategory};
  assert.equal(c.projectCRMRecord(service,{...base,Item_Notes:':arr meet here'}).transfer_label,'Arrival Transfer');
  assert.equal(c.projectCRMRecord(service,{...base,Transfer_Direction:'Departure',Item_Notes:':arr'}).transfer_label,'Departure Transfer');
  assert.equal(c.projectCRMRecord(service,base).transfer_label,'Transfer');
  assert.equal(c.projectCRMRecord(service,{...base,Transfer_Direction:'Unspecified',Item_Notes:':arr'}).transfer_label,'Transfer');
 }
 assert.equal(c.projectCRMRecord(service,{...raw(),Category:'Transport',Subcategory:'Hospitality & Assistance Services',Item_Notes:':arr'}).transfer_label,'');
});
test('FID services require the operational checkbox and always exclude optional, cancelled and deleted records',()=>{
 const service={...record(),module:'Booking_Services',fields:[]};
 const included={id:'12',Requires_Operational_Management:true,Status:'Confirmed'};
 assert.equal(c.projectCRMRecord(service,included).active,true);
 for(const patch of [{Requires_Operational_Management:false},{Requires_Operational_Management:undefined},{Requires_Operational_Management:'false'},{Delete:true},{Status:'Optional'},{Status:'Cancelled'},{Status:'Cancelled w/charges'},{Status_EZUS:'Optional'},{Status_EZUS:'Cancelled'},{Status_EZUS:'Cancelled with Charges'}])assert.equal(c.projectCRMRecord(service,{...included,...patch}).active,false);
});
test('document variants use structured CRM branding and keep guest visibility independent',()=>{
 const branding={company:'Agency & Co',contact:'Agent',designer:'Sales person'};
 assert.match(c.documentPresentation({},branding).journey_suffix,/In collaboration with: Agent, Agency & Co/);
 for(const type of ['Private_Clients','Wendy_Perrin'])assert.doesNotMatch(c.documentPresentation({proposal_type:type},branding).journey_suffix,/collaboration/);
 assert.match(c.documentPresentation({proposal_type:'Wendy_Perrin'},branding).journey_suffix,/Virginia Irurita and Sales person/);
 const crmBooking=c.projectCRMRecord({module:'Deals',fields:[]},{Sales_Rep:{name:'Virginia Irurita'},Reservation_Rep:{name:'Reservations person'}});
 assert.equal(crmBooking.branding.designers.join('|'),'Virginia Irurita|Reservations person');
 assert.equal(c.documentPresentation({proposal_type:'Wendy_Perrin'},crmBooking.branding).journey_suffix,'\nDesigned and prepared by: Virginia Irurita and Reservations person');
 assert.equal(c.documentPresentation({}, {designers:['Same person','same person']}).journey_suffix,'\nDesigned and prepared by: Same person');
 assert.match(c.documentPresentation({proposal_type:'Agent_Trip'},branding).journey_suffix,/Travel Agency: Agency & Co/);
 assert.equal(c.documentPresentation({proposal_type:'Cobranding',partner_logo_url:'https://example.com/logo.png'},branding).partner_logo,'https://example.com/logo.png');
 assert.equal(c.documentPresentation({proposal_type:'Private_Clients',partner_logo_url:'https://example.com/logo.png'},branding).partner_logo,'');
 assert.equal(c.documentPresentation({proposal_type:'Cobranding',partner_logo_url:'javascript:alert(1)'},branding).partner_logo,'');
 const booking={fields:[{api_name:'Travellers_Number',value:'4',included:false}],branding};
 const result=c.mergeCRMResponse({document:{settings:{proposal_type:'Agent_Trip'}},sources:[{booking_id:'34'}],crm_records:{}},'booking:34',booking);
 assert.doesNotMatch(result.journey_body,/Number of guests/);
 assert.match(result.journey_body,/Travel Agency/);
});
test('direct save checks ownership and stale data, uses SDK and projects confirmed CRM values',async()=>{
 const r=raw(),calls=[];
 const api={getRecord:async config=>{calls.push(['get',config]);return {data:[{...r}]};},updateRecord:async config=>{calls.push(['update',config]);Object.assign(r,config.APIData,{Modified_Time:'v2',Long_Description:'CRM normalized'});return {data:[{code:'SUCCESS',details:{id:'12'}}]};}};
 const result=await c.saveStudioCRM({admin:true},record(),{Long_Description:'New'},{api});
 assert.deepEqual(calls.map(x=>x[0]),['get','update','get']);
 assert.equal(calls[1][1].APIData.Long_Description,'New');
 assert.equal(result.record.fields[0].value,'CRM normalized');assert.equal(result.record.description,'');
 assert.equal(result.raw.Long_Description,'CRM normalized');assert.equal(result.record.modified_time,'v2');
});
test('access, membership and stale writes are rejected before update',async()=>{
 let writes=0;const r=raw();const api={getRecord:async()=>({data:[r]}),updateRecord:async()=>{writes++;}};
 await assert.rejects(c.saveStudioCRM({admin:false},record(),{Long_Description:'New'},{api}),/access/);
 r.Booking.id='99';await assert.rejects(c.saveStudioCRM({admin:true},record(),{Long_Description:'New'},{api}),/belongs/);
 r.Booking.id='34';r.Modified_Time='v2';await assert.rejects(c.saveStudioCRM({admin:true},record(),{Long_Description:'New'},{api}),/changed/);
 assert.equal(writes,0);
});
test('rejects unexpected fields, bad dates and date order; clears become null',()=>{
 assert.throws(()=>c.prepareCRMUpdate(record(),{Booking:'99'}),/not editable/);
 assert.equal(c.prepareCRMUpdate(record(),{Long_Description:''}).Long_Description,null);
 const r={...record(),id:'34',module:'Deals',fields:[{api_name:'Arrival_Date',label:'Arrival',type:'date',max_length:20,value:'2026-07-12'},{api_name:'Departure_Date',label:'Departure',type:'date',max_length:20,value:'2026-07-20'}]};
 assert.throws(()=>c.prepareCRMUpdate(r,{Arrival_Date:'2026-02-30'}),/valid date/);
 assert.throws(()=>c.prepareCRMUpdate(r,{Arrival_Date:'2026-07-21'}),/before/);
});
test('post-save read failure requires reload and never retries the write',async()=>{
 let reads=0,writes=0;const api={getRecord:async()=>{if(++reads>1)throw new Error('offline');return {data:[raw()]};},updateRecord:async()=>{writes++;return {data:[{code:'SUCCESS',details:{id:'12'}}]};}};
 await assert.rejects(c.saveStudioCRM({admin:true},record(),{Long_Description:'New'},{api}),error=>error.requiresReload && error.crmMayHaveChanged);
 assert.equal(writes,1);
});
test('CRM denial is not treated as a successful write',async()=>{
 const api={getRecord:async()=>({data:[raw()]}),updateRecord:async()=>({data:[{code:'NO_PERMISSION',message:'Not allowed'}]})};
 await assert.rejects(c.saveStudioCRM({admin:true},record(),{Long_Description:'New'},{api}),/Not allowed/);
});
test('merging direct CRM data preserves document revision and invalidates generated preview',()=>{
 const r={fields:[{api_name:'Arrival_Date',value:'2026-07-11'},{api_name:'Departure_Date',value:'2026-07-21'},{api_name:'Travellers_Number',value:'2',included:false}]};
 const response={document:{revision:4},sources:[{booking_id:'34'}],crm_records:{},generation_current:true};
 const updated=c.mergeCRMResponse(response,'booking:34',r);
 assert.equal(updated.document.revision,4);assert.equal(updated.generation_current,false);assert.equal(updated.journey_body,'Travel dates: 2026-07-11 - 2026-07-21');assert.equal(response.generation_current,true);
});

function loadFixture(){return {crm_load_required:true,document:{type:'FID',status:'Draft',revision:2},sources:[{id:'1',booking_id:'34'}],blocks:[{key:'template:journey:part:0',origin:'Template',order:0,visibility:'Included',body:'Saved dates'},...Array.from({length:8},(_,i)=>({key:'crm-step:'+String(i+10)+':part:0',origin:'CRM',source_id:'1',step_id:String(i+10),order:i+1,visibility:'Included',body:'Old snapshot',hidden_fields:i===0?['crm-step:10|Long_Description']:[]}))],crm_schema:{Deals:[{api_name:'Arrival_Date',type:'date',max_length:20,label:'Arrival'}],Booking_Steps:[{api_name:'Short_Description',type:'text',max_length:255,label:'Title'},{api_name:'Long_Description',type:'textarea',max_length:32000,label:'Description'}],Booking_Services:[]}};}
test('initial CRM load uses at most four parallel reads and never mutates snapshots',async()=>{
 const response=loadFixture();let active=0,max=0,calls=0;
 const loaded=await c.loadStudioCRM({admin:true},response,{api:{getRecord:async config=>{calls++;active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,2));active--;return {data:[{id:config.RecordID,Booking:{id:'34'},Modified_Time:'v1',Status:'Active',Short_Description:'Fresh title',Long_Description:'Fresh body',Arrival_Date:'2026-07-12'}]};}}});
 assert.equal(calls,9);assert.equal(max,4);assert.equal(loaded.crm_records['crm-step:10'].title,'Fresh title');assert.equal(loaded.crm_records['crm-step:10'].description,'');assert.equal(loaded.journey_body,'Travel dates: 2026-07-12');assert.equal(response.blocks[1].body,'Old snapshot');assert.equal(response.crm_records,undefined);
});
test('incomplete, forbidden or cancelled loading never returns partially editable CRM data',async()=>{
 const response=loadFixture();let calls=0;const state={admin:true};
 await assert.rejects(c.loadStudioCRM(state,response,{api:{getRecord:async()=>{calls++;return {data:[]};}}}),/could not be loaded/);assert.ok(calls<=4);
 calls=0;await assert.rejects(c.loadStudioCRM(state,response,{isCurrent:()=>false,api:{getRecord:async()=>{calls++;}}}),/cancelled/);assert.equal(calls,0);
 const wrong={...response,crm_schema:{}};await assert.rejects(c.loadStudioCRM(state,wrong,{api:{}}),/incomplete/);
});
test('legacy server-loaded payloads need no additional requests',async()=>{
 const response={crm_live:true};assert.equal(await c.loadStudioCRM({admin:true},response,{api:{getRecord:()=>{throw new Error('Unexpected read');}}}),response);
});

test('session reuse avoids repeated CRM reads but reprojects field visibility and loads new records',async()=>{
 const response=loadFixture(),rawCache=new Map(),supplierCache=new Map();let reads=0;
 const api={getRecord:async({Entity,RecordID})=>{reads++;return {data:[{id:RecordID,Booking:{id:'34'},Status:'Active',Short_Description:'Title',Long_Description:'Keep this text',Modified_Time:'v1'}]};}};
 await c.loadStudioCRM({admin:true},response,{api,rawCache,supplierCache});assert.equal(reads,9);
 response.blocks[1].hidden_fields=[];response.document.revision++;
 let loaded=await c.loadStudioCRM({admin:true},response,{api,rawCache,supplierCache});assert.equal(reads,9);assert.equal(loaded.crm_records['crm-step:10'].fields[1].included,true);assert.equal(loaded.crm_records['crm-step:10'].fields[1].value,'Keep this text');
 response.blocks.push({key:'crm-step:99:part:0',origin:'CRM',source_id:'1',step_id:'99',visibility:'Included',order:20});
 await c.loadStudioCRM({admin:true},response,{api,rawCache,supplierCache});assert.equal(reads,10);
 rawCache.clear();supplierCache.clear();await c.loadStudioCRM({admin:true},response,{api,rawCache,supplierCache});assert.equal(reads,20);
 await assert.rejects(c.loadStudioCRM({admin:true},response,{api,rawCache,supplierCache,isCurrent:()=>false}),/cancelled/);assert.equal(reads,20);
});

test('failed CRM loads never commit a partial raw session cache',async()=>{
 const rawCache=new Map();await assert.rejects(c.loadStudioCRM({admin:true},loadFixture(),{rawCache,api:{getRecord:async({RecordID})=>({data:RecordID==='10'?[]:[{id:RecordID,Booking:{id:'34'}}]})}}),/could not be loaded/);assert.equal(rawCache.size,0);
});

test('booking reference lookup is direct, exact and handles duplicates, errors and cancellation',async()=>{
 let query;const api={searchRecord:async request=>{query=request;return {data:[{id:'88',MFSP_Reference:'MFOF260001',Deal_Name:'New booking'}]};}};
 const found=await c.lookupStudioBooking({admin:true},' mfof260001 ',{api});assert.equal(found.booking.id,'88');assert.equal(query.Entity,'Deals');
 await assert.rejects(c.lookupStudioBooking({admin:true},'MFOF260001',{api,sourceBookingIds:new Set(['88'])}),/already/);
 await assert.rejects(c.lookupStudioBooking({admin:true},'bad:query',{api}),/valid/);
 await assert.rejects(c.lookupStudioBooking({admin:true},'MFOF260001',{api:{searchRecord:async()=>({code:'NO_PERMISSION'})}}),/could not/);
 await assert.rejects(c.lookupStudioBooking({admin:true},'MFOF260001',{api,isCurrent:()=>false}),/access/);
});

test('24h lookup selects the Ezus team by ID and is independent of editable fields',()=>{
 const seed={module:'Deals',id:'34',booking_id:'34',fields:[]};
 for(const [id,name,team,phone] of [['616617000004053072','Paloma','Paloma and Laura','+34 666 163 105'],['616617000004054001','Mar?a','Maria and Natalia','+34 686 167 510']]){
  const r=c.projectCRMRecord(seed,{id:'34',Hour_Rep:{id,name},Modified_Time:'v1'});
  const doc=c.mergeCRMResponse({document:{settings:{}},sources:[{booking_id:'34'}],crm_records:{}},'booking:34',r);
  assert.equal(doc.document.presentation.emergency_contact.rep_name,name);
  assert.equal(doc.document.presentation.emergency_contact.team,team);
  assert.ok(doc.document.presentation.emergency_contact.html.includes(phone));
  assert.equal((doc.document.presentation.emergency_contact.html.match(/<img /g)||[]).length,2);
  assert.throws(()=>c.prepareCRMUpdate({...seed,key:'booking:34'},{Hour_Rep:id}),/not editable/);
 }
 for(const rep of [{},{id:'unknown',name:'Another person'}]){
  const contacts=c.documentEmergencyContact(rep);assert.equal(contacts.team,'');assert.ok(!contacts.html.includes('tel:'));assert.ok(!contacts.html.includes('<img '));
 }
});

test('Extra steps are excluded regardless of casing while normal active steps stay included',()=>{
 for(const type of ['extra','Extra',' EXTRA '])assert.equal(c.projectCRMRecord(record(),{...raw(),Step_Type:type}).active,false);
 assert.equal(c.projectCRMRecord(record(),{...raw(),Step_Type:'transport'}).active,true);
});


test('untouched steps hide End by default while explicit visibility and accommodation dates survive',()=>{
 const seed={...record(),visibility_configured:false,fields:[{api_name:'End_Date_Time',included:true}]};
 const data={...raw(),End_Date_Time:'2026-07-15T11:00:00+02:00'};
 assert.equal(c.projectCRMRecord(seed,data).fields[0].included,false);
 assert.equal(c.projectCRMRecord({...seed,visibility_configured:true},data).fields[0].included,true);
 assert.equal(c.projectCRMRecord(seed,{...data,Step_Type:'accommodation'}).fields[0].included,true);
});

test('sync and Creator prefix rules agree with Studio for multiline and misleading notes',()=>{
 const paths=['../_local/integrations/crm/source/syncservicesfromezuswithtoken.dg','../_local/integrations/document-generator/creator/functions/getDocumentCRMRecord.deluge'];
 for(const file of paths){
  const source=fs.readFileSync(require('node:path').join(__dirname,file),'utf8');
  const patterns=[...source.matchAll(/transferNotes\.matches\("([^"\n]+)"\)/g)].map(m=>new RegExp(m[1]));
  assert.equal(patterns.length,2);
  for(const notes of [':arr',':DEP extra',':arr\nMeet driver',' :dep\tNotes',':arrival',':departure','text :arr','',':arr: notes']){
   const normalized=notes.trim().toLowerCase().replace(/[\r\n\t]/g,' ');
   const actual=patterns[0].test(normalized)?'Arrival':patterns[1].test(normalized)?'Departure':'Unspecified';
   assert.equal(actual,c.resolveTransferDirection({Item_Notes:notes}),file+' '+notes);
  }
 }
 const sync=fs.readFileSync(require('node:path').join(__dirname,paths[0]),'utf8');
 assert.ok(sync.includes('serviceCRMMap.put("Transfer_Direction",transferDirection)'));
 assert.ok(sync.includes('serviceCRMMap.put("Item_Notes",standalone.safeTextOrMsg(itemNotes'));
});

test('document contact team overrides remain document-scoped and automatic uses CRM',()=>{
 const branding={hour_rep:{id:'616617000004053072',name:'Paloma'}};
 assert.equal(c.documentPresentation({},branding).emergency_contact.rep_id,'616617000004053072');
 assert.equal(c.documentPresentation({rules:{emergency_team:'616617000004054001'}},branding).emergency_contact.rep_id,'616617000004054001');
 assert.equal(c.documentPresentation({rules:{emergency_team:''}},branding).emergency_contact.rep_id,'616617000004053072');
 assert.equal(branding.hour_rep.id,'616617000004053072');
});

test('Creator accepts and preserves the document contact team through settings saves',()=>{
 const dir=require('node:path').join(__dirname,'../_local/integrations/document-generator/creator/functions');
 const read=name=>fs.readFileSync(require('node:path').join(dir,name+'.deluge'),'utf8');
 assert.ok(read('travelDocumentEditor').includes('newRules.put("emergency_team",ifnull(settings.get("rules").get("emergency_team"),""))'));
 assert.ok(read('parseDocumentRules').includes('"emergency_team":emergencyTeam'));
 assert.ok(read('parseDocumentRules').includes('Invalid document contact team.'));
 assert.ok(read('documentPresentation').includes('teamRep = {"id":selectedTeam}'));
});

test('Step Category is read directly from CRM independently of displayed fields',()=>{
 const projected=c.projectCRMRecord(record(),{...raw(),Step_Type:'activity',Step_Category:'Arrival/Departure Services - Airport'});
 assert.equal(projected.step_category,'Arrival/Departure Services - Airport');
 assert.equal(c.projectCRMRecord(projected,{...raw(),Step_Category:'Experience'}).step_category,'Experience');
 assert.equal(c.projectCRMRecord(projected,{...raw(),Step_Category:null}).step_category,'');
});

test('document loading classifies suppliers before fetching only included contacts',async()=>{
 const response=loadFixture();response.crm_schema.Booking_Services=[];response.document.settings={rules:{contact_defaults_version:1,step_categories:{experience:c.initialStepCategorySettings({},'Experience','activity')}}};
 response.blocks.push(...['41','42'].map((id,i)=>({key:'crm-service:'+id+':part:0',origin:'CRM',source_id:'1',step_id:'10',service_id:id,visibility:'Included',order:30+i})));
 const requests=[],supplierCache=new Map();
 const api={getRecord:async({Entity,RecordID})=>{
  requests.push(Entity+':'+RecordID);
  if(Entity==='Vendors')return {data:[{id:RecordID,Subcategory:RecordID==='51'?'Guide':'Taxi',Modified_Time:'vendor-v1'}]};
  if(Entity==='Booking_Services')return {data:[{id:RecordID,Booking:{id:'34'},Step:{id:'10'},Supplier:{id:RecordID==='41'?'51':'52',name:'Supplier'},Requires_Operational_Management:true,Modified_Time:'v1'}]};
  return {data:[{id:RecordID,Booking:{id:'34'},Step_Type:'activity',Step_Category:'Experience',Status:'Active',Modified_Time:'v1'}]};
 },searchRecord:async args=>{requests.push(args.Query);return {data:[{id:'91',Vendor_Name:{id:'51'},Contact_Type:'RE - Reservas',Full_Name:'Reservations',Phone:'123'}]};}};
 const loaded=await c.loadStudioCRM({admin:true},response,{api,supplierCache});
 assert.ok(requests.includes('Vendors:51'));assert.ok(requests.includes('Vendors:52'));
 assert.equal(requests.filter(x=>x==='(Vendor_Name:equals:51)').length,1);assert.equal(requests.includes('(Vendor_Name:equals:52)'),false);
 assert.equal(loaded.crm_records['crm-step:10'].contact_cards.length,1);
 assert.equal(loaded.crm_records['crm-service:42'].contact_required,false);
});

test('transfer direction provenance distinguishes CRM, note fallback and missing direction',()=>{
 const service={...record(),module:'Booking_Services',fields:[]};
 for(const [field,notes,source] of [['Arrival',':dep','field'],['Unspecified',':arr','field'],['',':dep notes','item_notes'],['-None-',':arr notes','item_notes'],['','Meeting point','none']]){
  assert.equal(c.projectCRMRecord(service,{...raw(),Transfer_Direction:field,Item_Notes:notes}).transfer_direction_source,source);
 }
});

test('Duration defaults to hidden on all step types and preserves an explicit selection',()=>{
 for(const type of ['activity','accommodation','transport']){
  const original={...record(),visibility_configured:false,fields:[{api_name:'Duration',value:'',included:true}]};
  const data={...raw(),Step_Type:type,Duration:'2 hours'};
  assert.equal(c.projectCRMRecord(original,data).fields[0].included,false);
  assert.equal(c.projectCRMRecord({...original,visibility_configured:true},data).fields[0].included,true);
  assert.equal(c.projectCRMRecord({...original,visibility_configured:true,fields:[{api_name:'Duration',included:false}]},data).fields[0].included,false);
 }
 const creator=fs.readFileSync(require('node:path').join(__dirname,'../_local/integrations/document-generator/creator/functions/getDocumentCRMRecord.deluge'),'utf8');
 assert.ok(creator.includes('hiddenFields.add(recordKey + "|Duration")'));
});

function managedRecord(){
 return {...record(),fid_contact:{mode:'Automatic',status:'Resolved',name:'Before',phone:'123'},fields:[
  {api_name:'FID_Contact_Name',label:'FID Contact Name',type:'text',max_length:255,value:'Before',contact_setting:true},
  {api_name:'FID_Contact_Phone',label:'FID Contact Phone',type:'text',max_length:255,value:'123',contact_setting:true},
  {api_name:'FID_Contact_Mode',label:'FID Contact Mode',type:'picklist',max_length:120,value:'Automatic',options:['Automatic','Manual'],contact_setting:true},
  {api_name:'FID_Contact_Status',label:'FID Contact Status',type:'picklist',max_length:120,value:'Resolved',options:['Pending','Resolved','Not found','Needs selection'],contact_setting:true}
 ]};
}
test('editing shared contact text switches to Manual and explicit automatic retry clears only contact values',()=>{
 let data=c.prepareCRMUpdate(managedRecord(),{FID_Contact_Name:'New person'});
 assert.equal(data.FID_Contact_Mode,'Manual');assert.equal(data.FID_Contact_Status,'Resolved');
 data=c.prepareCRMUpdate(managedRecord(),{FID_Contact_Status:'Pending'});
 assert.equal(data.FID_Contact_Name,null);assert.equal(data.FID_Contact_Phone,null);assert.equal(data.FID_Contact_Mode,'Automatic');
 data=c.prepareCRMUpdate(managedRecord(),{FID_Contact_Mode:'Manual',FID_Contact_Status:'Pending'});
 assert.equal(data.FID_Contact_Mode,'Manual');assert.equal(data.FID_Contact_Status,'Resolved');assert.equal(data.FID_Contact_Phone,undefined);
 assert.throws(()=>c.prepareCRMUpdate(managedRecord(),{FID_Contact_Status:'Other'}),/valid/);
});
test('projected FID contact settings stay structured and never enter the body text',()=>{
 const projected=c.projectCRMRecord(managedRecord(),{...raw(),FID_Contact_Name:'Saved contact',FID_Contact_Phone:'456',FID_Contact_Mode:'Manual',FID_Contact_Status:'Resolved'});
 assert.equal(projected.fid_contact.name,'Saved contact');assert.equal(projected.fid_contact.phone,'456');
 assert.ok(!projected.body.includes('Saved contact'));assert.ok(!projected.body.includes('FID Contact Mode'));
});
