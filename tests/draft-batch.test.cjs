const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

function setup() {
  const messages = [], calls = [];
  const drafts = ["d1", "d2", "d3"].map(id => ({ id, communication_id: "c-" + id, from: "sender@example.com", communication_status: "Draft" }));
  const state = { selectedBookingId: "b1", emailDrafts: drafts, selectedDraftIds: { d1: true, d2: true, d3: true }, mailContentByKey: {} };
  const context = vm.createContext({
    state, elements: { mailSendSpinner: {}, mailSendModalClose: {}, draftDeleteConfirmTitle: {}, draftDeleteConfirmDescription: {}, draftDeleteConfirmSubmit: {}, draftDeleteConfirmModal: {}, draftDeleteConfirmCancel: { focus() {} } },
    findMailRecordById: (records, _, id) => records.find(record => record.id === id),
    getMailCacheKey: (_, id) => id,
    getMailRecordId: record => record.id,
    removeMailRecordFromCollection: (records, _, id) => { const index = records.findIndex(record => record.id === id); if (index >= 0) records.splice(index, 1); },
    setError: (_, message) => { if (message) messages.push(message); }, setNotice() {}, renderEmailsPanel() {},
    showSendModal: message => messages.push(message),
    crmExecuteFunction: async (_, args) => { calls.push(args.draftId); return { success: true }; },
    extractFunctionPayload: response => response,
    getFunctionPayloadErrorDetails: payload => payload.error ? { message: payload.error } : null,
    buildFunctionPayloadError: details => new Error(details.message),
    ensureBookingEmailsLoaded: async () => {}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/js/draft-batch.js"), "utf8").replace(/^export /gm, ""), context);
  const source = fs.readFileSync(path.join(__dirname, "../app/js/booking-controller.js"), "utf8");
  const start = source.indexOf("async function onSendSelectedDraftsClick()");
  const end = source.indexOf("\nfunction showSendModal", start);
  vm.runInContext(source.slice(start, end), context);
  for (const name of ["onDeleteSelectedDraftsClick", "deleteDraftBatch", "onConfirmDraftDelete", "closeDraftDeleteConfirmation"]) {
    const start = source.search(new RegExp("^(?:async )?function " + name + "\\(", "m"));
    const rest = source.slice(start);
    const end = rest.search(/\r?\n}\r?\n/);
    vm.runInContext(rest.slice(0, end) + "\n}", context);
  }
  return { context, state, messages, calls };
}

test("bulk drafts send strictly one at a time and clear confirmed selections", async () => {
  const f = setup();
  const calls = [];
  let release;
  f.context.crmExecuteFunction = async (_, args) => {
    calls.push(args.draftId);
    if (calls.length === 1) await new Promise(resolve => { release = resolve; });
    return { success: true };
  };
  const pending = f.context.onSendSelectedDraftsClick();
  assert.deepEqual(calls, ["d1"]);
  assert.equal(f.state.draftBatchSending, true);
  await f.context.onSendSelectedDraftsClick();
  assert.deepEqual(calls, ["d1"], "a second click cannot start another batch");
  release();
  await pending;
  assert.deepEqual(calls, ["d1", "d2", "d3"]);
  assert.equal(Object.keys(f.state.selectedDraftIds).length, 0);
  assert.ok(f.state.emailDrafts.every(record => record.communication_status === "Sent"));
  assert.equal(f.state.draftBatchSending, false);
  assert.ok(f.messages.includes("3 of 3 drafts sent."));
});

test("failure stops the batch and keeps only unsent drafts selected", async () => {
  const f = setup();
  f.context.crmExecuteFunction = async (_, args) => {
    f.calls.push(args.draftId);
    return args.draftId === "d2" ? { error: "Send failed" } : { success: true };
  };
  await f.context.onSendSelectedDraftsClick();
  assert.deepEqual(f.calls, ["d1", "d2"]);
  assert.deepEqual(Object.keys(f.state.selectedDraftIds), ["d2", "d3"]);
  assert.match(f.messages.at(-1), /1 of 3 drafts sent.*Send failed/);
  assert.equal(f.state.draftEditorSaving, false);
});

test("invalid selection prevents any sends", async () => {
  const f = setup();
  f.state.emailDrafts[2].from = "";
  await f.context.onSendSelectedDraftsClick();
  assert.equal(f.calls.length, 0);
  assert.match(f.messages.at(-1), /Sender Email/);
});

test("switching bookings stops before sending the next draft", async () => {
  const f = setup();
  f.context.crmExecuteFunction = async (_, args) => {
    f.calls.push(args.draftId);
    f.state.selectedBookingId = "b2";
    f.state.selectedDraftIds = { other: true };
    return { success: true };
  };
  await f.context.onSendSelectedDraftsClick();
  assert.deepEqual(f.calls, ["d1"]);
  assert.deepEqual(Object.keys(f.state.selectedDraftIds), ["other"]);
  assert.match(f.messages.at(-1), /Booking changed/);
});

test("empty response is not reported as a successful send", async () => {
  for (const response of [null, [], {}]) {
    const f = setup();
    f.context.crmExecuteFunction = async () => response;
    await f.context.onSendSelectedDraftsClick();
    assert.equal(Object.keys(f.state.selectedDraftIds).length, 3);
    assert.match(f.messages.at(-1), /0 of 3 drafts sent.*did not confirm/);
  }
});

test("bulk deletion requires confirmation and cancel performs no deletion", () => {
  const f = setup();
  f.context.onDeleteSelectedDraftsClick();
  assert.equal(f.calls.length, 0);
  assert.equal(f.state.draftDeleteConfirmOpen, true);
  assert.equal(f.context.elements.draftDeleteConfirmTitle.textContent, "Delete 3 selected drafts?");
  f.context.closeDraftDeleteConfirmation();
  assert.equal(f.state.pendingDraftBatchDeletion, null);
  assert.equal(f.calls.length, 0);
});

test("confirmed deletion uses captured selection and removes only confirmed records", async () => {
  const f = setup();
  const calls = [];
  f.context.crmExecuteFunction = async (name, args) => {
    assert.equal(name, "comm_deletecommunication");
    calls.push(args.communicationId);
    return { success: true };
  };
  f.state.selectedDraftIds = { d1: true, d2: true };
  f.context.onDeleteSelectedDraftsClick();
  f.state.selectedDraftIds.d3 = true;
  await f.context.onConfirmDraftDelete();
  assert.deepEqual(calls, ["c-d1", "c-d2"]);
  assert.deepEqual(f.state.emailDrafts.map(record => record.id), ["d3"]);
  assert.deepEqual(Object.keys(f.state.selectedDraftIds), ["d3"]);
  assert.equal(f.state.draftDeleteConfirmOpen, false);
});

test("bulk deletion stops on failure and keeps undeleted drafts selected", async () => {
  const f = setup();
  const calls = [];
  f.context.crmExecuteFunction = async (_, args) => {
    calls.push(args.communicationId);
    return args.communicationId === "c-d2" ? { error: "Deletion failed" } : { success: true };
  };
  f.context.onDeleteSelectedDraftsClick();
  await f.context.onConfirmDraftDelete();
  assert.deepEqual(calls, ["c-d1", "c-d2"]);
  assert.deepEqual(f.state.emailDrafts.map(record => record.id), ["d2", "d3"]);
  assert.deepEqual(Object.keys(f.state.selectedDraftIds), ["d2", "d3"]);
  assert.match(f.messages.at(-1), /1 of 3 drafts deleted.*Deletion failed/);
  assert.equal(f.state.draftEditorSaving, false);
});

test("changing bookings after deletion confirmation opens prevents deletion", async () => {
  const f = setup();
  f.context.onDeleteSelectedDraftsClick();
  f.state.selectedBookingId = "b2";
  await f.context.onConfirmDraftDelete();
  assert.equal(f.calls.length, 0);
});
