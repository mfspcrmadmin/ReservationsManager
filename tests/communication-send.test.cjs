const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../app/js/booking-controller.js'), 'utf8');
function functionSource(name) {
  const start = source.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
  assert.ok(start >= 0);
  const rest = source.slice(start), end = /\r?\n}/.exec(rest);
  return rest.slice(0, end.index + end[0].length);
}
function setup() {
  const record = { id: 'd1', communication_id: 'c1', from: 'sender@example.test', communication_status: 'Draft' };
  const state = { activeMailTab: 'drafts', selectedBookingId: 'b1', selectedDraftRecordId: 'd1', emailDrafts: [record], mailContentByKey: {}, services: [], selectedServiceId: 's1' };
  const calls = [], messages = [], refreshes = [];
  const context = vm.createContext({
    state, elements: { draftDeleteConfirmModal: {} },
    getMailCacheKey: (_, id) => id,
    findMailRecordById: () => record,
    setError() {}, setNotice() {}, renderEmailsPanel() {}, setTimeout() {}, closeSendModal() {},
    showSendModal: message => messages.push(message),
    extractFunctionPayload: value => value,
    getApiErrorDetails: value => ({ code: value?.code || '', message: value?.message || '' }),
    buildFunctionPayloadError: value => Error(value.message),
    crmExecuteFunction: async (_, args) => { calls.push(args); return { success: true }; },
    ensureBookingEmailsLoaded: async () => {},
    loadBookingServicesForBooking: async id => { refreshes.push(id); return [{ id: 's1', Status_EZUS: 'On Request' }]; },
    applyServiceFilter() {}, renderSelectionPanel() {}, renderBookingSummary() {}
  });
  vm.runInContext(['getFunctionPayloadErrorDetails', 'sendCommunicationOnce', 'refreshCommunicationServices', 'onSendDraftClick'].map(functionSource).join('\n'), context);
  return { context, state, calls, messages, refreshes };
}
test('empty, malformed and lost send responses never claim success or allow a repeat', async () => {
  for (const response of [null, {}, [], { status: 'success' }, { success: 'true' }, 'OK', new Error('network')]) {
    const f = setup();
    f.context.crmExecuteFunction = async (_, args) => { f.calls.push(args); if (response instanceof Error) throw response; return response; };
    await f.context.onSendDraftClick();
    await f.context.onSendDraftClick();
    assert.equal(f.calls.length, 1);
    assert.ok(!f.messages.includes('Email sent successfully.'));
    assert.equal(f.refreshes.length, 0);
  }
});

test('a damaged historical communication does not block a valid draft, while damaged drafts cannot send', async () => {
  const f = setup();
  f.state.emailDrafts.push({ communication_id: 'historical', communication_status: 'Sent', service_links_valid: false, send_blocked: true });
  await f.context.sendCommunicationOnce({ communicationId: 'c1' });
  assert.equal(f.calls.length, 1);
  f.state.emailDrafts.push({ communication_id: 'broken', communication_status: 'Draft', service_links_valid: false, send_blocked: true });
  await assert.rejects(f.context.sendCommunicationOnce({ communicationId: 'broken' }), /service links that need review/);
  assert.equal(f.calls.length, 1);
});
test('double click invokes one send, retaining exact IDs', async () => {
  const f = setup();
  let finish;
  f.context.crmExecuteFunction = async (_, args) => { f.calls.push(args); return new Promise(resolve => { finish = resolve; }); };
  const first = f.context.onSendDraftClick();
  await f.context.onSendDraftClick();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].draftId, 'd1');
  assert.equal(f.calls[0].communicationId, 'c1');
  finish({ success: true });
  await first;
  assert.equal(f.state.emailDrafts[0].communication_status, 'Sent');
});

test('uncertain sends give mailbox and CRM instructions and remain blocked', async () => {
  for (const response of [null, {}, new Error('network'), { success: false, delivery_status: 'unknown' }, { success: true, delivery_status: 'unknown' }]) {
    const f = setup();
    f.context.crmExecuteFunction = async () => { f.calls.push('send'); if (response instanceof Error) throw response; return response; };
    await f.context.onSendDraftClick();
    assert.match(f.messages.at(-1), /Delivery could not be confirmed.*mailbox.*CC copy.*CRM.*No automatic retry/);
    assert.equal(f.state.emailDrafts[0].communication_status, 'Draft');
    assert.equal(f.refreshes.length, 0);
    await f.context.onSendDraftClick();
    assert.equal(f.calls.length, 1);
    assert.match(f.messages.at(-1), /Delivery could not be confirmed/);
  }
});

test('confirmed pre-send rejection preserves its useful validation message without uncertainty warning', async () => {
  const f = setup();
  f.context.crmExecuteFunction = async () => ({ success: false, delivery_status: 'not_sent', message: 'Missing recipient' });
  await f.context.onSendDraftClick();
  assert.equal(f.messages.at(-1), 'Missing recipient');
  assert.equal(f.state.communicationSendAttempts.c1, undefined);
});

test('confirmed delivery survives failed CRM status even when outer success is false', async () => {
  const f = setup();
  f.context.crmExecuteFunction = async () => { f.calls.push('send'); return { success: false, delivery_status: 'sent', reconciliation_required: true, recovery_available: true }; };
  await f.context.onSendDraftClick();
  assert.equal(f.state.emailDrafts[0].communication_status, 'Sent');
  assert.equal(f.state.communicationCrmRecovery.c1, 'b1');
  assert.match(f.messages.at(-1), /Email sent; CRM update pending.*Do not resend/);
  f.state.emailDrafts[0].communication_status = 'Draft';
  await f.context.onSendDraftClick();
  assert.equal(f.calls.length, 1);
});
test('late send and refresh responses do not clear or reload a different booking', async () => {
  for (const phase of ['send', 'refresh']) {
    const f = setup();
    const switchBooking = () => { f.state.selectedBookingId = 'b2'; f.state.selectedDraftRecordId = 'd2'; };
    if (phase === 'send') f.context.crmExecuteFunction = async () => { switchBooking(); return { success: true }; };
    else f.context.ensureBookingEmailsLoaded = async () => { switchBooking(); };
    await f.context.onSendDraftClick();
    assert.equal(f.state.selectedDraftRecordId, 'd2');
    assert.deepEqual(f.refreshes, phase === 'send' ? [] : ['b1']);
    assert.ok(!f.messages.includes('Email sent successfully.'));
  }
});
test('successful send with failed refresh reports delivery and never retries delivery', async () => {
  const f = setup();
  f.context.ensureBookingEmailsLoaded = async () => { throw Error('Refresh unavailable'); };
  await f.context.onSendDraftClick();
  assert.match(f.messages.at(-1), /Email sent.*Do not resend/);
  assert.equal(f.state.services[0].Status_EZUS, 'On Request');
  f.state.emailDrafts[0].communication_status = 'Draft'; // simulate stale list
  await f.context.onSendDraftClick();
  assert.equal(f.calls.length, 1);
});
test('only explicit pre-send rejections permit retry; delivery warnings remain visible', async () => {
  const f = setup();
  let attempts = 0;
  f.context.crmExecuteFunction = async () => ++attempts === 1
    ? { success: false, delivery_status: 'not_sent', message: 'Missing recipient' }
    : { success: true, delivery_status: 'sent', warning: 'Email sent, but status update failed. Do not resend.' };
  await f.context.onSendDraftClick();
  await f.context.onSendDraftClick();
  assert.equal(attempts, 2);
  assert.match(f.messages.at(-1), /status update failed/);
});
test('service reconciliation warning survives failures refreshing emails or services without resending', async () => {
  for (const phase of ['emails', 'services']) {
    const f = setup();
    f.context.crmExecuteFunction = async (_, args) => {
      f.calls.push(args);
      return { success: true, delivery_status: 'sent', warning: 'Could not confirm On Request for Booking Services: [123].' };
    };
    const fail = async () => { throw Error('Refresh unavailable'); };
    if (phase === 'emails') f.context.ensureBookingEmailsLoaded = fail;
    else f.context.loadBookingServicesForBooking = fail;
    await f.context.onSendDraftClick();
    assert.match(f.messages.at(-1), /On Request.*123/);
    assert.match(f.messages.at(-1), /Refresh unavailable/);
    assert.match(f.messages.at(-1), /Do not resend/);
    await f.context.onSendDraftClick();
    assert.equal(f.calls.length, 1);
  }
});
test('confirmed service IDs override stale search results, without changing unrelated services or selections', async () => {
  const f = setup();
  f.state.serviceFilters = { status: ['Draft'] };
  f.state.selectedServiceIds = { s1: true };
  f.context.crmExecuteFunction = async () => ({ success: true, updated_booking_service_ids: ['s1'] });
  f.context.loadBookingServicesForBooking = async () => [{ id: 's1', Status_EZUS: 'Draft' }, { id: 's2', Status_EZUS: 'Confirmed' }];
  await f.context.onSendDraftClick();
  assert.equal(f.state.selectedService.Status_EZUS, 'On Request');
  assert.equal(f.state.services.find(s => s.id === 's2').Status_EZUS, 'Confirmed');
  assert.deepEqual(f.state.serviceFilters, { status: ['Draft'] });
  assert.deepEqual(f.state.selectedServiceIds, { s1: true });
});

test('service refresh cannot overwrite a different booking or a newer workspace load', async () => {
  for (const change of ['booking', 'request']) {
    const f = setup();
    f.context.loadBookingServicesForBooking = async () => {
      if (change === 'booking') f.state.selectedBookingId = 'b2';
      else f.state.bookingWorkspaceRequestId = 2;
      f.state.services = [{ id: 'newer' }];
      return [{ id: 's1', Status_EZUS: 'On Request' }];
    };
    await f.context.sendCommunicationOnce({ communicationId: 'c1', draftId: 'd1' });
    assert.deepEqual(f.state.services, [{ id: 'newer' }]);
  }
});
