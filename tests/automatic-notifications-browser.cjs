const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs'), assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try {
  const page=await browser.newPage();
  await page.setContent('<nav><button id="emails-tab">Emails</button><button id="services-tab">Services</button></nav><section id="manual-panel"><button id="automatic-entry">Automatic notifications</button><div>Manual email selection</div></section><section id="services-panel"></section><main id="automatic" hidden></main>');
  const renderSource=fs.readFileSync('app/js/render.js','utf8');
  await page.addScriptTag({content:renderSource.slice(renderSource.indexOf('export function renderActiveTab('),renderSource.indexOf('export function setButtonsDisabled(')).replace('export ','')});
  await page.addStyleTag({content:fs.readFileSync('app/styles/automatic-notifications.css','utf8')});
  await page.addScriptTag({content:fs.readFileSync('app/js/utils.js','utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')});
  await page.addScriptTag({content:`
   window.calls=[]; window.failSearch=false; window.failArchive=false;
   window.backCalls=0; window.fixture={id:'1',Booking:{id:'123'},Execution_Mode:'Automatic',Rendered_Subject:'Booking update',Recipient_To:'real@example.com',Sender_Email:'sender@example.com',Recipient_CC:'copy@example.com',Recipient_BCC:'private@example.com',Communication_Status:'Sent',Render_Status:'Failed',Render_Error:'Archive warning',Created_Time:'2026-11-10',Sent_At:'2026-11-11',Render_Model_JSON:JSON.stringify({native_email_archive:{storage:'__email_drafts',draft_id:'archive'}})};
   window.htmlBody='<style>body{background:rgb(1,2,3)}</style><script>parent.compromised=true<'+ '/script><meta http-equiv="refresh" content="0;url=https://example.com"><a href="https://example.com">Link</a><img src="https://example.com/tracking"><p>'+ 'x'.repeat(36812) + '</p>';
   async function crmSearchRecord(...args){calls.push(args); if(failSearch) throw Error('denied'); return [fixture,{...fixture,id:'manual',Execution_Mode:'Manual'},{...fixture,id:'queued',Communication_Status:'Queued',Rendered_Subject:null,Sent_At:null}];}
   async function crmGetRecord(){return fixture;}
   async function crmExecuteFunction(name,args){calls.push({name,args});if(failArchive)throw Error('denied');return {code:'success',details:{output:JSON.stringify({error:false,data:[{id:'archive',content:htmlBody,to:'technical@example.com',from:'technical@example.com'}]})}};}

  `});
  await page.addScriptTag({content:fs.readFileSync('app/js/automatic-notifications.js','utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')});
  await page.evaluate(async()=>{
    window.state={selectedBookingId:'123',selectedBooking:{id:'123'},activeTab:'emails',selectedDraftRecordId:'manual-selected'};
    window.ui={manageAutomaticPanel:document.querySelector('main'),manageEmailsPanel:document.querySelector('#manual-panel'),manageServicesPanel:document.querySelector('#services-panel'),tabEmails:document.querySelector('#emails-tab'),tabServices:document.querySelector('#services-tab'),tabAutomatic:document.querySelector('#automatic-entry')};
    window.controller=createAutomaticNotificationsController(ui,state,{onBack:()=>{backCalls++;state.activeTab='emails';renderActiveTab(ui,state);ui.tabAutomatic.focus();}});
    ui.tabAutomatic.addEventListener('click',()=>{state.activeTab='automatic';renderActiveTab(ui,state);void controller.ensure();});
    renderActiveTab(ui,state);ui.tabAutomatic.click();await controller.ensure(true);
  });
  assert.equal(await page.locator('.automatic-notification').count(),2);
  await page.getByRole('button',{name:'Back to Emails'}).click();
  assert.equal(await page.evaluate(()=>window.backCalls),1);
  assert.equal(await page.locator('#manual-panel').isVisible(),true);
  assert.equal(await page.locator('main').isVisible(),false);
  assert.equal(await page.evaluate(()=>document.activeElement===ui.tabAutomatic),true);
  assert.equal(await page.evaluate(()=>state.selectedDraftRecordId),'manual-selected');
  await page.locator('#automatic-entry').click();
  assert.equal(await page.locator('#emails-tab').evaluate(el=>el.classList.contains('active')),true);
  const summary=page.locator('.automatic-notification > summary').first();
  await summary.focus(); await page.keyboard.press('Enter');
  await page.waitForSelector('iframe');
  assert.equal(await summary.evaluate(el=>el===document.activeElement),true,'Opening preserves keyboard focus');
  const text=await page.locator('[data-notification-detail]').first().innerText();
  assert.ok(text.includes('private@example.com')&&text.includes('real@example.com'));
  assert.ok(!text.includes('technical@example.com')&&!text.includes('Delivered'));
  assert.ok(text.includes('Delivery to each recipient is not confirmed.'));
  assert.ok((await page.evaluate(()=>window.calls[0][1])).includes('(Execution_Mode:equals:Automatic)'));
  const frame=page.frames()[1];
  await frame.waitForSelector('p');
  assert.equal(await frame.locator('p').innerText(),'x'.repeat(36812));
  assert.equal(await page.evaluate(()=>window.compromised),undefined);
  assert.equal(await frame.locator('script,meta[http-equiv="refresh"],a[href],img[src^="https"]').count(),0);
  assert.equal(await page.locator('iframe').getAttribute('sandbox'),'');
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgba(0, 0, 0, 0)');
  await page.evaluate(async()=>{fixture.Recipient_To=Array.from({length:45},(_,i)=>`person${i}@example.com`).join(',');crmSearchRecord=async()=>{if(failSearch)throw Error('denied');return [fixture];};await controller.ensure(true);});
  await page.waitForSelector('iframe');
  assert.equal(await page.locator('.automatic-notification').count(),1);
  assert.equal(await page.locator('.automatic-notification').evaluate(el=>el.open),true,'Single result opens its email content automatically');
  assert.ok((await page.locator('.automatic-notification > summary').innerText()).includes('+44 recipients'));
  assert.ok(!(await page.locator('.automatic-notification > summary').innerText()).includes('person44@example.com'));
  assert.ok((await page.locator('.automatic-notification > summary').boundingBox()).height < 145,'45 recipients do not inflate the list row');
  await page.locator('.automatic-addresses > summary').first().click();
  assert.ok(await page.getByText('person44@example.com',{exact:true}).isVisible());
  for (const width of [390,680,1200]) {
    await page.setViewportSize({width,height:900});
    assert.equal(await page.locator('main').evaluate(el=>el.scrollWidth <= el.clientWidth+1),true,'No horizontal overflow at '+width);
  }
  await page.evaluate(()=>{window.failArchive=true;});
  await page.getByRole('button',{name:'Refresh automatic notifications',exact:true}).click();
  await page.waitForSelector('[data-notification-detail] p');
  assert.ok((await page.locator('[data-notification-detail]').first().innerText()).includes('Email content is not available'));
  assert.equal((await page.locator('.automatic-notification > summary .automatic-status').first().innerText()).replace(/\s+/g,' '),'✓ Sent');
  await page.evaluate(()=>{window.failSearch=true;});
  await page.getByRole('button',{name:'Refresh automatic notifications',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-automatic-status]').textContent.includes('Could not load'));
  assert.equal(await page.locator('.automatic-notification').count(),0);
  await page.evaluate(async()=>{window.failSearch=false;crmSearchRecord=async()=>[];await controller.ensure(true);});
  assert.ok((await page.locator('[data-automatic-status]').innerText()).includes('No automatic notifications'));
  await page.evaluate(async()=>{crmSearchRecord=async()=>AUTOMATIC_STATUSES.map((status,i)=>({...fixture,id:String(i),Communication_Status:status}));await controller.ensure(true);});
  for (const status of ['Queued','Sending','Sent','Failed','Unknown','Skipped']) assert.ok((await page.locator('.automatic-notification > summary').allInnerTexts()).some(text=>text.includes(status)));
  await page.evaluate(()=>{window.lateResolve=null;crmSearchRecord=()=>new Promise(resolve=>window.lateResolve=resolve);window.pending=controller.ensure(true);state.selectedBookingId='456';state.selectedBooking={id:'456'};controller.reset();window.lateResolve([fixture]);});
  await page.evaluate(async()=>{await window.pending;});
  assert.equal(await page.locator('.automatic-notification').count(),0);
  console.log('PASS: compact list, manual exclusion, keyboard focus, real recipients, full 36k+ body, isolated HTML, archive/send separation, refresh, empty/error states and booking reset. No screenshots created.');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
