const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require("node:path").join(__dirname, "../app/js/utils.js"), "utf8");
const context = vm.createContext({ Intl, Date });
vm.runInContext(source.replace(/export /g, ""), context);

test("calendar dates preserve the source day, including timestamp offsets", () => {
  assert.equal(context.formatDate("2026-10-20"), "20 Oct 2026");
  assert.equal(context.formatDate("2026-10-20T00:00:00+14:00"), "20 Oct 2026");
  assert.equal(context.formatDate("2024-02-29"), "29 Feb 2024");
  assert.equal(context.formatDate("2026-02-30"), "2026-02-30");
  assert.equal(context.formatDate("Unknown"), "Unknown");
  assert.equal(context.formatDate(null), "-");
});

test("timestamps use a consistent date and 24-hour local time", () => {
  assert.equal(context.formatDateTime("2026-10-20T13:05:00"), "20 Oct 2026 · 13:05");
  assert.equal(context.formatDateTime("Unknown"), "Unknown");
  assert.equal(context.formatDateTime(null), "-");
});

test("money preserves zero, decimals and currency", () => {
  assert.match(context.formatCurrency(0), /0,00/);
  assert.match(context.formatCurrency(1234.56), /1234,56/);
  assert.match(context.formatCurrency(1234.56), /€/);
  assert.equal(context.formatCurrency(null), "-");
});
