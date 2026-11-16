const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");
const source = fs.readFileSync(require("node:path").join(__dirname, "../app/js/supplier-contact-emails.js"), "utf8").replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
function setup() {
  const calls = [];
  const context = vm.createContext({
    crmSearchRecord: async (module, criteria) => {
      calls.push([module, criteria]);
      if (module === "Communication_Services") return ["service-1", "service-1", "service-2"].map(id => ({ Booking_Service: { id }, Communication: { id: "comm-1" } }));
      return [{ Full_Name: "Ana", Email: "ana@example.com", Email_2: "OTHER@example.com" }, { Full_Name: "Bea", Email: "other@example.com" }, { Full_Name: "No email", Email: null }, { Full_Name: "Invalid", Email: "bad" }];
    },
    crmGetRecord: async (module, id) => { calls.push([module, id]); return { id, Booking: { id: "booking" }, Supplier: { id: "supplier-1", name: "Hotel" } }; }
  });
  vm.runInContext(source, context);
  return { context, calls };
}
test("loads only suppliers linked through the communication services and includes valid unique contact emails", async () => {
  const { context, calls } = setup();
  const result = await context.loadSupplierContactEmails("comm-1");
  assert.deepEqual(Array.from(result, item => item.email), ["ana@example.com", "OTHER@example.com"]);
  assert.deepEqual(calls, [["Communications", "comm-1"], ["Communication_Services", "(Communication:equals:comm-1)"], ["Booking_Services", "service-1"], ["Booking_Services", "service-2"], ["Contacts", "(Vendor_Name:equals:supplier-1)"]]);
});
test("empty relations return no contacts and read errors propagate", async () => {
  const { context } = setup();
  context.crmSearchRecord = async () => [];
  assert.equal((await context.loadSupplierContactEmails("comm-1")).length, 0);
  context.crmSearchRecord = async () => { throw new Error("CRM unavailable"); };
  await assert.rejects(context.loadSupplierContactEmails("comm-1"), /CRM unavailable/);
});

test("foreign booking services and foreign communication links block supplier contacts", async () => {
  for (const foreign of ['service', 'link']) {
    const { context } = setup();
    const read = context.crmGetRecord;
    context.crmGetRecord = async (module, id) => module === 'Booking_Services' && foreign === 'service'
      ? { id, Booking: { id: 'other' }, Supplier: { id: 'supplier' } } : read(module, id);
    if (foreign === 'link') context.crmSearchRecord = async () => [{ Communication: { id: 'other' }, Booking_Service: { id: 'service' } }];
    await assert.rejects(context.loadSupplierContactEmails('comm-1'), /verify/);
  }
});
test("merging preserves existing addresses and removes case-insensitive duplicates", () => {
  const { context } = setup();
  assert.deepEqual(Array.from(context.mergeContactEmails(["Ana@example.com"], ["ana@example.com", "new@example.com"])), ["Ana@example.com", "new@example.com"]);
});

function recipientSetup() {
  const { context } = setup();
  let picker, renders = 0;
  const state = { selectedBookingId: "booking", selectedDraftRecordId: "draft", communicationInlineEdit: "", communicationInlineEmails: { to: [], cc: ["cc@example.com"] } };
  const record = { communication_id: "comm", from: "team@example.com", to: "existing@example.com" };
  Object.assign(context, {
    state, elements: { mailToContactsButton: { disabled: false }, mailInlineToSave: { focus() {} } },
    getSelectedCommunicationRecord: () => record,
    getCommunicationEditorFields: entry => ({ email_to: entry.to }),
    splitCommunicationEmails: value => value.split(/[,;]/).map(email => email.trim()).filter(Boolean),
    openSupplierContactEmails: options => { picker = options; }, renderEmailsPanel: () => renders++
  });
  const controller = fs.readFileSync(require("node:path").join(__dirname, "../app/js/booking-controller.js"), "utf8");
  const start = controller.indexOf("function onSelectSupplierRecipientEmails(");
  vm.runInContext(controller.slice(start, controller.indexOf("\n}", start) + 2), context);
  return { context, state, record, open: () => { context.onSelectSupplierRecipientEmails(); return picker; }, renders: () => renders };
}

test("supplier addresses are added only to To while preserving existing and unsaved recipients", () => {
  const f = recipientSetup();
  f.state.communicationInlineEdit = "to";
  f.state.communicationInlineEmails.to = ["existing@example.com", "unsaved@example.com"];
  const picker = f.open();
  assert.equal(picker.communicationId, "comm");
  picker.onApply(["existing@example.com", "unsaved@example.com", "supplier@example.com"]);
  assert.deepEqual(Array.from(f.state.communicationInlineEmails.to), ["existing@example.com", "unsaved@example.com", "supplier@example.com"]);
  assert.equal(f.record.from, "team@example.com");
  assert.equal(f.record.to, "existing@example.com");
  assert.deepEqual(f.state.communicationInlineEmails.cc, ["cc@example.com"]);
  assert.equal(f.state.communicationInlineEdit, "to");
  assert.equal(f.renders(), 1);
});

test("switching communication prevents adding selected addresses to another email", () => {
  const f = recipientSetup();
  const picker = f.open();
  f.state.selectedDraftRecordId = "other";
  assert.equal(picker.isCurrent(), false);
  assert.throws(() => picker.onApply(["supplier@example.com"]), /communication changed/);
  assert.equal(f.state.communicationInlineEmails.to.length, 0);
  assert.equal(f.renders(), 0);
});

test("applying recipients honors removals, including clearing all addresses", () => {
  const f = recipientSetup();
  let picker = f.open();
  picker.onApply(["replacement@example.com"]);
  assert.deepEqual(Array.from(f.state.communicationInlineEmails.to), ["replacement@example.com"]);
  picker = f.open();
  picker.onApply([]);
  assert.deepEqual(Array.from(f.state.communicationInlineEmails.to), []);
  assert.equal(f.record.to, "existing@example.com");
});

test("contact loading follows pagination and deduplicates emails across pages", async () => {
  const { context } = setup();
  const pages = [];
  context.crmSearchRecord = async (module, _, page) => {
    if (module === "Communication_Services") return [{ Booking_Service: { id: "service" }, Communication: { id: "comm" } }];
    pages.push(page);
    return page === 1 ? Array.from({ length: 200 }, () => ({ Email: "same@example.com" })) : [{ Email: "last@example.com" }];
  };
  const results = await context.loadSupplierContactEmails("comm");
  assert.deepEqual(pages, [1, 2]);
  assert.deepEqual(Array.from(results, item => item.email).sort(), ["last@example.com", "same@example.com"]);
});

test("communication associations paginate and later-page failure cannot return partial contacts", async () => {
  const { context } = setup();
  const pages = [];
  let fail = true;
  context.crmSearchRecord = async (module, _, page) => {
    if (module === 'Contacts') return [{ Email: 'supplier@example.com' }];
    pages.push(page);
    if (page === 2 && fail) throw new Error('Second page unavailable');
    return Array.from({ length: page === 1 ? 200 : 1 }, (_, index) => ({ Communication: { id: 'comm' }, Booking_Service: { id: String(page * 200 + index) } }));
  };
  await assert.rejects(context.loadSupplierContactEmails('comm'), /Second page unavailable/);
  fail = false;
  const contacts = await context.loadSupplierContactEmails('comm');
  assert.deepEqual(Array.from(contacts, item => item.email), ['supplier@example.com']);
  assert.deepEqual(pages, [1, 2, 1, 2]);
});
