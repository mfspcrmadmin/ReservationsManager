const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    await page.route('http://widget.test/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
    await page.goto('http://widget.test/');
    const html = fs.readFileSync('app/widget.html', 'utf8');
    const start = html.indexOf('<div class="table-wrap payments-card-purchases-table-wrap">');
    await page.setContent('<main style="width:900px">' + html.slice(start, html.indexOf('</table></div>', start) + '</table></div>'.length) + '</main>');
    for (const file of ['widget.css', 'booking-shell.css']) await page.addStyleTag({ content: fs.readFileSync('app/styles/' + file, 'utf8') });
    await page.addScriptTag({ content: `
      const escapeHtml = String, formatCurrency = String, formatDateTime = String;
      const getLookupName = value => value?.name || '';
      const canEditCardPurchase = record => record.Accounting_Status === 'Pending invoice';
      const elements = {cardPurchasesBody:document.querySelector('#card-purchases-body')};
    ` });
    for (const file of ['service-column-resizing.js', 'payments-controller.js']) await page.addScriptTag({ content: fs.readFileSync('app/js/' + file, 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '') });
    await page.evaluate(() => {
      localStorage.setItem('bookingsManager.cardPurchaseColumnWidths', JSON.stringify({ actions: 80 }));
      initializeCardPurchaseColumns(elements);
      initializeCardPurchaseColumns(elements);
      elements.cardPurchasesBody.innerHTML = Array.from({length:20}, (_,i) => renderCardPurchaseRow({id:String(i),Name:'Purchase '+i,Accounting_Status:i ? 'Purchase recorded' : 'Pending invoice',Transaction_Notes:'Long notes '.repeat(30)})).join('');
    });
    assert.equal(await page.getByRole('separator').count(), 11);
    assert.equal(await page.locator('thead th').last().textContent(), 'Actions');
    assert.equal(await page.locator('tbody tr').first().locator('td').count(), 12);
    assert.equal(await page.locator('tbody tr').first().locator('td').last().getByRole('button').count(), 2);
    const wrap = page.locator('.payments-card-purchases-table-wrap');
    const checkSticky = async () => {
      const bounds = await wrap.boundingBox();
      for (const selector of ['th.card-purchase-col-actions', 'tbody tr:first-child .card-purchase-col-actions']) {
        const cell = await page.locator(selector).boundingBox();
        assert.ok(Math.abs(cell.x + cell.width - (bounds.x + bounds.width)) < 20, selector + ' stays at right edge');
        assert.ok(Math.abs(cell.width - 120) < 1, 'Actions keeps its fixed width despite saved preferences');
      }
      assert.equal(await page.getByRole('button', {name:'Edit card transaction'}).first().isVisible(), true);
      const actions = await page.locator('tbody tr:first-child .card-purchase-col-actions').boundingBox();
      for (const name of ['Edit card transaction', 'Delete card transaction']) {
        const button = await page.getByRole('button', {name}).first().boundingBox();
        assert.ok(button.x >= actions.x + 12 && button.x + button.width <= actions.x + actions.width - 12, name + ' fits with side padding');
      }
    };
    await checkSticky();
    const handle = page.getByRole('separator', {name:'Resize Card transaction column', exact:true});
    const bounds = await handle.boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 + 75, bounds.y + bounds.height / 2);
    await page.mouse.up();
    assert.equal(await handle.getAttribute('aria-valuenow'), '285');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('bookingsManager.cardPurchaseColumnWidths')).name), 285);
    await wrap.evaluate(el => { el.scrollLeft = 700; });
    await checkSticky();
    await wrap.evaluate(el => { el.scrollTop = 120; });
    assert.ok((await page.locator('th.card-purchase-col-actions').boundingBox()).y < (await wrap.boundingBox()).y + 5);
    await page.setViewportSize({ width: 390, height: 800 });
    await page.locator('main').evaluate(el => { el.style.width = '350px'; });
    await checkSticky();
    console.log('Card columns: pointer resizing, saved widths, final Actions column and sticky desktop/mobile scrolling passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
