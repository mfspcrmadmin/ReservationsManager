const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

function harness() {
  const context = vm.createContext({});
  const source = fs.readFileSync(path.join(__dirname, "../app/js/booking-tags.js"), "utf8");
  vm.runInContext(source.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, ""), context);
  return context;
}

test("queue tags disappear and reappear as available width changes, with an accurate overflow count", () => {
  const context = harness();
  const chips = [70, 70, 70].map(width => ({ hidden: false, getBoundingClientRect: () => ({ width }) }));
  const more = { hidden: true, textContent: "", setAttribute(name, value) { this[name] = value; }, getBoundingClientRect: () => ({ width: 30 }) };
  const add = { getBoundingClientRect: () => ({ width: 50 }) };
  const slot = { isConnected: true, clientWidth: 200, querySelectorAll: () => chips, querySelector: selector => selector === ".booking-tags-add" ? add : more };
  context.fitBookingTags(slot);
  assert.deepEqual(chips.map(chip => chip.hidden), [false, true, true]);
  assert.equal(more.textContent, "+2");
  assert.equal(more["aria-label"], "Show all 3 tags");
  slot.clientWidth = 272;
  context.fitBookingTags(slot);
  assert.deepEqual(chips.map(chip => chip.hidden), [false, false, false]);
  assert.equal(more.hidden, true);
  slot.clientWidth = 240;
  context.fitBookingTags(slot);
  assert.deepEqual(chips.map(chip => chip.hidden), [false, false, true]);
  assert.equal(more.textContent, "+1");
  slot.clientWidth = 90;
  context.fitBookingTags(slot);
  assert.deepEqual(chips.map(chip => chip.hidden), [true, true, true]);
  assert.equal(more.textContent, "+3");
});

test("overflow opens every tag, including hidden chips, in a modal preview", () => {
  const context = harness();
  let opened = false;
  const closeButton = {};
  const events = {};
  const dialog = {
    setAttribute() {}, querySelector: () => closeButton,
    addEventListener(name, handler) { events[name] = handler; },
    showModal() { opened = true; }, close() { events.close(); }, remove() {}
  };
  context.document = { createElement: () => dialog, body: { appendChild() {} } };
  context.state = { selectedBooking: { id: "b1", Deal_Name: "Booking" } };
  context.escapeHtml = String;
  const slot = {
    dataset: { bookingTagsSlot: "b1" },
    querySelectorAll: () => ["Visible", "Hidden one", "Hidden two"].map(name => ({
      cloneNode: () => ({ hidden: true, get outerHTML() { return '<span' + (this.hidden ? ' hidden' : '') + '>' + name + '</span>'; } })
    }))
  };
  context.showAllBookingTags(slot);
  assert.equal(opened, true);
  for (const name of ["Visible", "Hidden one", "Hidden two"]) assert.ok(dialog.innerHTML.includes(name));
  assert.doesNotMatch(dialog.innerHTML, /<span hidden/);
  closeButton.onclick();
  assert.equal(vm.runInContext("activeDialog", context), null);
});
