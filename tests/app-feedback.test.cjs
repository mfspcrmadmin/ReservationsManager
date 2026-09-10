const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

function setup() {
  let dialog;
  let created = 0;
  const context = vm.createContext({
    document: {
      getElementById: () => dialog,
      body: { appendChild: node => { dialog = node; } },
      createElement: () => {
        created++;
        const children = {};
        return {
          dataset: {}, handlers: {}, open: false,
          setAttribute() {}, focus() {},
          querySelector(selector) { return children[selector] ||= { focus() {}, hidden: false }; },
          addEventListener(event, handler) { this.handlers[event] = handler; },
          showModal() { this.open = true; }, close() { this.open = false; }
        };
      }
    },
    setButtonsDisabled() {}
  });
  const feedback = fs.readFileSync(path.join(__dirname, "../app/js/app-feedback.js"), "utf8").replace(/export /g, "");
  const render = fs.readFileSync(path.join(__dirname, "../app/js/render.js"), "utf8");
  const handlers = ["setNotice", "setError", "clearLoading"].map(name => {
    const start = render.indexOf("export function " + name + "(");
    const rest = render.slice(start);
    return rest.slice(0, rest.search(/\r?\n}/) + (rest.includes("\r\n") ? 3 : 2)).replace("export ", "");
  }).join("\n");
  vm.runInContext(feedback + "\n" + handlers, context);
  return { context, dialog: () => dialog, created: () => created };
}

test("loading becomes a closable error and cleanup does not dismiss it", () => {
  const { context, dialog, created } = setup();
  context.setNotice({}, "Saving...", { loading: true });
  assert.equal(dialog().querySelector("[data-feedback-spinner]").hidden, false);
  assert.equal(dialog().querySelector("[data-feedback-close]").hidden, true);
  let prevented = false;
  dialog().handlers.cancel({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  context.setError({}, "CRM rejected the update");
  context.clearLoading({}, {});
  assert.equal(created(), 1);
  assert.equal(dialog().open, true);
  assert.equal(dialog().dataset.kind, "error");
  assert.equal(dialog().querySelector("p").textContent, "CRM rejected the update");
  assert.equal(dialog().querySelector("[data-feedback-close]").hidden, false);
  dialog().querySelector("[data-feedback-close]").onclick();
  assert.equal(dialog().open, false);
});

test("function JSON shows its message and never its serialized envelope", () => {
  const { context, dialog } = setup();
  const output = { error: false, message: "Synchronization done successfully!" };
  for (const input of [output, JSON.stringify(output), JSON.stringify(JSON.stringify(output)), { details: { output: JSON.stringify(output) } }]) {
    context.setNotice({}, input);
    assert.equal(dialog().querySelector("p").textContent, output.message);
  }
  for (const input of ['{"broken":', { code: "INVALID_DATA" }, ["technical", "payload"]]) {
    context.setError({}, input);
    assert.equal(dialog().querySelector("p").textContent, "The action couldn't be completed. Please try again or contact your administrator.");
  }
});

test("loading ends without a notice while important results remain until closed", () => {
  const { context, dialog } = setup();
  context.setNotice({}, "Loading...", { loading: true });
  context.clearLoading({}, {});
  assert.equal(dialog().open, false);
  context.setNotice({}, "Sync launched");
  context.clearLoading({}, {});
  assert.equal(dialog().open, true);
  context.setNotice({}, "Routine message", { silent: true });
  assert.equal(dialog().open, false);
});
