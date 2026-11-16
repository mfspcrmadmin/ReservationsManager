const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function load(file, context = {}) {
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('app/js/' + file, 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''), context);
  return context;
}
test('context produces an escaped link with lossless CRM IDs', () => {
  const c = load('accounting-note-context.js', { escapeHtml: v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;') });
  const context = { type: 'prepayment', bookingId: '5725767000001234567', prepaymentId: '5725767000007654321', name: '<script>', supplier: '<img>', amount: 0 };
  const html = c.renderAccountingNoteContext(context);
  assert.match(html, /&lt;script>/);
  assert.doesNotMatch(html, /<img>/);
  assert.match(html, /0 EUR/);
  const url = new URL(html.match(/href="([^"]+)"/)[1]);
  const target = JSON.parse(url.searchParams.get('widgetparams'));
  assert.equal(target.prepaymentId, context.prepaymentId);
  assert.equal(target.bookingId, context.bookingId);
  assert.equal(c.renderAccountingNoteContext({ ...context, bookingId: 'javascript:bad' }), '');
});
test('prepayment navigation waits for startup and distinguishes payments in one booking', async () => {
  const c = load('review-notes-navigation.js');
  const opened = [];
  const nav = c.createReviewNotesNavigation({ parseTarget: c.parsePrepaymentTarget, open: async (_, target) => opened.push(target.prepaymentId), onError: e => { throw e; } });
  await nav.receive({ widgetparams: JSON.stringify({ view: 'prepayment', bookingId: '123', prepaymentId: '456' }) });
  assert.equal(opened.length, 0);
  await nav.start();
  await nav.receive({ view: 'prepayment', bookingId: '123', prepaymentId: '789' });
  assert.deepEqual(opened, ['456', '789']);
  assert.throws(() => c.parsePrepaymentTarget({ view: 'prepayment', bookingId: 123, prepaymentId: '456' }));
});
test('details reject prepayments from another booking or without a request', async () => {
  let payment = { id: '456', Prepayment_Request: { id: '789' } };
  const c = load('prepayments-controller.js', { MODULES: { prepayments: 'Prepayments', prepaymentRequests: 'Prepayment_Requests' }, crmGetRecord: async entity => entity === 'Prepayments' ? payment : { id: '789', Booking: { id: '123' } } });
  assert.equal((await c.getBookingPrepayment('123', '456')).payment.id, '456');
  await assert.rejects(c.getBookingPrepayment('999', '456'), /does not belong/);
  payment = { id: '456' };
  await assert.rejects(c.getBookingPrepayment('123', '456'), /no request/);
});
test('accounting note context survives adding and editing alongside other notes', () => {
  const c = load('booking-communication.js');
  const note = { id: 'n1', body: 'Please check', author: 'Admin', at: '2026-09-17T12:00:00Z', formatting: [], context: { type: 'prepayment', bookingId: '123', prepaymentId: '456' } };
  const raw = c.changeCommunicationNote('', note, undefined, false, 'Accounting_Notes');
  const updated = c.changeCommunicationNote(raw, { ...note, body: 'Invoice amount is wrong' }, note, false, 'Accounting_Notes');
  assert.deepEqual(JSON.parse(updated).notes[0].context, note.context);
});
