const operationKey = (state, bookingId, supplierId) => "bookingsManager.prepaymentCreation:" + JSON.stringify([String(state.currentUserId || ""), String(bookingId), String(supplierId)]);

export function pendingPrepaymentCreation(state, bookingId, supplierId) {
  const key = operationKey(state, bookingId, supplierId);
  state.prepaymentCreations ||= {};
  if (state.prepaymentCreations[key]) return state.prepaymentCreations[key];
  let raw;
  try { raw = window.sessionStorage.getItem(key); } catch (_) { return null; }
  if (!raw) return null;
  let operation;
  try { operation = JSON.parse(raw); } catch (_) { throw new Error("Prepayment recovery data is unreadable. Check CRM before creating another request."); }
  if (operation.bookingId !== String(bookingId) || operation.supplierId !== String(supplierId) || !Array.isArray(operation.payments) || !Array.isArray(operation.serviceIds) || !operation.slots) throw new Error("The pending prepayment operation needs review in CRM.");
  operation.busy = false;
  state.prepaymentCreations[key] = operation;
  return operation;
}

export function savePrepaymentCreation(state, operation) {
  const key = operationKey(state, operation.bookingId, operation.supplierId);
  state.prepaymentCreations ||= {};
  state.prepaymentCreations[key] = operation;
  try { window.sessionStorage.setItem(key, JSON.stringify(operation)); }
  catch (_) { throw new Error("Prepayment recovery could not be saved in this browser. Check CRM before continuing; no creation will be repeated."); }
}

export function beginPrepaymentCreation(state, plan) {
  if (pendingPrepaymentCreation(state, plan.bookingId, plan.supplierId)) throw new Error("Resume the pending prepayment operation before creating another request.");
  const operation = { ...plan, recoveryVersion: 2, persistenceAttempted: false, slots: {}, documentState: {}, documentsConfirmed: !plan.newRequest, complete: false };
  savePrepaymentCreation(state, operation);
  return operation;
}

export async function createPrepaymentOnce(state, operation, slot, module, payload, dependencies) {
  const attempt = operation.slots[slot];
  if (attempt) {
    if (attempt.payload !== JSON.stringify(payload)) throw new Error("The pending creation changed. Review its original values in CRM before continuing.");
    if (!attempt.id) throw new Error("The previous " + slot + " creation could not be confirmed. Check CRM; this action will not create it again.");
    return attempt.id;
  }
  dependencies.assertCurrent?.();
  operation.slots[slot] = { payload: JSON.stringify(payload), id: "" };
  savePrepaymentCreation(state, operation);
  const result = await dependencies.create(module, payload);
  const id = String(result?.details?.id || result?.id || "");
  if (!id) throw new Error("CRM did not return the " + slot + " ID. Check CRM before continuing.");
  operation.slots[slot].id = id;
  savePrepaymentCreation(state, operation);
  return id;
}

export async function runPrepaymentCreation(state, operation, dependencies) {
  if (operation.busy) throw new Error("This prepayment operation is already being saved.");
  if (operation.complete) return operation.requestId;
  const uncertain = Object.entries(operation.slots).find(([, attempt]) => !attempt.id);
  if (uncertain) throw new Error("The previous " + uncertain[0] + " creation could not be confirmed. Check CRM; no creation will be repeated.");
  operation.busy = true;
  try {
    await dependencies.preflight(operation);
    dependencies.assertCurrent?.();
    const requestId = operation.requestId || await createPrepaymentOnce(state, operation, "request", "Prepayment_Requests", operation.requestPayload, dependencies);
    operation.requestId = requestId;
    operation.persistenceAttempted = true;
    savePrepaymentCreation(state, operation);
    await dependencies.checkRequest(requestId, operation);
    operation.requestConfirmed = true;
    savePrepaymentCreation(state, operation);
    dependencies.assertCurrent?.();
    if (!operation.documentsConfirmed) {
      await dependencies.saveDocuments(requestId, operation.documents, operation.documentState, () => savePrepaymentCreation(state, operation));
      operation.documentsConfirmed = true;
      savePrepaymentCreation(state, operation);
    }
    await dependencies.linkServices(requestId, operation, (module, payload) => createPrepaymentOnce(state, operation, "service link " + payload.Booking_Service.id, module, payload, dependencies));
    for (let index = 0; index < operation.payments.length; index++) {
      const payload = { ...operation.payments[index].payload, Prepayment_Request: { id: requestId } };
      // Validate each still-unattempted row again: uploads can cross the cutoff.
      if (!operation.slots["payment " + index]) await dependencies.validatePayment(operation.payments[index], operation);
      const paymentId = await createPrepaymentOnce(state, operation, "payment " + index, "Prepayments", payload, dependencies);
      await dependencies.checkPayment(paymentId, payload, index, operation);
      operation.confirmedPayments ||= {};
      operation.confirmedPayments[index] = paymentId;
      savePrepaymentCreation(state, operation);
    }
    operation.complete = true;
    savePrepaymentCreation(state, operation);
    return requestId;
  } finally {
    operation.busy = false;
    // A page reload must not inherit a busy flag from an interrupted call.
    const key = operationKey(state, operation.bookingId, operation.supplierId);
    try { window.sessionStorage.setItem(key, JSON.stringify({ ...operation, busy: false })); } catch (_) { /* Keep the previous journal as a conservative recovery point. */ }
  }
}

export function prepaymentCreationSummary(operation) {
  if (!operation) return "";
  const slots = operation.slots || {};
  const requestId = operation.requestId || slots.request?.id;
  const request = operation.requestConfirmed ? "confirmed in CRM" : requestId ? "recorded; verification pending" : slots.request ? "creation unconfirmed; check CRM" : "not created";
  const documents = operation.documentsConfirmed && operation.requestConfirmed ? "confirmed" : operation.documentState?.pending ? "save unconfirmed; check CRM" : "confirmation pending";
  const services = (operation.serviceIds || []).filter(id => operation.confirmedServices?.[id]).length;
  const linked = (operation.serviceIds || []).filter(id => operation.confirmedServices?.[id] || slots["service link " + id]?.id).length;
  const payments = operation.payments || [];
  const created = payments.filter((_, index) => slots["payment " + index]?.id).length;
  const verified = payments.filter((_, index) => operation.confirmedPayments?.[index]).length;
  const uncertain = Object.values(slots).filter(attempt => !attempt.id).length;
  return "Request: " + request + ". Documents: " + documents + ". Services confirmed: " + services + "/" + (operation.serviceIds || []).length +
    ". Service associations recorded: " + linked + "/" + (operation.serviceIds || []).length + ". Prepayments: " + created + "/" + payments.length + " recorded, " + verified + " verified." +
    (uncertain ? " Unconfirmed creations: " + uncertain + ". Check CRM before continuing; they will not be created again." : " Continue the pending steps without repeating recorded creations.");
}

export function finishPrepaymentCreation(state, operation) {
  if (!operation.complete) return;
  const key = operationKey(state, operation.bookingId, operation.supplierId);
  try { window.sessionStorage.removeItem(key); } catch (_) { return; }
  delete state.prepaymentCreations[key];
}

export function prepaymentCreationDisposition(operation) {
  if (!operation) return "draft";
  if (operation.complete) return "complete";
  const attempts = Object.values(operation.slots || {});
  if (attempts.some(attempt => !attempt.id)) return "unknown";
  if (attempts.some(attempt => attempt.id) || operation.persistenceAttempted || operation.documentState?.pending) return "recorded";
  // Older journals cannot prove that no requester/document write occurred.
  return operation.recoveryVersion === 2 ? "draft" : "recorded";
}

export function discardUnsentPrepaymentCreation(state, operation) {
  if (!operation || operation.busy || prepaymentCreationDisposition(operation) !== "draft") throw new Error("This operation was saved or its save is unconfirmed. Close and keep recovery; it cannot be discarded as an unsent draft.");
  const key = operationKey(state, operation.bookingId, operation.supplierId);
  try { window.sessionStorage.removeItem(key); }
  catch (_) { throw new Error("The draft could not be removed from browser recovery. It has been kept."); }
  delete state.prepaymentCreations[key];
}
