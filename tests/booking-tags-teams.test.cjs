const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
function setup(profile) {
  const writes = [];
  const record = { id: "b1", Sales_Tags_JSON: null, Reservations_Tags_JSON: null };
  const context = vm.createContext({
    state: { currentUserId: "user", currentUserEmail: "user@example.com", currentUserRelationshipRecordId: "123", currentUserRelationshipProfile: profile, bookingTagRelationships: [{ id: "123", User_ID: "user", Email: "user@example.com", Status: "Active", Profile: profile },
      { id: "456", Booking_Tag_Catalog_JSON: JSON.stringify({ version: 1, tags: [{ id: "other", name: "Other team tag", color: "#abcdef" }] }) }
    ] },
    MODULES: { bookings: "Deals", userRelationships: "User_Relationships" },
    escapeHtml: value => String(value).replaceAll("<", "&lt;"), setTimeout, clearTimeout,
    crmGetRecord: async () => record,
    ZOHO: { CRM: { API: { updateRecord: async payload => { writes.push(payload); Object.assign(record, payload.APIData); return { data: [{ code: "SUCCESS" }] }; } } } }
  });
  require("./helpers/widget-permissions.cjs").load(context);
  for (const file of ["booking-tags-data.js", "booking-tags.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/js", file), "utf8").replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, ""), context);
  vm.runInContext('catalog = {version:1,tags:[{id:"mine",name:"My tag",color:"#123456"}]}', context);
  return { context, writes, record };
}
for (const [profile, field] of [
  ["Sales Standard", "Sales_Tags_JSON"],
  ["Reservations Standard", "Reservations_Tags_JSON"],
  ["Sales-Res Standard", "Reservations_Tags_JSON"]
]) test(profile + " can write only its own team field", async () => {
  const { context, writes, record } = setup(profile);
  const other = field === "Sales_Tags_JSON" ? "Reservations_Tags_JSON" : "Sales_Tags_JSON";
  const data = { version: 1, users: { "123": ["mine"] } };
  await context.writeJson("Deals", record, field, data);
  assert.deepEqual(Object.keys(writes[0].APIData), ["id", field]);
  await assert.rejects(context.writeJson("Deals", record, other, data), /read only/);
  await context.openTagEditor("b1", other); // Must stop before accessing the DOM.
  assert.equal(writes.length, 1);
  record[other] = JSON.stringify({ version: 1, users: { "456": ["other"] } });
  const readonly = context.renderBookingTags(record, true, other);
  assert.match(readonly, /Other team tag/);
  assert.match(readonly, /Read only/);
  assert.doesNotMatch(readonly, /data-booking-tags=/);
  assert.match(context.renderBookingTags(record, true, field), /data-booking-tags=/);
  const detail = context.renderBookingTags(record, false);
  assert.match(detail, /Sales Tags/);
  assert.match(detail, /Reservations Tags/);
  assert.equal(context.bookingTagSortText(record, other), "Other team tag");
});
test("unlisted profiles and unidentified users cannot edit either group", async () => {
  for (const profile of ["Finance Standard", "", "Guest Relations", "Sales Manager", "Reservations Manager"]) {
    const { context, record } = setup(profile);
    for (const field of ["Sales_Tags_JSON", "Reservations_Tags_JSON"]) {
      await assert.rejects(context.writeJson("Deals", record, field, { version: 1, users: {} }), /read only/);
      assert.doesNotMatch(context.renderBookingTags(record, true, field), /data-booking-tags=/);
    }
  }
  const { context, record } = setup("Sales Standard");
  context.state.currentUserRelationshipRecordId = "";
  assert.doesNotMatch(context.renderBookingTags(record, true, "Sales_Tags_JSON"), /data-booking-tags=/);
});

test("Administrator can edit and save both tag groups", async () => {
  const { context, record, writes } = setup("Administrator");
  for (const field of ["Sales_Tags_JSON", "Reservations_Tags_JSON"]) {
    assert.match(context.renderBookingTags(record, true, field), /data-booking-tags=/);
    await context.writeJson("Deals", record, field, { version: 1, users: { "123": ["mine"] } });
    assert.deepEqual(Object.keys(writes.at(-1).APIData), ["id", field]);
  }
  assert.equal(writes.length, 2);
  await assert.rejects(context.writeJson("Deals", record, "Unrelated_Field", {}), /read only/);
});
