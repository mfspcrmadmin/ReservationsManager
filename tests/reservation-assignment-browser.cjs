const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const source = fs.readFileSync('app/js/booking-controller.js', 'utf8');
function extract(name) {
  const start = source.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
  const tail = source.slice(start);
  return tail.slice(0, tail.indexOf('\n}') + 2);
}
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
    await page.setContent('<button id="open">Open</button>');
    await page.addStyleTag({ content: fs.readFileSync('app/styles/widget.css', 'utf8') });
    await page.addStyleTag({ content: fs.readFileSync('app/styles/interface-system.css', 'utf8') });
    await page.addScriptTag({ content: fs.readFileSync('app/js/interface-system.js', 'utf8').replace(/^export /gm, '') });
    await page.addScriptTag({ content: fs.readFileSync('app/js/queue-dropdowns.js', 'utf8').replace(/^export /gm, '') });
    await page.addScriptTag({ content: fs.readFileSync('app/js/utils.js', 'utf8').replace(/^export /gm, '') });
    await page.addScriptTag({ content: 'const initMailFormatting = () => {}, initFloatingLayer = () => {}, init = () => {}, onToggleServiceColumnsPanel = () => {};\n' + fs.readFileSync('app/js/main.js', 'utf8').replace(/^import .*;\r?\n/gm, '') });
    await page.addScriptTag({ content: `
      const state = { selectedBookingId: '123', bookingBlueprint: { processInfo: { field_value: 'Pending Res Assignment' } } };
      const elements = {};
      const setError = () => {};
      const loadAllUserRelationshipRecords = async () => [];
      const buildOwnerOptionsFromUserRelationships = () => Array.from({ length: 30 }, (_, i) => ({ value: String(i + 1), label: i === 1 ? 'María Álvarez' : 'Representative ' + (i + 1) }));
      const executeBlueprintTransition = (transition, data) => new Promise((resolve, reject) => { window.sentData = data; window.finishAssignment = resolve; window.failAssignment = reject; });
      ${['openBlueprintTransitionDialog', 'getBlueprintTransitionFields', 'normalizeBlueprintColor', 'renderBlueprintTransitionField', 'populateBlueprintReservationUsers', 'initializeReservationSelector', 'collectBlueprintTransitionData'].map(extract).join('\n')}
      document.querySelector('#open').onclick = () => openBlueprintTransitionDialog({ id: '456', name: 'Assign Reservation', next_field_value: 'Reservation In Progress', fields: [] }, 'Assign Reservation');
    ` });
    await page.click('#open');
    const submit = page.getByRole('button', { name: 'Assign & continue' });
    const select = page.locator('.reservation-selector');
    await select.waitFor();
    assert.equal(await submit.isDisabled(), true);
    assert.equal(await page.getByText('Workflow transition', { exact: true }).count(), 0);
    assert.equal(await page.locator('[data-dialog-dismiss]').count(), 1);
    assert.equal(await page.locator('.booking-action-dialog-dismiss').count(), 0);
    await page.evaluate(() => {
      // The global decorator must also respect a modal's own close control
      // before it has the global marker, and remain idempotent.
      const close = document.querySelector('[data-dismiss]');
      close.removeAttribute('data-dialog-dismiss');
      addDialogCloseButtons(document);
      addDialogCloseButtons(document);
      close.setAttribute('data-dialog-dismiss', '');
    });
    assert.equal(await page.locator('.booking-action-dialog-dismiss').count(), 0);
    const search = page.getByRole('combobox', { name: 'Search representatives', exact: true });
    assert.equal(await search.isVisible(), false);
    const initialHeight = (await page.getByRole('dialog').boundingBox()).height;
    await select.click();
    assert.equal(await search.evaluate(el => el === document.activeElement), true);
    assert.equal((await page.getByRole('dialog').boundingBox()).height, initialHeight);
    assert.equal(await select.evaluate(el => getComputedStyle(el).cursor), 'pointer');
    assert.equal(await search.evaluate(el => getComputedStyle(el).cursor), 'text');
    const searchTop = (await search.boundingBox()).y;
    await page.getByRole('listbox').evaluate(el => { el.scrollTop = el.scrollHeight; });
    assert.equal((await search.boundingBox()).y, searchTop);
    await search.fill('MARIA ALV');
    assert.equal(await page.getByRole('option').count(), 1);
    await page.getByRole('option', { name: 'María Álvarez' }).click();
    assert.equal(await search.isVisible(), false);
    assert.match(await select.innerText(), /María Álvarez/);
    await select.click();
    assert.equal(await page.getByRole('option').count(), 30);
    assert.equal(await page.locator('[role="option"][aria-selected="true"]').innerText(), 'María Álvarez\n✓');
    await search.fill('does not exist');
    assert.equal(await page.getByText('No results found').isVisible(), true);
    await search.press('Enter');
    assert.equal(await search.isVisible(), true);
    await search.press('Escape');
    assert.equal(await search.isVisible(), false);
    assert.equal(await page.getByRole('dialog').count(), 1);
    await select.press('ArrowDown');
    await search.press('ArrowDown');
    await search.press('ArrowUp');
    await search.press('Enter');
    assert.equal(await submit.isEnabled(), true);
    const panel = page.getByRole('dialog');
    assert.equal(Math.round((await panel.boundingBox()).width), 500);
    await page.screenshot({ path: '_local/artifacts/screenshots/reservation-assignment-desktop.png' });
    await submit.click();
    assert.deepEqual(await page.evaluate(() => window.sentData), { Reservation_Rep: { id: '2' } });
    assert.equal(await page.getByRole('button', { name: 'Assigning…' }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Close', exact: true }).isDisabled(), true);
    await page.evaluate(() => window.failAssignment(new Error('CRM unavailable')));
    await page.getByText('CRM unavailable', { exact: true }).waitFor();
    assert.equal(await submit.isEnabled(), true);
    assert.match(await select.innerText(), /María Álvarez/);
    await page.setViewportSize({ width: 375, height: 720 });
    assert.equal(await panel.evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await select.click();
    const bounds = await page.locator('.reservation-selector-panel').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 375);
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 720);
    await page.screenshot({ path: '_local/artifacts/screenshots/reservation-assignment-narrow.png' });
    await search.press('Escape');
    await submit.click();
    await page.evaluate(() => window.finishAssignment({ partial: false }));
    await panel.waitFor({ state: 'detached' });
    await page.click('#open');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    assert.equal(await panel.count(), 0);
    console.log('Assignment popup: selection, search, loading, retry, close and responsive layout passed.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
