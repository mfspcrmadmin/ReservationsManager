const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../app/js/booking-controller.js"), "utf8");
function functionSource(name) {
  const start = source.search(new RegExp("^(?:async )?function " + name + "\\(", "m"));
  assert.ok(start >= 0, name);
  const rest = source.slice(start);
  const end = /\r?\n}/.exec(rest);
  assert.ok(end, name + " closing brace");
  return rest.slice(0, end.index + end[0].length);
}

function setup({ response = { success: true }, persisted = "<p>New</p>", readError = false } = {}) {
  const record = { id: "draft-1", draft_id: "draft-1", communication_id: "comm-1", content: "<p>Old</p>" };
  const state = { selectedBookingId: "booking-1", selectedDraftRecordId: "draft-1", emailDrafts: [record], mailContentByKey: { "drafts::draft-1": { ...record } }, communicationContentEditorOpen: true };
  const elements = { mailContentEditVisual: { innerHTML: "<p>New</p>" }, mailContentEditSave: {}, mailContentEditError: {}, mailContentEditModal: { hidden: false } };
  let reads = 0;
  const context = vm.createContext({
    state, elements,
    document: { createElement: () => ({ innerHTML: "" }) },
    getSelectedCommunicationRecord: () => state.mailContentByKey["drafts::draft-1"],
    getCommunicationEditorFields: () => ({ email_to: "supplier@example.com", email_from: "agent@example.com", email_cc: "cc@example.com", email_subject: "Subject" }),
    crmExecuteFunction: async () => response,
    extractFunctionPayload: value => value,
    getApiErrorDetails: value => ({ code: value?.code || "", message: value?.message || "" }),
    buildFunctionPayloadError: value => new Error(value.message || value.code),
    loadBookingMailRecordsFromFunction: async () => {
      reads++;
      if (readError) throw new Error("Read failed");
      return persisted === null ? [] : [{ ...record, content: persisted, modified_time: "server timestamp" }];
    },
    getMailCacheKey: (tab, id) => tab + "::" + id,
    findMailRecordById: records => records[0],
    renderEmailsPanel: () => {},
    setError: (_, value) => { context.error = value; },
    setNotice: (_, value) => { context.notice = value; }
  });
  vm.runInContext(["getFunctionPayloadErrorDetails", "normalizeSavedEmailContent", "saveCommunicationContentEditor"].map(functionSource).join("\n"), context);
  return { context, state, elements, reads: () => reads };
}

for (const [name, options] of [
  ["nested CRM draft error", { response: { success: true, api_response: { __email_drafts: [{ code: "MANDATORY_NOT_FOUND", status: "error", message: "Missing from" }] } } }],
  ["function failure", { response: { success: false, message: "Failed" } }],
  ["empty response", { response: null }],
  ["false success with unchanged persisted content", { persisted: "<p>Old</p>" }],
  ["missing draft on readback", { persisted: null }],
  ["readback failure", { readError: true }]
]) {
  test(name + " keeps the previous preview and edited text", async () => {
    const { context, state, elements } = setup(options);
    await context.saveCommunicationContentEditor();
    assert.equal(context.error, "");
    assert.equal(elements.mailContentEditError.hidden, false);
    assert.ok(elements.mailContentEditError.textContent);
    assert.equal(context.notice, "");
    assert.equal(state.emailDrafts[0].content, "<p>Old</p>");
    assert.equal(state.mailContentByKey["drafts::draft-1"].content, "<p>Old</p>");
    assert.equal(elements.mailContentEditVisual.innerHTML, "<p>New</p>");
    assert.equal(elements.mailContentEditModal.hidden, false);
    assert.equal(state.draftEditorSaving, false);
    assert.equal(elements.mailContentEditSave.disabled, false);
  });
}

test("verified save uses the server record and closes the editor", async () => {
  const { context, state, elements, reads } = setup();
  await context.saveCommunicationContentEditor();
  assert.equal(reads(), 1);
  assert.equal(context.error, "");
  assert.equal(context.notice, "");
  assert.equal(state.mailContentByKey["drafts::draft-1"].modified_time, "server timestamp");
  assert.equal(state.emailDrafts[0].content, "<p>New</p>");
  assert.equal(elements.mailContentEditModal.hidden, true);
});

test("all native draft result envelopes expose item errors", () => {
  const { context } = setup();
  const result = { __email_drafts: [{ code: "SUCCESS", status: "success" }, { code: "INVALID_DATA", status: "error" }] };
  for (const payload of [result, { api_response: result }, { data: result }]) {
    assert.equal(context.getFunctionPayloadErrorDetails(payload).code, "INVALID_DATA");
  }
});
