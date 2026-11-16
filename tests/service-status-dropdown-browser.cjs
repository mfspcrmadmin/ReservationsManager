const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
 const browser = await chromium.launch({ headless: true, channel: 'msedge' });
 try {
  const page = await browser.newPage({ viewport: { width: 640, height: 520 } });
  await page.setContent(`<main id="manage-services-panel"><div style="position:absolute;bottom:16px;right:12px;width:270px;height:100px;overflow:hidden"><div class="service-edit-label-row"><label for="field-payment-status">Payment Status</label><select id="field-payment-status" aria-label="Payment Status"><option value="">-None-</option><option value="pending">To be paid</option><option value="paid">Fully paid with an exceptionally long label to check panel boundaries</option><option value="refund">Refunded</option></select></div><button id="next">Next field</button></div></main>`);
  for (const file of ['widget.css', 'booking-shell.css', 'service-status-dropdown.css', 'interface-system.css']) await page.addStyleTag({ content: fs.readFileSync(path.join(__dirname, '../app/styles', file), 'utf8') });
  await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../app/js/service-status-dropdown.js'), 'utf8').replace(/^export /gm, '') });
  await page.evaluate(() => { window.select = document.querySelector('select'); window.changes = 0; select.addEventListener('change', () => changes++); syncServiceStatusDropdown(select); });
  const trigger = page.getByRole('combobox', { name: 'Payment Status' });
  assert.equal(await trigger.innerText(), 'Not set');
  await trigger.click();
  const menu = page.getByRole('listbox');
  const fieldBox = await trigger.boundingBox(), menuBox = await menu.boundingBox();
  assert.equal(menuBox.width, fieldBox.width); assert.ok(menuBox.y + menuBox.height < fieldBox.y); assert.ok(menuBox.x + menuBox.width <= 640);
  await page.mouse.move(5, 5);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.service-state-trigger')).backgroundColor), 'rgb(255, 255, 255)');
  await trigger.press('ArrowDown'); assert.equal(await page.evaluate(() => changes), 0);
  await trigger.press('Escape'); assert.equal(await trigger.getAttribute('aria-expanded'), 'false'); assert.equal(await page.evaluate(() => changes), 0);
  await trigger.press('Enter'); await trigger.press('ArrowDown'); await trigger.press('Enter');
  assert.equal(await page.evaluate(() => select.value), 'pending'); assert.equal(await page.evaluate(() => changes), 1);
  await trigger.click(); await page.getByRole('option', { name: 'To be paid', exact: true }).click(); assert.equal(await page.evaluate(() => changes), 1);
  await trigger.click(); await page.getByRole('option', { name: 'Fully paid with', exact: false }).click();
  assert.equal(await page.evaluate(() => select.value), 'paid'); assert.ok((await trigger.boundingBox()).width <= 270);
  await trigger.click(); await trigger.press('Home'); await trigger.press('Enter'); assert.equal(await page.evaluate(() => select.value), '');
  await trigger.click(); await page.locator('body').click({ position: { x: 10, y: 10 } }); assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  await trigger.click(); await trigger.press('Tab'); assert.equal(await page.locator('#next').evaluate(el => el === document.activeElement), true);
  await page.evaluate(() => { select.disabled = true; select.dataset.saving = 'true'; }); assert.ok(await trigger.isDisabled()); assert.equal(await trigger.getAttribute('aria-busy'), 'true');
  await page.evaluate(() => { select.disabled = false; for (let i=0;i<20;i++) select.add(new Option('State '+i, String(i))); });
  await trigger.click(); assert.ok(await menu.evaluate(el => el.scrollHeight > el.clientHeight));
  await page.screenshot({ path: path.join(__dirname, '../_local/artifacts/service-status-dropdown.png') });
  console.log('PASS dropdown: empty and long labels, keyboard without accidental writes, selected value, clearing, outside click, Tab/Escape, busy/disabled, upward placement, width and internal scroll.');
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
