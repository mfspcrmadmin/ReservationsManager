const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.setContent('<button id="open">Edit</button>');
    for (const file of ['widget.css', 'booking-shell.css', 'interface-system.css']) await page.addStyleTag({ content: fs.readFileSync('app/styles/' + file, 'utf8') });
    await page.addScriptTag({ content: `
      const MODULES = {cardPurchases:'Card_Purchases', paymentAccounts:'Payment_Accounts'};
      const state = {selectedBookingId:'30'};
      const record = {id:'10',Name:'Purchase - TEST',Booking:{id:'30'},Transaction_Type:'Purchase',Accounting_Status:'Pending invoice',Amount:100,Transaction_Date:'2026-10-05T12:00:00+02:00',Card_Payment_Account:{id:'20',name:'Company card'},Supporting_Documents:[{id:'40',File_Name__s:'Receipt.pdf'}]};
      window.writes = [];
      const crmGetRecord = async () => ({...record});
      const requestCardPurchaseV8 = async () => ({...record});
      const crmGetAllRecords = async () => [{id:'20',Name:'Company card',Owner_Type:'Own'}];
      const crmUpdateRecord = async (module,payload) => {window.writes.push(payload);return {code:'SUCCESS'};};
      const showFeedback = () => {};
      const escapeHtml = value => String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
    ` });
    await page.addScriptTag({ content: fs.readFileSync('app/js/card-purchase-management.js', 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '') });
    await page.evaluate(() => { document.querySelector('#open').onclick = () => openCardPurchaseManagement({}, state, '10'); });
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    assert.equal(await page.getByLabel('Amount (EUR)', { exact: true }).inputValue(), '100');
    assert.equal(await page.getByLabel('Transaction date', { exact: true }).inputValue(), '2026-10-05');
    assert.equal(await page.getByRole('combobox').inputValue(), '20');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await dialog.count(), 0);
    assert.equal(await page.evaluate(() => writes.length), 0);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await dialog.waitFor();
    await page.getByLabel('Amount (EUR)', { exact: true }).fill('125.50');
    await page.evaluate(() => { record.Accounting_Status = 'Purchase recorded'; });
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'initial accounting status' }).waitFor();
    assert.equal(await page.evaluate(() => writes.length), 0);
    await page.evaluate(() => { record.Accounting_Status = 'Pending invoice'; });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => writes[0].Amount), 125.5);
    console.log('Card editor: prefilled fields, cancel, live status rejection, mobile width and save passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
