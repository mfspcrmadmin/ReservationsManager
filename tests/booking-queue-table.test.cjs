const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

function setup(stored = {}) {
  const source = fs.readFileSync(path.join(__dirname, "../app/js/booking-queue-table.js"), "utf8")
    .replace(/^import .*;\r?\n/gm, "").replace(/export /g, "");
  const context = vm.createContext({
    createColumnResizer: key => ({ key }),
    window: { localStorage: { getItem: key => stored[key] || null, setItem: (key, value) => { stored[key] = value; } } }
  });
  require("./helpers/widget-permissions.cjs").load(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/js/booking-tags-data.js"), "utf8").replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "") + "\n" + source, context);
  return context;
}

test("queue restores distinct compact and wide defaults", () => {
  const context = setup();
  const pref = context.getQueueTablePreferences({ currentUserId: "one" });
  assert.equal(context.getQueueVisibleColumns(pref, false).map(column => column.key).join(","), "booking,tasks,mfsp,arrival,stage");
  assert.equal(context.getQueueVisibleColumns(pref, true).length, 12);
});

test("stored queue columns discard unknown and duplicate keys and retain at least one visible column", () => {
  const context = setup();
  const columns = context.sanitizeQueueColumns([
    { key: "stage", visible: true }, { key: "stage", visible: false }, null, { key: "unknown", visible: true }
  ], false);
  assert.equal(columns.length, 14);
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
  assert.equal(context.getQueueVisibleColumns(pref, false).length, 5);
  assert.equal(context.getQueueTablePreferences({}).resizer.key, "");
});

for (const [profile, editable, hidden] of [
  ["Sales Standard", "salesTags", "reservationsTags"],
  ["Reservations Standard", "reservationsTags", "salesTags"],
  ["Sales-Res Standard", "reservationsTags", "salesTags"]
]) test(profile + " sees its editable tags and tasks in both queue layouts, including old preferences", () => {
  const context = setup();
  for (const wide of [false, true]) {
    for (const stored of [null, [{ key: "booking", visible: true }, { key: "stage", visible: true }]]) {
      const columns = context.sanitizeQueueColumns(stored, wide, profile);
      assert.equal(columns.findIndex(column => column.key === "tasks") + 1, columns.findIndex(column => column.key === "salesTags"));
      assert.equal(columns.filter(column => column.visible && column.key !== "tasks")[1].key, editable);
      assert.equal(columns.find(column => column.key === hidden).visible, false);
      const custom = columns.map(column => ({ ...column, visible: true }));
      assert.equal(context.sanitizeQueueColumns(custom, wide, profile).find(column => column.key === hidden).visible, true);
    }
  }
});

test("Administrator sees both tag columns by default in both layouts", () => {
  const context = setup();
  const pref = context.getQueueTablePreferences({ currentUserId: "admin", currentUserRelationshipProfile: "Administrator" });
  for (const wide of [false, true]) {
    assert.equal(context.getQueueVisibleColumns(pref, wide).slice(0, 4).map(column => column.key).join(","), "booking,tasks,salesTags,reservationsTags");
  }
});

test("late profile hydration recalculates queue defaults", () => {
  const context = setup();
  const pending = context.getQueueTablePreferences({ currentUserId: "one" });
  const loaded = context.getQueueTablePreferences({ currentUserId: "one", currentUserRelationshipProfile: "Sales Standard" });
  assert.notEqual(pending, loaded);
  assert.equal(context.getQueueVisibleColumns(loaded, false)[2].key, "salesTags");
});

for (const wide of [false, true]) test("column edits survive layout changes and reloads from " + (wide ? "expanded" : "compact") + " queue", () => {
  const stored = {};
  const context = setup(stored);
  const state = { currentUserId: "one", currentUserRelationshipProfile: "Sales Standard" };
  const pref = context.getQueueTablePreferences(state);
  const list = {};
  const buttons = {};
  const dialog = {
    setAttribute() {}, addEventListener() {}, showModal() {},
    querySelector: selector => selector === ".columns-list" ? list : (buttons[selector] ||= {})
  };
  context.document = { getElementById: () => null, createElement: () => dialog, body: { appendChild() {} } };
  let renders = 0;
  context.openColumns(pref, wide, () => renders++, {});
  list.onchange({ target: { dataset: { visible: "arrival" }, checked: false } });
  list.onchange({ target: { dataset: { visible: "salesTags" }, checked: false } });
  for (const layout of [false, true]) {
    assert.equal(context.getQueueVisibleColumns(pref, layout).some(column => ["arrival", "salesTags"].includes(column.key)), false);
  }
  assert.equal(renders, 2);
  const reloaded = setup(stored);
  const savedPref = reloaded.getQueueTablePreferences(state);
  for (const layout of [false, true]) {
    assert.equal(reloaded.getQueueVisibleColumns(savedPref, layout).some(column => ["arrival", "salesTags"].includes(column.key)), false);
  }
  list.onchange({ target: { dataset: { visible: "arrival" }, checked: true } });
  assert.equal(context.getQueueVisibleColumns(pref, !wide).some(column => column.key === "arrival"), true);
});
