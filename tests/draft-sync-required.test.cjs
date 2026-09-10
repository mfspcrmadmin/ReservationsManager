const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

function readFunction(file, name) {
  const source = fs.readFileSync(path.join(__dirname, "../app/js", file), "utf8");
  const start = source.search(new RegExp("^(?:export )?(?:async )?function " + name + "\\(", "m"));
  assert.ok(start >= 0, name);
  const rest = source.slice(start).replace(/^export /, "");
  return rest.slice(0, rest.search(/\r?\n}\r?\n/) + (rest.includes("\r\n") ? 3 : 2));
}

function setup() {
  const now = Date.now();
  const context = vm.createContext({
    Date: class extends Date { static now() { return now; } },
    getBookingStageValue: booking => booking.Stage,
    normalizeComparableText: value => String(value || "").trim().toLowerCase(),
    state: { selectedBooking: { Stage: "Quotation" }, selectedBookingId: "booking-1", selectedServiceIds: { "service-1": true } },
    elements: {},
    getSelectedServiceIdsForAction: () => ["service-1"],
    closeBulkActionMenus() {}, showLoading() {}, clearLoading() {},
    showCreateDraftModal() {}, closeCreateDraftModal() {}, renderServicesWorkspace() {},
    reloadBookingWorkspaceHandler: null,
    formatSelectedServiceIds: ids => ids.join(","),
    extractCrmFunctionResult: response => response,
    setError: (_, message) => { throw new Error(message); }
  });
  vm.runInContext(["getBookingRawValue", "buildEzusSyncMessage", "isBookingSyncRequired"]
    .map(name => readFunction("booking-shell.js", name)).join("\n"), context);
  vm.runInContext(readFunction("services-controller.js", "onCreateDraftForSelection"), context);
  return { context, now };
}

test("required sync uses the displayed warning's stages and 24-hour boundary", () => {
  const { context, now } = setup();
  const day = 24 * 60 * 60 * 1000;
  for (const Stage of ["Testing", "Reservation In Progress", "Reservation In Progresss", "Changes Requested", "Quotation"]) {
    assert.equal(context.isBookingSyncRequired({ Stage }), true);
    for (const [age, expected] of [[day - 1, false], [day, false], [day + 1, true]]) {
      assert.equal(context.isBookingSyncRequired({ Stage, Last_Ezus_Sync_At: new Date(now - age).toISOString() }), expected);
    }
  }
  for (const Stage of ["All Services Confirmed", "Cancelled", "On Tour"]) {
    assert.equal(context.isBookingSyncRequired({ Stage }), false);
    assert.equal(context.isBookingSyncRequired({ Stage, Last_Ezus_Sync_At: "2020-01-01" }), false);
  }
  assert.equal(context.isBookingSyncRequired(null), false);
  assert.equal(context.isBookingSyncRequired({ Stage: "Quotation", Last_Ezus_Sync_At: "invalid" }), false);
  for (const key of ["Last_Ezus_Sync_At", "Last EZUS Sync At", "Last_EZUS_Sync_At"]) {
    assert.equal(context.isBookingSyncRequired({ Stage: "Quotation", [key]: "2020-01-01" }), true);
  }
});

for (const purpose of ["Check Availability", "Reservation"]) {
  test(purpose + " blocks stale bookings, preserves selection and allows synced bookings", async () => {
    const { context, now } = setup();
    let warnings = 0;
    let creations = 0;
    context.showDraftSyncRequiredDialog = () => { warnings++; };
    context.crmExecuteFunction = async () => { creations++; return { success: true }; };
    await context.onCreateDraftForSelection(purpose, "draft");
    assert.equal(warnings, 1);
    assert.equal(creations, 0);
    assert.equal(context.state.selectedServiceIds["service-1"], true);
    context.state.selectedBooking.Last_Ezus_Sync_At = new Date(now).toISOString();
    await context.onCreateDraftForSelection(purpose, "draft");
    assert.equal(warnings, 1);
    assert.equal(creations, 1);
    context.state.syncingEzus = true;
    await context.onCreateDraftForSelection(purpose, "draft");
    assert.equal(creations, 1);
  });
}

test("successful sync from Create draft only closes progress and clears selection", async () => {
  const { context } = setup();
  const notices = [];
  let closed = false;
  context.state.selectedBooking = { id: "booking-1", Ezus_Project_ID: "ezus-1" };
  context.setButtonsDisabled = () => {};
  context.setError = (_, message) => { assert.equal(message, ""); };
  context.setNotice = (_, message, options) => notices.push({ message, options });
  context.clearLoading = () => { closed = true; };
  context.crmExecuteFunction = async () => ({ error: false, message: "Synchronization done successfully!" });
  context.extractFunctionPayload = response => response;
  context.getFunctionPayloadErrorDetails = () => null;
  context.loadBookingWorkspace = async (_, options) => {
    assert.equal(options.preserveSelection, false);
    context.state.selectedServiceIds = {};
  };
  vm.runInContext(readFunction("booking-controller.js", "onSyncEzusClick"), context);
  await context.onSyncEzusClick({ fromCreateDraft: true });
  assert.equal(notices.length, 1);
  assert.equal(notices[0].options.loading, true);
  assert.equal(closed, true);
  assert.equal(context.state.syncingEzus, false);
  assert.equal(Object.keys(context.state.selectedServiceIds).length, 0);
});
