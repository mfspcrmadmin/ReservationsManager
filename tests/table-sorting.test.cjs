const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const read = file => fs.readFileSync(path.join(__dirname, "../app/js", file), "utf8");
const context = vm.createContext({ Intl, bookingTagSortText: (booking, field) => field === "Sales_Tags_JSON" ? "Sales tag" : "Reservations tag" });
vm.runInContext(read("utils.js").replace(/^export /gm, "") + "\n" + read("table-sorting.js").replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, ""), context);
const sort = (rows, key, direction, getter) => Array.from(context.sortTableRows(rows, { key, direction }, getter));

test("numbers and dates sort by value in both directions, with missing values last", () => {
  const rows = [{ id: "missing" }, { id: "ten", Sales_Price: "10", Arrival_Date: "2026-10-01" }, { id: "zero", Sales_Price: 0, Arrival_Date: "2026-02-01" }, { id: "two", Sales_Price: "2", Arrival_Date: "2026-09-01" }];
  const getter = (row, key) => context.queueSortValue(row, key, {});
  for (const key of ["sales", "arrival"]) {
    assert.deepEqual(sort(rows, key, "asc", getter).map(row => row.id), ["zero", "two", "ten", "missing"]);
    assert.deepEqual(sort(rows, key, "desc", getter).map(row => row.id), ["ten", "two", "zero", "missing"]);
  }
  assert.equal(rows[0].id, "missing");
});

test("text sorting is natural, case insensitive and stable for ties", () => {
  const rows = [{ Name: "Service 10" }, { Name: "service 2", id: "first" }, { Name: "SERVICE 2", id: "second" }];
  const result = sort(rows, "name", "asc", (row, key) => context.serviceSortValue(row, key, {}));
  assert.equal(result[0].id, "first");
  assert.equal(result[1].id, "second");
  assert.equal(result[2].Name, "Service 10");
});

test("every configured services column has a sort value, including step lookups and pax fallback", () => {
  const constants = vm.createContext({});
  vm.runInContext(read("constants.js").replace(/^export /gm, "") + "\nthis.columns = SERVICE_TABLE_COLUMNS;", constants);
  const service = { Name: "2", Product_Description: "Tour", Destination: "Spain", Subdestination: "Madrid", Category: "Tour", Subcategory: "Private", Supplier_Name: "Supplier", Status_EZUS: "Confirmed", Payment_Status: "Fully Paid", Payment_Method: "Bank Transfer", Service_Date: "2026-01-01", Service_Date_Time: "2026-01-01T12:00:00Z", Total_Sales_Price: "120", Total_Purchase_Price: "90", PAX_Number: 2, Step: { id: "step-1" } };
  const state = { stepIndex: { "step-1": { Name: "Arrival" } } };
  for (const column of constants.columns) assert.notEqual(context.serviceSortValue(service, column.key, state), undefined, column.key);
  assert.equal(context.serviceSortValue(service, "step", state), "Arrival");
  assert.equal(context.serviceSortValue(service, "paxNumber", state), 2);
  assert.equal(context.serviceSortValue({ ...service, Number_of_Pax: 0 }, "paxNumber", state), 0);
});

test("every configured queue column has a sort value and Desk uses the interaction timestamp", () => {
  const columns = vm.createContext({});
  vm.runInContext(read("booking-queue-table.js").replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "") + "\nthis.columns = QUEUE_COLUMNS;", columns);
  const booking = { id: "1", Deal_Name: "Trip", MFSP_Reference: "MFSP2", Stage: "Confirmed", Arrival_Date: "2026-01-01", Departure_Date: "2026-01-10", Travelers_Number: 3, Sales_Price: "1000", Account_Name: { name: "Agency" }, Primary_Contact: { name: "Contact" }, Last_Ezus_Sync_At: "2026-01-01T12:00:00Z" };
  const state = { queueDeskSortValues: { "1": "2026-01-01T12:00:00Z" } };
  for (const column of columns.columns) assert.notEqual(context.queueSortValue(booking, column.key, state), undefined, column.key);
  assert.equal(context.queueSortValue(booking, "agency", state), "Agency");
  assert.equal(context.queueSortValue(booking, "desk", state), Date.parse(state.queueDeskSortValues["1"]));
  assert.equal(context.queueSortValue({ id: "2" }, "desk", state), null);
});

test("headers toggle sorting and expose direction through accessible buttons", () => {
  const first = context.nextTableSort(null, "sales");
  const second = context.nextTableSort(first, "sales");
  assert.equal(first.direction, "asc");
  assert.equal(second.direction, "desc");
  assert.equal(context.nextTableSort(second, "arrival").direction, "asc");
  const html = context.sortableHeader({ key: "sales", label: "Sales" }, second);
  assert.match(html, /aria-sort="descending"/);
  assert.match(html, /<button type="button"/);
  let selected;
  const button = { dataset: { tableSort: "sales" } };
  context.bindTableSort({ querySelectorAll: () => [button] }, key => { selected = key; });
  button.onclick();
  assert.equal(selected, "sales");
});

test("flat and grouped services render sorted rows without changing selections or source order", () => {
  const renderSource = read("render.js").replace(/\r\n/g, "\n");
  const extract = name => {
    const start = renderSource.indexOf("function " + name + "(");
    return renderSource.slice(start, renderSource.indexOf("\n}", start) + 2);
  };
  const services = [{ id: "10", Name: "10" }, { id: "2", Name: "2" }];
  const state = { filteredServices: services, serviceTableSort: { key: "name", direction: "asc" }, selectedServiceIds: { "10": true }, collapsedStepIds: {}, groupedRows: [{ stepId: "one", services, totalSales: 0, totalPurchase: 0 }], stepIndex: {} };
  const elements = { servicesBody: { innerHTML: "", querySelectorAll: () => [] } };
  const local = vm.createContext({ ...context, getVisibleServiceColumns: () => [{ key: "name" }], renderServiceSelectionCell: () => "<td></td>", renderServiceTableCell: (_, service) => "<td>" + service.Name + "</td>", renderStatusPill: () => "", formatStepTimeRange: () => "" });
  vm.runInContext(["renderFlatServicesTable", "renderGroupedServicesTable", "getGroupSelectionState", "formatGroupedDayLabel"].map(extract).join("\n"), local);
  for (const render of [local.renderFlatServicesTable, local.renderGroupedServicesTable]) {
    render({ state, elements });
    assert.ok(elements.servicesBody.innerHTML.indexOf('data-service-id="2"') < elements.servicesBody.innerHTML.indexOf('data-service-id="10"'));
    assert.match(elements.servicesBody.innerHTML, /is-selected[^>]*data-service-id="10"/);
  }
  assert.equal(services[0].id, "10");
});
