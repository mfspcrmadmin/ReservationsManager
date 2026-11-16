const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

function harness() {
  const record = { id: '10', Booking: { id: '30' }, Transaction_Type: 'Purchase', Accounting_Status: 'Pending invoice', Amount: 100, Transaction_Date: '2026-10-05T17:30:00+02:00', Card_Payment_Account: { id: '20' }, Supporting_Documents: [{ id: '40', File_Name__s: 'original.pdf' }], Modified_Time: 'v1' };
  const writes = [], uploads = [], state = { selectedBookingId: '30' };
  const context = vm.createContext({ recordEditLocks: require("./helpers/record-edit-locks.cjs"),
    Intl, setTimeout: resolve => resolve(), MODULES: { cardPurchases: 'Card_Purchases', paymentAccounts: 'Payment_Accounts' },
    crmGetRecord: async (module) => module === 'Card_Purchases' ? { ...record } : { id: '21', Owner_Type: 'Own' },
    crmGetAllRecords: async () => [],
    crmUpdateRecord: async (module, payload) => { writes.push(payload); return { code: 'SUCCESS' }; },
    window: { ZOHO: { CRM: { API: { uploadFile: async args => { uploads.push(args); return { data: [{ code: 'SUCCESS', details: { id: '50' } }] }; } } } } },
    escapeHtml: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'), showFeedback() {}
  });
  context.requestCardPurchaseV8 = async (id, payload) => {
    if (!payload) return context.crmGetRecord('Card_Purchases', id);
    const result = await context.crmUpdateRecord('Card_Purchases', payload);
    if (result.code !== 'SUCCESS') throw new Error(result.message);
    for (const change of payload.Supporting_Documents || []) {
      if ('_delete' in change) record.Supporting_Documents = record.Supporting_Documents.filter(file => file.id !== change.id);
      else record.Supporting_Documents.push({ id: 'link-' + change.File_Id__s, File_Id__s: change.File_Id__s });
    }
    return result;
  };
  vm.runInContext(fs.readFileSync(require.resolve('../app/js/card-purchase-management.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''), context);
  const save = values => context.saveCardPurchaseEdit(state, '30', '10', { amount: '125.50', date: '2026-10-05', accountId: '20', notes: 'Updated', files: [], ...values });
  return { context, record, writes, uploads, state, save };
}

test('only initial purchase/refund states without accounting links are editable', () => {
  const h = harness();
  for (const type of ['Purchase', 'Refund', '', 'Unknown']) {
    for (const status of ['Pending invoice', 'Pending credit note', 'Pending payment record', 'Purchase recorded', 'Refund recorded', '', null]) {
      assert.equal(h.context.canEditCardPurchase({ ...h.record, Transaction_Type: type, Accounting_Status: status }), type === 'Purchase' && status === 'Pending invoice' || type === 'Refund' && status === 'Pending credit note');
    }
  }
  for (const field of ['Vendor_Invoice', 'Vendor_Payment', 'Accounting_Processed_At']) assert.equal(h.context.canEditCardPurchase({ ...h.record, [field]: 'linked' }), false);
});

test('saving preserves the timestamp when only amount, account and notes change', async () => {
  const h = harness();
  await h.save({ accountId: '21' });
  const payload = h.writes[0];
  assert.equal(payload.Amount, 125.5);
  assert.equal(payload.Card_Payment_Account.id, '21');
  assert.equal(payload.Transaction_Notes, 'Updated');
  for (const field of ['Transaction_Date', 'Accounting_Status', 'Transaction_Type', 'Booking', 'Supporting_Documents']) assert.equal(payload[field], undefined);
});

test('changed dates use Madrid winter and summer offsets', async () => {
  for (const [date, offset] of [['2026-12-01', '+01:00'], ['2026-07-01', '+02:00']]) {
    const h = harness();
    await h.save({ date });
    assert.equal(h.writes[0].Transaction_Date, date + 'T12:00:00' + offset);
  }
});

test('invalid amounts, dates, account and document counts cannot write', async () => {
  for (const values of [{ amount: '0' }, { amount: '-1' }, { amount: 'NaN' }, { amount: '1.234' }, { date: '2026-02-30' }, { date: '' }, { accountId: '' }, { files: Array.from({ length: 5 }, () => ({ file: {} })) }]) {
    const h = harness();
    await assert.rejects(h.save(values));
    assert.equal(h.writes.length + h.uploads.length, 0);
  }
});

test('booking changes, processed records and stale edits block saving', async () => {
  for (const change of [h => h.state.selectedBookingId = '99', h => h.record.Booking.id = '99', h => h.record.Accounting_Status = 'Purchase recorded', h => h.record.Vendor_Invoice = { id: '90' }, h => h.record.Modified_Time = 'v2']) {
    const h = harness(); change(h);
    await assert.rejects(h.save({ modifiedTime: 'v1' }));
    assert.equal(h.writes.length, 0);
  }
});

test('live status and booking are checked again after file uploads', async () => {
  for (const change of [h => h.record.Accounting_Status = 'Purchase recorded', h => h.state.selectedBookingId = '99', h => h.record.Modified_Time = 'v2']) {
    const h = harness();
    h.context.window.ZOHO.CRM.API.uploadFile = async () => { change(h); return { data: [{ code: 'SUCCESS', details: { id: '50' } }] }; };
    await assert.rejects(h.save({ files: [{ file: {} }] }));
    assert.equal(h.writes.length, 0);
  }
});

test('document replacement uses attachment IDs and failed updates reuse uploads', async () => {
  const h = harness(), files = [{ file: { name: 'new.pdf' } }];
  const update = h.context.crmUpdateRecord;
  h.context.crmUpdateRecord = async () => ({ code: 'ERROR', message: 'No permission' });
  await assert.rejects(h.save({ removeIds: ['40'], files }), /No permission/);
  h.context.crmUpdateRecord = update;
  await h.save({ removeIds: ['40'], files });
  assert.equal(h.uploads.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.writes[0].Supporting_Documents)), [{ id: '40', _delete: null }, { File_Id__s: '50' }]);
});

test('non-own accounts are rejected', async () => {
  const h = harness(), get = h.context.crmGetRecord;
  h.context.crmGetRecord = async (module, id) => module === 'Payment_Accounts' ? { id, Owner_Type: 'Supplier' } : get(module, id);
  await assert.rejects(h.save({ accountId: '21' }), /own payment account/);
  assert.equal(h.writes.length, 0);
});

test('table keeps edit action visible and disables it for ineligible rows', () => {
  const h = harness();
  Object.assign(h.context, { formatCurrency: String, formatDateTime: String, getLookupName: value => value?.name || '' });
  vm.runInContext(fs.readFileSync(require.resolve('../app/js/payments-controller.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''), h.context);
  assert.match(h.context.renderCardPurchaseRow(h.record), /data-card-purchase-edit="10"/);
  assert.match(h.context.renderCardPurchaseRow(h.record), /data-card-purchase-delete="10"/);
  assert.doesNotMatch(h.context.renderCardPurchaseRow(h.record), / disabled/);
  h.record.Accounting_Status = 'Purchase recorded';
  assert.match(h.context.renderCardPurchaseRow(h.record), /data-card-purchase-edit="10"[^>]* disabled/);
  assert.match(h.context.renderCardPurchaseRow(h.record), /data-card-purchase-delete="10"[^>]* disabled/);
});

test('deletion accepts only initial purchase and refund states and removes the selected cached row', async () => {
  for (const [type, status] of [['Purchase', 'Pending invoice'], ['Refund', 'Pending credit note']]) {
    const h = harness(), deleted = [];
    Object.assign(h.record, { Transaction_Type: type, Accounting_Status: status });
    h.state.cardPurchases = [h.record, { id: '11' }];
    h.context.window.ZOHO.CRM.API.deleteRecord = async args => { deleted.push(args); return { data: [{ code: 'SUCCESS' }] }; };
    await h.context.deleteCardPurchase(h.state, '30', '10', 'v1');
    assert.deepEqual(JSON.parse(JSON.stringify(deleted)), [{ Entity: 'Card_Purchases', RecordID: '10' }]);
    assert.deepEqual(h.state.cardPurchases.map(row => row.id), ['11']);
  }
});

test('deletion rechecks booking, accounting links, initial status and modification time before any mutation', async () => {
  for (const change of [
    h => h.state.selectedBookingId = '99', h => h.record.Booking.id = '99',
    h => h.record.Accounting_Status = 'Purchase recorded', h => h.record.Accounting_Status = 'Pending payment record',
    h => h.record.Transaction_Type = 'Refund', h => h.record.Accounting_Status = '',
    h => h.record.Vendor_Invoice = { id: '90' }, h => h.record.Vendor_Payment = { id: '90' },
    h => h.record.Accounting_Processed_At = '2026-10-07', h => h.record.Modified_Time = 'v2',
    h => h.context.crmGetRecord = async () => null
  ]) {
    const h = harness(); let deleted = 0;
    h.context.window.ZOHO.CRM.API.deleteRecord = async () => { deleted++; return { data: [{ code: 'SUCCESS' }] }; };
    change(h);
    await assert.rejects(h.context.deleteCardPurchase(h.state, '30', '10', 'v1'));
    assert.equal(deleted, 0);
  }
});

test('failed or unconfirmed deletion preserves the cached transaction', async () => {
  for (const result of [{ data: [{ code: 'NO_PERMISSION', message: 'Not allowed' }] }, {}]) {
    const h = harness();
    h.state.cardPurchases = [h.record];
    h.context.window.ZOHO.CRM.API.deleteRecord = async () => result;
    await assert.rejects(h.context.deleteCardPurchase(h.state, '30', '10', 'v1'));
    assert.equal(h.state.cardPurchases.length, 1);
  }
});

test('delete dialog cancels without mutation and rechecks state when confirming', async () => {
  const h = harness(), nodes = {}, events = {};
  let deleted = 0, refreshed = 0;
  h.context.window.ZOHO.CRM.API.deleteRecord = async () => { deleted++; return { data: [{ code: 'SUCCESS' }] }; };
  const form = { querySelector: selector => nodes[selector] ||= {} };
  const dialog = {
    setAttribute() {}, querySelector: selector => selector === 'form' ? form : nodes[selector] ||= {},
    addEventListener: (event, callback) => { events[event] = callback; },
    showModal() { this.open = true; }, close() { this.open = false; events.close(); }, remove() {}
  };
  h.context.document = { querySelector: () => null, createElement: () => dialog, body: { appendChild() {} } };
  const open = () => h.context.openCardPurchaseDeletion({}, h.state, '10', async () => { refreshed++; });
  await open();
  assert.match(dialog.innerHTML, /Delete this card transaction permanently/);
  nodes['[data-cancel]'].onclick();
  assert.equal(deleted, 0);
  assert.equal(dialog.open, false);
  await open();
  h.record.Accounting_Status = 'Purchase recorded';
  await form.onsubmit({ preventDefault() {} });
  assert.equal(deleted, 0);
  assert.equal(dialog.open, true);
  assert.match(nodes['[data-feedback]'].textContent, /initial accounting status/);
  h.record.Accounting_Status = 'Pending invoice';
  await form.onsubmit({ preventDefault() {} });
  assert.equal(deleted, 1);
  assert.equal(refreshed, 1);
  assert.equal(dialog.open, false);
});

 test('success without a persisted document is rejected and an uncertain save cannot be replayed', async () => {
  const h = harness(), values = { amount: '125.50', date: '2026-10-05', accountId: '20', files: [{ file: { name: 'invoice.pdf', size: 123 } }] };
  h.context.requestCardPurchaseV8 = async (id, payload) => payload ? h.context.crmUpdateRecord('Card_Purchases', payload) : { ...h.record };
  await assert.rejects(h.context.saveCardPurchaseEdit(h.state, '30', '10', values), /could not be verified/);
  await assert.rejects(h.context.saveCardPurchaseEdit(h.state, '30', '10', values), /previous save/);
  assert.equal(h.writes.length, 1);
  assert.equal(h.uploads.length, 1);
 });

 test('readback verifies preserved documents and removal, even when the upload is present', async () => {
  const h = harness();
  h.context.requestCardPurchaseV8 = async (id, payload) => {
    if (payload) { h.record.Supporting_Documents.push({ id: '51', File_Id__s: '50' }); return { code: 'SUCCESS' }; }
    return { ...h.record };
  };
  await assert.rejects(h.save({ removeIds: ['40'], files: [{ file: { name: 'invoice.pdf' } }] }), /could not be verified/);
 });
