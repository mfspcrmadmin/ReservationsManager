const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('app/js/dialogs-controller.js', 'utf8');
const c = vm.createContext({});
vm.runInContext(source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''), c);

test('a confirmed report distinguishes sent, failed, fallback and old backend responses', () => {
  const success = { success: true, notificationStatus: 'sent', notificationRecipient: 'accounting@example.com' };
  assert.equal(c.bookingReportOutcome(success, 'Change request').notice, 'Change request created successfully.');
  assert.equal(c.bookingReportOutcome(success, 'Change request').warning, '');
  assert.match(c.bookingReportOutcome({ ...success, notificationFallback: true }, 'Cancellation').warning, /instead of Administration/);
  for (const status of ['not_attempted', undefined]) {
    const outcome = c.bookingReportOutcome({ success: true, notificationStatus: status }, 'Cancellation');
    assert.match(outcome.notice, /created successfully/);
    assert.equal(outcome.warning, '');
  }
  assert.match(c.bookingReportOutcome({ success: true, notificationStatus: 'failed' }, 'Cancellation').warning, /could not be sent/);
  assert.equal(c.bookingReportOutcome({ success: true, notificationStatus: 'failed', notificationWarning: 'Mail quota exceeded' }, 'Change').warning, 'Mail quota exceeded');
});

test('malformed and failed creation responses never imply a successful report or email', () => {
  for (const value of [null, {}, { status: 'success' }, { success: false }, { success: 'true' }, { success: true, error: true }]) {
    assert.throws(() => c.bookingReportOutcome(value, 'Cancellation'), /could not create/);
  }
  assert.throws(() => c.bookingReportOutcome({ success: false, message: 'Creator unavailable' }, 'Change'), /Creator unavailable/);
});

for (const kind of ['Change', 'Cancellation']) {
  test(kind + ' authorization rejection never reports a created report or sent email', () => {
    assert.throws(() => c.bookingReportOutcome({
      success: false, error: true, status: 'ERROR',
      message: 'Your widget permissions could not be verified.'
    }, kind), /permissions could not be verified/);
  });
}
test('report author comes from the connected user, replacing stale form values', () => {
  const payload = { reported_by: 'owner@example.com', reported_by_name: 'Booking owner' };
  c.setBookingReportActor(payload, { currentUserId: ' 1234567890123456789 ', currentUserEmail: ' actor@example.com ', currentUserName: ' Ana Garcia ' });
  assert.equal(payload.actingUserId, '1234567890123456789');
  assert.equal(payload.reported_by, 'actor@example.com');
  assert.equal(payload.reported_by_name, 'Ana Garcia');
  c.setBookingReportActor(payload, { currentUserId: '1234567890123456789', currentUserEmail: 'actor@example.com' });
  assert.equal(payload.reported_by_name, 'actor@example.com');
  for (const currentUserId of ['', 'invalid', '1e10']) {
    assert.throws(() => c.setBookingReportActor(payload, { currentUserId, currentUserEmail: 'actor@example.com' }), /Reload the widget/);
  }
  c.setBookingReportActor(payload, { currentUserId: '1234567890123456789' });
  assert.equal(payload.actingUserId, '1234567890123456789');
});
