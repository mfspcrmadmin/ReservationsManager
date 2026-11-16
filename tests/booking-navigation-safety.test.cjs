const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const source = fs.readFileSync(path.join(__dirname, "../app/js/booking-controller.js"), "utf8");
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function fixture() {
  const errors = [];
  const context = vm.createContext({
    state: { selectedBookingId: "A", selectedBooking: { id: "A" }, bookingWorkspaceRequestId: 1 },
    elements: { bookingSearch: { value: "A" } },
    bookingDocuments: { hasPendingChanges: () => false },
    bookingTasks: { hasPendingChanges: () => false },
    buildBookingLabel: booking => booking.id,
    setError: (_, message) => errors.push(message),
    renderEmailsPanel() {}, buildEmailLoadErrorMessage: error => error.message
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/js/ezus-sync-guard.js"), "utf8").replace(/^export /gm, ""), context);
  vm.runInContext(extract("function canLeaveBookingWorkspace()", "function setSummaryView") +
    extract("async function ensureBookingEmailsLoaded(", "async function loadBookingBlueprintForBooking(") +
    extract("async function onLoadBookingClick()", "async function onRefreshServicesClick()") +
    extract("async function loadBookingWorkspace(", "async function onWorkspaceActionClick("), context);
  return { context, errors };
}
test("late email success and failure cannot overwrite another workspace or its loading flag", async () => {
  for (const fail of [false, true]) {
    const { context: c } = fixture();
    const pending = deferred();
    c.loadBookingMailRecordsFromFunction = () => pending.promise;
    const loading = c.ensureBookingEmailsLoaded();
    c.state.selectedBookingId = "B";
    c.state.bookingWorkspaceRequestId++;
    c.state.emailDrafts = [{ id: "B-draft" }];
    c.state.emailsLoading = true;
    c.state.draftEmailsError = "B error";
    if (fail) pending.reject(new Error("A error")); else pending.resolve([{ id: "A-draft" }]);
    await loading;
    assert.equal(c.state.emailDrafts[0].id, "B-draft");
    assert.equal(c.state.draftEmailsError, "B error");
    assert.equal(c.state.emailsLoading, true);
  }
});
test("latest email reload wins, including returning to the same booking", async () => {
  const { context: c } = fixture();
  const old = deferred(), fresh = deferred();
  let count = 0;
  c.loadBookingMailRecordsFromFunction = () => (++count === 1 ? old : fresh).promise;
  const first = c.ensureBookingEmailsLoaded();
  c.state.bookingWorkspaceRequestId += 2;
  const second = c.ensureBookingEmailsLoaded(true);
  fresh.resolve([{ id: "fresh" }]); await second;
  old.resolve([{ id: "old" }]); await first;
  assert.equal(c.state.emailDrafts[0].id, "fresh");
  assert.equal(c.state.emailsLoading, false);
});
test("changing and closing a booking preserve pending edits and explain how to continue", async () => {
  for (const kind of ["notes", "status", "draft", "saving", "communication", "documents", "tasks"]) {
    const { context: c, errors } = fixture();
    c.state.selectedService = { Service_Notes: "saved", Status_EZUS: "Unassigned" };
    if (kind === "notes") c.elements.fieldServiceNotes = { value: "unsaved" };
    if (kind === "status") c.state.serviceStatusDraftValue = "Confirmed";
    if (kind === "draft") c.state.draftEditorOpen = true;
    if (kind === "saving") c.state.serviceStatusSaving = true;
    if (kind === "communication") c.state.communicationInlineEdit = true;
    if (kind === "documents") c.bookingDocuments.hasPendingChanges = () => true;
    if (kind === "tasks") c.bookingTasks.hasPendingChanges = () => true;
    c.elements.bookingSearch.value = "B";
    assert.equal(await c.loadBookingWorkspace("B"), false);
    assert.equal(await c.loadBookingWorkspace("A"), false);
    c.onClearBookingClick();
    assert.equal(c.state.selectedBookingId, "A");
    assert.equal(c.state.bookingWorkspaceRequestId, 1);
    assert.equal(c.elements.bookingSearch.value, "A");
    assert.equal(errors.length, 3);
    assert.match(errors[0], /Save or cancel/);
  }
});
test("obsolete search results cannot open a booking after navigation or a new search", async () => {
  for (const change of ["navigation", "input", "new-search"]) {
    const { context: c } = fixture();
    const pending = deferred(), opened = [];
    c.getBookingFromSearch = () => null;
    c.searchBookingByInput = () => pending.promise;
    c.cacheBookingLookup = c.hideSearchResults = () => {};
    c.loadBookingWorkspace = async id => opened.push(id);
    const first = c.onLoadBookingClick();
    if (change === "navigation") c.state.bookingSearchRequestId++;
    else c.elements.bookingSearch.value = "B";
    let second;
    if (change === "new-search") {
      c.searchBookingByInput = async () => [{ id: "B" }];
      second = c.onLoadBookingClick();
    }
    pending.resolve([{ id: "A" }]);
    await first; await second;
    assert.deepEqual(opened, change === "new-search" ? ["B"] : []);
  }
});
test("duplicate links are ignored only while their navigation context is still current", async () => {
  const c = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/js/review-notes-navigation.js"), "utf8").replace(/^export /gm, ""), c);
  let version = 1;
  const opened = [];
  const nav = c.createReviewNotesNavigation({
    getContextKey: () => version,
    open: async id => { opened.push(id); version++; },
    onError: assert.fail
  });
  const target = { view: "review-notes", bookingId: "123" };
  await nav.start();
  await nav.receive(target); await nav.receive(target);
  assert.deepEqual(opened, ["123"]);
  version++; // User navigates elsewhere.
  await nav.receive(target);
  assert.deepEqual(opened, ["123", "123"]);
});

test("a link blocked by pending edits can be retried after saving", async () => {
  const c = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/js/review-notes-navigation.js"), "utf8").replace(/^export /gm, ""), c);
  let dirty = true, attempts = 0;
  const nav = c.createReviewNotesNavigation({
    open: async () => { attempts++; return !dirty; },
    onError: assert.fail
  });
  await nav.start();
  await nav.receive({ view: "review-notes", bookingId: "123" });
  dirty = false;
  await nav.receive({ view: "review-notes", bookingId: "123" });
  assert.equal(attempts, 2);
});
