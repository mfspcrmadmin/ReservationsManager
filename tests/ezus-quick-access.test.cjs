const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const read = name => fs.readFileSync(path.join(__dirname, "../app/js", name), "utf8").replace(/\r\n/g, "\n");
const shell = read("booking-shell.js");
const extract = name => {
  const start = shell.indexOf("function " + name + "(");
  assert.ok(start >= 0, name);
  return shell.slice(start, shell.indexOf("\n}", start) + 2);
};
function element() {
  const classes = new Set();
  return { hidden: false, classes, classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name), remove: name => classes.delete(name) }, setAttribute(name, value) { this[name] = value; }, removeAttribute(name) { delete this[name]; } };
}

test("Ezus Quick Access appears with a project ID regardless of itinerary format", () => {
  const context = vm.createContext({ getBookingValue: (booking, keys) => keys.map(key => booking[key]).find(Boolean) || "" });
  vm.runInContext(["renderBookingQuickAccess", "getBookingQuickAccessValue", "setQuickAccessLink"].map(extract).join("\n"), context);
  const elements = Object.fromEntries(["bookingQuickAccess", "quickAccessEzus", "quickAccessAxus", "quickAccessDesk", "quickAccessWorkdrive"].map(key => [key, element()]));
  for (const format of ["", "AXUS", "EZUS", "Not set"]) {
    context.renderBookingQuickAccess(elements, { Ezus_Project_ID: "project-123" }, format);
    assert.equal(elements.quickAccessEzus.hidden, false);
    assert.equal(elements.quickAccessEzus.href, "https://pro.ezus.io/project?id=project-123");
    assert.equal(elements.bookingQuickAccess.hidden, false);
  }
  context.renderBookingQuickAccess(elements, {}, "EZUS");
  assert.equal(elements.quickAccessEzus.hidden, true);
  assert.equal(elements.quickAccessEzus.href, undefined);
});

test("missing FID link is neutral only for Sales Standard and styles reset when filled", () => {
  const context = vm.createContext({});
  vm.runInContext(extract("renderItineraryLinkControl"), context);
  const elements = Object.fromEntries(["actionItineraryOpen", "actionItineraryEdit", "actionItineraryForm", "actionItineraryLink"].map(key => [key, element()]));
  for (const profile of ["Sales Standard", " sales standard ", "SALES STANDARD"]) {
    context.renderItineraryLinkControl(elements, "", { currentUserRelationshipProfile: profile });
    assert.equal(elements.actionItineraryOpen.textContent, "FID Itinerary link empty");
    assert.equal(elements.actionItineraryLink.classes.has("is-missing"), false);
    assert.equal(elements.actionItineraryLink.classes.has("is-empty-neutral"), true);
  }
  for (const profile of ["Reservations", "Administrator", ""]) {
    context.renderItineraryLinkControl(elements, "", { currentUserRelationshipProfile: profile });
    assert.equal(elements.actionItineraryOpen.textContent, "FID Itinerary link required");
    assert.equal(elements.actionItineraryLink.classes.has("is-missing"), true);
    assert.equal(elements.actionItineraryLink.classes.has("is-empty-neutral"), false);
  }
  context.renderItineraryLinkControl(elements, "https://itinerary.example", { currentUserRelationshipProfile: "Sales Standard" });
  assert.match(elements.actionItineraryOpen.textContent, /Open itinerary/);
  assert.equal(elements.actionItineraryLink.classes.has("is-missing"), false);
  assert.equal(elements.actionItineraryLink.classes.has("is-empty-neutral"), false);
});

function refreshContext(readRecord) {
  const context = vm.createContext({ crmGetRecord: readRecord });
  vm.runInContext(read("ezus-project-refresh.js").replace(/^import .*;\n/gm, "").replace(/^export /gm, ""), context);
  return context;
}

test("refresh waits for the selected prefix after the project link is saved", async () => {
  let reads = 0;
  const context = refreshContext(async () => ({
    id: "booking", Ezus_Project_ID: "project",
    MFSP_Reference: ++reads < 3 ? "MFSP123" : "MFAD123"
  }));
  const booking = await context.loadBookingWithEzusProject("booking", () => true, async () => {}, "MFAD");
  assert.equal(reads, 3);
  assert.equal(booking.MFSP_Reference, "MFAD123");
});

test("refresh waits for the delayed CRM project ID and tolerates a temporary read failure", async () => {
  let reads = 0;
  const context = refreshContext(async () => {
    reads++;
    if (reads === 2) throw new Error("Temporary error");
    return { id: "booking", Ezus_Project_ID: reads === 3 ? "project" : "" };
  });
  const booking = await context.loadBookingWithEzusProject("booking", () => true, async () => {});
  assert.equal(booking.Ezus_Project_ID, "project");
  assert.equal(reads, 3);
});

test("refresh stops when the selection changes, when already populated, or at the retry limit", async () => {
  let reads = 0, current = true;
  const context = refreshContext(async () => { reads++; return { id: "booking" }; });
  await context.loadBookingWithEzusProject("booking", () => current, async () => { current = false; });
  assert.equal(reads, 1);
  reads = 0;
  const booking = await context.loadBookingWithEzusProject("booking", () => true, async () => {});
  assert.equal(reads, 11);
  assert.equal(booking.id, "booking");
  const ready = refreshContext(async () => ({ id: "booking", Ezus_Project_ID: "project" }));
  await ready.loadBookingWithEzusProject("booking", () => true, async () => { assert.fail("Should not wait"); });
});


test("creation confirmation prevents workflow execution until CRM has a real project ID", async () => {
  const c = refreshContext(async () => null);
  for (const id of ["", "-", "null", "undefined"]) {
    c.loadBookingWithEzusProject = async () => ({ id: "booking", Ezus_Project_ID: id });
    await assert.rejects(c.confirmCreatedEzusProject("booking", () => true), /workflow has not been executed/);
  }
  c.loadBookingWithEzusProject = async () => ({ id: "other", Ezus_Project_ID: "project" });
  await assert.rejects(c.confirmCreatedEzusProject("booking", () => true));
  c.loadBookingWithEzusProject = async () => ({ id: "booking", Ezus_Project_ID: "project" });
  assert.equal((await c.confirmCreatedEzusProject("booking", () => true)).Ezus_Project_ID, "project");
  assert.equal(await c.confirmCreatedEzusProject("booking", () => false), null);
});


test("creation confirmation blocks a stale MFSP prefix before the Blueprint", async () => {
  const c = refreshContext(async () => null);
  let prefix;
  c.loadBookingWithEzusProject = async (_, current, pause, expected) => { prefix = expected; return { id: "booking", Ezus_Project_ID: "project", MFSP_Reference: "MFSP123" }; };
  await assert.rejects(c.confirmCreatedEzusProject("booking", () => true, "MFOF"), /requested MFOF reference/);
  assert.equal(prefix, "MFOF");
  c.loadBookingWithEzusProject = async () => ({ id: "booking", Ezus_Project_ID: "project", MFSP_Reference: "MFOF123" });
  assert.equal((await c.confirmCreatedEzusProject("booking", () => true, "MFOF")).MFSP_Reference, "MFOF123");
});
