const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const html = fs.readFileSync('app/widget.html', 'utf8');
    const start = html.indexOf('<aside id="booking-browser-panel"');
    await page.setContent(html.slice(start, html.indexOf('</aside>', start) + 8));
    for (const name of ['widget', 'booking-shell', 'queue-dropdowns', 'interface-system']) {
      await page.addStyleTag({ content: fs.readFileSync('app/styles/' + name + '.css', 'utf8') });
    }
    await page.addStyleTag({ content: '#booking-browser-panel {width:420px;height:660px;margin:20px;} body{margin:0}' });
    // Use the real renderer's option/group builders and labels, with controlled data.
    await page.addScriptTag({ content: fs.readFileSync('app/js/booking-shell.js', 'utf8').replace(/^import[\s\S]*?from\s+["'][^"']+["'];/gm, '').replace(/^export /gm, '') });
    await page.evaluate(() => {
      window.escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      window.searchSelect = document.querySelector('#booking-browser-search-by');
      window.ownerSelect = document.querySelector('#booking-browser-owner');
      window.stageMenu = document.querySelector('#booking-browser-stages-menu');
      window.stageTrigger = document.querySelector('#booking-browser-stages-toggle');
      window.searches = 0; window.changes = 0; window.stagesOpen = false;
      window.stageValues = Array.from({length: 25}, (_, i) => 'Stage ' + i);
      document.querySelector('#queue-filter-summary').textContent = 'Showing: Ángela · ' + getBookingBrowserStagesLabel(stageValues, stageValues);
      window.selectedStages = new Set(['Stage 0', 'Stage 1']);
      searchSelect.innerHTML = buildBookingBrowserSearchByOptions('booking_owner');
      ownerSelect.innerHTML = buildBookingBrowserOwnerOptionMarkup([
        { value: '900000000000000001', label: 'Ángela Fernández', role: 'Reservations' },
        { value: '900000000000000002', label: 'A very long owner name with several family names', role: 'Sales' },
        ...Array.from({length: 90}, (_, i) => ({value:'user'+i,label:'User '+i,role:i % 2 ? 'Sales' : 'Reservations'}))
      ], '900000000000000001');
      window.renderStages = () => {
        stageMenu.innerHTML = '<label class="booking-stage-option booking-stage-option--toggle-all"><input type="checkbox" data-stage-filter-toggle-all><span>Select / deselect all</span></label>' +
          stageValues.map(value => '<label class="booking-stage-option"><input type="checkbox" data-stage-filter value="'+value+'"'+(selectedStages.has(value)?' checked':'')+'><span>'+value+'</span></label>').join('');
        stageMenu.hidden = !stagesOpen;
        stageTrigger.textContent = getBookingBrowserStagesLabel(stageValues, [...selectedStages]);
      };
      stageTrigger.onclick = () => { stagesOpen = !stagesOpen; renderStages(); };
      stageMenu.onchange = event => {
        const input = event.target;
        if (input.hasAttribute('data-stage-filter-toggle-all')) selectedStages = new Set(input.checked ? stageValues : []);
        else if (input.checked) selectedStages.add(input.value);
        else selectedStages.delete(input.value);
        renderStages();
      };
      searchSelect.onchange = ownerSelect.onchange = () => { changes++; };
      document.querySelector('#booking-browser-load').onclick = () => { searches++; };
      renderStages();
    });
    await page.addScriptTag({ content: fs.readFileSync('app/js/queue-dropdowns.js','utf8').replace(/^export /gm, '') + '\ninitQueueDropdowns();' });
    // Exercise the actual grid, with a populated summary, before opening menus.
    for (const width of [320, 420]) {
      await page.locator('#booking-browser-panel').evaluate((panel, width) => { panel.style.width = width + 'px'; }, width);
      const geometry = await page.evaluate(() => {
        const rect = selector => document.querySelector(selector).getBoundingClientRect();
        return {
          filtersBottom: rect('.booking-browser-filters').bottom,
          resultsTop: rect('.booking-browser-table-wrap').top,
          buttonRight: rect('#booking-browser-load').right,
          rowRight: rect('.booking-stage-filter-row').right
        };
      });
      assert.ok(Math.abs(geometry.resultsTop - geometry.filtersBottom) < 16, 'results directly follow filters');
      assert.ok(geometry.buttonRight <= geometry.rowRight + 1, 'icon button fits its grid cell');
      assert.equal(await page.locator('#booking-browser-load').innerText(), '');
      assert.equal(await page.locator('#queue-filter-summary').innerText(), 'Showing: Ángela · All stages');
      await page.locator('#booking-browser-panel').evaluate(panel => panel.classList.add('is-collapsed'));
      await page.locator('#queue-filter-summary').waitFor({state:'hidden'});
      await page.locator('#booking-browser-panel').evaluate(panel => panel.classList.remove('is-collapsed'));
      await page.locator('#queue-filter-summary').waitFor({state:'visible'});
    }
    const owner = page.locator('#booking-browser-owner-trigger');
    const searchBy = page.locator('#booking-browser-search-by-trigger');
    const stages = page.locator('#booking-browser-stages-toggle');
    const input = page.getByRole('combobox', { name: 'Search users' });
    const boundsCheck = async () => {
      const menus = page.locator('.queue-dropdown-menu:popover-open');
      assert.equal(await menus.count(), 1);
      const box = await menus.boundingBox(), viewport = page.viewportSize();
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height);
      assert.ok(await menus.evaluate(menu => { const r=menu.getBoundingClientRect(); return menu.contains(document.elementFromPoint(r.x+10,r.y+10)); }));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    };
    for (const wide of [false, true]) {
      if (wide) {
        await page.addScriptTag({ content: fs.readFileSync('app/js/booking-queue-overlay.js','utf8').replace(/^export /gm, '') });
        await page.evaluate(() => { const panel=document.querySelector('#booking-browser-panel'); panel.classList.add('is-wide'); panel.style.width='900px'; updateBookingQueueOverlay(panel,true); });
      }
      await owner.click();
      assert.equal(await input.evaluate(node => node === document.activeElement), true);
      await boundsCheck();
      await page.locator('#booking-browser-owner-menu').evaluate(async node => { await Promise.all(node.getAnimations().map(animation => animation.finished)); });
      await page.screenshot({path:'_local/artifacts/queue-dropdowns-owner-' + (wide?'wide':'normal') + '.png'});
      await page.locator('#booking-browser-owner-menu').evaluate(node => { node.scrollTop=1000; });
      assert.ok(await input.isVisible());
      assert.ok(await input.evaluate(node => { const rect=node.getBoundingClientRect(); return node===document.elementFromPoint(rect.x+5,rect.y+5); }));
      await input.fill('ANGELA');
      assert.equal(await page.locator('#booking-browser-owner-list [role=option]').count(), 1);
      assert.equal(await page.locator('#booking-browser-owner-list [role=group]').count(), 1);
      await input.fill('no such user');
      assert.equal(await page.getByText('No users found', {exact:true}).isVisible(), true);
      await page.getByRole('button',{name:'Clear user search'}).click();
      assert.equal(await page.locator('#booking-browser-owner-list [role=option]').count(), 92);
      await input.fill('ANGELA');
      await input.press('ArrowDown'); await input.press('Enter');
      assert.equal(await page.locator('#booking-browser-owner').inputValue(), '900000000000000001');
      assert.equal(await owner.evaluate(node => node === document.activeElement), true);
      await owner.click();
      assert.equal(await input.inputValue(), '');
      await input.fill('several family');
      await page.locator('#booking-browser-owner-list [role=option]').click();
      assert.equal(await page.locator('#booking-browser-owner').inputValue(), '900000000000000002');
      await searchBy.click(); await boundsCheck();
      await page.locator('#booking-browser-search-by-menu').press('End');
      await page.locator('#booking-browser-search-by-menu').press('Enter');
      assert.equal(await page.locator('#booking-browser-search-by').inputValue(), 'hour_rep');
      await stages.click(); await boundsCheck();
      const rowHeight = await page.locator('[data-stage-filter]').first().evaluate(node => node.parentElement.getBoundingClientRect().height);
      assert.ok(rowHeight >= 34 && rowHeight <= 38, 'Stage rows remain compact: ' + rowHeight);
      await page.locator('#booking-browser-stages-menu').evaluate(async node => { await Promise.all(node.getAnimations().map(animation => animation.finished)); });
      await page.screenshot({path:'_local/artifacts/queue-dropdowns-stages-' + (wide?'wide':'normal') + '.png'});
      const all = page.locator('[data-stage-filter-toggle-all]');
      assert.equal(await all.evaluate(node => node.indeterminate), true);
      await all.press('Space');
      assert.equal(await stages.textContent(), 'All stages');
      assert.equal(await all.evaluate(node => node === document.activeElement), true);
      await all.press('Space');
      assert.equal(await stages.textContent(), 'No stages selected');
      await all.press('ArrowDown'); await page.keyboard.press('Space');
      assert.equal(await stages.textContent(), 'Stage 0');
      await page.keyboard.press('ArrowDown'); await page.keyboard.press('Space');
      assert.equal(await stages.textContent(), '2 stages selected');
      await page.keyboard.press('Escape');
      assert.equal(await stages.evaluate(node => node === document.activeElement), true);
      if (wide) assert.equal(await page.locator('.booking-queue-overlay[open]').count(),1);
      await owner.click(); await searchBy.click();
      assert.equal(await page.locator('.queue-dropdown-menu:popover-open').count(), 1);
      await page.locator('.booking-browser-header h2').click();
      assert.equal(await page.locator('.queue-dropdown-menu:popover-open').count(), 0);
      assert.equal(await page.evaluate(() => searches), 0);
      await page.locator('#booking-browser-load').click();
      assert.equal(await page.evaluate(() => searches), 1);
      await page.evaluate(() => { searches = 0; });
      await page.screenshot({path: '_local/artifacts/queue-dropdowns-' + (wide?'wide':'normal') + '.png'});
    }
    await page.setViewportSize({width:360,height:500});
    await page.evaluate(() => { document.querySelector('#booking-browser-panel').style.width='100%'; document.querySelector('#booking-browser-panel').style.margin='0'; });
    await owner.click(); await boundsCheck();
    await page.locator('#booking-browser-owner-menu').evaluate(async node => { await Promise.all(node.getAnimations().map(animation => animation.finished)); });
    await page.screenshot({path:'_local/artifacts/queue-dropdowns-narrow.png'});
    await page.emulateMedia({ reducedMotion:'reduce' });
    assert.equal(await page.locator('#booking-browser-owner-menu').evaluate(node => getComputedStyle(node).animationName), 'none');
    assert.deepEqual(errors, []);
    console.log('Queue dropdowns: normal, modal, narrow, search, groups, long names, keyboard, stages and search-button isolation passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
