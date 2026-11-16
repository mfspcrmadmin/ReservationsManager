const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve('app');
const fixture=`<!doctype html><link rel="stylesheet" href="/styles/booking-documents.css"><link rel="stylesheet" href="/styles/interface-system.css"><style>body{margin:0} .document-studio{--line:#dbe4df;--text:#344c45;--muted:#6e8177;--accent:#147d64;--font-body:'Open Sans',Arial,sans-serif}</style><dialog class="document-studio"><button id="launch">Settings</button></dialog><script type="module">
import {openDocumentSettings} from '/js/document-settings.js';import {initStudioSelects} from '/js/studio-select.js';
document.querySelector('dialog').showModal();initStudioSelects();window.saves=[];window.saved=null;window.fail=false;window.release=null;
const records={'crm-step:1':{module:'Booking_Steps',step_type:'activity'},'crm-service:2':{module:'Booking_Services',supplier_id:'5',supplier:'A supplier with a particularly long company name',category:'transport'}};
window.launch=()=>openDocumentSettings({studio:document.querySelector('dialog'),doc:{settings:window.saved||{}},records,isCurrent:()=>true,setBusy:()=>{},onSaved:()=>{},save:async settings=>{saves.push(settings);if(window.waitSave)await new Promise(r=>window.release=r);if(window.fail)throw Error('Simulated failure.');window.saved=settings;return {};}});
document.querySelector('#launch').onclick=launch;window.ready=true;</script>`;
const server=http.createServer((req,res)=>{if(req.url==='/'){res.setHeader('Content-Type','text/html');return res.end(fixture);}const file=path.resolve(root,'.'+req.url.split('?')[0]);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.statusCode=404;return res.end();}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/css');res.end(fs.readFileSync(file));});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.ready);await page.click('#launch');
 const modal=page.locator('.document-settings-dialog'),body=modal.locator('.document-settings-body');
 await modal.getByRole('tab',{name:'Steps & contacts'}).click();
 await modal.locator('.settings-category-list').getByRole('button',{name:'Experience',exact:true}).click();
 await modal.getByRole('searchbox',{name:'Search step categories'}).fill('airport');
 assert.equal(await modal.locator('.studio-rule-row:visible h4').textContent(),'Experience');
 assert.equal(await modal.locator('.settings-category-list button:visible').count(),1);
 await modal.getByRole('searchbox',{name:'Search step categories'}).fill('');
 const currentRow=modal.locator('.studio-rule-row:visible');
 const subcategories=currentRow.getByRole('group',{name:'Supplier subcategories',exact:true});
 const selectedBefore=await subcategories.locator('input:checked').count();
 await currentRow.getByRole('searchbox',{name:'Search supplier subcategories'}).fill('taxi');
 assert.equal(await subcategories.locator('.settings-multi-options label:visible').count(),1);
 assert.equal(await subcategories.locator('input:checked').count(),selectedBefore);
 await subcategories.getByRole('checkbox',{name:'Taxi',exact:true}).check();
 await modal.locator('.settings-category-list').getByRole('button',{name:'Hotel',exact:true}).click();
 await modal.getByRole('tab',{name:'Dates & times'}).click();
 await modal.getByRole('tab',{name:'Steps & contacts'}).click();
 await modal.locator('.settings-category-list').getByRole('button',{name:'Experience',exact:true}).click();
 assert.equal(await subcategories.getByRole('checkbox',{name:'Taxi',exact:true}).isChecked(),true);
 await subcategories.getByRole('checkbox',{name:'Taxi',exact:true}).uncheck();
 await currentRow.getByRole('searchbox',{name:'Search supplier subcategories'}).fill('');
 await modal.getByRole('tab',{name:'General',exact:true}).click();
 for(const width of [1280,768,390]){
  await page.setViewportSize({width,height:740});
  for(const fraction of [0,.5,1]){
   await body.evaluate((el,f)=>el.scrollTop=(el.scrollHeight-el.clientHeight)*f,fraction);
   const geometry=await modal.evaluate(el=>{const r=n=>n.getBoundingClientRect();const m=r(el),h=r(el.querySelector('header')),b=r(el.querySelector('.document-settings-body')),f=r(el.querySelector('footer'));return {m:{x:m.x,right:m.right,bottom:m.bottom},h:{top:h.top,bottom:h.bottom},b:{top:b.top,bottom:b.bottom},f:{top:f.top,bottom:f.bottom},overflow:el.scrollWidth>el.clientWidth+1};});
   assert.ok(geometry.m.x>=0&&geometry.m.right<=width&&geometry.m.bottom<=740);assert.ok(geometry.b.top>=geometry.h.bottom-1&&geometry.b.bottom<=geometry.f.top+1);assert.ok(geometry.f.bottom<=geometry.m.bottom);assert.equal(geometry.overflow,false);
   if(fraction===1)await page.screenshot({path:`_local/artifacts/document-settings-bottom-${width}.png`});
  }
  for(const name of ['Steps & contacts','Dates & times','General']){
   await modal.getByRole('tab',{name,exact:true}).click();
   await body.evaluate(el=>el.scrollTop=0);
   assert.equal(await modal.evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
   assert.equal(await modal.locator('.settings-tab-panel:visible').count(),1);
   await page.waitForTimeout(180);assert.equal(await modal.locator('[role=tab][aria-selected=true]').count(),1);assert.equal(await modal.getByRole('tab',{name,exact:true}).getAttribute('aria-selected'),'true');await page.screenshot({path:`_local/artifacts/settings-tabs-${width}-${name.split(' ')[0]}.png`});
  }
  await body.evaluate(el=>el.scrollTop=0);
  const help=modal.getByRole('button',{name:'Help: 24h Rep',exact:true});await page.mouse.move(0,0);await help.hover();await page.waitForFunction(()=>!!document.querySelector('.studio-settings-help-popup:popover-open'));
  const bounds=await modal.locator('.studio-settings-help-popup:popover-open').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width&&bounds.y+bounds.height<=740);
  await help.focus();await page.keyboard.press('Escape');assert.equal(await modal.isVisible(),true);
  await page.screenshot({path:`_local/artifacts/document-settings-${width}.png`});
 }
 await modal.getByRole('tab',{name:'Steps & contacts'}).click();
 await body.evaluate(el=>el.scrollTop=el.scrollHeight);const filterTrigger=modal.locator('.studio-rule-row:visible').locator('.studio-select-trigger').last();await filterTrigger.scrollIntoViewIfNeeded();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await filterTrigger.click();
 const menuBounds=await modal.locator('.studio-select-menu:popover-open').boundingBox();assert.ok(menuBounds.x>=0&&menuBounds.x+menuBounds.width<=390&&menuBounds.y+menuBounds.height<=740);await page.keyboard.press('Escape');
 await modal.getByLabel('Step Category',{exact:true}).selectOption('hotel');
 assert.equal(await modal.locator('.studio-rule-row:visible').count(),1);
 // Category navigation alone must not trigger an unsaved-settings confirmation.
 await modal.getByRole('button',{name:'Close',exact:true}).click();assert.equal(await modal.count(),0);
 await page.click('#launch');
 await modal.getByRole('tab',{name:'Steps & contacts'}).click();
 await modal.getByLabel('Step Category',{exact:true}).selectOption('experience');
 await modal.locator('.studio-rule-row:visible').getByRole('switch',{name:'Show step',exact:true}).uncheck();
 assert.equal(await modal.locator('.studio-rule-row:visible .studio-category-details').isVisible(),false);
 await modal.getByLabel('Step Category',{exact:true}).selectOption('transfer');
 await modal.locator('.studio-rule-row:visible').getByLabel('Items shown',{exact:true}).selectOption('none');
 await modal.getByLabel('Step Category',{exact:true}).selectOption('experience');
 assert.equal(await modal.locator('.studio-rule-row:visible').getByRole('switch',{name:'Show step',exact:true}).isChecked(),false);

 await page.setViewportSize({width:1280,height:800});await body.evaluate(el=>el.scrollTop=0);
 await modal.getByRole('tab',{name:'General',exact:true}).click();
 await modal.locator('[name=emergency_team]').selectOption('616617000004054001');
 page.once('dialog',d=>d.dismiss());await modal.getByRole('button',{name:'Close',exact:true}).click();assert.equal(await modal.isVisible(),true);
 page.once('dialog',d=>d.dismiss());await page.keyboard.press('Escape');assert.equal(await modal.isVisible(),true);
 await page.evaluate(()=>{window.fail=true;window.waitSave=true;});await modal.getByRole('button',{name:'Save settings',exact:true}).click();
 assert.equal(await modal.getByRole('button',{name:'Save settings',exact:true}).isDisabled(),true);await page.evaluate(()=>document.querySelector('.document-settings-dialog form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));assert.equal(await page.evaluate(()=>saves.length),1);assert.equal(await page.evaluate(()=>saves[0].rules.step_categories.experience.step_visibility),'hidden');assert.equal(await page.evaluate(()=>saves[0].rules.step_categories.transfer.services),'none');
 await page.evaluate(()=>release());await modal.locator('[data-status][role=alert]').waitFor();assert.equal(await modal.locator('[name=emergency_team]').inputValue(),'616617000004054001');
 await page.evaluate(()=>{window.fail=false;window.waitSave=false;});await modal.getByRole('button',{name:'Save settings',exact:true}).click();await modal.waitFor({state:'detached'});
 await page.click('#launch');assert.equal(await modal.locator('[name=emergency_team]').inputValue(),'616617000004054001');await modal.getByRole('tab',{name:'Dates & times',exact:true}).click();await modal.locator('[name=output_time]').selectOption('h:mm a');assert.match(await modal.locator('[data-output-date-example]').textContent(),/PM/);
 page.once('dialog',d=>d.accept());await modal.getByRole('button',{name:'Cancel',exact:true}).click();await modal.waitFor({state:'detached'});assert.equal(await page.evaluate(()=>saves.length),2);assert.equal(await page.locator('#launch').evaluate(n=>n===document.activeElement),true);
 await page.click('#launch');await modal.getByRole('button',{name:'Apply to whole document',exact:true}).click();
 const confirmation=page.locator('.document-rules-confirm');await confirmation.waitFor();assert.equal(await page.evaluate(()=>saves.length),2);
 await confirmation.getByRole('button',{name:'Keep individual settings',exact:true}).click();assert.equal(await modal.isVisible(),true);assert.equal(await page.evaluate(()=>saves.length),2);
 await modal.getByRole('button',{name:'Apply to whole document',exact:true}).click();await confirmation.getByRole('button',{name:'Apply to whole document',exact:true}).click();await modal.waitFor({state:'detached'});
 assert.equal(await page.evaluate(()=>saves.length),3);assert.equal(await page.evaluate(()=>saves[2].apply_to_all),true);assert.equal(await page.evaluate(()=>saves[2].confirmed),true);assert.equal(await page.evaluate(()=>saves[1].apply_to_all),undefined);
 await page.setViewportSize({width:600,height:400});await page.click('#launch');
 await modal.getByRole('tab',{name:'General',exact:true}).focus();await page.keyboard.press('End');
 assert.equal(await modal.getByRole('tab',{name:'Steps & contacts',exact:true}).getAttribute('aria-selected'),'true');
 assert.ok(await body.evaluate(el=>el.clientHeight>30));
 const smallBounds=await modal.boundingBox();assert.ok(smallBounds.y>=0&&smallBounds.y+smallBounds.height<=400);
 await page.screenshot({path:'_local/artifacts/settings-small-window.png'});
 await modal.getByRole('button',{name:'Cancel',exact:true}).click();
 assert.deepEqual(errors,[]);console.log('PASS settings: fixed header/footer at three scroll positions, desktop/tablet/mobile, contextual help, dirty close/Escape, save failure/retry, duplicate prevention, restore and cancel.');
}finally{await browser.close();server.close();}})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
