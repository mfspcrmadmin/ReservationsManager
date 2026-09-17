const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

function setup(stored) {
  const source = fs.readFileSync(path.join(__dirname, "../app/js/booking-queue-table.js"), "utf8")
    .replace(/^import .*;\r?\n/gm, "").replace(/export /g, "");
  const context = vm.createContext({
    createColumnResizer: key => ({ key }),
    window: { localStorage: { getItem: key => stored && stored[key] || null } }
  });
  vm.runInContext(source, context);
  return context;
}

test("queue restores distinct compact and wide defaults", () => {
  const context = setup();
  const pref = context.getQueueTablePreferences({ currentUserId: "one" });
  assert.equal(context.getQueueVisibleColumns(pref, false).map(column => column.key).join(","), "booking,mfsp,arrival,stage");
  assert.equal(context.getQueueVisibleColumns(pref, true).length, 11);
});

test("stored queue columns discard unknown and duplicate keys and retain at least one visible column", () => {
  const context = setup();
  const columns = context.sanitizeQueueColumns([
    { key: "stage", visible: true }, { key: "stage", visible: false }, null, { key: "unknown", visible: true }
  ], false);
  assert.equal(columns.length, 11);
  assert.equal(columns[0].key, "stage");
  assert.equal(columns[0].visible, true);
  const hidden = context.sanitizeQueueColumns(columns.map(column => ({ key: column.key, visible: false })), false);
  assert.equal(hidden.filter(column => column.visible).length, 1);
});

test("queue preferences and width storage are isolated per user and text size is bounded", () => {
  const context = setup({
    "bookingsManager.bookingQueue.id:one": JSON.stringify({ textSize: 999 }),
    "bookingsManager.bookingQueue.id:two": JSON.stringify({ textSize: -1 })
  });
  const one = context.getQueueTablePreferences({ currentUserId: "one" });
  const two = context.getQueueTablePreferences({ currentUserId: "two" });
  assert.equal(one.textSize, 20);
  assert.equal(two.textSize, 10);
  assert.notEqual(one.resizer.key, two.resizer.key);
  one.compact.reverse();
  assert.equal(two.compact[0].key, "booking");
  assert.equal(context.getQueueTablePreferences({ currentUserId: "one" }), one);
});

test("malformed queue storage falls back to usable defaults", () => {
  const context = setup({ "bookingsManager.bookingQueue.id:one": "invalid JSON" });
  const pref = context.getQueueTablePreferences({ currentUserId: "one" });
  assert.equal(pref.textSize, 12);
  assert.equal(context.getQueueVisibleColumns(pref, false).length, 4);
  assert.equal(context.getQueueTablePreferences({}).resizer.key, "");
});
