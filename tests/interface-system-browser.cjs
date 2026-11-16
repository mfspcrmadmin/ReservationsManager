const fs = require("node:fs");
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const read = file => fs.readFileSync("app/" + file, "utf8");
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setContent(`<main class="app-shell">
      <section class="card"><h2>Booking workspace · Family journey</h2>
      <nav class="page-tabs"><button id="tab-booking" class="page-tab active">Booking</button><button id="tab-services" class="page-tab">Services</button><button id="tab-tasks" class="page-tab">Tasks</button></nav>
      <section id="manage-booking-panel"><h3>Overview</h3><p>Madrid to Barcelona · 24–30 Nov 2026</p></section>
      <section id="manage-services-panel" hidden><h3>Services</h3>
      <div class="services-filter-row"><label class="field"><span>Supplier</span><select id="service-filter-supplier"><option value="">All suppliers</option><option value="1">Ángela — a local supplier with a deliberately long name</option><option value="2">Barcelona Private Tours</option></select></label>
      <div class="field service-filter-field"><span>Status</span><div class="service-multi-filter"><button id="status-toggle" class="button tertiary service-multi-filter-toggle">All statuses</button><div id="status-menu" class="service-multi-filter-menu" hidden><label class="service-multi-filter-option"><input type="checkbox" data-service-filter-option value="Confirmed">Confirmed</label><label class="service-multi-filter-option"><input type="checkbox" data-service-filter-option value="Unassigned">Unassigned</label></div></div></div>
      <label class="service-operational-filter"><input type="checkbox" id="hide-non-operational-services" checked>Hide non-operational</label></div><button id="after-filter" class="button tertiary">Next action</button></section>
      <section id="manage-tasks-panel" hidden><h3>Tasks</h3></section></section>
      <button id="open-dialog" class="button primary">Assign reservation</button>
      <div class="booking-action-dialog" id="assignment" hidden><div class="booking-action-dialog-panel"><h4>Assign reservation</h4><p>Booking · Family journey</p><input aria-label="Representative" value="Reservations team"><button data-close class="button tertiary">Cancel</button><button id="assign-submit" class="button primary">Assign & continue</button></div></div>
      <button id="regenerate" class="button secondary">Regenerate draft</button>
    </main>`);
    for (const file of ["widget", "booking-shell", "booking-tasks", "queue-dropdowns", "interface-system"]) await page.addStyleTag({ content: read("styles/" + file + ".css") });
    await page.addScriptTag({ content: read("js/interface-system.js").replace(/^export /gm, "") + "\n" + read("js/app-feedback.js").replace(/^export /gm, "") });
    await page.evaluate(() => {
      document.querySelectorAll(".page-tab").forEach(button => button.onclick = () => {
        document.querySelectorAll(".page-tab").forEach(tab => tab.classList.toggle("active", tab === button));
        ["booking","services","tasks"].forEach(name => { document.getElementById("manage-" + name + "-panel").hidden = button.id !== "tab-" + name; });
      });
      document.querySelector("#status-toggle").onclick = () => { document.querySelector("#status-menu").hidden = !document.querySelector("#status-menu").hidden; };
      document.querySelector("#open-dialog").onclick = () => { document.querySelector("#assignment").hidden = false; };
      document.querySelector("[data-close]").onclick = () => { document.querySelector("#assignment").hidden = true; };
      document.querySelector("#regenerate").onclick = async () => { window.regenerated = await confirmRegeneration(); };
      window.changeEvents = 0;
      document.querySelector("#service-filter-supplier").onchange = () => { window.changeEvents++; };
      initInterfaceSystem();
    });
    await page.locator("#tab-booking").focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => document.querySelector("#tab-services").getAttribute("aria-selected") === "true");
    assert.equal(await page.locator("#manage-services-panel").getAttribute("aria-labelledby"), "tab-services");
    const lookup = page.locator(".lookup-trigger");
    await lookup.click();
    await page.keyboard.press("ArrowUp");
    assert.equal(await page.locator(".lookup-option").last().evaluate(node => node === document.activeElement), true);
    await page.getByRole("searchbox", { name: "Search options" }).fill("angela");
    assert.equal(await page.locator(".lookup-option").count(), 1);
    await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
    assert.equal(await page.locator("#service-filter-supplier").inputValue(), "1");
    assert.equal(await page.evaluate(() => window.changeEvents), 1);
    await lookup.click(); await page.keyboard.press("Tab");
    assert.equal(await page.locator(".lookup-menu:popover-open").count(), 0);
    assert.equal(await page.locator("#status-toggle").evaluate(node => node === document.activeElement), true);
    await page.locator("#status-toggle").click();
    assert.equal(await page.locator("#status-menu").evaluate(node => node.matches(":popover-open")), true);
    await page.keyboard.press("Space"); await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelector("#service-filter-summary").textContent.includes("Confirmed"));
    await page.evaluate(() => {
      const menu = document.querySelector("#status-menu");
      for (let i = 0; i < 8; i++) {
        const label = document.createElement("label"); label.className = "service-multi-filter-option";
        label.innerHTML = '<input type="checkbox" data-service-filter-option value="Extra ' + i + '">Extra ' + i;
        menu.append(label);
      }
    });
    await page.locator("#status-toggle").click();
    await page.getByRole("searchbox", { name: "Search filter options" }).fill("extra 7");
    assert.equal(await page.locator("#status-menu .service-multi-filter-option:visible").count(), 1);
    await page.keyboard.press("ArrowDown"); await page.keyboard.press("Space"); await page.keyboard.press("Escape");
    assert.equal(await page.locator('#status-menu input[value="Extra 7"]').isChecked(), true);
    await page.locator("#status-toggle").click();
    await page.locator("#status-menu:popover-open").waitFor();
    assert.equal(await page.locator("#status-menu .service-multi-filter-option:visible").count(), 10);
    await page.keyboard.press("Escape");
    await page.locator("#open-dialog").click();
    await page.waitForFunction(() => document.querySelector("#assignment").contains(document.activeElement));
    await page.locator("#assign-submit").focus(); await page.keyboard.press("Tab");
    assert.equal(await page.getByRole("textbox", {name:"Representative"}).evaluate(node => node === document.activeElement), true);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#assignment").isVisible(), false);
    await page.locator("#regenerate").click();
    await page.getByRole("button", {name:"Keep draft",exact:true}).click();
    await page.waitForFunction(() => window.regenerated === false);
    assert.equal(await page.evaluate(() => window.regenerated), false);
    await page.locator("#regenerate").click();
    await page.evaluate(() => showFeedback("An editor notice.", "error"));
    assert.equal(await page.locator("dialog:modal #app-feedback-dialog").count(), 1);
    await page.getByRole("button", {name:"Dismiss notification"}).click();
    await page.getByRole("button", {name:"Keep draft",exact:true}).click();
    await page.locator("#regenerate").click();
    await page.getByRole("button", {name:"Regenerate draft",exact:true}).last().click();
    await page.waitForFunction(() => window.regenerated === true);
    assert.equal(await page.evaluate(() => window.regenerated), true);
    await page.locator("#after-filter").focus();
    await page.evaluate(() => showFeedback("Changes saved."));
    assert.equal(await page.locator("#app-feedback-dialog").evaluate(node => node.matches(":modal")), false);
    assert.equal(await page.locator("#after-filter").evaluate(node => node === document.activeElement), true);
    await page.evaluate(() => showFeedback("Saving...", "loading"));
    assert.equal(await page.locator("#app-feedback-dialog").evaluate(node => node.matches(":modal")), true);
    await page.evaluate(() => { clearFeedback("loading"); showFeedback("Changes saved."); });
    await page.screenshot({ path: "_local/artifacts/interface-system-desktop.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await lookup.click();
    const box = await page.locator(".lookup-menu").boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 390);
    await page.screenshot({ path: "_local/artifacts/interface-system-narrow.png" });
    assert.deepEqual(errors, []);
    console.log("Interface: tabs, searchable lookup, filter summary, modal focus, regeneration confirmation and non-modal feedback passed.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
