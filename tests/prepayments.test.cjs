const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { test } = require("node:test");

function harness(search) {
  const serviceRecords = new Map();
  const nodes = Object.fromEntries(["prepayments-content", "prepayments-summary", "refresh-prepayments"].map(id => [id, { innerHTML: "", disabled: false }]));
  const context = vm.createContext({
    showFeedback: () => {},
    Intl, Map, document: { getElementById: id => nodes[id] },
    MODULES: { prepaymentRequests: "Prepayment_Requests", prepayments: "Prepayments", bookingServices: "Booking_Services" },
    crmSearchRecord: search,
    crmUpdateRecord: async (entity, payload) => { if (entity === "Booking_Services") serviceRecords.set(payload.id, payload); return { code: "SUCCESS" }; },
    crmGetRecord: async (entity, id) => entity === "Booking_Services" ? { id, Booking: { id: "b1" }, Supplier: { id: "s1" }, ...serviceRecords.get(id) } : { Proforma_Attached: [{ file_Id: "uploaded-proforma" }] },
    escapeCriteriaValue: String,
    escapeHtml: value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
    getLookupName: value => value?.name || ""
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/js/prepayments-controller.js"), "utf8").replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, ""), context);
  return { context, nodes };
}

test("Proforma upload uses the multipart file API and rejects failed or missing uploads", async () => {
  const { context } = harness(async () => []);
  const file = { name: "proforma.pdf" };
  let response = { data: [{ status: "success", details: { id: "file-1" } }] };
  context.window = { ZOHO: { CRM: { API: { uploadFile: async config => {
    assert.equal(config.CONTENT_TYPE, "multipart");
    assert.equal(config.FILE.file, file);
    assert.equal(config.FILE.fileParam, "content");
    assert.equal(config.PARTS[0].content, "__FILE__");
    return response;
  } } } } };
  assert.equal((await context.uploadFile(file))[0].File_Id__s, "file-1");
  response = [{ code: "ERROR", message: "Upload rejected", details: { id: "file-1" } }];
  await assert.rejects(context.uploadFile(file), /Upload rejected/);
  response = { data: [] };
  await assert.rejects(context.uploadFile(file), /Could not upload proforma.pdf/);
  await assert.rejects(context.uploadFile(null), /Attach a Proforma/);
});

test("prepayment service selection rejects mixed suppliers, bookings and conflicting requests", async () => {
  const context = harness(async () => []).context;
  const service = { id: "s1", Supplier: { id: "v1" }, Booking: { id: "b1" } };
  assert.doesNotThrow(() => context.validatePrepaymentServices([service, { ...service, id: "s2" }], "b1", "v1"));
  assert.throws(() => context.validatePrepaymentServices([], "b1", "v1"), /at least one/);
  assert.throws(() => context.validatePrepaymentServices([service, { ...service, Supplier: { id: "v2" } }], "b1", "v1"), /same supplier/);
  assert.throws(() => context.validatePrepaymentServices([{ ...service, Booking: { id: "b2" } }], "b1", "v1"), /same booking/);
  assert.throws(() => context.validatePrepaymentServices([{ ...service, Prepayment_Request: { id: "other" } }], "b1", "v1", "r1"), /another prepayment request/);
  assert.doesNotThrow(() => context.validatePrepaymentServices([{ ...service, Prepayment_Request: { id: "r1" } }], "b1", "v1", "r1"));
  const errors = [];
  context.showFeedback = message => errors.push(message);
  await context.openPrepaymentForm({}, { selectedBookingId: "b1" }, null, [service, { ...service, id: "s2", Supplier: { id: "v2" } }]);
  assert.match(errors[0], /same supplier/);
});

test("service associations survive partial failure and retries do not overwrite payment progress", async () => {
  const { context } = harness(async () => []);
  const records = new Map([
    ["s1", { id: "s1", Booking: { id: "b1" }, Supplier: { id: "v1" }, Payment_Status: "To Be Paid" }],
    ["s2", { id: "s2", Booking: { id: "b1" }, Supplier: { id: "v1" }, Payment_Status: "Partially Paid" }]
  ]);
  const services = [...records.values()];
  const writes = [];
  let fail = true;
  context.crmGetRecord = async (_, id) => records.get(id);
  context.crmUpdateRecord = async (_, payload) => {
    if (payload.id === "s2" && fail) return { code: "INVALID_DATA", message: "Association failed" };
    writes.push(payload);
    records.set(payload.id, { ...records.get(payload.id), ...payload });
    return { code: "SUCCESS" };
  };
  await assert.rejects(context.linkPrepaymentServices(services, "b1", "v1", "r1", () => {}), /Association failed/);
  fail = false;
  await context.linkPrepaymentServices(services, "b1", "v1", "r1", () => {});
  assert.deepEqual(writes.map(item => item.id), ["s1", "s2"]);
  assert.equal(records.get("s1").Payment_Status, "Prepayment Requested");
  assert.equal(records.get("s2").Payment_Status, "Partially Paid");
  records.get("s2").Prepayment_Request = { id: "other" };
  await assert.rejects(context.linkPrepaymentServices(services, "b1", "v1", "r1", () => {}), /another prepayment request/);
  assert.equal(writes.length, 2);
});

test("Proforma saving verifies persisted files and falls back like Card Purchase", async () => {
  const { context } = harness(async () => []);
  const writes = [];
  context.crmUpdateRecord = async (entity, payload) => {
    writes.push(payload);
    return writes.length === 1 ? { code: "INVALID_DATA", status: "error" } : { code: "SUCCESS" };
  };
  context.crmGetRecord = async () => ({ Proforma_Attached: [{ file_Id: "file-1" }] });
  const files = await context.savePrepaymentProforma("request-1", [{ File_Id__s: "file-1" }]);
  assert.equal(files[0].file_Id, "file-1");
  assert.equal(writes.length, 2);
  assert.equal(writes[0].Proforma_Attached[0].$file_id, "file-1");
  assert.equal(writes[1].Proforma_Attached[0].file_id, "file-1");
  for (const missing of [null, [], {}, [{}]]) {
    context.crmGetRecord = async () => ({ Proforma_Attached: missing });
    await assert.rejects(context.savePrepaymentProforma("request-1", [{ File_Id__s: "file-1" }]), /did not confirm/);
  }
  context.crmUpdateRecord = async () => { throw new Error("Network failure"); };
  await assert.rejects(context.savePrepaymentProforma("request-1", [{ File_Id__s: "file-1" }]), /Network failure/);
});

test("payment timing calculates calendar days from the service date across month, year and DST boundaries", () => {
  const { context } = harness(async () => []);
  const calculate = context.calculatePrepaymentDueDate;
  for (const days of [1, 2, 3]) assert.equal(calculate("Within " + days + (days === 1 ? " day" : " days"), "2026-12-31T23:30:00+01:00"), "2027-01-0" + days);
  for (const days of [10, 15, 20, 30]) assert.equal(calculate(days + " days prior to service date", "2026-10-31"), "2026-10-" + String(31 - days).padStart(2, "0"));
  assert.equal(calculate("Within 1 day", "2028-02-28"), "2028-02-29");
  assert.equal(calculate("10 days prior to service date", "2026-01-05"), "2025-12-26");
  assert.equal(calculate("Specific Date", "2026-09-20"), null);
  for (const date of [null, "", "invalid", "2026-02-30"]) assert.equal(calculate("Within 1 day", date), "");
});

test("confirmed creations remain visible while CRM search catches up, then reconcile without duplicates", async () => {
  let indexed = false;
  const request = { id: "r-new", Name: "New request" };
  const payment = { id: "p-new", Name: "New prepayment", Prepayment_Request: { id: "r-new" }, Amount: 50 };
  const { context, nodes } = harness(async entity => indexed ? [entity === "Prepayment_Requests" ? request : payment] : []);
  const state = { selectedBookingId: "booking-1" };
  context.rememberCreatedPrepayment(state, "booking-1", "requests", request);
  context.rememberCreatedPrepayment(state, "booking-1", "payments", payment);
  const loading = context.ensurePrepaymentsLoaded({}, state, true);
  assert.match(nodes["prepayments-content"].innerHTML, /New prepayment/);
  await loading;
  assert.equal(state.prepaymentsData.payments.length, 1);
  assert.doesNotMatch(nodes["prepayments-content"].innerHTML, /No prepayment requests/);
  indexed = true;
  await context.ensurePrepaymentsLoaded({}, state, true);
  assert.equal(state.prepaymentsData.requests.length, 1);
  assert.equal(state.prepaymentsData.payments.length, 1);
  assert.equal(state.recentPrepaymentRecords["booking-1"].payments.length, 0);
  assert.equal(state.recentPrepaymentRecords["booking-1"].requests.length, 0);
  indexed = false;
  state.selectedBookingId = "booking-2";
  await context.ensurePrepaymentsLoaded({}, state, true);
  assert.equal(state.prepaymentsData.payments.length, 0);
  assert.doesNotMatch(nodes["prepayments-content"].innerHTML, /New prepayment/);
});

test("loads booking requests and their payments with pagination and no direct booking lookup on payments", async () => {
  const calls = [];
  const { context, nodes } = harness(async (entity, criteria, page) => {
    calls.push({ entity, criteria, page });
    if (entity === "Prepayment_Requests") return [{ id: "r1", Name: "<Request>" }];
    return page === 1 ? Array.from({ length: 200 }, (_, i) => ({ id: String(i), Prepayment_Request: { id: "r1" }, Accounting_Status: "Pending invoice", Amount: 1, Currency: "EUR" })) : [{ id: "last", Prepayment_Request: { id: "r1" }, Accounting_Status: "Prepayment recorded", Amount: 5, Currency: "USD" }];
  });
  const state = { selectedBookingId: "b1" };
  await context.ensurePrepaymentsLoaded({}, state);
  assert.equal(state.prepaymentsData.payments.length, 201);
  assert.deepEqual(calls, [
    { entity: "Prepayment_Requests", criteria: "(Booking:equals:b1)", page: 1 },
    { entity: "Prepayments", criteria: "(Prepayment_Request:equals:r1)", page: 1 },
    { entity: "Prepayments", criteria: "(Prepayment_Request:equals:r1)", page: 2 }
  ]);
  assert.match(nodes["prepayments-content"].innerHTML, /&lt;Request&gt;/);
  assert.match(nodes["prepayments-summary"].innerHTML, /€200\.00/);
  assert.match(nodes["prepayments-summary"].innerHTML, /US\$5\.00/);
  await context.ensurePrepaymentsLoaded({}, state);
  assert.equal(calls.length, 3);
});

test("late responses from a previous booking cannot replace the current booking", async () => {
  let finishOld;
  const { context, nodes } = harness(async (entity, criteria) => {
    if (criteria === "(Booking:equals:old)") return new Promise(resolve => { finishOld = resolve; });
    return [{ id: "new-request", Name: "Current booking" }];
  });
  const state = { selectedBookingId: "old" };
  const old = context.ensurePrepaymentsLoaded({}, state);
  state.selectedBookingId = "new";
  await context.ensurePrepaymentsLoaded({}, state);
  finishOld([]);
  await old;
  assert.equal(state.prepaymentsData.bookingId, "new");
  assert.match(nodes["prepayments-content"].innerHTML, /Current booking/);
  state.selectedBookingId = "";
  context.renderPrepayments({}, state);
  assert.doesNotMatch(nodes["prepayments-content"].innerHTML, /Current booking/);
});

test("failed loads show the error, hide partial totals and can be retried", async () => {
  let fail = true;
  const { context, nodes } = harness(async entity => {
    if (entity === "Prepayment_Requests") return [{ id: "r1", Name: "Request" }];
    if (fail) throw new Error("Permission denied");
    return [];
  });
  const state = { selectedBookingId: "b1" };
  await context.ensurePrepaymentsLoaded({}, state);
  assert.match(nodes["prepayments-content"].innerHTML, /Permission denied/);
  assert.equal(nodes["prepayments-summary"].innerHTML, "");
  fail = false;
  await context.ensurePrepaymentsLoaded({}, state);
  assert.match(nodes["prepayments-content"].innerHTML, /No prepayments registered/);
});

test("cancelled prepayments are excluded from pending and recorded totals", async () => {
  const { context, nodes } = harness(async () => []);
  const state = { selectedBookingId: "b1", prepaymentsData: { bookingId: "b1", requests: [], payments: [{ Amount: 999, Accounting_Status: "Cancelled", Currency: "EUR" }] } };
  context.renderPrepayments({}, state);
  assert.doesNotMatch(nodes["prepayments-summary"].innerHTML, /999/);
});

test("CRM search passes pagination in the SDK request configuration", async () => {
  let request;
  const context = vm.createContext({
    ZOHO: { CRM: { API: { searchRecord: async config => { request = config; return { data: [] }; } } } },
    extractRecords: response => response.data
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/js/api.js"), "utf8").replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, ""), context);
  await context.crmSearchRecord("Prepayments", "(Prepayment_Request:equals:r1)", 3, 200);
  assert.equal(request.page, 3);
  assert.equal(request.per_page, 200);
});

test("service context is read-only and supplies the request payload automatically", async () => {
  const { context } = harness(async () => []);
  const popups = [];
  context.showFeedback = (message, kind) => popups.push({ message, kind });
  const controls = {};
  const node = () => ({ value: "", files: [], addEventListener(event, handler) { this[event] = handler; }, focus() {}, appendChild() {} });
  const form = { elements: { namedItem: name => controls[name] ||= node() }, querySelector: () => node(), reportValidity: () => true,
    addEventListener: (event, handler) => { if (event === "submit") form.submit = handler; } };
  const buttons = {};
  const fileList = { querySelector: () => null };
  const proformaContainer = { dataset: { attachment: "proforma" }, querySelector: selector => selector === "[data-file-list]" ? fileList : node() };
  context.uploadFile = async file => file ? [{ File_Id__s: "uploaded-proforma" }] : null;
  const dialog = { isConnected: true, querySelector: selector => selector === "form" ? form : (buttons[selector] ||= node()), querySelectorAll: selector => selector === "[data-attachment]" ? [proformaContainer] : [], addEventListener() {}, remove() { this.isConnected = false; } };
  context.document.createElement = tag => tag === "div" ? dialog : { innerHTML: "", querySelector: () => node(), querySelectorAll: () => [], remove() {} };
  context.document.body = { appendChild() {} };
  const saved = [];
  context.crmCreateRecord = async (entity, payload) => { saved.push({ entity, payload }); return { details: { id: "created" } }; };
  const state = { currentUserIsAdministrator: true, currentUserRelationshipProfile: "Administrator", currentUserEmail: "admin@example.com", selectedBookingId: "b1",
    services: [{ id: "service2", Supplier: { id: "s1" }, Product_Description: "Second service", Total_Purchase_Price: 75 }, { id: "foreign", Supplier: { id: "s2" }, Product_Description: "Different supplier" }],
    selectedBooking: { MFSP_Reference: "MFSP-123", Deal_Name: "Booking <one>" },
    prepaymentsData: { bookingId: "b1", loaded: true, requests: [
      { id: "matching", Name: "Matching request", Supplier: { id: "s1" } },
      { id: "other", Name: "Other supplier request", Supplier: { id: "s2" } }
    ] } };
  await context.openPrepaymentForm({}, state, null, { id: "service1", Supplier: { id: "s1", name: "Supplier one" },
    Ezus_Supplier_Reference: "project-supnew-456", Product_Description: "Walking tour", Service_Date: "2026-09-20T10:00:00" });
  for (const value of ["MFSP-123", "Booking &lt;one&gt;", "Supplier one", "456", "Walking tour", "2026-09-20", "admin@example.com"]) {
    assert.ok((dialog.innerHTML + buttons["[data-service-options]"].innerHTML).includes(value), value);
  }
  assert.doesNotMatch(dialog.innerHTML, /name="(?:supplier|supplierCode|reference|requestedBy)"/);
  assert.match(buttons["[data-service-options]"].innerHTML, /data-prepayment-service="service1" checked/);
  assert.match(buttons["[data-service-options]"].innerHTML, /Second service/);
  assert.doesNotMatch(buttons["[data-service-options]"].innerHTML, /Different supplier/);
  buttons["[data-service-options]"].change({ target: { dataset: { prepaymentService: "service2" }, checked: true } });
  assert.match(buttons["[data-services-summary]"].textContent, /2 selected/);
  buttons["[data-service-options]"].change({ target: { dataset: { prepaymentService: "service2" }, checked: false } });
  assert.match(buttons["[data-services-summary]"].textContent, /1 selected/);
  assert.match(controls.request.innerHTML, /Matching request/);
  assert.doesNotMatch(controls.request.innerHTML, /Other supplier request/);
  Object.assign(controls, Object.fromEntries(["proof", "currency", "transactionType", "observations", "amount", "timing", "dueDate", "status", "accounted", "percent", "paymentDate"].map(name => [name, node()])));
  form.elements.namedItem("amount1").value = "50";
  controls.transactionType.value = "Partial Payment";
  controls.requestAmount.value = "125";
  controls.distribution.value = "Manual";
  buttons["[data-add-payment]"].click();
  form.elements.namedItem("amount2").value = "75";
  let failSecond = true;
  context.crmCreateRecord = async (entity, payload) => {
    if (entity === "Prepayments" && payload.Amount === 75 && failSecond) throw new Error("Temporary error");
    saved.push({ entity, payload });
    return { details: { id: "created" } };
  };
  const originalTimeCheck = context.isPrepaymentTimeRestricted;
  context.isPrepaymentTimeRestricted = () => true;
  await form.submit({ preventDefault() {} });
  assert.equal(saved.length, 0, "cutoff blocks all CRM writes");
  assert.match(popups.at(-1).message, /14:00/);
  context.isPrepaymentTimeRestricted = originalTimeCheck;
  controls.transactionType.value = "Full Payment";
  const originalValidity = form.reportValidity;
  form.reportValidity = () => { throw new Error("Full payment row count must be checked before required fields"); };
  await form.submit({ preventDefault() {} });
  assert.equal(saved.length, 0, "full payment blocks multiple lines");
  assert.match(buttons["[data-feedback]"].textContent, /Full Payment requires a single prepayment/);
  assert.match(dialog.innerHTML, /<form hidden novalidate>/);
  assert.match(dialog.innerHTML, /<strong>ATENCIÓN<\/strong>/);
  assert.match(dialog.innerHTML, /<strong>urgencia<\/strong>/);
  form.reportValidity = originalValidity;
  controls.transactionType.value = "Partial Payment";
  controls.requestAmount.value = "126";
  await form.submit({ preventDefault() {} });
  assert.equal(saved.length, 0, "partial payments must match the request total");
  controls.requestAmount.value = "125";
  await form.submit({ preventDefault() {} });
  assert.equal(saved.length, 0, "missing proforma prevents CRM writes");
  assert.match(buttons["[data-feedback]"].textContent, /Attach at least one Proforma/);
  controls.proforma.files = [{ name: "proforma.pdf" }];
  controls.proforma.change();
  let confirmProforma = false;
  const attachmentUpdates = [];
  const serviceUpdate = context.crmUpdateRecord;
  const serviceRead = context.crmGetRecord;
  context.crmUpdateRecord = async (entity, payload) => { if (entity === "Booking_Services") return serviceUpdate(entity, payload); attachmentUpdates.push({ entity, payload }); return { code: "SUCCESS" }; };
  context.crmGetRecord = async (entity, id) => entity === "Booking_Services" ? serviceRead(entity, id) : ({ Proforma_Attached: confirmProforma ? [{ file_Id: "uploaded-proforma" }] : [] });
  await form.submit({ preventDefault() {} });
  assert.equal(saved.length, 1, "unconfirmed attachment blocks all prepayments");
  assert.equal(dialog.isConnected, true, "attachment failure keeps the form open");
  assert.match(popups.at(-1).message, /Proforma attachment could not be confirmed/);
  assert.equal(popups.at(-1).kind, "error");
  confirmProforma = true;
  await form.submit({ preventDefault() {} });
  assert.equal(saved.length, 2);
  assert.match(popups.at(-1).message, /Temporary error/);
  assert.equal(popups.at(-1).kind, "error");
  failSecond = false;
  await form.submit({ preventDefault() {} });
  assert.equal(saved.length, 3, "retry creates only the remaining prepayment");
  assert.equal(dialog.isConnected, false, "successful save closes the form");
  assert.equal(saved[2].payload.Amount, 75);
  assert.equal(saved[1].payload.Name, "PREPAY-MFSP-123-456-1");
  assert.equal(saved[2].payload.Name, "PREPAY-MFSP-123-456-2");
  assert.equal(Object.hasOwn(saved[0].payload, "Proforma_Attached"), false);
  assert.equal(attachmentUpdates[0].entity, "Prepayment_Requests");
  assert.equal(attachmentUpdates[0].payload.id, "created");
  assert.equal(attachmentUpdates[0].payload.Proforma_Attached[0].$file_id, "uploaded-proforma");
  assert.equal(Object.hasOwn(saved[0].payload, "Invoice_Attached"), false);
  assert.doesNotMatch(dialog.innerHTML, /name="invoice"|data-attachment="invoice"/);
  assert.match(dialog.innerHTML, /prepayment-request-documents/);
  assert.equal(saved[0].payload.Amount, 125);
  assert.match(saved[0].payload.Requested_Date, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/);
  assert.ok(Math.abs(Date.now() - Date.parse(saved[0].payload.Requested_Date)) < 5000, "requested date preserves the current instant");
  assert.equal(saved[0].payload.Currency, "EUR");
  assert.equal(saved[0].payload.Status, "To Be Paid");
  assert.equal(saved[1].payload.Currency, "EUR");
  assert.equal(saved[1].payload.Percent, 40);
  assert.equal(saved[2].payload.Percent, 60);
  assert.doesNotMatch(dialog.innerHTML, /name="currency"/);
  assert.equal(saved[0].payload.Name, "PREPAY-REQ-MFSP-123-456");
  assert.equal(saved[0].payload.Supplier.id, "s1");
  assert.equal(saved[0].payload.MFSP_Reference, "MFSP-123");
  assert.equal(saved[0].payload.Supplier_Code, "456");
  assert.equal(saved[0].payload.Requested_By_2, "admin@example.com");
  assert.equal(saved[1].payload.Accounting_Status, "Pending invoice");
  assert.ok(!("Status" in saved[1].payload));
  assert.ok(!("Payment_Proof" in saved[1].payload));
  assert.ok(!("Accounted" in saved[1].payload));
  assert.doesNotMatch(dialog.innerHTML, /Saving creates real CRM records|name="(?:status|proof|accounted|paymentDate)"/);
});

test("bulk selection starts checked, sums service prices and associates both services to the request", async () => {
  const { context } = harness(async () => []);
  const controls = {}, nodes = {}, saved = [];
  const node = () => ({ value: "", files: [], addEventListener(event, handler) { this[event] = handler; }, setCustomValidity() {}, focus() {}, appendChild() {} });
  const form = { elements: { namedItem: name => controls[name] ||= node() }, querySelector: () => node(), reportValidity: () => true,
    addEventListener(event, handler) { if (event === "submit") this.submit = handler; } };
  const fileList = { querySelector: () => null };
  const proformaContainer = { dataset: { attachment: "proforma" }, querySelector: selector => selector === "[data-file-list]" ? fileList : node() };
  context.uploadFile = async file => file ? [{ File_Id__s: "uploaded-proforma" }] : null;
  const dialog = { isConnected: true, querySelector: selector => selector === "form" ? form : (nodes[selector] ||= node()), querySelectorAll: selector => selector === "[data-attachment]" ? [proformaContainer] : [], addEventListener() {}, remove() { this.isConnected = false; } };
  const rowNodes = [];
  context.document.createElement = tag => {
    if (tag === "div") return dialog;
    const remove = node();
    const row = { querySelector: () => remove, querySelectorAll: () => [], remove() {}, removeButton: remove };
    rowNodes.push(row);
    return row;
  };
  context.document.body = { appendChild() {} };
  context.crmCreateRecord = async (entity, payload) => { saved.push({ entity, payload }); return { details: { id: "created" } }; };
  await context.openPrepaymentForm({}, { currentUserIsAdministrator: true, currentUserRelationshipProfile: "Administrator", selectedBookingId: "b1",
    prepaymentsData: { bookingId: "b1", loaded: true, requests: [], payments: [] } }, null, [{ id: "service1", Supplier: { id: "s1" }, Service_Date: "2026-09-20", Total_Purchase_Price: "500" }, { id: "service2", Supplier: { id: "s1" }, Service_Date: "2026-09-25", Total_Purchase_Price: "375.25" }]);
  assert.match(nodes["[data-service-options]"].innerHTML, /data-prepayment-service="service1" checked/);
  assert.match(nodes["[data-service-options]"].innerHTML, /data-prepayment-service="service2" checked/);
  assert.equal(nodes["[data-request-selector]"].hidden, true);
  assert.equal(controls.requestAmount.value, "875.25");
  controls.timing1.value = "10 days prior to service date";
  controls.referenceService1.value = "service2";
  controls.referenceService1.change();
  assert.equal(controls.dueDate1.value, "2026-09-15");
  assert.equal(controls.amount1.value, "875.25");
  assert.equal(controls.percent1.value, "100.00");
  assert.equal(controls.transactionType.value, "Full Payment");
  controls.requestAmount.value = "123.45";
  controls.transactionType.change();
  assert.equal(nodes["[data-add-payment]"].hidden, true);
  assert.equal(controls.amount1.value, "123.45");
  assert.equal(controls.amount1.readOnly, true);
  controls.requestAmount.value = "200.50";
  controls.requestAmount.input();
  assert.equal(controls.amount1.value, "200.50");
  controls.distribution.value = "Manual";
  controls.transactionType.value = "Partial Payment";
  controls.transactionType.change();
  assert.equal(nodes["[data-add-payment]"].hidden, false);
  assert.equal(controls.percent1.readOnly, false);
  controls.requestAmount.value = "1000";
  controls.requestAmount.input();
  assert.equal(controls.amount1.value, "1000.00", "unedited first line follows total at 100 percent");
  assert.equal(controls.percent1.value, "100.00");
  controls.percent1.value = "25";
  controls.percent1.input();
  assert.equal(controls.amount1.value, "250.00");
  assert.equal(controls.percent1.value, "25");
  controls.amount1.value = "400";
  controls.amount1.input();
  assert.equal(controls.percent1.value, "40.00");
  controls.requestAmount.value = "2000";
  controls.requestAmount.input();
  assert.equal(controls.amount1.value, "400", "total changes preserve a manually entered amount");
  assert.equal(controls.percent1.value, "20.00");
  controls.percent1.value = "33.33";
  controls.percent1.input();
  assert.equal(controls.amount1.value, "666.60");
  controls.requestAmount.value = "100";
  controls.distribution.value = "Equal";
  controls.distribution.change();
  assert.equal(controls.amount1.readOnly, true);
  assert.equal(controls.percent1.readOnly, true);
  nodes["[data-add-payment]"].click();
  nodes["[data-add-payment]"].click();
  assert.deepEqual([controls.amount1.value, controls.amount2.value, controls.amount3.value], ["33.34", "33.33", "33.33"]);
  controls.requestAmount.value = "100.01";
  controls.requestAmount.input();
  assert.deepEqual([controls.amount1.value, controls.amount2.value, controls.amount3.value], ["33.34", "33.34", "33.33"]);
  rowNodes[2].removeButton.click();
  assert.deepEqual([controls.amount1.value, controls.amount2.value], ["50.01", "50.00"]);
  controls.distribution.value = "Manual";
  controls.distribution.change();
  assert.equal(controls.amount1.readOnly, false);
  assert.equal(controls.amount1.value, "50.01", "switching to manual preserves the distribution");
  controls.distribution.value = "Equal";
  controls.distribution.change();
  rowNodes[1].removeButton.click();
  assert.equal(controls.amount1.value, "100.01");
  controls.requestAmount.value = "200.50";
  controls.transactionType.value = "Full Payment";
  controls.transactionType.change();
  controls.proforma.files = [{ name: "proforma.pdf" }];
  controls.proforma.change();
  await form.submit({ preventDefault() {} });
  assert.equal(saved.length, 2);
  assert.equal(saved[0].payload.Amount, 200.5);
  assert.equal(saved[1].payload.Amount, 200.5);
  assert.equal(saved[1].payload.Percent, 100);
  assert.equal(saved[1].payload.Currency, "EUR");
  for (const id of ["service1", "service2"]) {
    const record = await context.crmGetRecord("Booking_Services", id);
    assert.equal(record.Prepayment_Request.id, "created");
    assert.equal(record.Payment_Status, "Prepayment Requested");
  }
});


test("prepayment cutoff uses Madrid time and only exempts the two User Relationships profiles", () => {
  const { context } = harness(async () => []);
  const restricted = (profile, date) => context.isPrepaymentTimeRestricted({ currentUserRelationshipProfile: profile }, new Date(date));
  assert.equal(restricted("Reservations", "2026-09-11T11:59:59Z"), false);
  assert.equal(restricted("Reservations", "2026-09-11T12:00:00Z"), true);
  assert.equal(restricted("Reservations", "2026-01-11T12:59:59Z"), false);
  assert.equal(restricted("Reservations", "2026-01-11T13:00:00Z"), true);
  assert.equal(restricted("Administrator", "2026-09-11T15:00:00Z"), false);
  assert.equal(restricted("Finance Administrator", "2026-09-11T15:00:00Z"), false);
  assert.equal(context.isPrepaymentTimeRestricted({ currentUserIsAdministrator: true }, new Date("2026-09-11T15:00:00Z")), true);
});

test("CRM create errors retain the field and code from resolved and rejected responses", async () => {
  const failure = { data: [{ code: "INVALID_DATA", status: "error", message: "invalid data", details: { api_name: "Requested_Date", expected_data_type: "datetime" } }] };
  const context = vm.createContext({
    ZOHO: { CRM: { API: { insertRecord: async () => failure } } },
    extractRecords: response => response.data || []
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/js/api.js"), "utf8").replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, ""), context);
  await assert.rejects(context.crmCreateRecord("Prepayment_Requests", {}), /Prepayment_Requests: invalid data \[INVALID_DATA\] Field: Requested_Date. Expected type: datetime/);
  context.ZOHO.CRM.API.insertRecord = async () => { throw { responseText: JSON.stringify(failure) }; };
  await assert.rejects(context.crmCreateRecord("Prepayment_Requests", {}), /Field: Requested_Date/);
  context.ZOHO.CRM.API.insertRecord = async () => ({ code: "NO_PERMISSION", message: "Permission denied", status: "error" });
  await assert.rejects(context.crmCreateRecord("Prepayment_Requests", {}), /Permission denied \[NO_PERMISSION\]/);
});


test("accounting statuses drive CRM table labels and pending and recorded totals", () => {
  const { context, nodes } = harness(async () => []);
  const state = { selectedBookingId: "b1", prepaymentsData: { bookingId: "b1", requests: [{ id: "r1", Name: "Request" }], payments: [
    { Accounting_Status: "Pending invoice", Amount: 10 },
    { Accounting_Status: "Pending payment record", Amount: 20 },
    { Accounting_Status: "Prepayment recorded", Amount: 40 },
    { Accounting_Status: "Cancelled", Amount: 999 }
  ].map(payment => ({ ...payment, Currency: "EUR", Prepayment_Request: { id: "r1" } })) } };
  context.renderPrepayments({}, state);
  assert.match(nodes["prepayments-summary"].innerHTML, /Pending <strong>[^<]*30\.00/);
  assert.match(nodes["prepayments-summary"].innerHTML, /Recorded <strong>[^<]*40\.00/);
  assert.doesNotMatch(nodes["prepayments-summary"].innerHTML, /999/);
  assert.match(nodes["prepayments-content"].innerHTML, /<th>Accounting Status<\/th>/);
  for (const payment of state.prepaymentsData.payments) assert.ok(nodes["prepayments-content"].innerHTML.includes(payment.Accounting_Status));
});
