const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app/js/travelers-controller.js'), 'utf8');
function setup() {
  const pending = [];
  const state = { selectedBookingId: 'one', travelers: [], travelersLoadedBookingId: '' };
  const c = vm.createContext({ state, elements: {}, console: { debug() {} },
    renderActiveTab() {}, renderTravelersPanel() {},
    normalizeComparableText: value => String(value || '').toLowerCase(),
    crmExecuteFunction: (_, args) => new Promise((resolve, reject) => pending.push({ args, resolve, reject }))
  });
  vm.runInContext(source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''), c);
  // Keep the real loading and rendering lifecycle; isolate the function output parser.
  c.loadTravelersForBooking = id => new Promise((resolve, reject) => pending.push({ id, resolve, reject }));
  return { c, state, pending };
}
test('forced refresh supersedes an in-flight pre-sync passenger load', async () => {
  const { c, state, pending } = setup();
  const old = c.ensureBookingTravelersLoaded();
  const fresh = c.ensureBookingTravelersLoaded(true);
  pending[0].resolve([{ id: 'old' }]);
  await old;
  assert.equal(state.travelersLoading, true);
  assert.equal(state.travelers.length, 0);
  pending[1].resolve([{ id: 'new' }]);
  await fresh;
  assert.equal(state.travelers[0].id, 'new');
  assert.equal(state.travelersLoading, false);
});
test('a previous booking passenger response or failure cannot overwrite the current booking', async () => {
  for (const fail of [false, true]) {
    const { c, state, pending } = setup();
    const first = c.ensureBookingTravelersLoaded();
    state.selectedBookingId = 'two';
    c.resetTravelersState();
    const second = c.ensureBookingTravelersLoaded();
    pending[1].resolve([{ id: 'two-pax' }]);
    await second;
    if (fail) pending[0].reject(new Error('Old request failed'));
    else pending[0].resolve([{ id: 'old-pax' }]);
    await first;
    assert.equal(state.travelers[0].id, 'two-pax');
    assert.equal(state.travelersLoadedBookingId, 'two');
    assert.equal(state.travelersError, '');
  }
});
