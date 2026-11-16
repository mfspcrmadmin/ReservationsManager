import { requestCardPurchaseV8 } from "./card-purchase-api.js";

const creationKey = (state, bookingId, serviceId) => "bookingsManager.cardCreation:" + JSON.stringify([String(state.currentUserId || ""), String(bookingId), String(serviceId)]);

export function pendingCardPurchaseCreation(state, bookingId, serviceId) {
  const key = creationKey(state, bookingId, serviceId);
  state.cardPurchaseCreations ||= {};
  if (state.cardPurchaseCreations[key]) return state.cardPurchaseCreations[key];
  let raw;
  try { raw = window.sessionStorage.getItem(key); } catch (_) { return null; }
  if (!raw) return null;
  let attempt;
  try { attempt = JSON.parse(raw); } catch (_) { throw new Error("The previous card transaction recovery data is unreadable. Check CRM before creating another transaction."); }
  if (attempt.bookingId !== String(bookingId) || attempt.serviceId !== String(serviceId) || !Array.isArray(attempt.documents)) throw new Error("The previous card transaction needs review in CRM before continuing.");
  state.cardPurchaseCreations[key] = attempt;
  return attempt;
}

function rememberCreation(state, attempt) {
  const key = creationKey(state, attempt.bookingId, attempt.serviceId);
  state.cardPurchaseCreations ||= {};
  state.cardPurchaseCreations[key] = attempt;
  try { window.sessionStorage.setItem(key, JSON.stringify(attempt)); }
  catch (_) { throw new Error("Recovery information could not be saved in this browser. No new transaction will be created. Check CRM before retrying."); }
}

export function cardCreationDocumentsMatch(actual, wanted) {
  if (!Array.isArray(actual) || !wanted.length) return false;
  const used = new Set();
  return wanted.every(document => {
    const matches = actual.filter((file, index) => !used.has(index) && (
      [file.File_Id__s, file.File_Id, file.file_Id, file.file_id, file.$file_id].some(id => id != null && String(id) === String(document.File_Id__s)) ||
      (document.file?.name && (file.File_Name__s || file.File_Name || file.file_Name || file.file_name || file.name) === document.file.name && Number(file.Size__s ?? file.size) === document.file.size)
    ));
    if (matches.length !== 1) return false;
    used.add(actual.indexOf(matches[0]));
    return true;
  });
}

export async function completeCardPurchaseCreation(state, bookingId, serviceId, options = {}) {
  const request = options.request || requestCardPurchaseV8;
  let attempt = pendingCardPurchaseCreation(state, bookingId, serviceId);
  if (!attempt || attempt.phase === "prepared") {
    if (!options.payload || !options.documents?.length) throw new Error("Attach Supporting Documents before creating the transaction.");
    attempt = { bookingId: String(bookingId), serviceId: String(serviceId), documents: options.documents, phase: "prepared", recordId: "" };
    rememberCreation(state, attempt);
    attempt.phase = "creating";
    // Save the uncertain state BEFORE calling create: a lost response must never replay it.
    rememberCreation(state, attempt);
    const created = await options.create(options.payload);
    attempt.recordId = String(created?.id || created?.details?.id || "");
    if (!attempt.recordId) throw new Error("CRM did not return the created transaction ID. Check CRM before creating another transaction.");
    attempt.phase = "created";
    rememberCreation(state, attempt);
  }
  if (!attempt.recordId) throw new Error("The previous transaction creation could not be confirmed. Check CRM before creating another transaction; this form will not create it again.");
  const verify = async () => {
    const record = await request(attempt.recordId);
    if (String(record.Booking?.id) !== attempt.bookingId || String(record.Boking_Service?.id) !== attempt.serviceId) throw new Error("The saved transaction does not match this booking and service. Recovery is blocked.");
    return record;
  };
  let record = await verify();
  if (!cardCreationDocumentsMatch(record.Supporting_Documents, attempt.documents)) {
    if (attempt.phase === "attaching") throw new Error("The transaction exists, but document saving is unconfirmed. Check its Supporting Documents in CRM; retry only verifies the previous save.");
    if (record.Vendor_Payment || record.Vendor_Invoice || !["Pending invoice", "Pending credit note"].includes(record.Accounting_Status) || record.$editable === false || record.$locked_for_me) throw new Error("The transaction is already being processed or cannot be edited. Review its missing documents in CRM.");
    if (!record.Modified_Time) throw new Error("CRM did not return the transaction version. Reload before attaching documents.");
    attempt.phase = "attaching";
    rememberCreation(state, attempt);
    try {
      await request(attempt.recordId, { id: attempt.recordId, Supporting_Documents: attempt.documents.map(file => ({ File_Id__s: file.File_Id__s })) }, record.Modified_Time);
    } catch (error) {
      if (error.definitiveRejection) { attempt.phase = "created"; rememberCreation(state, attempt); throw error; }
      // The write may have succeeded. Read it back without replaying it.
    }
    for (let index = 0; index < 4; index++) {
      record = await verify();
      if (cardCreationDocumentsMatch(record.Supporting_Documents, attempt.documents)) break;
      if (index < 3) await (options.wait || (ms => new Promise(resolve => setTimeout(resolve, ms))))(500);
    }
    if (!cardCreationDocumentsMatch(record.Supporting_Documents, attempt.documents)) throw new Error("The transaction was created, but document saving could not be confirmed. Retry verifies the existing transaction without creating or attaching again.");
  }
  attempt.phase = "complete";
  rememberCreation(state, attempt);
  return attempt.recordId;
}

export function finishCardPurchaseCreation(state, bookingId, serviceId) {
  const attempt = pendingCardPurchaseCreation(state, bookingId, serviceId);
  if (!attempt || attempt.phase !== "complete") return;
  const key = creationKey(state, bookingId, serviceId);
  try { window.sessionStorage.removeItem(key); } catch (_) { return; }
  delete state.cardPurchaseCreations[key];
}

export function cardPurchaseCreationDisposition(attempt) {
  if (!attempt) return "draft";
  if (attempt.phase === "complete") return "complete";
  if (attempt.recordId) return "recorded";
  return attempt.phase === "prepared" ? "draft" : "unknown";
}

export function cardPurchaseCreationSummary(attempt) {
  if (!attempt) return "";
  if (!attempt.recordId) return attempt.phase === "prepared"
    ? "Transaction: not created. Documents: not saved to the transaction."
    : "Transaction: creation unconfirmed. Documents: not confirmed. Check CRM before continuing; creation will not be repeated.";
  const documents = attempt.phase === "complete" ? "confirmed" : attempt.phase === "attaching" ? "save unconfirmed; retry checks the existing save" : "confirmation pending; retry continues this transaction";
  return "Transaction recorded in CRM (ID " + attempt.recordId + "). Documents: " + documents + ". No new transaction will be created.";
}

export function discardUnsentCardPurchaseCreation(state, bookingId, serviceId) {
  const attempt = pendingCardPurchaseCreation(state, bookingId, serviceId);
  if (state.cardPurchaseSaving || cardPurchaseCreationDisposition(attempt) !== "draft") throw new Error("This transaction was created or its creation is unconfirmed. Closing keeps its recovery; it cannot be discarded as an unsent draft.");
  const key = creationKey(state, bookingId, serviceId);
  try { window.sessionStorage.removeItem(key); }
  catch (_) { if (attempt) throw new Error("The unsent draft could not be removed from browser recovery. It has been kept."); }
  if (state.cardPurchaseCreations) delete state.cardPurchaseCreations[key];
}
