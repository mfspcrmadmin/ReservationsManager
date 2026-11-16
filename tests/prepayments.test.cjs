const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { test } = require("node:test");

function harness(search) {
  const serviceRecords = new Map(), relationshipRecords = new Map();
  const recoveryRecords = new Map(), recoveryStorage = new Map();
  const createRelationship = async payload => {
    const id = 'link-' + payload.Prepayment_Request.id + '-' + payload.Booking_Service.id;
    relationshipRecords.set(id, {id, ...payload});
    return { details: { id } };
  };
  const nodes = Object.fromEntries(["prepayments-content", "prepayments-summary", "refresh-prepayments", "prepayments-count"].map(id => [id, { innerHTML: "", disabled: false, classList: { toggle() {} }, setAttribute(key, value) { this[key] = value; } }]));
  const context = vm.createContext({
    window: { sessionStorage: { getItem: key => recoveryStorage.get(key), setItem: (key, value) => recoveryStorage.set(key, value), removeItem: key => recoveryStorage.delete(key) } },
    recoveryRecords, serviceRecords,
    setTimeout: resolve => resolve(),
    showFeedback: () => {},
    syncServiceStatusDropdown: () => undefined,
    requirePaymentSettlement: async () => "settlement1",
    Intl, Map, document: { getElementById: id => nodes[id] },
    MODULES: { prepaymentRequestServices: "Prepayment_Request_Services", prepaymentRequests: "Prepayment_Requests", prepayments: "Prepayments", bookingServices: "Booking_Services" },
    relationshipRecords, createRelationship,
    crmGetFields: async () => [{api_name:'Payment_Status', pick_list_values:['Prepayment Requested', 'Partially Paid', 'Fully Paid'].map(actual_value => ({actual_value}))}],
    crmCreateRecord: async (entity, payload) => createRelationship(payload),
    crmSearchRecord: async (entity, criteria, page, perPage) => entity === 'Prepayment_Request_Services' ? [...relationshipRecords.values()].filter(record => [...criteria.matchAll(/\((\w+):equals:([^()]+)\)/g)].every(([, key, value]) => record[key]?.id === value)) : search(entity, criteria, page, perPage),
    crmUpdateRecord: async (entity, payload) => { if (entity === "Booking_Services") serviceRecords.set(payload.id, { ...serviceRecords.get(payload.id), ...payload }); return { code: "SUCCESS" }; },
    crmGetRecord: async (entity, id) => entity === 'Vendors' ? { TP_Reference: 'SUP-123' } : entity === "Prepayment_Request_Services" ? relationshipRecords.get(id) : entity === "Booking_Services" ? { id, Booking: { id: "b1" }, Supplier: { id: "s1" }, ...serviceRecords.get(id) } : { ...recoveryRecords.get(entity + ':' + id), Proforma_Attached: [{ file_Id: "uploaded-proforma" }] },
    escapeCriteriaValue: String,
    formatDate: value => value || "-", formatDateTime: value => value || "-",
    escapeHtml: value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
    getLookupName: value => value?.name || ""
  });
  require('./helpers/widget-permissions.cjs').load(context);
  context.requestCrmAttachmentsV8 = (module, id, field, changes) => changes === undefined
    ? context.crmGetRecord(module, id) : context.crmUpdateRecord(module, { id, [field]: changes });
  vm.runInContext(fs.readFileSync(require.resolve('../app/js/prepayment-creation.js'), 'utf8').replace(/^export /gm, ''), context);
  const runRecovery = context.runPrepaymentCreation;
  context.runPrepaymentCreation = (state, operation, dependencies) => runRecovery(state, operation, { ...dependencies, create: async (module, payload) => {
    const result = await dependencies.create(module, payload);
    const id = result.details?.id || result.id;
    if (id) recoveryRecords.set(module + ':' + id, { id, ...payload });
    return result;
  } });
  vm.runInContext(fs.readFileSync(require.resolve('../app/js/supplier-payment-reference.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''), context);
  const supplierHelper = fs.readFileSync(path.join(__dirname, "../app/js/utils.js"), "utf8").match(/export function getServiceSupplierName\(service\) \{[\s\S]*?\n\}/)[0].replace(/^export /, "");
  vm.runInContext(supplierHelper, context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/js/prepayments-controller.js"), "utf8").replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, ""), context);
  context.prepaymentToday = () => "2026-09-01";
  return { context, nodes };
}

test('single and bulk prepayments require the supplier Connection Reference before opening', async () => {
  for (const bulk of [false, true]) {
    for (const reference of [undefined, null, '', '   ']) {
      const { context } = harness(() => assert.fail('Must not load requests'));
      const messages = [];
      context.showFeedback = message => messages.push(message);
      context.crmGetRecord = async (module, id) => {
        assert.equal(module, 'Vendors');
        assert.equal(id, 's1');
        return { TP_Reference: reference, Ezus_Supplier_API: 'legacy' };
      };
      context.document.createElement = () => assert.fail('Must not open the form');
      const service = { id: 'service1', Supplier: { id: 's1' }, Ezus_Supplier_Reference: 'legacy', Supplier_Code: 'legacy' };
      await context.openPrepaymentForm({}, { selectedBookingId: 'b1' }, null, bulk ? [service, { ...service, id: 'service2' }] : service);
      assert.equal(messages.length, 1);
      assert.match(messages[0], /no Connection Reference.*Complete this field/);
    }
  }
});

test('invoice documents save to Invoice_Attached and retain every uploaded file', async () => {
  const {context} = harness(() => []);
  const writes = [];
  context.crmUpdateRecord = async (module,payload) => { writes.push(payload); return {code:'SUCCESS'}; };
  context.crmGetRecord = async () => ({Invoice_Attached:[{file_Id:'a'},{file_Id:'b'}]});
  const files = await context.savePrepaymentProforma('request1',[{File_Id__s:'a'},{File_Id__s:'b'}],'Invoice_Attached');
  assert.equal(files.length,2);
  assert.ok(writes[0].Invoice_Attached);
  assert.equal(writes[0].Proforma_Attached,undefined);
});

test('document confirmation retries stale reads without repeating the write', async () => {
  const { context } = harness(() => []);
  let reads = 0, writes = 0;
  context.crmUpdateRecord = async () => { writes++; return { code: 'SUCCESS' }; };
  context.crmGetRecord = async () => ({ Proforma_Attached: ++reads < 3 ? [] : [{ File_Id: 'uploaded' }] });
  const saved = await context.savePrepaymentProforma('request1', [{ File_Id__s: 'uploaded' }]);
  assert.equal(saved.length, 1);
  assert.equal(reads, 3);
  assert.equal(writes, 1);
});

test('document permission rejection is surfaced and permits a corrected retry', async () => {
  const { context } = harness(() => []);
  const documents = [{ File_Id__s: 'uploaded' }];
  context.crmUpdateRecord = async () => ({ code: 'NO_PERMISSION', status: 'error', message: 'Permission denied' });
  context.crmGetRecord = async () => ({ Proforma_Attached: [] });
  await assert.rejects(context.savePrepaymentProforma('request1', documents), /Permission denied \[NO_PERMISSION\]/);
  assert.equal(documents.saveState.pending, undefined);
  context.crmUpdateRecord = async () => ({ code: 'SUCCESS' });
  context.crmGetRecord = async () => ({ Proforma_Attached: [{ file_Id: 'uploaded' }] });
  assert.equal((await context.savePrepaymentProforma('request1', documents)).length, 1);
});

test('an inaccessible document field blocks writes before attempting attachment changes', async () => {
  const { context } = harness(() => []);
  let writes = 0;
  const documents = [{ File_Id__s: 'uploaded' }];
  context.crmUpdateRecord = async () => { writes++; return { code: 'SUCCESS' }; };
  context.crmGetRecord = async () => ({ id: 'request1' });
  await assert.rejects(context.savePrepaymentProforma('request1', documents), /read access/);
  await assert.rejects(context.savePrepaymentProforma('request1', documents), /read access/);
  assert.equal(writes, 0);
});

test('creation retries verify a lost document response without repeating the attachment write', async () => {
  const { context } = harness(() => []);
  let writes = 0;
  context.crmUpdateRecord = async () => { writes++; throw Error('Lost response'); };
  context.crmGetRecord = async () => ({ Proforma_Attached: [{ file_Id: 'uploaded' }] });
  const documents = [{ File_Id__s: 'uploaded' }];
  await assert.rejects(context.savePrepaymentProforma('request1', documents), /Lost response/);
  const saved = await context.savePrepaymentProforma('request1', documents);
  assert.equal(saved.length, 1);
  assert.equal(writes, 1);
});

test('an unrelated attached document cannot confirm the requested upload', async () => {
  const { context } = harness(() => []);
  let writes = 0;
  context.crmUpdateRecord = async () => { writes++; return { code: 'SUCCESS' }; };
  context.crmGetRecord = async () => ({ Proforma_Attached: [{ file_Id: 'unrelated' }] });
  const documents = [{ File_Id__s: 'uploaded' }];
  await assert.rejects(context.savePrepaymentProforma('request1', documents), /did not confirm/);
  await assert.rejects(context.savePrepaymentProforma('request1', documents), /Close and reopen/);
  assert.equal(writes, 1);
});

test('paid and payment-linked rows disable editing while pending rows remain editable', () => {
  const { context, nodes } = harness(() => []);
  const payments = [
    { id: 'paid', Accounting_Status: 'Prepayment recorded' },
    { id: 'linked', Vendor_Payment: { id: 'payment1' } },
    { id: 'pending', Accounting_Status: 'Pending invoice' }
  ].map(payment => ({ ...payment, Prepayment_Request: { id: 'r1' } }));
  context.renderPrepayments({}, { selectedBookingId: 'b1', prepaymentsData: { bookingId: 'b1', loaded: true, requests: [{ id: 'r1' }], payments } });
  const html = nodes['prepayments-content'].innerHTML;
  for (const id of ['paid', 'linked']) assert.match(html, new RegExp('data-prepayment-edit="' + id + '"[^>]* disabled'));
  assert.doesNotMatch(html, /data-prepayment-edit="pending"[^>]* disabled/);
});

test('prepayment invoice detail reads all associations without falling back to the legacy lookup', async () => {
  const {context} = harness((module) => {
    assert.equal(module,'Prepayment_Invoice_Allocations');
    return [
      {id:'l1',Prepayment:{id:'p'},Vendor_Invoice:{id:'a'},Allocated_Amount:100,Currency:'EUR'},
      {id:'l2',Prepayment:{id:'p'},Vendor_Invoice:{id:'b'},Allocated_Amount:200,Currency:'EUR'}
    ];
  });
  context.MODULES.prepaymentInvoiceAllocations = 'Prepayment_Invoice_Allocations';
  const result = await context.loadPrepaymentInvoices({id:'p',Amount:300,Currency:'EUR',Vendor_Invoice:{id:'stale'}});
  assert.equal(result.rows.length,2);
  assert.equal(result.remaining,0);
  assert.equal(result.total,300);
  await assert.rejects(context.loadPrepaymentInvoices({id:'p',Amount:200,Currency:'EUR'}),/exceed/);
});

test("missing supplier opens a blocking popup for single and bulk prepayments without API calls", async () => {
  for (const supplier of [null, {}, { name: "Supplier name only" }, { id: "   " }]) {
    for (const bulk of [false, true]) {
      const { context } = harness(() => assert.fail("Must not load requests"));
      let popup, focused = false, removed = false;
      const button = {};
      const events = {};
      context.document = {
        getElementById: () => null,
        activeElement: { focus() { focused = true; } },
        createElement: () => ({
          setAttribute() {}, querySelector: () => button,
          addEventListener: (type, callback) => { events[type] = callback; },
          showModal() { popup = this; },
          close() { events.close(); }, remove() { removed = true; }
        }),
        body: { appendChild() {} }
      };
      context.crmCreateRecord = () => assert.fail("Must not create a prepayment or request");
      const service = { id: "missing", Name: "Airport transfer", Supplier: supplier };
      const selection = bulk ? [{ id: "valid", Supplier: { id: "supplier" } }, service] : service;
      await context.openPrepaymentForm({}, { selectedBookingId: "b1" }, null, selection);
      assert.equal(popup.id, "prepayment-supplier-required");
      assert.match(popup.innerHTML, /Airport transfer.*has no linked supplier/);
      assert.match(popup.innerHTML, /Assign a supplier/);
      button.onclick();
      assert.equal(removed, true);
      assert.equal(focused, true);
    }
  }
});

test("fresh CRM validation blocks a supplier removed after opening the form", async () => {
  const { context } = harness(async () => []);
  context.crmGetRecord = async () => ({ id: "service", Booking: { id: "b1" }, Supplier: null });
  context.crmCreateRecord = () => assert.fail("Must not create records");
  context.crmUpdateRecord = () => assert.fail("Must not update records");
  const services = [{ id: "service", Supplier: { id: "supplier" } }];
  await assert.rejects(context.readPrepaymentServices(services, "b1", "supplier"), { code: "MISSING_SUPPLIER" });
  await assert.rejects(context.linkPrepaymentServices(services, "b1", "supplier", "request"), { code: "MISSING_SUPPLIER" });
});

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
  await assert.rejects(context.uploadFile(null), /Attach a proforma or invoice/);
});

test("prepayment service selection rejects mixed suppliers and bookings but allows multiple requests", async () => {
  const context = harness(async () => []).context;
  const service = { id: "s1", Supplier: { id: "v1" }, Booking: { id: "b1" } };
  assert.doesNotThrow(() => context.validatePrepaymentServices([service, { ...service, id: "s2" }], "b1", "v1"));
  assert.throws(() => context.validatePrepaymentServices([], "b1", "v1"), /at least one/);
  assert.throws(() => context.validatePrepaymentServices([service, { ...service, Supplier: { id: "v2" } }], "b1", "v1"), /same supplier/);
  assert.throws(() => context.validatePrepaymentServices([{ ...service, Booking: { id: "b2" } }], "b1", "v1"), /same booking/);
  assert.doesNotThrow(() => context.validatePrepaymentServices([{ ...service, Prepayment_Request: { id: "other" } }], "b1", "v1", "r1"));
  assert.doesNotThrow(() => context.validatePrepaymentServices([{ ...service, Prepayment_Request: { id: "r1" } }], "b1", "v1", "r1"));
  const errors = [];
  context.showFeedback = message => errors.push(message);
  await context.openPrepaymentForm({}, { selectedBookingId: "b1" }, null, [service, { ...service, id: "s2", Supplier: { id: "v2" } }]);
  assert.match(errors[0], /same supplier/);
});

test("service associations survive partial failure without duplicates or legacy lookup writes", async () => {
  const { context } = harness(async () => []);
  const records = new Map([
    ["s1", { id: "s1", Booking: { id: "b1" }, Supplier: { id: "v1" }, Payment_Status: "To Be Paid" }],
    ["s2", { id: "s2", Booking: { id: "b1" }, Supplier: { id: "v1" }, Payment_Status: "Fully Paid" }]
  ]);
  const services = [...records.values()];
  const writes = [];
  let fail = true;
  context.crmGetRecord = async (entity, id) => entity === "Prepayment_Request_Services" ? context.relationshipRecords.get(id) : records.get(id);
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
  records.get("s1").Payment_Status = "Paid";
  records.get("s2").Payment_Status = "Partially Paid";
  await context.linkPrepaymentServices(services, "b1", "v1", "r1", () => {});
  assert.deepEqual(writes.map(item => item.id), ["s1", "s2", "s1"]);
  assert.equal(records.get("s1").Payment_Status, "Partially Paid", "previous payment progress is retained");
  assert.equal(records.get("s2").Payment_Status, "Partially Paid");
  assert.equal(context.relationshipRecords.size, 2);
  await context.linkPrepaymentServices(services, "b1", "v1", "r2", () => {});
  assert.equal(context.relationshipRecords.size, 4, "a second request adds links instead of replacing them");
  assert.ok(writes.every(item => !Object.hasOwn(item, 'Prepayment_Request')));
});

test("unconfirmed payment status blocks continuation", async () => {
  const { context } = harness(async () => []);
  const service = { id: "s1", Booking: { id: "b1" }, Supplier: { id: "v1" }, Prepayment_Request: { id: "r1" }, Payment_Status: "To Be Paid" };
  context.crmGetRecord = async (entity, id) => entity === "Prepayment_Request_Services" ? context.relationshipRecords.get(id) : service;
  context.crmUpdateRecord = async () => ({ code: "SUCCESS" });
  let linked = false;
  await assert.rejects(context.linkPrepaymentServices([service], "b1", "v1", "r1", () => { linked = true; }), /did not confirm the service payment status/);
  assert.equal(linked, false);
});

test("Proforma saving uses the canonical v8 format and verifies every persisted file", async () => {
  const { context } = harness(async () => []);
  const writes = [];
  context.crmUpdateRecord = async (entity, payload) => {
    writes.push(payload);
    return { code: "SUCCESS" };
  };
  context.crmGetRecord = async () => ({ Proforma_Attached: [{ file_Id: "file-1" }] });
  const files = await context.savePrepaymentProforma("request-1", [{ File_Id__s: "file-1" }]);
  assert.equal(files[0].file_Id, "file-1");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].Proforma_Attached[0].File_Id__s, "file-1");
  const documents = [{ File_Id__s: "file-1" }, { File_Id__s: "file-2" }];
  await assert.rejects(context.savePrepaymentProforma("request-1", documents), /did not confirm/, "one persisted file is insufficient for two uploads");
  context.crmGetRecord = async () => ({ Proforma_Attached: [{ file_Id: "file-1" }, { file_Id: "file-2" }] });
  assert.equal((await context.savePrepaymentProforma("request-1", documents)).length, 2);
  assert.deepEqual(Array.from(writes.at(-1).Proforma_Attached, file => file.File_Id__s), ["file-1", "file-2"]);
  for (const missing of [null, [], {}, [{}]]) {
    context.crmGetRecord = async () => ({ Proforma_Attached: missing });
    await assert.rejects(context.savePrepaymentProforma("request-1", [{ File_Id__s: "file-1" }]), /did not confirm|unexpected document format/);
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
  assert.match(nodes["prepayments-summary"].innerHTML, /200,00\s*€/);
  assert.match(nodes["prepayments-summary"].innerHTML, /5,00\s*US\$/);
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
  const node = () => ({ value: "", files: [], addEventListener(event, handler) { this[event] = handler; }, focus() {}, setCustomValidity() {}, appendChild() {} });
  const form = { elements: { namedItem: name => controls[name] ||= node() }, querySelector: () => node(), reportValidity: () => true,
    addEventListener: (event, handler) => { if (event === "submit") form.submit = handler; } };
  const buttons = {};
  const fileList = { querySelector: () => null, addEventListener(event, handler) { this[event] = handler; } };
  const dropzone = node();
  const proformaContainer = { dataset: { attachment: "proforma" }, querySelector: selector => selector === "[data-file-list]" ? fileList : dropzone };
  const uploaded = [];
  context.uploadFile = async file => { uploaded.push(file.name); return [{ File_Id__s: "uploaded-" + file.name }]; };
  const dialog = { isConnected: true, querySelector: selector => selector === "form" ? form : (buttons[selector] ||= node()), querySelectorAll: selector => selector === "[data-attachment]" ? [proformaContainer] : [], addEventListener() {}, remove() { this.isConnected = false; } };
  context.document.createElement = tag => tag === "div" ? dialog : { innerHTML: "", querySelector: () => node(), querySelectorAll: () => [], remove() {} };
  context.document.body = { appendChild() {} };
  const saved = [];
  context.crmCreateRecord = async (entity, payload) => { if (entity === "Prepayment_Request_Services") return context.createRelationship(payload); saved.push({ entity, payload }); return { details: { id: "created" } }; };
  const state = { currentUserIsAdministrator: true, currentUserRelationshipProfile: "Reservations", currentUserEmail: "admin@example.com", selectedBookingId: "b1",
    services: [{ id: "service2", Supplier: { id: "s1" }, Product_Description: "Second service", Total_Purchase_Price: 75 }, { id: "foreign", Supplier: { id: "s2" }, Product_Description: "Different supplier" }],
    selectedBooking: { MFSP_Reference: "MFSP-123", Deal_Name: "Booking <one>" },
    prepaymentsData: { bookingId: "b1", loaded: true, requests: [
      { id: "matching", Name: "Matching request", Supplier: { id: "s1" } },
      { id: "other", Name: "Other supplier request", Supplier: { id: "s2" } }
    ] } };
  context.relationshipRecords.set('existing-link', {id:'existing-link', Prepayment_Request:{id:'matching'}, Booking_Service:{id:'service1'}});
  await context.openPrepaymentForm({}, state, null, { id: "service1", Supplier: { id: "s1", name: "Supplier one" },
    Ezus_Supplier_Reference: "project-supnew-456", Product_Description: "Walking tour", Service_Date: "2026-09-20T10:00:00" });
  for (const value of ["MFSP-123", "Booking &lt;one&gt;", "Supplier one", "SUP-123", "Walking tour", "2026-09-20", "admin@example.com"]) {
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
  assert.equal(controls.request.value, "", "a service can create a new request even when another is associated");
  assert.match(buttons["[data-service-options]"].innerHTML, /1 associated requests/);
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
    if (entity === "Prepayment_Request_Services") return context.createRelationship(payload);
    if (entity === "Prepayments" && payload.Amount === 75 && failSecond) throw new Error("Temporary error");
    saved.push({ entity, payload });
    return { details: { id: "created" } };
  };
  const originalTimeCheck = context.isPrepaymentTimeRestricted;
  controls.dueDate1.value = "2026-09-23";
  controls.dueDate2.value = "2026-09-22";
  context.isPrepaymentTimeRestricted = (state, dates) => originalTimeCheck(state, dates, new Date("2026-09-22T12:01:00Z"));
  await form.submit({ preventDefault() {} });
  assert.equal(saved.length, 0, "cutoff blocks all CRM writes");
  assert.match(popups.at(-1).message, /14:00/);
  context.isPrepaymentTimeRestricted = (state, dates) => originalTimeCheck(state, dates, new Date("2026-09-22T11:00:00Z"));
  controls.transactionType.value = "Full Payment";
  const originalValidity = form.reportValidity;
  form.reportValidity = () => { throw new Error("Full payment row count must be checked before required fields"); };
  await form.submit({ preventDefault() {} });
  assert.equal(saved.length, 0, "full payment blocks multiple lines");
  assert.match(buttons["[data-feedback]"].textContent, /Full Payment requires a single prepayment/);
  assert.match(dialog.innerHTML, /<form id="new-prepayment-form" hidden novalidate>/);
  form.reportValidity = originalValidity;
  controls.transactionType.value = "Partial Payment";
  controls.requestAmount.value = "126";
  await form.submit({ preventDefault() {} });
  assert.equal(saved.length, 0, "partial payments must match the request total");
  controls.requestAmount.value = "125";
  for (const weekend of ["2026-09-19", "2026-09-20"]) {
    controls.dueDate1.value = weekend;
    await form.submit({ preventDefault() {} });
    assert.equal(saved.length, 0, "weekend due dates block all CRM writes");
    assert.match(buttons["[data-feedback]"].textContent, /Monday to Friday/);
  }
  controls.dueDate1.value = "2026-09-21";
  await form.submit({ preventDefault() {} });
  assert.equal(saved.length, 0, "missing proforma prevents CRM writes");
  assert.match(buttons["[data-feedback]"].textContent, /Attach at least one proforma or invoice/);
  assert.match(dialog.innerHTML, /type="file" multiple/);
  controls.proforma.files = [{ name: "proforma.pdf" }, { name: "remove.pdf" }];
  controls.proforma.change();
  assert.match(fileList.innerHTML, /proforma.pdf/);
  assert.match(fileList.innerHTML, /remove.pdf/);
  fileList.click({ target: { closest: () => ({ dataset: { removeFile: "1" } }) } });
  assert.doesNotMatch(fileList.innerHTML, /remove.pdf/);
  controls.proforma.files = [{ name: "second.pdf" }];
  controls.proforma.change();
  dropzone.classList = { remove() {} };
  dropzone.drop({ preventDefault() {}, dataTransfer: { files: [{ name: "third.pdf" }, { name: "fourth.pdf" }] } });
  for (const name of ["proforma.pdf", "second.pdf", "third.pdf", "fourth.pdf"]) assert.ok(fileList.innerHTML.includes(name));
  let confirmProforma = false;
  const attachmentUpdates = [];
  const serviceUpdate = context.crmUpdateRecord;
  const serviceRead = context.crmGetRecord;
  context.crmUpdateRecord = async (entity, payload) => { if (entity === "Booking_Services") return serviceUpdate(entity, payload); attachmentUpdates.push({ entity, payload }); return { code: "SUCCESS" }; };
  context.crmGetRecord = async (entity, id) => ["Vendors", "Booking_Services", "Prepayment_Request_Services"].includes(entity) ? serviceRead(entity, id) : ({ ...await serviceRead(entity, id), Proforma_Attached: confirmProforma ? uploaded.map(name => ({ file_Id: "uploaded-" + name })) : [] });
  await form.submit({ preventDefault() {} });
  assert.equal(saved.length, 1, "unconfirmed attachment blocks all prepayments");
  assert.equal(dialog.isConnected, true, "attachment failure keeps the form open");
  assert.match(popups.at(-1).message, /Request: confirmed in CRM.*Documents: save unconfirmed.*Services confirmed: 0\/1.*Prepayments: 0\/2 recorded/);
  assert.equal(popups.at(-1).kind, "error");
  confirmProforma = true;
  const pending = context.pendingPrepaymentCreation(state, 'b1', 's1');
  await assert.rejects(context.executePrepaymentCreation(state, pending), /Temporary error/);
  assert.equal(saved.length, 2, 'request and first payment are confirmed');
  failSecond = false;
  await assert.rejects(context.executePrepaymentCreation(state, pending), /previous payment 1 creation could not be confirmed/);
  assert.equal(saved.length, 2, 'an uncertain payment creation must never be repeated');
  assert.equal(saved[1].payload.Name, "PREPAY-MFSP-123-SUP-123-1");
  assert.equal(Object.hasOwn(saved[0].payload, "Proforma_Attached"), false);
  assert.equal(attachmentUpdates[0].entity, "Prepayment_Requests");
  assert.equal(attachmentUpdates[0].payload.id, "created");
  assert.deepEqual(uploaded, ["proforma.pdf", "second.pdf", "third.pdf", "fourth.pdf"]);
  assert.deepEqual(Array.from(attachmentUpdates[0].payload.Proforma_Attached, file => file.File_Id__s), uploaded.map(name => "uploaded-" + name));
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
  assert.doesNotMatch(dialog.innerHTML, /name="currency"/);
  assert.equal(saved[0].payload.Name, "PREPAY-REQ-MFSP-123-SUP-123");
  assert.equal(saved[0].payload.Supplier.id, "s1");
  assert.equal(saved[0].payload.MFSP_Reference, "MFSP-123");
  assert.equal(saved[0].payload.Supplier_Code, "SUP-123");
  assert.equal(saved[0].payload.Requested_By_2, "admin@example.com");
  assert.equal(saved[1].payload.Accounting_Status, "Pending invoice");
  assert.ok(!("Status" in saved[1].payload));
  assert.ok(!("Payment_Proof" in saved[1].payload));
  assert.ok(!("Accounted" in saved[1].payload));
  assert.doesNotMatch(dialog.innerHTML, /Saving creates real CRM records|name="(?:status|proof|accounted|paymentDate)"/);
});

for (const profile of ["Administrator", "Finance Administrator"]) {
test(profile + " can edit Requested By while creating a bulk prepayment request", async () => {
  const { context } = harness(async () => []);
  context.serviceRecords.set('service1', { Service_Date: '2026-09-20' });
  context.serviceRecords.set('service2', { Service_Date: '2026-09-25' });
  const controls = {}, nodes = {}, saved = [];
  const node = () => ({ value: "", files: [], addEventListener(event, handler) { this[event] = handler; }, setCustomValidity() {}, focus() {}, setCustomValidity() {}, appendChild() {} });
  const form = { elements: { namedItem: name => controls[name] ||= node() }, querySelector: () => node(), reportValidity: () => true,
    addEventListener(event, handler) { if (event === "submit") this.submit = handler; } };
  const fileList = { querySelector: () => null, addEventListener(event, handler) { this[event] = handler; } };
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
  context.crmCreateRecord = async (entity, payload) => { if (entity === "Prepayment_Request_Services") return context.createRelationship(payload); saved.push({ entity, payload }); return { details: { id: "created" } }; };
  await context.openPrepaymentForm({}, { ...require("./helpers/widget-permissions.cjs").identity(profile, "admin", "admin@example.com"), currentUserIsAdministrator: true, currentUserRelationshipProfile: profile, selectedBookingId: "b1",
    prepaymentsData: { bookingId: "b1", loaded: true, requests: [], payments: [] } }, null, [{ id: "service1", Supplier: { id: "s1" }, Service_Date: "2026-09-20", Total_Purchase_Price: "500" }, { id: "service2", Supplier: { id: "s1" }, Service_Date: "2026-09-25", Total_Purchase_Price: "375.25" }]);
  assert.match(nodes["[data-service-options]"].innerHTML, /data-prepayment-service="service1" checked/);
  assert.match(nodes["[data-service-options]"].innerHTML, /data-prepayment-service="service2" checked/);
  assert.equal(nodes["[data-request-selector]"].hidden, false);
  assert.match(dialog.innerHTML, /name="requestedBy"/);
  assert.equal(controls.requestedBy.value, "admin@example.com");
  controls.requestedBy.value = "colleague@example.com";
  assert.equal(controls.requestAmount.value, "875.25");
  controls.timing1.value = "10 days prior to service date";
  controls.referenceService1.value = "service2";
  controls.referenceService1.change();
  assert.equal(controls.dueDate1.value, "2026-09-15");
  controls.timing1.value = "Specific Date";
  controls.timing1.change();
  for (const event of ["input", "change"]) {
    for (const weekend of ["2026-09-19", "2026-09-20"]) {
      controls.dueDate1.value = weekend;
      controls.dueDate1[event]();
      assert.equal(controls.dueDate1.value, "", "weekend selection is rejected immediately");
      // Manual weekends remain invalid; feedback now appears beside Due date.
    }
    controls.dueDate1.value = "2026-09-21";
    controls.dueDate1[event]();
    assert.equal(controls.dueDate1.value, "2026-09-21");
  }
  controls.timing1.value = "Within 1 day";
  controls.timing1.change();
  assert.equal(controls.dueDate1.value, "2026-09-25", "calculated Saturday moves to Friday");
  controls.timing1.value = "10 days prior to service date";
  controls.timing1.change();
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
  assert.equal(saved.length, 2, nodes["[data-feedback]"].textContent);
  assert.equal(saved[0].payload.Requested_By_2, "colleague@example.com");
  assert.equal(saved[0].payload.Amount, 200.5);
  assert.equal(saved[1].payload.Amount, 200.5);
  assert.equal(saved[1].payload.Percent, 100);
  assert.equal(saved[1].payload.Currency, "EUR");
  for (const id of ["service1", "service2"]) {
    const record = await context.crmGetRecord("Booking_Services", id);
    assert.equal(record.Prepayment_Request, undefined);
    const links = [...context.relationshipRecords.values()].filter(link => link.Booking_Service.id === id);
    assert.equal(links.length, 1);
    assert.equal(links[0].Prepayment_Request.id, "created");
    assert.equal(record.Payment_Status, "Prepayment Requested");
  }
});

}

test("prepayment cutoff uses Madrid time and exempts Administrator and Finance Administrator from User Relationships", () => {
  const { context } = harness(async () => []);
  const restricted = (profile, date, dueDates = [date.slice(0, 10)]) => context.isPrepaymentTimeRestricted({ ...require("./helpers/widget-permissions.cjs").identity(profile), currentUserRelationshipProfile: profile }, dueDates, new Date(date));
  assert.equal(restricted("Reservations", "2026-09-11T11:59:59Z"), false);
  assert.equal(restricted("Reservations", "2026-09-11T12:00:00Z"), true);
  assert.equal(restricted("Reservations", "2026-01-11T12:59:59Z"), false);
  assert.equal(restricted("Reservations", "2026-01-11T13:00:00Z"), true);
  assert.equal(restricted("Administrator", "2026-09-11T15:00:00Z"), false);
  assert.equal(restricted("Finance Administration", "2026-09-11T15:00:00Z"), true);
  assert.equal(restricted("Finance Administrator", "2026-09-11T12:00:00Z"), false);
  assert.equal(restricted("Finance Administrator", "2026-09-11T15:00:00Z", ["2026-09-14", "2026-09-11"]), false);
  assert.equal(restricted("  FINANCE   Administrator  ", "2026-01-11T13:00:00Z"), false);
  assert.equal(restricted("", "2026-09-11T15:00:00Z"), true);
  assert.equal(context.isPrepaymentTimeRestricted({ currentUserIsAdministrator: true }, ["2026-09-11"], new Date("2026-09-11T15:00:00Z")), true);
  assert.equal(restricted("Reservations", "2026-09-11T15:00:00Z", ["2026-09-14", "2026-09-15"]), false);
  assert.equal(restricted("Reservations", "2026-09-11T15:00:00Z", ["2026-09-14", "2026-09-11"]), true);
  assert.equal(restricted("Reservations", "2026-09-11T15:00:00Z", []), false);
  assert.equal(restricted("Reservations", "2026-09-11T22:30:00Z", ["2026-09-11"]), false, "Madrid is already on the next day before the cutoff");
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
  assert.match(nodes["prepayments-summary"].innerHTML, /Pending <strong>30,00\s*€/);
  assert.match(nodes["prepayments-summary"].innerHTML, /Paid <strong>40,00\s*€/);
  assert.doesNotMatch(nodes["prepayments-summary"].innerHTML, /999/);
  assert.match(nodes["prepayments-content"].innerHTML, /class="prepayment-status-heading">Accounting status /);
  for (const payment of state.prepaymentsData.payments) assert.ok(nodes["prepayments-content"].innerHTML.includes(payment.Accounting_Status));
});

test('prepayment table explains paid and unpaid statuses and totals both discard reasons as paid', () => {
  const { context, nodes } = harness(async () => []);
  const statuses = ['Prepayment recorded', 'Discard - Credit', 'Discard - Already Paid', 'Pending invoice', 'Pending payment record', 'Cancelled', ''];
  const payments = statuses.map((Accounting_Status, i) => ({ id: String(i), Accounting_Status, Amount: 10, Prepayment_Request: { id: 'r1' } }));
  context.renderPrepayments({}, { selectedBookingId: 'b1', prepaymentsData: { bookingId: 'b1', loaded: true, requests: [{ id: 'r1' }], payments } });
  const html = nodes['prepayments-content'].innerHTML;
  assert.match(html, /Accounting status legend/);
  assert.match(html, /<button type="button" class="prepayment-status-help"/);
  assert.match(html, /aria-haspopup="dialog" aria-expanded="false"/);
  assert.doesNotMatch(html, /role="tooltip"/);
  assert.equal((html.match(/prepayment-payment-meaning is-paid">Paid</g) || []).length, 3);
  assert.equal((html.match(/prepayment-payment-meaning is-to-pay">To pay</g) || []).length, 4);
  assert.match(nodes['prepayments-summary'].innerHTML, /Paid <strong>[^<]*30/);
  assert.match(nodes['prepayments-summary'].innerHTML, /Pending <strong>[^<]*30/);
});

test('request cards share columns, count payments and retain missing dates', () => {
  const { context, nodes } = harness(async () => []);
  const requests = [{ id: 'r1', Name: 'Long request reference', Supplier: { name: 'Quinta de Aveleda' }, Observations: 'Instructions '.repeat(40), Proforma_Attached: [{ file_Id: 'f1', File_Name__s: 'Proforma.pdf' }] }, { id: 'r2', Supplier: { name: 'Second supplier' } }];
  const payments = [{ id: 'p1', Prepayment_Request: { id: 'r1' }, Accounting_Status: 'Discard - Credit', Amount: 10 }, { id: 'p2', Prepayment_Request: { id: 'r2' }, Payment_Proof: [{ file_Id: 'f2', File_Name: 'Proof.pdf' }] }];
  context.renderPrepayments({}, { selectedBookingId: 'b1', prepaymentsData: { bookingId: 'b1', loaded: true, requests, payments } });
  const html = nodes['prepayments-content'].innerHTML;
  const groups = [...html.matchAll(/<colgroup>.*?<\/colgroup>/g)].map(match => match[0]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0], groups[1]);
  assert.equal(nodes['prepayments-count'].textContent, '2 payments');
  assert.match(html, /<h4>Quinta de Aveleda<\/h4>/);
  assert.match(html, /1 prepayment<\/span>/);
  assert.match(html, /Payment instructions/);
  assert.match(html, /Show more/);
  assert.match(html, /Proforma \/ invoices - Proforma.pdf/);
  assert.doesNotMatch(html, /View proof|View invoices|prepayment-col-(invoices|proof|accounted)/);
  assert.match(html, /prepayment-col-paidDate">—<\/td>/);
  assert.doesNotMatch(html, /Overdue|Due today/);
});

test('prepayment file preview reuses CRM getFile and reports access errors', async () => {
  let requested;
  const content = { innerHTML: '' };
  const context = vm.createContext({
    escapeHtml: String,
    window: { ZOHO: { CRM: { API: { getFile: async value => { requested = value.id; throw new Error('No access'); } } } } },
    document: { createElement: () => ({ querySelector: selector => selector === '.card-purchase-preview-content' ? content : { addEventListener() {} } }), body: { appendChild() {} } }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/js/payments-controller.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''), context);
  await context.previewPaymentAttachment({ file_Id: 'crm-file', File_Name__s: 'Proforma.pdf' });
  assert.equal(requested, 'crm-file');
  assert.match(content.innerHTML, /Check your access/);
});

test("association retries read the returned ID while search is not indexed", async () => {
  const {context} = harness(async () => []);
  context.crmSearchRecord = async () => [];
  const read = context.crmGetRecord;
  let fail = true, creations = 0;
  context.crmCreateRecord = async (_, payload) => { creations++; return context.createRelationship(payload); };
  context.crmGetRecord = async (module, id) => {
    if (module === 'Prepayment_Request_Services' && fail) throw Error('Read unavailable');
    return read(module, id);
  };
  const services = [{id:'service1', Supplier:{id:'s1'}, Booking:{id:'b1'}}];
  await assert.rejects(context.linkPrepaymentServices(services, 'b1', 's1', 'r1', () => {}), /Read unavailable/);
  fail = false;
  await context.linkPrepaymentServices(services, 'b1', 's1', 'r1', () => {});
  assert.equal(creations, 1);
});

test("uncertain association creation cannot create another record on retry", async () => {
  const {context} = harness(async () => []);
  let creations = 0;
  context.crmCreateRecord = async () => { creations++; throw Error('Connection lost'); };
  const services = [{id:'service1', Supplier:{id:'s1'}, Booking:{id:'b1'}}];
  await assert.rejects(context.linkPrepaymentServices(services, 'b1', 's1', 'r1', () => {}), /Connection lost/);
  await assert.rejects(context.linkPrepaymentServices(services, 'b1', 's1', 'r1', () => {}), /previous service association was not confirmed/);
  assert.equal(creations, 1);
});

test("unconfirmed relationship lookups do not update the service or continue to payments", async () => {
  const {context} = harness(async () => []), read = context.crmGetRecord;
  let updates = 0;
  context.crmGetRecord = async (module, id) => module === 'Prepayment_Request_Services' ? {id, Prepayment_Request:{id:'other'}, Booking_Service:{id:'service1'}} : read(module, id);
  context.crmUpdateRecord = async () => { updates++; return {code:'SUCCESS'}; };
  await assert.rejects(context.linkPrepaymentServices([{id:'service1', Supplier:{id:'s1'}}], 'b1', 's1', 'r1', () => {}), /did not confirm the service association/);
  assert.equal(updates, 0);
});


test("authorized requester edits on existing requests are validated and retried before creating prepayments", async () => {
  const { context } = harness(async () => []);
  const controls = {}, nodes = {}, writes = [], messages = [];
  const node = () => ({ value: "", files: [], addEventListener(e, fn) { this[e] = fn; }, focus() {}, setCustomValidity() {}, appendChild() {} });
  const form = { elements: { namedItem: name => controls[name] ||= node() }, querySelector: () => node(), reportValidity: () => true, addEventListener(e, fn) { this[e] = fn; } };
  const dialog = { isConnected: true, querySelector: s => s === "form" ? form : (nodes[s] ||= node()), querySelectorAll: () => [], addEventListener() {}, remove() {} };
  context.document.createElement = tag => tag === "div" ? dialog : { querySelector: () => node(), querySelectorAll: () => [], remove() {} };
  context.document.body = { appendChild() {} };
  context.showFeedback = message => messages.push(message);
  const parent = { id: "r1", Booking: { id: "b1" }, Supplier: { id: "s1" }, Amount: 100, Transaction_Type: "Partial Payment", Requested_By_2: "original@example.com" };
  context.recoveryRecords.set("Prepayment_Requests:r1", parent);
  const state = { ...require("./helpers/widget-permissions.cjs").identity("Finance Administrator", "finance", "finance@example.com"), currentUserRelationshipProfile: "Finance Administrator", selectedBookingId: "b1", prepaymentsData: { bookingId: "b1", loaded: true, requests: [parent], payments: [] } };
  await context.openPrepaymentForm({}, state, null, { id: "service1", Supplier: { id: "s1" }, Total_Purchase_Price: 100 });
  controls.request.value = "r1"; controls.request.change();
  assert.equal(controls.requestedBy.value, "original@example.com");
  controls.dueDate1.value = "2026-09-23";
  state.bookingTagRelationships[0].Status = "Inactive";
  await form.submit({ preventDefault() {} });
  assert.match(messages.at(-1), /permissions changed/);
  assert.equal(writes.length, 0);
  state.bookingTagRelationships[0].Status = "Active";
  controls.requestedBy.value = "invalid";
  await form.submit({ preventDefault() {} });
  assert.match(messages.at(-1), /valid email/);
  let fail = true;
  const originalUpdate = context.crmUpdateRecord;
  context.crmUpdateRecord = async (module, payload) => {
    if (module !== "Prepayment_Requests") return originalUpdate(module, payload);
    writes.push(payload);
    return { code: fail ? "ERROR" : "SUCCESS", message: "rejected requester edit" };
  };
  let created = 0;
  const originalCreate = context.crmCreateRecord;
  context.crmCreateRecord = async (module, payload) => {
    if (module !== "Prepayments") return originalCreate(module, payload);
    created++; return { details: { id: "p1" } };
  };
  controls.requestedBy.value = "new@example.com";
  const originalRead = context.crmGetRecord;
  context.crmGetRecord = async (module, id) => module === 'Prepayment_Requests' ? { Proforma_Attached: [] } : originalRead(module, id);
  await form.submit({ preventDefault() {} });
  assert.equal(created, 0);
  assert.equal(writes.length, 0, 'existing requests without Proforma Attached cannot save any changes');
  assert.match(messages.at(-1), /Proforma Attached requires at least one file/);
  context.crmGetRecord = originalRead;
  const pending = context.pendingPrepaymentCreation(state, 'b1', 's1');
  await assert.rejects(context.executePrepaymentCreation(state, pending), /rejected requester edit/);
  assert.equal(created, 0);
  fail = false;
  await context.executePrepaymentCreation(state, pending);
  assert.equal(created, 1);
  assert.equal(writes.length, 2);
  assert.equal(writes[1].id, "r1");
  assert.equal(writes[1].Requested_By_2, "new@example.com");
  assert.equal(state.prepaymentsData.requests[0].Requested_By_2, "new@example.com");
});

test('automatic due dates retain calendar offsets then roll Saturday and Sunday back to Friday', () => {
  const {context} = harness(async () => []);
  const calculate = context.prepaymentDateCalculation;
  for (const [timing, base, original, final] of [
    ['Within 1 day','2026-11-12','2026-11-13','2026-11-13'],
    ['Within 2 days','2026-11-12','2026-11-14','2026-11-13'],
    ['Within 3 days','2026-11-12','2026-11-15','2026-11-13'],
    ['10 days prior to service date','2026-11-25','2026-11-15','2026-11-13'],
    ['15 days prior to service date','2026-11-29','2026-11-14','2026-11-13'],
    ['20 days prior to service date','2026-12-05','2026-11-15','2026-11-13'],
    ['30 days prior to service date','2026-12-13','2026-11-13','2026-11-13'],
    ['Within 1 day','2026-10-31','2026-11-01','2026-10-30'],
    ['Within 1 day','2021-12-31','2022-01-01','2021-12-31'],
    ['Within 1 day','2028-02-28','2028-02-29','2028-02-29'],
    ['Within 1 day','2026-03-28','2026-03-29','2026-03-27']
  ]) {
    const result = calculate(timing,base);
    assert.equal(result.original,original); assert.equal(result.final,final);
    assert.equal(result.adjusted,original!==final);
    assert.equal(calculate(timing,base).final,final,'repeat calculation never offsets an adjusted value');
  }
  assert.equal(calculate('Specific Date','2026-11-15').final,null);
  assert.equal(calculate('Within 1 day','2026-02-30').final,'');
});

test('adjusted dates use Madrid cutoff and expose past-date conflicts without rolling forward', () => {
  const {context} = harness(async () => []);
  // Restore the real business-calendar helper; other form fixtures use a fixed business day.
  const source = fs.readFileSync(path.join(__dirname,'../app/js/prepayments-controller.js'),'utf8');
  vm.runInContext(source.match(/function prepaymentToday\(now = new Date\(\)\) \{[\s\S]*?\n\}/)[0],context);
  const state = {currentUserRelationshipProfile:'Reservations'};
  const final = context.prepaymentDateCalculation('Within 2 days','2026-11-12').final;
  assert.equal(final,'2026-11-13');
  assert.equal(context.prepaymentDateError(state,final,true,new Date('2026-11-13T12:59:00Z')),'');
  assert.match(context.prepaymentDateError(state,final,true,new Date('2026-11-13T13:00:00Z')),/14:00/);
  assert.match(context.prepaymentDateError(state,final,true,new Date('2026-11-14T10:00:00Z')),/past/);
  assert.equal(context.prepaymentDateError({...require('./helpers/widget-permissions.cjs').identity('Administrator'),currentUserRelationshipProfile:'Administrator'},final,true,new Date('2026-11-13T13:00:00Z')),'');
  assert.match(context.prepaymentDateError(state,'2026-11-15',false,new Date('2026-11-12T10:00:00Z')),/Monday to Friday/);
  assert.equal(context.prepaymentDateError(state,'2026-11-12',false,new Date('2026-11-13T10:00:00Z')),'','manual dates retain the existing past-date behavior');
});
