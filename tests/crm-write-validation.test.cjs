const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const api = fs.readFileSync(require.resolve('../app/js/api.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const success = { code: 'SUCCESS', status: 'success', details: { id: '123' } };
const failure = { code: 'INVALID_DATA', status: 'error', message: 'Invalid URL', details: { api_name: 'Axus_Link' } };
function setup(response, rejected = false) {
  const calls = [];
  const send = async request => { calls.push(request); if (rejected) throw response; return response; };
  const context = vm.createContext({ recordEditLocks: require("./helpers/record-edit-locks.cjs"), ZOHO: { CRM: { API: { updateRecord: send, insertRecord: send, getRecord: async () => ({ data: [{ id: "123", Modified_Time: "v1" }] }) } } } });
  context.extractRecords = value => value?.data || [];
  vm.runInContext(api, context);
  return { context, calls };
}
for (const method of ['crmUpdateRecord', 'crmCreateRecord']) {
  for (const envelope of [success, [success], { data: [success] }, { records: [success] }, { body: JSON.stringify({ data: [success] }) }]) {
    test(method + ' accepts one confirmed record: ' + JSON.stringify(envelope), async () => {
      const f = setup(envelope);
      const result = await f.context[method]('Deals', { id: '123', Axus_Link: 'https://example.com' });
      assert.equal(result.details.id, '123');
      assert.deepEqual(Array.from(f.calls[0].Trigger), ['workflow']);
      assert.equal(f.calls.length, 1);
    });
  }
  for (const rejected of [false, true]) test(method + ' preserves explicit nested errors and field details, rejected=' + rejected, async () => {
    const f = setup({ responseText: JSON.stringify({ data: [failure] }) }, rejected);
    await assert.rejects(f.context[method]('Deals', { id: '123' }), error => error.code === 'INVALID_DATA' && error.details.api_name === 'Axus_Link' && !error.resultUncertain && /Invalid URL.*Axus_Link/.test(error.message));
    assert.equal(f.calls.length, 1);
  });
  for (const response of [null, {}, { data: [] }, { data: [{ code: 'SUCCESS' }] }, { data: [{ id: '123' }] }, 'not JSON', { data: [success, failure] }, { ...failure, data: [success] }]) {
    test(method + ' rejects missing or contradictory confirmation: ' + JSON.stringify(response), async () => {
      const f = setup(response);
      await assert.rejects(f.context[method]('Deals', { id: '123' }));
      assert.equal(f.calls.length, 1);
    });
  }
  test(method + ' treats a lost response as uncertain and never retries', async () => {
    const f = setup(Object.assign(new Error('Connection lost'), { code: 'ECONNRESET' }), true);
    await assert.rejects(f.context[method]('Deals', { id: '123' }), error => error.resultUncertain && error.code === 'CRM_WRITE_UNCONFIRMED' && /Check CRM/.test(error.message));
    assert.equal(f.calls.length, 1);
  });
}
test('updates reject a success acknowledgement for another record', async () => {
  const f = setup({ data: [{ ...success, details: { id: 'other' } }] });
  await assert.rejects(f.context.crmUpdateRecord('Deals', { id: '123' }), error => error.resultUncertain);
});

test('stale or missing edit versions reject before a CRM update', async () => {
  for (const expectedRecord of [{ Modified_Time: 'old-version' }, {}]) {
    const f = setup({ data: [success] });
    await assert.rejects(f.context.crmUpdateRecord('Deals', { id: '123' }, { expectedRecord }), error => error.code === 'CRM_VERSION_CONFLICT' && error.resultUncertain === false);
    assert.equal(f.calls.length, 0);
  }
});

const controller = fs.readFileSync(require.resolve('../app/js/booking-controller.js'), 'utf8').replace(/\r\n/g, '\n');
const start = controller.indexOf('async function onSaveItineraryLink(');
const handler = controller.slice(start, controller.indexOf('\n}', start) + 2);
function manual(response) {
  const f = setup(response), errors = [], button = { disabled: false };
  const booking = { id: '123', Modified_Time: 'v1', Axus_Link: 'https://old.example' };
  const elements = {
    actionItineraryInput: { value: 'https://new.example', focus() {} },
    actionItineraryForm: { hidden: false, querySelector: () => button },
    actionItineraryLink: { classList: { remove() {} } }, actionItineraryEdit: {}
  };
  Object.assign(f.context, { URL, state: { selectedBookingId: '123', selectedBooking: booking, bookingWorkspaceRequestId: 1 }, elements, MODULES: { bookings: 'Deals' },
    setError: (_, message) => errors.push(message), setNotice() {}, renderBookingWorkspace() {} });
  vm.runInContext(handler, f.context);
  return { ...f, errors, elements, booking, button };
}
test('manual AXUS save uses real adapter validation and retains the input on CRM rejection', async () => {
  const f = manual({ data: [failure] });
  await f.context.onSaveItineraryLink({ preventDefault() {} });
  assert.equal(f.booking.Axus_Link, 'https://old.example');
  assert.equal(f.elements.actionItineraryForm.hidden, false);
  assert.equal(f.elements.actionItineraryInput.value, 'https://new.example');
  assert.match(f.errors.at(-1), /Invalid URL.*Axus_Link/);
  assert.equal(f.button.disabled, false);
});
test('manual AXUS save closes only on confirmed success', async () => {
  const f = manual({ data: [success] });
  await f.context.onSaveItineraryLink({ preventDefault() {} });
  assert.equal(f.booking.Axus_Link, 'https://new.example');
  assert.equal(f.elements.actionItineraryForm.hidden, true);
});
test('manual AXUS save blocks double submission and late replies cannot edit the new booking', async () => {
  const f = manual(null);
  let resolve;
  f.context.ZOHO.CRM.API.updateRecord = request => { f.calls.push(request); return new Promise(done => { resolve = done; }); };
  const pending = f.context.onSaveItineraryLink({ preventDefault() {} });
  await f.context.onSaveItineraryLink({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.length, 1);
  const next = { id: '456', Axus_Link: 'https://other.example' };
  Object.assign(f.context.state, { selectedBookingId: '456', selectedBooking: next, bookingWorkspaceRequestId: 2 });
  resolve({ data: [success] });
  await pending;
  assert.equal(next.Axus_Link, 'https://other.example');
  assert.equal(f.elements.actionItineraryForm.hidden, false);
  assert.equal(f.calls[0].APIData.id, '123');
});
