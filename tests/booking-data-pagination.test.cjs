const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../app/js/data.js'), 'utf8')
  .replace(/^import[\s\S]*?from ["'][^"']+["'];\r?\n/gm, '').replace(/^export /gm, '');
const row = id => ({ id: String(id), Booking: { id: 'booking' } });
function setup(search) {
  const calls = [];
  const context = vm.createContext({
    MODULES: { bookingServices: 'Booking_Services', bookingSteps: 'Booking_Steps' },
    escapeCriteriaValue: String,
    crmGetAllRecords: () => assert.fail('Never scan the complete module'),
    crmSearchRecord: async (...args) => { calls.push(args); return search(...args); }
  });
  vm.runInContext(source, context);
  return { context, calls };
}
for (const [loader, module] of [['loadBookingServicesForBooking', 'Booking_Services'], ['loadBookingStepsForBooking', 'Booking_Steps']]) {
  test(loader + ' loads every booking page and preserves records', async () => {
    const f = setup((_, criteria, page) => page < 3
      ? Array.from({ length: 200 }, (_, index) => row((page - 1) * 200 + index)) : [row(400)]);
    const rows = await f.context[loader]('booking');
    assert.equal(rows.length, 401);
    assert.equal(rows.at(-1).id, '400');
    assert.deepEqual(f.calls, [1, 2, 3].map(page => [module, '(Booking:equals:booking)', page, 200]));
  });
  test(loader + ' accepts empty bookings and an empty final page', async () => {
    const empty = setup(() => []);
    assert.equal((await empty.context[loader]('booking')).length, 0);
    assert.equal(empty.calls.length, 1);
    const exact = setup((_, __, page) => page === 1 ? Array.from({ length: 200 }, (_, i) => row(i)) : []);
    assert.equal((await exact.context[loader]('booking')).length, 200);
    assert.equal(exact.calls.length, 2);
  });
  test(loader + ' rejects a failed later page without returning partial data', async () => {
    const cause = Object.assign(new Error('Access denied'), { code: 'NO_PERMISSION' });
    const f = setup((_, __, page) => { if (page === 2) throw cause; return Array.from({ length: 200 }, (_, i) => row(i)); });
    await assert.rejects(f.context[loader]('booking'), error => error.code === 'NO_PERMISSION' && error.cause === cause && /page 2.*Access denied/.test(error.message));
  });
  test(loader + ' rejects foreign, missing and repeated records', async () => {
    for (const rows of [[{ id: '1', Booking: { id: 'other' } }], [{ id: '1' }], [row(1), row(1)], [null]]) {
      const f = setup(() => rows);
      await assert.rejects(f.context[loader]('booking'), /association|repeated/);
    }
    const f = setup(() => Array.from({ length: 200 }, (_, i) => row(i)));
    await assert.rejects(f.context[loader]('booking'), /repeated/);
    assert.equal(f.calls.length, 2);
  });
  test(loader + ' refuses to label a full search limit as complete', async () => {
    const f = setup((_, __, page) => Array.from({ length: 200 }, (_, i) => row(page * 200 + i)));
    await assert.rejects(f.context[loader]('booking'), /search limit.*no partial list/);
    assert.equal(f.calls.length, 10);
  });
  test(loader + ' requires a booking and propagates first-page errors', async () => {
    const f = setup(() => { throw new Error('Connection lost'); });
    await assert.rejects(f.context[loader](''), /Select a booking/);
    assert.equal(f.calls.length, 0);
    await assert.rejects(f.context[loader]('booking'), /page 1.*Connection lost/);
  });
}
