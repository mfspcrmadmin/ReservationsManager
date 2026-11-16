const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");

function overview(getRecord) {
  const source = fs.readFileSync(require("node:path").join(__dirname, "../app/js/booking-overview.js"), "utf8");
  const context = vm.createContext({
    crmGetRecord: getRecord,
    getLookupName: value => value?.name || "",
    escapeHtml: value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
    console: { warn() {} }
  });
  vm.runInContext(source.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, ""), context);
  return context;
}

test("Consortia loads from the linked account, escapes values and shares requests", async () => {
  let calls = 0;
  const context = overview(async (module, id) => {
    calls++;
    assert.equal(module, "Accounts");
    assert.equal(id, "agency-1");
    return { Consortia: [{ name: "Virtuoso" }, { name: "<Travel & Co>" }] };
  });
  const booking = { Account_Name: { id: "agency-1", name: "Agency" } };
  const target = {};
  const container = { querySelector: () => target };
  assert.match(context.renderBookingOverview(booking, ""), /Consortia/);
  await Promise.all([context.loadOverviewConsortia(container, booking), context.loadOverviewConsortia(container, booking)]);
  assert.equal(calls, 1);
  assert.match(target.innerHTML, /Virtuoso/);
  assert.match(target.innerHTML, /&lt;Travel &amp; Co&gt;/);
});

test("Consortia distinguishes an empty field from a failed request and permits retry", async () => {
  let calls = 0;
  const context = overview(async () => {
    if (++calls === 1) throw new Error("Unavailable");
    return { Consortia: null };
  });
  const booking = { Account_Name: { id: "agency-1" } };
  const target = {};
  const container = { querySelector: () => target };
  await context.loadOverviewConsortia(container, booking);
  assert.match(target.innerHTML, /Could not load/);
  await context.loadOverviewConsortia(container, booking);
  assert.match(target.innerHTML, /Not provided/);
  await context.loadOverviewConsortia(container, {});
  assert.equal(calls, 2);
});

test("a completed request updates only the original booking's element", async () => {
  let resolve;
  const context = overview(() => new Promise(done => { resolve = done; }));
  const original = {};
  let current = original;
  const pending = context.loadOverviewConsortia({ querySelector: () => current }, { Account_Name: { id: "agency-1" } });
  current = { innerHTML: "New booking" };
  resolve({ Consortia: "Virtuoso" });
  await pending;
  assert.equal(current.innerHTML, "New booking");
  assert.match(original.innerHTML, /Virtuoso/);
});
