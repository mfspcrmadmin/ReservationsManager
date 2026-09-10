const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const source = fs.readFileSync(path.join(__dirname, "../app/js/communication-attachments.js"), "utf8")
  .replace(/^import .*;\r?\n/gm, "").replace(/export /g, "");
const transportSource = fs.readFileSync(path.join(__dirname, "../app/js/communication-attachments-api.js"), "utf8")
  .replace(/export /g, "");

function setup() {
  const fixture = { record: { id: "comm1", Communication_Status: "Draft", Email_Attachments: [] }, uploads: [], writes: [], logs: [], failWrite: false, failReadback: false };
  const uploaded = new Map();
  const context = vm.createContext({
    setTimeout: callback => callback(),
    console: {
      info: message => { fixture.logs.push(JSON.parse(message.slice("[Communication attachments] ".length))); },
      error: message => { fixture.diagnostic = JSON.parse(message.slice("[Communication attachments] ".length)); }
    },
    crmGetRecord: async () => {
      if (fixture.readError) { fixture.readError = false; throw new Error("Readback failed"); }
      if (fixture.staleReads > 0) { fixture.staleReads -= 1; return structuredClone(fixture.previousRecord); }
      return structuredClone(fixture.record);
    },
    crmUpdateRecord: async (module, payload) => {
      fixture.writes.push(structuredClone(payload));
      if (fixture.failWrite) return { code: "NO_PERMISSION", status: "error", message: "Permission denied" };
      if (fixture.ignoreWrite) return { code: "SUCCESS", status: "success" };
      fixture.previousRecord = structuredClone(fixture.record);
      for (const change of payload.Email_Attachments) {
        if (Object.prototype.hasOwnProperty.call(change, "_delete")) fixture.record.Email_Attachments = fixture.record.Email_Attachments.filter(file => file.attachment_Id !== change.id);
        else if (change.File_Id__s) {
          const file = uploaded.get(change.File_Id__s);
          fixture.record.Email_Attachments.push({ attachment_Id: "link-" + change.File_Id__s, file_Id: change.File_Id__s, file_Name: file.name, original_Size_Byte: String(file.size), file_Size: "1 KB" });
          if (fixture.v8Readback) fixture.record.Email_Attachments[fixture.record.Email_Attachments.length - 1] = {
            id: "link-" + change.File_Id__s, File_Id__s: "stored-" + change.File_Id__s,
            File_Name__s: file.name, Size__s: String(file.size)
          };
        }
      }
      fixture.staleReads = fixture.readLag || 0;
      if (fixture.failReadback) { fixture.readError = true; fixture.failReadback = false; }
      return { code: "SUCCESS", status: "success" };
    },
    window: { ZOHO: { CRM: { API: { uploadFile: async request => {
      const file = request.FILE.file;
      fixture.uploads.push(file.name);
      if (fixture.failUpload === file.name) throw new Error("Upload failed");
      const id = "file-" + fixture.uploads.length;
      uploaded.set(id, file);
      return { data: [{ status: "success", details: { id } }] };
    } } } } }
  });
  fixture.requests = [];
  context.window.ZOHO.CRM.CONNECTION = { invoke: async (name, request) => {
    assert.equal(name, "crm_oauth_connection");
    assert.equal(request.url, "https://www.zohoapis.eu/crm/v8/Communications/comm1");
    fixture.requests.push(structuredClone(request));
    if (fixture.connectionResponse) return fixture.connectionResponse;
    let result;
    if (request.method === "PUT") {
      assert.equal(request.param_type, 2);
      assert.equal(typeof request.parameters, "object");
      result = await context.crmUpdateRecord("Communications", request.parameters.data[0]);
    } else {
      assert.equal(request.method, "GET");
      result = await context.crmGetRecord();
    }
    return { code: "SUCCESS", details: { statusCode: 200, statusMessage: JSON.stringify({ data: [result] }) } };
  } };
  context.window.ZOHO.CRM.API.updateRecord = async () => { throw new Error("Unversioned SDK writes must not be used for file fields"); };
  vm.runInContext(transportSource + "\n" + source, context);
  return { context, fixture };
}

function entry(name, size = 1000) { return { file: { name, size }, fileId: "" }; }
function stored(id, size = 1000) { return { attachment_Id: id, file_Id: "zfs-" + id, file_Name: id + ".pdf", original_Size_Byte: String(size) }; }
const progress = () => {};

test("v8 readback verifies new links when stored and uploaded file IDs differ", async () => {
  const { context, fixture } = setup();
  fixture.v8Readback = true;
  const saved = await context.saveCommunicationAttachments("comm1", [entry("one.pdf")], new Set(), progress);
  assert.equal(saved.files[0].size, 1000);
  assert.equal(saved.files[0].fileId, "stored-file-1");
});

test("lost v8 readback can be retried without creating a duplicate link", async () => {
  const { context, fixture } = setup();
  fixture.v8Readback = true;
  fixture.failReadback = true;
  const pending = [entry("one.pdf")];
  await assert.rejects(context.saveCommunicationAttachments("comm1", pending, new Set(), progress), /Readback/);
  await context.saveCommunicationAttachments("comm1", pending, new Set(), progress);
  assert.equal(fixture.uploads.length, 1);
  assert.equal(fixture.writes.length, 1);
});

test("an existing same-name file cannot confirm an ignored upload", async () => {
  const { context, fixture } = setup();
  fixture.record.Email_Attachments = [{ id: "existing", File_Id__s: "old", File_Name__s: "one.pdf", Size__s: 1000 }];
  fixture.ignoreWrite = true;
  await assert.rejects(context.saveCommunicationAttachments("comm1", [entry("one.pdf")], new Set(), progress), /could not be verified/);
});

test("fallback matching requires exact size and unique new links", () => {
  const { context } = setup();
  const pending = [{ ...entry("one.pdf"), fileId: "upload", beforeAttachmentIds: [] }];
  const file = { id: "new", fileId: "stored", name: "one.pdf", size: 999 };
  assert.equal(context.matchSavedAttachments([file], pending).size, 0);
  file.size = 1000;
  assert.equal(context.matchSavedAttachments([file, { ...file, id: "new2" }], pending).size, 0);
  assert.equal(context.matchSavedAttachments([file], [pending[0], { ...pending[0] }]).size, 0);
});

test("save logs correlate all stages without exposing record or uploaded file data", async () => {
  const { context, fixture } = setup();
  fixture.record.Recipient_To = "private@example.com";
  await context.saveCommunicationAttachments("comm1", [entry("private-document.pdf")], new Set(), progress);
  assert.equal(new Set(fixture.logs.map(log => log.traceId)).size, 1);
  for (const event of ["save-start", "request-start", "connection-response", "crm-result", "record-loaded", "upload-start", "upload-response", "save-complete"]) {
    assert.ok(fixture.logs.some(log => log.event === event), event);
  }
  const serialized = JSON.stringify(fixture.logs);
  for (const secret of ["private@example.com", "private-document.pdf", "file-1", "comm1"]) assert.ok(!serialized.includes(secret), secret);
  const update = fixture.logs.find(log => log.event === "request-start" && log.method === "PUT");
  assert.deepEqual(update.changeKeys, [["File_Id__s"]]);
});

test("ignored updates log retry counts and the failing stage", async () => {
  const { context, fixture } = setup();
  fixture.ignoreWrite = true;
  await assert.rejects(context.saveCommunicationAttachments("comm1", [entry("one.pdf")], new Set(), progress));
  assert.equal(fixture.logs.filter(log => log.event === "verification-retry").length, 3);
  assert.equal(fixture.logs.at(-1).stage, "verification");
  assert.equal(fixture.logs.at(-1).event, "save-failed");
});

test("links uploaded files using the documented file field key even when CRM silently ignores other keys", async () => {
  const { context, fixture } = setup();
  const saved = await context.saveCommunicationAttachments("comm1", [entry("one.pdf")], new Set(), progress);
  assert.equal(saved.files[0].name, "one.pdf");
  assert.equal(fixture.writes[0].Email_Attachments[0].File_Id__s, "file-1");
  assert.equal(fixture.requests.filter(request => request.method === "PUT").length, 1);
});

test("connection errors stop before uploading or writing", async () => {
  const { context, fixture } = setup();
  fixture.connectionResponse = { code: "INVALID_CONNECTION", status: "error", message: "Connection unavailable" };
  await assert.rejects(context.saveCommunicationAttachments("comm1", [entry("one.pdf")], new Set(), progress), /crm_oauth_connection.*INVALID_CONNECTION/);
  assert.equal(fixture.uploads.length, 0);
  assert.equal(fixture.writes.length, 0);
});

test("connection-level SUCCESS does not hide nested CRM errors", async () => {
  const { context, fixture } = setup();
  fixture.connectionResponse = { code: "SUCCESS", details: { statusCode: 400, statusMessage: JSON.stringify({ code: "INVALID_DATA", message: "Invalid field", details: { api_name: "Email_Attachments" } }) } };
  await assert.rejects(context.loadCommunicationAttachments("comm1"), /INVALID_DATA.*Email_Attachments/);
});

test("connection acknowledgement without CRM record data cannot confirm a save", async () => {
  const { context, fixture } = setup();
  fixture.connectionResponse = { code: "SUCCESS", details: { CODE: 200, message: "action completed successfully" } };
  await assert.rejects(context.requestCommunicationAttachmentsV8("comm1", []), /Attachment request failed/);
});

test("accepts object and string connection response bodies", async () => {
  const { context, fixture } = setup();
  for (const response of [
    { code: "SUCCESS", details: { statusMessage: { data: [fixture.record] } } },
    JSON.stringify({ code: "SUCCESS", details: { statusMessage: JSON.stringify({ data: [fixture.record] }) } }),
    { data: [fixture.record] }
  ]) {
    fixture.connectionResponse = response;
    assert.equal((await context.loadCommunicationAttachments("comm1")).files.length, 0);
  }
});

test("waits for delayed readback without repeating the upload or write", async () => {
  const { context, fixture } = setup();
  fixture.readLag = 2;
  const saved = await context.saveCommunicationAttachments("comm1", [entry("one.pdf")], new Set(), progress);
  assert.equal(saved.files.length, 1);
  assert.equal(fixture.uploads.length, 1);
  assert.equal(fixture.writes.length, 1);
});

test("a success response with no field changes is not treated as a saved attachment", async () => {
  const { context, fixture } = setup();
  fixture.ignoreWrite = true;
  const pending = [entry("one.pdf")];
  await assert.rejects(context.saveCommunicationAttachments("comm1", pending, new Set(), progress), error => {
    assert.equal(error.attachmentDiagnostic.returnedFiles, 0);
    return /could not be verified/.test(error.message);
  });
  assert.equal(fixture.uploads.length, 1);
  assert.equal(fixture.writes.length, 1);
  assert.equal(pending[0].fileId, "file-1");
  assert.ok(!JSON.stringify(fixture.diagnostic).includes("file-1"));
});

test("recognizes alternate upload ID keys in CRM readback", () => {
  const { context } = setup();
  for (const key of ["$file_id", "File_Id", "File_Id__s", "file_Id", "file_id"]) {
    assert.equal(context.normalizeCommunicationAttachments([{ [key]: "upload-id", id: "link-id" }])[0].fileId, "upload-id");
  }
});

test("normalizes CRM attachment IDs and byte sizes without using formatted sizes", () => {
  const { context } = setup();
  const result = context.normalizeCommunicationAttachments([{ ...stored("one", 1234), file_Size: "1.23 KB" }])[0];
  assert.equal(result.id, "one");
  assert.equal(result.fileId, "zfs-one");
  assert.equal(result.size, 1234);
  assert.throws(() => context.normalizeCommunicationAttachments("invalid"), /unexpected/);
});

test("validates total size, file count and empty documents before upload", () => {
  const { context } = setup();
  assert.throws(() => context.validateCommunicationAttachments([{ size: 14999001 }], [{ size: 1000 }]), /15 MB/);
  assert.throws(() => context.validateCommunicationAttachments([], Array.from({ length: 6 }, () => ({ size: 1 }))), /5 files/);
  assert.throws(() => context.validateCommunicationAttachments([], [{ size: 0 }]), /Empty/);
  assert.doesNotThrow(() => context.validateCommunicationAttachments([], [{ size: 15000000 }]));
});

test("adds and removes selected files while preserving other saved attachments", async () => {
  const { context, fixture } = setup();
  fixture.record.Email_Attachments = [stored("keep"), stored("remove")];
  const saved = await context.saveCommunicationAttachments("comm1", [entry("new.pdf")], new Set(["remove"]), progress);
  assert.equal(saved.files.length, 2);
  assert.ok(saved.files.some(file => file.id === "keep"));
  assert.ok(saved.files.some(file => file.name === "new.pdf"));
  assert.equal(fixture.writes[0].Email_Attachments.length, 2);
});

test("failed record update preserves uploaded IDs and retries without uploading again", async () => {
  const { context, fixture } = setup();
  const pending = [entry("one.pdf")];
  fixture.failWrite = true;
  await assert.rejects(context.saveCommunicationAttachments("comm1", pending, new Set(), progress), /Permission denied/);
  fixture.failWrite = false;
  await context.saveCommunicationAttachments("comm1", pending, new Set(), progress);
  assert.equal(fixture.uploads.length, 1);
  assert.equal(fixture.record.Email_Attachments.length, 1);
});

test("a lost readback after a successful update does not duplicate files on retry", async () => {
  const { context, fixture } = setup();
  const pending = [entry("one.pdf")];
  fixture.failReadback = true;
  await assert.rejects(context.saveCommunicationAttachments("comm1", pending, new Set(), progress), /Readback/);
  await context.saveCommunicationAttachments("comm1", pending, new Set(), progress);
  assert.equal(fixture.uploads.length, 1);
  assert.equal(fixture.writes.length, 1);
  assert.equal(fixture.record.Email_Attachments.length, 1);
});

test("partial upload failure keeps successfully uploaded IDs and leaves the record unchanged", async () => {
  const { context, fixture } = setup();
  const pending = [entry("one.pdf"), entry("two.pdf")];
  fixture.failUpload = "two.pdf";
  await assert.rejects(context.saveCommunicationAttachments("comm1", pending, new Set(), progress), /Upload failed/);
  assert.equal(fixture.writes.length, 0);
  assert.ok(pending[0].fileId);
  fixture.failUpload = null;
  await context.saveCommunicationAttachments("comm1", pending, new Set(), progress);
  assert.equal(fixture.uploads.filter(name => name === "one.pdf").length, 1);
  assert.equal(fixture.record.Email_Attachments.length, 2);
});

test("sent Communications and missing fields cannot be edited", async () => {
  const { context, fixture } = setup();
  fixture.record.Communication_Status = "Sent";
  await assert.rejects(context.saveCommunicationAttachments("comm1", [entry("one.pdf")], new Set(), progress), /after the email/);
  delete fixture.record.Email_Attachments;
  await assert.rejects(context.loadCommunicationAttachments("comm1"), /unavailable/);
  assert.equal(fixture.uploads.length, 0);
  assert.equal(fixture.writes.length, 0);
});

test("a Communication sent during upload is checked again before saving", async () => {
  const { context, fixture } = setup();
  await assert.rejects(context.saveCommunicationAttachments("comm1", [entry("one.pdf")], new Set(), () => { fixture.record.Communication_Status = "Sent"; }), /sent while/);
  assert.equal(fixture.writes.length, 0);
});
