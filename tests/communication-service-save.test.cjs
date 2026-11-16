const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../app/js/booking-controller.js'), 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('async function onSaveCommunicationEdit(');
const handler = source.slice(start, source.indexOf('\n}', start) + 2);
function setup(result) {
  const calls = [], errors = [];
  const state = { selectedBookingId: 'booking', bookingWorkspaceRequestId: 1, draftEditorServiceIds: ['service'], draftEditorFields: {}, draftEditorOpen: true };
  let selected = { communication_id: 'comm', draft_id: 'draft' };
  const context = vm.createContext({ recordEditLocks: require("./helpers/record-edit-locks.cjs"), state, elements: {},
    getSelectedCommunicationRecord: () => selected, syncCommunicationEditorFields() {},
    setError: (_, message) => errors.push(message), setNotice() {}, renderEmailsPanel() {}, ensureBookingEmailsLoaded: async () => {},
    crmExecuteFunction: async (name, args) => { calls.push({ name, args }); return name === 'comm_updatecommunicationdraft' ? { success: true } : result; },
    extractFunctionPayload: value => value, getFunctionPayloadErrorDetails: value => value?.success === false ? value : null,
    buildFunctionPayloadError: value => new Error(value.message)
  });
  vm.runInContext(handler, context);
  return { context, state, calls, errors, select: value => { selected = value; } };
}
for (const result of [null, {}, { success: true }, { success: true, service_ids: [] }, { success: true, service_ids: ['foreign'] }, { success: false, message: 'Wrong booking' }]) {
  test('unconfirmed service save retains the editor: ' + JSON.stringify(result), async () => {
    const f = setup(result);
    await f.context.onSaveCommunicationEdit({ preventDefault() {} });
    assert.equal(f.state.draftEditorOpen, true);
    assert.deepEqual(f.state.draftEditorServiceIds, ['service']);
    assert.ok(f.errors.at(-1));
    assert.equal(f.calls.length, 2);
  });
}
test('confirmed exact services close the editor', async () => {
  const f = setup({ success: true, service_ids: ['service'] });
  await f.context.onSaveCommunicationEdit({ preventDefault() {} });
  assert.equal(f.state.draftEditorOpen, false);
});
test('a changed communication cannot receive the original association save', async () => {
  const f = setup({ success: true, service_ids: ['service'] });
  f.context.crmExecuteFunction = async (name, args) => { f.calls.push({ name, args }); f.select({ communication_id: 'other' }); return { success: true }; };
  await f.context.onSaveCommunicationEdit({ preventDefault() {} });
  assert.equal(f.calls.length, 1);
});

test('recovery retries only services, preserves the saved content and clears only after exact acknowledgement', async () => {
  const f = setup({ success: false, message: 'Service save failed' });
  f.state.draftEditorFields = { email_subject: 'Reviewed subject', email_content: '<p>Reviewed content</p>' };
  await f.context.onSaveCommunicationEdit({ preventDefault() {} });
  assert.match(f.errors.at(-1), /Email content saved; service links are not confirmed/);
  assert.equal(f.state.communicationEditRecoveries.comm.fields.email_subject, 'Reviewed subject');
  f.context.crmExecuteFunction = async (name, args) => { f.calls.push({ name, args }); return { success: true, service_ids: ['service'] }; };
  await f.context.onSaveCommunicationEdit({ preventDefault() {} });
  assert.deepEqual(f.calls.map(call => call.name), ['comm_updatecommunicationdraft', 'comm_updatecommunicationservices', 'comm_updatecommunicationservices']);
  assert.equal(f.state.communicationEditRecoveries.comm, undefined);
  assert.equal(f.state.draftEditorOpen, false);
});

test('unconfirmed content never starts service saving or creates a recovery checkpoint', async () => {
  for (const result of [null, {}, { success: false, message: 'Draft rejected' }]) {
    const f = setup(null);
    f.context.crmExecuteFunction = async name => { f.calls.push(name); return result; };
    await f.context.onSaveCommunicationEdit({ preventDefault() {} });
    assert.equal(f.calls.length, 1);
    assert.equal(f.state.communicationEditRecoveries.comm, undefined);
    assert.equal(f.state.draftEditorOpen, true);
  }
});

test('closing and reopening restores the pending selection and saved content', async () => {
  const f = setup({ success: false, message: 'Pending' });
  Object.assign(f.context, { getCommunicationEditorFields: () => ({ email_subject: 'Old CRM display' }) });
  for (const name of ['onCancelCommunicationEdit', 'onEditCommunicationClick', 'recordServices']) {
    const index = source.indexOf('function ' + name + '(');
    vm.runInContext(source.slice(source.lastIndexOf('\n', index) + 1, source.indexOf('\n}', index) + 2), f.context);
  }
  f.state.selectedDraftRecordId = 'draft';
  f.state.draftEditorFields = { email_subject: 'Saved subject' };
  await f.context.onSaveCommunicationEdit({ preventDefault() {} });
  f.context.onCancelCommunicationEdit();
  assert.equal(f.state.draftEditorOpen, false);
  await f.context.onEditCommunicationClick();
  assert.equal(f.state.draftEditorFields.email_subject, 'Saved subject');
  assert.deepEqual(Array.from(f.state.draftEditorServiceIds), ['service']);
});

test('refresh failure after confirmed saving cannot be presented as a pending write', async () => {
  const f = setup({ success: true, service_ids: ['service'] });
  f.context.ensureBookingEmailsLoaded = async () => { throw new Error('Read failed'); };
  await f.context.onSaveCommunicationEdit({ preventDefault() {} });
  assert.equal(f.state.communicationEditRecoveries.comm, undefined);
  assert.match(f.errors.at(-1), /content and service links were saved, but refreshing failed/);
  assert.equal(f.state.draftEditorOpen, false);
});

test('send is blocked before any remote call while editor recovery is pending', async () => {
  const f = setup(null);
  const index = source.indexOf('async function sendCommunicationOnce(');
  vm.runInContext(source.slice(source.lastIndexOf('\n', index) + 1, source.indexOf('\n}', index) + 2), f.context);
  f.state.communicationEditRecoveries = { comm: { serviceIds: ['service'] } };
  await assert.rejects(f.context.sendCommunicationOnce({ communicationId: 'comm' }), /recover the service links before sending/);
  assert.equal(f.calls.length, 0);
});

test('recovery UI explains the partial save and locks content while leaving service recovery available', () => {
  const render = fs.readFileSync(require.resolve('../app/js/render.js'), 'utf8');
  const start = render.indexOf('  const editRecovery =');
  const end = render.indexOf('\n', render.indexOf('elements.mailCancelDraftEdit.textContent', start));
  const elements = Object.fromEntries(['mailEditRecoveryStatus', 'mailEditFrom', 'mailEditTo', 'mailEditCc', 'mailEditSubject', 'mailEditContent', 'mailEditVisual', 'mailSaveDraft', 'mailCancelDraftEdit'].map(name => [name, {}]));
  const state = { communicationEditRecoveries: { comm: {} }, draftEditorSaving: false };
  vm.runInNewContext(render.slice(start, end), { state, elements, viewerRecord: { communication_id: 'comm' } });
  assert.equal(elements.mailSaveDraft.textContent, 'Retry service links');
  assert.equal(elements.mailEditSubject.disabled, true);
  assert.equal(elements.mailEditVisual.contentEditable, 'false');
  assert.equal(elements.mailEditRecoveryStatus.hidden, false);
  assert.match(elements.mailEditRecoveryStatus.textContent, /Email content saved/);
});
