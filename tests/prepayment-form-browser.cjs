const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
 const browser = await chromium.launch({ headless: true, channel: 'msedge' });
 try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Los_Angeles' });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.clock.install({ time: new Date('2026-11-12T10:00:00Z') });
  await page.setContent('<button id="launcher">Open prepayment</button>');
  for (const file of ['widget.css', 'booking-shell.css', 'service-status-dropdown.css', 'prepayment-form.css', 'interface-system.css']) await page.addStyleTag({ content: fs.readFileSync(path.join(__dirname, '../app/styles', file), 'utf8') });
  await page.addScriptTag({ content: `
   window.MODULES = { prepaymentRequests: 'Requests', prepayments: 'Payments', bookingServices: 'Services', prepaymentRequestServices: 'Links' };
   window.escapeHtml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
   window.escapeCriteriaValue = String; window.getLookupName = value => value?.name || '';
   window.getServiceSupplierName = service => service.Supplier?.name || '';
   window.formatDate = String; window.formatDateTime = String; window.showFeedback = () => {};
   window.requireSupplierPaymentReference = async () => 'SUP-123'; window.requirePaymentSettlement = async () => 'settlement';
   window.crmSearchRecord = async () => []; window.writes = [];
   window.crmCreateRecord = async (module, payload) => { writes.push({module,payload}); return { details: { id: 'created-' + writes.length } }; };
   window.crmUpdateRecord = async () => ({code:'SUCCESS'});
   window.crmGetRecord = async () => ({Proforma_Attached:[{file_Id:'file'}]});
  ` });
  for (const file of ['service-status-dropdown.js', 'prepayments-controller.js']) await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../app/js', file), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '') });
  await page.evaluate(async () => {
   window.services = [
    {id:'late', Booking:{id:'b'}, Supplier:{id:'s',name:'Local Expert Guides'}, Product_Description:'Private museum visit with a long descriptive service name',Service_Date:'2026-11-25',Total_Purchase_Price:400},
    {id:'early', Booking:{id:'b'}, Supplier:{id:'s',name:'Local Expert Guides'}, Product_Description:'Walking tour',Service_Date:'2026-11-24',Total_Purchase_Price:100}
   ];
   window.state = {selectedBookingId:'b',selectedBooking:{MFSP_Reference:'MFSP2600123',Deal_Name:'A family journey through Spain'},currentUserEmail:'reservations@example.com',services:[...services,...Array.from({length:8},(_,i)=>({...services[0],id:'other-'+i,Product_Description:'Optional service '+(i+1)}))],
    prepaymentsData:{bookingId:'b',loaded:true,requests:[{id:'existing',Name:'Existing request',Supplier:{id:'s'},Amount:500,Transaction_Type:'Partial Payment',Currency:'EUR'}],payments:[]}};
   await openPrepaymentForm({},state,null,services);
   readPrepaymentServices = async () => services;
   linkPrepaymentServices = async () => {};
   savePrepaymentProforma = async () => [{file_Id:'file'}];
   uploadFile = async () => [{File_Id__s:'file'}];
   ensurePrepaymentsLoaded = async () => {};
  });
  const field = name => page.locator(`[name="${name}"]`);
  const row = page.locator('.prepayment-entry').first();
  const timing = row.getByRole('combobox', { name: 'Payment timing', exact: true });
  const chooseTiming = async name => { await timing.click(); await page.getByRole('option', { name, exact:true }).click(); };
  await field('request').selectOption('existing');
  assert.equal(await page.locator('[data-new-request]').isVisible(),false);
  assert.equal(await field('requestAmount').evaluate(el=>el.readOnly),true);
  await field('request').selectOption('');
  assert.equal(await page.locator('[data-new-request]').isVisible(),true);
  await timing.click(); await timing.press('ArrowDown'); await timing.press('Escape');
  assert.equal(await field('timing1').inputValue(),'Specific Date');
  assert.equal(await page.locator('#new-prepayment-dialog').isVisible(),true);
  assert.equal(await row.locator('[data-calculation]').isVisible(), false);
  assert.equal(await field('referenceService1').inputValue(), 'early');
  assert.equal(await page.locator('[data-service-options]').evaluate(el=>el.scrollHeight>el.clientHeight),true);
  await chooseTiming('10 days prior to service date');
  assert.equal(await field('dueDate1').inputValue(), '2026-11-13');
  assert.match(await row.locator('[data-adjustment]').innerText(), /14 Nov 2026/);
  await row.getByRole('button',{name:'Change',exact:true}).click();
  await page.getByRole('option',{name:/Private museum.*2026-11-25/}).click();
  assert.equal(await field('referenceService1').inputValue(),'late');
  assert.equal(await field('dueDate1').inputValue(),'2026-11-13');
  assert.match(await row.locator('[data-adjustment]').innerText(),/15 Nov 2026/);
  await page.locator('[data-prepayment-service="late"]').uncheck();
  assert.equal(await field('referenceService1').inputValue(),'early');
  assert.match(await row.locator('[data-reference-change]').innerText(),/Reference updated/);
  assert.equal(await row.getByRole('button',{name:'Change',exact:true}).isVisible(),false);
  await page.evaluate(() => { services[0].Service_Date = services[1].Service_Date; });
  await page.locator('[data-prepayment-service="late"]').check();
  assert.equal(await field('referenceService1').inputValue(),'early');
  await page.evaluate(() => { services[1].Service_Date = ''; });
  await chooseTiming('Within 1 day');
  assert.equal(await field('dueDate1').inputValue(),'');
  assert.match(await row.locator('[data-reference-error]').innerText(),/no valid service date/);
  await page.evaluate(() => { services[1].Service_Date = '2026-11-24'; });
  await chooseTiming('Specific Date');
  assert.equal(await row.locator('[data-calculation]').isVisible(),false);
  await field('dueDate1').fill('2026-11-14'); await field('dueDate1').blur();
  assert.equal(await field('dueDate1').inputValue(),'');
  await field('dueDate1').fill('2026-11-16');
  await chooseTiming('10 days prior to service date');
  await field('transactionType').selectOption('Partial Payment');
  await page.getByRole('button',{name:'+ Add prepayment'}).click();
  assert.equal(await field('amount1').inputValue(),'250.00'); assert.equal(await field('amount2').inputValue(),'250.00');
  await field('distribution').selectOption('Manual');
  await field('percent1').fill('40'); assert.equal(await field('amount1').inputValue(),'200.00');
  await field('amount2').fill('300'); assert.equal(await field('percent2').inputValue(),'60.00');
  await field('dueDate2').fill('2026-11-16');
  await field('proforma').setInputFiles({name:'invoice.pdf',mimeType:'application/pdf',buffer:Buffer.from('test')});
  assert.match(await page.locator('[data-file-list]').innerText(),/invoice.pdf/);
  // Save desktop and narrow layouts with the footer always in view.
  await page.locator('.prepayment-form-scroll').evaluate(el => el.scrollTop=el.scrollHeight);
  await page.screenshot({path:path.join(__dirname,'../_local/artifacts/prepayment-form-desktop.png')});
  for (const width of [820,390]) {
   await page.setViewportSize({width,height:850});
   assert.equal(await page.locator('.prepayment-form-scroll').evaluate(el => el.scrollWidth <= el.clientWidth + 1),true);
   const footer = await page.locator('.prepayment-form-actions').boundingBox(); assert.ok(footer.y + footer.height <= 850);
   await page.locator('.prepayment-form-scroll').evaluate(el=>el.scrollTop=el.scrollHeight);
   await page.screenshot({path:path.join(__dirname,`../_local/artifacts/prepayment-form-${width}.png`)});
  }
  await page.setViewportSize({width:1280,height:900});
  await page.locator('.prepayment-form-scroll').evaluate(el=>el.scrollTop=0);
  await page.screenshot({path:path.join(__dirname,'../_local/artifacts/prepayment-form-top.png')});
  await page.evaluate(() => { readPrepaymentServices = async () => services.map(item=>({...item,Service_Date:item.id==='early'?'2026-11-26':item.Service_Date})); });
  await page.getByRole('button',{name:'Save prepayments',exact:true}).click();
  await page.waitForFunction(() => document.querySelector('[data-feedback]').textContent.includes('date changed in CRM'));
  assert.equal(await page.evaluate(()=>writes.length),0);
  assert.equal(await field('dueDate1').inputValue(),'2026-11-16');
  const shown = await field('dueDate1').inputValue();
  await page.getByRole('button',{name:'Save prepayments',exact:true}).click();
  await page.waitForFunction(() => !document.getElementById('new-prepayment-dialog'));
  const writes = await page.evaluate(() => window.writes);
  assert.equal(writes.filter(w=>w.module==='Payments').length,2);
  assert.equal(writes.find(w=>w.module==='Payments').payload.Due_Date,shown);
  assert.equal(writes.filter(w=>w.module==='Payments').reduce((sum,w)=>sum+w.payload.Amount,0),500);
  assert.deepEqual(errors,[]);
  console.log('PASS prepayment browser: reference selection/removal, automatic and manual dates, missing dates, equal/manual split, attachment, responsive layouts, and displayed date equals saved date.');
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
