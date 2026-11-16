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
const processInfo = { field_value: "All Services Confirmed", current_picklist: { colour_code: "#0f766e" } };
const sdkResponse = output => ({ code: "success", details: { type: "string", output: JSON.stringify(output) }, message: "function executed successfully" });
const ok = { success: true, result: { code: "SUCCESS", status: "success", message: "transition updated successfully", details: {} } };

test("completed transition with failed follow-up refreshes and cannot be offered as a normal retry", async () => {
  for (const refreshFails of [false, true]) {
    const f = setup(() => sdkResponse({ success: false, transition_completed: true, message: "Desk assignment failed" }));
    if (refreshFails) f.context.loadBookingWorkspace = async () => { throw new Error("Unavailable"); };
    await assert.rejects(f.run(), error => {
      assert.equal(error.transitionCompleted, true);
      assert.match(error.message, /Do not repeat/);
      if (refreshFails) assert.match(error.message, /could not be refreshed/);
      return true;
    });
    assert.equal(f.state.bookingBlueprint, null);
    assert.equal(f.state.bookingBlueprintExecuting, false);
    if (!refreshFails) assert.deepEqual(f.refreshes, [f.state.selectedBookingId]);
  }
});

test("a completed transition failure does not reload a different selected booking", async () => {
  const f = setup(() => {
    f.state.selectedBookingId = "other";
    return sdkResponse({ success: false, transition_completed: true, message: "Desk failed" });
  });
  await assert.rejects(f.run(), error => error.transitionCompleted === true);
  assert.deepEqual(f.refreshes, []);
});

test("Assign Reservation requires a selected user and sends its lookup with the transition", async () => {
  const f = setup();
  f.context.crmUpdateRecord = async () => ({ code: "SUCCESS", status: "success" });
  const action = { ...transition, name: "Assign Reservation" };
  f.state.bookingBlueprint.transitions = [action];
  await f.click();
  assert.equal(f.calls.length, 0);
  assert.equal(f.dialogs.length, 1);
  for (const metadata of [[], [{ api_name: "Reservation_Rep", data_type: "userlookup", mandatory: false }]]) {
    const fields = f.context.getBlueprintTransitionFields({ ...action, fields: metadata });
    assert.equal(fields.length, 1);
    const form = { elements: { Reservation_Rep: { value: "" } } };
    assert.throws(() => f.context.collectBlueprintTransitionData(fields, form), /Complete Reservation Rep/);
    form.elements.Reservation_Rep.value = "616617000000365001";
    assert.throws(() => f.context.collectBlueprintTransitionData(fields, form), /available reservation representative/);
    fields[0].pick_list_values = [{ actual_value: "616617000000365001" }];
    const data = f.context.collectBlueprintTransitionData(fields, form);
    await f.context.executeBlueprintTransition(action, data);
    assert.deepEqual(JSON.parse(f.calls.at(-1)[1].transitionDataJson), { Reservation_Rep: { id: "616617000000365001" } });
  }
  const count = f.calls.length;
  await assert.rejects(f.context.executeBlueprintTransition(action, {}), /Select a Reservation Rep/);
  assert.equal(f.calls.length, count);
});

test("Assign Reservation waits for CRM save before Blueprint and preserves the booking and user IDs", async () => {
  const f = setup();
  let finishSave;
  const writes = [];
  f.context.crmUpdateRecord = (module, payload) => {
    writes.push(JSON.parse(JSON.stringify({ module, payload })));
    return new Promise(resolve => { finishSave = resolve; });
  };
  const action = { ...transition, name: "Assign Reservation" };
  const execution = f.context.executeBlueprintTransition(action, { Reservation_Rep: { id: "616617000000365001" } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(writes, [{ module: "Deals", payload: { id: f.state.selectedBookingId, Reservation_Rep: { id: "616617000000365001" } } }]);
  assert.equal(f.calls.length, 0);
  finishSave({ code: "SUCCESS", status: "success" });
  await execution;
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][0], "blueprint_executetransition");
});

test("Assign Reservation stops on failed, unconfirmed or rejected saves and on booking changes", async () => {
  for (const result of [{ code: "NO_PERMISSION", status: "error", message: "Denied" }, {}, null, new Error("Disconnected"), "changed"]) {
    const f = setup();
    f.context.crmUpdateRecord = async () => {
      if (result instanceof Error) throw result;
      if (result === "changed") { f.state.selectedBookingId = "other"; return { code: "SUCCESS" }; }
      return result;
    };
    await assert.rejects(f.context.executeBlueprintTransition({ ...transition, name: "Assign Reservation" }, { Reservation_Rep: { id: "123" } }), /transition was not executed/);
    assert.equal(f.calls.length, 0);
    assert.equal(f.state.bookingBlueprintExecuting, false);
  }
});

test("reservation selector includes only active reservations staff and fails closed on load errors", async () => {
  const f = setup();
  const helpers = ["populateBlueprintReservationUsers", "buildOwnerOptionsFromUserRelationships", "extractUserRelationshipUser", "isIncludedUserRelationshipOwner", "getUserRelationshipText", "getUserRelationshipId"];
  vm.runInContext(helpers.map(name => extract(source, name)).join("\n"), f.context);
  const select = { value: "", focus() {}, addEventListener(type, fn) { this[type] = fn; } }, submit = {}, error = {};
  let loadedOptions;
  f.context.initializeReservationSelector = (_, options) => { loadedOptions = options; return {}; };
  const dialog = { isConnected: true, querySelector: selector => selector.includes("Reservation_Rep") ? select : selector.includes("submit") ? submit : error };
  const field = {};
  f.context.loadAllUserRelationshipRecords = async () => [
    { User_ID: "123", User_Alias: "Reservas", Role: "Reservations Rep", Status: "Active", Email: "rep@example.com" },
    { User_ID: "234", User_Alias: "Sales and reservations", Role: "Sales-Reservations Rep", Status: "Active", Email: "combined@example.com" },
    { User_ID: "345", User_Alias: "Inactive combined", Role: "Sales-Reservations Rep", Status: "Inactive", Email: "inactive-combined@example.com" },
    { User_ID: "456", User_Alias: "Inactive", Role: "Reservations Rep", Status: "Inactive", Email: "old@example.com" },
    { User_ID: "789", User_Alias: "Sales", Role: "Sales Rep", Status: "Active", Email: "sales@example.com" }
  ];
  await f.context.populateBlueprintReservationUsers(dialog, field);
  assert.equal(submit.disabled, true);
  assert.equal(select.disabled, false);
  assert.equal(loadedOptions.length, 2);
  assert.equal(loadedOptions[0].value, "123");
  assert.equal(loadedOptions[1].value, "234");
  assert.equal(field.pick_list_values.length, 2);
  assert.equal(field.pick_list_values[0].actual_value, "123");
  for (const load of [async () => [], async () => { throw new Error("CRM unavailable"); }]) {
    f.context.loadAllUserRelationshipRecords = load;
    await f.context.populateBlueprintReservationUsers(dialog, {});
    assert.equal(submit.disabled, true);
    assert.equal(select.disabled, true);
    assert.equal(error.hidden, false);
    assert.ok(error.textContent);
  }
});
function setup(respond = () => sdkResponse(ok)) {
  const calls = [], refreshes = [], logs = [], notices = [], errors = [], dialogs = [];
  const state = { currentUserId: "616617000000000001", currentUserEmail: "rep@example.com", currentUserName: "Reservation Rep", selectedBookingId: "616617000166482045", bookingBlueprint: { processInfo, transitions: [transition] } };
  const context = vm.createContext({
    document: {
      body: { appendChild() {} },
      createElement() { return { setAttribute() {}, addEventListener() {}, showModal() {}, close() {}, remove() {} }; }
    },
    recordEditLocks: require("./helpers/record-edit-locks.cjs"), bookingDocuments: { reset() {}, sync() {}, async ensure() {} }, state, elements: {}, MODULES: { bookings: "Deals" },
    isCreateEzusTransition: () => false,
    renderBookingSummary() {},
    loadUserBlueprint: async () => ({ blueprint: { process_info: state.bookingBlueprint.processInfo, transitions: state.bookingBlueprint.transitions.map(item => ({ ...item, color_code: item.color_code || "#2385ef" })) } }),
    assertUserBlueprintTransition: async () => state.bookingBlueprint,
    ZOHO: { CRM: { FUNCTIONS: { execute: async (name, args) => { calls.push([name, JSON.parse(args.arguments)]); return respond(name); } } } },
    validateCreateInEzusAgency: async () => {},
    loadBookingWorkspace: async id => refreshes.push(id),
    setNotice: (_, message) => notices.push(message), setError: (_, message) => errors.push(message),
    console: { error: (...args) => logs.push(args) },
    openBlueprintTransitionDialog: (...args) => dialogs.push(args)
  });
  const names = ["loadBookingBlueprintForBooking", "normalizeBookingBlueprintPayload", "findSelectedBookingBlueprintTransition",
    "validateBookingWorkdriveForTransition", "getBookingLinkFieldValue", "onWorkspaceActionClick", "collectBlueprintTransitionData", "executeBlueprintTransition", "setBlueprintTransitionButtonsBusy", "getBlueprintTransitionFields",
    "getBlueprintFailureDetails", "buildBlueprintTransitionError", "extractFunctionPayload", "normalizeFunctionPayloadCandidate",
    "parseJsonCandidate", "getFunctionPayloadErrorDetails"];
  // Controller contract tests stub the native execution boundary. Its session,
  // payload and no-retry behavior are exercised in blueprint-native.test.cjs.
  context.executeNativeBlueprint = async args => context.ZOHO.CRM.FUNCTIONS.execute("blueprint_executetransition", { arguments: JSON.stringify(args) });
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
    transitionId: "616617000135728065", transitionDataJson: "{}",
    actionUserJSON: JSON.stringify({ id: "616617000000000001", email: "rep@example.com", name: "Reservation Rep" })
  }]]);
  assert.deepEqual(f.refreshes, ["616617000166482045"]);
  assert.equal(f.logs.length, 0);
});

test("loads the user's native Blueprint without calling a shared function", async () => {
  const f = setup();
  const blueprint = await f.context.loadBookingBlueprintForBooking(f.state.selectedBookingId);
  assert.equal(blueprint.transitions[0].id, transition.id);
  assert.equal(blueprint.processInfo.field_value, processInfo.field_value);
  assert.equal(f.calls.length, 0);
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

for (const name of ["New Booking Won", "Auto-Assign Booking Won"]) {
  test(name + " opens commission fields and submits a required numeric amount with optional details", async () => {
    const f = setup();
    f.context.crmGetRecord = async () => ({ Booking_Workdrive_Folder_ID: "folder-1", Sales_Rep: { id: "616617000000365001" } });
    const won = { ...transition, name, fields: [] };
    f.state.bookingBlueprint.transitions = [won];
    await f.click();
    assert.equal(f.calls.length, 0);
    assert.equal(f.dialogs.length, 1);
    const fields = f.context.getBlueprintTransitionFields(won);
    const form = { elements: { Final_Commission: { value: "" }, Agent_Commission_Details: { value: "" } } };
    assert.throws(() => f.context.collectBlueprintTransitionData(fields, form), /Complete Agent Commission Amount/);
    form.elements.Final_Commission.value = "abc";
    assert.throws(() => f.context.collectBlueprintTransitionData(fields, form), /valid number/);
    for (const amount of ["0", "125.50"]) {
      form.elements.Final_Commission.value = amount;
      const data = f.context.collectBlueprintTransitionData(fields, form);
      await f.context.executeBlueprintTransition(won, data);
      assert.deepEqual(JSON.parse(f.calls.at(-1)[1].transitionDataJson), { Final_Commission: Number(amount), ...(name.startsWith("Auto") ? { Reservation_Rep: { id: "616617000000365001" } } : {}) });
    }
    form.elements.Agent_Commission_Details.value = "Agreed with agent";
    const data = f.context.collectBlueprintTransitionData(fields, form);
    assert.equal(data.Agent_Commission_Details, "Agreed with agent");
    const metadata = f.context.getBlueprintTransitionFields({ ...won, fields: [
      { api_name: "Custom_Amount", field_label: "Agent Commission Amount", data_type: "currency" },
      { api_name: "Agent_Commission_Details", data_type: "textarea", mandatory: true }
    ] });
    assert.equal(metadata.length, 2);
    assert.equal(metadata[0].api_name, "Final_Commission");
    assert.equal(metadata[0].mandatory, true);
    assert.equal(metadata[1].mandatory, false);
  });
}

for (const closing of [
  { name: "Dead" }, { name: "Mark as Dead" }, { name: "Marked Dead" },
  { name: "Cancelled" }, { name: "Cancelled with charges" },
  { name: "Close booking", next_field_value: "Dead" },
  { name: "Cancel booking", next_field_value: "Cancelled" },
  { name: "Cancel booking", next_field_value: "Cancelled with charges" }
]) {
  test(JSON.stringify(closing) + " opens confirmation without executing a fieldless transition", async () => {
    const f = setup();
    const closingTransition = { ...transition, ...closing, fields: [] };
    f.state.bookingBlueprint.transitions = [closingTransition];
    await f.click();
    assert.equal(f.calls.length, 0);
    assert.equal(f.dialogs.length, 1);
    assert.equal(f.dialogs[0][0], closingTransition);
  });
}

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
  c.bookingTasks = { reset() {}, async ensure() {} };
  vm.runInContext(read("ezus-sync-guard.js").replace(/^export /gm, "") + "\n" + extract(source, "canLeaveBookingWorkspace"), c);
  vm.runInContext(extract(source, "clearActiveBookingWorkspace"), c);
  for (const name of ["showLoading", "clearLoading", "indexSteps", "resetServiceFilters", "resetTravelersState", "renderBookingWorkspace", "renderBookingSummary", "ensureDeskTicketLoaded", "applyServiceFilter", "renderSelectionPanel", "renderEmailsPanel", "renderTravelersWorkspace", "renderBookingBrowserPanel", "renderActiveTab", "renderPaymentsWorkspace"]) c[name] = () => {};
  vm.runInContext(extract(source, "loadBookingWorkspace"), c);
  const oldLoad = c.loadBookingWorkspace("old");
  await c.loadBookingWorkspace("new");
  finishOld({ transitions: [{ id: "old-transition" }] });
  await oldLoad;
  assert.equal(f.state.selectedBookingId, "new");
  assert.equal(f.state.bookingBlueprint.transitions[0].id, "new-transition");
});

for (const name of ["Auto Assign", "Auto-Assign Booking Won"]) {
  test(name + " automatically submits the current Sales Rep as Reservation Rep", async () => {
    const f = setup();
    const action = { ...transition, name, fields: [{ api_name: "Reservation_Rep", field_label: "Reservation Rep", data_type: "userlookup", mandatory: true }] };
    f.state.selectedBooking = { Sales_Rep: { id: "stale" } };
    f.context.crmGetRecord = async (module, id) => {
      assert.equal(module, "Deals");
      assert.equal(id, f.state.selectedBookingId);
      return { Booking_Workdrive_Folder_ID: "folder-1", Sales_Rep: { id: "616617000000365001" } };
    };
    assert.ok(!f.context.getBlueprintTransitionFields(action).some(field => field.api_name === "Reservation_Rep"));
    await f.context.executeBlueprintTransition(action, { Reservation_Rep: { id: "wrong" }, Final_Commission: 25 });
    assert.deepEqual(JSON.parse(f.calls[0][1].transitionDataJson), { Reservation_Rep: { id: "616617000000365001" }, Final_Commission: 25 });
  });
}

test("Auto Assign without Sales Rep stops before executing Blueprint", async () => {
  const f = setup();
  f.context.crmGetRecord = async () => ({ Booking_Workdrive_Folder_ID: "folder-1", Sales_Rep: null });
  await assert.rejects(f.context.executeBlueprintTransition({ ...transition, name: "Auto Assign Booking Won" }, {}), /requires a Sales Rep/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.state.bookingBlueprintExecuting, false);
});

test("other transitions still reject unsupported Reservation Rep input", () => {
  const f = setup();
  assert.throws(() => f.context.getBlueprintTransitionFields({ ...transition, fields: [{ api_name: "Reservation_Rep", data_type: "userlookup" }] }), /widget cannot edit/);
});

for (const field of ["currentUserId", "currentUserEmail", "currentUserName"]) {
  test("missing action identity blocks all transition side effects: " + field, async () => {
    const f = setup();
    f.state[field] = " ";
    let saved = false;
    f.context.saveEzusBookingDetails = async () => { saved = true; };
    await assert.rejects(f.context.executeBlueprintTransition(transition, {}, f.state.selectedBookingId, {}), /identify the current user/);
    assert.equal(saved, false);
    assert.equal(f.calls.length, 0);
    assert.ok(!f.state.bookingBlueprintExecuting);
  });
}

test("action identity is captured before asynchronous transition preparation", async () => {
  const f = setup();
  f.context.validateCreateInEzusAgency = async () => {
    f.state.currentUserId = "different";
    f.state.currentUserEmail = "different@example.com";
    f.state.currentUserName = "Different User";
  };
  await f.run();
  assert.deepEqual(JSON.parse(f.calls[0][1].actionUserJSON), {
    id: "616617000000000001", email: "rep@example.com", name: "Reservation Rep"
  });
});

for (const name of ["New Booking Won", "Auto-Assign Booking Won", "Autoassign"]) {
  test(name + " blocks missing WorkDrive folders on click and execution", async () => {
    for (const value of [undefined, null, "", "   "]) {
      const f = setup();
      const action = { ...transition, name };
      f.state.bookingBlueprint.transitions = [action];
      f.state.selectedBooking = { Booking_Workdrive_Folder_ID: "stale-folder" };
      f.context.crmGetRecord = async () => ({ Booking_Workdrive_Folder_ID: value });
      const button = await f.click();
      assert.match(f.errors.at(-1), /WorkDrive folder.*Reservations/);
      assert.equal(f.dialogs.length, 0);
      assert.equal(button.disabled, false);
      await assert.rejects(f.context.executeBlueprintTransition(action, {}), /WorkDrive folder.*Reservations/);
      assert.equal(f.calls.length, 0);
      assert.equal(f.state.bookingBlueprintExecuting, false);
    }
  });
}
