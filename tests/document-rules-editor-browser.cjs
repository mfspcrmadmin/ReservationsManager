const fs=require('fs'),path=require('path'),assert=require('assert/strict');const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage();await page.route('https://**/*',r=>r.abort());
 await page.setContent('<style>'+fs.readFileSync(path.join(__dirname,'../app/styles/booking-documents.css'),'utf8')+'</style><div class="document-studio" style="position:static;width:390px"><form><div class="document-create-actions"></div></form><aside class="studio-inspector"><div class="studio-section-editor"></div></aside></div>');
 for(const file of ['document-service-rules.js','document-rules-editor.js'])await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../app/js',file),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')});
 await page.evaluate(()=>{
  window.records={'crm-step:1':{key:'crm-step:1',module:'Booking_Steps',step_type:'accommodation',step_id:'1',active:true},'crm-service:2':{key:'crm-service:2',module:'Booking_Services',supplier_id:'5',supplier:'Hotel',step_id:'1',active:true,category:'Room',supplier_contacts:[{id:'10',name:'Reservations A',phone:'123'},{id:'11',name:'Reservations B',phone:'456'}]}};
  window.readRules=mountDocumentRulesSettings(document.querySelector('form'),{},records);
  window.edits=0;window.sectionRules=mountSectionRules(document.querySelector('aside'),{key:'crm-step:1',step_id:'1',origin:'CRM',crmRecords:[records['crm-step:1']]},{settings:{}},records,()=>edits++);
 });
 assert.equal(await page.evaluate(()=>sectionRules.dirty()),false);
 assert.equal(await page.locator('.studio-section-rules').getByLabel('Show step',{exact:true}).locator('option').first().textContent(),'Show (document default)');
 assert.equal(await page.locator('.studio-section-rules').getByLabel('Show contact',{exact:true}).locator('option').first().textContent(),'Show (document default)');
 assert.equal(await page.evaluate(()=>readRules().step_categories.hotel.contacts),'step');
 assert.equal(await page.evaluate(()=>readRules().step_categories.restaurants.contacts),'step');
 assert.equal(await page.evaluate(()=>readRules().step_categories.experience.contact_filter),'supplier_subcategories');
 assert.equal(await page.evaluate(()=>readRules().step_categories.experience.contact_subcategories.length),15);
 await page.getByLabel('Step Category',{exact:true}).selectOption('hotel');
 const hotel=page.locator('.studio-rule-row').filter({has:page.getByRole('heading',{name:'Hotel',exact:true})});
 await hotel.getByLabel('Items shown',{exact:true}).selectOption('categories');await hotel.getByRole('checkbox',{name:'room',exact:true}).check();
 assert.deepEqual(await page.evaluate(()=>readRules().step_categories.hotel.categories),['room']);
 await hotel.getByLabel('Items shown',{exact:true}).selectOption('suppliers');await hotel.getByRole('group',{name:'Item suppliers',exact:true}).getByRole('checkbox',{name:'Hotel',exact:true}).check();
 await hotel.getByLabel('Contacts included',{exact:true}).selectOption('categories');await hotel.getByRole('group',{name:'Contact item categories',exact:true}).getByRole('checkbox',{name:'room',exact:true}).check();
 assert.deepEqual(await page.evaluate(()=>readRules().step_categories.hotel.suppliers),['5']);assert.deepEqual(await page.evaluate(()=>readRules().step_categories.hotel.contact_categories),['room']);
 assert.equal(await page.evaluate(()=>readRules().step_categories.experience.services),'none');assert.equal(await page.evaluate(()=>readRules().step_categories.experience.contacts),'step_items');
 assert.equal(await page.locator('[data-rule-contacts]').isChecked(),true);
 await page.getByLabel('Hotel contact',{exact:true}).selectOption('11');
 assert.deepEqual(await page.evaluate(()=>sectionRules.read()),{appearance:'automatic',contact_mode:'choose',contact_id:'',contact_ids:{'5':'11'}});assert.equal(await page.evaluate(()=>sectionRules.dirty()),true);
 await page.evaluate(()=>sectionRules.sync(true));assert.ok(await page.getByLabel('Hotel contact',{exact:true}).isDisabled());
 assert.ok(await page.locator('.studio-document-rules').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
 await page.evaluate(()=>{const saved=readRules();document.querySelector('form').innerHTML='<div class="document-create-actions"></div>';window.readRules=mountDocumentRulesSettings(document.querySelector('form'),{rules:saved},records);});
 assert.deepEqual(await page.evaluate(()=>readRules().step_categories.hotel.suppliers),['5']);assert.equal(await page.evaluate(()=>readRules().step_categories.hotel.contact_filter),'categories');
 await page.evaluate(()=>{
  records['crm-service:2'].supplier_contacts=[];records['crm-service:2'].supplier_contacts_loaded=false;
  document.querySelector('aside').innerHTML='<div class="studio-section-editor"></div>';
  window.contactLoads=0;window.ZOHO={CRM:{API:{searchRecord:async()=>{contactLoads++;return {data:[{id:'12',Vendor_Name:{id:'5'},Contact_Type:'RE - Reservas',Full_Name:'Loaded contact',Phone:'789'}]};}}}};
  window.sectionRules=mountSectionRules(document.querySelector('aside'),{key:'crm-step:1',step_id:'1',origin:'CRM',crmRecords:[records['crm-step:1']]},{settings:{}},records,()=>edits++);
 });
 await page.locator('[data-rule-contacts]').uncheck();await page.locator('[data-rule-contacts]').check();
 // Selecting Show/Choose triggers the supplier request automatically.

 await page.waitForFunction(()=>document.querySelector('.studio-section-rules select[aria-label="Hotel contact"]').options.length===2);
 await page.getByLabel('Hotel contact',{exact:true}).selectOption('12');
 assert.equal(await page.evaluate(()=>sectionRules.read().contact_ids['5']),'12');assert.equal(await page.evaluate(()=>contactLoads),1);
 await page.evaluate(()=>{
  const nav=document.createElement('nav');nav.className='studio-outline';
  nav.innerHTML=['crm-step:1','crm-service:2'].map((key,i)=>'<button data-section-key="'+key+'"><span class="studio-section-icon"></span><span class="studio-section-copy"><span class="studio-section-title">'+(i?'Room':'Hotel')+'</span><small></small></span></button>').join('');
  document.querySelector('.document-studio').prepend(nav);
 });
 // Inherited labels use the rule engine, including hidden item details with contacts on the step.
 await page.evaluate(()=>{
  records['crm-step:1'].step_type='experience';
  records['crm-service:2'].supplier_contacts=[];records['crm-service:2'].supplier_contacts_loaded=true;
  window.mountItem=settings=>{
   document.querySelector('aside').innerHTML='<div class="studio-section-editor"></div>';
   window.sectionRules=mountSectionRules(document.querySelector('aside'),{key:'crm-service:2',service_id:'2',step_id:'1',origin:'CRM',crmRecords:[records['crm-service:2']]},{settings},records,()=>edits++);
  };
  mountItem({});
 });
 const item=page.getByLabel('Show item',{exact:true}),contact=page.locator('.studio-section-rules').getByLabel('Show contact',{exact:true});
 assert.equal(await item.locator('option').first().textContent(),'Hide (document default)');
 assert.ok(await page.locator('[data-section-key="crm-service:2"]').evaluate(el=>el.classList.contains('is-hidden')));
 assert.ok(await page.locator('[data-section-key="crm-service:2"]').isVisible());
 assert.match(await page.locator('[data-section-key="crm-service:2"]').getAttribute('title'),/Hidden by document settings/);
 assert.ok(await page.locator('[data-section-key="crm-service:2"] .is-warning').isVisible());
 assert.match(await page.locator('.studio-rule-summary').textContent(),/Item hidden.*Contact pending/);

 assert.equal(await contact.locator('option').first().textContent(),'Show (document default)');
 assert.equal(await page.evaluate(()=>sectionRules.dirty()),false);
 await page.locator('[data-rule-visibility]').check();
 assert.equal(await page.locator('[data-section-key="crm-service:2"]').evaluate(el=>el.classList.contains('is-hidden')),false);
 assert.ok(await page.locator('[data-section-key="crm-service:2"] .studio-outline-pending').isVisible());
 assert.equal(await item.locator('option').first().textContent(),'Hide (document default)');
 await page.locator('.studio-rule-visibility .studio-use-default').click();
 assert.equal(await page.evaluate(()=>sectionRules.dirty()),false);
 await page.evaluate(()=>mountItem({rules:{types:{experience:{services:'all',contacts:'service'}}}}));
 await page.locator('[data-rule-visibility]').uncheck();
 assert.equal(await item.locator('option').first().textContent(),'Show (document default)');
 assert.equal(await contact.locator('option').first().textContent(),'Hide (document default)');
 await page.locator('.studio-rule-visibility .studio-use-default').click();
 assert.equal(await contact.locator('option').first().textContent(),'Show (document default)');
 await page.evaluate(()=>mountItem({rules:{sections:{'crm-step:1':{contact_mode:'hidden'}}}}));
 assert.equal(await contact.locator('option').first().textContent(),'Hide (document default)');
 assert.equal(await page.evaluate(()=>sectionRules.read().contact_mode),'automatic');
 await page.evaluate(()=>{
  document.querySelector('aside').innerHTML='<div class="studio-section-editor"></div>';
  records['crm-service:2'].supplier_contacts=[{id:'12',phone:'789',name:'Reservations',reservations:true}];
  window.sectionRules=mountSectionRules(document.querySelector('aside'),{key:'crm-step:1',step_id:'1',origin:'CRM',crmRecords:[records['crm-step:1']]},{settings:{}},records,()=>edits++);
 });
 assert.ok(await page.locator('[data-section-key="crm-service:2"] .is-contact').isVisible());
 assert.match(await page.locator('[data-section-key="crm-service:2"]').getAttribute('title'),/Contact shown on step/);
 await page.locator('[data-rule-visibility]').uncheck();
 assert.ok(await page.locator('[data-section-key="crm-service:2"]').isVisible());
 assert.match(await page.locator('[data-section-key="crm-service:2"]').getAttribute('title'),/Hidden because the step is hidden/);
 assert.equal(await page.locator('.studio-outline .is-contact').count(),0);
 await page.locator('.studio-rule-visibility .studio-use-default').click();
 assert.equal(await page.locator('.studio-outline-pending:visible').count(),0);
 assert.ok(await page.locator('[data-section-key="crm-service:2"] .is-contact').isVisible());
 await page.screenshot({path:'_local/artifacts/document-outline-status.png',fullPage:true});
 await page.evaluate(()=>{
  records['crm-step:1'].step_type='activity';records['crm-step:1'].step_category='New / Category & name';
  document.querySelector('form').innerHTML='<div class="document-create-actions"></div>';
  window.readRules=mountDocumentRulesSettings(document.querySelector('form'),{rules:{types:{activity:{services:'suppliers',suppliers:['5'],contacts:'hidden'}},sections:{'crm-service:2':{appearance:'shown'}}}},records);
 });
 await page.getByLabel('Step Category',{exact:true}).selectOption('new / category & name');
 assert.equal(await page.getByRole('heading',{name:'New / Category & name',exact:true}).count(),1);
 assert.equal(await page.evaluate(()=>readRules().step_categories['new / category & name'].services),'suppliers');
 assert.equal(await page.evaluate(()=>readRules().types.activity.contacts),'hidden');
 assert.equal(await page.evaluate(()=>readRules().sections['crm-service:2'].appearance),'shown');
 const categoryRow=page.locator('.studio-rule-row:visible');
 assert.equal(await categoryRow.count(),1);
 await categoryRow.getByLabel('Show step',{exact:true}).selectOption('hidden');
 assert.equal(await categoryRow.locator('.studio-category-details').isVisible(),false);
 assert.equal(await page.evaluate(()=>readRules().step_categories['new / category & name'].step_visibility),'hidden');
 await page.getByLabel('Step Category',{exact:true}).selectOption('hotel');
 await page.getByLabel('Step Category',{exact:true}).selectOption('new / category & name');
 assert.equal(await categoryRow.getByLabel('Show step',{exact:true}).inputValue(),'hidden');
 await categoryRow.getByLabel('Show step',{exact:true}).selectOption('shown');
 assert.equal(await categoryRow.getByLabel('Items shown',{exact:true}).inputValue(),'suppliers');
 assert.equal(await categoryRow.getByLabel('Contact Details',{exact:true}).inputValue(),'hidden');
 await page.evaluate(()=>{
  const extra={module:'Booking_Steps',step_type:' EXTRA ',step_category:'Internal Fee'};
  document.querySelector('form').innerHTML='<div class="document-create-actions"></div>';
  window.readRules=mountDocumentRulesSettings(document.querySelector('form'),{rules:{step_categories:{'agent commission':{step_visibility:'shown'},'internal fee':{step_visibility:'shown'}}}},{...records,extra,commission:{...extra,step_category:'Agent Commission'},transfer:{...extra,step_category:'Transfer'}});
 });
 const names=await page.getByLabel('Step Category',{exact:true}).locator('option').allTextContents();
 assert.equal(names.includes('Agent Commission'),false);assert.equal(names.includes('Internal Fee'),false);assert.equal(names.includes('Transfer'),true);
 assert.equal(await page.evaluate(()=>!!readRules().step_categories['agent commission']),false);
 await page.evaluate(()=>{
  document.querySelector('form').innerHTML='<div class="document-create-actions"></div>';
  window.readRules=mountDocumentRulesSettings(document.querySelector('form'),{rules:{types:{activity:{services:'all',contacts:'service',contact_filter:'all'}}}},records);
 });
 await page.getByLabel('Step Category',{exact:true}).selectOption('transfer');
 const supplierFilters=page.locator('.studio-rule-row:visible').getByRole('group',{name:'Supplier subcategories',exact:true});
 assert.equal(await supplierFilters.locator('input:checked').count(),15);
 assert.equal(await supplierFilters.locator('input[type=checkbox]').count(),23);
 for(const name of ['Food','Exclusive Access','Restaurants','Tickets','Air Services','Taxi','Train','Parking'])assert.equal(await supplierFilters.getByRole('checkbox',{name,exact:true}).isChecked(),false);
 await supplierFilters.getByRole('checkbox',{name:'Taxi',exact:true}).check();

 await supplierFilters.getByRole('checkbox',{name:'Guide',exact:true}).uncheck();
 await page.evaluate(()=>{
  const settings={rules:readRules()};document.querySelector('form').innerHTML='<div class="document-create-actions"></div>';
  window.readRules=mountDocumentRulesSettings(document.querySelector('form'),settings,records);
 });
 await page.getByLabel('Step Category',{exact:true}).selectOption('transfer');
 assert.equal(await supplierFilters.getByRole('checkbox',{name:'Guide',exact:true}).isChecked(),false);
 assert.equal(await supplierFilters.locator('input:checked').count(),15);
 assert.equal(await supplierFilters.getByRole('checkbox',{name:'Taxi',exact:true}).isChecked(),true);
 assert.equal(await supplierFilters.getByRole('checkbox',{name:'Parking',exact:true}).isChecked(),false);
 console.log('PASS rules UI: type/category rules, hotel placement default, contact selection, dirty state, locks and mobile fit.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
