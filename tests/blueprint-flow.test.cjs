const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const read = file => fs.readFileSync(path.join(__dirname, "../app/js", file), "utf8");
const source = read("booking-controller.js");
function extract(text, name) {
  const start = text.search(new RegExp("^(?:export )?(?:async )?function " + name + "\\(", "m"));
  assert.ok(start >= 0, name);
  const tail = text.slice(start).replace(/^export /, "");
  return tail.slice(0, tail.search(/\r?\n}/) + (tail.includes("\r\n") ? 3 : 2));
}
const transition = { id: "616617000135728065", name: "FID Sent", fields: [] };
const processInfo = { field_value: "All Services Confirmed" };
const sdkResponse = output => ({ code: "success", details: { type: "string", output: JSON.stringify(output) }, message: "function executed successfully" });
const ok = { success: true, result: { code: "SUCCESS", status: "success", message: "transition updated successfully", details: {} } };
function setup(respond = () => sdkResponse(ok)) {
  const calls = [], refreshes = [], logs = [], notices = [], errors = [], dialogs = [];
  const state = { selectedBookingId: "616617000166482045", bookingBlueprint: { processInfo, transitions: [transition] } };
  const context = vm.createContext({ state, elements: {}, MODULES: { bookings: "Deals" },
    ZOHO: { CRM: { FUNCTIONS: { execute: async (name, args) => { calls.push([name, JSON.parse(args.arguments)]); return respond(name); } } } },
    validateCreateInEzusAgency: async () => {},
    loadBookingWorkspace: async id => refreshes.push(id),
    setNotice: (_, message) => notices.push(message), setError: (_, message) => errors.push(message),
    console: { error: (...args) => logs.push(args) },
    openBlueprintTransitionDialog: (...args) => dialogs.push(args)
  });
  const names = ["loadBookingBlueprintForBooking", "normalizeBookingBlueprintPayload", "findSelectedBookingBlueprintTransition",
    "onWorkspaceActionClick", "collectBlueprintTransitionData", "executeBlueprintTransition", "setBlueprintTransitionButtonsBusy", "getBlueprintTransitionFields",
    "getBlueprintFailureDetails", "buildBlueprintTransitionError", "extractFunctionPayload", "normalizeFunctionPayloadCandidate",
    "parseJsonCandidate", "getFunctionPayloadErrorDetails"];
  vm.runInContext(read("utils.js").replace(/export /g, "") + "\n" + extract(read("api.js"), "crmExecuteFunction") + "\n" + names.map(name => extract(source, name)).join("\n"), context);
  const run = () => context.executeBlueprintTransition(transition, {});
  async function click() {
    const button = { disabled: false, getAttribute: () => transition.id };
    await context.onWorkspaceActionClick({ stopPropagation() {}, target: { closest: selector => selector === "[data-blueprint-transition-id]" ? button : null } });
    return button;
  }
  return { context, state, calls, refreshes, logs, notices, errors, dialogs, run, click };
}

test("real SDK envelope preserves the execution contract and all digits in IDs", async () => {
  const f = setup();
  await f.run();
  assert.deepEqual(f.calls, [["blueprint_executetransition", {
    moduleApiName: "Deals", recordId: "616617000166482045", expectedCurrentState: "All Services Confirmed",
    transitionId: "616617000135728065", transitionDataJson: "{}"
  }]]);
  assert.deepEqual(f.refreshes, ["616617000166482045"]);
  assert.equal(f.logs.length, 0);
});

for (const payload of [
  { success: true, process_info: processInfo, transitions: [transition] },
  { error: false, blueprint: { process_info: processInfo, transitions: [transition] } }
]) test("loads both local Deluge response formats through the real SDK envelope", async () => {
  const f = setup(() => sdkResponse(payload));
  const blueprint = await f.context.loadBookingBlueprintForBooking(f.state.selectedBookingId);
  assert.equal(blueprint.transitions[0].id, transition.id);
  assert.equal(blueprint.processInfo.field_value, processInfo.field_value);
});

test("malformed loading and function-level failure are not rendered as no transitions", async () => {
  for (const response of [sdkResponse(null), sdkResponse({}), { code: "INVALID_DATA", message: "invalid data", details: {} }, sdkResponse({ error: true, message: "Cannot read blueprint", transitions: [] })]) {
    const f = setup(() => response);
    await assert.rejects(f.context.loadBookingBlueprintForBooking(f.state.selectedBookingId));
    assert.equal(f.logs.length, 1);
  }
});

test("the reported CRM INVALID_DATA is surfaced and never treated as success", async () => {
  const f = setup(() => sdkResponse({ success: false, stage: "execute transition", result: { code: "INVALID_DATA", message: "invalid data", details: {}, status: "error" } }));
  await assert.rejects(f.run(), /INVALID_DATA/);
  assert.equal(f.refreshes.length, 0);
  assert.equal(f.state.bookingBlueprintExecuting, false);
});

test("success diagnostics with a code property do not become an API rejection", async () => {
  const f = setup(() => sdkResponse({ success: true, result: { code: "SUCCESS", status: "success", details: { code: "diagnostic-code" } } }));
  await f.run();
  assert.equal(f.logs.length, 0);
});

test("no-field button executes once, fields open the form without writing", async () => {
  const f = setup();
  await f.click();
  assert.equal(f.calls.length, 1);
  f.state.bookingBlueprint.transitions = [{ ...transition, fields: [{ api_name: "FID_Date", data_type: "date", mandatory: true }] }];
  const button = await f.click();
  assert.equal(f.calls.length, 1);
  assert.equal(f.dialogs.length, 1);
  assert.equal(button.disabled, false);
});

test("unsupported requirements give a CRM fallback without submitting empty data", async () => {
  const f = setup();
  f.state.bookingBlueprint.transitions = [{ ...transition, fields: [{ api_name: "Contact_Name", data_type: "lookup" }] }];
  await f.click();
  assert.equal(f.calls.length, 0);
  assert.match(f.errors.at(-1), /CRM record.*Contact_Name/);
});

test("only one transition can be submitted until its response arrives", async () => {
  let finish;
  const f = setup(() => new Promise(resolve => { finish = resolve; }));
  const first = f.run();
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(f.run(), /already running/);
  assert.equal(f.calls.length, 1);
  finish(sdkResponse(ok));
  await first;
  assert.equal(f.state.bookingBlueprintExecuting, false);
});

test("a dialog belonging to another booking cannot execute", async () => {
  const f = setup();
  await assert.rejects(f.context.executeBlueprintTransition(transition, {}, "other-booking"), /selected booking changed/);
  assert.equal(f.calls.length, 0);
});

test("changing booking while a transition runs does not refresh or notify the other booking", async () => {
  let finish;
  const f = setup(() => new Promise(resolve => { finish = resolve; }));
  const running = f.run();
  await new Promise(resolve => setImmediate(resolve));
  f.state.selectedBookingId = "another-booking";
  finish(sdkResponse(ok));
  await running;
  assert.equal(f.refreshes.length, 0);
  assert.equal(f.notices.length, 0);
});

test("form sends numbers and booleans, omits empty optional values, validates required fields", () => {
  const f = setup();
  const fields = [{ api_name: "Amount", data_type: "currency" }, { api_name: "Confirmed", data_type: "boolean" }, { api_name: "Date", data_type: "date" }];
  const form = { elements: { Amount: { type: "number", value: "12.5" }, Confirmed: { type: "checkbox", checked: false }, Date: { type: "date", value: "" } } };
  const data = f.context.collectBlueprintTransitionData(fields, form);
  assert.deepEqual(JSON.parse(JSON.stringify(data)), { Amount: 12.5, Confirmed: false });
  fields[2].mandatory = true;
  assert.throws(() => f.context.collectBlueprintTransitionData(fields, form), /Complete Date/);
});

test("a partially saved transition is not announced as completed", async () => {
  const f = setup(() => sdkResponse({ success: true, message: "Blueprint transition executed successfully.", result: { code: "SUCCESS", status: "success", message: "transition saved partially" } }));
  await f.run();
  assert.match(f.notices[0], /saved partially/);
  assert.equal(f.refreshes.length, 1);
});

test("a slow earlier load cannot attach its Blueprint to a newer selected booking", async () => {
  const f = setup();
  const c = f.context;
  let finishOld;
  c.loadBookingBlueprintForBooking = id => id === "old" ? new Promise(resolve => { finishOld = resolve; }) : Promise.resolve({ transitions: [{ id: "new-transition" }] });
  c.crmGetRecord = async (_, id) => ({ id });
  c.loadBookingServicesForBooking = async () => [];
  c.loadBookingStepsForBooking = async () => [];
  c.elements.bookingSearch = {};
  c.clearSelectedMailPreview = () => {};
  c.onCloseBookingReportDialog = () => {};
  c.onCloseCardPurchaseDialog = () => {};
  vm.runInContext(extract(source, "clearActiveBookingWorkspace"), c);
  for (const name of ["showLoading", "clearLoading", "indexSteps", "resetServiceFilters", "resetTravelersState", "renderBookingWorkspace", "renderBookingSummary", "ensureDeskTicketLoaded", "applyServiceFilter", "renderSelectionPanel", "renderEmailsPanel", "renderTravelersWorkspace", "renderBookingBrowserPanel"]) c[name] = () => {};
  vm.runInContext(extract(source, "loadBookingWorkspace"), c);
  const oldLoad = c.loadBookingWorkspace("old");
  await c.loadBookingWorkspace("new");
  finishOld({ transitions: [{ id: "old-transition" }] });
  await oldLoad;
  assert.equal(f.state.selectedBookingId, "new");
  assert.equal(f.state.bookingBlueprint.transitions[0].id, "new-transition");
});
