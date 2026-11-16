// Fixture-based CSS/markup contract checks. Does not execute Deluge or publish records.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=path.resolve(__dirname,'..'),generator=path.join(base,'_local/integrations/document-generator');
const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const c=vm.createContext({escapeHtml});
for(const name of ['document-presentation','document-service-rules','document-text-format','document-editorial','document-crm-fields','document-output-dates','document-category-config','document-category-layout','document-studio-layout'])vm.runInContext(fs.readFileSync(path.join(base,'app/js',name+'.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''),c);
const layouts=JSON.parse(fs.readFileSync(path.join(generator,'config/step-layouts.json'),'utf8'));
const recordField=(api_name,value,type='text')=>({api_name,label:api_name.replaceAll('_',' '),value,type});
const groups=[];
for(const [family,layout] of Object.entries(layouts)){
 const step={key:family,step_id:family,origin:'CRM',visible:true,title:layout.label+' — a carefully planned day',start:'2026-07-14T10:00:00+02:00',image:['restaurant','experience','accommodation'].includes(family)?'https://fixture.test/photo.svg':'',crmRecords:[{step_category:layout.categories[0]||'New category',step_type:family==='accommodation'?'accommodation':'activity',fields:[recordField('Long_Description','A relaxed visit with time to enjoy the surroundings.','textarea'),...layout.sections.flatMap(s=>s[2].slice(0,2).map(name=>recordField(name,name==='Menu'?'Seasonal tasting menu\nVegetarian alternatives available.':'Example '+name,name==='Menu'?'textarea':'text'))),recordField('Future_Field','LongReference'.repeat(20))]}]};
 groups.push(step,{key:family+'-service',step_id:family,service_id:family,origin:'CRM',visible:true,title:'Included service',crmRecords:[{fields:[recordField('Product_Description','Your service details'),recordField('Distribution','Double'),recordField('Bedding','King'),recordField('Guests','2')]}]});
}
const addFields=(family,fields)=>{const record=groups.find(g=>g.key===family).crmRecords[0];record.fields=record.fields.filter(f=>!fields.some(item=>item.api_name===f.api_name)).concat(fields);};
addFields('flight',[recordField('Departure_Airport','Lisboa (LIS)'),recordField('Arrival_Airport','Madrid (MAD)'),recordField('Flight_Departure_Time','2026-07-14T23:30:00+01:00'),recordField('Flight_Arrival_Time','2026-07-15T02:00:00+02:00')]);
addFields('transfer',[recordField('PickUp_Point','Airport arrivals hall'),recordField('DropOff_Point','Hotel reception'),recordField('Car_PickUp_Time','11:30'),recordField('Arrival_Departure','Arrival')]);
addFields('ship',[recordField('Departure_Port','Lisboa'),recordField('Arrival_Port','Porto'),recordField('Ship_Departure_Time','10:00'),recordField('Ship_Arrival_Time','18:00')]);
addFields('experience',[recordField('Long_Description',('A long description with useful context for the traveller. ').repeat(18)+'\n\n- First activity\n- Second activity','textarea'),recordField('Meeting_Details',('Detailed meeting instructions. ').repeat(12))]);
for(const [key,fields] of [['minimal',[recordField('Long_Description','A day at leisure.','textarea')]],['single',[recordField('Vehicle_Type','Sedan')]],['empty-hotel',[]]])groups.push({key,step_id:key,origin:'CRM',visible:true,title:key==='empty-hotel'?'Hotel without rooms':'Simple activity',crmRecords:[{step_type:key==='empty-hotel'?'accommodation':'activity',step_category:key==='empty-hotel'?'Hotel':'Experience',fields}]});
const hotel=groups.find(g=>g.key==='accommodation');
const firstRoom=groups.find(g=>g.key==='accommodation-service');
firstRoom.crmRecords[0].contact_cards=[{id:'contact1',name:'Reservations team',supplier:'Hotel',phone:'+34 123 456',email:'reservations@example.test'}];
groups.push({...firstRoom,key:'second-room',service_id:'second',crmRecords:[{...firstRoom.crmRecords[0],fields:[recordField('Product_Description','Second room'),recordField('Distribution','Twin'),recordField('Guests','3')]}]});
const markup=groups.filter(g=>!g.service_id).map(g=>c.renderStudioPaper(g,{type:'FID'},groups)).join('');
// Creator emits these same fid-* nodes, with different legacy outer classes.
const creatorMarkup=markup.replaceAll('studio-paper studio-paper--activity','mfsp-step').replaceAll('studio-paper studio-paper--service','mfsp-service-details');
const renderer=fs.readFileSync(path.join(generator,'creator/functions/renderPreparedDocumentDraft.deluge'),'utf8');
for(const token of ['thisapp.documentCategoryLayout','thisapp.renderDocumentCategoryBody','fid-entry-body','fid-entry-heading','fid-entry--service','fid-entry--step'])assert.ok(renderer.includes(token),token);
const css=fs.readFileSync(path.join(generator,'creator/styles/FID.ezus.css'),'utf8');
for(const page of ['Travel_Document_Preview','Travel_Document_Viewer_FID'])assert.ok(fs.readFileSync(path.join(generator,'creator/pages',page+'.snippet.html'),'utf8').includes(css),page+' shares the generated stylesheet');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage();
 await page.route('**/*',r=>r.request().url()==='https://fixture.test/photo.svg'?r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#dce5db"/><path d="M0 500 280 150 800 500" fill="#a9bda7"/></svg>'}):r.abort());
 for(const width of [1280,700,390]){
  await page.setViewportSize({width,height:1000});const results=[];
  for(const surface of ['Studio','Creator preview','Creator published']){
   const source=surface==='Studio'?fs.readFileSync(path.join(base,'app/styles/booking-documents.css'),'utf8'):css;
   const body=surface==='Studio'?'<div class="document-studio"><div class="studio-document-preview" data-document-type="FID">'+markup+'</div></div>':'<div class="mfsp-fid">'+creatorMarkup+'</div>';
   await page.setContent('<style>'+source.replace(/@import[^;]+;/g,'')+' body{margin:0} .document-studio,.studio-document-preview{position:static!important;width:100%!important;height:auto!important;max-width:none!important;box-shadow:none!important} </style>'+body);
   await page.locator('img').first().waitFor();await page.evaluate(()=>document.querySelectorAll('img').forEach(img=>img.loading='eager'));await page.evaluate(()=>Promise.all([...document.images].map(img=>img.decode().catch(()=>{}))));
   const geometry=await page.locator('.fid-entry').evaluateAll(nodes=>nodes.map(node=>({width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height,overflow:node.scrollWidth-node.clientWidth,font:getComputedStyle(node.querySelector('.fid-entry-heading')).font,padding:node.querySelector('.fid-entry-body')?getComputedStyle(node.querySelector('.fid-entry-body')).padding:''})));
   assert.ok(geometry.every(g=>g.overflow<=1),surface+' overflow at '+width);
   assert.equal(await page.locator('.fid-entry[data-layout=restaurant] .fid-field-section--menu').count(),1);
   assert.equal(await page.locator('.fid-entry--service').count(),Object.keys(layouts).length+1);
   assert.equal(await page.locator('.fid-entry-media').count(),3);
   if(results.length)for(let i=0;i<geometry.length;i++){assert.equal(geometry[i].font,results[0][i].font);assert.equal(geometry[i].padding,results[0][i].padding);assert.ok(Math.abs(geometry[i].height-results[0][i].height)<2, surface+' height differs at '+width+' card '+i+' '+JSON.stringify([geometry[i],results[0][i]]));}
   const routes=await page.locator('.fid-route-points').evaluateAll(nodes=>nodes.filter(n=>n.querySelectorAll('.fid-route-end').length===2).map(n=>{const ends=n.querySelectorAll('.fid-route-end'),a=ends[0].getBoundingClientRect(),b=ends[1].getBoundingClientRect();return {direction:getComputedStyle(n).flexDirection,gap:b.left-a.right,verticalGap:b.top-a.bottom};}));
   for(const route of routes){if(width===390){assert.equal(route.direction,'column');assert.ok(route.verticalGap<55);}else{assert.equal(route.direction,'row');assert.ok(route.gap<65);}}
   assert.equal(await page.locator('.fid-hotel-rooms > .fid-entry-heading').first().evaluate(n=>getComputedStyle(n).display),'none');
   results.push(geometry);
   if(surface==='Studio' && width!==700){await page.screenshot({path:path.join(base,'_local/artifacts/category-layouts-'+width+'.png'),fullPage:true});await page.locator('.fid-entry--step[data-layout=restaurant]').screenshot({path:path.join(base,'_local/artifacts/category-restaurant-'+width+'.png')});}
  }
 }
 await page.emulateMedia({media:'print'});
 assert.equal(await page.locator('.fid-entry--step').first().evaluate(n=>getComputedStyle(n).breakInside),'auto');
 assert.equal(await page.locator('.fid-entry--step[data-layout=accommodation] .fid-room-card').count(),2);
 assert.equal(await page.locator('.fid-entry--step[data-layout=accommodation] .fid-supplier-contact').count(),1);
 await page.pdf({path:path.join(base,'_local/artifacts/category-layouts-print.pdf'),format:'A4',printBackground:true});
 // Composition regressions: changing photos/content must never reserve an empty column.
 await page.emulateMedia({media:'screen'});
 const fixtureImage=(portrait)=>'https://fixture.test/'+(portrait?'portrait':'photo')+'.svg';
 await page.route('https://fixture.test/portrait.svg',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="800"><rect width="400" height="800" fill="#dce5db"/></svg>'}));
 for(const width of [1000,580,390]) for(const surface of ['Studio','Creator']) {
  await page.setViewportSize({width,height:1000});
  const source=surface==='Studio'?fs.readFileSync(path.join(base,'app/styles/booking-documents.css'),'utf8'):css;
  for(const length of [0,60,1500]) for(const photo of ['none','landscape','portrait']) {
   const sample={key:'composition',step_id:'composition',origin:'CRM',visible:true,title:length===1500?'An exceptionally long accommodation title that should keep the summary together without squeezing the title into a narrow column':'Hotel',image:photo==='none'?'':fixtureImage(photo==='portrait'),crmRecords:[{step_type:'accommodation',step_category:'Hotel',fields:[recordField('Long_Description','A considered description. '.repeat(Math.ceil(length/26)).slice(0,length),'textarea'),recordField('Start_Date_Time','2026-07-14'),...(length===60?[]:[recordField('End_Date_Time','2026-07-17')]),recordField('Meeting_Details','Meet at reception')]}]};
   const html=c.renderStudioPaper(sample,{type:'FID'},[sample]);
   const body=surface==='Studio'?'<div class="document-studio"><div class="studio-document-preview" data-document-type="FID">'+html+'</div></div>':'<div class="mfsp-fid">'+html.replaceAll('studio-paper studio-paper--activity','mfsp-step')+'</div>';
   await page.setContent('<style>'+source.replace(/@import[^;]+;/g,'')+' body{margin:0}.document-studio,.studio-document-preview{position:static!important;width:100%!important;height:auto!important;max-width:none!important}</style>'+body);
   await page.evaluate(()=>Promise.all([...document.images].map(img=>{img.loading='eager';return img.decode().catch(()=>{});}))); 
   const result=await page.locator('.fid-entry--step').evaluate(n=>{
    const box=e=>{if(!e)return null;const r=e.getBoundingClientRect();if(getComputedStyle(e).display==='contents'){const children=[...e.children].map(box).filter(Boolean);const x=Math.min(...children.map(b=>b.x)),right=Math.max(...children.map(b=>b.right));return {x,y:Math.min(...children.map(b=>b.y)),width:right-x,right,bottom:Math.max(...children.map(b=>b.bottom))};}return {x:r.x,y:r.y,width:r.width,right:r.right,bottom:r.bottom};};
    return {header:box(n.querySelector('.fid-entry-heading')),overflow:n.scrollWidth-n.clientWidth,content:box(n.querySelector('.fid-entry-content')),description:box(n.querySelector('.fid-entry-description')),image:box(n.querySelector('.fid-entry-media')),intro:box(n.querySelector('.fid-entry-intro')),details:box(n.querySelector('.fid-field-section')),fit:n.querySelector('img')?getComputedStyle(n.querySelector('img')).objectFit:null};
   });
   assert.ok(result.overflow<=1,JSON.stringify({width,surface,length,photo,result}));
   assert.equal(await page.locator('.fid-stay-card').count(),length===60?1:3);
   if(photo==='none' && length)assert.ok(result.description.width>=result.content.width*.85,'no-photo reading width');
   if(photo!=='none') {
    assert.equal(result.fit,'contain');
    assert.ok(Math.abs(result.image.right-result.content.right)<2,'photo aligned with right edge');
    assert.ok(result.details.y>=result.intro.bottom,'details follow full intro');
    if(length && width===1000){assert.ok(result.image.width/result.content.width>.33);assert.ok(result.image.width/result.content.width<.42);assert.ok(Math.abs(result.image.y-result.header.y)<2);}
    if(length && width<650)assert.ok(result.image.y>=result.description.bottom,'small-screen single column');
   }
  }
 }
 for(const visible of [true,false]) {
  const sample={key:'start',step_id:'start',origin:'CRM',visible:true,title:'Experience',start:'2026-07-14T10:00:00',showStart:visible,crmRecords:[{step_type:'activity',step_category:'Experience',fields:[]}]};
  assert.equal(c.renderStudioPaper(sample,{type:'FID'},[sample]).includes('<small>START</small>'),visible);
 }
 console.log('PASS category layouts: all families, services, photos, long fields, responsive widths and three-surface CSS geometry.');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
