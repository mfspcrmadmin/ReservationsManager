const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../app/js/document-studio-layout.js'), 'utf8');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const c = vm.createContext({ escapeHtml });
vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/js/document-presentation.js'),'utf8').replace(/^export /gm,''),c);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/js/document-service-rules.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''),c);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/js/document-text-format.js'),'utf8').replace(/^export /gm,''),c);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/js/document-editorial.js'),'utf8').replace(/^export /gm,''),c);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/js/document-crm-fields.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''),c);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/js/document-output-dates.js'),'utf8').replace(/^export /gm,''),c);
for(const file of ['document-category-config.js','document-category-layout.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/js',file),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''),c);
vm.runInContext(source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''), c);

test('outline groups days and services by the CRM parent while keeping every original edit index', () => {
  const groups=[
    {key:'cover',type:'Cover',title:'Cover',visible:true},
    {key:'service:2',origin:'CRM',title:'Room <safe>',service_id:'2',step_id:'1',start:'2026-08-09',visible:true},
    {key:'step:3',origin:'CRM',title:'Later activity',step_id:'3',start:'2026-08-02T09:00:00Z',visible:true},
    {key:'step:1',origin:'CRM',title:'Hotel',step_id:'1',start:'2026-08-01T15:00:00Z',visible:false},
    {key:'service:4',origin:'CRM',title:'Unassigned service',service_id:'4',step_id:'missing',visible:true}
  ];
  const html=c.renderStudioOutlineTree(groups,1);
  const indexes=[...html.matchAll(/data-section="(\d+)"/g)].map(match=>Number(match[1]));
  assert.deepEqual(indexes,[0,3,1,2,4]);
  assert.match(html,/studio-outline-services/);
  assert.match(html,/Room &lt;safe&gt;/);
  assert.match(html,/Excluded/);
  assert.match(html,/Dates to be confirmed/);
  assert.doesNotMatch(html,/2026-08-09/,'service date cannot detach it from its parent day');
  assert.equal((html.match(/data-outline-day=/g)||[]).length,3);
  assert.equal(groups[1].title,'Room <safe>','presentation does not mutate document groups');
});

test('structured journey edits preserve other fields, blank lines and CRLF', () => {
  const body = 'Travel dates: 12–20 July\r\n\r\nNumber of guests:  2\r\nReference number: ABC';
  assert.equal(c.journeyLines(body).length, 3);
  assert.equal(c.replaceJourneyLine(body, 2, '4'), body.replace('guests:  2', 'guests:  4'));
  assert.equal(c.journeyLines(body + '\nCustom information: keep me').length, 0);
  assert.throws(() => c.replaceJourneyLine(body, 1, 'wrong field'));
  assert.throws(() => c.replaceJourneyLine(body, 2, '4\nReference number: overwrite'));
});

test('generated summary escapes content and excludes hidden activities', () => {
  const block = {type:'Overview', title:'At a glance', body:'', parts:[{}]};
  const groups = [
    {origin:'CRM', visible:true, title:'<script>unsafe</script>', key:'a" onclick="bad', start:'2026-07-14T09:00:00+02:00'},
    {origin:'CRM', visible:false, title:'Hidden activity', key:'b', start:'2026-07-14T10:00:00+02:00'}
  ];
  const html = c.renderStudioPaper(block, {}, groups);
  assert.ok(html.includes('&lt;script&gt;unsafe&lt;/script&gt;'));
  assert.ok(html.includes('data-jump-key="a&quot; onclick=&quot;bad"'));
  assert.ok(!html.includes('Hidden activity'));
  assert.ok(html.includes('<time>9:00 AM</time>'));
});

test('journey preview preserves branding, custom text and cover dates without relaxing the editor parser', () => {
  const body='Travel dates: 12–20 July\r\nNumber of guests: 2\r\nReference number: ABC\r\nDesigned and prepared by: Sales & Reservations\r\nIn collaboration with: Agent <Agency>\r\nTravel Agency: Partner\r\nMeeting time: 10:30\r\nWelcome to Spain';
  const journey={key:'template:journey',type:'Journey_Info',body};
  const html=c.renderStudioPaper(journey,{type:'FID'},[journey]);
  for(const text of ['12–20 July','Number of guests','Reference number','Designed and prepared by','Sales &amp; Reservations','In collaboration with','Agent &lt;Agency&gt;','Travel Agency','10:30','Welcome to Spain'])assert.ok(html.includes(text),text);
  assert.match(c.renderStudioPaper({type:'Cover',body:''},{type:'FID'},[journey]),/studio-cover-dates/);
  assert.equal(c.journeyLines(body).length,0,'legacy inline editing stays strict');
  assert.doesNotMatch(c.renderStudioPaper({...journey,body:'Designed and prepared by: Sales'},{type:'FID'},[]),/Number of guests|Travel dates/);
});

test('FID room cards use the structured parent type and respect field visibility', () => {
  const parent={key:'crm-step:1',step_id:'1',origin:'CRM',visible:true,crmRecords:[{step_type:'accommodation',fields:[]}]};
  const field=(api_name,value,included=true)=>({api_name,label:api_name,value,included});
  const room={key:'crm-service:2',step_id:'1',service_id:'2',origin:'CRM',visible:true,title:'Suite',crmRecords:[{supplier:'Hotel <safe>',fields:[field('Product_Description','Suite <safe>'),field('Hotel_Check_In','2026-10-01'),field('Hotel_Check_Out','2026-10-04',false),field('Bedding','King'),field('Guests','Private guest',false),field('Distribution','')]}]};
  const html=c.renderStudioPaper(room,{type:'FID'},[parent,room]);
  assert.match(html,/fid-hotel-rooms/);
  assert.match(html,/data-preview-key="crm-service:2"/);
  assert.doesNotMatch(html,/fid-stay-card|Hotel_Check_In|Hotel_Check_Out/);
  assert.match(c.renderHotelStay(parent,[parent,room],{type:'FID'}),/Check-in/);
  assert.match(html,/Suite &lt;safe&gt;/);
  assert.equal((html.match(/Suite &lt;safe&gt;/g)||[]).length,1);
  assert.doesNotMatch(html,/Hotel &lt;safe&gt;|<dt[^>]*>Supplier<\/dt>/);
  assert.match(html,/King/);
  assert.doesNotMatch(html,/2026-10-04|Private guest|Distribution/);
  parent.crmRecords[0].step_type='activity';
  assert.doesNotMatch(c.renderStudioPaper(room,{type:'FID'},[parent,room]),/fid-hotel-rooms/);
  parent.crmRecords[0].step_type='accommodation';
  assert.doesNotMatch(c.renderStudioPaper(room,{type:'Proposal'},[parent,room]),/fid-hotel-rooms/);
  parent.visible=false;
  const program={type:'Itinerary',origin:'Template',title:'Program',body:''};
  assert.doesNotMatch(c.renderStudioPaper(program,{type:'FID'},[parent,room]),/fid-hotel-rooms/);
});

test('room cards omit empty fields and hidden descriptions without inventing room data', () => {
  const room={service_id:'2',step_id:'1',origin:'CRM',key:'room',crmRecords:[{fields:[{api_name:'Product_Description',value:'Hidden suite',included:false},{api_name:'Bedding',value:'   '}]}]};
  const parent={origin:'CRM',step_id:'1',crmRecords:[{step_type:'accommodation'}]};
  const html=c.renderStudioPaper(room,{type:'FID'},[parent,room]);
  assert.match(html,/Room details/);
  assert.doesNotMatch(html,/fid-room-card|fid-stay-card|Hidden suite/);
});

test('FID overview uses Ezus day headers, plain activity lines and stay badges without time columns',()=>{
 const overview={key:'template:overview',type:'Overview',title:'Itinerary at a glance',body:'Legacy introduction'};
 const groups=[
  {key:'visit',origin:'CRM',step_id:'1',visible:true,title:'Visit <old town>',start:'2026-07-14T09:00:00+02:00',crmRecords:[{city:'Madrid',fields:[]}]},
  {key:'hotel',origin:'CRM',step_id:'2',visible:true,title:'Hotel & Spa',start:'2026-07-14T15:00:00+02:00',crmRecords:[{step_type:'accommodation',end:'2026-07-16T12:00:00+02:00',fields:[]}]},
  {key:'tomorrow',origin:'CRM',visible:true,title:'Museum',start:'2026-07-15T11:00:00+02:00'},
  {key:'checkout',origin:'CRM',visible:true,title:'Departure',start:'2026-07-16T11:00:00+02:00'},
  {key:'hidden',origin:'CRM',step_id:'3',visible:false,title:'Hidden',start:'2026-07-14'},
  {key:'child',origin:'CRM',step_id:'3',service_id:'4',visible:true,title:'Hidden room',start:'2026-07-14'},
  {key:'cancelled',origin:'CRM',visible:true,crmActive:false,title:'Cancelled',start:'2026-07-14'}
 ];
 const html=c.renderStudioPaper(overview,{type:'FID'},groups);
 assert.match(html,/overview-text-head/);assert.match(html,/Day 1/);assert.match(html,/14 Jul 26/);assert.match(html,/Madrid/);
 assert.match(html,/Visit &lt;old town&gt;/);assert.equal((html.match(/STAY AT/g)||[]).length,2);
 assert.doesNotMatch(html,/09:00|15:00|<time|Legacy introduction|Cancelled|Hidden room|studio-itinerary-day/);
 assert.match(html,/data-jump-key="visit"/);
 assert.doesNotMatch(html,/<div class="overview-act-line">Hotel/);
});

test('editorial content preserves custom copy and escapes markup with CRLF and bullets',()=>{
 const html=c.renderDocumentEditorial('practical','Custom <intro>\r\nHotel Information\r\nCheck-in & Check-out\r\n\u2022 First <item>\r\n- Second\r\nCustom ending');
 assert.ok(html.includes('Custom &lt;intro&gt;'));
 assert.ok(html.includes('<li>First &lt;item&gt;</li><li>Second</li></ul><p>Custom ending</p>'));
 assert.ok(html.includes('class="things-subtitle">Check-in &amp; Check-out'));
 assert.equal((html.match(/<details /g)||[]).length,1);
 const closing=c.renderDocumentEditorial('closing','Custom welcome\nFinal <line>');
 assert.ok(closing.includes('Custom welcome<br><br><strong>Final &lt;line&gt;</strong>'));
 assert.equal((closing.match(/class="social-link"/g)||[]).length,3);
});

test('excluded Extra parents and their services never appear in overview or detailed program',()=>{
 const groups=[{key:'template:program',type:'Itinerary',origin:'Template',visible:true,title:'Program',body:''},
 {key:'crm-step:extra',type:'Activity',origin:'CRM',step_id:'extra',visible:true,crmActive:false,title:'Extra activity',start:'2026-07-12T09:00:00+02:00'},
 {key:'crm-service:extra',type:'Text',origin:'CRM',step_id:'extra',service_id:'service',visible:true,title:'Extra service',start:'2026-07-12T09:00:00+02:00'},
 {key:'crm-step:normal',type:'Activity',origin:'CRM',step_id:'normal',visible:true,title:'Regular activity',start:'2026-07-12T10:00:00+02:00'}];
 for(const html of [c.fidOverview(groups),c.renderStudioPreview(groups,{type:'FID'})]){assert.ok(!html.includes('Extra activity'));assert.ok(!html.includes('Extra service'));assert.ok(html.includes('Regular activity'));}
});


test('document date settings format CRM details and schedules without changing source values',()=>{
 const fields=[{api_name:'End_Date_Time',label:'End (with timezone)',type:'datetime',value:'2026-07-14T10:00:00+02:00',included:true},{api_name:'Hotel_Check_In',label:'Check-in',type:'date',value:'2026-07-14',included:true}];
 const group={key:'crm-step:1',type:'Activity',origin:'CRM',visible:true,title:'Visit',start:'2026-07-14T09:00:00+02:00',crmRecords:[{fields}],body:''};
 const settings={rules:{date_display:{date:'MM/dd/yyyy',time:'h:mm a',datetime:'date_time',timezone:'shown'}}};
 const html=c.renderStudioPaper(group,{type:'FID',settings},[group]);
 assert.ok(html.includes('>End</dt>'));assert.ok(html.includes('07/14/2026 10:00 AM (UTC+02:00)'));assert.ok(html.includes('9:00 AM (UTC+02:00)'));assert.doesNotMatch(html,/with timezone|2026-07-14T/);
 assert.equal(fields[0].value,'2026-07-14T10:00:00+02:00');
 settings.rules.date_display.datetime='time';settings.rules.date_display.timezone='hidden';
 const timeOnly=c.renderStudioPaper(group,{type:'FID',settings},[group]);assert.ok(timeOnly.includes('>10:00 AM<'));assert.doesNotMatch(timeOnly,/UTC/);
});


test('hotel dates move to the parent, deduplicate rooms and count calendar nights across DST',()=>{
 const f=(api_name,value,included=true)=>({api_name,label:api_name,value,included});
 const parent={key:'crm-step:1',step_id:'1',origin:'CRM',visible:true,start:'2026-10-24T15:00:00+02:00',crmRecords:[{step_type:'accommodation',fields:[f('Start_Date_Time','2026-10-24T15:00:00+02:00'),f('End_Date_Time','2026-10-26T11:00:00+01:00')]}]};
 const room={key:'crm-service:2',step_id:'1',service_id:'2',origin:'CRM',visible:true,crmRecords:[{fields:[f('Hotel_Check_In','2026-10-24'),f('Hotel_Check_Out','2026-10-26')]}]};
 const html=c.renderStudioPaper(parent,{type:'FID'},[parent,room,{...room,key:'crm-service:3'}]);
 assert.equal((html.match(/>Check-in</g)||[]).length,1);assert.equal((html.match(/>Check-out</g)||[]).length,1);
 assert.match(html,/>Nights<.*?>2</);assert.doesNotMatch(html,/>START<|>End_Date_Time</);
 assert.doesNotMatch(c.renderStudioPaper(room,{type:'FID'},[parent,room]),/Check-in|Check-out|fid-stay/);
 room.crmRecords[0].fields.forEach(f=>f.included=false);
 assert.equal(c.renderHotelStay(parent,[parent,room],{type:'FID'}),'','hidden room dates do not fall back to visible parent dates');
 const fallback=c.renderHotelStay(parent,[parent],{type:'FID'});assert.match(fallback,/>Nights<.*?>2</);
});

test('transfer headings preserve the product description and use resolved direction',()=>{
 const service={key:'crm-service:1',origin:'CRM',type:'Activity',service_id:'1',step_id:'2',visible:true,title:'Private car',crmRecords:[{transfer_label:'Arrival Transfer',fields:[]}]};
 assert.ok(c.renderStudioPaper(service,{type:'FID'},[service]).includes('Arrival Transfer: Private car</span></header>'));
 service.crmRecords[0].transfer_label='Transfer';
 assert.ok(c.renderStudioPaper(service,{type:'FID'},[service]).includes('Transfer: Private car</span></header>'));
});


test('service bodies omit supplier names while contact cards retain identification',()=>{
 const service={key:'service',service_id:'1',origin:'CRM',title:'Transfer',crmRecords:[{supplier:'Supplier Example',fields:[],contact_cards:[{supplier:'Contact Supplier',phone:'12345'}]}]};
 const html=c.renderStudioPaper(service,{type:'FID'},[service]);
 assert.doesNotMatch(html,/Supplier Example|<dt>Supplier<\/dt>/);
 assert.match(html,/Contact Supplier/);
 assert.match(html,/12345/);
});


test('category interiors preserve visible fields, hide empty/hidden values and use the parent for services',()=>{
 const field=(api_name,value,type='text',included=true)=>({api_name,label:api_name,value,type,included});
 const restaurant={key:'step',step_id:'1',origin:'CRM',visible:true,title:'Dinner',image:'https://example.com/photo.jpg',crmRecords:[{step_category:'Restaurants',fields:[field('Menu','Seasonal menu','textarea'),field('Booking_Name','Test reservation'),field('Important_Notes','<safe>'),field('New_Field','Keep me'),field('Empty',' '),field('Hidden','Do not show','text',false)]}]};
 const html=c.renderStudioPaper(restaurant,{type:'FID'},[restaurant]);
 assert.match(html,/data-layout="restaurant"/);assert.match(html,/fid-field-section--menu/);assert.match(html,/Keep me/);assert.match(html,/&lt;safe&gt;/);assert.match(html,/fid-entry-media/);
 assert.doesNotMatch(html,/Do not show|<dt>Empty/);
 const service={key:'service',step_id:'1',service_id:'2',origin:'CRM',visible:true,title:'Dinner option',crmRecords:[{fields:[]}]};
 const child=c.renderStudioPaper(service,{type:'FID'},[restaurant,service]);
 assert.match(child,/data-layout="restaurant"/);assert.match(child,/fid-entry--service/);assert.doesNotMatch(child,/fid-entry-media/);
 assert.equal(c.categoryLayout('Unknown category','activity').family,'general');
 assert.equal(c.categoryLayout('Hotel NBTM','activity').family,'accommodation');
});

const field=(api_name,value,included=true,type='text')=>({api_name,label:api_name.replaceAll('_',' '),value,included,type});
const step=(category,fields=[])=>({key:'s',step_id:'1',origin:'CRM',visible:true,title:'A journey',start:'2026-08-01T08:00:00Z',crmRecords:[{step_type:category==='Hotel'?'accommodation':'activity',step_category:category,fields}]});
test('paired routes bind times to endpoints, partial routes preserve labels, hidden fields stay hidden',()=>{
 const s=step('Flight Service',[field('Departure_Airport','LIS'),field('Arrival_Airport','MAD'),field('Flight_Departure_Time','10:15 AM'),field('Flight_Arrival_Time','12:30 PM'),field('Flight_Number','TP123'),field('Unknown_Field','Keep me')]);
 let html=c.renderStudioPaper(s,{type:'FID'},[s]);
 assert.match(html,/fid-route-points/);assert.match(html,/Departure<\/span>.*10:15 AM.*LIS/);assert.match(html,/Arrival<\/span>.*12:30 PM.*MAD/);assert.match(html,/Keep me/);assert.doesNotMatch(html,/>START<|08:00/);
 s.crmRecords[0].fields.find(f=>f.api_name==='Arrival_Airport').included=false;
 html=c.renderStudioPaper(s,{type:'FID'},[s]);assert.doesNotMatch(html,/fid-route-arrow|>MAD</);assert.match(html,/Departure<\/span>/);
});
test('rooms remain separate within their hotel, before notes and consolidated contacts',()=>{
 const s=step('Hotel',[field('Long_Description','Hotel description'),field('Special_Notes','Late checkout')]);
 const room=id=>({key:'room'+id,step_id:'1',service_id:id,origin:'CRM',visible:true,title:'Suite',crmRecords:[{fields:[field('Product_Description','Suite'),field('Distribution','Double'),field('Bedding','King'),field('Guests',id==='a'?'2':'3')],contact_cards:[{id:'contact1',supplier:'Hotel',name:'Reservations',phone:'+34 123',email:'a@example.test'}]}]});
 const rooms=[room('a'),room('b')],html=c.renderStudioPaper(s,{type:'FID'},[s,...rooms]);
 assert.equal((html.match(/data-preview-key="room/g)||[]).length,2);assert.equal((html.match(/class="fid-supplier-contact"/g)||[]).length,1);
 assert.ok(html.indexOf('rooma')<html.indexOf('Late checkout'));assert.ok(html.indexOf('Late checkout')<html.indexOf('Contact details'));
 assert.match(html,/Distribution/);assert.match(html,/>King</);assert.match(html,/>2</);assert.match(html,/>3</);assert.doesNotMatch(html,/<details|<summary/);
});
test('contact deduplication keeps distinct addresses and never merges people by a shared switchboard',()=>{
 const cards=[{id:'1',name:'A',supplier:'Tours',phone:'+34 123',email:'one@example.test',item_label:'Guide'},{id:'1',name:'A',supplier:'Tours',phone:'+34 456',email:'two@example.test',item_label:'Winery'},{id:'2',name:'B',supplier:'Tours',phone:'+34 123',email:'one@example.test'},{name:'C',supplier:'Tours',phone:'123'},{name:'C',supplier:'Tours',phone:'123'}];
 const html=c.renderSupplierContacts({contact_cards:cards});assert.equal((html.match(/class="fid-supplier-contact"/g)||[]).length,4);assert.match(html,/tel:\+34456/);assert.doesNotMatch(html,/mailto:|one@example|two@example/);assert.doesNotMatch(html,/fid-contact-item|Guide|Winery/);
});
test('single fields keep one label and do not create an empty second column or duplicate heading',()=>{
 const s=step('Experience',[field('Included','Lunch')]);const html=c.renderStudioPaper(s,{type:'FID'},[s]);assert.equal((html.match(/Included/g)||[]).length,1);assert.doesNotMatch(html,/fid-entry-media/);
});

test('logistics groups related fields with no empty slots and retains hidden-field rules',()=>{
 for(const names of [['Meeting_Details','PickUp_Point','Vehicle_Type'],['Vehicle_Type'],['PickUp_Point','DropOff_Point'],['Meeting_Details'],['Departure_City_PickUp_Point','Departure_City_Vehicle_Type'],['Arrival_City_Vehicle_Type']]){
  const s=step('Experience',names.map(name=>field(name,'Value '+name)).concat([field('Car_PickUp_Time','SECRET',false)]));
  const html=c.renderStudioPaper(s,{type:'FID'},[s]);
  assert.equal((html.match(/fid-field-section--logistics|fid-field-section fid-route/g)||[]).length,1);
  for(const name of names)assert.ok(html.includes('Value '+name));
  assert.doesNotMatch(html,/SECRET/);
  if(!names.includes('PickUp_Point')||!names.includes('DropOff_Point'))assert.doesNotMatch(html,/fid-route-arrow/);
 }
 const s=step('Experience',[]);assert.doesNotMatch(c.renderStudioPaper(s,{type:'FID'},[s]),/fid-field-section--logistics/);
});

test('short text fields remain compact and field nature is semantic',()=>{
 const s=step('Hotel',[field('Confirmation_Reference','ABC123'),field('Amenities','Breakfast',true,'textarea'),field('Special_Notes','Long notes. '.repeat(30),true,'textarea')]);
 const html=c.renderStudioPaper(s,{type:'FID'},[s]);
 assert.match(html,/class="fid-field" data-nature="reference"/);
 assert.match(html,/class="fid-field" data-nature="included"/);
 assert.match(html,/class="fid-field fid-field--wide" data-nature="narrative"/);
});
