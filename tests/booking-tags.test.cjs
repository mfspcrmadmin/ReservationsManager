const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const source = fs.readFileSync(path.join(__dirname, "../app/js/booking-tags-data.js"), "utf8");
const context = vm.createContext({});
vm.runInContext(source.replace(/^export /gm, ""), context);

test("blank fields start empty and malformed JSON is never silently discarded", () => {
  assert.equal(context.parseTagCatalog(null).tags.length, 0);
  assert.equal(Object.keys(context.parseBookingTags("").users).length, 0);
  for (const value of ["bad", "[]", '{"version":2}', '{"version":1,"tags":{}}']) {
    assert.throws(() => context.parseTagCatalog(value));
  }
  assert.throws(() => context.parseBookingTags('{"version":1,"users":{"123":"bad"}}'));
});

test("booking assignment merge preserves other users and extension data", () => {
  const raw = '{"version":1,"extra":"keep","users":{"123":["old"],"456":["other"]}}';
  const result = context.mergeBookingTags(raw, "123", ["new", "new"]);
  assert.equal(JSON.stringify(result), '{"version":1,"extra":"keep","users":{"123":["new"],"456":["other"]}}');
  assert.throws(() => context.mergeBookingTags(raw, "__proto__", []));
});

test("names are normalized, duplicate names and invalid colors are rejected", () => {
  const tags = [{ id: "one", name: "VIP", color: "#123456" }];
  assert.throws(() => context.validateTag(" vip ", "#123456", tags));
  assert.equal(context.validateTag(" vip ", "#123456", tags, "one").name, "vip");
  assert.equal(context.validateTag("Travel   family", "#abcdef", []).name, "Travel family");
  assert.throws(() => context.validateTag("Name", 'red;position:fixed', []));
  assert.throws(() => context.validateTag(" ", "#123456", []));
  assert.throws(() => context.validateTag("x".repeat(61), "#123456", []));
});

test("invalid IDs, duplicate IDs and excessive payloads cannot be saved", () => {
  const tag = { id: "one", name: "Tag", color: "#abcdef" };
  assert.throws(() => context.parseTagCatalog(JSON.stringify({ version: 1, tags: [tag, tag] })));
  assert.throws(() => context.parseTagCatalog(JSON.stringify({ version: 1, tags: [{ ...tag, id: '<img>' }] })));
  assert.throws(() => context.serializeTags({ value: "x".repeat(30001) }));
});
