const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
function setup(attempt) {
  const storage = new Map(), notices = [], errors = [];
  const key = 'bookingsManager.cardCreation:' + JSON.stringify(['user', '10', '20']);
  if (attempt) storage.set(key, JSON.stringify({ bookingId: '10', serviceId: '20', documents: [], ...attempt }));
  const context = vm.createContext({
    state: { currentUserId: 'user', selectedBooking: { id: '10' }, selectedService: { id: '20' }, cardPurchaseDialogOpen: true, cardPurchaseSupportingDocuments: [{ name: 'unsent.pdf' }] },
    elements: { cardPurchaseDialog: { hidden: false } },
    window: { sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } },
    setNotice: (_, text) => notices.push(text), setError: (_, text) => errors.push(text),
    crmCreateRecord: () => assert.fail('Closing cannot create a CRM record'),
    crmUpdateRecord: () => assert.fail('Closing cannot cancel a CRM record')
  });
  for (const file of ['card-purchase-creation.js', 'dialogs-controller.js']) vm.runInContext(fs.readFileSync(require.resolve('../app/js/' + file), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''), context);
  return { context, storage, key, notices, errors };
}
test('closing an unsent form discards only local files and prepared recovery', () => {
  for (const attempt of [null, { phase: 'prepared', recordId: '' }]) {
    const f = setup(attempt);
    f.context.onCloseCardPurchaseDialog();
    assert.equal(f.context.elements.cardPurchaseDialog.hidden, true);
    assert.equal(f.context.state.cardPurchaseSupportingDocuments.length, 0);
    assert.equal(f.storage.has(f.key), false);
    assert.match(f.notices.at(-1), /Unsent.*discarded/);
  }
});
test('created and uncertain transactions keep their recovery when closing', () => {
  for (const attempt of [{ phase: 'created', recordId: '30' }, { phase: 'attaching', recordId: '30' }, { phase: 'creating', recordId: '' }]) {
    const f = setup(attempt);
    const before = f.storage.get(f.key);
    f.context.onCloseCardPurchaseDialog();
    assert.equal(f.context.elements.cardPurchaseDialog.hidden, true);
    assert.equal(f.storage.get(f.key), before);
    if (attempt.recordId) assert.match(f.notices.at(-1), /already recorded.*does not cancel/);
    else assert.match(f.errors.at(-1), /unconfirmed|could not be confirmed/);
    assert.throws(() => f.context.discardUnsentCardPurchaseCreation(f.context.state, '10', '20'));
  }
});
test('saving blocks close, and failed local discard preserves the draft', () => {
  const f = setup({ phase: 'prepared', recordId: '' });
  f.context.state.cardPurchaseSaving = true;
  f.context.onCloseCardPurchaseDialog();
  assert.equal(f.context.elements.cardPurchaseDialog.hidden, false);
  f.context.state.cardPurchaseSaving = false;
  f.context.window.sessionStorage.removeItem = () => { throw Error('blocked'); };
  f.context.onCloseCardPurchaseDialog();
  assert.equal(f.context.elements.cardPurchaseDialog.hidden, false);
  assert.equal(f.storage.has(f.key), true);
});

test('closing after a booking switch protects the original dialog recovery', () => {
  const f = setup({ phase: 'created', recordId: '30' });
  f.context.state.cardPurchaseDialogContext = { bookingId: '10', serviceId: '20' };
  f.context.state.selectedBooking = { id: 'other-booking' };
  f.context.state.selectedService = { id: 'other-service' };
  f.context.onCloseCardPurchaseDialog();
  assert.equal(f.storage.has(f.key), true);
  assert.match(f.notices.at(-1), /already recorded/);
});
