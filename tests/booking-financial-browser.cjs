const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try {
  const page=await browser.newPage({viewport:{width:1400,height:950}});
  const html=fs.readFileSync('app/widget.html','utf8');
  const controls=html.slice(html.indexOf('<div class="summary-view-controls">'),html.indexOf('<div id="summary-content"'));
  await page.setContent('<main id="manage-booking-panel" style="width:1100px;margin:20px"><section class="booking-details-card booking-details-card--embedded"><div id="booking-personal-tags" class="booking-personal-tags"></div>'+controls+'<div id="summary-content" class="summary-content booking-details-content"></div></section></main>');
  for(const file of ['widget.css','booking-shell.css','booking-tags.css','booking-financial.css','interface-system.css']) await page.addStyleTag({content:fs.readFileSync('app/styles/'+file,'utf8')});
  await page.addScriptTag({content:'const state={currentUserRelationshipRecordId:"1",currentUserRelationshipProfile:"Administrator",bookingTagRelationships:[]};'});
  for(const file of ['utils.js','booking-financial.js','booking-tags-data.js','booking-tags.js']) await page.addScriptTag({content:fs.readFileSync('app/js/'+file,'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')});
  await page.evaluate(()=>{
   catalog={version:1,tags:Array.from({length:8},(_,i)=>({id:'tag'+i,name:['VIP','AGENT','MEET AND GREET','RESTAURANTES','TICKETS','MENUS','SHOREX','LONG TAG THAT WRAPS'][i],color:['#93c5fd','#fde68a','#86efac'][i%3]}))};
   const tags=JSON.stringify({version:1,users:{'1':catalog.tags.map(t=>t.id)}});
   window.fixture={id:'booking1',Currency:'EUR',Sales_Price_inc_Taxes:1234567890.12,Purchase_Price_inc_Taxes:7177.35,Balance_Amount:10429.03,Balance_due_date:'2026-09-28',Total_Requested_Amount:15000,Paid_Amount:0,Total_Refund_Amount:null,Sales_Tags_JSON:tags,Reservations_Tags_JSON:tags};
   document.getElementById('booking-personal-tags').innerHTML=renderBookingTags(fixture,false);
   document.getElementById('summary-content').innerHTML=renderBookingFinancial(fixture,3251.68,-234.56,new Date('2026-09-29T12:00:00Z'));
   document.getElementById('summary-view-basic').classList.remove('is-active');
   document.getElementById('summary-view-financial').classList.add('is-active');
  });
  const cards=page.locator('.financial-card');
  assert.equal((await cards.nth(0).boundingBox()).y,(await cards.nth(1).boundingBox()).y);
  assert.equal(await page.locator('[data-booking-tags]').count(),2);
  assert.equal(await page.locator('.financial-status').count(),2);
  await page.getByRole('button',{name:'Financial',exact:true}).focus();
  assert.notEqual(await page.getByRole('button',{name:'Financial',exact:true}).evaluate(el=>getComputedStyle(el).outlineStyle),'none');
  await page.screenshot({path:'_local/artifacts/screenshots/financial-desktop.png',fullPage:true});
  // Keep desktop viewport: layout must respond to widget width, not the screen.
  for(const width of [680,390,280]) {
   await page.locator('#manage-booking-panel').evaluate((el,width)=>el.style.width=width+'px',width);
   assert.ok((await cards.nth(1).boundingBox()).y>(await cards.nth(0).boundingBox()).y);
   const overflow=await page.locator('#manage-booking-panel').evaluate(el=>[el,...el.querySelectorAll('*')].filter(n=>n.clientWidth>0&&n.scrollWidth>n.clientWidth+1).map(n=>n.className));
   assert.deepEqual(overflow,[],'No clipped content at '+width+'px');
  }
  await page.locator('#manage-booking-panel').evaluate(el=>el.style.width='390px');
  await page.screenshot({path:'_local/artifacts/screenshots/financial-narrow.png',fullPage:true});
  console.log('Desktop columns, narrow widget stacking, large amounts, tags, focus and no overflow passed.');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
