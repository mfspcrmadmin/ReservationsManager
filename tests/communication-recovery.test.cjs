const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app/js/booking-controller.js'), 'utf8');
const start = source.indexOf('async function recoverCommunicationCrmUpdates(');
const rest = source.slice(start);
const end = /\r?\n}/.exec(rest);
const fn = rest.slice(0, end.index + end[0].length);
function setup(response) {
  const state = { selectedBookingId: 'b1', bookingWorkspaceRequestId: 1, communicationCrmRecovery: { c1: 'b1' } };
  const calls = [], messages = [];
  const context = vm.createContext({ state, elements: {},
    getSelectedCommunicationRecord: () => ({ communication_id: 'c1' }),
    extractFunctionPayload: x => x,
    crmExecuteFunction: async (name, args) => { calls.push({ name, args }); if (response instanceof Error) throw response; return response; },
    showSendModal: message => messages.push(message),
    refreshCommunicationServices: async () => {}, ensureBookingEmailsLoaded: async () => {}
  });
  vm.runInContext(fn, context);
  return { state, calls, messages, context };
}
test('recovery only calls the CRM-only endpoint and clears confirmed pending work', async () => {
  const f = setup({ success: true, delivery_status: 'sent', reconciliation_required: false });
  await f.context.recoverCommunicationCrmUpdates(true);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].name, 'comm_reconcilecommunicationdelivery');
  assert.equal(f.state.communicationCrmRecovery.c1, undefined);
  assert.equal(f.state.communicationSendAttempts.c1, 'sent');
  assert.match(f.messages.at(-1), /CRM updates completed.*No email was sent again/);
});
test('partial recovery remains retryable without invoking delivery', async () => {
  const f = setup({ success: true, delivery_status: 'sent', reconciliation_required: true });
  await f.context.recoverCommunicationCrmUpdates(true);
  await f.context.recoverCommunicationCrmUpdates(true);
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every(x => x.name === 'comm_reconcilecommunicationdelivery'));
  assert.equal(f.state.communicationCrmRecovery.c1, 'b1');
  assert.match(f.messages.at(-1), /still pending.*Do not resend/);
});
test('unknown delivery, malformed result and network failure never unlock delivery', async () => {
  for (const response of [null, {}, new Error('network'), { success: false, delivery_status: 'unknown' }]) {
    const f = setup(response);
    await f.context.recoverCommunicationCrmUpdates(true);
    assert.equal(f.state.communicationCrmRecovery.c1, 'b1');
    assert.match(f.messages.at(-1), /No email was sent by this action/);
    assert.equal(f.state.communicationCrmRecoveryBusy, false);
  }
});
test('double clicks and booking changes cannot start or display a second recovery', async () => {
  const f = setup({ success: true, delivery_status: 'sent', reconciliation_required: false });
  let release;
  f.context.crmExecuteFunction = async (name, args) => { f.calls.push({name,args}); return new Promise(resolve => { release = resolve; }); };
  const first = f.context.recoverCommunicationCrmUpdates(true);
  await f.context.recoverCommunicationCrmUpdates(true);
  assert.equal(f.calls.length, 1);
  f.state.selectedBookingId = 'b2';
  release({ success: true, delivery_status: 'sent', reconciliation_required: false });
  await first;
  assert.ok(!f.messages.some(x => /CRM updates completed/.test(x)));
});
