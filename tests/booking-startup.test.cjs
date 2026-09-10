const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../app/js/booking-controller.js"), "utf8");
const initSource = source.slice(source.indexOf("export async function init()" )).replace(/^export /, "");

for (const mode of ["pending", "rejected"]) {
  test("startup loads Booking Queue when optional tag loading is " + mode, async () => {
    let loaded = false;
    const noop = () => {};
    const ZOHO = { embeddedApp: { init: async () => {} }, CRM: {} };
    const context = vm.createContext({
      state: {}, elements: {}, ZOHO, window: { ZOHO }, console: { warn: noop },
      configureServicesController: noop, loadBookingWorkspace: noop, onSyncEzusClick: noop,
      initializeServiceTableColumns: noop, bindEvents: noop, populateStatusOptions: noop,
      initServiceTextSize: noop, loadServiceTextSizeForUser: noop,
      syncBulkPanels: noop, hideSearchResults: noop, setButtonsDisabled: noop,
      renderBookingWorkspace: noop, renderBookingSummary: noop, renderServicesWorkspace: noop,
      renderActiveTab: noop, renderBookingBrowserPanel: noop, renderEmailsPanel: noop,
      renderTravelersWorkspace: noop, setError: noop,
      hydrateCurrentUser: async () => {}, hydrateBookingBrowserOwners: async () => {},
      initializeBookingTags: () => mode === "pending" ? new Promise(() => {}) : Promise.reject(new Error("Tag field unavailable")),
      hydrateBookingStageOptions: async () => {},
      bootstrapBookingBrowserQueue: async () => { loaded = true; }
    });
    vm.runInContext(initSource, context);
    const initialization = context.init();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(loaded, true, "Tags must not block the booking list");
    await initialization;
    assert.equal(context.state.zohoInitDebug.status, "ready");
  });
}
