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

function queueContext() {
  const context = vm.createContext({});
  const utils = fs.readFileSync(path.join(__dirname, "../app/js/utils.js"), "utf8").replace(/^export /gm, "");
  const shell = fs.readFileSync(path.join(__dirname, "../app/js/booking-shell.js"), "utf8");
  const render = shell.slice(shell.indexOf("function renderQueueCell("), shell.indexOf("function renderBookingBrowserSync("));
  const firstText = shell.slice(shell.indexOf("function firstTextValue("));
  vm.runInContext(utils + "\n" + source + "\n" + render + "\n" + firstText, context);
  return context;
}

test("queue normalization preserves Desk IDs and renders cells for deferred loading", () => {
  const context = queueContext();
  for (const field of ["Desk_Ticket_ID", "Desk_Ticket_Id", "DeskTicketID", "Desk Ticket ID"]) {
    const booking = context.normalizeBookingCandidate({ id: "booking-1", [field]: "1234567890123456789" });
    assert.equal(booking.Desk_Ticket_ID, "1234567890123456789");
    const markup = context.renderQueueCell("desk", booking, {});
    assert.match(markup, /data-queue-desk-ticket="1234567890123456789"/);
    assert.match(markup, /Loading latest interaction/);
    assert.doesNotMatch(markup, /No Desk ticket/);
  }
  const empty = context.normalizeBookingCandidate({ id: "booking-2", Desk_Ticket_ID: null });
  assert.equal(context.renderQueueCell("desk", empty, {}), "No Desk ticket");
});

test("a delayed Desk response updates the replacement row after the table rerenders", async () => {
  const context = queueContext();
  const booking = context.normalizeBookingCandidate({ id: "booking-1", Desk_Ticket_ID: "ticket-1" });
  let resolveTicket, calls = 0;
  const loader = context.createDeskTicketLoader(id => {
    assert.equal(id, booking.Desk_Ticket_ID);
    calls++;
    return new Promise(resolve => { resolveTicket = resolve; });
  });
  function cell() {
    const markup = context.renderQueueCell("desk", booking, {});
    return { dataset: { queueDeskTicket: markup.match(/data-queue-desk-ticket="([^"]+)"/)[1] }, isConnected: true, textContent: "Loading latest interaction…" };
  }
  const original = cell();
  let current = original;
  const body = { querySelectorAll: () => [current] };
  const format = ticket => ticket.latest_interaction;
  context.observeQueueDeskCells(body, loader, format);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(original.textContent, "Loading latest interaction…");
  original.isConnected = false;
  current = cell();
  context.observeQueueDeskCells(body, loader, format);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  resolveTicket({ latest_interaction: "Our team · Sandra · 2 days ago" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(current.textContent, "Our team · Sandra · 2 days ago");
  assert.equal(current.title, current.textContent);
  assert.equal(original.textContent, "Loading latest interaction…");
});

test("Desk loads when its row is visible even if the column is offscreen", async () => {
  let notify;
  const observed = new Set();
  const row = {};
  const cell = {
    dataset: { queueDeskTicket: "ticket-1" }, isConnected: true,
    closest: selector => { assert.equal(selector, "tr"); return row; }
  };
  const scroll = {};
  const body = { querySelectorAll: () => [cell], closest: () => scroll };
  const context = vm.createContext({
    IntersectionObserver: class {
      constructor(callback, options) { notify = callback; assert.equal(options.root, scroll); }
      observe(target) { observed.add(target); }
      unobserve(target) { observed.delete(target); }
      disconnect() { observed.clear(); }
    }
  });
  vm.runInContext(source, context);
  const calls = [];
  context.observeQueueDeskCells(body, async id => {
    calls.push(id);
    return { latest_interaction: "Our team · Sandra · 51 days ago" };
  }, ticket => ticket.latest_interaction);
  assert.ok(observed.has(row));
  notify([{ target: row, isIntersecting: false }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 0);
  notify([{ target: row, isIntersecting: true }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ["ticket-1"]);
  assert.equal(cell.textContent, "Our team · Sandra · 51 days ago");
  assert.equal(cell.title, cell.textContent);
  assert.equal(observed.size, 0);
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
