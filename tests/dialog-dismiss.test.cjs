const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");
const source = fs.readFileSync(require("node:path").join(__dirname, "../app/js/main.js"), "utf8");
const start = source.indexOf("function closeDialogFromDismissButton(");
const context = vm.createContext({});
vm.runInContext(source.slice(start, source.indexOf("\n}", start) + 2), context);

test("the injected X on native dialogs invokes the existing Close action", () => {
  let closed = 0;
  let busy = false;
  const dialog = { querySelector: () => ({ click() { if (!busy) closed++; } }) };
  const button = { closest: selector => selector === ".booking-action-dialog, dialog" ? dialog : null };
  context.closeDialogFromDismissButton(button);
  assert.equal(closed, 1);
  busy = true;
  context.closeDialogFromDismissButton(button);
  assert.equal(closed, 1);
});

test("native dialogs without an existing Close action use dialog.close", () => {
  let closed = false;
  const dialog = { tagName: "DIALOG", querySelector: () => null, close() { closed = true; } };
  context.closeDialogFromDismissButton({ closest: selector => selector === ".booking-action-dialog, dialog" ? dialog : null });
  assert.equal(closed, true);
});
