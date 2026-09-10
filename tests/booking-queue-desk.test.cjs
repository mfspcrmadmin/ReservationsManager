const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const source = fs.readFileSync(path.join(__dirname, "../app/js/booking-queue-desk.js"), "utf8").replace(/export /g, "");

test("Desk loader shares requests, caches results and limits concurrent calls", async () => {
  const context = vm.createContext({});
  vm.runInContext(source, context);
  let active = 0, maxActive = 0, calls = 0;
  const loader = context.createDeskTicketLoader(async id => {
    active++; calls++; maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    return { id };
  });
  const first = loader("1");
  assert.equal(first, loader("1"));
  const records = await Promise.all([first, ...Array.from({ length: 7 }, (_, i) => loader(String(i + 2)))]);
  assert.equal(records.length, 8);
  assert.equal(maxActive, 3);
  await loader("1");
  assert.equal(calls, 8);
});

test("Desk loader allows a failed ticket to be retried", async () => {
  const context = vm.createContext({});
  vm.runInContext(source, context);
  let attempts = 0;
  const loader = context.createDeskTicketLoader(async id => {
    if (++attempts === 1) throw new Error("Unavailable");
    return { id };
  });
  await assert.rejects(loader("1"), /Unavailable/);
  assert.equal((await loader("1")).id, "1");
});

test("Desk column uses the same last interaction formatter as Booking Status", () => {
  const shell = fs.readFileSync(path.join(__dirname, "../app/js/booking-shell.js"), "utf8");
  const format = shell.slice(shell.indexOf("export function formatDeskLatestInteraction"), shell.indexOf("function renderBookingBlueprintPanel")).replace("export ", "");
  const elapsed = shell.slice(shell.indexOf("function formatElapsedTime"), shell.indexOf("function getTripDurationLabel"));
  const context = vm.createContext({ Date });
  vm.runInContext(elapsed + format, context);
  assert.equal(context.formatDeskLatestInteraction({ latest_interaction: { party: "agent", author_name: "Sandra", created_time: new Date(Date.now() - 51 * 86400000).toISOString() } }), "Our team · Sandra · 51 days ago");
  assert.equal(context.formatDeskLatestInteraction(null), "No interaction available");
});
