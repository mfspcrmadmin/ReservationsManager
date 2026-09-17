import { requestCommunicationAttachmentsV8, ATTACHMENTS_TRANSPORT, createAttachmentTrace, attachmentResponseSummary } from "./communication-attachments-api.js";
import { escapeHtml } from "./utils.js";

export const MAX_ATTACHMENT_BYTES = 15000000;
export const MAX_ATTACHMENTS = 5;
const counts = new Map();

export function normalizeCommunicationAttachments(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error("CRM returned an unexpected attachment format.");
  return value.map(function (file) {
    if (!file || typeof file !== "object") throw new Error("CRM returned an invalid attachment.");
    const rawSize = file.original_Size_Byte ?? file.Size__s ?? file.File_Size__s ?? file.file_Size ?? file.size ?? file.Size;
    return {
      id: String(file.attachment_Id || file.id || ""),
      fileId: String(file.File_Id__s || file.$file_id || file.file_Id || file.file_id || file.File_Id || ""),
      name: String(file.File_Name__s || file.File_Name || file.file_Name || file.file_name || file.name || "Attachment"),
      size: rawSize != null && Number.isFinite(Number(rawSize)) && Number(rawSize) >= 0 ? Number(rawSize) : null
    };
  });
}

export function validateCommunicationAttachments(existing, files) {
  if (existing.length + files.length > MAX_ATTACHMENTS) throw new Error("You can attach up to 5 files per email.");
  if (files.some(file => !file.size)) throw new Error("Empty files cannot be attached.");
  if (files.length && existing.some(file => file.size === null)) throw new Error("CRM did not return the size of an existing attachment. Refresh the attachments before adding more files.");
  const total = existing.reduce((sum, file) => sum + (file.size || 0), 0) + files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_ATTACHMENT_BYTES) throw new Error("Attachments must not exceed 15 MB in total.");
}

export async function loadCommunicationAttachments(communicationId, trace = createAttachmentTrace()) {
  const record = await requestCommunicationAttachmentsV8(communicationId, undefined, trace);
  trace("record-loaded", { recordMatches: Boolean(record && String(record.id) === String(communicationId)),
    sent: String(record && record.Communication_Status || "").toLowerCase() === "sent",
    fieldKeys: record && Array.isArray(record.Email_Attachments) ? record.Email_Attachments.map(file => Object.keys(file || {})) : [] });
  if (!record || String(record.id) !== String(communicationId)) throw new Error("Could not load this Communication.");
  if (!Object.prototype.hasOwnProperty.call(record, "Email_Attachments")) throw new Error("Email Attachments is unavailable. Check the field API name and your field permissions in Communications.");
  return {
    files: normalizeCommunicationAttachments(record.Email_Attachments),
    readOnly: String(record.Communication_Status || "").toLowerCase() === "sent",
    fieldKeys: Array.isArray(record.Email_Attachments) ? record.Email_Attachments.map(file => Object.keys(file || {}).sort()) : []
  };
}

function matchSavedAttachments(files, pending) {
  const matched = new Map();
  const used = new Set();
  for (const entry of pending) {
    const file = files.find(file => !used.has(file) &&
      (entry.savedAttachmentId && file.id === entry.savedAttachmentId || entry.fileId && file.fileId === entry.fileId));
    if (file) { matched.set(entry, file); used.add(file); }
  }
  // CRM v8 can return a different file ID from the upload response. Only infer
  // a match for a new link with the exact name and byte size, uniquely paired.
  for (const entry of pending) {
    if (matched.has(entry) || !entry.beforeAttachmentIds) continue;
    const candidates = files.filter(file => !used.has(file) && file.id &&
      !entry.beforeAttachmentIds.includes(file.id) && file.name === entry.file.name && file.size === entry.file.size);
    const peers = pending.filter(other => !matched.has(other) && other.file.name === entry.file.name && other.file.size === entry.file.size);
    if (candidates.length === 1 && peers.length === 1) {
      matched.set(entry, candidates[0]);
      used.add(candidates[0]);
    }
  }
  for (const [entry, file] of matched) { if (file.id) entry.savedAttachmentId = file.id; }
  return matched;
}

function attachmentChangesConfirmed(saved, pending, removed) {
  return matchSavedAttachments(saved.files, pending).size === pending.length &&
    !saved.files.some(file => removed.has(file.id));
}

async function verifyAttachmentChanges(communicationId, pending, removed, trace) {
  let saved = await loadCommunicationAttachments(communicationId, trace);
  // CRM may acknowledge the update before the file field is visible in reads.
  // Retry reads only; never repeat a write or upload during verification.
  for (const delay of [300, 800, 1500]) {
    if (attachmentChangesConfirmed(saved, pending, removed)) break;
    trace("verification-retry", { delayMs: delay, returnedFiles: saved.files.length,
      matchedUploads: matchSavedAttachments(saved.files, pending).size });
    await new Promise(resolve => setTimeout(resolve, delay));
    saved = await loadCommunicationAttachments(communicationId, trace);
  }
  if (!attachmentChangesConfirmed(saved, pending, removed)) {
    const diagnostic = {
      event: "attachment-readback-mismatch",
      transport: ATTACHMENTS_TRANSPORT,
      returnedFiles: saved.files.length,
      pendingFiles: pending.length,
      matchedUploads: matchSavedAttachments(saved.files, pending).size,
      unconfirmedRemovals: saved.files.filter(file => removed.has(file.id)).length,
      filesWithoutUploadId: saved.files.filter(file => !file.fileId).length,
      returnedFieldKeys: saved.fieldKeys
    };
    // No file content, recipient information, download URLs or encrypted IDs.
    console.error("[Communication attachments] " + JSON.stringify(diagnostic));
    trace("verification-failed", diagnostic);
    const error = new Error("CRM accepted the update, but the saved attachments could not be verified. " +
      "Saved files returned: " + saved.files.length + "; selected files matched: " + diagnostic.matchedUploads + "/" + pending.length + ". Your selected files are still available in this window.");
    error.attachmentDiagnostic = diagnostic;
    throw error;
  }
  return saved;
}

// Only additions and explicit removals are sent, preserving other saved files.
// Uploaded IDs remain on pending entries so a failed save can be retried safely.
export async function saveCommunicationAttachments(communicationId, pending, removed, progress) {
  const trace = createAttachmentTrace();
  let stage = "initial-read";
  trace("save-start", { pendingFiles: pending.length, removals: removed.size,
    files: pending.map(entry => ({ bytes: entry.file.size, type: entry.file.type || "", alreadyUploaded: Boolean(entry.fileId) })) });
  try {
    const latest = await loadCommunicationAttachments(communicationId, trace);
    if (latest.readOnly) throw new Error("Attachments cannot be changed after the email has been sent.");
    const remaining = latest.files.filter(file => !removed.has(file.id));
    const alreadySaved = matchSavedAttachments(remaining, pending);
    const additions = pending.filter(entry => !alreadySaved.has(entry));
    validateCommunicationAttachments(remaining, additions.map(entry => entry.file));
    trace("validation-passed", { existing: latest.files.length, retained: remaining.length, additions: additions.length });
    stage = "upload";
    for (const entry of additions) {
      if (entry.fileId) continue;
      trace("upload-start", { index: pending.indexOf(entry), bytes: entry.file.size });
      progress("Uploading " + entry.file.name + "…");
      const response = await window.ZOHO.CRM.API.uploadFile({
        CONTENT_TYPE: "multipart",
        PARTS: [{ headers: { "Content-Disposition": "file;" }, content: "__FILE__" }],
        FILE: { fileParam: "content", file: entry.file }
      });
      const result = (Array.isArray(response) ? response : response && response.data || [])[0] || {};
      const id = result.details && result.details.id;
      trace("upload-response", { index: pending.indexOf(entry), envelope: attachmentResponseSummary(response), result: attachmentResponseSummary(result) });
      if (!id || String(result.status || "").toLowerCase() === "error") throw new Error(result.message || "Could not upload " + entry.file.name + ".");
      entry.fileId = String(id);
    }
    // Recheck after uploading, which may take a while, before changing the record.
    stage = "before-save-read";
    const beforeSave = await loadCommunicationAttachments(communicationId, trace);
    if (beforeSave.readOnly) throw new Error("This email was sent while the files were uploading. Its attachments were not changed.");
    const savedBeforeWrite = matchSavedAttachments(beforeSave.files.filter(file => !removed.has(file.id)), pending);
    const toAdd = pending.filter(entry => !savedBeforeWrite.has(entry));
    for (const entry of toAdd) {
      if (entry.beforeAttachmentIds && beforeSave.files.some(file => file.id && !entry.beforeAttachmentIds.includes(file.id) && file.name === entry.file.name && file.size === entry.file.size)) {
        throw new Error("CRM returned ambiguous attachment matches. Close and reopen attachments to review the saved files before retrying.");
      }
    }
    validateCommunicationAttachments(beforeSave.files.filter(file => !removed.has(file.id)), toAdd.map(entry => entry.file));
    // Use the explicit v8 endpoint for file fields, including their readback.
    // The generic embedded updateRecord call does not expose an API version.
    const changes = toAdd.map(entry => ({ File_Id__s: entry.fileId })).concat(
      beforeSave.files.filter(file => removed.has(file.id)).map(file => ({ id: file.id, _delete: null }))
    );
    if (changes.length) {
      stage = "update";
      for (const entry of toAdd) {
        if (!entry.beforeAttachmentIds) entry.beforeAttachmentIds = beforeSave.files.map(file => file.id);
      }
      progress("Saving attachments…");
      const result = await requestCommunicationAttachmentsV8(communicationId, changes, trace);
      if (String(result.code || "").toUpperCase() !== "SUCCESS" || String(result.status || "").toLowerCase() === "error") throw new Error(result.message || "CRM did not confirm the attachment update.");
    }
    stage = "verification";
    const saved = await verifyAttachmentChanges(communicationId, pending, removed, trace);
    trace("save-complete", { returnedFiles: saved.files.length });
    return saved;
  } catch (error) {
    trace("save-failed", { stage, errorType: error && error.name, code: error && error.code });
    throw error;
  }
}

export function renderCommunicationAttachmentsButton(button, record, disabled) {
  if (!button) return;
  const id = String(record && record.communication_id || "");
  button.hidden = !id;
  button.disabled = Boolean(disabled);
  const count = counts.get(id);
  button.querySelector("span").textContent = count === undefined ? "Attachments" : "Attachments (" + count + ")";
}

function formatSize(size) {
  return size === null ? "" : size >= 1000000 ? (size / 1000000).toFixed(1) + " MB" : Math.max(1, Math.round(size / 1000)) + " KB";
}

export async function openCommunicationAttachments(record, trigger) {
  const communicationId = String(record && record.communication_id || "");
  if (!communicationId || document.getElementById("communication-attachments-dialog")) return;
  const dialog = document.createElement("dialog");
  dialog.id = "communication-attachments-dialog";
  dialog.className = "communication-attachments-dialog";
  dialog.setAttribute("aria-labelledby", "communication-attachments-title");
  dialog.innerHTML = '<header><h3 id="communication-attachments-title">Email attachments</h3><button type="button" class="icon-button" data-close aria-label="Close attachments">×</button></header>' +
    '<p class="attachment-help">Up to 5 files · 15 MB total</p>' +
    '<div class="attachment-drop-zone" data-drop><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9"/></svg><strong>Drag files here</strong><span>or</span><button type="button" class="button tertiary compact" data-browse>Browse files</button><input type="file" multiple hidden></div>' +
    '<ul class="attachment-list" aria-label="Attachments"></ul><p class="attachment-feedback" role="status" aria-live="polite"></p><details class="attachment-diagnostic" hidden><summary>Technical details</summary><pre></pre></details>' +
    '<footer><button type="button" class="button tertiary compact" data-close>Close</button><button type="button" class="button success compact" data-save>Save attachments</button></footer>';
  let files = [];
  let pending = [];
  const removed = new Set();
  let busy = true;
  let ready = false;
  let readOnly = String(record.communication_status || "").toLowerCase() === "sent";
  const list = dialog.querySelector("ul");
  const feedback = dialog.querySelector(".attachment-feedback");
  const drop = dialog.querySelector("[data-drop]");
  const input = dialog.querySelector('input[type="file"]');
  const saveButton = dialog.querySelector("[data-save]");
  function message(text, error = false) {
    feedback.textContent = text;
    feedback.classList.toggle("is-error", error);
    dialog.querySelector(".attachment-diagnostic").hidden = true;
  }
  function draw() {
    drop.hidden = readOnly;
    saveButton.hidden = readOnly;
    const rows = files.filter(file => !removed.has(file.id)).map(file => ({ ...file, saved: true, index: files.indexOf(file) }))
      .concat(pending.map((entry, index) => ({ name: entry.file.name, size: entry.file.size, saved: false, index })));
    list.innerHTML = rows.length ? rows.map(file => '<li><div><strong>' + escapeHtml(file.name) + '</strong><small>' + escapeHtml(formatSize(file.size)) + (file.saved ? ' · Saved' : ' · Pending') + '</small></div>' + (!readOnly ? '<button type="button" class="icon-button" data-remove="' + file.index + '" data-saved="' + file.saved + '" aria-label="Remove ' + escapeHtml(file.name) + '"' + (file.saved && !file.id ? ' disabled' : '') + '>×</button>' : '') + '</li>').join("") : '<li class="attachment-empty">No attachments yet.</li>';
    dialog.querySelectorAll("button").forEach(button => { button.disabled = busy || (!ready && !button.hasAttribute("data-close")); });
    list.querySelectorAll('[data-saved="true"]').forEach(button => { if (!files[Number(button.dataset.remove)].id) button.disabled = true; });
    saveButton.disabled = busy || !ready || (!pending.length && !removed.size);
    input.disabled = busy || !ready || readOnly;
    dialog.setAttribute("aria-busy", String(busy));
    dialog.querySelector('footer [data-close]').textContent = pending.length || removed.size ? "Cancel" : "Close";
  }
  function addFiles(incoming) {
    if (busy || !ready || readOnly) return;
    const retained = files.filter(file => !removed.has(file.id));
    const additions = [];
    for (const file of Array.from(incoming || [])) {
      if (retained.some(entry => entry.name === file.name && entry.size === file.size) || pending.some(entry => entry.file.name === file.name && entry.file.size === file.size) || additions.some(entry => entry.name === file.name && entry.size === file.size)) continue;
      additions.push(file);
    }
    try {
      validateCommunicationAttachments(retained, pending.map(entry => entry.file).concat(additions));
      pending.push(...additions.map(file => ({ file, fileId: "" })));
      message(additions.length ? "Ready to save. Files will be attached when you send this email." : "These files are already listed.");
      draw();
    } catch (error) { message(error.message, true); }
  }
  dialog.querySelector("[data-browse]").onclick = () => input.click();
  input.onchange = () => { addFiles(input.files); input.value = ""; };
  dialog.addEventListener("dragover", function (event) { event.preventDefault(); if (!busy && !readOnly) drop.classList.add("is-dragging"); });
  dialog.addEventListener("dragleave", event => { if (!dialog.contains(event.relatedTarget)) drop.classList.remove("is-dragging"); });
  dialog.addEventListener("drop", function (event) { event.preventDefault(); drop.classList.remove("is-dragging"); addFiles(event.dataTransfer.files); });
  list.onclick = function (event) {
    const button = event.target.closest("[data-remove]");
    if (!button || busy || readOnly || button.disabled) return;
    if (button.dataset.saved === "true") removed.add(files[Number(button.dataset.remove)].id);
    else pending.splice(Number(button.dataset.remove), 1);
    message("Save attachments to apply your changes.");
    draw();
  };
  dialog.querySelectorAll("[data-close]").forEach(button => { button.onclick = () => { if (!busy) dialog.close(); }; });
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  dialog.addEventListener("close", function () { dialog.remove(); if (trigger && trigger.isConnected) trigger.focus(); });
  saveButton.onclick = async function () {
    if (busy || readOnly || !ready) return;
    busy = true;
    draw();
    message("Preparing attachments…");
    try {
      const saved = await saveCommunicationAttachments(communicationId, pending, removed, message);
      files = saved.files;
      readOnly = saved.readOnly;
      pending = [];
      removed.clear();
      counts.set(communicationId, files.length);
      renderCommunicationAttachmentsButton(trigger, record, false);
      message("Attachments saved.");
      dialog.close();
    } catch (error) {
      message(error.message || "Could not save attachments.", true);
      if (error.attachmentDiagnostic) {
        const details = dialog.querySelector(".attachment-diagnostic");
        details.hidden = false;
        details.querySelector("pre").textContent = JSON.stringify(error.attachmentDiagnostic, null, 2);
      }
    }
    finally { busy = false; draw(); }
  };
  document.body.appendChild(dialog);
  draw();
  message("Loading attachments…");
  dialog.showModal();
  try {
      const loaded = await loadCommunicationAttachments(communicationId);
      files = loaded.files;
      readOnly = readOnly || loaded.readOnly;
      ready = true;
      counts.set(communicationId, files.length);
      renderCommunicationAttachmentsButton(trigger, record, false);
      message(readOnly ? "Attachments for this sent email are read-only." : "Files are saved when you click Save attachments.");
    } catch (error) { message(error.message || "Could not load attachments.", true); }
    finally { busy = false; draw(); }
  }
