import { recordEditLocks } from "./record-edit-locks.js";
import { crmGetFields, crmGetRecord, crmUpdateRecord } from "./api.js";
import { MODULES } from "./constants.js";
import { escapeHtml } from "./utils.js";
import { showFeedback } from "./app-feedback.js";
import { getBookingPrepayment, ensurePrepaymentsLoaded, rememberCreatedPrepayment, isPrepaymentTimeRestricted, uploadFile, savePrepaymentProforma } from "./prepayments-controller.js";

const id = value => String(value && (value.id || value.value) || "");
const cents = value => Math.round(Number(value) * 100);
const attachmentId = file => String(file.attachment_Id || file.id || "");
const fileName = file => file.File_Name__s || file.File_Name || file.file_Name || file.file_name || file.name || "Proforma";
// Search indexing can lag behind newly linked invoices/payments. Use COQL and
// read each current record before making financial or destructive changes.
async function related(module, field, recordId) {
  if (!/^\d+$/.test(String(recordId)) || !/^[A-Za-z_]+$/.test(module) || !/^[A-Za-z_]+$/.test(field)) throw new Error("Invalid relationship query.");
  const records = [], seen = new Set();
  for (let offset = 0; offset < 100000; offset += 200) {
    let response;
    try { response = await window.ZOHO.CRM.API.coql({ select_query: "select id from " + module + " where " + field + " = '" + recordId + "' order by id asc limit " + offset + ", 200" }); }
    catch (error) { if (Number(error?.status) === 204 || error?.code === "NO_CONTENT") return records; throw error; }
    if (Number(response?.status) === 204 || response?.code === "NO_CONTENT") return records;
    if (!Array.isArray(response?.data) || response.code) throw new Error("Could not verify relationships in " + module + ".");
    for (const row of response.data) {
      if (!row.id || seen.has(String(row.id))) throw new Error("Incomplete relationship results.");
      seen.add(String(row.id));
      const record = await crmGetRecord(module, row.id);
      if (!record?.id || id(record[field]) !== String(recordId)) throw new Error("Could not verify a relationship in " + module + ".");
      records.push(record);
    }
    if (response.data.length < 200) return records;
  }
  throw new Error("Too many relationships to verify safely.");
}
function confirmed(result) {
  if (result?.code !== "SUCCESS") throw new Error(result?.message || "CRM did not confirm the change.");
}
async function removeRecord(module, recordId) {
  const response = await window.ZOHO.CRM.API.deleteRecord({ Entity: module, RecordID: recordId });
  const result = response?.data?.[0] || response;
  // Allows retrying a cleanup after a successful deletion whose response was lost.
  if (result?.code !== "ALREADY_DELETED") confirmed(result);
}

export async function assertPrepaymentDeletable(payment) {
  const fields = await crmGetFields(MODULES.prepayments);
  const paymentFields = fields.filter(field => field.api_name === "Vendor_Payment" || field.lookup?.module?.api_name === "Supplier_Payments");
  if (!paymentFields.length) throw new Error("Could not verify the payment lookup. Deletion is blocked.");
  const invoiceFields = fields.filter(field => field.api_name === "Vendor_Invoice" || field.lookup?.module?.api_name === "Supplier_Invoices");
  if (payment.Vendor_Payment || payment.Vendor_Invoice || [...paymentFields, ...invoiceFields].some(field => payment[field.api_name])) {
    throw new Error("This prepayment is linked to an invoice or payment and cannot be deleted.");
  }
  const allocations = await related(MODULES.prepaymentInvoiceAllocations, "Prepayment", payment.id);
  if (allocations.length) throw new Error("This prepayment is linked to an invoice and cannot be deleted.");
}

async function resetServicePaymentStatus(bookingId, serviceId, plan) {
  const service = await crmGetRecord(MODULES.bookingServices, serviceId);
  if (!service?.id || id(service.Booking) !== String(bookingId)) throw new Error("Could not verify the service during payment status cleanup.");
  plan.serviceStatuses ||= {};
  plan.serviceStatuses[serviceId] = service.Payment_Status;
  // This operation reverses a request, not a recorded payment or a manual status.
  if (String(service.Payment_Status || "").toLowerCase() !== "prepayment requested") return;
  const links = await related(MODULES.prepaymentRequestServices, "Booking_Service", serviceId);
  const requests = new Set(links.map(link => id(link.Prepayment_Request)));
  if (id(service.Prepayment_Request)) requests.add(id(service.Prepayment_Request));
  for (const requestId of requests) {
    if (!requestId) throw new Error("Could not verify a service prepayment request.");
    if (requestId === plan.requestId) continue;
    if ((await related(MODULES.prepayments, "Prepayment_Request", requestId)).length) return;
  }
  if (!plan.resetStatus) throw new Error("Payment_Status needs the CRM value To be paid.");
  confirmed(await crmUpdateRecord(MODULES.bookingServices, { id: serviceId, Payment_Status: plan.resetStatus }));
  const saved = await crmGetRecord(MODULES.bookingServices, serviceId);
  if (saved?.Payment_Status !== plan.resetStatus) throw new Error("CRM did not confirm the service payment status. Retry to finish.");
  plan.serviceStatuses[serviceId] = saved.Payment_Status;
}

// Keep the plan in the open dialog so failed cleanup can be retried after the
// prepayment itself has already been removed.
export async function deletePrepayment(bookingId, prepaymentId, plan = {}) {
  return recordEditLocks.write(MODULES.prepayments, prepaymentId, () => deletePrepaymentRaw(bookingId, prepaymentId, plan));
}

async function deletePrepaymentRaw(bookingId, prepaymentId, plan = {}) {
  if (!plan.deleted) {
    const { payment, request } = await getBookingPrepayment(bookingId, prepaymentId);
    if ((plan.modifiedTime !== undefined && plan.modifiedTime !== payment.Modified_Time) || (plan.requestModifiedTime !== undefined && plan.requestModifiedTime !== request.Modified_Time)) throw new Error("This prepayment or request changed since the confirmation dialog opened. Reopen it before deleting.");
    await assertPrepaymentDeletable(payment);
    const peers = await related(MODULES.prepayments, "Prepayment_Request", request.id);
    if (!peers.some(row => String(row.id) === String(prepaymentId))) throw new Error("Could not verify all prepayments. Refresh and retry.");
    plan.requestId = String(request.id);
    plan.last = !peers.some(row => String(row.id) !== String(prepaymentId));
    plan.links = plan.last ? await related(MODULES.prepaymentRequestServices, "Prepayment_Request", request.id) : [];
    if (plan.last) {
      const serviceFields = await crmGetFields(MODULES.bookingServices);
      plan.resetStatus = serviceFields.find(field => field.api_name === "Payment_Status")?.pick_list_values
        ?.find(option => String(option.actual_value).toLowerCase() === "to be paid" && option.type !== "unused")?.actual_value;
      plan.legacyServices = serviceFields.some(field => field.api_name === "Prepayment_Request")
        ? await related(MODULES.bookingServices, "Prepayment_Request", request.id) : [];
      for (const service of plan.legacyServices) {
        if (id(service.Booking) !== String(bookingId)) throw new Error("A related service belongs to another booking. Deletion is blocked.");
      }
    }
    for (const link of plan.links) {
      if (id(link.Prepayment_Request) !== plan.requestId || !id(link.Booking_Service)) throw new Error("Invalid service relationship. Deletion is blocked.");
    }
    plan.serviceIds = [...new Set([...(plan.legacyServices || []).map(service => String(service.id)), ...plan.links.map(link => id(link.Booking_Service))])];
    for (const serviceId of plan.serviceIds) {
      const service = await crmGetRecord(MODULES.bookingServices, serviceId);
      if (!service?.id || id(service.Booking) !== String(bookingId)) throw new Error("A related service belongs to another booking or could not be verified. Deletion is blocked.");
      if (String(service.Payment_Status || "").toLowerCase() === "prepayment requested" && !plan.resetStatus) throw new Error("Payment_Status needs the CRM value To be paid.");
    }
    // Recheck after preparing the cleanup, immediately before the destructive call.
    await assertPrepaymentDeletable((await getBookingPrepayment(bookingId, prepaymentId)).payment);
    await removeRecord(MODULES.prepayments, prepaymentId);
    plan.deleted = true;
  }
  if (plan.last && !plan.cleaned) {
    const peers = await related(MODULES.prepayments, "Prepayment_Request", plan.requestId);
    if (peers.some(row => String(row.id) !== String(prepaymentId))) {
      plan.last = false;
      return plan;
    }
    // Request/service links are shared by all instalments. Remove them only
    // when the request has no other prepayments, then remove the empty request.
    // Do this before removing links so a failure leaves a discoverable, retryable cleanup.
    for (const serviceId of plan.serviceIds) await resetServicePaymentStatus(bookingId, serviceId, plan);
    for (const service of plan.legacyServices || []) {
      const fresh = await crmGetRecord(MODULES.bookingServices, service.id);
      if (!fresh?.id) throw new Error("Could not verify a legacy service relationship.");
      if (id(fresh.Prepayment_Request) === plan.requestId) confirmed(await crmUpdateRecord(MODULES.bookingServices, { id: service.id, Prepayment_Request: null }));
    }
    for (const link of plan.links) {
      if (link.removed) continue;
      const service = await crmGetRecord(MODULES.bookingServices, id(link.Booking_Service));
      if (!service?.id || id(service.Booking) !== String(bookingId)) throw new Error("Could not verify the service during relationship cleanup.");
      if (id(service.Prepayment_Request) === plan.requestId) {
        confirmed(await crmUpdateRecord(MODULES.bookingServices, { id: service.id, Prepayment_Request: null }));
      }
      await removeRecord(MODULES.prepaymentRequestServices, link.id);
      link.removed = true;
    }
    await removeRecord(MODULES.prepaymentRequests, plan.requestId);
    plan.cleaned = true;
  }
  return plan;
}

export async function savePrepaymentEdit(state, bookingId, prepaymentId, values) {
  if (String(state.selectedBookingId) !== bookingId) throw new Error("Booking changed. Close and reopen the form.");
  const { payment, request } = await getBookingPrepayment(bookingId, prepaymentId);
  if ((values.modifiedTime !== undefined && values.modifiedTime !== payment.Modified_Time) || (values.requestModifiedTime !== undefined && values.requestModifiedTime !== request.Modified_Time)) throw new Error("This prepayment or request changed while editing. Keep your changes and reopen the editor.");
  const fields = await crmGetFields(MODULES.prepayments);
  const paymentFields = fields.filter(field => field.api_name === "Vendor_Payment" || field.lookup?.module?.api_name === "Supplier_Payments");
  if (!paymentFields.length) throw new Error("Could not verify the payment lookup. Editing is blocked.");
  const assertEditable = record => {
    if (record.Vendor_Payment || paymentFields.some(field => record[field.api_name]) ||
      ["Prepayment recorded", "Discard - Credit", "Discard - Already Paid", "Paid", "Cancelled"].includes(record.Accounting_Status)) {
      throw new Error("This prepayment is paid, cancelled or linked to a payment and cannot be edited.");
    }
  };
  assertEditable(payment);
  const amount = Number(values.amount), day = String(values.dueDate || "");
  const date = new Date(day + "T00:00:00Z");
  if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - cents(amount)) > 0.00001) throw new Error("Enter an amount greater than zero with at most two decimal places.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) throw new Error("Enter a valid due date.");
  if (day !== payment.Due_Date) {
    if ([0, 6].includes(date.getUTCDay())) throw new Error("Due date must be Monday to Friday. Select a weekday.");
    if (isPrepaymentTimeRestricted(state, [day])) throw new Error("After 14:00 Madrid time, select a later payment date or contact Administration.");
  }
  const allocations = await related(MODULES.prepaymentInvoiceAllocations, "Prepayment", payment.id);
  if (allocations.some(row => !Number.isFinite(Number(row.Allocated_Amount)) || Number(row.Allocated_Amount) <= 0 || row.Currency !== (payment.Currency || "EUR"))) throw new Error("Could not verify invoice allocations.");
  if (allocations.reduce((sum, row) => sum + cents(row.Allocated_Amount), 0) > cents(amount)) throw new Error("Amount cannot be less than the amount already allocated to invoices.");
  const peers = await related(MODULES.prepayments, "Prepayment_Request", request.id);
  const others = peers.filter(row => String(row.id) !== String(payment.id) && row.Accounting_Status !== "Cancelled");
  const full = request.Transaction_Type === "Full Payment" && !others.length;
  const total = full ? amount : Number(request.Amount);
  if (!Number.isFinite(total) || total <= 0 || others.reduce((sum, row) => sum + cents(row.Amount), cents(amount)) > cents(total)) throw new Error("Prepayments cannot exceed the request total. Update the request total first.");
  const existing = request.Proforma_Attached || [];
  const removals = values.removeIds || [];
  const retained = existing.filter(file => !removals.includes(attachmentId(file)));
  if (!retained.length && !values.files?.length) throw new Error("Keep or upload at least one proforma document.");
  const documents = [];
  for (const item of values.files || []) {
    if (!item.uploadedId) {
      item.uploadedId = (await uploadFile(item.file))[0].File_Id__s;
    }
    documents.push({ File_Id__s: item.uploadedId, file: { name: item.file.name, size: item.file.size } });
  }
  if (String(state.selectedBookingId) !== bookingId) throw new Error("Booking changed. Close and reopen the form.");
  const fresh = await getBookingPrepayment(bookingId, prepaymentId);
  assertEditable(fresh.payment);
  if (fresh.payment.Modified_Time !== payment.Modified_Time || fresh.request.Modified_Time !== request.Modified_Time) {
    throw new Error("This prepayment or request changed while saving. Close and reopen the form.");
  }
  if (String(state.selectedBookingId) !== bookingId) throw new Error("Booking changed. Close and reopen the form.");
  const update = { id: payment.id, Amount: amount, Percent: Math.round(amount / total * 10000) / 100 };
  if (day !== payment.Due_Date) Object.assign(update, { Due_Date: day, When_To_Be_Paid: "Specific Date" });
  confirmed(await crmUpdateRecord(MODULES.prepayments, update, { expectedRecord: fresh.payment }));
  rememberCreatedPrepayment(state, bookingId, "payments", { ...payment, ...update });
  if (documents.length || removals.length || (full && cents(request.Amount) !== cents(total))) {
    try {
      if (documents.length || existing.some(file => removals.includes(attachmentId(file)))) {
        const savedFiles = await savePrepaymentProforma(request.id, documents, "Proforma_Attached", { existing, removeIds: removals, saveState: values.proformaSaveState ||= {} });
        rememberCreatedPrepayment(state, bookingId, "requests", { ...request, Proforma_Attached: savedFiles });
        // Retrying an amount update must not upload or attach the same files again.
        values.files = [];
      }
      if (full && cents(request.Amount) !== cents(total)) confirmed(await crmUpdateRecord(MODULES.prepaymentRequests, { id: request.id, Amount: total }));
      const saved = await crmGetRecord(MODULES.prepaymentRequests, request.id);
      if (!saved?.id) throw new Error("Could not reload the request.");
      rememberCreatedPrepayment(state, bookingId, "requests", saved);
      // Do not reattach uploaded files if another part of the operation is retried.
      values.files = [];
    } catch (error) { throw new Error("Amount/date saved, but the request/proforma update failed: " + error.message); }
  }
}

export async function openPrepaymentManagement(elements, state, prepaymentId, deleting, onSaved) {
  const bookingId = String(state.selectedBookingId);
  const { payment, request } = await getBookingPrepayment(bookingId, prepaymentId);
  if (String(state.selectedBookingId) !== bookingId) return;
  const editResources = [[MODULES.prepayments, prepaymentId], [MODULES.prepaymentRequests, request.id]];
  await recordEditLocks.beginMany(editResources);
  state.recordEditingLocksActive = true;
  const dialog = document.createElement("dialog");
  dialog.className = "booking-prepayment-details prepayment-management-dialog";
  dialog.setAttribute("aria-label", deleting ? "Delete prepayment" : "Edit prepayment");
  const files = request.Proforma_Attached || [];
  const documentIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6a1 1 0 0 0-1 1v16h14V8zM14 3v5h5M8 12h8M8 16h5"/></svg>';
  dialog.innerHTML = '<form><header class="prepayment-edit-header"><div><h3>' + (deleting ? 'Delete prepayment' : 'Edit prepayment') + '</h3><p class="prepayment-edit-reference">' + escapeHtml(payment.Name || payment.id) + '</p></div><button type="button" class="prepayment-edit-close" data-dismiss aria-label="Close dialog">&times;</button></header><fieldset>' + (deleting
    ? '<p>Delete this prepayment permanently? Its request and service relationships will also be removed if there are no other prepayments in the request. Prepayments linked to invoices or payments cannot be deleted.</p>'
    : '<div class="prepayment-edit-grid"><label class="field"><span>Amount (' + escapeHtml(payment.Currency || 'EUR') + ')</span><input name="amount" type="number" min="0.01" step="0.01" required></label><label class="field"><span>Due date</span><input name="dueDate" type="date" required></label></div><section class="prepayment-edit-documents" aria-label="Proforma documents"><h4>Proforma documents</h4><p class="prepayment-edit-hint">Shared by all prepayments in this request. Uncheck a document to remove it when saving.</p><div class="prepayment-edit-files">' + files.map((file, index) => '<label class="prepayment-edit-file"><input type="checkbox" data-existing-file="' + index + '" checked' + (!attachmentId(file) ? ' disabled' : '') + '>' + documentIcon + '<span class="prepayment-edit-file-info"><span class="prepayment-edit-file-name">' + escapeHtml(fileName(file)) + '</span><span class="prepayment-file-keep">Keep document</span><span class="prepayment-file-remove">Will be removed on save</span></span></label>').join('') + '</div><label class="prepayment-edit-upload"><input name="proforma" type="file" multiple aria-label="Add proforma documents"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L8 8m4-4 4 4M5 15v5h14v-5"/></svg><span><strong>Add documents</strong><small>Choose one or more files</small></span><span class="prepayment-upload-browse" aria-hidden="true">Browse files</span></label><ul class="prepayment-edit-selected" data-selected-files aria-live="polite" hidden></ul></section>') + '</fieldset><p data-feedback role="status"></p><footer><button type="button" class="button tertiary" data-cancel>Cancel</button><button type="submit" class="button prepayment-edit-submit">' + (deleting ? 'Delete prepayment' : 'Save changes') + '</button></footer></form>';
  const form = dialog.querySelector('form'), feedback = dialog.querySelector('[data-feedback]');
  const submit = form.querySelector('[type="submit"]'), fieldset = form.querySelector('fieldset');
  const previousFocus = document.activeElement;
  let busy = false, values = { files: [], modifiedTime: payment.Modified_Time, requestModifiedTime: request.Modified_Time };
  const plan = { modifiedTime: payment.Modified_Time, requestModifiedTime: request.Modified_Time };
  const close = () => { if (!busy) dialog.close(); };
  dialog.querySelector('[data-cancel]').onclick = close;
  dialog.querySelector('[data-dismiss]').onclick = close;
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => { void recordEditLocks.releaseMany(editResources); dialog.remove(); previousFocus?.focus(); }, { once: true });
  if (!deleting) {
    form.elements.namedItem('amount').value = payment.Amount ?? '';
    form.elements.namedItem('dueDate').value = payment.Due_Date || '';
    const picker = form.elements.namedItem('proforma');
    const selected = dialog.querySelector('[data-selected-files]');
    const dropzone = dialog.querySelector('.prepayment-edit-upload');
    const renderFiles = () => {
      selected.innerHTML = values.files.map((item, index) => '<li>' + documentIcon + '<span>' + escapeHtml(item.file.name) + '</span><small>New</small><button type="button" data-remove-file="' + index + '" aria-label="Remove ' + escapeHtml(item.file.name) + '">&times;</button></li>').join('');
      selected.hidden = !values.files.length;
    };
    const addFiles = files => {
      if (busy) return;
      values.files.push(...Array.from(files || [], file => ({ file })));
      picker.value = '';
      renderFiles();
    };
    picker.onchange = event => addFiles(event.target.files);
    selected.onclick = event => {
      const button = event.target.closest('[data-remove-file]');
      if (busy || !button) return;
      values.files.splice(Number(button.dataset.removeFile), 1);
      renderFiles();
    };
    dropzone.addEventListener('dragover', event => { event.preventDefault(); });
    dropzone.addEventListener('drop', event => { event.preventDefault(); addFiles(event.dataTransfer.files); });
  }
  form.onsubmit = async event => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    busy = true; submit.disabled = true; fieldset.disabled = true;
    feedback.textContent = deleting ? 'Checking relationships and deleting…' : 'Saving changes…';
    try {
      await recordEditLocks.check(MODULES.prepayments, prepaymentId);
      await recordEditLocks.check(MODULES.prepaymentRequests, request.id);
      if (String(state.selectedBookingId) !== bookingId) throw new Error('Booking changed. Close and reopen the form.');
      if (deleting) {
        await deletePrepayment(bookingId, prepaymentId, plan);
        state.deletedPrepaymentRecords ||= {};
        const deleted = state.deletedPrepaymentRecords[bookingId] ||= { payments: [], requests: [] };
        deleted.payments.push(String(prepaymentId));
        if (plan.cleaned) deleted.requests.push(plan.requestId);
        const cache = state.recentPrepaymentRecords?.[bookingId];
        if (cache) {
          cache.payments = cache.payments.filter(row => String(row.id) !== String(prepaymentId));
          if (plan.cleaned) cache.requests = cache.requests.filter(row => String(row.id) !== plan.requestId);
        }
      } else {
        values.amount = form.elements.namedItem('amount').value;
        values.dueDate = form.elements.namedItem('dueDate').value;
        values.removeIds = Array.from(dialog.querySelectorAll('[data-existing-file]')).filter(input => !input.checked).map(input => attachmentId(files[Number(input.dataset.existingFile)]));
        await savePrepaymentEdit(state, bookingId, prepaymentId, values);
      }
      busy = false; dialog.close();
      await ensurePrepaymentsLoaded(elements, state, true);
      if (onSaved && String(state.selectedBookingId) === bookingId) await onSaved();
      showFeedback(deleting ? 'Prepayment deleted.' : 'Prepayment updated.', 'success');
    } catch (error) {
      feedback.textContent = (plan.deleted ? 'Prepayment deleted; relationship cleanup is incomplete. Retry to finish. ' : '') + error.message;
      if (plan.deleted) submit.textContent = 'Retry cleanup';
    } finally {
      if (String(state.selectedBookingId) === bookingId && plan.serviceStatuses) {
        for (const service of [...(state.services || []), ...(state.filteredServices || []), state.selectedService]) {
          if (service && Object.hasOwn(plan.serviceStatuses, String(service.id))) service.Payment_Status = plan.serviceStatuses[String(service.id)];
        }
      }
      busy = false; submit.disabled = false; fieldset.disabled = false;
    }
  };
  document.body.appendChild(dialog);
  dialog.showModal();
}
