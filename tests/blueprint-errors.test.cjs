const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");
const source = fs.readFileSync(require("node:path").join(__dirname, "../app/js/booking-controller.js"), "utf8");
const execution = source.slice(source.indexOf("async function executeBlueprintTransition("), source.indexOf("async function onSyncEzusClick("));

function setup(payload, rejection) {
  const logs = [];
  let refreshes = 0;
  const context = vm.createContext({
    state: { selectedBookingId: "booking-1", bookingBlueprint: { processInfo: { field_value: "All Services Confirmed" } } },
    elements: {}, MODULES: { bookings: "Deals" },
    validateCreateInEzusAgency: async () => {},
    crmExecuteFunction: async () => { if (rejection) throw rejection; return payload; },
    extractFunctionPayload: value => value,
    getFunctionPayloadErrorDetails: value => value?.success === false ? { message: value.message } : null,
    console: { error: (...args) => logs.push(args) },
    setError() {}, setNotice() {}, loadBookingWorkspace: async () => { refreshes++; }
  });
  vm.runInContext(execution, context);
  return { context, logs, refreshes: () => refreshes,
    run: () => context.executeBlueprintTransition({ id: "transition-1", name: "FID Sent" }, { Notes: "PRIVATE NOTE" }) };
}

const failure = { status: "error", code: "MANDATORY_NOT_FOUND", message: "required field not found", details: { api_name: "FID_Date", json_path: "$.blueprint[0].data.FID_Date", expected_data_type: "date" } };

for (const result of [failure, { blueprint: [failure] }, { data: [{ status: "success", code: "SUCCESS" }, failure] }, JSON.stringify({ blueprint: [failure] })]) {
  test("exposes the nested CRM rejection: " + JSON.stringify(result), async () => {
    const fixture = setup({ success: false, message: "Zoho CRM rejected the Blueprint transition.", result, stage: "execute transition" });
    await assert.rejects(fixture.run(), error => /FID Sent/.test(error.message) && /MANDATORY_NOT_FOUND/.test(error.message) && /FID_Date/.test(error.message) && /Expected type: date/.test(error.message));
    assert.equal(fixture.logs.length, 1);
    assert.equal(fixture.logs[0][1].recordId, "booking-1");
    assert.equal(fixture.logs[0][1].stage, "execute transition");
    assert.ok(!JSON.stringify(fixture.logs).includes("PRIVATE NOTE"));
    assert.equal(fixture.refreshes(), 0);
  });
}

test("nested item errors override an outer success", async () => {
  await assert.rejects(setup({ success: true, result: { blueprint: [failure] } }).run(), /FID_Date/);
});

test("SDK rejections include context and are logged", async () => {
  const fixture = setup(null, new Error("Connection lost"));
  await assert.rejects(fixture.run(), /FID Sent: Connection lost/);
  assert.equal(fixture.logs.length, 1);
});

test("preserves unfamiliar CRM details in a copyable diagnostic snapshot", async () => {
  const crmDetails = { validation: { reason: "Transition validation failed", field: { api_name: "Custom_Field" } } };
  const fixture = setup({ success: false, result: { code: "INVALID_DATA", message: "invalid data", details: crmDetails } });
  await assert.rejects(fixture.run(), /INVALID_DATA/);
  const snapshot = JSON.parse(fixture.logs[0][2]);
  assert.deepEqual(snapshot.failures[0].crmDetails, crmDetails);
  assert.equal(snapshot.transitionName, "FID Sent");
  assert.ok(!fixture.logs[0][2].includes("PRIVATE NOTE"));
});

test("diagnostics include transition requirements without their existing values", async () => {
  const fixture = setup({ success: false, result: failure });
  await assert.rejects(fixture.context.executeBlueprintTransition({
    id: "transition-1", name: "FID Sent",
    fields: [{ api_name: "FID_Date", field_label: "FID date", data_type: "date", mandatory: true, value: "PRIVATE VALUE" }]
  }, {}));
  const snapshot = JSON.parse(fixture.logs[0][2]);
  assert.deepEqual(snapshot.transitionFields, [{ apiName: "FID_Date", label: "FID date", type: "date", mandatory: true }]);
  assert.deepEqual(snapshot.submittedFields, []);
  assert.ok(!fixture.logs[0][2].includes("PRIVATE VALUE"));
});

test("empty responses and generic errors still explain which action failed", async () => {
  await assert.rejects(setup(null).run(), /FID Sent: Zoho returned no usable error details/);
  await assert.rejects(setup({ success: false, message: "The booking changed state." }).run(), /The booking changed state/);
});

test("success refreshes the booking without error logs", async () => {
  const fixture = setup({ success: true, result: { status: "success", code: "SUCCESS" } });
  await fixture.run();
  assert.equal(fixture.refreshes(), 1);
  assert.equal(fixture.logs.length, 0);
});
