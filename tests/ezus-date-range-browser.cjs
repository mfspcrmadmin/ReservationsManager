// Run with PLAYWRIGHT_MODULE pointing to an installed Playwright package. Uses only mocked CRM data.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const root = require('node:path').resolve(__dirname, '../app') + '/';
(async () => {
 const browser = await chromium.launch({channel:'msedge',headless:true});
 try {
  for (const [locale, timezoneId] of [['es-ES', 'Europe/Madrid'], ['en-US', 'America/Los_Angeles'], ['en-GB', 'Europe/London']]) {
  const page = await browser.newPage({locale, timezoneId, viewport:{width:1100,height:1000}});
  const css = [...fs.readFileSync(root+'widget.html','utf8').matchAll(/href="\.\/styles\/([^\"]+\.css)"/g)].map(m=>fs.readFileSync(root+'styles/'+m[1],'utf8')).join('\n');
  await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body></body></html>');
  await page.evaluate(()=>{
   window.getLookupName=value=>value?.name||'';
   window.crmGetRecord=async()=>({id:'123',Deal_Name:'Autumn in Spain',Account_Name:{id:'2',name:'Client'},Contact_Name:{id:'3',name:'Contact'},Arrival_Date:'2026-10-01',Departure_Date:'2026-10-10'});
  });
  for(const file of ['ezus-date-range.js','create-ezus-dialog.js']) await page.addScriptTag({content:fs.readFileSync(root+'js/'+file,'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')});
  await page.evaluate(()=>openCreateEzusDialog({bookingId:'123',isCurrent:()=>true,onContinue:async values=>{
   window.submittedDates = {arrival: values.Arrival_Date, departure: values.Departure_Date};
   return {booking: {Ezus_Project_ID: 'mock-project', MFSP_Reference: 'MFSP123'}};
  }}));
  await page.locator('.ezus-range-toggle').click();
  await page.locator('[data-day="2026-10-12"]').click();
  assert.equal(await page.locator('[name="Arrival_Date"]').inputValue(),'2026-10-12');
  assert.equal(await page.locator('[name="Departure_Date"]').inputValue(),'');
  assert.equal(await page.locator('[data-day="2026-10-11"]').isDisabled(),true);
  assert.equal(await page.locator('[data-day="2026-11-20"]').isDisabled(),false);
  assert.equal(await page.locator('[data-day="2026-11-21"]').isDisabled(),true);
  await page.locator('[data-day="2026-10-20"]').hover();
  assert.equal(await page.locator('.is-between').count(),7);
  await page.locator('[data-day="2026-10-20"]').click();
  assert.equal(await page.locator('[name="Departure_Date"]').inputValue(),'2026-10-20');
  assert.equal(await page.locator('.is-between').count(),7);
  assert.match(await page.locator('[data-range-instruction]').innerText(),/9 days/);
  if (process.env.SCREENSHOT_DIR) await page.screenshot({path:process.env.SCREENSHOT_DIR+'/ezus-range-desktop.png'});
  await page.locator('[data-day="2026-10-20"]').press('ArrowRight');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('[name="Departure_Date"]').inputValue(),'2026-10-21');
  await page.locator('[data-range-mode="arrival"]').click();
  await page.locator('[data-day="2026-10-30"]').click();
  await page.locator('[data-day="2026-11-05"]').click();
  assert.equal(await page.locator('[name="Departure_Date"]').inputValue(),'2026-11-05');
  await page.setViewportSize({width:375,height:850});
  await page.locator('.ezus-range-panel').scrollIntoViewIfNeeded();
  assert.ok(await page.locator('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth));
  if (process.env.SCREENSHOT_DIR) await page.screenshot({path:process.env.SCREENSHOT_DIR+'/ezus-range-mobile.png'});
  await page.locator('[data-day="2026-11-05"]').press('Escape');
  assert.equal(await page.locator('.ezus-range-panel').isVisible(),false);
  assert.equal(await page.locator('dialog').count(),1);
  await page.locator('button[type="submit"]').click();
  assert.deepEqual(await page.evaluate(()=>window.submittedDates), {arrival:'2026-10-30', departure:'2026-11-05'});
  await page.locator('[data-result-title]').filter({hasText:'Successfully created'}).waitFor();
  await page.locator('[data-dialog-dismiss]').click();
  await page.close();
  console.log('Verified calendar and ISO submission for ' + locale + ' / ' + timezoneId);
  }
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
