const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({ window: {} });
const source = fs.readFileSync(path.join(__dirname, '../app/js/review-notes-save.js'), 'utf8');
vm.runInContext(source, context);
const { save, unpack } = context.window.ReviewNotesSave;
const options = { bookingId: '123', currentUserId: '42', expectedNotes: '', notes: '{"version":1,"notes":[]}' };
test('both widgets ship the same save contract', () => {
  const sibling = path.join(__dirname, '../../reconfirmationManager/app/review-notes-save.js');
  if (fs.existsSync(sibling)) assert.equal(fs.readFileSync(sibling, 'utf8'), source);
});
test('uses signed-in user and forwards the old value for concurrency checks', async () => {
  let call;
  const result = await save({ ...options, executeFunction: async (name, args) => {
    call = { name, args };
    return { details: { output: JSON.stringify({ success: true, saved: true, notesJson: options.notes, notificationStatus: 'sent' }) } };
  } });
  assert.equal(call.name, 'reviewnotes_saveandnotify');
  assert.equal(call.args.actingUserId, '42');
  assert.equal(call.args.expectedNotes, '');
  assert.equal(result.notificationStatus, 'sent');
});
test('missing user, unavailable field and unchanged content do not execute CRM', async () => {
  const executeFunction = () => assert.fail('Unexpected write');
  await assert.rejects(save({ ...options, currentUserId: '', executeFunction }), /signed-in/);
  await assert.rejects(save({ ...options, expectedNotes: undefined, executeFunction }), /unavailable/);
  assert.equal((await save({ ...options, notes: '', executeFunction })).notificationStatus, 'unchanged');
});
test('rejections and unreadable responses never become successful saves', () => {
  for (const response of [{}, { code: 'success' }, { success: true, saved: false }, { details: { output: 'bad JSON' } }]) assert.throws(() => unpack(response));
  assert.throws(() => unpack({ success: false, message: 'Notes changed in another session' }), /another session/);
});
test('email failure keeps the successful save and warning visible', async () => {
  const warning = 'Notes saved, but email failed';
  const result = await save({ ...options, executeFunction: async () => ({ success: true, saved: true, notesJson: options.notes, notificationStatus: 'failed', notificationWarning: warning }) });
  assert.equal(result.saved, true);
  assert.equal(result.notificationWarning, warning);
});

test('every notification outcome is visible and failed status cannot silently show Saved', () => {
  const base = { success: true, saved: true, notesJson: options.notes };
  assert.match(unpack({ ...base, notificationStatus: 'skipped_same_user' }).notificationMessage, /same user/);
  assert.match(unpack({ ...base, notificationStatus: 'unchanged' }).notificationMessage, /No email/);
  assert.match(unpack({ ...base, notificationStatus: 'failed' }).notificationWarning, /email failed/);
  assert.match(unpack(base).notificationWarning, /did not report/);
  const sent = unpack({ ...base, notificationStatus: 'sent', diagnostics: { recipientEmail: 'owner@example.com' } });
  assert.match(sent.notificationMessage, /owner@example.com/);
  assert.equal(sent.notificationMessage, 'Notes saved. Email sent (owner@example.com).');
});

test('Deluge failures expose phase and reason while retaining saved notes', () => {
  const result = unpack({ success: true, saved: true, notesJson: options.notes, notificationStatus: 'failed',
    diagnostics: { phase: 'send_email', error: 'Sender not authorized' } });
  assert.equal(result.notesJson, options.notes);
  assert.match(result.notificationWarning, /send_email.*Sender not authorized/);
  assert.throws(() => unpack({ success: false, message: 'Cannot resolve recipient', diagnostics: { phase: 'resolve_user_relationships' } }), /Cannot resolve recipient.*resolve_user_relationships/);
});

test('rejected SDK requests retain structured errors and do not retry', async () => {
  let calls = 0;
  await assert.rejects(save({ ...options, executeFunction: async () => {
    calls++;
    throw { responseText: JSON.stringify({ code: 'INVALID_DATA', message: 'Function not found' }) };
  } }), /INVALID_DATA.*Function not found.*status is unknown/);
  assert.equal(calls, 1);
});

test('diagnostic console output excludes note bodies and full SDK responses', () => {
  const logs = [];
  const isolated = vm.createContext({ window: { console: { info: (...args) => logs.push(args) } } });
  vm.runInContext(source, isolated);
  isolated.window.ReviewNotesSave.unpack({ success: true, saved: true, notesJson: 'private-note-content',
    notificationStatus: 'sent', diagnostics: { phase: 'sendmail_completed', recipientEmail: 'owner@example.com', html: 'private-email-body' } });
  assert.match(JSON.stringify(logs), /sendmail_completed/);
  assert.doesNotMatch(JSON.stringify(logs), /private-note-content|private-email-body/);
});
