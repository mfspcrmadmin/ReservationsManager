const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const { load: loadPermissions, identity } = require('./helpers/widget-permissions.cjs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app/js/booking-controller.js'), 'utf8').replace(/\r\n/g, '\n');
function extract(name) {
  const start = source.indexOf('async function ' + name + '(');
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
function setup() {
  const booking = { id: 'one', Ezus_Project_ID: 'ezus' };
  const loads = [], calls = [], errors = [], travelerLoads = [];
  let finish;
  const sync = new Promise(resolve => { finish = resolve; });
  const state = { ...identity('Administrator'), selectedBookingId: 'one', selectedBooking: booking, bookings: [booking], bookingIndex: {} };
  const context = vm.createContext({ bookingTasks: { hasPendingChanges: () => false }, bookingDocuments: { reset() {}, sync() {}, async ensure() {} }, state, elements: {}, MODULES: { bookings: 'Deals' },
    crmExecuteFunction: async (name, args) => { calls.push({ name, args }); return sync; },
    crmGetRecord: async () => ({ ...booking, Deal_Name: 'Updated' }),
    extractFunctionPayload: value => value, getFunctionPayloadErrorDetails: value => value?.error || null,
    buildFunctionPayloadError: message => new Error(message),
    cacheBookingLookup: (state, record) => { state.bookingIndex[record.id] = record; },
    loadBookingWorkspace: async (id, options) => { loads.push({ id, options }); state.selectedBooking = { ...booking, Deal_Name: 'Updated' }; state.services = [{ id: 'new-service' }]; if (options.refreshTravelers) await context.ensureBookingTravelersLoaded(true); },
    ensureBookingTravelersLoaded: async force => { travelerLoads.push(force); state.travelers = [{ id: 'new-pax' }]; },
    renderBookingWorkspace() {}, renderBookingSummary() {},
    renderBookingBrowserPanel() {}, setButtonsDisabled() {}, setNotice() {}, clearLoading() {},
    setError: (_, error) => { if (error) errors.push(error); }
  });
  loadPermissions(context);
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../app/js/ezus-sync-guard.js'), 'utf8').replace(/^export /gm, ''), context);
  const guardStart = source.indexOf('function canLeaveBookingWorkspace()');
  vm.runInContext(source.slice(guardStart, source.indexOf('\nfunction setSummaryView', guardStart)), context);
  for (const name of ['refreshSelectedBookingAfterSync', 'onBookingBrowserSync', 'onSyncEzusClick', 'onRunAdminEzusSync', 'onSyncContactToEzus']) vm.runInContext(extract(name), context);
  return { context, state, loads, calls, errors, travelerLoads, finish, booking };
}
const actions = {
  queue: f => f.context.onBookingBrowserSync(f.booking),
  booking: f => f.context.onSyncEzusClick(),
  admin: f => f.context.onRunAdminEzusSync('services', 'Services')
};
test('queue, full and selective sync share one booking lock', async () => {
  for (const first of Object.values(actions)) {
    const f = setup();
    f.booking.Contact_Name = { id: 'contact' };
    const pending = first(f);
    await f.context.onBookingBrowserSync(f.booking);
    await f.context.onSyncEzusClick();
    await f.context.onRunAdminEzusSync('services', 'Services');
    await f.context.onSyncContactToEzus();
    assert.equal(f.calls.length, 1);
    f.finish({ error: false });
    await pending;
    assert.equal(f.state.syncingEzus, false);
    assert.equal(Object.keys(f.state.syncingEzusBookingIds).length, 0);
  }
});
test('unconfirmed and partial responses cannot trigger a successful refresh', async () => {
  for (const run of Object.values(actions)) {
    for (const response of [null, {}, [], 'OK', { success: 'true' }, { success: true, partial: true }, { error: false, serviceSyncErrors: ['failed'] }]) {
      const f = setup(), pending = run(f);
      f.finish(response);
      await pending;
      assert.equal(f.loads.length, 0);
      assert.equal(f.errors.length, 1);
      assert.equal(f.state.syncingEzus, false);
    }
  }
});
test('unsaved notes, status, email and document edits prevent starting sync', async () => {
  for (const kind of ['notes', 'status', 'email', 'document', 'saving']) {
    for (const run of Object.values(actions)) {
      const f = setup();
      f.state.selectedService = { Service_Notes: 'Saved', Status_EZUS: 'Unassigned' };
      if (kind === 'notes') f.context.elements.fieldServiceNotes = { value: 'Unsaved' };
      if (kind === 'status') f.state.serviceStatusDraftValue = 'Confirmed';
      if (kind === 'email') f.state.draftEditorOpen = true;
      if (kind === 'document') f.context.bookingDocuments.hasPendingChanges = () => true;
      if (kind === 'saving') f.state.serviceStatusSaving = true;
      await run(f);
      assert.equal(f.calls.length, 0);
      assert.match(f.errors[0], /Save or cancel/);
    }
  }
});
test('edits begun while sync is in flight are preserved instead of refreshed away', async () => {
  const f = setup();
  const pending = f.context.onSyncEzusClick();
  f.state.draftEditorOpen = true;
  f.state.draftEditorFields = { email_content: 'Keep this' };
  f.finish({ success: true });
  await pending;
  assert.equal(f.loads.length, 0);
  assert.equal(f.state.draftEditorFields.email_content, 'Keep this');
  assert.match(f.errors[0], /Save or cancel/);
});
test('Sync travelers button sends the syncType accepted by the CRM dispatcher', async () => {
  const f = setup();
  const binding = source.match(/elements\.syncTravelers\.addEventListener\("click", function \(\) \{([\s\S]*?)\n  \}\);/);
  assert.ok(binding, 'Travelers button binding exists');
  const pending = vm.runInContext('(async () => { ' + binding[1].replace('onRunAdminEzusSync(', 'return onRunAdminEzusSync(') + ' })()', f.context);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].name, 'sync_runprojectfromezus');
  assert.equal(f.calls[0].args.bookingId, 'one');
  assert.equal(f.calls[0].args.syncType, 'travelers');
  f.finish({ success: true });
  await pending;
  assert.equal(f.errors.length, 0);
  assert.equal(f.loads.length, 0);
  assert.deepEqual(f.travelerLoads, [true]);
});
for (const [name, run] of Object.entries(actions)) {
  test(name + ' sync reloads selected Booking and services after completion', async () => {
    const f = setup();
    const pending = run(f);
    assert.equal(f.loads.length, 0);
    f.finish({ success: true });
    await pending;
    assert.equal(f.errors.length, 0);
    assert.equal(f.loads.length, 1);
    assert.equal(f.loads[0].id, 'one');
    assert.equal(f.loads[0].options.preserveSelection, true);
    assert.equal(f.state.selectedBooking.Deal_Name, 'Updated');
    assert.equal(f.state.services[0].id, 'new-service');
    assert.equal(f.state.bookings[0].Deal_Name, 'Updated');
    assert.equal(f.loads[0].options.refreshTravelers, name !== 'admin');
    assert.equal(f.loads[0].options.preserveTravelers, name === 'admin');
    assert.equal(f.travelerLoads.length, name === 'admin' ? 0 : 1);
  });
  test(name + ' sync never reopens a booking after selecting another', async () => {
    const f = setup();
    const pending = run(f);
    f.state.selectedBookingId = 'two';
    f.state.selectedBooking = { id: 'two' };
    f.finish({ success: true });
    await pending;
    assert.equal(f.loads.length, 0);
    assert.equal(f.state.selectedBooking.id, 'two');
    assert.equal(f.calls[0].args.bookingId, 'one');
  });
  test(name + ' failed sync does not trigger a refresh', async () => {
    const f = setup();
    const pending = run(f);
    f.finish({ error: 'Sync failed' });
    await pending;
    assert.equal(f.loads.length, 0);
    assert.equal(f.errors.length, 1);
  });
}

for (const scope of ['project', 'travelers', 'contact']) {
  test(scope + ' admin refresh preserves services and only reloads passengers when synchronized', async () => {
    const f = setup();
    const services = f.state.services = [{ id: 'kept' }];
    const passengers = f.state.travelers = [{ id: 'kept-pax' }];
    f.booking.Contact_Name = { id: 'contact' };
    const pending = scope === 'contact' ? f.context.onSyncContactToEzus() : f.context.onRunAdminEzusSync(scope, scope);
    f.finish({ success: true });
    await pending;
    assert.deepEqual(f.errors, []);
    assert.equal(f.loads.length, 0);
    assert.equal(f.state.services, services);
    assert.equal(f.state.selectedBooking.Deal_Name, 'Updated');
    if (scope === 'travelers') assert.deepEqual(f.travelerLoads, [true]);
    else assert.equal(f.state.travelers, passengers);
  });
}

test('selective refresh ignores a response after switching bookings', async () => {
  const f = setup();
  let finishRead;
  f.context.crmGetRecord = () => new Promise(resolve => { finishRead = resolve; });
  const refresh = f.context.refreshSelectedBookingAfterSync('one', true, 'travelers');
  f.state.selectedBookingId = 'two';
  f.state.selectedBooking = { id: 'two' };
  finishRead({ id: 'one' });
  await refresh;
  assert.equal(f.state.selectedBooking.id, 'two');
  assert.equal(f.travelerLoads.length, 0);
});

test('full workspace refresh fetches passengers even when Services is the active tab', async () => {
  const f = setup();
  f.state.activeTab = 'services';
  f.state.summaryView = 'basic';
  f.context.elements.bookingSearch = {};
  f.context.loadBookingServicesForBooking = async () => [{ id: 'fresh-service' }];
  f.context.loadBookingStepsForBooking = async () => [];
  f.context.loadBookingBlueprintForBooking = async () => ({});
  f.context.buildBookingLabel = booking => booking.Deal_Name;
  f.context.bookingTasks = { reset() {}, async ensure() {} };
  f.context.automaticNotifications = { reset() {}, async ensure() {} };
  f.context.createSelectionSnapshot = () => ({});
  for (const name of ['showLoading', 'resetServiceFilters', 'resetTravelersState', 'indexSteps', 'restoreSelectionSnapshot', 'ensureDeskTicketLoaded', 'applyServiceFilter', 'renderSelectionPanel', 'renderEmailsPanel', 'renderTravelersWorkspace', 'renderPaymentsWorkspace']) f.context[name] = () => {};
  vm.runInContext(extract('loadBookingWorkspace'), f.context);
  const pending = f.context.onSyncEzusClick();
  f.finish({ success: true });
  await pending;
  assert.deepEqual(f.errors, []);
  assert.equal(f.state.services[0].id, 'fresh-service');
  assert.deepEqual(f.travelerLoads, [true]);
  assert.equal(f.state.travelers[0].id, 'new-pax');
  assert.equal(f.state.selectedBooking.Deal_Name, 'Updated');
});

test('passenger refresh errors propagate instead of announcing a successful admin refresh', async () => {
  const f = setup();
  f.context.ensureBookingTravelersLoaded = async () => { f.state.travelersError = 'Passengers unavailable'; };
  const pending = f.context.onRunAdminEzusSync('travelers', 'Travelers');
  f.finish({ success: true });
  await pending;
  assert.match(f.errors[0], /Passengers unavailable/);
});
