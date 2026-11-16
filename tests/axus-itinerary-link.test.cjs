const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const source = fs.readFileSync(path.join(__dirname, "../app/js/booking-controller.js"), "utf8").replace(/\r\n/g, "\n");
function extract(name) {
  const start = source.search(new RegExp("^(?:async )?function " + name + "\\(", "m"));
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf("\n}", start) + 2);
}
function setup({ payload = { success: true, Axus_Itinerary_ID: "123456" }, update = { code: "SUCCESS" }, refreshed = {}, changeBooking = false } = {}) {
  const writes = [], reloads = [], errors = [];
  let successes = 0, reads = 0;
  const state = { selectedBookingId: "booking-1", selectedBooking: { id: "booking-1", Axus_Itinerary_ID: "old-id", Axus_Link: "https://old.example" } };
  const context = vm.createContext({
    state, elements: { axusItineraryDialogTitle: {}, axusItineraryDialogMessage: {} },
    MODULES: { bookings: "Bookings" }, AXUS_ITINERARY_SYNC_ATTEMPTS: 2, AXUS_ITINERARY_SYNC_INTERVAL_MS: 0,
    crmExecuteFunction: async (name, args) => {
      assert.equal(name, "sendfullbookingtoaxus");
      assert.equal(args.bookingId, "booking-1");
      if (changeBooking) { state.selectedBookingId = "booking-2"; state.selectedBooking = { id: "booking-2" }; }
      return { details: { output: JSON.stringify(payload) } };
    },
    extractFunctionPayload: response => JSON.parse(response.details.output),
    getApiErrorDetails: value => ({ code: value?.code || "", message: value?.message || "" }),
    buildFunctionPayloadError: details => new Error(details.message || details.code),
    crmUpdateRecord: async (module, data) => { writes.push({ module, ...data }); return update; },
    crmGetRecord: async (_, id) => { assert.equal(id, "booking-1"); reads++; return refreshed; },
    wait: async () => {}, loadBookingWorkspace: async id => reloads.push(id),
    showAxusItinerarySuccess: () => successes++, showAxusItineraryError: message => errors.push(message),
    ...Object.fromEntries(["showAxusItineraryDialog", "setError", "setNotice", "setButtonsDisabled", "clearLoading"].map(name => [name, () => {}]))
  });
  vm.runInContext(["getAxusItineraryId", "getFunctionPayloadErrorDetails", "waitForAxusItineraryLink", "saveCreatedAxusItineraryLink", "onCreateAxusClick"].map(extract).join("\n"), context);
  return { context, state, writes, reloads, errors, successes: () => successes, reads: () => reads };
}
test("successful creation saves the returned itinerary link before refreshing the booking", async () => {
  const f = setup();
  await f.context.onCreateAxusClick();
  assert.deepEqual(f.writes, [{ module: "Bookings", id: "booking-1", Axus_Link: "https://axustravelapp.com/admin/itinerary/123456" }]);
  assert.equal(f.reads(), 0);
  assert.deepEqual(f.reloads, ["booking-1"]);
  assert.equal(f.successes(), 1);
  assert.equal(f.state.creatingAxusItinerary, false);
});
test("failed creation does not update Axus_Link", async () => {
  const f = setup({ payload: { success: false, message: "AXUS unavailable" } });
  await f.context.onCreateAxusClick();
  assert.equal(f.writes.length, 0);
  assert.deepEqual(f.errors, ["AXUS unavailable"]);
});
for (const update of [{ code: "INVALID_DATA", status: "error", message: "Invalid field" }, {}]) {
  test("an unconfirmed CRM update does not announce success", async () => {
    const f = setup({ update });
    await f.context.onCreateAxusClick();
    assert.equal(f.successes(), 0);
    assert.equal(f.reloads.length, 0);
    assert.match(f.errors[0], /created, but Axus_Link could not be saved/);
  });
}
test("missing returned ID uses the refreshed booking instead of the old local link", async () => {
  const f = setup({ payload: { success: true }, refreshed: { Axus_Itinerary_ID: "new-id" } });
  await f.context.onCreateAxusClick();
  assert.equal(f.reads(), 1);
  assert.equal(f.writes[0].Axus_Link, "https://axustravelapp.com/admin/itinerary/new-id");
});
test("missing ID never persists a stale link or announces success", async () => {
  const f = setup({ payload: { success: true } });
  await f.context.onCreateAxusClick();
  assert.equal(f.writes.length, 0);
  assert.equal(f.successes(), 0);
  assert.match(f.errors[0], /ID was not returned/);
});
test("switching bookings still saves to the original booking without replacing the new selection", async () => {
  const f = setup({ changeBooking: true });
  await f.context.onCreateAxusClick();
  assert.equal(f.writes[0].id, "booking-1");
  assert.equal(f.state.selectedBooking.id, "booking-2");
  assert.equal(f.reloads.length, 0);
});


test("actual function response uses axusResponse.itineraryKey without waiting for CRM", async () => {
  const f = setup({ payload: { error: false, axusResponse: { itineraryKey: "axus-987" }, crmUpdateResponse: { id: "booking-1" } } });
  await f.context.onCreateAxusClick();
  assert.equal(f.reads(), 0);
  assert.equal(f.writes[0].Axus_Link, "https://axustravelapp.com/admin/itinerary/axus-987");
  assert.equal(f.successes(), 1);
  assert.equal(f.context.getAxusItineraryId(f.state.selectedBooking, f.state.axusCreationPayload), "axus-987");
});

test("CRM Axus_ID is recovered when creation response has no itinerary key", async () => {
  const f = setup({ payload: { error: false }, refreshed: { Axus_ID: "axus-654" } });
  await f.context.onCreateAxusClick();
  assert.equal(f.writes[0].Axus_Link, "https://axustravelapp.com/admin/itinerary/axus-654");
  assert.equal(f.context.getAxusItineraryId(f.state.selectedBooking, f.state.axusCreationPayload), "axus-654");
  assert.equal(f.successes(), 1);
});

test("placeholder IDs and unrelated response IDs cannot become itinerary links", () => {
  const f = setup();
  for (const value of [null, undefined, "", "-", "null", "undefined", {}, []]) {
    assert.equal(f.context.getAxusItineraryId({ Axus_ID: value }, { axusResponse: { itineraryKey: value }, crmUpdateResponse: { id: "booking-1" } }), "");
  }
});
