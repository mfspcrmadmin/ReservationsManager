const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

function harness(service) {
  const errors = [], writes = [];
  const state = { selectedService: service, selectedBooking: { id: '30' }, cardPurchaseDialogOpen: false };
  const elements = { cardPurchaseDialog: { hidden: true }, cardPurchaseSubmit: { disabled: false } };
  const context = vm.createContext({
    state, elements,
    crmGetRecord: async () => ({ TP_Reference: 'SUP-20' }),
    setError: (_, message) => { if (message) errors.push(message); },
    crmCreateRecord: async (...args) => { writes.push(args); }
  });
  context.pendingCardPurchaseCreation = () => null;
  context.cardPurchaseCreationDisposition = () => "draft";
  context.discardUnsentCardPurchaseCreation = () => {};
  vm.runInContext(fs.readFileSync(require.resolve('../app/js/supplier-payment-reference.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''), context);
  vm.runInContext(fs.readFileSync(require.resolve('../app/js/dialogs-controller.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''), context);
  return { context, state, elements, errors, writes };
}

test('missing supplier blocks opening and submission with an actionable popup message', async () => {
  for (const fields of [{}, { Supplier: null }, { Supplier: {} }, { Supplier: { name: 'Name only' } }, { Supplier: { id: ' ' } }]) {
    const h = harness({ id: '10', ...fields });
    await h.context.onRecordCardPurchase();
    assert.equal(h.elements.cardPurchaseDialog.hidden, true);
    assert.equal(h.state.cardPurchaseDialogOpen, false);
    await h.context.onSubmitCardPurchaseForm({ preventDefault() {} });
    assert.equal(h.errors.length, 2);
    for (const message of h.errors) assert.match(message, /no supplier associated.*Associate a supplier with the service/);
    assert.equal(h.writes.length, 0);
    assert.equal(h.elements.cardPurchaseSubmit.disabled, false);
  }
});

test('supported supplier references allow opening, and removing the supplier blocks submission', async () => {
  for (const fields of [{ Supplier: { id: '20' } }, { Supplier: { value: '20' } }, { Supplier_Id: '20' }]) {
    const h = harness({ id: '10', ...fields });
    await h.context.onRecordCardPurchase();
    assert.equal(h.elements.cardPurchaseDialog.hidden, false);
    assert.equal(h.state.cardPurchaseDialogOpen, true);
    assert.equal(h.errors.length, 0);
    h.state.selectedService = { id: '10' };
    await h.context.onSubmitCardPurchaseForm({ preventDefault() {} });
    assert.equal(h.errors.length, 1);
    assert.equal(h.writes.length, 0);
  }
});

test('missing Connection Reference blocks opening and submission despite Ezus and service references', async () => {
  for (const reference of [undefined, null, '', '   ']) {
    const h = harness({ id: '10', Supplier: { id: '20' }, Ezus_Supplier_Reference: 'legacy', Supplier_Code: 'legacy' });
    h.context.crmGetRecord = async (module, id) => {
      assert.equal(module, 'Vendors');
      assert.equal(id, '20');
      return { TP_Reference: reference, Ezus_Supplier_API: 'legacy' };
    };
    await h.context.onRecordCardPurchase();
    assert.equal(h.elements.cardPurchaseDialog.hidden, true);
    await h.context.onSubmitCardPurchaseForm({ preventDefault() {} });
    assert.equal(h.errors.length, 2);
    h.errors.forEach(message => assert.match(message, /no Connection Reference.*Complete this field/));
    assert.equal(h.writes.length, 0);
    assert.equal(h.elements.cardPurchaseSubmit.disabled, false);
  }
});

test('supplier validation fails closed on CRM errors and returns only the Connection Reference', async () => {
  const h = harness({ id: '10', Supplier: { id: '20' } });
  h.context.crmGetRecord = async () => { throw Error('offline'); };
  await h.context.onRecordCardPurchase();
  assert.equal(h.elements.cardPurchaseDialog.hidden, true);
  assert.match(h.errors[0], /Could not verify/);
  h.context.crmGetRecord = async () => null;
  await assert.rejects(h.context.requireSupplierPaymentReference('20'), /Could not load/);
  h.context.crmGetRecord = async () => ({ TP_Reference: '  TP-20  ', Ezus_Supplier_API: 'legacy' });
  assert.equal(await h.context.requireSupplierPaymentReference('20'), 'TP-20');
  await h.context.onRecordCardPurchase();
  h.context.crmGetRecord = async () => ({ TP_Reference: null });
  await h.context.onSubmitCardPurchaseForm({ preventDefault() {} });
  assert.equal(h.writes.length, 0);
  assert.match(h.errors.at(-1), /no Connection Reference/);
});
