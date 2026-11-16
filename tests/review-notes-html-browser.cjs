// Run with PLAYWRIGHT_MODULE pointing to an installed playwright package.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent('<!doctype html><body></body>');
    await page.addScriptTag({ content: `function escapeHtml(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }` });
    for (const file of ['communication-note-editor.js', 'booking-communication.js']) {
      const source = fs.readFileSync(path.join(__dirname, '../app/js', file), 'utf8');
      await page.addScriptTag({ content: source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '') });
    }
    const result = await page.evaluate(() => {
      const body = '<br><span><br></span><span><br></span>-----------------<br><span><br></span><span style="color:rgb(35, 55, 49);background-color:rgb(240, 245, 242);">DÍA 06: hotel &amp; bedding<br><br>DÍA 08: hotel<br><br>DÍA 11: pick up 07.45am</span>';
      const note = { id: 'imported-review-note', body, formatting: [], author: 'Imported text', at: '' };
      const raw = JSON.stringify({ version: 1, notes: [note] });
      const display = importedNoteForDisplay(note);
      const editor = noteEditor('Edit note', display);
      const edited = { ...note, ...editor.read() };
      const saved = JSON.parse(changeCommunicationNote(raw, edited, note, false, 'Review_Notes'));
      const unsafe = { ...note, body: '<div>Safe &lt;script&gt; &quot;text&quot; &#233; &#x1F600;</div><script>window.injected = true</script><img src=x onerror="window.injected=true"><p>Second&nbsp;line</p>' };
      const host = document.createElement('div');
      host.innerHTML = renderCommunicationNote(unsafe);
      document.body.append(host);
      const regular = { ...note, id: 'regular', body: 'Literal <span>example</span>' };
      return {
        display: display.body, rendered: renderCommunicationNote(note), editor: editor.read().body,
        storedBefore: JSON.parse(raw).notes[0].body, storedAfter: saved.notes[0].body,
        escapedTags: importedNoteForDisplay({ ...note, body: body.replace(/</g, '\\<') }).body,
        safe: host.textContent, activeElements: host.querySelectorAll('script,img,iframe').length,
        injected: Boolean(window.injected), regular: renderCommunicationNote(regular),
        plain: importedNoteForDisplay({ ...note, body: 'Plain <team>\nA < B' }).body,
        blocks: importedNoteForDisplay({ ...note, body: '<p>First</p><div>Second</div><ul><li>One</li><li>Two</li></ul>' }).body
      };
    });
    const expected = 'DÍA 06: hotel & bedding\n\nDÍA 08: hotel\n\nDÍA 11: pick up 07.45am';
    assert.equal(result.display, expected);
    assert.equal(result.editor, expected);
    assert.equal(result.escapedTags, expected);
    assert.equal(result.rendered, expected.replace('&', '&amp;'));
    assert.match(result.storedBefore, /<span/);
    assert.equal(result.storedAfter, expected);
    assert.equal(result.safe, 'Safe <script> "text" é 😀\nSecond line');
    assert.equal(result.activeElements, 0);
    assert.equal(result.injected, false);
    assert.equal(result.regular, 'Literal &lt;span&gt;example&lt;/span&gt;');
    assert.equal(result.plain, 'Plain <team>\nA < B');
    assert.equal(result.blocks, 'First\nSecond\nOne\nTwo');
    await page.addStyleTag({ content: fs.readFileSync(path.join(__dirname, '../app/styles/booking-shell.css'), 'utf8') });
    await page.evaluate(async () => {
      window.MODULES = { bookings: 'Deals' };
      window.crmGetRecord = async () => ({ Review_Notes: null });
      await openBookingCommunicationEditor({ selectedBooking: { id: '1' } }, 'Review_Notes', () => {});
    });
    const editor = page.locator('.note-rich-input');
    await editor.fill('Colorful note');
    const compact = await page.locator('dialog').boundingBox();
    await page.getByRole('button', { name: 'Expand Review Notes' }).click();
    const expanded = await page.locator('dialog').boundingBox();
    assert.ok(expanded.width > compact.width * 2);
    assert.equal(await editor.evaluate(node => getComputedStyle(node).fontSize), '16px');
    await page.evaluate(() => {
      const input = document.querySelector('.note-rich-input');
      input.focus();
      const range = document.createRange(); range.selectNodeContents(input);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      input.dispatchEvent(new MouseEvent('mouseup'));
    });
    await page.getByLabel('Text color', { exact: true }).fill('#cc1122');
    await page.getByLabel('Highlight', { exact: true }).fill('#fff59d');
    const colored = await editor.evaluate(input => {
      const reader = noteEditor('Round trip'); reader.input.innerHTML = input.innerHTML;
      const value = reader.read();
      const reopened = noteEditor('Reopened', value).read();
      const note = { id: 'color', ...value, author: 'Tester', at: '' };
      return { value, reopened, html: renderCommunicationNote(note), valid: parseCommunicationNotes({ version: 1, notes: [note] }).notes.length };
    });
    assert.equal(colored.value.body, 'Colorful note');
    assert.equal(colored.value.formatting[0].color, '#cc1122');
    assert.equal(colored.value.formatting[0].backgroundColor, '#fff59d');
    assert.deepEqual(colored.reopened, colored.value);
    assert.match(colored.html, /background-color:#fff59d/);
    assert.equal(colored.valid, 1);
    await page.getByRole('button', { name: 'Clear highlight' }).click();
    assert.equal(await editor.evaluate(input => { const reader = noteEditor('Read'); reader.input.innerHTML = input.innerHTML; return reader.read().formatting.some(span => span.backgroundColor); }), false);
    await page.getByRole('button', { name: 'Reduce Review Notes' }).click();
    assert.equal(await editor.innerText(), 'Colorful note');
    assert.equal((await page.locator('dialog').boundingBox()).width, compact.width);
    await page.setViewportSize({ width: 390, height: 700 });
    await page.getByRole('button', { name: 'Expand Review Notes' }).click();
    assert.ok((await page.locator('dialog').boundingBox()).width <= 390);
    assert.equal(await editor.evaluate(node => getComputedStyle(node).fontSize), '14px');
    const resizeButton = page.getByRole('button', { name: 'Reduce Review Notes' });
    const closeButton = page.getByRole('button', { name: 'Close', exact: true });
    assert.equal(await resizeButton.innerText(), '');
    assert.equal(await resizeButton.locator('svg').count(), 1);
    assert.equal((await resizeButton.boundingBox()).width, (await closeButton.boundingBox()).width);
    assert.equal((await resizeButton.boundingBox()).height, (await closeButton.boundingBox()).height);
    const smallEditorHeight = (await editor.boundingBox()).height;
    await page.getByRole('button', { name: 'Expand editor', exact: true }).click();
    assert.ok((await editor.boundingBox()).height > smallEditorHeight * 2);
    assert.equal(await editor.innerText(), 'Colorful note');
    assert.equal(await editor.evaluate(node => getComputedStyle(node).resize), 'vertical');
    const addNote = await page.getByRole('button', { name: 'Add note', exact: true }).boundingBox();
    assert.ok(addNote.y + addNote.height <= 700, 'Saving stays within the viewport');
    await page.getByRole('button', { name: 'Reduce editor', exact: true }).click();
    assert.equal((await editor.boundingBox()).height, smallEditorHeight);
    console.log('Imported HTML: display, editor, save, line breaks, entities and inert rendering passed.');
    console.log('Expansion, draft preservation, color selection, highlight removal and formatting round trip passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
