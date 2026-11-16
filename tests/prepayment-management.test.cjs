const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const MODULES = { prepayments: 'Prepayments', prepaymentRequests: 'Prepayment_Requests', prepaymentRequestServices: 'Prepayment_Request_Services', prepaymentInvoiceAllocations: 'Prepayment_Invoice_Allocations', bookingServices: 'Booking_Services' };

function harness() {
  const records = new Map(), writes = [], deletes = [];
  const put = (module, record) => records.set(module + ':' + record.id, record);
  const get = (module, recordId) => records.get(module + ':' + recordId);
  put(MODULES.prepayments, { id: '10', Prepayment_Request: { id: '20' }, Amount: 100, Currency: 'EUR', Due_Date: '2026-09-24' });
  put(MODULES.prepaymentRequests, { id: '20', Booking: { id: '30' }, Amount: 100, Transaction_Type: 'Full Payment', Proforma_Attached: [{ id: '40', File_Name__s: 'original.pdf' }] });
  put(MODULES.prepaymentRequestServices, { id: '50', Prepayment_Request: { id: '20' }, Booking_Service: { id: '60' } });
  put(MODULES.bookingServices, { id: '60', Booking: { id: '30' }, Prepayment_Request: { id: '20' }, Payment_Status: 'Prepayment requested' });
  const api = {
    coql: async ({ select_query }) => {
      const [, module, field, parentId, offset] = select_query.match(/from (\w+) where (\w+) = '(\d+)' order by id asc limit (\d+), 200/);
      return { data: [...records.entries()].filter(([key, row]) => key.startsWith(module + ':') && row[field]?.id === parentId).slice(Number(offset), Number(offset) + 200).map(([, row]) => ({ id: row.id })) };
    },
    deleteRecord: async ({ Entity, RecordID }) => { deletes.push([Entity, RecordID]); records.delete(Entity + ':' + RecordID); return { data: [{ code: 'SUCCESS' }] }; },
    uploadFile: async () => ({ data: [{ code: 'SUCCESS', details: { id: '70' } }] })
  };
  const state = { selectedBookingId: '30' };
  const context = vm.createContext({ recordEditLocks: require("./helpers/record-edit-locks.cjs"),
    setTimeout: resolve => resolve(),
    MODULES, window: { ZOHO: { CRM: { API: api } } },
    escapeHtml: String,
    crmGetFields: async module => module === MODULES.prepayments ? [{ api_name: 'Vendor_Payment' }] : [{ api_name: 'Prepayment_Request' }, { api_name: 'Payment_Status', pick_list_values: [{ actual_value: 'To be paid' }] }],
    crmGetRecord: async (module, recordId) => get(module, recordId),
    getBookingPrepayment: async (bookingId, paymentId) => {
      const payment = get(MODULES.prepayments, paymentId), request = get(MODULES.prepaymentRequests, payment?.Prepayment_Request.id);
      if (!payment || request?.Booking.id !== bookingId) throw Error('Wrong booking');
      return { payment, request };
    },
    crmUpdateRecord: async (module, payload) => {
      writes.push([module, payload]);
      const row = get(module, payload.id), copy = { ...payload };
      if (copy.Proforma_Attached) {
        let files = [...row.Proforma_Attached];
        for (const change of copy.Proforma_Attached) {
          if ('_delete' in change) files = files.filter(file => file.id !== (change.id || change.attachment_id));
          else files.push({ id: change.File_Id__s || change.$file_id, File_Name__s: 'new.pdf' });
        }
        copy.Proforma_Attached = files;
      }
      put(module, { ...row, ...copy });
      return { code: 'SUCCESS' };
    },
    rememberCreatedPrepayment: () => {}, isPrepaymentTimeRestricted: () => false,
    ensurePrepaymentsLoaded: async () => {}, showFeedback: () => {}
  });
  context.requestCrmAttachmentsV8 = (module, id, field, changes) => changes === undefined
    ? context.crmGetRecord(module, id) : context.crmUpdateRecord(module, { id, [field]: changes });
  const controller = fs.readFileSync(require.resolve('../app/js/prepayments-controller.js'), 'utf8');
  vm.runInContext(controller.slice(controller.indexOf('export async function uploadFile(')).replace(/^export /gm, ''), context);
  vm.runInContext(fs.readFileSync(require.resolve('../app/js/prepayment-management.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''), context);
  return { context, records, writes, deletes, get, put, api, state };
}

test('deletion refuses invoice allocations, legacy invoices and payment lookups before any mutation', async () => {
  for (const kind of ['allocation', 'invoice', 'payment', 'custom-payment']) {
    const h = harness();
    const payment = h.get(MODULES.prepayments, '10');
    if (kind === 'allocation') h.put(MODULES.prepaymentInvoiceAllocations, { id: '80', Prepayment: { id: '10' } });
    if (kind === 'invoice') payment.Vendor_Invoice = { id: '90' };
    if (kind === 'payment') payment.Vendor_Payment = { id: '90' };
    if (kind === 'custom-payment') {
      payment.Custom_Payment = { id: '90' };
      h.context.crmGetFields = async () => [{ api_name: 'Custom_Payment', lookup: { module: { api_name: 'Supplier_Payments' } } }];
    }
    await assert.rejects(h.context.deletePrepayment('30', '10'), /linked/);
    assert.equal(h.deletes.length + h.writes.length, 0);
  }
});

test('editing paid, cancelled or payment-linked prepayments cannot mutate records', async () => {
  for (const change of [
    { Vendor_Payment: { id: '90' } }, { Accounting_Status: 'Prepayment recorded' },
    { Accounting_Status: 'Discard - Credit' }, { Accounting_Status: 'Discard - Already Paid' },
    { Accounting_Status: 'Cancelled' }, { Custom_Payment: { id: '90' } }
  ]) {
    const h = harness();
    Object.assign(h.get(MODULES.prepayments, '10'), change);
    h.context.crmGetFields = async () => [{ api_name: 'Vendor_Payment' }, { api_name: 'Custom_Payment', lookup: { module: { api_name: 'Supplier_Payments' } } }];
    await assert.rejects(h.context.savePrepaymentEdit(h.state, '30', '10', { amount: 125, dueDate: '2026-09-24', files: [] }), /cannot be edited/);
    assert.equal(h.writes.length, 0);
  }
});

test('payment links created during upload and unavailable payment metadata block editing', async () => {
  for (const kind of ['upload', 'metadata']) {
    const h = harness();
    if (kind === 'metadata') h.context.crmGetFields = async () => [];
    h.api.uploadFile = async () => {
      h.get(MODULES.prepayments, '10').Vendor_Payment = { id: '90' };
      return { data: [{ code: 'SUCCESS', details: { id: '70' } }] };
    };
    await assert.rejects(h.context.savePrepaymentEdit(h.state, '30', '10', { amount: 125, dueDate: '2026-09-24', files: [{ file: { name: 'new.pdf' } }] }), /cannot be edited|lookup/);
    assert.equal(h.writes.length, 0);
  }
});

test('lost attachment response is reconciled on retry without attaching twice', async () => {
  for (const failure of ['write-response', 'verification-read']) {
    const h = harness(), update = h.context.crmUpdateRecord, read = h.context.crmGetRecord;
    let lost = true, committed = false;
    h.context.crmUpdateRecord = async (module, payload) => {
      const result = await update(module, payload);
      if (payload.Proforma_Attached) {
        committed = true;
        if (failure === 'write-response' && lost) { lost = false; throw Error('Lost response'); }
      }
      return result;
    };
    h.context.crmGetRecord = async (...args) => {
      if (failure === 'verification-read' && committed && lost) { lost = false; throw Error('Read unavailable'); }
      return read(...args);
    };
    const values = { amount: 125, dueDate: '2026-09-24', removeIds: ['40'], files: [{ file: { name: 'new.pdf' } }] };
    await assert.rejects(h.context.savePrepaymentEdit(h.state, '30', '10', values), /Lost response|Read unavailable/);
    await h.context.savePrepaymentEdit(h.state, '30', '10', values);
    assert.equal(h.writes.filter(([, payload]) => payload.Proforma_Attached).length, 1);
    assert.deepEqual(h.get(MODULES.prepaymentRequests, '20').Proforma_Attached.map(file => file.id), ['70']);
    assert.equal(h.get(MODULES.prepaymentRequests, '20').Amount, 125);
  }
});

test('unconfirmed successful attachment writes never try another format or replay on retry', async () => {
  const h = harness(), update = h.context.crmUpdateRecord;
  let attachmentWrites = 0;
  h.context.crmUpdateRecord = async (module, payload) => {
    if (payload.Proforma_Attached) { attachmentWrites++; return { code: 'SUCCESS' }; }
    return update(module, payload);
  };
  const values = { amount: 100, dueDate: '2026-09-24', files: [{ file: { name: 'new.pdf' } }] };
  await assert.rejects(h.context.savePrepaymentEdit(h.state, '30', '10', values), /did not confirm/);
  await assert.rejects(h.context.savePrepaymentEdit(h.state, '30', '10', values), /Close and reopen/);
  assert.equal(attachmentWrites, 1);
});

test('unknown schema, failed relationship reads and wrong booking block deletion', async () => {
  for (const failure of ['schema', 'read', 'booking']) {
    const h = harness();
    if (failure === 'schema') h.context.crmGetFields = async () => [];
    if (failure === 'read') h.api.coql = async () => ({ code: 'NO_PERMISSION' });
    await assert.rejects(h.context.deletePrepayment(failure === 'booking' ? '99' : '30', '10'));
    assert.equal(h.deletes.length + h.writes.length, 0);
  }
});

test('a payment linked while the cleanup plan is prepared blocks deletion', async () => {
  const h = harness(), fields = h.context.crmGetFields;
  h.context.crmGetFields = async module => {
    if (module === MODULES.bookingServices) h.get(MODULES.prepayments, '10').Vendor_Payment = { id: '90' };
    return fields(module);
  };
  await assert.rejects(h.context.deletePrepayment('30', '10'), /linked/);
  assert.equal(h.deletes.length + h.writes.length, 0);
});

test('deleting an instalment preserves its shared request and service relationships', async () => {
  const h = harness();
  h.put(MODULES.prepayments, { id: '11', Prepayment_Request: { id: '20' } });
  await h.context.deletePrepayment('30', '10');
  assert.deepEqual(h.deletes, [[MODULES.prepayments, '10']]);
  assert.equal(h.writes.length, 0);
  assert.ok(h.get(MODULES.prepaymentRequestServices, '50'));
});

test('last prepayment cleans junctions and legacy lookups, then deletes its empty request', async () => {
  const h = harness();
  h.put(MODULES.bookingServices, { id: '61', Booking: { id: '30' }, Prepayment_Request: { id: '20' } });
  const plan = await h.context.deletePrepayment('30', '10');
  assert.equal(plan.cleaned, true);
  assert.deepEqual(h.deletes, [[MODULES.prepayments, '10'], [MODULES.prepaymentRequestServices, '50'], [MODULES.prepaymentRequests, '20']]);
  assert.equal(h.get(MODULES.bookingServices, '60').Prepayment_Request, null);
  assert.equal(h.get(MODULES.bookingServices, '60').Payment_Status, 'To be paid');
  assert.equal(h.get(MODULES.bookingServices, '61').Prepayment_Request, null);
});

test('another request with prepayments preserves requested status through junction or legacy lookup', async () => {
  for (const legacy of [false, true]) {
    const h = harness();
    h.put(MODULES.prepayments, { id: '12', Prepayment_Request: { id: '21' } });
    if (legacy) h.get(MODULES.bookingServices, '60').Prepayment_Request = { id: '21' };
    else h.put(MODULES.prepaymentRequestServices, { id: '51', Prepayment_Request: { id: '21' }, Booking_Service: { id: '60' } });
    await h.context.deletePrepayment('30', '10');
    assert.equal(h.get(MODULES.bookingServices, '60').Payment_Status, 'Prepayment requested');
    assert.ok(h.get(MODULES.prepayments, '12'));
  }
});

test('junction-only services reset while empty unrelated requests do not block cleanup', async () => {
  const h = harness();
  h.get(MODULES.bookingServices, '60').Prepayment_Request = null;
  h.put(MODULES.prepaymentRequestServices, { id: '51', Prepayment_Request: { id: '21' }, Booking_Service: { id: '60' } });
  await h.context.deletePrepayment('30', '10');
  assert.equal(h.get(MODULES.bookingServices, '60').Payment_Status, 'To be paid');
  assert.ok(h.get(MODULES.prepaymentRequestServices, '51'));
});

test('last legacy-only association resets requested status without overwriting paid or manual statuses', async () => {
  for (const status of ['Prepayment requested', 'Partially paid', 'Fully paid', 'Not required', '']) {
    const h = harness();
    h.records.delete(MODULES.prepaymentRequestServices + ':50');
    h.get(MODULES.bookingServices, '60').Payment_Status = status;
    await h.context.deletePrepayment('30', '10');
    assert.equal(h.get(MODULES.bookingServices, '60').Payment_Status, status === 'Prepayment requested' ? 'To be paid' : status);
  }
});

test('failed or unconfirmed status reset keeps relationships and retries without deleting twice', async () => {
  for (const unconfirmed of [false, true]) {
    const h = harness(), update = h.context.crmUpdateRecord, plan = {};
    h.context.crmUpdateRecord = async (module, payload) => payload.Payment_Status
      ? { code: unconfirmed ? 'SUCCESS' : 'ERROR', message: 'Status rejected' } : update(module, payload);
    await assert.rejects(h.context.deletePrepayment('30', '10', plan), /Status rejected|did not confirm/);
    assert.equal(plan.deleted, true);
    assert.ok(h.get(MODULES.prepaymentRequestServices, '50'));
    assert.ok(h.get(MODULES.prepaymentRequests, '20'));
    h.context.crmUpdateRecord = update;
    await h.context.deletePrepayment('30', '10', plan);
    assert.equal(h.get(MODULES.bookingServices, '60').Payment_Status, 'To be paid');
    assert.equal(h.deletes.filter(([module]) => module === MODULES.prepayments).length, 1);
  }
});

test('missing reset value or foreign service prevents deletion before any write', async () => {
  for (const foreign of [false, true]) {
    const h = harness(), fields = h.context.crmGetFields;
    if (foreign) h.get(MODULES.bookingServices, '60').Booking = { id: '99' };
    else h.context.crmGetFields = async module => (await fields(module)).filter(field => field.api_name !== 'Payment_Status');
    await assert.rejects(h.context.deletePrepayment('30', '10'), /another booking|To be paid/);
    assert.equal(h.deletes.length + h.writes.length, 0);
  }
});

test('partial cleanup can be retried without deleting the prepayment twice', async () => {
  const h = harness(), remove = h.api.deleteRecord, plan = {};
  let fail = true;
  h.api.deleteRecord = async args => {
    if (args.Entity === MODULES.prepaymentRequestServices && fail) return { data: [{ code: 'ERROR', message: 'Cannot delete link' }] };
    return remove(args);
  };
  await assert.rejects(h.context.deletePrepayment('30', '10', plan), /Cannot delete link/);
  assert.equal(plan.deleted, true);
  assert.ok(h.get(MODULES.prepaymentRequests, '20'));
  fail = false;
  await h.context.deletePrepayment('30', '10', plan);
  assert.equal(plan.cleaned, true);
  assert.equal(h.deletes.filter(([module]) => module === MODULES.prepayments).length, 1);
});

test('editing saves amount, due date, full request total and replaces selected proforma', async () => {
  const h = harness();
  await h.context.savePrepaymentEdit(h.state, '30', '10', { amount: '125.50', dueDate: '2026-09-25', removeIds: ['40'], files: [{ file: { name: 'new.pdf' } }] });
  const payment = h.get(MODULES.prepayments, '10'), request = h.get(MODULES.prepaymentRequests, '20');
  assert.equal(payment.Amount, 125.5);
  assert.equal(payment.Percent, 100);
  assert.equal(payment.When_To_Be_Paid, 'Specific Date');
  assert.equal(payment.Due_Date, '2026-09-25');
  assert.equal(request.Amount, 125.5);
  assert.deepEqual(request.Proforma_Attached.map(file => file.id), ['70']);
});

test('invalid amount, dates, cutoff and removing every document cause no writes', async () => {
  for (const values of [
    { amount: '0' }, { amount: 'NaN' }, { amount: '1.123' }, { dueDate: '2026-02-30' },
    { dueDate: '2026-09-26' }, { removeIds: ['40'] }, { cutoff: true, dueDate: '2026-09-25' }
  ]) {
    const h = harness();
    h.context.isPrepaymentTimeRestricted = () => Boolean(values.cutoff);
    await assert.rejects(h.context.savePrepaymentEdit(h.state, '30', '10', { amount: '100', dueDate: '2026-09-24', files: [], ...values }));
    assert.equal(h.writes.length, 0);
  }
});

test('editing accepts the same successful upload response as the creation form and preserves existing documents', async () => {
  const h = harness();
  h.api.uploadFile = async () => [{ status: 'success', details: { id: '70' } }];
  await h.context.savePrepaymentEdit(h.state, '30', '10', { amount: 100, dueDate: '2026-09-24', files: [{ file: { name: 'new.pdf' } }] });
  assert.deepEqual(h.get(MODULES.prepaymentRequests, '20').Proforma_Attached.map(file => file.id), ['40', '70']);
});

test('editing uses canonical v8 additions and removals', async () => {
  const h = harness();
  await h.context.savePrepaymentEdit(h.state, '30', '10', { amount: 100, dueDate: '2026-09-24', removeIds: ['40'], files: [{ file: { name: 'new.pdf' } }] });
  assert.deepEqual(h.get(MODULES.prepaymentRequests, '20').Proforma_Attached.map(file => file.id), ['70']);
  const changes = h.writes.find(([, payload]) => payload.Proforma_Attached)[1].Proforma_Attached;
  assert.equal(changes[0].File_Id__s, '70');
  assert.equal(changes[1].id, '40');
  assert.ok('_delete' in changes[1]);
});

test('existing attachments cannot falsely confirm a new upload and failed uploads cause no record writes', async () => {
  const h = harness(), update = h.context.crmUpdateRecord;
  h.context.crmUpdateRecord = async (module, payload) => payload.Proforma_Attached ? { code: 'SUCCESS' } : update(module, payload);
  const values = { amount: 100, dueDate: '2026-09-24', files: [{ file: { name: 'new.pdf' } }] };
  await assert.rejects(h.context.savePrepaymentEdit(h.state, '30', '10', values), /did not confirm/);
  assert.equal(values.files.length, 1);
  h.writes.length = 0;
  h.api.uploadFile = async () => ({ data: [{ status: 'error', message: 'Upload rejected' }] });
  await assert.rejects(h.context.savePrepaymentEdit(h.state, '30', '10', { ...values, files: [{ file: { name: 'bad.pdf' } }] }), /Upload rejected/);
  assert.equal(h.writes.length, 0);
});

test('editing permits removal of one document while keeping another', async () => {
  const h = harness();
  h.get(MODULES.prepaymentRequests, '20').Proforma_Attached.push({ id: '41', File_Name__s: 'keep.pdf' });
  await h.context.savePrepaymentEdit(h.state, '30', '10', { amount: 100, dueDate: '2026-09-24', removeIds: ['40'], files: [] });
  assert.deepEqual(h.get(MODULES.prepaymentRequests, '20').Proforma_Attached.map(file => file.id), ['41']);
});

test('retrying a failed request amount update does not attach confirmed documents twice', async () => {
  const h = harness(), update = h.context.crmUpdateRecord;
  let fail = true, uploads = 0;
  h.api.uploadFile = async () => { uploads++; return { data: [{ code: 'SUCCESS', details: { id: '70' } }] }; };
  h.context.crmUpdateRecord = async (module, payload) => {
    if (module === MODULES.prepaymentRequests && payload.Amount && fail) return { code: 'ERROR', message: 'Amount rejected' };
    return update(module, payload);
  };
  const values = { amount: 125, dueDate: '2026-09-24', files: [{ file: { name: 'new.pdf' } }] };
  await assert.rejects(h.context.savePrepaymentEdit(h.state, '30', '10', values), /Amount rejected/);
  assert.equal(values.files.length, 0);
  fail = false;
  await h.context.savePrepaymentEdit(h.state, '30', '10', values);
  assert.equal(uploads, 1);
  assert.deepEqual(h.get(MODULES.prepaymentRequests, '20').Proforma_Attached.map(file => file.id), ['40', '70']);
  assert.equal(h.get(MODULES.prepaymentRequests, '20').Amount, 125);
});

test('edit picker accumulates selections and dropped files and allows removing a pending file', async () => {
  const h = harness(), nodes = {}, controls = {};
  const node = () => ({ addEventListener(event, callback) { this[event] = callback; } });
  const form = { elements: { namedItem: name => controls[name] ||= node() }, querySelector: selector => nodes[selector] ||= node() };
  const dialog = { setAttribute() {}, querySelector: selector => selector === 'form' ? form : nodes[selector] ||= node(), addEventListener() {}, showModal() {} };
  h.context.document = { createElement: () => dialog, body: { appendChild() {} } };
  await h.context.openPrepaymentManagement({}, h.state, '10', false);
  const picker = controls.proforma, list = nodes['[data-selected-files]'];
  picker.onchange({ target: { files: [{ name: 'first.pdf' }] } });
  picker.onchange({ target: { files: [{ name: 'second.pdf' }] } });
  nodes['.prepayment-edit-upload'].drop({ preventDefault() {}, dataTransfer: { files: [{ name: 'third.pdf' }] } });
  for (const name of ['first.pdf', 'second.pdf', 'third.pdf']) assert.ok(list.innerHTML.includes(name));
  list.onclick({ target: { closest: () => ({ dataset: { removeFile: '1' } }) } });
  assert.ok(!list.innerHTML.includes('second.pdf'));
  assert.ok(list.innerHTML.includes('first.pdf') && list.innerHTML.includes('third.pdf'));
  assert.equal(picker.value, '');
});

test('amount respects invoice allocations and other instalments', async () => {
  const h = harness();
  h.put(MODULES.prepaymentInvoiceAllocations, { id: '80', Prepayment: { id: '10' }, Allocated_Amount: 90, Currency: 'EUR' });
  await assert.rejects(h.context.savePrepaymentEdit(h.state, '30', '10', { amount: 89, dueDate: '2026-09-24' }), /allocated/);
  h.get(MODULES.prepaymentRequests, '20').Transaction_Type = 'Partial Payment';
  h.put(MODULES.prepayments, { id: '11', Prepayment_Request: { id: '20' }, Amount: 20 });
  await assert.rejects(h.context.savePrepaymentEdit(h.state, '30', '10', { amount: 100, dueDate: '2026-09-24' }), /request total/);
  assert.equal(h.writes.length, 0);
});

test('request failure reports the already saved amount/date', async () => {
  const h = harness(), update = h.context.crmUpdateRecord;
  h.context.crmUpdateRecord = async (module, payload) => module === MODULES.prepaymentRequests ? { code: 'ERROR', message: 'No permission' } : update(module, payload);
  await assert.rejects(h.context.savePrepaymentEdit(h.state, '30', '10', { amount: 125, dueDate: '2026-09-24' }), /Amount\/date saved.*No permission/);
  assert.equal(h.get(MODULES.prepayments, '10').Amount, 125);
});

test('delete popup requires confirmation; cancel never mutates CRM', async () => {
  const h = harness(), nodes = {}, events = {};
  h.state.services = [{ id: '60', Payment_Status: 'Prepayment requested' }];
  h.state.filteredServices = [{ id: '60', Payment_Status: 'Prepayment requested' }];
  h.state.selectedService = { id: '60', Payment_Status: 'Prepayment requested' };
  const form = { reportValidity: () => true, querySelector: selector => nodes[selector] ||= {} };
  const dialog = {
    setAttribute() {}, querySelector: selector => selector === 'form' ? form : nodes[selector] ||= {},
    addEventListener: (event, callback) => { events[event] = callback; },
    showModal() { this.open = true; }, close() { this.open = false; events.close(); }, remove() {}
  };
  h.context.document = { createElement: () => dialog, body: { appendChild() {} } };
  await h.context.openPrepaymentManagement({}, h.state, '10', true);
  assert.equal(dialog.open, true);
  assert.match(dialog.innerHTML, /Delete this prepayment permanently/);
  assert.equal(h.deletes.length, 0);
  nodes['[data-cancel]'].onclick();
  assert.equal(dialog.open, false);
  assert.equal(h.deletes.length, 0);
  await h.context.openPrepaymentManagement({}, h.state, '10', true);
  await form.onsubmit({ preventDefault() {} });
  assert.equal(dialog.open, false);
  assert.equal(h.deletes.length, 3);
  assert.ok(h.state.deletedPrepaymentRecords['30'].payments.includes('10'));
  for (const service of [...h.state.services, ...h.state.filteredServices, h.state.selectedService]) assert.equal(service.Payment_Status, 'To be paid');
});
