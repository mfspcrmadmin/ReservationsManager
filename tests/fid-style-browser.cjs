// CSS/DOM verification only. Does not create screenshots or images.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const project=process.env.TRAVEL_DOCUMENTS_ROOT || path.resolve(__dirname,'../_local/integrations/document-generator');
const e=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const context=vm.createContext({escapeHtml:e});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/js/document-presentation.js'),'utf8').replace(/^export /gm,''),context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/js/document-service-rules.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''),context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/js/document-text-format.js'),'utf8').replace(/^export /gm,''),context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/js/document-editorial.js'),'utf8').replace(/^export /gm,''),context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/js/document-studio-layout.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''),context);
const groups=[
 {key:'template:cover',type:'Cover',origin:'Template',title:'Test journey',body:'Welcome',visible:true},
 {key:'template:journey',type:'Journey_Info',origin:'Template',title:'Journey information',body:'Travel dates: 2026-07-12 - 2026-07-20',visible:true},
 {key:'template:program',type:'Itinerary',origin:'Template',title:'Detailed itinerary',body:'',visible:true},
 {key:'crm-step:1',type:'Activity',origin:'CRM',title:'Barcelona visit',body:'Description',visible:true,start:'2026-07-12T09:00:00+02:00',step_id:'1'}
];
groups.push({key:'crm-step:2',type:'Activity',origin:'CRM',title:'Hotel stay',visible:true,start:'2026-07-12T15:00:00+02:00',step_id:'2',crmRecords:[{step_type:'accommodation',fields:[]}]});
groups.push({key:'crm-service:3',type:'Text',origin:'CRM',visible:true,step_id:'2',service_id:'3',crmRecords:[{supplier:'Hotel',fields:[{api_name:'Product_Description',label:'Description',value:'Suite'},{api_name:'Hotel_Check_In',label:'Check-in',value:'2026-07-12'},{api_name:'Bedding',label:'Bedding',value:'King'}]}]});
groups.push({key:'shared:session',type:'Session',origin:'Shared_Content',title:'Workshop session',body:'Session description',visible:true,start:'2026-07-13T10:00:00Z'});
groups.push({key:'crm-step:4',type:'Activity',origin:'CRM',step_id:'4',title:'Hidden title',visible:true,start:'2026-07-13T11:00:00Z',crmRecords:[{fields:[{api_name:'Short_Description',value:'Hidden title',included:false}]}]});
groups.push({key:'template:contacts',type:'Contacts',origin:'Template',title:'We are here for you!',body:'Legacy',visible:true});
groups.splice(2,0,{key:'template:overview',type:'Overview',origin:'Template',title:'Itinerary at a glance',body:'',visible:true});
const editorialBlocks=JSON.parse(fs.readFileSync(path.join(project,'creator/templates/mfsp-fid-v1.json'),'utf8')).blocks.filter(b=>['practical','closing'].includes(b.Block_Key));
for(const b of editorialBlocks)groups.push({key:'template:'+b.Block_Key,type:b.Block_Type,origin:'Template',title:b.Title,body:b.Body_Text,visible:true});
const emergency=context.documentEmergencyContact({id:'616617000004053072'});
const studio=context.renderStudioPreview(groups,{type:'FID',presentation:{emergency_contact:emergency}});
const publicHTML='<div class="mfsp-fid"><section class="mfsp-hero"><div class="mfsp-hero-content"><h1>Test journey</h1><div class="mfsp-cover-dates"><strong>Travel dates</strong><span>12 July 2026</span></div></div></section><section id="mfsp-journey"><h2 class="mfsp-section-title">Journey information</h2></section><details class="mfsp-day" open><summary>2026-07-12</summary><div class="mfsp-day-content"><article class="mfsp-step"><div class="mfsp-step-heading"><h4>Barcelona visit</h4></div><div class="mfsp-copy">Description</div></article></div></details></div>';
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.route('https://**/*',route=>route.abort());
  const widget=fs.readFileSync(path.join(__dirname,'../app/styles/booking-documents.css'),'utf8');
  const preview=fs.readFileSync(path.join(project,'creator/pages/Travel_Document_Preview.snippet.html'),'utf8').match(/<style>([\s\S]*?)<\/style>/)[1];
  await page.setContent('<style>'+widget+'\n'+preview+'</style><div class="document-studio" style="position:static;width:820px;height:auto">'+studio+'</div>'+publicHTML);
  // Creator uses this same room structure inside its saved HTML.
  await page.locator('.mfsp-day-content').evaluate(el=>el.insertAdjacentHTML('beforeend',`<details class="mfsp-service-details fid-hotel-rooms" open><summary>Room details</summary><div class="fid-hotel-rooms-content"><dl class="fid-stay"><div class="fid-stay-card"><dt class="fid-stay-label">Check-in</dt><dd class="fid-stay-value">2026-07-12</dd></div></dl><div class="fid-room-card"><div class="fid-room-summary"><div class="fid-room-title">Suite</div></div><div class="fid-room-body"><dl class="fid-room-meta"><div class="fid-room-field"><dt class="fid-room-label">Supplier</dt><dd class="fid-room-value">Hotel</dd></div></dl><dl class="fid-room-meta"><div class="fid-room-field"><dt class="fid-room-label">Bedding</dt><dd class="fid-room-value">King</dd></div></dl></div></div></div></details>`));
  const publicRoot=page.locator('.mfsp-fid'),studioRoot=page.locator('.studio-document-preview');
  await publicRoot.evaluate((el,html)=>el.insertAdjacentHTML('beforeend','<section class="mfsp-section mfsp-section--contacts"><div class="mfsp-container">'+html+'</div></section>'),emergency.html);
  await publicRoot.evaluate((el,html)=>el.insertAdjacentHTML('beforeend','<section id="mfsp-overview" class="mfsp-section"><div class="mfsp-container">'+html+'</div></section>'),context.fidOverview(groups));
  for(const b of editorialBlocks)await publicRoot.evaluate((el,data)=>el.insertAdjacentHTML('beforeend','<section class="mfsp-section mfsp-section--'+data.kind+'"><div class="mfsp-container"><h2 class="mfsp-section-title">'+data.title+'</h2>'+data.html+'</div></section>'),{kind:b.Block_Key,title:b.Title,html:context.renderDocumentEditorial(b.Block_Key,b.Body_Text)});
  const previewSnippet=fs.readFileSync(path.join(project,'creator/pages/Travel_Document_Preview.snippet.html'),'utf8');
  await publicRoot.evaluate((el,nav)=>el.insertAdjacentHTML('afterbegin',nav),previewSnippet.match(/<nav class="mfsp-nav"[\s\S]*?<\/nav>/)[0]);
  await publicRoot.locator('.mfsp-hero').evaluate(el=>el.insertAdjacentHTML('afterbegin','<iframe src="about:blank" title="Cover video geometry"></iframe>'));
  await publicRoot.locator('.mfsp-step-heading').evaluate(el=>el.insertAdjacentHTML('beforeend','<span class="mfsp-time"><small>START</small>09:00</span>'));
  await publicRoot.locator('#mfsp-journey').evaluate(el=>el.insertAdjacentHTML('beforeend','<div class="mfsp-journey-details"><p><span class="mfsp-journey-label">Travel dates</span><span>2026-07-12 - 2026-07-20</span></p></div>'));
  // The real Studio positions this inside a sized zoom canvas; this fixture uses normal flow.
  await studioRoot.evaluate(el=>el.style.position='relative');
  for(const width of [1920,1280,820,768,390,320]){
   await page.locator('.document-studio').evaluate((el,w)=>el.style.width=w+'px',width);
   await publicRoot.evaluate((el,w)=>el.style.width=w+'px',width);
   await studioRoot.evaluate((el,w)=>el.style.width=w+'px',width);
   // Measure the settled responsive layout, after Ezus' 200 ms transitions.
   await page.waitForTimeout(250);
   for(const [a,b,properties] of [
    ['.mfsp-hero h1','.studio-paper--cover .studio-preview-title',['fontFamily','fontSize','fontWeight','color','lineHeight']],
    ['.mfsp-cover-dates','.studio-cover-dates',['backgroundImage','borderRadius','padding','borderColor']],
    ['#mfsp-journey','.studio-paper--journey',['backgroundColor','paddingTop','paddingBottom']],
    ['.mfsp-journey-details','.studio-journey-details',['fontFamily','fontSize','fontWeight','lineHeight','gap','padding']],
    ['.mfsp-journey-label','.studio-journey-label',['fontFamily','fontSize','fontWeight','color','lineHeight','margin']],
    ['.mfsp-journey-details p > span:last-child','.studio-journey-details p > span:last-child',['fontFamily','fontSize','fontWeight','color','lineHeight']],
    ['.mfsp-day > summary','.studio-program-day > summary',['backgroundImage','fontFamily','fontSize','color','padding']],
    ['.mfsp-step','.studio-paper--activity',['backgroundColor','padding','boxShadow']],
    ['.mfsp-step h4','.studio-paper--activity .studio-preview-title',['fontFamily','fontSize','fontWeight','color']],
    ['.mfsp-fid .overview-text-head','.studio-document-preview .overview-text-head',['display','justifyContent','flexDirection','textAlign','gap']],
    ['.mfsp-fid .overview-text-item','.studio-document-preview .overview-text-item',['display','padding','backgroundImage','borderRadius','width']],
    ['.mfsp-section--contacts .contacts-emergency-person','.studio-paper--contacts .contacts-emergency-person',['display','borderRadius','padding','boxShadow']],
    ['.mfsp-section--contacts .contacts-emergency-reach','.studio-paper--contacts .contacts-emergency-reach',['backgroundImage','borderRadius','padding','fontFamily']]
   ]){
    const read=(el,props)=>Object.fromEntries(props.map(prop=>[prop,getComputedStyle(el)[prop]]));
    assert.deepEqual(await page.locator(a).first().evaluate(read,properties),await page.locator(b).first().evaluate(read,properties),a+' parity at '+width);
   }
   for(const selector of ['.fid-hotel-rooms','.fid-hotel-rooms > summary','.fid-room-card','.fid-room-title','.fid-room-body','.fid-room-meta','.fid-room-field','.fid-room-label','.fid-room-value','.fid-stay-card','.fid-stay-label','.fid-stay-value']){
    const read=el=>{const css=getComputedStyle(el);return Object.fromEntries(['fontFamily','fontSize','fontWeight','color','lineHeight','backgroundColor','borderRadius','padding','margin','display','gap'].map(p=>[p,css[p]]));};
    assert.deepEqual(await publicRoot.locator(selector).first().evaluate(read),await studioRoot.locator(selector).first().evaluate(read),selector+' parity at '+width);
   }
   for(const root of [publicRoot,studioRoot]){
    for(const step of await root.locator('.mfsp-step,.studio-paper--activity').all()){
     const alignment=await step.evaluate(el=>{
      const parts=[...el.querySelectorAll('h4,.mfsp-copy,.studio-preview-copy,.mfsp-time,.studio-step-time')];
      return parts.map(part=>({left:part.getBoundingClientRect().left,align:getComputedStyle(part).textAlign}));
     });
     assert.ok(alignment.every(part=>part.align==='left'),'step title, description and start are left aligned at '+width);
     assert.ok(alignment.every(part=>Math.abs(part.left-alignment[0].left)<1),'step contents share the left edge at '+width);
    }
    const geometry=await root.evaluate(el=>{
     const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
     const journey=el.querySelector('.mfsp-journey-details,.studio-journey-details');
     const cover=el.querySelector('.mfsp-hero,.studio-paper--cover');
     return {root:rect(el),header:rect(el.querySelector('.mfsp-nav,.studio-preview-header')),journey:rect(journey),align:getComputedStyle(journey.querySelector('p')).textAlign,cover:rect(cover),video:rect(cover.querySelector('iframe'))};
    });
    assert.equal(geometry.align,'center','journey fields are centered at '+width);
    assert.ok(Math.abs(geometry.journey.left+geometry.journey.width/2-geometry.root.left-geometry.root.width/2)<1,'journey block is centered at '+width+': '+JSON.stringify(geometry));
    assert.ok(Math.abs(geometry.header.left-geometry.root.left)<1 && Math.abs(geometry.header.right-geometry.root.right)<1,'header spans the document at '+width);
    assert.ok(Math.abs(geometry.video.width/geometry.video.height-16/9)<0.002,'video frame preserves 16:9 at '+width);
    assert.ok(geometry.video.left<=geometry.cover.left+1 && geometry.video.right>=geometry.cover.right-1 && geometry.video.top<=geometry.cover.top+1 && geometry.video.bottom>=geometry.cover.bottom-1,'video covers every edge at '+width);
    assert.ok(Math.abs(geometry.cover.height-(width<=700?640:760))<1,'cover height includes padding at '+width);
    const overviewBounds=await root.locator('.fid-overview').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,children:[...el.querySelectorAll('*')].filter(n=>n.scrollWidth>n.clientWidth+1).map(n=>({class:n.className,width:n.clientWidth,scroll:n.scrollWidth,whiteSpace:getComputedStyle(n).whiteSpace}))}));
    assert.ok(overviewBounds.scroll<=overviewBounds.width+1,'overview fits at '+width+': '+JSON.stringify(overviewBounds));
    assert.equal(await root.locator('.overview-text-head').first().evaluate(el=>getComputedStyle(el).textAlign),width<=768?'left':'center');
    const practical=root.locator('.fid-practical');
    assert.equal(await practical.locator('details').count(),5);
    const accordion=practical.locator('details').first();
    assert.equal(await accordion.evaluate(el=>el.open),false);
    await accordion.locator('summary').focus();await page.keyboard.press('Enter');
    assert.equal(await accordion.evaluate(el=>el.open),true);
    assert.ok(await accordion.locator('.things-copy').isVisible());
    assert.ok(await practical.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'practical fits at '+width);
    await page.keyboard.press('Enter');
    assert.ok(await root.locator('.about-intro').isVisible());
    assert.equal(await root.locator('.studio-paper--closing .studio-preview-title,.mfsp-section--closing .mfsp-section-title').evaluate(el=>getComputedStyle(el).color),'rgb(255, 255, 255)');
    const header=root.locator('.studio-preview-header,.mfsp-nav');
    assert.ok(await header.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'header fits at '+width+': '+await header.evaluate(el=>JSON.stringify({class:el.className,width:el.clientWidth,scroll:el.scrollWidth,children:[...el.children].map(c=>({tag:c.tagName,class:c.className,width:c.getBoundingClientRect().width,display:getComputedStyle(c).display}))})));
    assert.equal(await header.locator('.fid-nav-support').count(),1);
    const menu=header.locator('.fid-mobile-menu');
    assert.equal(await menu.isVisible(),width<=768);
    assert.equal(await header.locator('.fid-desktop-links').isVisible(),width>768);
    assert.ok(await header.locator('.fid-nav-support').isVisible());
    if(width<=768) {
     assert.equal(await menu.locator('.fid-mobile-links').isVisible(),false);
     await menu.locator('summary').focus();await page.keyboard.press('Enter');
     assert.ok(await menu.locator('.fid-mobile-links').isVisible());
     assert.ok(await menu.locator('.fid-mobile-links').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
     assert.ok(await menu.locator('a,button').first().evaluate(el=>el.getBoundingClientRect().height>=47.9),'tap target '+width+': '+await menu.locator('a,button').first().evaluate(el=>JSON.stringify({height:el.getBoundingClientRect().height,min:getComputedStyle(el).minHeight,transform:getComputedStyle(el).transform,parent:el.parentElement.outerHTML.slice(0,100)})));
     await page.keyboard.press('Enter');
     await menu.locator('summary').click();
     await menu.locator('a,button').first().click();
     if(await menu.locator('a').count())assert.equal(await menu.evaluate(el=>el.open),false);
     else await menu.evaluate(el=>el.open=false);
    }
    const contacts=root.locator('.contacts-layout');
    assert.equal(await contacts.locator('.contacts-emergency-person').count(),2);
    assert.ok(await contacts.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'contacts fit at '+width);
    assert.equal(await contacts.locator('.contacts-emergency-shell').evaluate(el=>getComputedStyle(el).display),'grid');
    const room=root.locator('.fid-hotel-rooms');
    assert.ok(await room.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'room does not overflow at '+width);
    await room.locator('summary').click();
    assert.equal(await room.evaluate(el=>el.open),false);
    await room.locator('summary').click();
    assert.equal(await room.evaluate(el=>el.open),true);
   }
   for(const selector of ['.studio-paper--session .studio-preview-title','.studio-paper--session .studio-preview-copy','.studio-paper--session .studio-schedule strong'])assert.equal(await studioRoot.locator(selector).evaluate(el=>getComputedStyle(el).textAlign),'left',selector);
  }
  console.log('PASS: Creator and Studio styles, centered journey fields, full-width headers and cover-video geometry and mobile navigation at 1920px, 1280px, 820px, 768px, 390px and 320px; no screenshots.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
