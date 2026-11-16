const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

function harness() {
  const pending = [];
  const context = vm.createContext({
    MODULES: { bookings: 'Deals' },
    crmGetRelatedRecords: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    escapeHtml: String
  });
  vm.runInContext(fs.readFileSync(require.resolve('../app/js/payments-controller.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''), context);
  return { context, pending, state: { selectedBookingId: 'old', bookingWorkspaceRequestId: 1, cardPurchases: [] } };
}

for (const outcome of ['resolve', 'reject']) test('late ' + outcome + ' from the previous booking cannot overwrite the current load', async () => {
  const h = harness();
  const old = h.context.ensureCardPurchasesLoaded({}, h.state);
  Object.assign(h.state, { selectedBookingId: 'new', bookingWorkspaceRequestId: 2, cardPurchasesLoading: false });
  const current = h.context.ensureCardPurchasesLoaded({}, h.state);
  h.pending[0][outcome](outcome === 'resolve' ? [{ id: 'old-card' }] : Error('Old request failed'));
  await old;
  assert.equal(h.state.cardPurchasesLoading, true);
  assert.equal(h.state.cardPurchasesError, '');
  assert.equal(h.state.cardPurchases.length, 0);
  h.pending[1].resolve([{ id: 'new-card' }]);
  await current;
  assert.equal(h.state.cardPurchases[0].id, 'new-card');
  assert.equal(h.state.cardPurchasesLoadedBookingId, 'new');
  assert.equal(h.state.cardPurchasesLoading, false);
});

test('leaving and returning to the same booking invalidates its old request', async () => {
  const h = harness();
  const old = h.context.ensureCardPurchasesLoaded({}, h.state);
  h.state.bookingWorkspaceRequestId = 3;
  h.pending[0].resolve([{ id: 'stale-card' }]);
  await old;
  assert.equal(h.state.cardPurchases.length, 0);
});

test('render never displays cached cards belonging to a different booking', () => {
  const h = harness(), elements = { cardPurchasesBody: {} };
  Object.assign(h.state, { selectedBookingId: 'new', cardPurchasesLoaded: true, cardPurchasesLoadedBookingId: 'old', cardPurchases: [{ id: 'old-card' }] });
  h.context.renderCardPurchases(elements, h.state);
  assert.match(elements.cardPurchasesBody.innerHTML, /Open this tab/);
  assert.doesNotMatch(elements.cardPurchasesBody.innerHTML, /old-card/);
});

test('all card pages load before publishing the count and sorting the complete list', async () => {
  const h = harness(), calls = [];
  const elements = { cardTransactionsTitle: {}, cardPurchasesBody: {} };
  h.context.renderCardPurchaseRow = record => '<tr><td>' + record.id + '</td></tr>';
  h.context.crmGetRelatedRecords = async (module, bookingId, list, options) => {
    calls.push([module, bookingId, list, options.page, options.perPage]);
    assert.equal(h.state.cardPurchasesLoaded, undefined);
    assert.equal(elements.cardTransactionsTitle.textContent, 'Card Transactions');
    return options.page === 1 ? Array.from({ length: 200 }, (_, i) => ({ id: String(i), Transaction_Date: '2026-01-01' }))
      : [{ id: 'last', Transaction_Date: '2026-12-31' }];
  };
  await h.context.ensureCardPurchasesLoaded(elements, h.state);
  assert.equal(h.state.cardPurchases.length, 201);
  assert.equal(h.state.cardPurchases[0].id, 'last');
  assert.equal(elements.cardTransactionsTitle.textContent, 'Card Transactions (201)');
  assert.deepEqual(calls, [1, 2].map(page => ['Deals', 'old', 'Card_Purchases', page, 200]));
});

test('a later-page error hides partial results and count, and refresh can retry', async () => {
  const h = harness(), elements = { cardTransactionsTitle: {}, cardPurchasesBody: {} };
  h.context.crmGetRelatedRecords = async (_, __, ___, options) => {
    if (options.page === 2) throw new Error('Access denied');
    return Array.from({ length: 200 }, (_, i) => ({ id: String(i) }));
  };
  await h.context.ensureCardPurchasesLoaded(elements, h.state);
  assert.equal(h.state.cardPurchases.length, 0);
  assert.equal(h.state.cardPurchasesLoaded, false);
  assert.match(h.state.cardPurchasesError, /page 2.*Access denied/);
  assert.match(elements.cardPurchasesBody.innerHTML, /page 2/);
  assert.equal(elements.cardTransactionsTitle.textContent, 'Card Transactions');
  h.context.crmGetRelatedRecords = async () => [];
  await h.context.refreshCardPurchases(elements, h.state);
  assert.equal(h.state.cardPurchasesLoaded, true);
  assert.equal(elements.cardTransactionsTitle.textContent, 'Card Transactions (0)');
});

test('full page followed by empty page confirms the exact boundary', async () => {
  const h = harness(), pages = [];
  h.context.crmGetRelatedRecords = async (_, __, ___, options) => {
    pages.push(options.page);
    return options.page === 1 ? Array.from({ length: 200 }, (_, i) => ({ id: String(i) })) : [];
  };
  await h.context.ensureCardPurchasesLoaded({}, h.state);
  assert.equal(h.state.cardPurchases.length, 200);
  assert.deepEqual(pages, [1, 2]);
});

test('repeated pages, foreign bookings and an unconfirmed pagination limit never become a complete list', async () => {
  for (const mode of ['repeat', 'foreign', 'limit', 'malformed']) {
    const h = harness();
    h.context.crmGetRelatedRecords = async (_, __, ___, options) => {
      if (mode === 'foreign') return [{ id: 'wrong', Booking: { id: 'other' } }];
      if (mode === 'malformed') return [null];
      return Array.from({ length: 200 }, (_, i) => ({ id: String((mode === 'repeat' ? 0 : options.page * 200) + i) }));
    };
    await h.context.ensureCardPurchasesLoaded({}, h.state);
    assert.equal(h.state.cardPurchasesLoaded, false, mode);
    assert.equal(h.state.cardPurchases.length, 0, mode);
    assert.match(h.state.cardPurchasesError, /repeated|association|pagination limit/);
  }
});

test('switching bookings between pages stops pagination without publishing old results', async () => {
  const h = harness();
  const loading = h.context.ensureCardPurchasesLoaded({}, h.state);
  h.pending[0].resolve(Array.from({ length: 200 }, (_, i) => ({ id: String(i) })));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.pending.length, 2);
  h.state.selectedBookingId = 'new';
  h.state.bookingWorkspaceRequestId++;
  h.pending[1].resolve(Array.from({ length: 200 }, (_, i) => ({ id: 'old-' + i })));
  await loading;
  assert.equal(h.pending.length, 2);
  assert.equal(h.state.cardPurchases.length, 0);
});
