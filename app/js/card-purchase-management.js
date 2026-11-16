import { recordEditLocks } from "./record-edit-locks.js";
import { crmGetRecord, crmGetAllRecords, crmUpdateRecord } from "./api.js";
import { MODULES } from "./constants.js";
import { escapeHtml } from "./utils.js";
import { showFeedback } from "./app-feedback.js";
import { requestCardPurchaseV8 } from "./card-purchase-api.js";

const lookupId = value => String(value?.id || value?.value || "");
const attachmentId = file => String(file.id || file.attachment_Id || "");
const fileName = file => file.File_Name__s || file.File_Name || file.file_Name || file.file_name || file.name || "Document";

export function canEditCardPurchase(record) {
  return Boolean(record?.id && !record.Vendor_Invoice && !record.Vendor_Payment && !record.Accounting_Processed_At && (
    record.Transaction_Type === "Purchase" && record.Accounting_Status === "Pending invoice" ||
    record.Transaction_Type === "Refund" && record.Accounting_Status === "Pending credit note"
  ));
}

async function getEditableRecord(state, bookingId, recordId) {
  const record = await requestCardPurchaseV8(recordId);
  if (String(state.selectedBookingId) !== bookingId || !record?.id || String(record.id) !== String(recordId) || lookupId(record.Booking) !== bookingId) throw new Error("Booking changed or transaction unavailable. Close and reopen the form.");
  if (!canEditCardPurchase(record)) throw new Error("Only card transactions in their initial accounting status can be edited or deleted.");
  return record;
}

function confirmed(result) {
  if (result?.code !== "SUCCESS") throw new Error(result?.message || "CRM did not confirm the change.");
}

export async function deleteCardPurchase(state, bookingId, recordId, modifiedTime) {
  return recordEditLocks.write(MODULES.cardPurchases, recordId, () => deleteCardPurchaseRaw(state, bookingId, recordId, modifiedTime));
}

async function deleteCardPurchaseRaw(state, bookingId, recordId, modifiedTime) {
  const record = await getEditableRecord(state, bookingId, recordId);
  if (modifiedTime !== undefined && modifiedTime !== record.Modified_Time) throw new Error("This transaction changed. Close and reopen the form.");
  const response = await window.ZOHO.CRM.API.deleteRecord({ Entity: MODULES.cardPurchases, RecordID: record.id });
  confirmed(response?.data?.[0] || response);
  if (String(state.selectedBookingId) === bookingId) {
    state.cardPurchases = (state.cardPurchases || []).filter(row => String(row.id) !== String(recordId));
  }
}

export async function openCardPurchaseDeletion(elements, state, recordId, onDeleted) {
  if (document.querySelector(".card-purchase-management-dialog")) return;
  const bookingId = String(state.selectedBookingId);
  const record = await getEditableRecord(state, bookingId, recordId);
  if (String(state.selectedBookingId) !== bookingId || document.querySelector(".card-purchase-management-dialog")) return;
  await recordEditLocks.begin(MODULES.cardPurchases, recordId);
  state.recordEditingLocksActive = true;
  const dialog = document.createElement("dialog");
  dialog.className = "booking-prepayment-details prepayment-management-dialog card-purchase-management-dialog";
  dialog.setAttribute("aria-label", "Delete card transaction");
  dialog.innerHTML = '<form><header class="prepayment-edit-header"><div><h3>Delete card transaction</h3><p class="prepayment-edit-reference">' + escapeHtml(record.Name || record.id) + '</p></div><button type="button" class="prepayment-edit-close" data-dismiss aria-label="Close dialog">&times;</button></header><p>Delete this card transaction permanently? This action cannot be undone.</p><p data-feedback role="status"></p><footer><button type="button" class="button tertiary" data-cancel>Cancel</button><button type="submit" class="button danger">Delete card transaction</button></footer></form>';
  const form = dialog.querySelector("form"), feedback = dialog.querySelector("[data-feedback]");
  const submit = form.querySelector('[type="submit"]'), previousFocus = document.activeElement;
  let busy = false;
  const close = () => { if (!busy) dialog.close(); };
  dialog.querySelector("[data-dismiss]").onclick = close;
  dialog.querySelector("[data-cancel]").onclick = close;
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  dialog.addEventListener("close", () => { void recordEditLocks.release(MODULES.cardPurchases, recordId).catch(() => {}); dialog.remove(); previousFocus?.focus(); }, { once: true });
  form.onsubmit = async event => {
    event.preventDefault();
    if (busy) return;
    busy = true; submit.disabled = true;
    feedback.textContent = "Deleting card transaction…";
    try {
      await recordEditLocks.check(MODULES.cardPurchases, recordId);
      // Read CRM again after confirmation; the accounting state may have changed.
      await deleteCardPurchase(state, bookingId, recordId, record.Modified_Time);
    } catch (error) {
      feedback.textContent = error.message;
      return;
    } finally { busy = false; submit.disabled = false; }
    dialog.close();
    showFeedback("Card transaction deleted.", "success");
    if (String(state.selectedBookingId) === bookingId && onDeleted) await onDeleted();
  };
  document.body.appendChild(dialog);
  dialog.showModal();
}

export async function saveCardPurchaseEdit(state, bookingId, recordId, values) {
  if (values.requiresReload) throw new Error("The previous save could not be verified. Close and reopen the form to check the saved documents before retrying.");
  const record = await getEditableRecord(state, bookingId, recordId);
  if (values.modifiedTime !== undefined && values.modifiedTime !== record.Modified_Time) throw new Error("This transaction changed while editing. Close and reopen the form.");
  const amount = Number(values.amount), day = String(values.date || ""), date = new Date(day + "T12:00:00Z");
  if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001) throw new Error("Enter an amount greater than zero with at most two decimal places.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) throw new Error("Enter a valid transaction date.");
  if (!values.accountId) throw new Error("Select a card payment account.");
  if (String(values.accountId) !== lookupId(record.Card_Payment_Account)) {
    const account = await crmGetRecord(MODULES.paymentAccounts, values.accountId);
    if (!account?.id || String(account.Owner_Type || "").toLowerCase() !== "own") throw new Error("Select an own payment account.");
  }
  const files = record.Supporting_Documents || [], removals = values.removeIds || [], additions = values.files || [];
  if (files.filter(file => !removals.includes(attachmentId(file))).length + additions.length > 5) throw new Error("Supporting documents allows a maximum of 5 files.");
  const documents = files.filter(file => removals.includes(attachmentId(file))).map(file => ({ id: attachmentId(file), _delete: null }));
  for (const item of additions) {
    if (!item.uploadedId) {
      const response = await window.ZOHO.CRM.API.uploadFile({ CONTENT_TYPE: "multipart", PARTS: [{ headers: { "Content-Disposition": "file;" }, content: "__FILE__" }], FILE: { fileParam: "content", file: item.file } });
      const result = (Array.isArray(response) ? response : response?.data || [])[0];
      confirmed(result);
      item.uploadedId = result.details?.id;
      if (!item.uploadedId) throw new Error("CRM did not return the uploaded file ID.");
    }
    documents.push({ File_Id__s: item.uploadedId });
  }
  // Uploads can take time: check the live status and booking again before writing.
  const fresh = await getEditableRecord(state, bookingId, recordId);
  if (fresh.Modified_Time !== record.Modified_Time) throw new Error("This transaction changed while saving. Close and reopen the form.");
  const payload = { id: record.id, Amount: amount, Card_Payment_Account: { id: String(values.accountId) }, Transaction_Notes: String(values.notes || "") };
  if (day !== String(record.Transaction_Date || "").slice(0, 10)) {
    const madridHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", hourCycle: "h23" }).format(date));
    payload.Transaction_Date = day + "T12:00:00+0" + (madridHour - 12) + ":00";
  }
  if (documents.length) payload.Supporting_Documents = documents;
  if (!documents.length) {
    confirmed(await crmUpdateRecord(MODULES.cardPurchases, payload, { expectedRecord: fresh }));
    return;
  }
  // An uncertain write must not be replayed: it could link the same invoice twice.
  values.requiresReload = true;
  await requestCardPurchaseV8(recordId, payload, fresh.Modified_Time);
  const retained = files.filter(file => !removals.includes(attachmentId(file)));
  for (let attempt = 0; attempt < 4; attempt++) {
    const saved = await requestCardPurchaseV8(recordId);
    const actual = Array.isArray(saved.Supporting_Documents) ? saved.Supporting_Documents : [];
    const used = new Set();
    const allAdded = additions.every(item => {
      const matches = actual.filter(file => !used.has(attachmentId(file)) && (
        String(file.File_Id__s || "") === String(item.uploadedId) ||
        (!files.some(previous => attachmentId(previous) === attachmentId(file)) &&
          fileName(file) === item.file.name && Number(file.Size__s) === item.file.size)
      ));
      if (matches.length !== 1) return false;
      used.add(attachmentId(matches[0]));
      return true;
    });
    if (allAdded && retained.every(file => actual.some(row => attachmentId(row) === attachmentId(file))) &&
        removals.every(id => !actual.some(file => attachmentId(file) === id))) {
      values.requiresReload = false;
      return;
    }
    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error("CRM accepted the changes, but Supporting Documents could not be verified. Close and reopen the form to check the saved documents before retrying.");
}

export async function openCardPurchaseManagement(elements, state, recordId, onSaved) {
  if (document.querySelector(".card-purchase-management-dialog")) return;
  const bookingId = String(state.selectedBookingId);
  const record = await getEditableRecord(state, bookingId, recordId);
  const accounts = [];
  for (let page = 1; ; page++) {
    const rows = await crmGetAllRecords(MODULES.paymentAccounts, page, 200);
    accounts.push(...rows.filter(row => String(row.Owner_Type || "").toLowerCase() === "own"));
    if (rows.length < 200) break;
  }
  if (String(state.selectedBookingId) !== bookingId || document.querySelector(".card-purchase-management-dialog")) return;
  const accountId = lookupId(record.Card_Payment_Account);
  if (accountId && !accounts.some(row => String(row.id) === accountId)) accounts.unshift({ id: accountId, Name: record.Card_Payment_Account.name || "Current account" });
  await recordEditLocks.begin(MODULES.cardPurchases, recordId);
  state.recordEditingLocksActive = true;
  const dialog = document.createElement("dialog");
  dialog.className = "booking-prepayment-details prepayment-management-dialog card-purchase-management-dialog";
  dialog.setAttribute("aria-label", "Edit card transaction");
  const files = record.Supporting_Documents || [];
  const icon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6a1 1 0 0 0-1 1v16h14V8zM14 3v5h5M8 12h8M8 16h5"/></svg>';
  dialog.innerHTML = '<form><header class="prepayment-edit-header"><div><h3>Edit card transaction</h3><p class="prepayment-edit-reference">' + escapeHtml(record.Name || record.id) + '</p></div><button type="button" class="prepayment-edit-close" data-dismiss aria-label="Close dialog">&times;</button></header><fieldset><div class="prepayment-edit-grid"><label class="field"><span>Amount (EUR)</span><input name="amount" type="number" min="0.01" step="0.01" required></label><label class="field"><span>Transaction date</span><input name="date" type="date" required></label><label class="field"><span>Card payment account</span><select name="accountId" required><option value="">Select an account</option>' + accounts.map(row => '<option value="' + escapeHtml(row.id) + '">' + escapeHtml(row.Name || row.id) + '</option>').join('') + '</select></label><label class="field"><span>Transaction notes</span><textarea name="notes" rows="3"></textarea></label></div><section class="prepayment-edit-documents" aria-label="Supporting documents"><h4>Supporting documents</h4><p class="prepayment-edit-hint">Up to 5 files. Uncheck a document to remove it when saving.</p><div class="prepayment-edit-files">' + files.map((file, index) => '<label class="prepayment-edit-file"><input type="checkbox" data-existing-file="' + index + '" checked' + (!attachmentId(file) ? ' disabled' : '') + '>' + icon + '<span class="prepayment-edit-file-info"><span class="prepayment-edit-file-name">' + escapeHtml(fileName(file)) + '</span><span class="prepayment-file-keep">Keep document</span><span class="prepayment-file-remove">Will be removed on save</span></span></label>').join('') + '</div><label class="prepayment-edit-upload"><input name="documents" type="file" multiple aria-label="Add supporting documents">' + icon + '<span><strong>Add documents</strong><small>Choose one or more files</small></span><span class="prepayment-upload-browse" aria-hidden="true">Browse files</span></label><ul class="prepayment-edit-selected" data-selected-files aria-live="polite" hidden></ul></section></fieldset><p data-feedback role="status"></p><footer><button type="button" class="button tertiary" data-cancel>Cancel</button><button type="submit" class="button prepayment-edit-submit">Save changes</button></footer></form>';
  const form = dialog.querySelector("form"), feedback = dialog.querySelector("[data-feedback]");
  const input = name => form.elements.namedItem(name);
  const submit = form.querySelector('[type="submit"]'), fieldset = form.querySelector("fieldset"), previousFocus = document.activeElement;
  let busy = false;
  const values = { files: [], modifiedTime: record.Modified_Time };
  input("amount").value = record.Amount ?? "";
  input("date").value = String(record.Transaction_Date || "").slice(0, 10);
  input("accountId").value = accountId;
  input("notes").value = record.Transaction_Notes || "";
  const close = () => { if (!busy) dialog.close(); };
  dialog.querySelector("[data-dismiss]").onclick = close;
  dialog.querySelector("[data-cancel]").onclick = close;
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  dialog.addEventListener("close", () => { void recordEditLocks.release(MODULES.cardPurchases, recordId).catch(() => {}); dialog.remove(); previousFocus?.focus(); }, { once: true });
  input("documents").onchange = event => {
    values.files = Array.from(event.target.files, file => ({ file }));
    const selected = dialog.querySelector("[data-selected-files]");
    selected.innerHTML = values.files.map(item => '<li>' + icon + '<span>' + escapeHtml(item.file.name) + '</span><small>New</small></li>').join('');
    selected.hidden = !values.files.length;
  };
  form.onsubmit = async event => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    for (const name of ["amount", "date", "accountId", "notes"]) values[name] = input(name).value;
    values.removeIds = Array.from(dialog.querySelectorAll("[data-existing-file]")).filter(node => !node.checked).map(node => attachmentId(files[Number(node.dataset.existingFile)]));
    busy = true; submit.disabled = true; fieldset.disabled = true;
    feedback.textContent = "";
    submit.ariaBusy = "true";
    submit.textContent = "Saving…";
    try {
      await recordEditLocks.check(MODULES.cardPurchases, recordId);
      await saveCardPurchaseEdit(state, bookingId, recordId, values);
    } catch (error) {
      feedback.textContent = error.message;
      return;
    } finally {
      busy = false; submit.disabled = false; fieldset.disabled = false;
      submit.ariaBusy = "false"; submit.textContent = "Save changes";
    }
    dialog.close();
    showFeedback("Card transaction updated.", "success");
    if (String(state.selectedBookingId) === bookingId && onSaved) await onSaved();
  };
  document.body.appendChild(dialog);
  dialog.showModal();
}
