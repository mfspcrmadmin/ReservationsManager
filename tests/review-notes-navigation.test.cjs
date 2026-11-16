const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/js/review-notes-navigation.js'), 'utf8').replace(/^export /gm, ''), context);
const target = { bookingId: '616617000123456789', view: 'review-notes' };

test('Desk conversion link preserves the booking ID and opens after widget startup', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../_local/integrations/crm/source/convertBRToBooking'), 'utf8');
  const parts = source.match(/bookingsManagerUrl = "([^"]+)" \+ dealId.toString\(\) \+ "([^"]+)"/);
  assert.ok(parts);
  const url = new URL(parts[1] + target.bookingId + parts[2]);
  assert.equal(url.pathname, '/crm/org20093299576/tab/WebTab3');
  const params = url.searchParams.get('widgetparams');
  assert.deepEqual(JSON.parse(params), { bookingId: target.bookingId, view: 'booking' });
  const opened = [];
  const nav = context.createReviewNotesNavigation({ parseTarget: context.parseBookingTarget, open: async id => opened.push(id), onError: assert.fail });
  await nav.receive({ widgetparams: params });
  assert.deepEqual(opened, []);
  await nav.start();
  assert.deepEqual(opened, [target.bookingId]);
  assert.equal(context.parseReviewNotesTarget({ widgetparams: params }), null);
  assert.equal(context.parsePrepaymentTarget({ widgetparams: params }), null);
});

test('booking links accept host payload forms and reject invalid IDs', () => {
  const bookingTarget = { ...target, view: 'booking' };
  for (const payload of [bookingTarget, JSON.stringify(bookingTarget), { widgetparams: bookingTarget }]) {
    assert.equal(context.parseBookingTarget(payload).bookingId, target.bookingId);
  }
  assert.equal(context.parseBookingTarget(target), null);
  assert.equal(context.parseBookingTarget({ Entity: 'Deals' }), null);
  for (const bookingId of [616617000123456789, '', '../123', null]) {
    assert.throws(() => context.parseBookingTarget({ ...bookingTarget, bookingId }));
  }
});
test('accepts CRM PageLoad state and rejects imprecise or invalid IDs', () => {
  assert.equal(context.parseReviewNotesTarget(target).bookingId, target.bookingId);
  assert.equal(context.parseReviewNotesTarget({ widgetparams: JSON.stringify(target) }).bookingId, target.bookingId);
  assert.equal(context.parseReviewNotesTarget({ Entity: 'Deals' }), null);
  assert.throws(() => context.parseReviewNotesTarget({ ...target, bookingId: 616617000123456789 }));
  assert.throws(() => context.parseReviewNotesTarget({ ...target, bookingId: '../123' }));
});
test('waits for startup and avoids opening duplicate PageLoad events twice', async () => {
  const opened = [];
  const nav = context.createReviewNotesNavigation({ open: async id => opened.push(id), onError: assert.fail });
  await nav.receive(target);
  assert.equal(opened.length, 0);
  await nav.start();
  await nav.receive(target);
  assert.deepEqual(opened, [target.bookingId]);
  await nav.receive({ ...target, bookingId: '456' });
  assert.deepEqual(opened, [target.bookingId, '456']);
});
test('failed opening is reported and can be retried', async () => {
  const errors = [];
  let attempts = 0;
  const nav = context.createReviewNotesNavigation({ open: async () => { if (++attempts === 1) throw new Error('No access'); }, onError: error => errors.push(error.message) });
  await nav.start();
  await nav.receive(target);
  await nav.receive(target);
  assert.deepEqual(errors, ['No access']);
  assert.equal(attempts, 2);
});
test('email template passes the booking as a string and only links for the Owner', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../reconfirmationManager/crm/reviewNotes_saveAndNotify.dg'), 'utf8');
  const prefix = source.match(/bookingLink = "([^"]+)" \+ bookingId \+ "([^"]+)"/);
  assert.ok(prefix);
  const url = new URL(prefix[1] + target.bookingId + prefix[2]);
  assert.equal(url.pathname, '/crm/org20093299576/tab/WebTab3');
  assert.deepEqual(JSON.parse(url.searchParams.get('widgetparams')), target);
  assert.match(source, /if\(recipientId == ownerId\)/);
  assert.doesNotMatch(source, /tab\/Potentials/);
});
