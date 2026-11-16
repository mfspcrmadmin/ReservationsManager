const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const source = fs.readFileSync(path.join(__dirname, "../app/js/api.js"), "utf8");

function setup(response) {
  const context = vm.createContext({
    ZOHO: { CRM: { API: { searchRecord: async () => response, getAllRecords: async () => response, getRelatedRecords: async () => response } } },
    extractRecords: value => value && value.data || []
  });
  vm.runInContext(source.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, ""), context);
  return context;
}

for (const method of ["crmSearchRecord", "crmSearchWord", "crmGetAllRecords", "crmGetRelatedRecords"]) {
  test(method + " exposes CRM search errors instead of returning an empty list", async () => {
    const context = setup({ status: "error", code: "INVALID_QUERY", message: "Invalid field in criteria" });
    await assert.rejects(context[method]("Deals", "criteria"), error => error.code === "INVALID_QUERY" && error.message === "Invalid field in criteria");
  });
  test(method + " accepts genuine empty and successful responses", async () => {
    assert.equal((await setup({ responseCode: 204 })[method]("Deals", "criteria")).length, 0);
    assert.equal((await setup({ data: [] })[method]("Deals", "criteria")).length, 0);
    assert.equal((await setup({ data: [{ id: "123" }] })[method]("Deals", "criteria"))[0].id, "123");
  });
  test(method + " rejects unconfirmed responses and nested errors", async () => {
    for (const response of [null, undefined, {}, "not JSON"]) await assert.rejects(setup(response)[method]("Deals", "criteria"), error => error.code === "CRM_READ_UNCONFIRMED");
    await assert.rejects(setup({ body: JSON.stringify({ code: "NO_PERMISSION", status: "error", message: "Denied" }) })[method]("Deals", "criteria"), error => error.code === "NO_PERMISSION");
    await assert.rejects(setup({ code: "NO_PERMISSION", status: "error", data: [] })[method]("Deals", "criteria"), error => error.code === "NO_PERMISSION");
  });
}
