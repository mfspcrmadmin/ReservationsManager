const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../app/js/booking-communication.js'), 'utf8');
function load(execute = () => assert.fail('Unexpected CRM write')) {
  const context = vm.createContext({ recordEditLocks: require("./helpers/record-edit-locks.cjs"), Intl, crmExecuteFunction: execute });
  vm.runInContext(source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''), context);
  return context;
}
const original = { id: 'one', body: 'DÍA 06: hotel\nQuoted "}" and \\ path', author: 'María', authorId: '123', at: '2026-09-15T10:03:11.461Z', formatting: [] };
const doc = { version: 1, notes: [original], legacyText: 'Keep previous notes', extra: { keep: true } };
const prefix = JSON.stringify(doc);
const text = 'DÍA 06: la descripcion del hotel no sale\n\nDÍA 11: pick up 07.45am';
const raw = prefix + '\n\n\\-----------------\n\n' + text;

test('recovers appended text as one undated note while preserving all existing metadata', () => {
  const c = load();
  const recovered = c.recoverReviewNotes(raw);
  assert.equal(recovered.jsonPrefix, prefix);
  const saved = JSON.parse(JSON.stringify(recovered.doc));
  assert.deepEqual(saved.notes[0], original);
  assert.equal(saved.legacyText, doc.legacyText);
  assert.deepEqual(saved.extra, doc.extra);
  assert.deepEqual(saved.notes[1], { id: 'imported-review-note', body: text, formatting: [], author: 'Imported text', at: '' });
  assert.equal(c.parseNotesField(raw, 'Review_Notes').notes.length, 2);
  assert.equal(c.recoverReviewNotes(JSON.stringify(saved)), null);
  assert.throws(() => c.parseNotesField(raw, 'Accounting_Notes'));
});

test('handles nested JSON, escaped quotes and braces without truncating note text', () => {
  const c = load();
  for (const body of ['{}', '\\"}\\', 'quoted "{"', 'Ends in slash\\']) {
    const head = ' \n' + JSON.stringify({ version: 1, notes: [{ ...original, body }] });
    const recovered = c.recoverReviewNotes(head + '\nText with { braces }\n---\nKeep separator inside text');
    assert.equal(recovered.jsonPrefix, head);
    assert.equal(recovered.doc.notes[0].body, body);
    assert.equal(recovered.doc.notes[1].body, 'Text with { braces }\n---\nKeep separator inside text');
  }
});

test('supports CRLF and plain appended text, ignoring separator-only tails', () => {
  const c = load();
  for (const tail of ['\r\n---\r\n' + text, '\n' + text, '\n---\n\\-----\n' + text]) {
    assert.equal(c.recoverReviewNotes(prefix + tail).doc.notes[1].body, text);
  }
  assert.equal(c.recoverReviewNotes(prefix + '\n---\n').doc.notes.length, 1);
  assert.equal(c.recoverReviewNotes(prefix + ' \n\t'), null);
});

test('does not guess at broken or unsupported JSON or import ordinary legacy text', () => {
  const c = load();
  for (const value of ['{"version":2,"notes":[]}\nTail', '{"version":1,"notes":[}\nTail', prefix.slice(0, -2) + '\nTail']) {
    assert.throws(() => c.parseNotesField(value, 'Review_Notes'));
  }
  assert.equal(c.recoverReviewNotes('Existing free text'), null);
  assert.equal(c.parseNotesField('Existing free text', 'Review_Notes').legacyText, 'Existing free text');
});

test('chooses a stable unused ID and keeps identical external text as a separate note', () => {
  const c = load();
  const head = JSON.stringify({ version: 1, notes: [
    { ...original, id: 'imported-review-note-', body: text },
    { ...original, id: 'imported-review-note', body: text }
  ] });
  const recovered = c.recoverReviewNotes(head + '\n' + text);
  assert.equal(recovered.doc.notes[2].id, 'imported-review-note--');
  assert.equal(c.recoverReviewNotes(head + '\n' + text).doc.notes[2].id, recovered.doc.notes[2].id);
});

test('repair sends the exact old value and prefix; reopening repaired notes writes nothing', async () => {
  let calls = 0;
  const c = load(async (name, args) => {
    calls++;
    assert.equal(name, 'reviewnotes_repair');
    assert.deepEqual(JSON.parse(JSON.stringify(args)), { bookingId: '123', actingUserId: '42', expectedNotes: raw, jsonPrefix: prefix });
    return { details: { output: JSON.stringify({ success: true, saved: true, notesJson: JSON.stringify(c.recoverReviewNotes(raw).doc) }) } };
  });
  const saved = await c.repairReviewNotes(raw, '123', '42');
  assert.equal(JSON.parse(saved).notes.length, 2);
  assert.equal(await c.repairReviewNotes(saved, '123', '42'), saved);
  assert.equal(calls, 1);
});

test('repair rejects missing user, oversized fields, conflict and unreadable responses', async () => {
  const c = load();
  await assert.rejects(c.repairReviewNotes(raw, '123', ''), /signed-in/);
  await assert.rejects(c.repairReviewNotes(prefix + '\n' + 'x'.repeat(30000), '123', '42'), /full/);
  for (const response of [{ success: false, message: 'Notes changed in another session' }, {}, { details: { output: 'broken' } }, { success: true, saved: false, notesJson: prefix }]) {
    await assert.rejects(load(async () => response).repairReviewNotes(raw, '123', '42'));
  }
});

test('an expired editor lease prevents repair and note saving before business writes', async () => {
  let calls = 0;
  const { c, nodes } = dialogHarness(async () => { calls++; throw new Error('Must not write'); });
  c.crmGetRecord = async () => ({ Review_Notes: prefix });
  const state = { currentUserId: '42', currentUserName: 'Anna', selectedBooking: { id: '123', Review_Notes: prefix } };
  await c.openBookingCommunicationEditor(state, 'Review_Notes', () => {});
  c.recordEditLocks = { ...require('./helpers/record-edit-locks.cjs'), check: async () => { throw new Error('Editing lock expired'); } };
  nodes.find(node => node.tag === 'form').onsubmit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 0);
  assert.equal(state.selectedBooking.Review_Notes, prefix);
});

function dialogHarness(execute) {
  const nodes = [];
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.parts = {}; this.isConnected = true; this.classList = { add() {} }; nodes.push(this); }
    setAttribute() {}
    addEventListener() {}
    showModal() {}
    append(...children) { this.children.push(...children); }
    prepend(...children) { this.children.unshift(...children); }
    replaceChildren(...children) { this.children = children; }
    querySelector(selector) { return this.parts[selector] ||= new Element(selector); }
    querySelectorAll() { return []; }
    get firstElementChild() { return this.querySelector('first'); }
  }
  const c = load(execute);
  Object.assign(c, {
    document: { createElement: tag => new Element(tag), body: new Element('body') },
    MODULES: { bookings: 'Deals' }, escapeHtml: String,
    crypto: { randomUUID: () => 'new-note' },
    noteEditor: () => ({ node: new Element('editor'), input: {}, read: () => ({ body: 'New response', formatting: [] }) })
  });
  return { c, nodes };
}

test('opening the notes dialog persists repair and updates both booking caches', async () => {
  let calls = 0;
  const { c, nodes } = dialogHarness(async () => {
    calls++;
    return { success: true, saved: true, notesJson: JSON.stringify(c.recoverReviewNotes(raw).doc) };
  });
  c.crmGetRecord = async () => ({ Review_Notes: raw });
  const state = { currentUserId: '42', selectedBooking: { id: '123', Review_Notes: raw }, bookings: [{ id: '123', Review_Notes: raw }] };
  let refreshed = 0;
  await c.openBookingCommunicationEditor(state, 'Review_Notes', () => refreshed++);
  assert.equal(calls, 1);
  assert.equal(refreshed, 1);
  assert.equal(JSON.parse(state.selectedBooking.Review_Notes).notes.length, 2);
  assert.equal(state.bookings[0].Review_Notes, state.selectedBooking.Review_Notes);
  assert.match(nodes.find(node => node.tag === '[role="status"]').textContent, /imported and saved/);
});

test('a rejected repair leaves cached raw notes untouched and offers retry', async () => {
  const { c, nodes } = dialogHarness(async () => ({ success: false, saved: false, message: 'Changed in another session' }));
  c.crmGetRecord = async () => ({ Review_Notes: raw });
  const state = { currentUserId: '42', selectedBooking: { id: '123', Review_Notes: raw } };
  await c.openBookingCommunicationEditor(state, 'Review_Notes', () => assert.fail('Must not publish failed repair'));
  assert.equal(state.selectedBooking.Review_Notes, raw);
  assert.match(nodes.find(node => node.tag === '[role="status"]').textContent, /another session/);
  assert.ok(nodes.some(node => node.textContent === 'Retry'));
});

test('saving repairs newly appended CRM text before sending the normal note save', async () => {
  const order = [];
  const { c, nodes } = dialogHarness(async () => {
    order.push('repair');
    return { success: true, saved: true, notesJson: JSON.stringify(c.recoverReviewNotes(raw).doc) };
  });
  let reads = 0;
  c.crmGetRecord = async () => ({ Review_Notes: ++reads === 1 ? prefix : raw });
  c.window = { ReviewNotesSave: { save: async args => {
    order.push('save');
    assert.equal(JSON.parse(args.expectedNotes).notes.length, 2);
    assert.equal(JSON.parse(args.notes).notes.length, 3);
    return { notesJson: args.notes };
  } } };
  const state = { currentUserId: '42', currentUserName: 'Anna', selectedBooking: { id: '123', Review_Notes: prefix } };
  await c.openBookingCommunicationEditor(state, 'Review_Notes', () => {});
  nodes.find(node => node.tag === 'form').onsubmit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, ['repair', 'save']);
  assert.equal(JSON.parse(state.selectedBooking.Review_Notes).notes.length, 3);
});
