const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const c=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/js/document-service-rules.js'),'utf8').replace(/^export /gm,''),c);
const contact=(id='10')=>({id,name:'Reservations',phone:'+34 123',email:'hotel@example.com',address:'Madrid',modified_time:'v1'});
const base=(type='accommodation')=>({'crm-step:1':{key:'crm-step:1',module:'Booking_Steps',step_id:'1',step_type:type,active:true},'crm-service:2':{key:'crm-service:2',module:'Booking_Services',step_id:'1',supplier_id:'5',supplier:'Hotel <test>',category:'room',active:true,supplier_contacts:[contact()]},'crm-service:3':{key:'crm-service:3',module:'Booking_Services',step_id:'1',supplier_id:'5',supplier:'Hotel <test>',category:'room',active:true,supplier_contacts:[contact()]}});
test('accommodation deduplicates contacts on parent, other steps keep contacts on services',()=>{
 const hotel=c.applyServiceRules(base());assert.equal(hotel['crm-step:1'].contact_cards.length,1);assert.equal(hotel['crm-service:2'].contact_cards.length,0);
 const normal=c.applyServiceRules(base('transport'));assert.equal(normal['crm-step:1'].contact_cards.length,0);assert.equal(normal['crm-service:2'].contact_cards.length,1);
 assert.ok(c.renderSupplierContacts(hotel['crm-step:1']).includes('Hotel &lt;test&gt;'));
});
test('type service rules and individual overrides cannot override CRM or parent exclusions',()=>{
 const settings={rules:{types:{accommodation:{services:'none',contacts:'step'}},sections:{'crm-service:3':{appearance:'shown'}}}};
 let r=c.applyServiceRules(base(),[],settings);assert.equal(r['crm-service:2'].document_visible,false);assert.equal(r['crm-service:3'].document_visible,true);assert.equal(r['crm-step:1'].contact_cards.length,1);
 r=c.applyServiceRules(base(),[{key:'crm-step:1:part:0',visibility:'Hidden'}],settings);assert.equal(r['crm-service:3'].document_visible,false);assert.equal(r['crm-step:1'].contact_cards.length,0);
 const disabled=base();disabled['crm-service:3'].active=false;r=c.applyServiceRules(disabled,[],settings);assert.equal(r['crm-service:3'].document_visible,false);
});
test('category filters, hidden contacts and invalid choices are explicit',()=>{
 const records=base('transport');records['crm-service:2'].supplier_contacts.push(contact('11'));records['crm-service:3'].category='transfer';
 let r=c.applyServiceRules(records);assert.match(r['crm-service:2'].contact_issue,/Choose/);assert.equal(r['crm-service:2'].contact_cards.length,0);
 r=c.applyServiceRules(records,[],{rules:{types:{transport:{services:'categories',categories:['transfer'],contacts:'service'}},sections:{'crm-service:3':{contact_mode:'hidden'}}}});assert.equal(r['crm-service:2'].document_visible,false);assert.equal(r['crm-service:3'].contact_cards.length,0);
 r=c.applyServiceRules(records,[],{rules:{sections:{'crm-service:2':{contact_mode:'choose',contact_id:'11'}}}});assert.equal(r['crm-service:2'].contact_cards[0].id,'11');
 r=c.applyServiceRules(base(),[],{rules:{sections:{'crm-step:1':{contact_mode:'choose',contact_id:'999'}}}});assert.match(r['crm-step:1'].contact_issue,/no longer/);assert.equal(r['crm-step:1'].contact_cards.length,0);
});
test('loads each supplier once, filters by type and ownership, and fingerprints contact changes',async()=>{
 const records=base();let calls=0;
 await c.loadSupplierContacts(records,{searchRecord:async()=>{calls++;return {data:[{id:'10',Vendor_Name:{id:'5'},Contact_Type:'RE - Reservas',Full_Name:'Reservations',Phone:'123',Modified_Time:'v2'},{id:'11',Vendor_Name:{id:'5'},Contact_Type:'Other'},{id:'12',Vendor_Name:{id:'999'},Contact_Type:'RE - Reservas'}],info:{more_records:false}};}});
 assert.equal(calls,1);assert.equal(records['crm-service:2'].supplier_contacts.length,1);assert.equal(records['crm-service:3'].supplier_contacts[0].id,'10');assert.equal(c.contactFingerprint(records),'contact:10:v2|');
});
test('contact pagination is complete and permission failures are never treated as no contacts',async()=>{
 const records=base();let pages=[];
 await c.loadSupplierContacts(records,{searchRecord:async(opts,page)=>{pages.push(page);return {data:page===1?[{id:'10',Vendor_Name:{id:'5'},Contact_Type:['RE - Reservas'],Phone:'123'}]:[{id:'11',Vendor_Name:{id:'5'},Contact_Type:'RE - Reservas',Phone:'456'}],info:{more_records:page===1}};}});assert.deepEqual(pages,[1,2]);assert.equal(records['crm-service:2'].supplier_contacts.length,2);
 await c.loadSupplierContacts(records,{searchRecord:async()=>({code:'NO_PERMISSION'})});assert.ok(records['crm-service:2'].contact_load_error);assert.match(c.contactFingerprint(records),/unconfirmed/);
});

test('empty supplier responses omit contacts without inventing a contact or an error',async()=>{
 for(const response of [null,'',{status:204},{data:[]}]){const records=base();await c.loadSupplierContacts(records,{searchRecord:async()=>response});assert.equal(records['crm-service:2'].supplier_contacts.length,0);assert.equal(records['crm-service:2'].contact_load_error,'');}
});

test('experience hides item details but keeps independent contacts identified by product',()=>{
 const records=base('Experience');records['crm-service:2'].title='Private guide';records['crm-service:3'].title='Winery <visit>';
 let r=c.applyServiceRules(records);
 assert.equal(r['crm-service:2'].document_visible,false);assert.equal(r['crm-service:3'].contact_required,true);
 assert.equal(r['crm-step:1'].contact_cards.length,2);assert.equal(r['crm-step:1'].contact_cards[1].item_label,'Winery <visit>');
 assert.doesNotMatch(c.renderSupplierContacts(r['crm-step:1']),/Winery|Private guide|fid-contact-item/);
 r=c.applyServiceRules(records,[],{rules:{types:{experience:{services:'all',contacts:'service'}}}});
 assert.equal(r['crm-service:2'].document_visible,true);assert.equal(r['crm-service:2'].contact_cards.length,1);
 r=c.applyServiceRules(records,[{key:'crm-step:1:part:0',visibility:'Hidden'}]);assert.equal(r['crm-step:1'].contact_cards.length,0);
});

test('item supplier filters and contact category filters are independent and preserve overrides',()=>{
 const records=base('transport');records['crm-service:3'].supplier_id='6';records['crm-service:3'].category='guide';
 const settings={rules:{types:{transport:{services:'suppliers',suppliers:['5'],contacts:'step_items',contact_filter:'categories',contact_categories:['guide']}}}};
 let r=c.applyServiceRules(records,[],settings);assert.equal(r['crm-service:2'].document_visible,true);assert.equal(r['crm-service:2'].contact_required,false);
 assert.equal(r['crm-service:3'].document_visible,false);assert.equal(r['crm-step:1'].contact_cards.length,1);assert.equal(r['crm-step:1'].contact_cards[0].supplier_id,'6');
 settings.rules.sections={'crm-service:3':{appearance:'shown',contact_mode:'hidden'}};
 r=c.applyServiceRules(records,[],settings);assert.equal(r['crm-service:3'].document_visible,true);assert.equal(r['crm-step:1'].contact_cards.length,0);
 settings.rules.types.transport.contact_filter='suppliers';settings.rules.types.transport.contact_suppliers=['5'];
 r=c.applyServiceRules(records,[],settings);assert.equal(r['crm-step:1'].contact_cards[0].supplier_id,'5');
});

test('initial contact loading requests only required suppliers and supports explicit loading later',async()=>{
 const records=base('experience');records['crm-service:3'].supplier_id='6';
 const planned=c.applyServiceRules(records,[],{rules:{types:{experience:{services:'none',contacts:'step_items',contact_filter:'suppliers',contact_suppliers:['5']}}}});
 const calls=[],api={searchRecord:async request=>{calls.push(request.Query);return {data:[]};}};
 await c.loadSupplierContacts(planned,api,()=>true,true);assert.equal(calls.length,1);assert.match(calls[0],/:5\)/);
 assert.equal(planned['crm-service:2'].supplier_contacts_loaded,true);assert.equal(planned['crm-service:3'].supplier_contacts_loaded,false);
 await c.loadSupplierContacts({'crm-service:3':planned['crm-service:3']},api);assert.equal(calls.length,2);assert.match(calls[1],/:6\)/);
});

test('Creator accepts, persists and renders the same rules without requiring all supplier contacts',()=>{
 const root=path.join(__dirname,'../_local/integrations/document-generator/creator/functions');
 const read=name=>fs.readFileSync(path.join(root,name+'.deluge'),'utf8');
 const parser=read('parseDocumentRules'),apply=read('applyDocumentServiceRulesCached');
 for(const field of ['suppliers','contact_filter','contact_categories','contact_suppliers'])assert.ok(parser.includes('"'+field+'":'),field+' is retained by the parser');
 assert.ok(parser.includes('"step_items"'));assert.ok(parser.includes('Invalid contact supplier.'));
 assert.ok(apply.indexOf('contactFilter == "suppliers"')<apply.indexOf('if(showContact)'));
 assert.ok(apply.includes('placement != "step_items" || existing.get("service_key") == key'));
 assert.ok(!read('renderSupplierContactCards').includes('fid-contact-item'));
 assert.ok(read('createTravelDocumentDraft').includes('Document_Rules_JSON = initialRules.get("json")'));
 assert.ok(read('travelDocumentEditor').includes('newRules.put("types",ifnull(settings.get("rules").get("types"),Map()))'));
});

test('only the unique reservations contact with a phone is automatic; other phone contacts require a choice',async()=>{
 const record={supplier_contacts:[{id:'1',phone:'',reservations:true},{id:'2',phone:'123',reservations:true},{id:'3',phone:'456',reservations:false}]};
 assert.equal(c.resolveSupplierContact(record).contact.id,'2');assert.equal(c.resolveSupplierContact(record,'3').contact.id,'3');
 record.supplier_contacts.push({id:'4',phone:'789',reservations:true});assert.equal(c.resolveSupplierContact(record).contact,null);
 record.supplier_contacts=record.supplier_contacts.filter(x=>x.reservations===false);assert.equal(c.resolveSupplierContact(record).contact,null);assert.match(c.resolveSupplierContact(record).issue,/Choose/);
 assert.match(c.resolveSupplierContact(record,'2').issue,/unavailable/);
 const records=base();await c.loadSupplierContacts(records,{searchRecord:async()=>({data:[{id:'20',Vendor_Name:{id:'5'},Contact_Type:'Other',Phone:' ',Mobile:'678'},{id:'21',Vendor_Name:{id:'5'},Contact_Type:'RE - Reservas',Phone:''},{id:'22',Vendor_Name:{id:'9'},Phone:'123'}]})});
 assert.equal(records['crm-service:2'].supplier_contacts.length,1);assert.equal(records['crm-service:2'].supplier_contacts[0].reservations,false);assert.equal(records['crm-service:2'].supplier_contacts[0].phone,'678');
});

test('explicit contact visibility overrides defaults, while hidden parents and CRM exclusions win',()=>{
 const settings={rules:{types:{experience:{services:'none',contacts:'hidden'}},sections:{'crm-service:2':{contact_mode:'shown'}}}};
 let records=c.applyServiceRules(base('experience'),[],settings);assert.equal(records['crm-step:1'].contact_cards.length,1);assert.equal(records['crm-service:2'].document_visible,false);
 settings.rules.sections['crm-step:1']={contact_mode:'hidden'};records=c.applyServiceRules(base('experience'),[],settings);assert.equal(records['crm-step:1'].contact_cards.length,0);
 settings.rules.sections['crm-step:1']={contact_mode:'shown'};records=c.applyServiceRules(base('experience'),[],settings);assert.equal(records['crm-step:1'].contact_cards.length,2);
 records=c.applyServiceRules(base('experience'),[{key:'crm-step:1:part:0',visibility:'Hidden'}],settings);assert.equal(records['crm-step:1'].contact_cards.length,0);
});

test('step contact choices remain independent per supplier and validate membership',()=>{
 const source=base();source['crm-service:3'].supplier_id='6';source['crm-service:3'].supplier_contacts=[contact('12'),contact('13')];
 const settings={rules:{sections:{'crm-step:1':{contact_mode:'choose',contact_ids:{'5':'10','6':'13'}}}}};
 let result=c.applyServiceRules(source,[],settings);assert.deepEqual(Array.from(result['crm-step:1'].contact_cards,c=>c.id),['10','13']);
 settings.rules.sections['crm-step:1'].contact_ids['6']='10';result=c.applyServiceRules(source,[],settings);assert.equal(result['crm-service:3'].contact_cards.length,0);assert.match(result['crm-service:3'].contact_issue,/unavailable/);
});

test('apply-to-all requires confirmation and a current revision, resetting only draft CRM visibility',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../_local/integrations/document-generator/creator/functions/travelDocumentEditor.deluge'),'utf8');
 const save=source.slice(source.indexOf('if(action == "save_settings")'),source.indexOf('if(action == "generate")'));
 assert.ok(save.indexOf('toLong() != revision')<save.indexOf('resetBlock.Visibility'));
 assert.ok(save.includes('applyToAll && settings.get("confirmed") != true'));
 assert.ok(save.includes('if(applyToAll) { newRules.put("sections",Map()); }'));
 assert.ok(save.includes('Document_Version == null && Origin_Type == "CRM"'));
 assert.ok(save.indexOf('document.Draft_Revision = revision + 1')<save.indexOf('resetBlock.Visibility'));
 assert.ok(!save.includes('Hidden_Fields_JSON ='));assert.ok(!save.includes('Body_Text ='));assert.ok(!save.includes('Image_URL ='));
});

test('supplier session cache reuses successful empty and populated results, but retries errors',async()=>{
 const session=new Map(),records=base();let calls=0;const api={searchRecord:async()=>{calls++;return {data:[]};}};
 await c.loadSupplierContacts(records,api,()=>true,false,session);await c.loadSupplierContacts(records,api,()=>true,false,session);assert.equal(calls,1);
 records['crm-service:3'].supplier_id='6';await c.loadSupplierContacts(records,api,()=>true,false,session);assert.equal(calls,2);
 session.clear();await c.loadSupplierContacts(records,{searchRecord:async()=>({code:'NO_PERMISSION'})},()=>true,false,session);assert.equal(session.size,0);
 await c.loadSupplierContacts(records,api,()=>true,false,session);assert.equal(calls,4);
});

test('Step Category distinguishes Experience and Transfer with the same activity type',()=>{
 const records=base('activity');for(const r of Object.values(records))if(r.module==='Booking_Services')r.supplier_subcategory='Guide';records['crm-step:1'].step_category=' Experience ';
 let r=c.applyServiceRules(records);assert.equal(r['crm-service:2'].document_visible,false);assert.equal(r['crm-service:2'].contact_placement,'step');
 records['crm-step:1'].step_category='Transfer';r=c.applyServiceRules(records);assert.equal(r['crm-service:2'].document_visible,true);assert.equal(r['crm-service:2'].contact_placement,'item');
 records['crm-step:1'].step_category='Hotel NBTM';r=c.applyServiceRules(records);assert.equal(r['crm-step:1'].contact_cards.length,1);
});
test('category rules override legacy type rules without losing individual overrides or CRM exclusions',()=>{
 const records=base('activity');records['crm-step:1'].step_category='Arrival/Departure Services - Airport';
 const settings={rules:{types:{activity:{services:'all',contacts:'service'}},step_categories:{'arrival/departure services - airport':{services:'none',contacts:'step_items'}},sections:{'crm-service:3':{appearance:'shown'}}}};
 let r=c.applyServiceRules(records,[],settings);assert.equal(r['crm-service:2'].document_visible,false);assert.equal(r['crm-service:3'].document_visible,true);
 records['crm-step:1'].active=false;r=c.applyServiceRules(records,[],settings);assert.equal(r['crm-service:3'].document_visible,false);
});
test('legacy documents retain type rules until a category rule is saved; new categories use wildcard',()=>{
 const records=base('activity');records['crm-step:1'].step_category='Experience';
 let r=c.applyServiceRules(records,[],{rules:{types:{activity:{services:'all',contacts:'service'}}}});assert.equal(r['crm-service:2'].document_visible,true);
 records['crm-step:1'].step_category='Future / category & name';r=c.applyServiceRules(records,[],{rules:{step_categories:{'*':{services:'none',contacts:'hidden'}}}});assert.equal(r['crm-service:2'].document_visible,false);assert.equal(r['crm-service:2'].contact_required,false);
});

test('hidden category steps suppress their items and contacts, even explicit item overrides',()=>{
 const records=base('activity');records['crm-step:1'].step_category='Experience';
 const settings={rules:{step_categories:{experience:{step_visibility:'hidden',services:'all',contacts:'step_items'}},sections:{'crm-service:2':{appearance:'shown',contact_mode:'shown'}}}};
 let r=c.applyServiceRules(records,[],settings);assert.equal(r['crm-step:1'].document_visible,false);assert.equal(r['crm-service:2'].document_visible,false);assert.equal(r['crm-service:2'].contact_required,false);assert.equal(r['crm-step:1'].contact_cards.length,0);
 settings.rules.sections['crm-step:1']={appearance:'shown'};r=c.applyServiceRules(records,[],settings);assert.equal(r['crm-step:1'].document_visible,true);assert.equal(r['crm-service:2'].document_visible,true);assert.equal(r['crm-service:2'].contact_required,true);
 records['crm-step:1'].active=false;r=c.applyServiceRules(records,[],settings);assert.equal(r['crm-step:1'].document_visible,false);assert.equal(r['crm-service:2'].document_visible,false);
});
test('old category rules default to shown, and Creator validates and applies step visibility before items',()=>{
 assert.equal(c.ruleForStepCategory({step_categories:{experience:{services:'none'}}},'Experience').step_visibility,'shown');
 const root=path.join(__dirname,'../_local/integrations/document-generator/creator/functions');
 assert.match(fs.readFileSync(path.join(root,'parseDocumentRules.deluge'),'utf8'),/Invalid step visibility/);
 const source=fs.readFileSync(path.join(root,'applyDocumentServiceRulesCached.deluge'),'utf8');assert.ok(source.indexOf('Hidden by Step Category settings.')<source.indexOf('parentKey ='));
});

test('Extra and Agent Commission can never be enabled by category or individual overrides',()=>{
 for(const [type,category] of [[' ExTrA ','Transfer'],['activity','Agent Commission'],['activity','Agent Comission']]){
  const records=base(type);records['crm-step:1'].step_category=category;
  const r=c.applyServiceRules(records,[],{rules:{step_categories:{'*':{step_visibility:'shown',services:'all',contacts:'step_items'}},sections:{'crm-step:1':{appearance:'shown',contact_mode:'shown'},'crm-service:2':{appearance:'shown',contact_mode:'shown'}}}});
  assert.equal(r['crm-step:1'].document_visible,false);assert.equal(r['crm-service:2'].document_visible,false);assert.equal(r['crm-service:2'].contact_required,false);
 }
});

test('supplier subcategory defaults use Vendors classification, exclude Taxi and preserve explicit rules',()=>{
 const records=base('activity');records['crm-step:1'].step_category='Experience';
 const settings={rules:{contact_defaults_version:1,step_categories:{experience:c.initialStepCategorySettings({},'Experience','activity')}}};
 records['crm-service:2'].supplier_subcategory=' Guide ';records['crm-service:2'].category='Tickets';
 records['crm-service:3'].supplier_subcategory='Taxi';records['crm-service:3'].category='Guide';
 let r=c.applyServiceRules(records,[],settings);assert.equal(r['crm-service:2'].contact_required,true);assert.equal(r['crm-service:3'].contact_required,false);
 r=c.applyServiceRules(records,[],{rules:{step_categories:{experience:{services:'none',contacts:'step_items',contact_filter:'all'}}}});assert.equal(r['crm-service:3'].contact_required,true);
 records['crm-step:1'].step_category='Restaurants';r=c.applyServiceRules(records);assert.equal(r['crm-step:1'].contact_cards.length,1);assert.equal(r['crm-service:2'].contact_cards.length,0);
 assert.equal(c.initialStepCategorySettings({},'Experience').contact_subcategories.length,15);
});
test('supplier classification reads are direct, deduplicated, cached and skip hidden steps',async()=>{
 const records=base('activity');records['crm-step:1'].step_category='Experience';
 const settings={rules:{contact_defaults_version:1,step_categories:{experience:c.initialStepCategorySettings({},'Experience','activity')}}};
 const cache=new Map();let reads=0;const api={getRecord:async args=>{reads++;assert.equal(args.Entity,'Vendors');return {data:[{id:args.RecordID,Subcategory:'Guide',Modified_Time:'vendor-v1'}]};}};
 await c.loadSupplierClassifications(records,api,()=>true,cache,settings);assert.equal(reads,1);assert.equal(records['crm-service:2'].supplier_subcategory,'Guide');
 await c.loadSupplierClassifications(records,api,()=>true,cache,settings);assert.equal(reads,1);
 let contacts=0;const resolved=c.applyServiceRules(records,[],settings);await c.loadSupplierContacts(resolved,{searchRecord:async()=>{contacts++;return {data:[]};}},()=>true,true,cache);assert.equal(contacts,1);
 assert.match(c.contactFingerprint(resolved),/supplier:5:vendor-v1/);
 const hidden={rules:{sections:{'crm-step:1':{appearance:'hidden'}}}};await c.loadSupplierClassifications(records,api,()=>true,new Map(),{rules:{...settings.rules,...hidden.rules}});assert.equal(reads,1);
 assert.doesNotMatch(c.contactFingerprint(c.applyServiceRules(records,[],hidden)),/supplier:/);
 const failedCache=new Map();await assert.rejects(c.loadSupplierClassifications(records,{getRecord:async()=>({data:[]})},()=>true,failedCache,settings),/classification/);assert.equal(failedCache.size,0);
 await assert.rejects(c.loadSupplierClassifications(records,api,()=>false,failedCache,settings),/cancelled/);assert.equal(failedCache.size,0);
});
test('Creator supplier filtering is batched and new document defaults match Studio',()=>{
 const root=path.join(__dirname,'../_local/integrations/document-generator/creator/functions');
 const source=fs.readFileSync(path.join(root,'createTravelDocumentDraft.deluge'),'utf8');
 const encoded=source.match(/initialRules = thisapp.parseDocumentRules\((".*")\);/)[1];const rules=JSON.parse(JSON.parse(encoded));
 const expected=c.initialStepCategorySettings({},'Experience');assert.deepEqual(rules.step_categories.experience.contact_subcategories,Array.from(expected.contact_subcategories));
 assert.equal(rules.step_categories.restaurants.contacts,'step');assert.equal(rules.step_categories.restaurants.contact_filter,'all');
 assert.match(fs.readFileSync(path.join(root,'generateTravelDocument.deluge'),'utf8'),/NEED_SUPPLIER/);
 assert.match(fs.readFileSync(path.join(root,'getDocumentSupplierClassification.deluge'),'utf8'),/getRecordById\("Vendors"/);
});

test('supplier defaults initialize settings once; saved empty or custom selections remain authoritative',()=>{
 const old={types:{activity:{services:'all',contacts:'service',contact_filter:'all'}}};
 const initial=c.initialStepCategorySettings(old,'Transfer','activity');assert.equal(initial.contact_filter,'supplier_subcategories');assert.equal(initial.contact_subcategories.length,15);
 const rules={contact_defaults_version:1,step_categories:{transfer:{...initial,contact_subcategories:[]}}};
 assert.equal(c.initialStepCategorySettings(rules,'Transfer','activity').contact_subcategories.length,0);
 const records=base('activity');records['crm-step:1'].step_category='Transfer';records['crm-service:2'].supplier_subcategory='Guide';
 assert.equal(c.applyServiceRules(records,[],{rules})['crm-service:2'].contact_required,false);
 rules.step_categories.transfer.contact_subcategories=['taxi'];records['crm-service:2'].supplier_subcategory='Taxi';
 assert.equal(c.applyServiceRules(records,[],{rules})['crm-service:2'].contact_required,true);
 rules.step_categories.transfer.contact_filter='all';assert.equal(c.initialStepCategorySettings(rules,'Transfer','activity').contact_filter,'all');
 assert.equal(c.ruleForStepCategory(old,'Transfer','activity').contact_filter,'all');
});

const managed=()=>{
 const records=base('transport');
 for(const [key,r] of Object.entries(records)){
  r.id=key.split(':')[1];
  r.modified_time='v1';
  r.fid_contact={mode:'Automatic',status:'Pending',name:'',phone:'',source:'Document Default',visibility:'Document Default'};
 }
 return records;
};
test('shared CRM contacts respect service visibility, source selection and category defaults',()=>{
 const records=managed();
 records['crm-service:2'].fid_contact={...records['crm-service:2'].fid_contact,name:'Saved person',phone:'123',status:'Resolved',visibility:'Show'};
 records['crm-service:3'].fid_contact={...records['crm-service:2'].fid_contact,visibility:'Hide'};
 const settings={rules:{types:{transport:{contacts:'hidden',contact_filter:'suppliers',contact_suppliers:[]}},sections:{'crm-service:2':{contact_mode:'hidden'}}}};
 let r=c.applyServiceRules(records,[],settings);
 assert.equal(r['crm-service:2'].contact_cards[0].name,'Saved person');
 assert.equal(r['crm-service:3'].contact_cards.length,0);
 records['crm-step:1'].fid_contact.source='None';
 r=c.applyServiceRules(records,[],settings);assert.equal(r['crm-service:2'].contact_required,false);
 records['crm-step:1'].fid_contact={...records['crm-step:1'].fid_contact,source:'Step Contact',mode:'Manual',name:'Step person',phone:'456'};
 r=c.applyServiceRules(records,[],settings);assert.equal(r['crm-step:1'].contact_cards[0].name,'Step person');assert.equal(r['crm-service:2'].contact_required,false);
 records['crm-step:1'].fid_contact.source='Service Contacts';
 records['crm-service:2'].fid_contact.visibility='Document Default';
 r=c.applyServiceRules(records,[],settings);assert.equal(r['crm-service:2'].contact_required,false,'source does not override category supplier filters');
});

test('manual, terminal and pending saved contacts never search Contacts when opening Studio',async()=>{
 for(const state of ['Pending','Resolved','Not found','Needs selection'])for(const mode of ['Automatic','Manual']){
  const records=managed();
  records['crm-service:2'].fid_contact.status=state;records['crm-service:2'].fid_contact.mode=mode;
  await c.loadSupplierContacts(records,{searchRecord:()=>assert.fail('shared CRM contacts must not trigger preload')});
  const r=c.applyServiceRules(records);
  assert.ok(r['crm-service:2'].contact_issue);
  assert.equal(r['crm-service:2'].contact_cards.length,0);
 }
});

test('saved manual contacts share names across documents and respect inactive and hidden parents',()=>{
 const records=managed();records['crm-service:2'].fid_contact={mode:'Manual',name:'<Manual>',phone:'+34 123',visibility:'Show'};
 const r=c.applyServiceRules(records);assert.equal(r['crm-service:2'].contact_cards[0].name,'<Manual>');assert.ok(c.renderSupplierContacts(r['crm-service:2']).includes('&lt;Manual&gt;'));
 records['crm-step:1'].active=false;
 assert.equal(c.applyServiceRules(records)['crm-service:2'].contact_cards.length,0);
 records['crm-step:1'].active=true;
 assert.equal(c.applyServiceRules(records,[{key:'crm-step:1:part:0',visibility:'Hidden'}])['crm-service:2'].contact_cards.length,0);
});

test('CRM contact settings are separated from rendered content and pending writes require current membership',()=>{
 const root=path.join(__dirname,'../_local/integrations/document-generator/creator/functions');const read=n=>fs.readFileSync(path.join(root,n+'.deluge'),'utf8');
 const save=read('saveDocumentFIDContact');
 assert.match(save,/thisapp.getDocumentCRMRecord\(documentId,recordKey\)/);
 assert.match(save,/record.get\("modified_time"\) != expectedModified/);
 assert.match(save,/saved.get\("mode"\) == "Manual"/);
 assert.match(save,/terminalStates.contains\(saved.get\("status"\)\)/);
 assert.match(read('getDocumentCRMRecord'),/contact_setting/);
 assert.match(read('renderDocumentCategoryBody'),/field.get\("contact_setting"\) != true/);
 assert.match(read('generateTravelDocument'),/NEED_FID_SAVE/);
});
