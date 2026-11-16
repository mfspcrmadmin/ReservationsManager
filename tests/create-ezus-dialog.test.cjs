const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const read = file => fs.readFileSync(path.join(__dirname, "../app/js", file), "utf8").replace(/\r\n/g, "\n");
const source = read("create-ezus-dialog.js").replace(/^import .*;\n/gm, "").replace(/^export /gm, "");
const controller = read("booking-controller.js");
const extract = (text, name) => {
  const start = text.search(new RegExp("^(?:export )?(?:async )?function " + name + "\\(", "m"));
  assert.ok(start >= 0, name);
  return text.slice(start, text.indexOf("\n}", start) + 2).replace(/^export /, "");
};
const values = { referencePrefix: "MFSP", Deal_Name: "Summer trip", Account_Name: { id: "client" }, Contact_Name: { id: "contact" }, Arrival_Date: "2026-07-12", Departure_Date: "2026-07-20", Travellers_Number: "3" };
function setup() {
  const calls = [];
  const fixture = { client: { id: "client" }, contact: { id: "contact", Account_Name: { id: "client" } }, booking: { id: "booking" }, result: { code: "SUCCESS", status: "success" } };
  const context = vm.createContext({ recordEditLocks: require("./helpers/record-edit-locks.cjs"),
    initializeEzusDateRange: () => () => {},
    crmGetRecord: async (module, id) => { calls.push(["read", module, id]); return module === "Deals" ? fixture.booking : module === "Accounts" ? fixture.client : fixture.contact; },
    crmUpdateRecord: async (module, data) => { calls.push(["update", module, data]); return fixture.result; }
  });
  vm.runInContext(source + "\n" + extract(read("blueprint-contact-agency.js"), "isCreateEzusTransition"), context);
  return { context, calls, fixture };
}

test("recognizes both Create in Ezus and Create Ezus Project", () => {
  const { context } = setup();
  for (const name of ["Create in Ezus", "Create Ezus Project", "CREATE EZUS PROJECT"]) assert.equal(context.isCreateEzusTransition({ name }), true);
  assert.equal(context.isCreateEzusTransition({ name: "Sync Ezus" }), false);
});

test("validates required fields, date order and whole traveler counts before writing", async () => {
  const { context, calls } = setup();
  for (const changed of [{ Deal_Name: "  " }, { Deal_Name: "a".repeat(121) }, { Account_Name: null }, { Contact_Name: null }, { Arrival_Date: "2026-02-30" }, { Departure_Date: "2026-07-01" }, { Travellers_Number: -1 }, { Travellers_Number: "1.5" }, { Travellers_Number: "abc" }, { Travellers_Number: 1000000000 }]) {
    await assert.rejects(context.saveEzusBookingDetails("booking", { ...values, ...changed }, () => {}));
  }
  assert.equal(calls.length, 0);
  const optional = context.validateEzusBookingDetails({ ...values, Travellers_Number: "" });
  assert.equal(optional.Travellers_Number, null);
});

test("dates are required and trips over 40 inclusive days never write to CRM", async () => {
  const { context, calls } = setup();
  for (const changed of [
    { Arrival_Date: '' }, { Departure_Date: '' }, { Arrival_Date: null },
    { Arrival_Date: '2026-01-01', Departure_Date: '2026-02-10' },
    { Arrival_Date: '2026-03-01', Departure_Date: '2026-04-10' },
    { Arrival_Date: '2026-02-29' }
  ]) {
    await assert.rejects(context.saveEzusBookingDetails('booking', { ...values, ...changed }, () => {}));
  }
  assert.equal(calls.length, 0);
  for (const [Arrival_Date, Departure_Date] of [
    ['2026-01-01', '2026-01-01'], ['2026-01-01', '2026-02-09'],
    ['2026-03-01', '2026-04-09'], ['2028-02-29', '2028-03-01'],
    ['2026-12-25', '2027-01-05']
  ]) {
    await context.saveEzusBookingDetails('booking', { ...values, Arrival_Date, Departure_Date }, () => {});
    const payload = calls.filter(call => call[0] === 'update').at(-1)[2];
    assert.equal(payload.Arrival_Date, Arrival_Date);
    assert.equal(payload.Departure_Date, Departure_Date);
  }
});

test("saves the exact CRM API fields after verifying the client-contact relationship", async () => {
  const { context, calls } = setup();
  await context.saveEzusBookingDetails("booking", values, () => {});
  const write = calls.find(call => call[0] === "update");
  assert.equal(write[1], "Deals");
  const { referencePrefix, ...bookingValues } = values;
  assert.deepEqual(JSON.parse(JSON.stringify(write[2])), { id: "booking", ...bookingValues, Travellers_Number: 3 });
});

test("unavailable or mismatching lookups and changed booking block the write", async () => {
  for (const mutate of [f => { f.client = null; }, f => { f.contact = null; }, f => { f.contact.Account_Name.id = "other"; }]) {
    const { context, fixture, calls } = setup();
    mutate(fixture);
    await assert.rejects(context.saveEzusBookingDetails("booking", values, () => {}));
    assert.equal(calls.filter(call => call[0] === "update").length, 0);
  }
  const { context, calls } = setup();
  let checks = 0;
  await assert.rejects(context.saveEzusBookingDetails("booking", values, () => { if (++checks === 2) throw new Error("Booking changed"); }), /Booking changed/);
  assert.equal(calls.filter(call => call[0] === "update").length, 0);
});

test("CRM failures or empty save acknowledgements block continuation", async () => {
  for (const result of [{}, { status: "error", code: "INVALID_DATA", message: "Invalid client" }]) {
    const { context, fixture } = setup();
    fixture.result = result;
    await assert.rejects(context.saveEzusBookingDetails("booking", values, () => {}));
  }
});

test("opening the Create Ezus transition always opens review without executing it", async () => {
  const { context } = setup();
  let opened, executed = 0;
  const transition = { id: "transition", name: "Create Ezus Project", fields: [{ api_name: "Account_Name", data_type: "lookup" }] };
  Object.assign(context, {
    state: { currentUserId: "616617000000000001", currentUserEmail: "rep@example.com", currentUserName: "Reservation Rep", selectedBookingId: "booking", selectedBooking: values }, elements: {},
    findSelectedBookingBlueprintTransition: () => transition,
    getBlueprintTransitionFields: value => { assert.equal(value.fields.length, 0); return []; },
    openCreateEzusDialog: options => { opened = options; }, executeBlueprintTransition: async () => executed++, setError: () => {}
  });
  vm.runInContext(extract(controller, "onWorkspaceActionClick"), context);
  const button = { disabled: false, getAttribute: () => "transition" };
  await context.onWorkspaceActionClick({ stopPropagation() {}, target: { closest: selector => selector === "[data-blueprint-transition-id]" ? button : null } });
  assert.equal(opened.bookingId, "booking");
  assert.equal(executed, 0);
  assert.equal(opened.isCurrent(), true);
  context.state.selectedBookingId = "other";
  assert.equal(opened.isCurrent(), false);
});

test("execution saves before transitioning and includes required Blueprint fields", async () => {
  const { context, fixture, calls } = setup();
  Object.assign(context, {
    state: { currentUserId: "616617000000000001", currentUserEmail: "rep@example.com", currentUserName: "Reservation Rep", selectedBookingId: "booking" }, elements: {}, MODULES: { bookings: "Deals" },
    assertUserBlueprintTransition: async () => context.state.bookingBlueprint, setBlueprintTransitionButtonsBusy() {}, validateCreateInEzusAgency: async () => calls.push(["validate"]),
    crmExecuteFunction: async (name, args) => { calls.push([name === "createprojectinezuswithprefix" ? "create" : "execute", args]); return name === "createprojectinezuswithprefix" ? { error: false } : { success: true }; },
    extractFunctionPayload: value => value, getBlueprintFailureDetails: () => [],
    confirmCreatedEzusProject: async () => ({ id: "booking", Ezus_Project_ID: "project", MFSP_Reference: "MFSP123" }),
    setError() {}, loadBookingWorkspace: async () => {}
  });
  vm.runInContext(extract(controller, "executeBlueprintTransition"), context);
  const transition = { id: "transition", name: "Create Ezus Project", fields: [{ api_name: "Account_Name", data_type: "lookup" }] };
  await context.executeBlueprintTransition(transition, {}, "booking", values);
  assert.ok(calls.findIndex(call => call[0] === "update") < calls.findIndex(call => call[0] === "create"));
  assert.ok(calls.findIndex(call => call[0] === "create") < calls.findIndex(call => call[0] === "execute"));
  assert.deepEqual(JSON.parse(JSON.stringify(calls.find(call => call[0] === "create")[1])), {
    bookingId: "booking", referencePrefix: "MFSP",
    arrivalDateIso: values.Arrival_Date, departureDateIso: values.Departure_Date
  });
  assert.deepEqual(JSON.parse(calls.find(call => call[0] === "execute")[1].transitionDataJson), { Account_Name: { id: "client" } });
  calls.length = 0;
  fixture.result = {};
  await assert.rejects(context.executeBlueprintTransition(transition, {}, "booking", values));
  assert.equal(calls.some(call => call[0] === "execute"), false);
});

test("calendar dates reach the function JSON unchanged despite localized CRM dates", async () => {
  for (const [arrival, departure] of [
    ["2026-07-12", "2026-07-20"],
    ["2026-10-25", "2026-11-02"],
    ["2028-02-29", "2028-03-01"]
  ]) {
    const { context, fixture, calls } = setup();
    fixture.booking = { id: "booking", Arrival_Date: "12/07/2026", Departure_Date: "20/07/2026" };
    const requests = [];
    Object.assign(context, {
      state: { currentUserId: "616617000000000001", currentUserEmail: "rep@example.com", currentUserName: "Reservation Rep", selectedBookingId: "booking" }, elements: {}, MODULES: { bookings: "Deals" },
      assertUserBlueprintTransition: async () => context.state.bookingBlueprint, setBlueprintTransitionButtonsBusy() {}, validateCreateInEzusAgency: async () => {},
      executeNativeBlueprint: async args => { calls.push(["native-transition", args]); return { success: true }; },
      ZOHO: { CRM: { FUNCTIONS: { execute: async (name, request) => {
        requests.push([name, JSON.parse(request.arguments)]);
        return name === "createprojectinezuswithprefix" ? { error: false } : { success: true };
      } } } },
      extractFunctionPayload: value => value, getBlueprintFailureDetails: () => [],
      confirmCreatedEzusProject: async () => ({ id: "booking", Ezus_Project_ID: "project", MFSP_Reference: "MFSP123" }),
      setError() {}, loadBookingWorkspace: async () => {}
    });
    vm.runInContext(extract(read("api.js"), "crmExecuteFunction"), context);
    vm.runInContext(extract(controller, "executeBlueprintTransition"), context);
    await context.executeBlueprintTransition(
      { id: "transition", name: "Create Ezus Project", fields: [] }, {}, "booking",
      { ...values, Arrival_Date: arrival, Departure_Date: departure }
    );
    assert.deepEqual(requests[0], ["createprojectinezuswithprefix", {
      bookingId: "booking", referencePrefix: "MFSP", arrivalDateIso: arrival, departureDateIso: departure
    }]);
    assert.equal(requests.length, 1);
    assert.equal(calls.filter(call => call[0] === "native-transition").length, 1);
    const saved = calls.find(call => call[0] === "update")[2];
    assert.equal(saved.Arrival_Date, requests[0][1].arrivalDateIso);
    assert.equal(saved.Departure_Date, requests[0][1].departureDateIso);
    requests.length = 0;
    await assert.rejects(context.executeBlueprintTransition(
      { id: "transition", name: "Create Ezus Project" }, {}, "booking",
      { ...values, Arrival_Date: "12/07/2026" }
    ), /valid arrival date/);
    assert.equal(requests.length, 0);
  }
});

test("dialog prefills CRM values and Close performs no save or transition", async () => {
  const { context, calls } = setup();
  const fields = Object.fromEntries(Object.keys(values).map(key => [key, { value: "", addEventListener() {}, focus() {}, setAttribute(key, value) { this[key] = value; }, removeAttribute(key) { delete this[key]; }, closest() { return { appendChild() {} }; } }]));
  const listeners = {};
  const controls = {
    form: { elements: fields, addEventListener: (name, handler) => { listeners[name] = handler; }, reportValidity: () => true },
    fieldset: {}, '[type="submit"]': {}, '[data-close]': {}, '[data-error]': {}, '[data-loading]': {},
    '[data-results="Account_Name"]': {}, '[data-results="Contact_Name"]': {}
  };
  const dialog = { isConnected: false, setAttribute() {}, querySelector: selector => controls[selector] || (controls[selector] = { addEventListener() {} }),
    addEventListener: (name, handler) => { listeners[name] = handler; }, showModal() {},
    close() { listeners.close(); }, remove() { this.isConnected = false; } };
  let continued = 0;
  Object.assign(context, {
    clearTimeout, setTimeout, getLookupName: lookup => lookup?.name || "",
    crmGetRecord: async () => ({ id: "booking", ...values, Account_Name: { id: "client", name: "Client A" }, Contact_Name: { id: "contact", name: "Ana" } }),
    document: { activeElement: { focus() {} }, querySelector: () => null, createElement: tag => tag === "dialog" ? dialog : {}, body: { appendChild: () => { dialog.isConnected = true; } } }
  });
  context.openCreateEzusDialog({ bookingId: "booking", isCurrent: () => true, onContinue: async () => continued++ });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fields.Deal_Name.value, values.Deal_Name);
  assert.equal(fields.Account_Name.value, "Client A");
  assert.equal(fields.Contact_Name.value, "Ana");
  assert.equal(fields.Arrival_Date.value, values.Arrival_Date);
  assert.equal(fields.Departure_Date.value, values.Departure_Date);
  assert.equal(fields.Travellers_Number.value, values.Travellers_Number);
  assert.equal(controls['[type="submit"]'].disabled, false);
  assert.match(dialog.innerHTML, />Cancel<\/button>/);
  assert.match(dialog.innerHTML, />Create project<\/button>/);
  controls['[data-close]'].onclick();
  assert.equal(dialog.isConnected, false);
  assert.equal(continued, 0);
  assert.equal(calls.length, 0);
});

async function resultDialog(onContinue) {
  const { context } = setup();
  const node = () => ({ hidden: false, disabled: false, value: "", children: [], events: {}, addEventListener(name, callback) { this.events[name] = callback; }, appendChild(child) { this.children.push(child); }, focus() {}, setAttribute(key, value) { this[key] = value; }, removeAttribute(key) { delete this[key]; } });
  const fields = Object.fromEntries(Object.keys(values).map(key => [key, { value: "", addEventListener() {}, focus() {}, setAttribute(key, value) { this[key] = value; }, removeAttribute(key) { delete this[key]; }, closest() { return { appendChild() {} }; } }]));
  const listeners = {}, controls = {};
  controls.form = { elements: fields, addEventListener: (name, callback) => { listeners[name] = callback; }, reportValidity: () => true };
  const dialog = { ...node(), isConnected: false, querySelector: key => controls[key] || (controls[key] = node()),
    addEventListener: (name, callback) => { listeners[name] = callback; }, showModal() {}, close() { listeners.close(); }, remove() { this.isConnected = false; } };
  Object.assign(context, {
    clearTimeout, setTimeout, getLookupName: lookup => lookup?.name || "",
    crmGetRecord: async () => ({ id: "booking", ...values, Account_Name: { id: "client", name: "Client A" }, Contact_Name: { id: "contact", name: "Ana" } }),
    document: { activeElement: node(), querySelector: () => null, createElement: tag => tag === "dialog" ? dialog : node(), body: { appendChild: () => { dialog.isConnected = true; } } }
  });
  context.openCreateEzusDialog({ bookingId: "booking", isCurrent: () => true, onContinue });
  await new Promise(resolve => setImmediate(resolve));
  return { context, dialog, controls, fields, listeners, submit: () => listeners.submit({ preventDefault() {} }) };
}

test("execution displays a spinner, blocks duplicate submissions and stays open with the project link", async () => {
  let finish, calls = 0;
  const f = await resultDialog(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
  assert.match(f.dialog.innerHTML, /name="referencePrefix"[\s\S]*name="Deal_Name"[\s\S]*name="Account_Name"[\s\S]*name="Contact_Name"[\s\S]*Trip details[\s\S]*name="Arrival_Date"[\s\S]*name="Departure_Date"[\s\S]*name="Travellers_Number"/);
  const running = f.submit();
  assert.equal(f.controls['[data-spinner]'].hidden, false);
  assert.equal(f.controls.fieldset.hidden, true);
  assert.equal(f.controls['[data-close]'].disabled, true);
  await f.submit();
  assert.equal(calls, 1);
  let prevented = false;
  f.listeners.cancel({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  finish({ partial: false, booking: { Ezus_Project_ID: "project 123", MFSP_Reference: "MFSP123" } });
  await running;
  assert.equal(f.dialog.isConnected, true);
  assert.equal(f.controls['[data-spinner]'].hidden, true);
  assert.equal(f.controls['[data-result-title]'].textContent, "Successfully created");
  assert.equal(f.controls['[data-open-ezus]'].hidden, false);
  assert.equal(f.controls['[data-open-ezus]'].href, "https://pro.ezus.io/project?id=project%20123");
  assert.equal(f.controls['[type="submit"]'].hidden, true);
  assert.equal(f.controls['[data-close]'].disabled, false);
  f.controls['[data-close]'].onclick();
  assert.equal(f.dialog.isConnected, false);
});

test("execution failure shows the error with Close and no retry or project link", async () => {
  const f = await resultDialog(async () => { throw new Error("CRM rejected the transition"); });
  await f.submit();
  assert.equal(f.dialog.isConnected, true);
  assert.equal(f.controls['[data-spinner]'].hidden, true);
  assert.equal(f.controls['[data-error]'].textContent, "CRM rejected the transition");
  assert.equal(f.controls['[data-close]'].disabled, false);
  assert.equal(f.controls['[type="submit"]'].hidden, true);
  assert.equal(f.controls['[data-open-ezus]'].hidden, true);
});

test("partial completion cannot display creation success and a missing ID cannot open a broken link", async () => {
  const partial = await resultDialog(async () => ({ partial: true }));
  await partial.submit();
  assert.match(partial.controls['[data-error]'].textContent, /saved partially/);
  assert.equal(partial.controls['[data-open-ezus]'].hidden, true);
  const pendingLink = await resultDialog(async () => ({ partial: false, booking: { MFSP_Reference: "MFSP123" } }));
  await pendingLink.submit();
  assert.equal(pendingLink.controls['[data-result-title]'].textContent, "Transition completed");
  assert.equal(pendingLink.controls['[data-open-ezus]']['aria-disabled'], "true");
  assert.equal(pendingLink.controls['[data-open-ezus]'].href, undefined);
});

test("local validation keeps the fields editable before execution", async () => {
  const f = await resultDialog(async () => assert.fail("Should not execute"));
  f.fields.Deal_Name.value = "  ";
  await f.submit();
  assert.equal(f.fields.Deal_Name['aria-invalid'], 'true');
  assert.equal(f.controls.fieldset.hidden, false);
  assert.equal(f.controls.fieldset.disabled, false);
  assert.equal(f.controls['[type="submit"]'].hidden, false);
});

test("lookups require an explicit search with two characters and a CRM result selection", async () => {
  let submitted;
  const f = await resultDialog(async data => { submitted = data; return { booking: { Ezus_Project_ID: "project", MFSP_Reference: "MFSP123" } }; });
  const calls = [];
  f.context.crmSearchRecord = async (module, criteria) => {
    calls.push([module, criteria]);
    return module === "Accounts" ? [{ id: "new-client", Account_Name: "New Client" }] : [{ id: "new-contact", Full_Name: "New Contact" }];
  };
  for (const key of ["Account_Name", "Contact_Name"]) assert.match(f.dialog.innerHTML, new RegExp('name="' + key + '" readonly'));
  const query = f.controls['[data-lookup-query="Account_Name"]'];
  const search = f.controls['[data-lookup-search="Account_Name"]'];
  query.value = "N";
  query.events.input();
  assert.equal(search.disabled, true);
  await search.onclick();
  assert.equal(calls.length, 0);
  query.value = "New";
  query.events.input();
  assert.equal(search.disabled, false);
  assert.equal(calls.length, 0);
  assert.equal(f.fields.Account_Name.value, "Client A");
  await search.onclick();
  assert.deepEqual(calls[0], ["Accounts", "(Account_Name:starts_with:New)"]);
  f.controls['[data-results="Account_Name"]'].children[0].onclick();
  assert.equal(f.fields.Account_Name.value, "New Client");
  assert.equal(f.fields.Contact_Name.value, "");
  await f.submit();
  assert.equal(f.fields.Contact_Name['aria-invalid'], 'true');
  assert.equal(submitted, undefined);
  const contactQuery = f.controls['[data-lookup-query="Contact_Name"]'];
  contactQuery.value = "New";
  contactQuery.events.input();
  await f.controls['[data-lookup-search="Contact_Name"]'].onclick();
  assert.deepEqual(calls[1], ["Contacts", "((Account_Name:equals:new-client)and(Full_Name:starts_with:New))"]);
  f.controls['[data-results="Contact_Name"]'].children[0].onclick();
  await f.submit();
  assert.equal(submitted.Account_Name.id, "new-client");
  assert.equal(submitted.Contact_Name.id, "new-contact");
});

test("late lookup responses cannot replace results after the search text changes", async () => {
  const f = await resultDialog(async () => {});
  let finish;
  f.context.crmSearchRecord = () => new Promise(resolve => { finish = resolve; });
  const query = f.controls['[data-lookup-query="Account_Name"]'];
  query.value = "Old";
  query.events.input();
  const searching = f.controls['[data-lookup-search="Account_Name"]'].onclick();
  query.value = "New";
  query.events.input();
  finish([{ id: "old", Account_Name: "Old Client" }]);
  await searching;
  assert.equal(f.controls['[data-results="Account_Name"]'].children.length, 0);
  assert.equal(f.controls['[data-results="Account_Name"]'].hidden, true);
  assert.equal(f.fields.Account_Name.value, "Client A");
});

test("lookup failures are shown in the search area and Enter never submits the transition", async () => {
  const f = await resultDialog(async () => assert.fail("Must not transition"));
  const query = f.controls['[data-lookup-query="Account_Name"]'];
  query.value = "Agency";
  query.events.input();
  f.context.crmSearchRecord = async () => { throw new Error("Search unavailable"); };
  await f.controls['[data-lookup-search="Account_Name"]'].onclick();
  assert.equal(f.controls['[data-results="Account_Name"]'].textContent, "Search unavailable");
  assert.equal(f.controls['[data-lookup-search="Account_Name"]'].disabled, false);
  let prevented = false;
  query.events.keydown({ key: "Enter", preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  await new Promise(resolve => setImmediate(resolve));
});


test("accepts all prefixes, defaults to MFSP and rejects unsupported prefixes before writing", async () => {
  for (const prefix of ["MFSP", "MFOF", "MFAD"]) {
    const { context, fixture, calls } = setup();
    await context.saveEzusBookingDetails("booking", { ...values, referencePrefix: prefix }, () => {});
    assert.equal("referencePrefix" in calls.find(call => call[0] === "update")[2], false);
  }
  const { context, calls } = setup();
  assert.equal(context.validateEzusBookingDetails({ ...values, referencePrefix: undefined }).referencePrefix, "MFSP");
  await assert.rejects(context.saveEzusBookingDetails("booking", { ...values, referencePrefix: "OTHER" }, () => {}), /valid reference prefix/);
  assert.equal(calls.length, 0);
});

test("continues without a prefix field in CRM and retains the selected function parameter", async () => {
  const { context, calls } = setup();
  const result = await context.saveEzusBookingDetails("booking", { ...values, referencePrefix: "MFAD" }, () => {});
  assert.equal(result.referencePrefix, "MFAD");
  assert.equal(calls.some(call => call[0] === "read" && call[1] === "Deals"), false);
});

test("passes the selected prefix and only confirms the matching final reference", async () => {
  for (const prefix of ["MFSP", "MFOF", "MFAD"]) {
    let submitted;
    const f = await resultDialog(async data => {
      submitted = data;
      return { booking: { Ezus_Project_ID: "project", MFSP_Reference: prefix + "123" } };
    });
    f.fields.referencePrefix.value = prefix;
    await f.submit();
    assert.equal(submitted.referencePrefix, prefix);
    assert.equal(f.controls['[data-result-title]'].textContent, "Successfully created");
  }
  const f = await resultDialog(async () => ({ booking: { Ezus_Project_ID: "project", MFSP_Reference: "MFSP123" } }));
  f.fields.referencePrefix.value = "MFAD";
  await f.submit();
  assert.match(f.controls['[data-error]'].textContent, /reference has not been confirmed/);
  assert.equal(f.controls['[data-open-ezus]'].hidden, true);
});

for (const prefix of ["MFSP", "MFOF", "MFAD"]) {
  test("creation receives " + prefix + " as a function argument, never a CRM field", async () => {
    const { context, calls } = setup();
    Object.assign(context, {
      state: { currentUserId: "616617000000000001", currentUserEmail: "rep@example.com", currentUserName: "Reservation Rep", selectedBookingId: "booking" }, elements: {}, MODULES: { bookings: "Deals" },
      assertUserBlueprintTransition: async () => context.state.bookingBlueprint, setBlueprintTransitionButtonsBusy() {}, validateCreateInEzusAgency: async () => {},
      crmExecuteFunction: async (name, args) => {
        calls.push([name, args]);
        return { details: { output: JSON.stringify(name === "createprojectinezuswithprefix" ? { error: false } : { success: true }) } };
      },
      confirmCreatedEzusProject: async () => { calls.push(["confirm-project"]); return { id: "booking", Ezus_Project_ID: "project" }; },
      getBlueprintFailureDetails: () => [], setError() {},
      loadBookingWorkspace: async (_, options) => assert.equal(options.ezusReferencePrefix, prefix)
    });
    for (const name of ["executeBlueprintTransition", "extractFunctionPayload", "normalizeFunctionPayloadCandidate", "parseJsonCandidate"]) {
      vm.runInContext(extract(controller, name), context);
    }
    await context.executeBlueprintTransition({ id: "transition", name: "Create Ezus Project", fields: [] }, {}, "booking", { ...values, referencePrefix: prefix });
    const creation = calls.find(call => call[0] === "createprojectinezuswithprefix");
    assert.equal(creation[1].referencePrefix, prefix);
    assert.equal(creation[1].bookingId, "booking");
    assert.equal(creation[1].arrivalDateIso, values.Arrival_Date);
    assert.equal(creation[1].departureDateIso, values.Departure_Date);
    assert.ok(calls.findIndex(call => call[0] === "confirm-project") < calls.findIndex(call => call[0] === "blueprint_executetransition"));
    assert.deepEqual(JSON.parse(calls.find(call => call[0] === "blueprint_executetransition")[1].transitionDataJson), {});
    assert.equal("referencePrefix" in calls.find(call => call[0] === "update")[2], false);
  });
}

for (const creationResult of [{ error: true, message: "Ezus rename failed" }, {
  error: true,
  project_confirmed: false,
  workdrive_completed: false,
  desk_completed: false,
  stage: "confirm_ezus_project",
  create_project: { error: true, message: "Arrival and departure dates are required in YYYY-MM-DD format. No project was created." },
  message: "Arrival and departure dates are required in YYYY-MM-DD format. No project was created."
}, { error: true, stage: "validate_ezus_contact", message: "The booking contact is not marked as synchronized with Ezus." }, {}, null]) {
  test("creation failure or missing acknowledgement blocks the Blueprint: " + JSON.stringify(creationResult), async () => {
    const { context } = setup();
    const functions = [];
    Object.assign(context, {
      state: { currentUserId: "616617000000000001", currentUserEmail: "rep@example.com", currentUserName: "Reservation Rep", selectedBookingId: "booking" }, elements: {}, MODULES: { bookings: "Deals" },
      assertUserBlueprintTransition: async () => context.state.bookingBlueprint, setBlueprintTransitionButtonsBusy() {}, validateCreateInEzusAgency: async () => {},
      crmExecuteFunction: async name => { functions.push(name); return creationResult; },
      extractFunctionPayload: value => value
    });
    vm.runInContext(extract(controller, "executeBlueprintTransition"), context);
    await assert.rejects(context.executeBlueprintTransition({ id: "transition", name: "Create Ezus Project" }, {}, "booking", values), /Ezus rename failed|Arrival and departure dates are required|not marked as synchronized|Could not confirm/);
    assert.deepEqual(functions, ["createprojectinezuswithprefix"]);
    assert.equal(context.state.bookingBlueprintExecuting, false);
  });
}


test("unconfirmed creation blocks Blueprint execution and never retries project creation automatically", async () => {
  const { context } = setup();
  const functions = [];
  Object.assign(context, {
    state: { currentUserId: "616617000000000001", currentUserEmail: "rep@example.com", currentUserName: "Reservation Rep", selectedBookingId: "booking" }, elements: {}, MODULES: { bookings: "Deals" },
    assertUserBlueprintTransition: async () => context.state.bookingBlueprint, setBlueprintTransitionButtonsBusy() {}, validateCreateInEzusAgency: async () => {},
    crmExecuteFunction: async name => { functions.push(name); return { error: false }; },
    extractFunctionPayload: value => value,
    confirmCreatedEzusProject: async () => { throw new Error("CRM has not confirmed the requested MFOF reference"); }
  });
  vm.runInContext(extract(controller, "executeBlueprintTransition"), context);
  await assert.rejects(context.executeBlueprintTransition({ id: "transition", name: "Create Ezus Project" }, {}, "booking", { ...values, referencePrefix: "MFOF" }), /not confirmed/);
  assert.deepEqual(functions, ["createprojectinezuswithprefix"]);
  assert.equal(context.state.bookingBlueprintExecuting, false);
});

test("contact recovery shows spinner, prevents duplicate sync and enables explicit project retry", async () => {
  let finish, calls = 0;
  const f = await resultDialog(async () => { throw Object.assign(new Error("Contact is not synchronized"), { stage: "validate_ezus_contact" }); });
  f.context.crmExecuteFunction = async (name, args) => {
    calls++;
    assert.equal(name, "widget_recordlease");
    assert.equal(JSON.parse(args.requestBody).contactId, "contact");
    return new Promise(resolve => { finish = resolve; });
  };
  f.context.crmGetRecord = async () => ({ id: "contact", In_Ezus: true });
  await f.submit();
  assert.equal(f.controls['[data-contact-recovery]'].hidden, false);
  const pending = f.controls['[data-sync-contact]'].onclick();
  assert.equal(f.controls['[data-sync-spinner]'].hidden, false);
  assert.equal(f.controls['[data-sync-status]'].hidden, true);
  assert.equal(f.controls['[data-sync-status]'].textContent, "");
  await f.controls['[data-sync-contact]'].onclick();
  assert.equal(calls, 1);
  finish({ details: { output: JSON.stringify({ error: false }) } });
  await pending;
  assert.equal(f.controls['[data-sync-spinner]'].hidden, true);
  assert.match(f.controls['[data-sync-status]'].textContent, /synchronized successfully/);
  assert.equal(f.controls['[type="submit"]'].hidden, false);
});

test("contact recovery replaces old error and requires CRM readback", async () => {
  for (const response of [{ error: true, message: "Agency has no email" }, { error: false }, {}]) {
    const f = await resultDialog(async () => { throw Object.assign(new Error("Old contact error"), { stage: "validate_ezus_contact" }); });
    f.context.crmExecuteFunction = async () => ({ details: { output: JSON.stringify(response) } });
    f.context.crmGetRecord = async () => ({ id: "contact", In_Ezus: false });
    await f.submit();
    await f.controls['[data-sync-contact]'].onclick();
    assert.equal(f.controls['[data-error]'].hidden, true);
    assert.match(f.controls['[data-sync-status]'].textContent, /Agency has no email|CRM has not confirmed|Could not confirm/);
    assert.equal(f.controls['[type="submit"]'].hidden, true);
    assert.equal(f.controls['[data-close]'].disabled, false);
  }
});
