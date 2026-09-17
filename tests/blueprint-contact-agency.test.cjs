const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const guard = fs.readFileSync(path.join(__dirname, "../app/js/blueprint-contact-agency.js"), "utf8")
  .replace(/^import .*;\r?\n/gm, "").replace(/export /g, "");
const controller = fs.readFileSync(path.join(__dirname, "../app/js/booking-controller.js"), "utf8");
const execution = controller.slice(controller.indexOf("async function executeBlueprintTransition("), controller.indexOf("async function onSyncEzusClick("));

function setup() {
  const fixture = {
    booking: { id: "booking", Account_Name: { id: "agency-a", name: "Agency A" }, Contact_Name: { id: "contact", name: "Ana" } },
    contact: { id: "contact", Full_Name: "Ana", Account_Name: { id: "agency-a", name: "Agency A" } },
    reads: [], writes: []
  };
  const context = vm.createContext({
    state: { selectedBookingId: "booking", selectedBooking: { Account_Name: { id: "stale" } } },
    elements: {}, MODULES: { bookings: "Deals" },
    crmGetRecord: async (module, id) => {
      fixture.reads.push([module, id]);
      if (fixture.failRead) throw new Error("Technical API failure");
      if (fixture.changeBooking) context.state.selectedBookingId = "another-booking";
      return module === "Deals" ? fixture.booking : fixture.contact;
    },
    crmExecuteFunction: async (name, args) => { fixture.writes.push([name, args]); return { success: true }; },
    extractFunctionPayload: value => value,
    getFunctionPayloadErrorDetails: () => null,
    setError() {}, setNotice() {}, loadBookingWorkspace: async () => {}
  });
  vm.runInContext(guard + "\n" + execution, context);
  return { context, fixture, run: (name = "Create in Ezus") => context.executeBlueprintTransition({ id: "transition", name }, {}) };
}

test("Create in Ezus verifies current CRM associations before executing", async () => {
  const { fixture, run } = setup();
  await run();
  assert.deepEqual(fixture.reads, [["Deals", "booking"], ["Contacts", "contact"]]);
  assert.equal(fixture.writes.length, 1);
  assert.equal(fixture.writes[0][1].recordId, "booking");
});

test("different agency IDs block the transition and explain both remedies", async () => {
  const { fixture, run } = setup();
  fixture.contact.Account_Name = { id: "agency-b", name: "Agency B" };
  await assert.rejects(run(), error => /Agency A/.test(error.message) && /Agency B/.test(error.message) && /Change the booking's agency/.test(error.message) && /Move the contact/.test(error.message));
  assert.equal(fixture.writes.length, 0);
  fixture.contact.Account_Name.name = "Agency A";
  await assert.rejects(run(), /do not match/);
});

test("missing associations and unavailable records never execute the transition", async () => {
  for (const mutate of [
    f => { f.booking.Contact_Name = null; },
    f => { f.booking.Account_Name = null; },
    f => { f.contact.Account_Name = null; },
    f => { delete f.contact.Account_Name; },
    f => { f.contact = null; },
    f => { f.failRead = true; }
  ]) {
    const { fixture, run } = setup();
    mutate(fixture);
    await assert.rejects(run());
    assert.equal(fixture.writes.length, 0);
  }
});

test("other transitions do not run the contact-agency check", async () => {
  const { fixture, run } = setup();
  fixture.failRead = true;
  await run("Confirm booking");
  assert.equal(fixture.reads.length, 0);
  assert.equal(fixture.writes.length, 1);
});

test("changing the selected booking during validation aborts execution", async () => {
  const { fixture, run } = setup();
  fixture.changeBooking = true;
  await assert.rejects(run(), /selected booking changed/);
  assert.equal(fixture.writes.length, 0);
});
