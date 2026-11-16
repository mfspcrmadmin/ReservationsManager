const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app/js/booking-controller.js'), 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('async function onRefreshServicesClick(');
const handler = source.slice(start, source.indexOf('\n}', start) + 2);
function setup() {
  const state = { selectedBookingId: '1', bookingWorkspaceRequestId: 1, services: [{ id: 'old' }], serviceFilters: { supplier: 'Supplier' }, serviceView: 'grouped' };
  const button = { classList: { add() {}, remove() {} }, setAttribute() {} };
  const errors = [], snapshots = [];
  let finish;
  const context = vm.createContext({ state, elements: { refreshServices: button, loadBooking: { disabled: false } },
    loadBookingServicesForBooking: () => new Promise(resolve => { finish = resolve; }),
    loadBookingStepsForBooking: async () => [{ id: 'step' }],
    createSelectionSnapshot: () => ({ selectedServiceId: 'old' }),
    restoreSelectionSnapshot: value => snapshots.push(value),
    indexSteps: (state, steps) => { state.stepIndex = Object.fromEntries(steps.map(step => [step.id, step])); },
    applyServiceFilter() {}, renderBookingSummary() {}, setError: (_, message) => errors.push(message)
  });
  vm.runInContext(handler, context);
  return { context, state, button, errors, snapshots, finish: value => finish(value) };
}
test('services refresh reloads services and steps while preserving filters and view, and blocks duplicate clicks', async () => {
  const f = setup();
  const pending = f.context.onRefreshServicesClick();
  assert.equal(f.button.disabled, true);
  await f.context.onRefreshServicesClick();
  f.finish([{ id: 'new', Service_Date: '2026-12-01' }, { id: 'old', Service_Date: '2026-01-01' }]);
  await pending;
  assert.deepEqual(f.state.services.map(service => service.id), ['old', 'new']);
  assert.equal(f.state.stepIndex.step.id, 'step');
  assert.equal(f.snapshots.length, 1);
  assert.equal(f.state.serviceFilters.supplier, 'Supplier');
  assert.equal(f.state.serviceView, 'grouped');
  assert.equal(f.button.disabled, false);
});
test('services refresh ignores stale bookings and keeps old data on failure', async () => {
  const f = setup();
  const pending = f.context.onRefreshServicesClick();
  f.state.bookingWorkspaceRequestId++;
  f.finish([{ id: 'stale' }]);
  await pending;
  assert.equal(f.state.services[0].id, 'old');
  f.context.loadBookingServicesForBooking = async () => { throw new Error('Denied'); };
  await f.context.onRefreshServicesClick();
  assert.match(f.errors[0], /Denied/);
  assert.equal(f.state.services[0].id, 'old');
  assert.equal(f.state.servicesRefreshing, false);
});
