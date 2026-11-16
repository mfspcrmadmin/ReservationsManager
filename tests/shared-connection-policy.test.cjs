const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup() {
  const calls = [];
  const context = vm.createContext({
    recordEditLocks: { write: async (module, id, execute) => { calls.push(['lock', module, id]); return execute(); } },
    executeNativeBlueprint: async args => { calls.push(['native', args]); return { success: true }; },
    ZOHO: { CRM: { FUNCTIONS: { execute: async (name, request) => { calls.push(['remote', name, request]); return { success: true }; } } } }
  });
  vm.runInContext(fs.readFileSync('app/js/api.js', 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''), context);
  return { calls, context };
}

test('the SDK request leaves authenticated context to Zoho and preserves business arguments', async () => {
  const f = setup();
  const args = { serviceIds: '123', communicationPurpose: 'Reservation', actingUserJson: '{"id":"7"}' };
  await f.context.crmExecuteFunction('comm_createcommunicationsforselection', args);
  assert.deepEqual(JSON.parse(f.calls[0][2].arguments), args);
  assert.equal(JSON.parse(f.calls[0][2].arguments).crmAPIRequest, undefined);
});

test('reserved context injection is rejected before remote calls or record locks', async () => {
  for (const key of ['crmAPIRequest', 'crmapirequest', 'CRMAPIREQUEST']) {
    const f = setup();
    await assert.rejects(f.context.crmExecuteFunction('comm_sendcommunicationdraft', { communicationId: '123', [key]: '{"user_info":{"id":"7"}}' }), /supplied by Zoho/);
    assert.equal(f.calls.length, 0);
  }
});

test('non-REST recovery and passenger functions use the authenticated allowlisted record endpoint', async () => {
  for (const name of ['comm_reconcilecommunicationdelivery', 'servicepax_manage']) {
    const f = setup();
    await f.context.crmExecuteFunction(name, { communicationId: '123', serviceId: '456', commit: false, operation: 'untrusted' });
    const call = f.calls.find(call => call[0] === 'remote');
    assert.equal(call[1], 'widget_recordlease');
    const args = JSON.parse(call[2].arguments);
    assert.equal(args.action, 'widget_operation');
    assert.equal(args.crmAPIRequest, undefined);
    assert.equal(JSON.parse(args.requestBody).operation, name);
    assert.equal(JSON.parse(args.requestBody).commit, false);
  }
});

test('valid and incomplete Blueprint requests never fall through to the shared executor', async () => {
  const f = setup();
  await f.context.crmExecuteFunction('blueprint_executetransition', { moduleApiName: 'Deals', recordId: '123' });
  assert.deepEqual(f.calls.map(call => call[0]), ['lock', 'native']);
  for (const args of [undefined, {}, { moduleApiName: 'Deals' }, { recordId: '123' }]) {
    await assert.rejects(f.context.crmExecuteFunction('blueprint_executetransition', args), /workflow target/);
  }
  assert.equal(f.calls.filter(call => call[0] === 'remote').length, 0);
});

test('revoked Administrator privileges block partial sync and contact sync before any work', async () => {
  const source = fs.readFileSync('app/js/booking-controller.js', 'utf8');
  for (const name of ['onRunAdminEzusSync', 'onSyncContactToEzus']) {
    const start = source.indexOf('async function ' + name + '(');
    const end = source.indexOf('\nasync function ', start + 1);
    const messages = [];
    const context = vm.createContext({ state: { selectedBooking: { id: '123' } }, elements: {}, getWidgetPermissions: () => ({ adminActions: false }), setError: (_, message) => messages.push(message) });
    vm.runInContext(source.slice(start, end), context);
    await context[name]('services', 'Services');
    assert.equal(messages.length, 1);
    assert.match(messages[0], /Administrator profile in User Relationships/);
  }
});
