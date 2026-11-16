const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = {};
vm.runInNewContext(fs.readFileSync('app/js/accounting-notes-save.js', 'utf8'), { window });
const api = window.AccountingNotesSave;
const args = { bookingId: '123', currentUserId: '456', expectedNotes: '', notes: '{"version":1,"notes":[]}' };
test('accounting saves through its function with author, previous value and server-normalized notes', async () => {
  const saved = await api.save({ ...args, executeFunction: async (name, input) => {
    assert.equal(name, 'accountingnotes_saveandnotify');
    assert.equal(input.actingUserId, '456');
    assert.equal(input.expectedNotes, '');
    return { details: { output: JSON.stringify({ success: true, saved: true, notesJson: 'normalized', notificationStatus: 'sent', diagnostics: { recipientEmail: 'requester@example.com' } }) } };
  } });
  assert.equal(saved.notesJson, 'normalized');
  assert.match(saved.notificationMessage, /requester@example.com/);
  assert.equal(saved.notificationWarning, '');
});
test('mail failure after a successful save stays saved and unknown status is never presented as sent', () => {
  for (const status of ['failed', undefined]) {
    const result = api.unpack({ success: true, saved: true, notesJson: args.notes, notificationStatus: status });
    assert.equal(result.saved, true);
    assert.ok(result.notificationWarning);
  }
  for (const status of ['skipped_same_user', 'skipped_no_context', 'unchanged']) {
    assert.equal(api.unpack({ success: true, saved: true, notesJson: args.notes, notificationStatus: status }).notificationWarning, '');
  }
});
test('conflicts, missing identity and malformed responses cannot silently fall back to a direct write', async () => {
  assert.throws(() => api.unpack({ success: false, saved: false, message: 'Changed in another session' }), /another session/);
  assert.throws(() => api.unpack({ details: { output: 'broken' } }), /unreadable/);
  await assert.rejects(api.save({ ...args, currentUserId: '', executeFunction: () => assert.fail() }), /signed-in user/);
  await assert.rejects(api.save({ ...args, executeFunction: async () => { throw Error('timeout'); } }), /status is unknown/);
});
test('same input does not invoke the server or send another email', async () => {
  const result = await api.save({ ...args, expectedNotes: args.notes, executeFunction: () => assert.fail() });
  assert.equal(result.notificationStatus, 'unchanged');
});
test('server authorization rejection cannot report notes saved or email sent', () => {
  assert.throws(() => api.unpack({
    success: false, saved: false, error: true, status: 'ERROR',
    message: 'Your widget permissions could not be verified.'
  }), /permissions could not be verified/);
});