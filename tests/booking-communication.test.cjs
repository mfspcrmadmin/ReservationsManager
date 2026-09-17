const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");
const source = fs.readFileSync(require("node:path").join(__dirname, "../app/js/booking-communication.js"), "utf8");
const context = vm.createContext({ Intl, escapeHtml: value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") });
vm.runInContext(source.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, ""), context);
const note = { id: "one", body: "Hello <team>", author: "Anna", at: "2026-09-14T10:00:00Z", formatting: [{ start: 0, end: 5, bold: true, underline: true }] };
test("24h notes preserve formatting, other authors and document extensions when adding", () => {
  const raw = JSON.stringify({ version: 1, extra: true, notes: [note] });
  const added = { ...note, id: "two", author: "Maria" };
  const saved = JSON.parse(context.appendCommunicationNote(raw, added));
  assert.equal(saved.extra, true);
  assert.deepEqual(saved.notes, [note, added]);
  assert.equal(JSON.parse(context.appendCommunicationNote(JSON.stringify(saved), added)).notes.length, 2);
  assert.equal(context.renderCommunicationNote(note), "<u><strong>Hello</strong></u> &lt;team&gt;");
});
test("missing, malformed and unsupported notes cannot be overwritten", () => {
  for (const raw of [undefined, "broken", '{"version":2,"notes":[]}', JSON.stringify({ version: 1, notes: [{ ...note, formatting: [{ start: -1, end: 2 }] }] })]) {
    assert.throws(() => context.appendCommunicationNote(raw, note));
  }
  assert.equal(context.parseCommunicationNotes(null).notes.length, 0);
  assert.throws(() => context.appendCommunicationNote("", { ...note, body: "x".repeat(30000) }));
});
test("communication displays CRM fields and note content safely with unavailable states", () => {
  const html = context.renderBookingCommunication({ Warnings_OP_GE: "<script>alert(1)</script>", Review_Notes: JSON.stringify({ version: 1, notes: [note] }) });
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Anna/);
  assert.match(html, /Field unavailable/);
  assert.match(html, /Add \/ Manage notes/);
  assert.doesNotMatch(context.renderBookingCommunication({}), /Add \/ Manage notes/);
});

test("editing and deleting a note retain other notes and reject stale edits", () => {
  const other = { ...note, id: "two", author: "Maria" };
  const raw = JSON.stringify({ version: 1, notes: [note, other], extra: "keep" });
  const edited = { ...note, body: "Updated", formatting: [], editedAt: "2026-09-14T12:00:00Z" };
  const saved = context.changeCommunicationNote(raw, edited, note);
  assert.deepEqual(JSON.parse(saved), { version: 1, notes: [edited, other], extra: "keep" });
  assert.throws(() => context.changeCommunicationNote(saved, note, note), /another session/);
  assert.throws(() => context.changeCommunicationNote(saved, note, note, true), /another session/);
  const removed = JSON.parse(context.changeCommunicationNote(saved, edited, edited, true));
  assert.deepEqual(removed.notes, [other]);
  assert.equal(removed.extra, "keep");
});

test("Review Notes retain existing free text without inventing its author or date", () => {
  const oldText = "Check arrival\nConfirm the birthday cake <PAX>";
  const saved = context.changeCommunicationNote(oldText, note, undefined, false, "Review_Notes");
  const doc = JSON.parse(saved);
  assert.equal(doc.legacyText, oldText);
  assert.deepEqual(doc.notes, [note]);
  assert.equal(JSON.parse(context.changeCommunicationNote(saved, note, note, true, "Review_Notes")).legacyText, oldText);
  assert.throws(() => context.changeCommunicationNote('{"version":2}', note, undefined, false, "Review_Notes"));
  assert.throws(() => context.changeCommunicationNote(oldText, note));
});

test("requested text fields and review notes remain editable while 24h notes are unavailable", async () => {
  const html = context.renderBookingCommunication({
    Warnings_OP_GE: "Warning", Important_changes_logistic_explanation: "Logistics",
    PAX_INFO_celebrations_special_requests_or_intere: "Birthday", Operations_Notes: "Removed",
    Review_Notes: "Existing review", h_Notes: ""
  }, "h_Notes");
  for (const field of ["Warnings_OP_GE", "Important_changes_logistic_explanation", "PAX_INFO_celebrations_special_requests_or_intere", "Review_Notes"]) {
    assert.ok(html.includes('data-communication-edit="' + field + '"'));
  }
  assert.doesNotMatch(html, /Operations Notes|Removed/);
  assert.match(html, /Previous review notes/);
  assert.equal((html.match(/Manage notes/g) || []).length, 1);
  assert.doesNotMatch(html, /data-communication-(edit|switch)="h_Notes"/);
  assert.match(html, /aria-disabled="true" disabled>24h Notes/);
  assert.match(html, /role="tooltip">24h Notes is a future feature and is not available yet/);
  await context.openBookingCommunicationEditor({}, "h_Notes", () => assert.fail("Must not save"));
});

test("Review Notes from reconfirmationManager retain undated legacy notes", () => {
  const legacy = { id: 'legacy-review-note', body: 'Existing notes', author: 'Existing review notes', at: '' };
  const raw = JSON.stringify({ version: 1, notes: [legacy] });
  const html = context.renderBookingCommunication({ Review_Notes: raw });
  assert.match(html, /Existing notes/);
  assert.doesNotMatch(html, /Invalid saved note/);
  assert.match(html, /data-communication-edit="Review_Notes"/);
  const saved = context.changeCommunicationNote(raw, note, undefined, false, 'Review_Notes');
  assert.deepEqual(JSON.parse(saved).notes[0], legacy);
});
