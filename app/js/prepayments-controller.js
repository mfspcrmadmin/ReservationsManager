import { showFeedback } from "./app-feedback.js";
import { crmCreateRecord, crmSearchRecord, crmUpdateRecord, crmGetRecord } from "./api.js";
import { MODULES } from "./constants.js";
import { escapeHtml, getLookupName, escapeCriteriaValue } from "./utils.js";

const timingOptions = ["Specific Date", "Within 1 day", "Within 2 days", "Within 3 days", "10 days prior to service date", "15 days prior to service date", "20 days prior to service date", "30 days prior to service date"];

export function calculatePrepaymentDueDate(timing, serviceDate) {
  const offsets = { "Within 1 day": 1, "Within 2 days": 2, "Within 3 days": 3, "10 days prior to service date": -10, "15 days prior to service date": -15, "20 days prior to service date": -20, "30 days prior to service date": -30 };
  if (!Object.prototype.hasOwnProperty.call(offsets, timing)) return null;
  const day = String(serviceDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  const date = new Date(day + "T00:00:00Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) return "";
  date.setUTCDate(date.getUTCDate() + offsets[timing]);
  return date.toISOString().slice(0, 10);
}
const idOf = value => String(value && (value.id || value.value) || "");
const money = record => new Intl.NumberFormat("en-GB", { style: "currency", currency: record.Currency || "EUR" }).format(Number(record.Amount) || 0);
const text = value => escapeHtml(value || "—");

export function rememberCreatedPrepayment(state, bookingId, kind, record) {
  if (!record.id) return;
  state.recentPrepaymentRecords ||= {};
  const cache = state.recentPrepaymentRecords[bookingId] ||= { requests: [], payments: [] };
  cache[kind] = cache[kind].filter(item => String(item.id) !== String(record.id));
  cache[kind].push(record);
  const data = state.prepaymentsData;
  if (data && data.bookingId === bookingId) {
    data[kind] = (data[kind] || []).filter(item => String(item.id) !== String(record.id)).concat(record);
  }
}

function reconcileCreatedRecords(state, bookingId, kind, records) {
  const cache = state.recentPrepaymentRecords?.[bookingId];
  if (!cache) return records;
  const found = new Set(records.map(record => String(record.id)));
  cache[kind] = cache[kind].filter(record => !found.has(String(record.id)));
  return records.concat(cache[kind]);
}

export async function searchAll(entity, criteria) {
  const records = [];
  for (let page = 1; ; page += 1) {
    const batch = await crmSearchRecord(entity, criteria, page, 200);
    records.push(...batch);
    if (batch.length < 200) return records;
  }
}

export async function ensurePrepaymentsLoaded(elements, state, force = false) {
  const bookingId = String(state.selectedBookingId || "");
  if (!bookingId) { renderPrepayments(elements, state); return; }
  const previous = state.prepaymentsData;
  if (!force && previous && previous.bookingId === bookingId && (previous.loading || previous.loaded)) return previous.promise;
  const recent = state.recentPrepaymentRecords?.[bookingId];
  const sameBooking = previous && previous.bookingId === bookingId && !previous.error;
  const data = { bookingId, loading: true, loaded: false, requests: sameBooking ? [...previous.requests] : recent ? [...recent.requests] : [], payments: sameBooking ? [...previous.payments] : recent ? [...recent.payments] : [], error: "" };
  state.prepaymentsData = data;
  renderPrepayments(elements, state);
  data.promise = (async function () {
    try {
      data.requests = reconcileCreatedRecords(state, bookingId, "requests", await searchAll(MODULES.prepaymentRequests, "(Booking:equals:" + escapeCriteriaValue(bookingId) + ")"));
      const payments = [];
      // Prepayments have no Booking lookup; follow each request explicitly.
      for (const request of data.requests) {
        payments.push(...await searchAll(MODULES.prepayments, "(Prepayment_Request:equals:" + escapeCriteriaValue(request.id) + ")"));
      }
      data.payments = reconcileCreatedRecords(state, bookingId, "payments", payments);
      data.requests.sort((a, b) => String(b.Requested_Date || b.Created_Time || "").localeCompare(String(a.Requested_Date || a.Created_Time || "")));
      data.loaded = true;
    } catch (error) { data.error = error.message || "Could not load prepayments."; }
    finally { data.loading = false; if (state.prepaymentsData === data) renderPrepayments(elements, state); }
  })();
  return data.promise;
}

export function renderPrepayments(elements, state) {
  const content = document.getElementById("prepayments-content");
  if (!content) return;
  const summary = document.getElementById("prepayments-summary");
  const refresh = document.getElementById("refresh-prepayments");
  const data = state.prepaymentsData && state.prepaymentsData.bookingId === String(state.selectedBookingId || "") ? state.prepaymentsData : null;
  refresh.disabled = !state.selectedBookingId || Boolean(data && data.loading);
  const title = document.getElementById("prepayments-title");
  if (title) title.textContent = "Prepayments" + (data && (data.loaded || data.payments.length) && !data.error ? " (" + data.payments.length + ")" : "");
  summary.innerHTML = "";
  const message = !state.selectedBookingId ? "Select a booking to view prepayments." : !data ? "Open this tab to load prepayments." : data.loading && !data.payments.length ? "Loading requests and prepayments…" : data.error;
  if (message) { content.innerHTML = '<p class="table-empty" role="status">' + text(message) + '</p>'; return; }
  const totals = new Map();
  data.payments.forEach(payment => {
    const currency = payment.Currency || "EUR";
    if (!totals.has(currency)) totals.set(currency, { recorded: 0, pending: 0 });
    if (payment.Accounting_Status === "Prepayment recorded") totals.get(currency).recorded += Number(payment.Amount) || 0;
    if (["Pending invoice", "Pending payment record"].includes(payment.Accounting_Status)) totals.get(currency).pending += Number(payment.Amount) || 0;
  });
  summary.innerHTML = [...totals].map(([currency, total]) => '<span>Pending <strong>' + money({ Currency: currency, Amount: total.pending }) + '</strong></span><span>Recorded <strong>' + money({ Currency: currency, Amount: total.recorded }) + '</strong></span>').join("");
  content.innerHTML = data.requests.length ? data.requests.map(request => renderRequest(request, data.payments)).join("") : '<p class="table-empty">No prepayment requests found for this booking.</p>';
}

function renderRequest(request, allPayments) {
  const payments = allPayments.filter(payment => idOf(payment.Prepayment_Request) === String(request.id)).sort((a, b) => String(a.Due_Date || "9999").localeCompare(String(b.Due_Date || "9999")));
  return '<article class="prepayment-request-card"><header><div><h4>' + text(request.Name) + '</h4><p>' + text(getLookupName(request.Supplier)) + ' · ' + text(request.Transaction_Type) + '</p></div><span>' + payments.length + ' prepayments</span></header>' +
    '<div class="prepayment-request-meta"><span>Requested: ' + text(String(request.Requested_Date || "").replace("T", " ").slice(0, 16)) + '</span><span>By: ' + text(request.Requested_By_2) + '</span><span>Reference: ' + text(request.MFSP_Reference) + '</span></div>' +
    (request.Observations ? '<p class="prepayment-observations">' + text(request.Observations) + '</p>' : '') +
    '<div class="prepayment-request-meta">' + fileNames(request.Proforma_Attached, "Proforma") + '</div>' +
    (payments.length ? '<div class="table-wrap"><table class="services-table"><thead><tr><th>Prepayment</th><th>Accounting Status</th><th>Amount</th><th>%</th><th>When to pay</th><th>Due date</th><th>Payment date</th><th>Accounted</th><th>Payment proof</th></tr></thead><tbody>' + payments.map(payment => '<tr><td>' + text(payment.Name) + '</td><td><span class="card-purchase-status ' + (payment.Accounting_Status === "Prepayment recorded" ? 'is-paid' : 'is-neutral') + '">' + text(payment.Accounting_Status) + '</span></td><td>' + text(money(payment)) + '</td><td>' + (payment.Percent == null ? '—' : text(String(payment.Percent)) + '%') + '</td><td>' + text(payment.When_To_Be_Paid) + '</td><td>' + text(payment.Due_Date) + '</td><td>' + text(payment.Payment_Date) + '</td><td>' + (payment.Accounted ? 'Yes' : 'No') + '</td><td>' + fileNames(payment.Payment_Proof, "") + '</td></tr>').join("") + '</tbody></table></div>' : '<p class="table-empty">No prepayments registered for this request yet.</p>') + '</article>';
}

function fileNames(files, label) {
  return (Array.isArray(files) ? files : []).map(file => '<span>' + (label ? text(label) + ': ' : '') + text(file.File_Name__s || file.File_Name || file.file_Name || file.file_name || file.name || "Attachment") + '</span>').join(" · ");
}

export function initializePrepayments(elements, state, onSaved) {
  document.getElementById("refresh-prepayments").addEventListener("click", () => ensurePrepaymentsLoaded(elements, state, true));
  elements.serviceActionPrepayment.addEventListener("click", () => {
    if (state.selectedService?.id) openPrepaymentForm(elements, state, onSaved, state.selectedService);
  });
  elements.bulkRequestPrepayment?.addEventListener("click", () => {
    const selected = (state.services || []).filter(service => state.selectedServiceIds?.[service.id]);
    openPrepaymentForm(elements, state, onSaved, selected);
  });
}

const serviceSupplierId = service => idOf(service.Supplier) || String(service.Supplier_Id || "");

export function validatePrepaymentServices(services, bookingId, supplierId, requestId = "") {
  if (!services.length) throw new Error("Select at least one service to include in the request.");
  for (const service of services) {
    if (!service.id) throw new Error("A selected service has no CRM ID. Refresh the booking and try again.");
    if (!serviceSupplierId(service)) throw new Error("Every selected service must have a linked supplier.");
    if (serviceSupplierId(service) !== supplierId) throw new Error("Select services from the same supplier to request a prepayment.");
    if (idOf(service.Booking) && idOf(service.Booking) !== bookingId) throw new Error("All services must belong to the same booking.");
    if (idOf(service.Prepayment_Request) && idOf(service.Prepayment_Request) !== requestId) throw new Error("A selected service already belongs to another prepayment request. Open its existing request instead.");
  }
}

export async function linkPrepaymentServices(services, bookingId, supplierId, requestId, onLinked) {
  const fresh = [];
  for (const service of services) {
    const record = await crmGetRecord(MODULES.bookingServices, service.id);
    if (!record?.id || idOf(record.Booking) !== bookingId) throw new Error("Could not verify the selected service and its booking. Refresh and try again.");
    fresh.push(record);
  }
  validatePrepaymentServices(fresh, bookingId, supplierId, requestId);
  for (const service of fresh) {
    if (idOf(service.Prepayment_Request) !== requestId) {
      const payload = { id: service.id, Prepayment_Request: { id: requestId } };
      if (!service.Payment_Status || ["-None-", "To Be Paid"].includes(service.Payment_Status)) payload.Payment_Status = "Prepayment Requested";
      const result = await crmUpdateRecord(MODULES.bookingServices, payload);
      if (String(result?.code).toUpperCase() !== "SUCCESS" || String(result?.status).toLowerCase() === "error") throw new Error(result?.message || "Could not associate the selected services with the request.");
      const saved = await crmGetRecord(MODULES.bookingServices, service.id);
      if (idOf(saved?.Prepayment_Request) !== requestId) throw new Error("CRM did not confirm the service association. Retry to continue.");
      onLinked(saved);
    } else onLinked(service);
  }
}

function field(label, name, type = "text", attributes = "") {
  return '<label class="field"><span>' + label.replace(/\*/g, '<em>*</em>') + '</span><input name="' + name + '" type="' + type + '" ' + attributes + '></label>';
}
function select(label, name, values) {
  return '<label class="field"><span>' + label.replace(/\*/g, '<em>*</em>') + '</span><select name="' + name + '">' + values.map(value => '<option value="' + escapeHtml(value) + '">' + text(value) + '</option>').join("") + '</select></label>';
}

function amountField(label, name, attributes = "") {
  return '<label class="field"><span>' + label.replace(/\*/g, '<em>*</em>') + '</span><div class="prepayment-eur-input"><input name="' + name + '" type="number" min="0.01" step="0.01" required ' + attributes + '><span>EUR</span></div></label>';
}

function attachmentField(label, name) {
  return '<div class="field prepayment-attachment" data-attachment="' + name + '"><span>' + label.replace(/\*/g, '<em>*</em>') + '</span><input aria-label="' + label + '" name="' + name + '" type="file" class="card-transaction-file-input"><button class="card-transaction-dropzone" type="button" data-upload><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L8 8m4-4 4 4M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/></svg><span>Drop file here or click to upload</span></button><div class="card-transaction-file-list" data-file-list hidden></div></div>';
}

export function isPrepaymentTimeRestricted(state, now = new Date()) {
  const profile = String(state.currentUserRelationshipProfile || "").trim().toLowerCase();
  if (["administrator", "finance administrator"].includes(profile)) return false;
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", hourCycle: "h23" }).format(now));
  return hour >= 14;
}

export async function openPrepaymentForm(elements, state, onSaved, service = state.selectedService) {
  const initialServices = Array.isArray(service) ? service : service ? [service] : [];
  service = initialServices[0];
  const initialRequestId = idOf(service?.Prepayment_Request);
  try { validatePrepaymentServices(initialServices, String(state.selectedBookingId || ""), service ? serviceSupplierId(service) : "", initialRequestId); }
  catch (error) { showFeedback(error.message, "error"); return; }
  if (!state.selectedBookingId || !service || document.getElementById("new-prepayment-dialog")) return;
  const bookingId = String(state.selectedBookingId);
  const booking = state.selectedBooking || {};
  const supplierId = idOf(service.Supplier) || String(service.Supplier_Id || "");
  const supplierName = service.Supplier_Name || getLookupName(service.Supplier);
  const supplierCode = String(service.Ezus_Supplier_Reference || service.EZUS_Supplier_Reference || service.Supplier_Reference || service.Supplier_Code || "").replace(/^.*-supnew-/, "");
  const reference = booking.MFSP_Reference || service.Booking_Reference || "";
  const requestedBy = state.currentUserEmail || "";
  const candidates = [...new Map([...(state.services || []), ...initialServices].filter(item => serviceSupplierId(item) === supplierId && (!idOf(item.Booking) || idOf(item.Booking) === bookingId)).map(item => [String(item.id), item])).values()];
  const selectedServices = new Set(initialServices.map(item => String(item.id)));
  const includedServices = () => candidates.filter(item => selectedServices.has(String(item.id)));
  const selectedTotal = () => {
    const services = includedServices();
    if (!services.length || services.some(item => item.Total_Purchase_Price == null || item.Total_Purchase_Price === "" || !Number.isFinite(Number(item.Total_Purchase_Price)))) return "";
    return (services.reduce((total, item) => total + Math.round(Number(item.Total_Purchase_Price) * 100), 0) / 100).toFixed(2);
  };
  const defaultTotal = selectedTotal();
  const contextSection = (title, fields) => '<div class="record-context-section"><h5>' + title + '</h5><dl>' + fields.map(([label, value]) => '<div><dt>' + label + '</dt><dd>' + text(value) + '</dd></div>').join("") + '</dl></div>';
  const context = '<section class="record-context" aria-label="Booking, supplier and service information">' +
    contextSection("Booking", [["MFSP", reference], ["Name", booking.Deal_Name || booking.Name || bookingId]]) +
    contextSection("Supplier", [["Name", supplierName], ["Code", supplierCode]]) +
    contextSection("Services", [["Selected", initialServices.length]]) +
    contextSection("Reported by", [["Email", requestedBy]]) + '</section>';
  const previousFocus = document.activeElement;
  const dialog = document.createElement("div");
  dialog.id = "new-prepayment-dialog";
  dialog.className = "booking-action-dialog";
  dialog.innerHTML = '<div class="booking-action-dialog-backdrop"></div><div class="booking-action-dialog-panel booking-action-dialog-panel--wide prepayment-request-dialog-panel" role="dialog" aria-modal="true" aria-labelledby="new-prepayment-title"><h4 id="new-prepayment-title">New prepayment</h4>' + context + '<p data-feedback role="status" tabindex="-1">Loading requests…</p><form hidden novalidate><fieldset class="prepayment-form-fields"><div class="prepayment-request-grid"><section class="prepayment-request-context" data-request-selector><label class="field"><span>Prepayment request</span><select name="request"></select></label></section><section class="prepayment-request-details" data-new-request><h5>New request</h5><div class="prepayment-request-column">' + field("Request name *", "requestName", "text", 'required maxlength="120"') + '<label class="field"><span>Observations</span><textarea name="observations"></textarea></label></div><div class="prepayment-request-column prepayment-request-documents">' + attachmentField("Proforma *", "proforma") + '</div></section><section class="prepayment-payment-section"><h5>Prepayments</h5><div class="prepayment-plan-controls">' + amountField("Total amount *", "requestAmount") + select("Transaction type", "transactionType", ["Full Payment", "Partial Payment"]) + '<div data-distribution hidden>' + select("Distribution", "distribution", ["Equal", "Manual"]) + '</div><button type="button" class="button tertiary compact" data-add-payment>+ Add prepayment</button></div><div class="prepayment-table-wrap"><table class="prepayment-entry-table"><thead><tr><th>Name <em>*</em></th><th>Amount (EUR) <em>*</em></th><th>Percent</th><th>When to be paid</th><th>Due date <em>*</em></th><th></th></tr></thead><tbody data-payment-rows></tbody></table></div><small data-payment-hint></small></section></div></fieldset><p class="prepayment-warning"><strong>ATENCIÓN</strong>: a partir de las 14h no se pueden registrar pagos para el día en curso. Selecciona el día siguiente para registrarlo.<br>En caso de <strong>urgencia</strong>, contactar directamente con Administración.</p><div class="prepayment-form-actions"><button type="button" class="button tertiary" data-close>Cancel</button><button type="submit" class="button">Save prepayments</button></div></form><button type="button" class="booking-action-dialog-dismiss" aria-label="Close" data-dismiss>×</button></div>';
  dialog.innerHTML = dialog.innerHTML.replace('<section class="prepayment-request-details"', '<section class="prepayment-services-section"><h5>Services included in this request</h5><p data-services-summary aria-live="polite"></p><div class="prepayment-service-options" data-service-options></div></section><section class="prepayment-request-details"');
  document.body.appendChild(dialog);
  const form = dialog.querySelector("form");
  const input = name => form.elements.namedItem(name);
  const feedback = dialog.querySelector("[data-feedback]");
  const reportError = message => {
    feedback.textContent = message;
    showFeedback(message, "error");
  };
  const attachments = {};
  let uploadedProforma = null;
  let proformaConfirmed = false;
  let lockedRequestId = "";
  const updateServiceChoices = () => {
    const requestId = lockedRequestId || input("request").value;
    dialog.querySelector("[data-service-options]").innerHTML = candidates.map(item => {
      const linkedId = idOf(item.Prepayment_Request);
      const conflict = linkedId && linkedId !== requestId;
      const linkedHere = linkedId && linkedId === requestId;
      if (linkedHere) selectedServices.add(String(item.id));
      if (conflict) selectedServices.delete(String(item.id));
      return '<label class="prepayment-service-option' + (conflict ? ' is-unavailable' : '') + '"><input type="checkbox" data-prepayment-service="' + escapeHtml(item.id) + '"' + (selectedServices.has(String(item.id)) ? ' checked' : '') + (lockedRequestId || conflict || linkedHere ? ' disabled' : '') + '><span><strong>' + text(item.Product_Description || item.Name) + '</strong><small>' + text(String(item.Service_Date || "").slice(0, 10)) + (linkedId ? ' · ' + (linkedHere ? 'Already in this request' : 'Assigned to another request') : '') + '</small></span><span>' + (item.Total_Purchase_Price == null ? '—' : text(money({ Amount: item.Total_Purchase_Price, Currency: "EUR" }))) + '</span></label>';
    }).join("");
    const selected = includedServices();
    dialog.querySelector("[data-services-summary]").textContent = candidates.length + " services · " + selected.length + " selected" + (selected.length ? ": " + selected.map(item => item.Product_Description || item.Name || item.id).join(", ") : "") + (selectedTotal() ? " · Services total: " + selectedTotal() + " EUR" : "");
    rows.forEach(row => {
      const previous = row.input("referenceService").value;
      row.input("referenceService").innerHTML = includedServices().map(item => '<option value="' + escapeHtml(item.id) + '">' + text(item.Product_Description || item.Name || item.id) + ' · ' + text(String(item.Service_Date || "").slice(0, 10)) + '</option>').join("");
      row.input("referenceService").value = selectedServices.has(previous) ? previous : selectedServices.has(String(service.id)) ? String(service.id) : String(includedServices()[0]?.id || "");
      row.input("referenceService").hidden = includedServices().length <= 1;
      if (previous && previous !== row.input("referenceService").value) row.updateDueDate();
    });
  };
  dialog.querySelector("[data-service-options]").addEventListener("change", event => {
    const id = event.target.dataset.prepaymentService;
    if (!id || saving || lockedRequestId) return;
    if (event.target.checked) selectedServices.add(id); else selectedServices.delete(id);
    updateServiceChoices();
    if (!input("request").value) input("requestAmount").value = selectedTotal();
    updateRows();
  });
  dialog.querySelectorAll("[data-attachment]").forEach(container => {
    const name = container.dataset.attachment;
    const picker = input(name);
    const dropzone = container.querySelector("[data-upload]");
    const list = container.querySelector("[data-file-list]");
    const showFile = file => {
      attachments[name] = file || null;
      list.hidden = !file;
      list.innerHTML = file ? '<span class="card-transaction-file"><span>' + text(file.name) + '</span><button type="button" aria-label="Remove ' + name + '">&times;</button></span>' : "";
      list.querySelector("button")?.addEventListener("click", () => { picker.value = ""; showFile(null); });
    };
    dropzone.addEventListener("click", () => picker.click());
    picker.addEventListener("change", () => showFile(picker.files[0]));
    dropzone.addEventListener("dragover", event => { event.preventDefault(); if (!dropzone.disabled) dropzone.classList.add("is-dragging"); });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("is-dragging"));
    dropzone.addEventListener("drop", event => {
      event.preventDefault();
      dropzone.classList.remove("is-dragging");
      if (!saving && !createdRequestId && !input("request").value && event.dataTransfer.files.length) showFile(event.dataTransfer.files[0]);
    });
  });
  const rows = [];
  let nextRow = 0;
  const addButton = dialog.querySelector("[data-add-payment]");
  const selectedRequest = () => requests.find(item => String(item.id) === input("request").value);
  const transactionType = () => selectedRequest()?.Transaction_Type || input("transactionType").value;
  const cents = value => Math.round(Number(value) * 100);
  const previousPayments = () => (data.payments || []).filter(payment => idOf(payment.Prepayment_Request) === input("request").value && payment.Accounting_Status !== "Cancelled");
  const allocatedBefore = () => previousPayments().reduce((sum, payment) => sum + cents(payment.Amount), 0);
  const updateRows = (percentSource = null) => {
    const partial = transactionType() === "Partial Payment";
    const total = cents(input("requestAmount").value);
    addButton.hidden = !partial;
    dialog.querySelector("[data-distribution]").hidden = !partial;
    const equal = partial && input("distribution").value === "Equal";
    if (equal) {
      const pending = rows.filter(row => !row.saved);
      const savedAmount = rows.filter(row => row.saved).reduce((sum, row) => sum + cents(row.input("amount").value), 0);
      const remaining = Math.max(0, total - allocatedBefore() - savedAmount);
      const share = Math.floor(remaining / pending.length);
      const extraCents = remaining % pending.length;
      pending.forEach((row, index) => {
        row.autoAmount = false;
        row.input("amount").value = total > 0 ? ((share + (index < extraCents ? 1 : 0)) / 100).toFixed(2) : "";
      });
    }
    rows.forEach(row => {
      row.element.querySelector("[data-remove]").disabled = rows.length === 1 || row.saved;
      row.input("amount").readOnly = !partial || equal;
      row.input("percent").readOnly = !partial || equal;
      if (((!partial && rows.length === 1) || (partial && !equal && row.autoAmount && rows.length === 1 && allocatedBefore() === 0)) && !row.saved) row.input("amount").value = total > 0 ? (total / 100).toFixed(2) : "";
      if (!row.saved && row !== percentSource) row.input("percent").value = total > 0 && row.input("amount").value !== "" ? (cents(row.input("amount").value) / total * 100).toFixed(2) : "";
    });
    const allocated = allocatedBefore() + rows.reduce((sum, row) => sum + cents(row.input("amount").value), 0);
    dialog.querySelector("[data-payment-hint]").textContent = !partial && rows.length > 1 ? "Full Payment allows one prepayment. Remove extra lines or select Partial Payment." : total > 0 ? "Allocated: " + (allocated / 100).toFixed(2) + " EUR / " + (total / 100).toFixed(2) + " EUR. Remaining: " + ((total - allocated) / 100).toFixed(2) + " EUR" : "Enter the total amount in EUR, then distribute it across the prepayments.";
  };
  const addRow = () => {
    const index = ++nextRow;
    const element = document.createElement("tr");
    const cell = (label, name, type, attributes) => '<td>' + field(label, name + index, type, attributes) + '</td>';
    element.innerHTML = cell("Name", "paymentName", "text", 'required maxlength="120"') + '<td>' + amountField("Amount (EUR)", "amount" + index) + '</td>' + cell("Percent", "percent", "number", 'min="0" max="100" step="0.01"') + '<td>' + select("When to be paid", "timing" + index, timingOptions) + '</td>' + cell("Due date", "dueDate", "date", 'required') + '<td><button type="button" class="button tertiary compact" data-remove aria-label="Remove prepayment">&times;</button></td>';
    element.innerHTML = element.innerHTML.replace('</select></label></td>', '</select></label><select name="referenceService' + index + '" aria-label="Service used to calculate the due date" title="Service used to calculate the due date"></select></td>');
    dialog.querySelector("[data-payment-rows]").appendChild(element);
    const row = { element, saved: false, autoAmount: index === 1, input: name => input(name + index) };
    rows.push(row);
    row.updateDueDate = () => {
      if (saving || row.saved) return;
      const referenceService = includedServices().find(item => String(item.id) === row.input("referenceService").value) || includedServices()[0];
      const dueDate = calculatePrepaymentDueDate(row.input("timing").value, referenceService?.Service_Date);
      if (dueDate === null) { row.input("dueDate").setCustomValidity(""); return; } // Keep manual dates.
      row.input("dueDate").value = dueDate;
      row.input("dueDate").setCustomValidity(dueDate ? "" : "This service has no valid service date. Select Specific Date and enter the due date manually.");
    };
    row.input("timing").addEventListener("change", row.updateDueDate);
    row.input("referenceService").addEventListener("change", row.updateDueDate);
    row.input("dueDate").addEventListener("input", () => row.input("dueDate").setCustomValidity(""));
    row.input("amount").addEventListener("input", () => {
      if (row.saved || row.input("amount").readOnly) return;
      row.autoAmount = false;
      updateRows();
    });
    row.input("percent").addEventListener("input", () => {
      if (row.saved || row.input("percent").readOnly) return;
      row.autoAmount = false;
      const percent = row.input("percent").value;
      const total = cents(input("requestAmount").value);
      row.input("amount").value = percent !== "" && total > 0 ? (Math.round(total * Number(percent) / 100) / 100).toFixed(2) : "";
      updateRows(row);
    });
    row.input("paymentName").value = "PREPAY-" + reference + "-" + supplierCode + "-" + index;
    element.querySelector("[data-remove]").addEventListener("click", () => {
      if (saving || row.saved || rows.length === 1) return;
      rows.splice(rows.indexOf(row), 1);
      element.remove();
      updateRows();
    });
    updateRows();
    updateServiceChoices();
    return row;
  };
  addButton.addEventListener("click", () => { if (!saving && transactionType() === "Partial Payment") addRow().input("paymentName").focus(); });

  let saving = false;
  let createdRequestId = "";
  let requestIdMissing = false;
  const close = () => { if (saving) return; dialog.remove(); previousFocus?.focus(); };
  dialog.querySelector("[data-close]").addEventListener("click", close);
  dialog.querySelector("[data-dismiss]").addEventListener("click", close);
  dialog.querySelector(".booking-action-dialog-backdrop").addEventListener("click", close);
  dialog.addEventListener("keydown", event => {
    if (event.key === "Escape") close();
    if (event.key === "Tab") {
      const focusable = [...dialog.querySelectorAll('button, input, select, textarea')].filter(node => !node.disabled && node.getClientRects().length);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  dialog.querySelector("[data-dismiss]").focus();
  await ensurePrepaymentsLoaded(elements, state);
  if (!dialog.isConnected) return;
  const data = state.prepaymentsData;
  if (String(state.selectedBookingId) !== bookingId || !data || data.bookingId !== bookingId || data.error) { feedback.textContent = data?.error || "Booking changed. Close and reopen the form."; return; }
  form.hidden = false;
  feedback.textContent = supplierId ? "" : "This service has no linked supplier. Add a supplier to the service before creating a prepayment.";
  const requests = data.requests.filter(request => supplierId && idOf(request.Supplier) === supplierId && (!request.Currency || request.Currency === "EUR") && !["Cancelled", "Discarded", "Fully Paid"].includes(request.Status));
  if (initialRequestId && !requests.some(request => String(request.id) === initialRequestId)) {
    form.hidden = true;
    reportError("The selected service belongs to a request that is closed or unavailable. Open that request in CRM.");
    return;
  }
  dialog.querySelector("[data-request-selector]").hidden = requests.length === 0;
  input("request").innerHTML = '<option value="">Create new request</option>' + requests.map(request => '<option value="' + escapeHtml(request.id) + '">' + text(request.Name) + ' · ' + text(getLookupName(request.Supplier)) + '</option>').join("");
  input("request").value = initialRequestId;
  input("requestName").value = "PREPAY-REQ-" + reference + "-" + supplierCode;
  input("transactionType").value = "Full Payment";
  input("requestAmount").value = defaultTotal;
  input("distribution").value = "Equal";
  addRow();
  input("transactionType").addEventListener("change", updateRows);
  input("requestAmount").addEventListener("input", updateRows);
  input("distribution").addEventListener("change", updateRows);
  const changeRequest = () => {
    const existing = Boolean(input("request").value);
    dialog.querySelector("[data-new-request]").hidden = existing;
    dialog.querySelectorAll("[data-new-request] input, [data-new-request] select, [data-new-request] textarea, [data-new-request] button").forEach(node => { node.disabled = existing; });
    const request = requests.find(item => String(item.id) === input("request").value);
    updateServiceChoices();
    input("requestAmount").value = request ? (request.Amount == null ? "" : String(request.Amount)) : selectedTotal();
    input("requestAmount").readOnly = Boolean(request);
    input("transactionType").disabled = Boolean(request);
    input("transactionType").value = request?.Transaction_Type || "Full Payment";
    updateRows();
  };
  input("request").addEventListener("change", changeRequest);
  changeRequest();
  (requests.length ? input("request") : input("requestName")).focus();
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (saving || requestIdMissing) return;
    try { validatePrepaymentServices(includedServices(), bookingId, supplierId, lockedRequestId || input("request").value); }
    catch (error) { reportError(error.message); return; }
    if (isPrepaymentTimeRestricted(state)) {
      reportError("A partir de las 14:00 (hora de Madrid) no puedes registrar prepagos. Solo los perfiles Administrator y Finance Administrator de User Relationships pueden hacerlo. En caso de urgencia, contacta directamente con Administraci\u00f3n.");
      return;
    }
    if (transactionType() === "Full Payment" && rows.length > 1) {
      reportError("Full Payment requires a single prepayment. Remove extra prepayments or select Partial Payment.");
      return;
    }
    updateRows();
    if (!form.reportValidity()) { reportError("Complete all required fields and check the amounts and dates before saving."); return; }
    if (String(state.selectedBookingId) !== bookingId) { reportError("Booking changed. Close and reopen the form."); return; }
    if (rows.some(row => !row.input("paymentName").value.trim()) || (!input("request").value && !createdRequestId && !input("requestName").value.trim())) { reportError("Enter a name for the request and prepayment."); return; }
    if (!supplierId) { reportError("Add a supplier to this service before creating a prepayment."); return; }
    const total = cents(input("requestAmount").value);
    if (!Number.isFinite(total) || total <= 0) { reportError("Enter a total amount greater than zero in EUR. Existing requests must have their Amount set before adding prepayments."); return; }
    if (rows.some(row => !Number.isFinite(Number(row.input("amount").value)) || cents(row.input("amount").value) <= 0)) { reportError("Each prepayment must have an amount greater than zero in EUR."); return; }
    if (transactionType() !== "Partial Payment" && previousPayments().length) { reportError("This Full Payment request already has a prepayment."); return; }
    const allocated = allocatedBefore() + rows.reduce((sum, row) => sum + cents(row.input("amount").value), 0);
    if (allocated !== total) { reportError("Prepayments must add up to the total amount of " + (total / 100).toFixed(2) + " EUR."); return; }
    if (!createdRequestId && !input("request").value && !attachments.proforma) {
      reportError("Attach at least one Proforma document before saving.");
      return;
    }
    saving = true;
    form.querySelector("fieldset").disabled = true;
    form.querySelector('[type="submit"]').disabled = true;
    feedback.textContent = "Saving prepayment…";
    try {
      let requestId = createdRequestId || input("request").value;
      if (!requestId) {
        const requestPayload = { Name: input("requestName").value.trim(), Booking: { id: bookingId }, Supplier: { id: supplierId }, Status: "To Be Paid", Currency: "EUR", Amount: total / 100, Transaction_Type: input("transactionType").value, Requested_Date: new Date().toISOString().slice(0, 19) + "+00:00", Requested_By_2: requestedBy, MFSP_Reference: reference, Supplier_Code: supplierCode, Observations: input("observations").value };
        uploadedProforma = await uploadFile(attachments.proforma);
        const result = await crmCreateRecord(MODULES.prepaymentRequests, requestPayload);
        requestId = createdRequestId = String(result.details?.id || "");
        if (!requestId) { requestIdMissing = true; throw new Error("CRM did not return the new request ID. Close and refresh before retrying."); }
        rememberCreatedPrepayment(state, bookingId, "requests", { ...requestPayload, id: requestId, Supplier: { id: supplierId, name: supplierName } });
        data.loaded = false;
      }
      lockedRequestId = requestId;
      input("request").disabled = true;
      updateServiceChoices();
      if (createdRequestId && !proformaConfirmed) {
        feedback.textContent = "Saving and verifying Proforma attachment…";
        const confirmedFiles = await savePrepaymentProforma(requestId, uploadedProforma);
        proformaConfirmed = true;
        const parent = data.requests.find(request => String(request.id) === requestId);
        if (parent) rememberCreatedPrepayment(state, bookingId, "requests", { ...parent, Proforma_Attached: confirmedFiles });
      }
      input("request").disabled = true;
      input("requestAmount").readOnly = true;
      input("transactionType").disabled = true;
      dialog.querySelectorAll("[data-new-request] input, [data-new-request] select, [data-new-request] textarea, [data-new-request] button").forEach(node => { node.disabled = true; });
      await linkPrepaymentServices(includedServices(), bookingId, supplierId, requestId, saved => {
        const update = item => { if (item && String(item.id) === String(saved.id)) Object.assign(item, { Prepayment_Request: saved.Prepayment_Request, Payment_Status: saved.Payment_Status }); };
        candidates.forEach(update);
        (state.services || []).forEach(update);
        (state.filteredServices || []).forEach(update);
        update(state.selectedService);
      });
      for (const row of rows) {
        if (row.saved) continue;
        const value = name => row.input(name).value;
        const payload = { Name: value("paymentName").trim(), Prepayment_Request: { id: requestId }, Amount: Number(value("amount")), Currency: "EUR", When_To_Be_Paid: value("timing"), Due_Date: value("dueDate"), Accounting_Status: "Pending invoice" };
        if (value("percent") !== "") payload.Percent = Number(value("percent"));
        const result = await crmCreateRecord(MODULES.prepayments, payload);
        row.saved = true;
        rememberCreatedPrepayment(state, bookingId, "payments", { ...payload, id: result.details?.id });
        // Keep the parent available too while CRM search is catching up.
        const parent = data.requests.find(request => String(request.id) === String(requestId));
        if (parent) rememberCreatedPrepayment(state, bookingId, "requests", parent);
        row.element.querySelectorAll("input, select, button").forEach(node => { node.disabled = true; });
        data.loaded = false;
      }
      saving = false;
      close();
      data.loaded = true;
      if (state.prepaymentsData === data) renderPrepayments(elements, state);
      if (onSaved && String(state.selectedBookingId) === bookingId) onSaved();
      if (String(state.selectedBookingId) === bookingId) await ensurePrepaymentsLoaded(elements, state, true);
    } catch (error) {
      reportError((createdRequestId ? (proformaConfirmed ? "The request was created. Retry to save the remaining prepayments. " : "The request was created, but the Proforma attachment could not be confirmed. No prepayments were created. Retry to attach the Proforma and continue. ") : "") + (error.message || "Could not save prepayment."));
      if (createdRequestId) {
        input("request").disabled = true;
        dialog.querySelectorAll("[data-new-request] input, [data-new-request] select, [data-new-request] textarea, [data-new-request] button").forEach(node => { node.disabled = true; });
      }
    } finally { saving = false; form.querySelector("fieldset").disabled = requestIdMissing; form.querySelector('[type="submit"]').disabled = requestIdMissing; }
  });
}

async function uploadFile(file) {
  if (!file) throw new Error("Attach a Proforma document before saving.");
  const response = await window.ZOHO.CRM.API.uploadFile({ CONTENT_TYPE: "multipart", PARTS: [{ headers: { "Content-Disposition": "file;" }, content: "__FILE__" }], FILE: { fileParam: "content", file } });
  const result = (Array.isArray(response) ? response : response?.data || [])[0];
  if (!result?.details?.id || String(result.status || result.code || "").toLowerCase() === "error") throw new Error(result?.message || "Could not upload " + file.name);
  return [{ File_Id__s: result.details.id }];
}

async function savePrepaymentProforma(requestId, documents) {
  const fileIds = (documents || []).map(document => document.File_Id__s).filter(Boolean);
  if (!fileIds.length) throw new Error("The Proforma upload did not return a file ID.");
  const variants = [
    fileIds.map(id => ({ $file_id: id })),
    fileIds.map(id => ({ file_id: id })),
    fileIds,
    { $file_id: fileIds }
  ];
  for (const value of variants) {
    const result = await crmUpdateRecord(MODULES.prepaymentRequests, { id: requestId, Proforma_Attached: value });
    if (String(result?.status || "").toLowerCase() === "error" || String(result?.code || "").toUpperCase() !== "SUCCESS") continue;
    const request = await crmGetRecord(MODULES.prepaymentRequests, requestId);
    const files = request?.Proforma_Attached;
    if (Array.isArray(files) && files.length >= fileIds.length && files.every(file => file && (file.id || file.file_Id || file.File_Id__s || file.file_id || file.$file_id))) return files;
  }
  throw new Error("CRM did not confirm that the Proforma was attached. Please retry.");
}
