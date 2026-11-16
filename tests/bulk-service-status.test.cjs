const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../app/js/bulk-service-status.js'), 'utf8').replace(/^export /gm, '');
function setup() {
  const context = vm.createContext({});
  vm.runInContext(source, context);
  const data = new Map(), writes = [], records = new Map(['a', 'b', 'c'].map(id => [id, { id, Booking: { id: 'booking' }, Status_EZUS: 'Old' }]));
  const options = { userId: 'user', bookingId: 'booking', serviceIds: ['a', 'b', 'c'], target: 'Confirmed', isCurrent: () => true,
    storage: { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) },
    read: async id => records.get(id), update: async (id, status) => { writes.push(id); records.get(id).Status_EZUS = status; return { code: 'SUCCESS', status: 'success', details: { id } }; }
  };
  return { context, data, writes, records, options, run: () => context.runBulkServiceStatus(options) };
}
test('mixed results report each row and retry only rejected writes', async () => {
  const f = setup(), update = f.options.update;
  let reject = true;
  f.options.update = async (id, status) => {
    if (id === 'b' && reject) { f.writes.push(id); throw Object.assign(new Error('Permission denied'), { resultUncertain: false }); }
    return update(id, status);
  };
  const first = await f.run();
  assert.match(f.context.bulkServiceStatusSummary(first), /2 confirmed, 1 failed, 0 unconfirmed/);
  assert.equal(first.complete, false);
  reject = false;
  const second = await f.run();
  assert.equal(second.complete, true);
  assert.deepEqual(f.writes, ['a', 'b', 'c', 'b']);
  assert.equal(f.data.size, 0);
});
test('lost response recovers by reading CRM, without repeating the write after reload', async () => {
  const f = setup(), update = f.options.update;
  f.options.update = async (id, status) => { const result = await update(id, status); if (id === 'b') throw new Error('Connection lost'); return result; };
  const first = await f.run();
  assert.equal(first.rows[1].status, 'uncertain');
  const reloaded = vm.createContext({}); vm.runInContext(source, reloaded);
  assert.equal((await reloaded.runBulkServiceStatus(f.options)).complete, true);
  assert.deepEqual(f.writes, ['a', 'b', 'c']);
});
test('unresolved writes remain blocked across reload and cannot switch target', async () => {
  const f = setup(), update = f.options.update;
  f.options.update = async (id, status) => { if (id === 'b') { f.writes.push(id); throw new Error('Lost before confirmation'); } return update(id, status); };
  await f.run();
  const result = await f.run();
  assert.equal(result.rows[1].status, 'uncertain');
  assert.deepEqual(f.writes, ['a', 'b', 'c']);
  f.options.target = 'Cancelled';
  await assert.rejects(f.run(), /previous status update is unconfirmed/);
});
test('already-matching statuses never run workflows again, and foreign records never write', async () => {
  const f = setup();
  f.records.get('a').Status_EZUS = 'Confirmed';
  f.records.get('b').Booking.id = 'other';
  delete f.records.get('c').Status_EZUS;
  const result = await f.run();
  assert.equal(result.rows[0].status, 'confirmed');
  assert.equal(result.rows[1].status, 'failed');
  assert.equal(result.rows[2].status, 'failed');
  assert.deepEqual(f.writes, []);
});
test('failed verification does not downgrade an uncertain write to retryable', async () => {
  const f = setup();
  f.options.update = async () => { throw new Error('Lost'); };
  await f.run();
  f.options.read = async () => { throw new Error('Read failed'); };
  const result = await f.run();
  assert.ok(result.rows.every(row => row.status === 'uncertain'));
});
test('unconfirmed success acknowledgements are uncertain and never replayed', async () => {
  const f = setup(); let writes = 0;
  f.options.update = async () => { writes++; return {}; };
  await f.run(); await f.run();
  assert.equal(writes, 3);
});
test('journal failure stops before writes and invalid recovery is never cleared', async () => {
  const f = setup();
  f.options.storage.setItem = () => { throw new Error('Storage full'); };
  await assert.rejects(f.run(), /recovery could not be saved/);
  assert.deepEqual(f.writes, []);
  f.options.storage.getItem = () => '{bad';
  await assert.rejects(f.run(), /recovery could not be read/);
});
test('booking switches stop further writes but retain their results for recovery', async () => {
  const f = setup(), update = f.options.update;
  let current = true;
  f.options.isCurrent = () => current;
  f.options.update = async (...args) => { const result = await update(...args); current = false; return result; };
  const result = await f.run();
  assert.equal(result.rows[0].status, 'confirmed');
  assert.equal(result.rows[1].status, 'pending');
  assert.deepEqual(f.writes, ['a']);
  assert.equal(f.data.size, 1);
});

test('recovery cannot write an old pending row that was not selected for this attempt', async () => {
  const f = setup();
  f.options.isCurrent = () => false;
  await f.run();
  f.options.isCurrent = () => true;
  f.options.serviceIds = ['c'];
  const result = await f.run();
  assert.deepEqual(f.writes, ['c']);
  assert.equal(result.rows[0].status, 'pending');
});

function controllerSetup() {
  const f = setup(), errors = [], notices = [];
  const state = { selectedBookingId: 'booking', bookingWorkspaceRequestId: 1, currentUserId: 'user', selectedServiceIds: { a: true, b: true, c: true }, services: [...f.records.values()].map(record => structuredClone(record)) };
  Object.assign(f.context, {
    state, window: { sessionStorage: f.options.storage }, elements: { bulkStatusEzus: { value: 'Confirmed' } }, MODULES: { bookingServices: 'Booking_Services' },
    crmGetRecord: (_, id) => f.options.read(id), crmUpdateRecord: (_, payload) => f.options.update(payload.id, payload.Status_EZUS),
    showLoading() {}, clearLoading() {}, renderServicesWorkspace() {}, syncBulkStatusActionState() {}, closeBulkActionMenus() {},
    setNotice: (_, message) => notices.push(message), setError: (_, message) => errors.push(message)
  });
  const controller = fs.readFileSync(require.resolve('../app/js/services-controller.js'), 'utf8').replace(/\r\n/g, '\n');
  const start = controller.indexOf('export async function onApplyBulkStatus(');
  vm.runInContext(controller.slice(start, controller.indexOf('\n}', start) + 2).replace(/^export /, ''), f.context);
  return { ...f, state, errors, notices };
}

test('controller retains only pending selections and reports partial results', async () => {
  const f = controllerSetup(), update = f.options.update;
  f.options.update = async (id, target) => { if (id === 'b') throw Object.assign(new Error('Denied'), { resultUncertain: false }); return update(id, target); };
  await f.context.onApplyBulkStatus();
  assert.deepEqual(Object.keys(f.state.selectedServiceIds), ['b']);
  assert.equal(f.state.services[0].Status_EZUS, 'Confirmed');
  assert.equal(f.state.services[1].Status_EZUS, 'Old');
  assert.match(f.errors.at(-1), /2 confirmed, 1 failed, 0 unconfirmed/);
  assert.equal(f.state.bulkStatusSaving, false);
});

test('controller blocks duplicate clicks and late results cannot replace a new booking selection', async () => {
  const f = controllerSetup(); let release;
  const read = f.options.read;
  f.options.read = id => new Promise(resolve => { release = () => resolve(f.records.get(id)); });
  const pending = f.context.onApplyBulkStatus();
  await f.context.onApplyBulkStatus();
  f.state.selectedBookingId = 'other';
  f.state.bookingWorkspaceRequestId++;
  f.state.selectedServiceIds = { other: true };
  release(); await pending;
  assert.deepEqual(Object.keys(f.state.selectedServiceIds), ['other']);
  assert.deepEqual(f.writes, []);
  assert.equal(f.state.bulkStatusSaving, false);
});
