const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");
const source = fs.readFileSync(require("node:path").join(__dirname, "../app/js/booking-controller.js"), "utf8");
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

test("switching closes the old booking immediately and only the latest request finishes loading", async () => {
  const pending = {};
  const state = { selectedBookingId: "old", selectedBooking: { id: "old" }, bookingIndex: { next: { id: "next" }, last: { id: "last" } } };
  const noop = () => {};
  const context = vm.createContext({
    state, elements: { bookingSearch: {} }, MODULES: { bookings: "Deals" },
    buildBookingLabel: booking => booking.id,
    crmGetRecord: (_, id) => new Promise((resolve, reject) => { pending[id] = { resolve, reject }; }),
    loadBookingBlueprintForBooking: async () => ({}),
    loadBookingServicesForBooking: async () => [], loadBookingStepsForBooking: async () => [],
    ...Object.fromEntries([
      "onCloseBookingReportDialog", "onCloseCardPurchaseDialog", "resetTravelersState",
      "renderBookingWorkspace", "renderBookingSummary", "renderSelectionPanel", "clearSelectedMailPreview",
      "renderBookingBrowserPanel", "showLoading", "clearLoading", "setError", "setNotice", "indexSteps",
      "resetServiceFilters", "ensureDeskTicketLoaded", "applyServiceFilter", "renderEmailsPanel", "renderTravelersWorkspace"
    ].map(name => [name, noop]))
  });
  vm.runInContext(extract("function clearActiveBookingWorkspace()", "function setSummaryView") +
    extract("async function loadBookingWorkspace(", "async function onWorkspaceActionClick"), context);
  const next = context.loadBookingWorkspace("next");
  assert.equal(state.selectedBooking, null);
  assert.equal(state.selectedBookingId, "");
  assert.equal(state.bookingWorkspaceLoadingLabel, "next");
  const last = context.loadBookingWorkspace("last");
  pending.next.resolve({ id: "next" });
  await next;
  assert.equal(state.selectedBooking, null);
  assert.equal(state.bookingWorkspaceLoadingLabel, "last");
  pending.last.resolve({ id: "last" });
  await last;
  assert.equal(state.selectedBooking.id, "last");
  assert.equal(state.bookingWorkspaceLoadingLabel, "");

  const failed = context.loadBookingWorkspace("next");
  pending.next.reject(new Error("Unavailable"));
  await failed;
  assert.equal(state.selectedBooking, null);
  assert.equal(state.bookingWorkspaceLoadingLabel, "");
});
