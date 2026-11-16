const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

function load(context, file) {
  vm.runInContext(fs.readFileSync(require.resolve('../app/js/' + file), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''), context);
}

for (const type of ['Refund', 'Purchase']) test(type + ' saves the correct original transaction relationship', async () => {
  const writes = [], errors = [];
  const input = value => ({ value });
  const context = vm.createContext({ recordEditLocks: require("./helpers/record-edit-locks.cjs"),
    state: {
      selectedBooking: { id: 'booking', MFSP_Reference: 'MFSP2606177' },
      selectedService: { id: 'service', Supplier: { id: 'supplier' } },
      cardPurchaseTransactionType: type, cardPurchaseSupportingDocuments: [{}]
    },
    elements: {
      cardPurchaseSubmit: { disabled: false, textContent: 'Save' },
      cardPurchaseAmount: input('103.48'), cardPurchaseServiceDate: input('2026-11-05'),
      cardPurchaseOriginalPurchase: input('616617000175380676'),
      cardPurchasePaymentAccount: input('account'), cardPurchaseObservations: input('Cancellation'),
      cardPurchaseDialog: {}
    },
    MODULES: { cardPurchases: 'Card_Purchases' },
    requireSupplierPaymentReference: async () => 'SUP',
    requirePaymentSettlement: async () => 'settlement',
    crmCreateRecord: async (module, payload) => { writes.push({ module, payload }); return { id: 'new' }; },
    setError: (_, message) => { if (message) errors.push(message); }, setNotice() {}
  });
  context.pendingCardPurchaseCreation = () => null;
  context.cardPurchaseCreationDisposition = () => "draft";
  context.discardUnsentCardPurchaseCreation = () => {};
  context.completeCardPurchaseCreation = async (_, bookingId, serviceId, options) => options.create(options.payload);
  context.finishCardPurchaseCreation = () => {};
  load(context, 'dialogs-controller.js');
  context.uploadCardPurchaseSupportingDocuments = async () => [{ File_Id__s: 'file' }];
  await context.onSubmitCardPurchaseForm({ preventDefault() {} });
  assert.deepEqual(errors, []);
  assert.equal(writes.length, 1);
  const { payload } = writes[0];
  assert.equal(payload.Transaction_Type, type);
  assert.equal(payload.Card_Payment_Account.id, 'account');
  assert.equal(payload.Original_Purchase_Transaction?.id, type === 'Refund' ? '616617000175380676' : undefined);
  assert.equal('Original_Card_Purchase' in payload, false);
});

test('original purchase column displays the transaction, not the legacy payment account', () => {
  const context = vm.createContext({ recordEditLocks: require("./helpers/record-edit-locks.cjs"),
    escapeHtml: String, formatCurrency: String, formatDateTime: String,
    getLookupName: value => value?.name || '', canEditCardPurchase: () => false
  });
  load(context, 'payments-controller.js');
  const html = context.renderCardPurchaseRow({
    id: 'refund', Original_Purchase_Transaction: { name: 'Original train purchase' },
    Original_Card_Purchase: { name: 'Legacy bank card' }
  });
  assert.match(html, /Original train purchase/);
  assert.doesNotMatch(html, /Legacy bank card/);
});
