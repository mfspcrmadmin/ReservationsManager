import { syncServiceStatusDropdown } from "./service-status-dropdown.js";
import { pendingPrepaymentCreation, beginPrepaymentCreation, savePrepaymentCreation, runPrepaymentCreation, finishPrepaymentCreation, prepaymentCreationDisposition, discardUnsentPrepaymentCreation, prepaymentCreationSummary } from "./prepayment-creation.js";
import { getWidgetPermissions } from "./widget-permissions.js";
import { requestCrmAttachmentsV8 } from "./communication-attachments-api.js";
import { requirePaymentSettlement } from "./payment-settlement.js";
import { showFeedback } from "./app-feedback.js";
import { initializePrepaymentStatusLegend } from "./prepayment-status-legend.js";
import { previewPaymentAttachment } from "./payments-controller.js";
import { openPrepaymentManagement } from "./prepayment-management.js";
import { crmCreateRecord, crmSearchRecord, crmUpdateRecord, crmGetRecord, crmGetFields } from "./api.js";
import { MODULES } from "./constants.js";
import { requireSupplierPaymentReference } from "./supplier-payment-reference.js";
import { escapeHtml, getServiceSupplierName, getLookupName, escapeCriteriaValue, formatDate, formatDateTime } from "./utils.js";

const requestServicesModule = MODULES.prepaymentRequestServices;
const associationAttempts = new Map();
const paidPrepaymentStatuses = ["Prepayment recorded", "Discard - Credit", "Discard - Already Paid"];
const isPrepaymentPaid = payment => paidPrepaymentStatuses.includes(payment.Accounting_Status);
function renderPrepaymentStatus(payment) {
  const paid = isPrepaymentPaid(payment);
  return '<span class="prepayment-status-pair"><span class="prepayment-accounting-status">' + text(payment.Accounting_Status) + '</span><span class="prepayment-payment-meaning ' + (paid ? 'is-paid' : 'is-to-pay') + '">' + (paid ? 'Paid' : 'To pay') + '</span></span>';
}

const timingOptions = ["Specific Date", "Within 1 day", "Within 2 days", "Within 3 days", "10 days prior to service date", "15 days prior to service date", "20 days prior to service date", "30 days prior to service date"];

const weekendDueDateMessage = "Due date must be Monday to Friday. Select a weekday.";
const isWeekendDueDate = value => [0, 6].includes(new Date(value + "T00:00:00Z").getUTCDay());

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
export function prepaymentDateCalculation(timing, serviceDate) {
  const original = calculatePrepaymentDueDate(timing, serviceDate);
  if (!original) return { original, final: original, adjusted: false };
  const date = new Date(original + "T00:00:00Z");
  const weekday = date.getUTCDay();
  if (weekday === 6) date.setUTCDate(date.getUTCDate() - 1);
  if (weekday === 0) date.setUTCDate(date.getUTCDate() - 2);
  const final = date.toISOString().slice(0, 10);
  return { original, final, adjusted: original !== final };
}

function prepaymentToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type).value).join("-");
}

export function prepaymentDateError(state, day, automatic, now = new Date()) {
  if (!day) return "Enter a valid due date.";
  if (isWeekendDueDate(day)) return weekendDueDateMessage;
  if (automatic && day < prepaymentToday(now)) return "The calculated due date is in the past. Change payment timing or select Specific Date.";
  if (isPrepaymentTimeRestricted(state, [day], now)) return "After 14:00 Madrid time, choose a later due date or contact Administration.";
  return "";
}

function prepaymentDayLabel(day) {
  if (!day) return "No service date";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(String(day).slice(0, 10) + "T00:00:00Z"));
}

const idOf = value => String(value && (value.id || value.value) || "");
const money = record => new Intl.NumberFormat("es-ES", { style: "currency", currency: record.Currency || "EUR" }).format(Number(record.Amount) || 0);
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
  const deleted = state.deletedPrepaymentRecords?.[bookingId]?.[kind] || [];
  records = records.filter(record => !deleted.includes(String(record.id)));
  const cache = state.recentPrepaymentRecords?.[bookingId];
  if (!cache) return records;
  const found = new Set(records.map(record => String(record.id)));
  cache[kind] = cache[kind].filter(record => !found.has(String(record.id)) && !deleted.includes(String(record.id)));
  return records.concat(cache[kind]);
}

export async function searchAll(entity, criteria) {
  const records = [], seen = new Set();
  for (let page = 1; ; page += 1) {
    const batch = await crmSearchRecord(entity, criteria, page, 200);
    if (!Array.isArray(batch)) throw new Error("Could not read " + entity + ".");
    for (const row of batch) {
      if (!row.id || seen.has(String(row.id))) throw new Error("Incomplete or repeated records for " + entity + ".");
      seen.add(String(row.id));
    }
    records.push(...batch);
    if (batch.length < 200) return records;
  }
}

export async function getBookingPrepayment(bookingId, prepaymentId) {
  const payment = await crmGetRecord(MODULES.prepayments, prepaymentId);
  if (!payment || String(payment.id) !== String(prepaymentId) || !idOf(payment.Prepayment_Request)) throw new Error("This prepayment is unavailable or has no request.");
  const request = await crmGetRecord(MODULES.prepaymentRequests, idOf(payment.Prepayment_Request));
  if (!request || idOf(request.Booking) !== String(bookingId)) throw new Error("This prepayment does not belong to the selected booking.");
  return { payment, request };
}

export async function loadPrepaymentInvoices(payment) {
  const rows = await searchAll(MODULES.prepaymentInvoiceAllocations, "(Prepayment:equals:" + escapeCriteriaValue(payment.id) + ")");
  const seen = new Set();
  let total = 0;
  for (const row of rows) {
    const invoiceId = idOf(row.Vendor_Invoice), amount = Number(row.Allocated_Amount);
    if (idOf(row.Prepayment) !== String(payment.id) || !invoiceId || seen.has(invoiceId) || !Number.isFinite(amount) || amount <= 0 || row.Currency !== (payment.Currency || "EUR")) throw new Error("Invalid or duplicate invoice association. Ask Accounting to review this prepayment.");
    seen.add(invoiceId); total += Math.round(amount * 100);
  }
  if (total > Math.round(Number(payment.Amount) * 100)) throw new Error("Invoice allocations exceed the prepayment amount.");
  return { rows, total: total / 100, remaining: (Math.round(Number(payment.Amount) * 100) - total) / 100 };
}

export async function openPrepaymentDetails(elements, state, prepaymentId) {
  const bookingId = String(state.selectedBookingId);
  const { payment, request } = await getBookingPrepayment(bookingId, prepaymentId);
  const invoices = await loadPrepaymentInvoices(payment);
  if (String(state.selectedBookingId) !== bookingId) return;
  const previous = document.querySelector(".booking-prepayment-details");
  if (previous) previous.close();
  const dialog = document.createElement("dialog");
  dialog.className = "booking-prepayment-details";
  dialog.setAttribute("aria-label", "Prepayment details");
  const pairs = [["Prepayment", payment.Name], ["ID", payment.id], ["Request", request.Name], ["Supplier", getLookupName(request.Supplier)], ["Booking", request.MFSP_Reference || getLookupName(request.Booking)], ["Amount", money(payment)], ["Accounting status", payment.Accounting_Status], ["Due date", payment.Due_Date], ["Payment date", payment.Payment_Date], ["Observations", payment.Observations || request.Observations]];
  dialog.innerHTML = '<header><h3>Prepayment details</h3><button type="button" class="button tertiary compact" data-close aria-label="Close">×</button></header><dl>' + pairs.map(([label, value]) => '<div><dt>' + text(label) + '</dt><dd>' + text(value) + '</dd></div>').join('') + '</dl><section><h4>Associated invoices</h4><ul>' + invoices.rows.map(row => '<li>' + text(getLookupName(row.Vendor_Invoice) || idOf(row.Vendor_Invoice)) + ' &middot; ' + text(money({ Amount: row.Allocated_Amount, Currency: row.Currency })) + '</li>').join('') + '</ul><p>Allocated: ' + text(money({ Amount: invoices.total, Currency: payment.Currency })) + ' &middot; Remaining: ' + text(money({ Amount: invoices.remaining, Currency: payment.Currency })) + '</p></section><footer><button type="button" class="button tertiary compact" data-close>Close</button></footer>';
  dialog.querySelectorAll('[data-close]').forEach(button => { button.onclick = () => dialog.close(); });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.appendChild(dialog);
  dialog.showModal();
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
  refresh.classList.toggle("is-loading", Boolean(data && data.loading));
  refresh.setAttribute("aria-busy", data?.loading ? "true" : "false");
  refresh.setAttribute("aria-label", data?.loading ? "Refreshing prepayments" : "Refresh prepayments");
  const title = document.getElementById("prepayments-title");
  if (title) title.textContent = "Prepayments";
  const count = document.getElementById("prepayments-count");
  if (count) count.textContent = data && (data.loaded || data.payments.length) && !data.error ? data.payments.length + (data.payments.length === 1 ? " payment" : " payments") : "";
  summary.innerHTML = "";
  const message = !state.selectedBookingId ? "Select a booking to view prepayments." : !data ? "Open this tab to load prepayments." : data.loading && !data.payments.length ? "Loading requests and prepayments…" : data.error;
  if (message) { content.innerHTML = '<p class="table-empty" role="status">' + text(message) + '</p>'; return; }
  const totals = new Map();
  data.payments.forEach(payment => {
    const currency = payment.Currency || "EUR";
    if (!totals.has(currency)) totals.set(currency, { recorded: 0, pending: 0 });
    if (isPrepaymentPaid(payment)) totals.get(currency).recorded += Number(payment.Amount) || 0;
    if (!isPrepaymentPaid(payment) && payment.Accounting_Status !== "Cancelled") totals.get(currency).pending += Number(payment.Amount) || 0;
  });
  summary.innerHTML = [...totals].map(([currency, total]) => '<span>Pending <strong>' + money({ Currency: currency, Amount: total.pending }) + '</strong></span><span>Paid <strong>' + money({ Currency: currency, Amount: total.recorded }) + '</strong></span>').join("");
  content.innerHTML = data.requests.length ? data.requests.map(request => renderRequest(request, data.payments)).join("") : '<p class="table-empty">No prepayment requests found for this booking.</p>';
}

const prepaymentColumns = [
  ["name", "Prepayment", 210], ["status", "Accounting status", 280], ["amount", "Amount", 115],
  ["percent", "%", 65], ["timing", "When to pay", 165], ["due", "Due date", 115],
  ["paidDate", "Payment date", 115], ["actions", "Actions", 95]
];
const fileIcon = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2h6l4 4v12H5zM11 2v5h4M7 11h6M7 14h4"/></svg>';
function fileNames(files, label, recordId, kind) {
  return (Array.isArray(files) ? files : []).map((file, index) => {
    const name = file.File_Name__s || file.File_Name || file.file_Name || file.file_name || file.name || "Attachment";
    const caption = label ? label + " - " + name : "View proof";
    const url = file.url || file.file_url || file.preview_url || file.download_url || "";
    const canOpen = /^https?:\/\//i.test(url) || file.file_Id || file.File_Id__s || file.File_Id || file.file_id || file.id;
    const body = fileIcon + '<span>' + text(canOpen ? caption : (label ? label + " · " : "") + name) + '</span>';
    return canOpen ? '<button type="button" class="prepayment-file-link" data-prepayment-file="' + escapeHtml(kind) + '" data-record-id="' + escapeHtml(recordId) + '" data-file-index="' + index + '" title="' + escapeHtml(name) + '" aria-label="' + escapeHtml(caption + (label ? "" : " · " + name)) + '">' + body + '</button>' : '<span class="prepayment-file-name" title="' + escapeHtml(name) + '">' + body + '</span>';
  }).join("");
}
function renderRequest(request, allPayments) {
  const payments = allPayments.filter(payment => idOf(payment.Prepayment_Request) === String(request.id)).sort((a, b) => String(a.Due_Date || "9999").localeCompare(String(b.Due_Date || "9999")));
  const notes = String(request.Observations || "").trim();
  const files = fileNames(request.Proforma_Attached, "Proforma / invoices", request.id, "proforma") + fileNames(request.Invoice_Attached, "Invoice", request.id, "invoice");
  const requester = getLookupName(request.Requested_By) || (typeof request.Requested_By_2 === "object" ? getLookupName(request.Requested_By_2) : request.Requested_By_2);
  const instructions = notes ? '<div class="prepayment-instructions"><strong>Payment instructions</strong>' + (notes.length > 240 || notes.split("\n").length > 3
    ? '<div class="prepayment-instructions-text is-collapsed">' + text(notes) + '</div><button type="button" class="prepayment-notes-toggle" data-prepayment-notes aria-expanded="false">Show more</button>'
    : '<div class="prepayment-instructions-text">' + text(notes) + '</div>') + '</div>' : '';
  const info = '<span class="prepayment-status-heading">Accounting status <button type="button" class="prepayment-status-help" data-prepayment-status-help aria-label="Accounting status legend" aria-haspopup="dialog" aria-expanded="false"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5"/><path d="M10 9v5"/><circle cx="10" cy="6" r=".7"/></svg></button></span>';
  const table = payments.length ? '<div class="table-wrap" tabindex="0" role="region" aria-label="Prepayments for ' + escapeHtml(getLookupName(request.Supplier) || request.Name || "request") + '"><table class="services-table prepayments-table"><colgroup>' + prepaymentColumns.map(([key, , width]) => '<col style="width:' + width + 'px">').join('') + '</colgroup><thead><tr>' + prepaymentColumns.map(([key, label]) => '<th scope="col" class="prepayment-col-' + key + '">' + (key === "status" ? info : label) + '</th>').join('') + '</tr></thead><tbody>' +
    payments.map(payment => {
      const editBlocked = payment.Vendor_Payment || isPrepaymentPaid(payment) || ["Paid", "Cancelled"].includes(payment.Accounting_Status);
      const cells = [text(payment.Name), renderPrepaymentStatus(payment), text(money(payment)), payment.Percent == null ? "—" : text(String(payment.Percent)) + "%",
        text(payment.When_To_Be_Paid), payment.Due_Date ? text(formatDate(payment.Due_Date)) : "—", payment.Payment_Date ? text(formatDate(payment.Payment_Date)) : "—",
        '<div class="prepayment-row-actions"><button type="button" class="button tertiary compact" data-prepayment-edit="' + escapeHtml(payment.id) + '" aria-label="Edit prepayment" title="' + (editBlocked ? 'Paid, cancelled or payment-linked prepayments cannot be edited' : 'Edit prepayment') + '"' + (editBlocked ? ' disabled' : '') + '><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"/></svg></button><button type="button" class="button tertiary compact" data-prepayment-delete="' + escapeHtml(payment.id) + '" aria-label="Delete prepayment" title="Delete prepayment"' + (payment.Vendor_Payment || payment.Vendor_Invoice ? ' disabled' : '') + '><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg></button></div>'];
      return '<tr>' + cells.map((cell, index) => '<td class="prepayment-col-' + prepaymentColumns[index][0] + '">' + cell + '</td>').join('') + '</tr>';
    }).join('') + '</tbody></table></div>' : '<p class="table-empty">No prepayments registered for this request yet.</p>';
  return '<article class="prepayment-request-card"><header><div class="prepayment-request-identity"><div class="prepayment-supplier-line"><h4>' + text(getLookupName(request.Supplier)) + '</h4>' + (request.Transaction_Type ? '<span>' + text(request.Transaction_Type) + '</span>' : '') + '</div><p class="prepayment-request-reference">' + text(request.Name) + '</p></div><span class="prepayment-request-count">' + payments.length + (payments.length === 1 ? ' prepayment' : ' prepayments') + '</span></header>' +
    '<div class="prepayment-request-meta"><span>Requested: ' + (request.Requested_Date ? text(formatDateTime(request.Requested_Date)) : "—") + '</span><span>By: ' + text(requester) + '</span><span>Reference: ' + text(request.MFSP_Reference) + '</span></div>' +
    (files ? '<div class="prepayment-request-files">' + files + '</div>' : '') + instructions + table + '</article>';
}

export function initializePrepayments(elements, state, onSaved) {
  initializePrepaymentStatusLegend(document.getElementById("prepayments-content"), paidPrepaymentStatuses);
  document.getElementById("prepayments-content").addEventListener("click", event => {
    const action = event.target.closest("[data-prepayment-edit], [data-prepayment-delete]");
    if (action) {
      if (action.disabled) return;
      action.disabled = true;
      const deleting = action.hasAttribute("data-prepayment-delete");
      openPrepaymentManagement(elements, state, deleting ? action.dataset.prepaymentDelete : action.dataset.prepaymentEdit, deleting, onSaved)
        .catch(error => showFeedback(error.message || "Could not open prepayment.", "error"))
        .finally(() => { action.disabled = false; });
      return;
    }
    const invoiceButton = event.target.closest("[data-prepayment-invoices]");
    if (invoiceButton) {
      invoiceButton.disabled = true;
      openPrepaymentDetails(elements, state, invoiceButton.dataset.prepaymentInvoices).catch(error => showFeedback(error.message || "Could not load invoices.", "error")).finally(() => { invoiceButton.disabled = false; });
      return;
    }
    const notes = event.target.closest("[data-prepayment-notes]");
    if (notes) {
      const expanded = notes.getAttribute("aria-expanded") !== "true";
      notes.previousElementSibling.classList.toggle("is-collapsed", !expanded);
      notes.setAttribute("aria-expanded", String(expanded));
      notes.textContent = expanded ? "Show less" : "Show more";
      return;
    }
    const fileButton = event.target.closest("[data-prepayment-file]");
    const data = state.prepaymentsData;
    if (!fileButton || !data || data.bookingId !== String(state.selectedBookingId)) return;
    const documentField = { proforma: "Proforma_Attached", invoice: "Invoice_Attached", proof: "Payment_Proof" }[fileButton.dataset.prepaymentFile];
    const requestDocument = documentField !== "Payment_Proof";
    const record = (requestDocument ? data.requests : data.payments).find(item => String(item.id) === fileButton.dataset.recordId);
    const file = record?.[documentField]?.[Number(fileButton.dataset.fileIndex)];
    if (file) void previewPaymentAttachment(file);
  });
  document.getElementById("refresh-prepayments").addEventListener("click", () => ensurePrepaymentsLoaded(elements, state, true));
  elements.serviceActionPrepayment.addEventListener("click", () => {
    if (state.selectedService?.id) openPrepaymentForm(elements, state, onSaved, state.selectedService);
  });
  elements.bulkRequestPrepayment?.addEventListener("click", () => {
    const selected = (state.services || []).filter(service => state.selectedServiceIds?.[service.id]);
    openPrepaymentForm(elements, state, onSaved, selected);
  });
}

const serviceSupplierId = service => (idOf(service.Supplier) || String(service.Supplier_Id || "")).trim();

function showMissingPrepaymentSupplier(message) {
  if (document.getElementById("prepayment-supplier-required")) return;
  const previousFocus = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.id = "prepayment-supplier-required";
  dialog.className = "booking-prepayment-details";
  dialog.setAttribute("role", "alertdialog");
  dialog.setAttribute("aria-labelledby", "prepayment-supplier-required-title");
  dialog.setAttribute("aria-describedby", "prepayment-supplier-required-message");
  dialog.innerHTML = '<header><h3 id="prepayment-supplier-required-title">Supplier required</h3></header><p id="prepayment-supplier-required-message">' + escapeHtml(message) + '</p><footer><button type="button" class="button tertiary compact" data-close>Close</button></footer>';
  dialog.querySelector("[data-close]").onclick = () => dialog.close();
  dialog.addEventListener("close", () => { dialog.remove(); previousFocus?.focus(); }, { once: true });
  document.body.appendChild(dialog);
  dialog.showModal();
}

export function validatePrepaymentServices(services, bookingId, supplierId) {
  if (!services.length) throw new Error("Select at least one service to include in the request.");
  for (const service of services) {
    if (!service.id) throw new Error("A selected service has no CRM ID. Refresh the booking and try again.");
    if (!serviceSupplierId(service)) throw Object.assign(new Error("Cannot request prepayments: the service \"" + (service.Product_Description || service.Name || service.id) + "\" has no linked supplier. Assign a supplier to the service before requesting a prepayment."), { code: "MISSING_SUPPLIER" });
    if (serviceSupplierId(service) !== supplierId) throw new Error("Select services from the same supplier to request a prepayment.");
    if (idOf(service.Booking) && idOf(service.Booking) !== bookingId) throw new Error("All services must belong to the same booking.");
  }
}

async function readPrepaymentServices(services, bookingId, supplierId) {
  const fresh = [];
  for (const service of services) {
    const record = await crmGetRecord(MODULES.bookingServices, service.id);
    if (!record?.id || idOf(record.Booking) !== bookingId) throw new Error("Could not verify the selected service and its booking. Refresh and try again.");
    fresh.push(record);
  }
  validatePrepaymentServices(fresh, bookingId, supplierId);
  return fresh;
}

export async function linkPrepaymentServices(services, bookingId, supplierId, requestId, onLinked, createLink = crmCreateRecord) {
  const fresh = await readPrepaymentServices(services, bookingId, supplierId);
  const serviceFields = await crmGetFields(MODULES.bookingServices);
  const statusField = serviceFields.find(field => field.api_name === "Payment_Status");
  const existing = await searchAll(requestServicesModule, "(Prepayment_Request:equals:" + escapeCriteriaValue(requestId) + ")");
  for (const service of fresh) {
    const key = requestId + "-" + service.id;
    let link = existing.find(item => idOf(item.Booking_Service) === String(service.id) && idOf(item.Prepayment_Request) === requestId);
    if (!link) {
      const attempt = associationAttempts.get(key);
      if (attempt && !attempt.id) throw new Error("The previous service association was not confirmed. Check CRM before retrying.");
      if (attempt) link = await crmGetRecord(requestServicesModule, attempt.id);
      else {
        associationAttempts.set(key, {});
        const result = await createLink(requestServicesModule, { Name: key, Prepayment_Request: { id: requestId }, Booking_Service: { id: String(service.id) } });
        const linkId = String(result?.details?.id || "");
        if (!linkId) throw new Error("CRM did not return the service association ID. Check CRM before retrying.");
        associationAttempts.set(key, { id: linkId });
        link = await crmGetRecord(requestServicesModule, linkId);
      }
    }
    if (!link?.id || idOf(link.Booking_Service) !== String(service.id) || idOf(link.Prepayment_Request) !== requestId) throw new Error("CRM did not confirm the service association. Retry to continue.");
    // A new request must not leave a previously paid service marked fully paid.
    const previousStatus = String(service.Payment_Status || "").toLowerCase();
    const desired = ["paid", "fully paid", "partially paid"].includes(previousStatus) ? "partially paid" : "prepayment requested";
    const status = statusField?.pick_list_values?.find(option => String(option.actual_value).toLowerCase() === desired)?.actual_value;
    if (!status) throw new Error("Payment_Status needs the CRM value " + desired + ".");
    if (service.Payment_Status !== status) {
      const result = await crmUpdateRecord(MODULES.bookingServices, { id: service.id, Payment_Status: status });
      if (String(result?.code).toUpperCase() !== "SUCCESS" || String(result?.status).toLowerCase() === "error") throw new Error(result?.message || "Could not update the service payment status.");
      const saved = await crmGetRecord(MODULES.bookingServices, service.id);
      if (saved?.Payment_Status !== status) throw new Error("CRM did not confirm the service payment status. Retry to continue.");
    }
    onLinked({ ...service, Payment_Status: status }, link);
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
  return '<div class="field prepayment-attachment" data-attachment="' + name + '"><span>' + label.replace(/\*/g, '<em>*</em>') + '</span><input aria-label="' + label + '" name="' + name + '" type="file" multiple class="card-transaction-file-input"><button class="card-transaction-dropzone" type="button" data-upload><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L8 8m4-4 4 4M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/></svg><span>Upload files</span><small>or drag files here</small></button><div class="card-transaction-file-list" data-file-list hidden></div></div>';
}

export function canManagePrepaymentRequester(state) {
  return getWidgetPermissions(state).managePrepaymentRequester;
}

export function isPrepaymentTimeRestricted(state, dueDates, now = new Date()) {
  if (canManagePrepaymentRequester(state)) return false;
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", hourCycle: "h23" }).format(now));
  if (hour < 14) return false;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = type => parts.find(part => part.type === type).value;
  const today = value("year") + "-" + value("month") + "-" + value("day");
  return dueDates.some(date => date === today);
}

async function executePrepaymentCreation(state, operation) {
  const isCurrent = () => String(state.selectedBookingId) === operation.bookingId;
  const validatePayment = async payment => {
    if (!isCurrent()) throw new Error("Booking changed. Reopen recovery on the original booking.");
    const error = prepaymentDateError(state, payment.payload.Due_Date, payment.payload.When_To_Be_Paid !== "Specific Date");
    if (error) throw new Error(error);
    if (payment.referenceService && payment.payload.When_To_Be_Paid !== "Specific Date") {
      const service = await crmGetRecord(MODULES.bookingServices, payment.referenceService);
      if (service.Service_Date !== payment.referenceDate) throw new Error("A reference service date changed. Review the pending due date in recovery before continuing.");
    }
  };
  return runPrepaymentCreation(state, operation, {
    assertCurrent: () => { if (!isCurrent()) throw new Error("Booking changed. Reopen recovery on the original booking."); },
    create: crmCreateRecord,
    preflight: async () => {
      if (!isCurrent()) throw new Error("Booking changed. Reopen recovery on the original booking.");
      await readPrepaymentServices(operation.serviceIds.map(id => ({ id })), operation.bookingId, operation.supplierId);
      await requireSupplierPaymentReference(operation.supplierId);
      for (let index = 0; index < operation.payments.length; index++) if (!operation.slots["payment " + index]) await validatePayment(operation.payments[index]);
      await requirePaymentSettlement(operation.bookingId, operation.supplierId, operation.serviceIds.map(id => ({ id })));
      if (!isCurrent()) throw new Error("Booking changed. Reopen recovery on the original booking.");
    },
    checkRequest: async requestId => {
      const request = await crmGetRecord(MODULES.prepaymentRequests, requestId);
      if (!operation.newRequest && (!Array.isArray(request.Proforma_Attached) || !request.Proforma_Attached.length)) throw new Error("Proforma Attached requires at least one file. Attach it to the existing request before continuing.");
      if (idOf(request.Booking) !== operation.bookingId || idOf(request.Supplier) !== operation.supplierId || Number(request.Amount) !== operation.requestAmount || ["Cancelled", "Discarded", "Fully Paid"].includes(request.Status)) throw new Error("The request changed or cannot receive prepayments. Review it in CRM.");
      const existing = await searchAll(MODULES.prepayments, "(Prepayment_Request:equals:" + escapeCriteriaValue(requestId) + ")");
      for (const [slot, attempt] of Object.entries(operation.slots)) {
        if (slot.startsWith("payment ") && attempt.id && !existing.some(item => String(item.id) === attempt.id)) existing.push(await crmGetRecord(MODULES.prepayments, attempt.id));
      }
      if (existing.some(item => !item?.id || idOf(item.Prepayment_Request) !== requestId)) throw new Error("Could not verify existing prepayments. No new payments were created.");
      const allocated = existing.filter(item => item.Accounting_Status !== "Cancelled").reduce((sum, item) => sum + Math.round(Number(item.Amount) * 100), 0);
      const remaining = operation.payments.reduce((sum, payment, index) => sum + (operation.slots["payment " + index] ? 0 : Math.round(Number(payment.payload.Amount) * 100)), 0);
      if (!Number.isFinite(allocated) || allocated + remaining !== Math.round(operation.requestAmount * 100)) throw new Error("The request allocation changed. Review existing and pending prepayments in CRM before continuing.");
      if (canManagePrepaymentRequester(state) && request.Requested_By_2 !== operation.requesterEmail) {
        if (!isCurrent()) throw new Error("Booking changed. Reopen recovery on the original booking.");
        const result = await crmUpdateRecord(MODULES.prepaymentRequests, { id: requestId, Requested_By_2: operation.requesterEmail });
        if (String(result?.code).toUpperCase() !== "SUCCESS") throw new Error(result?.message || "Could not confirm Requested By.");
        request.Requested_By_2 = operation.requesterEmail;
      }
      rememberCreatedPrepayment(state, operation.bookingId, "requests", request);
    },
    saveDocuments: (requestId, documents, saveState, onPendingChange) => savePrepaymentProforma(requestId, documents, "Proforma_Attached", { saveState, onPendingChange }),
    linkServices: (requestId, plan, createOnce) => linkPrepaymentServices(plan.serviceIds.map(id => ({ id })), plan.bookingId, plan.supplierId, requestId, saved => {
      plan.confirmedServices ||= {};
      plan.confirmedServices[String(saved.id)] = true;
      savePrepaymentCreation(state, plan);
      if (isCurrent()) (state.services || []).forEach(service => { if (String(service.id) === String(saved.id)) service.Payment_Status = saved.Payment_Status; });
    }, async (module, payload) => ({ details: { id: await createOnce(module, payload) } })),
    validatePayment,
    checkPayment: async (paymentId, payload) => {
      const saved = await crmGetRecord(MODULES.prepayments, paymentId);
      if (idOf(saved.Prepayment_Request) !== operation.requestId || Number(saved.Amount) !== payload.Amount || saved.Due_Date !== payload.Due_Date || saved.Accounting_Status === "Cancelled") throw new Error("The saved prepayment could not be verified or changed in CRM. No creation will be repeated.");
      rememberCreatedPrepayment(state, operation.bookingId, "payments", saved);
    }
  });
}

function openPrepaymentRecovery(elements, state, operation, onSaved) {
  if (document.getElementById("prepayment-recovery-dialog")) return;
  const previousFocus = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.id = "prepayment-recovery-dialog";
  dialog.className = "booking-prepayment-details prepayment-recovery-dialog";
  dialog.setAttribute("aria-labelledby", "prepayment-recovery-title");
  dialog.setAttribute("aria-describedby", "prepayment-recovery-description");
  dialog.innerHTML = '<header><h3 id="prepayment-recovery-title">Finish saving prepayments</h3><span class="prepayment-recovery-badge">Pending</span></header><p id="prepayment-recovery-description">Continue where you left off. Saved records will not be duplicated.</p><div class="prepayment-recovery-payments">' +
    operation.payments.map((payment, index) => '<section class="prepayment-recovery-payment"><div class="prepayment-recovery-payment-heading"><span>' + text(payment.payload.Name) + '</span><strong>' + text(new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" }).format(Number(payment.payload.Amount))) + '</strong></div><label class="field"><span>Payment date' + (operation.slots["payment " + index] ? ' ? Locked' : '') + '</span><input type="date" required data-payment="' + index + '" value="' + escapeHtml(payment.payload.Due_Date) + '"' + (operation.slots["payment " + index] ? ' disabled' : '') + '></label></section>').join("") +
    '</div><p class="prepayment-recovery-hint">You can change pending dates. Amounts stay the same.</p><p class="prepayment-recovery-warning" data-review hidden>Some records could not be confirmed. Check CRM before continuing.</p><details class="prepayment-recovery-details"><summary>Save details</summary><p data-summary></p><small>Edited dates use Specific Date.</small></details><p role="status" data-status></p><footer><span class="prepayment-recovery-close-note">Closing keeps your progress.</span><button type="button" class="button tertiary" data-close>Close</button><button type="button" class="button tertiary" data-discard>Discard unsent plan</button><button type="button" class="button primary" data-resume>Continue saving</button></footer>';
  const summary = dialog.querySelector('[data-summary]');
  const updateSummary = () => {
    summary.textContent = prepaymentCreationSummary(operation);
    dialog.querySelector('[data-review]').hidden = !Object.values(operation.slots || {}).some(attempt => !attempt.id) && !operation.documentState?.pending;
  };
  updateSummary();
  let busy = false;
  const updateDiscard = () => { dialog.querySelector('[data-discard]').hidden = prepaymentCreationDisposition(operation) !== "draft"; };
  updateDiscard();
  dialog.querySelector('[data-discard]').onclick = () => {
    if (busy) return;
    try {
      discardUnsentPrepaymentCreation(state, operation);
      dialog.close();
      showFeedback("Unsent prepayment plan discarded. Existing CRM records were kept.", "success");
    } catch (error) { dialog.querySelector('[data-status]').textContent = error.message; updateDiscard(); }
  };
  dialog.querySelector('[data-close]').onclick = () => { if (!busy) dialog.close(); };
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    const disposition = prepaymentCreationDisposition(operation);
    if (disposition === "recorded") showFeedback("Created CRM records are already submitted. Their pending recovery has been kept; closing does not cancel them.", "info");
    if (disposition === "unknown") showFeedback("Creation is unconfirmed. Recovery has been kept. Check CRM before creating another request or payment.", "error");
    dialog.remove(); previousFocus?.focus();
  }, { once: true });
  dialog.querySelector('[data-resume]').onclick = async () => {
    if (busy) return;
    const dates = [...dialog.querySelectorAll('[data-payment]')];
    dates.forEach(input => { input.disabled = Boolean(operation.slots["payment " + input.dataset.payment]); });
    if (dates.some(input => !input.disabled && !input.reportValidity())) return;
    dates.forEach(input => {
      const payment = operation.payments[Number(input.dataset.payment)];
      if (!input.disabled && input.value !== payment.payload.Due_Date) { payment.payload.Due_Date = input.value; payment.payload.When_To_Be_Paid = "Specific Date"; }
    });
    busy = true;
    dialog.setAttribute("aria-busy", "true");
    dates.forEach(input => { input.disabled = true; });
    dialog.querySelectorAll('button').forEach(button => { button.disabled = true; });
    const status = dialog.querySelector('[data-status]');
    status.textContent = "Checking and resuming the previous save…";
    try {
      savePrepaymentCreation(state, operation);
      await executePrepaymentCreation(state, operation);
      finishPrepaymentCreation(state, operation);
      status.textContent = "Prepayments confirmed in CRM. No confirmed creation was repeated.";
      if (String(state.selectedBookingId) === operation.bookingId) {
        await ensurePrepaymentsLoaded(elements, state, true);
        onSaved?.();
      }
      dialog.querySelector('[data-resume]').hidden = true;
    } catch (error) { status.textContent = (operation.complete ? "Prepayments were saved, but refreshing failed. " : "The pending save is still protected. ") + error.message; }
    finally {
      busy = false;
      dialog.removeAttribute("aria-busy");
      dates.forEach(input => { input.disabled = Boolean(operation.slots["payment " + input.dataset.payment]); });
      dialog.querySelectorAll('button').forEach(button => { button.disabled = false; });
      updateDiscard();
      updateSummary();
    }
  };
  document.body.appendChild(dialog);
  dialog.showModal();
}

export async function openPrepaymentForm(elements, state, onSaved, service = state.selectedService) {
  const initialServices = Array.isArray(service) ? service : service ? [service] : [];
  service = initialServices[0];
  try { validatePrepaymentServices(initialServices, String(state.selectedBookingId || ""), service ? serviceSupplierId(service) : ""); }
  catch (error) {
    if (error.code === "MISSING_SUPPLIER") showMissingPrepaymentSupplier(error.message);
    else showFeedback(error.message, "error");
    return;
  }
  if (!state.selectedBookingId || !service || document.getElementById("new-prepayment-dialog")) return;
  const bookingId = String(state.selectedBookingId);
  const booking = state.selectedBooking || {};
  const supplierId = idOf(service.Supplier) || String(service.Supplier_Id || "");
  const supplierName = getServiceSupplierName(service);
  let supplierCode;
  try {
    supplierCode = await requireSupplierPaymentReference(supplierId);
  } catch (error) {
    showFeedback(error.message, "error");
    return;
  }
  if (String(state.selectedBookingId) !== bookingId || document.getElementById("new-prepayment-dialog")) return;
  try {
    const pending = pendingPrepaymentCreation(state, bookingId, supplierId);
    if (pending) { openPrepaymentRecovery(elements, state, pending, onSaved); return; }
  } catch (error) { showFeedback(error.message, "error"); return; }
  const reference = booking.MFSP_Reference || service.Booking_Reference || "";
  const requestedBy = state.currentUserEmail || "";
  const canEditRequester = canManagePrepaymentRequester(state);
  const candidates = [...new Map([...(state.services || []), ...initialServices].filter(item => serviceSupplierId(item) === supplierId && (!idOf(item.Booking) || idOf(item.Booking) === bookingId)).map(item => [String(item.id), item])).values()];
  const selectedServices = new Set(initialServices.map(item => String(item.id)));
  const includedServices = () => candidates.filter(item => selectedServices.has(String(item.id)));
  const selectedTotal = () => {
    const services = includedServices();
    if (!services.length || services.some(item => item.Total_Purchase_Price == null || item.Total_Purchase_Price === "" || !Number.isFinite(Number(item.Total_Purchase_Price)))) return "";
    return (services.reduce((total, item) => total + Math.round(Number(item.Total_Purchase_Price) * 100), 0) / 100).toFixed(2);
  };
  const defaultTotal = selectedTotal();
  const context = '<section class="prepayment-compact-context" aria-label="Booking and supplier"><div><strong>' + text(reference) + '</strong><span>' + text(booking.Deal_Name || booking.Name || bookingId) + '</span></div><div><strong>' + text(supplierName) + '</strong><small>' + text(supplierCode) + '</small></div></section>';
  const previousFocus = document.activeElement;
  const dialog = document.createElement("div");
  dialog.id = "new-prepayment-dialog";
  dialog.className = "booking-action-dialog";
  dialog.innerHTML = '<div class="booking-action-dialog-backdrop"></div><div class="booking-action-dialog-panel booking-action-dialog-panel--wide prepayment-request-dialog-panel" role="dialog" aria-modal="true" aria-labelledby="new-prepayment-title"><header class="prepayment-form-header"><h4 id="new-prepayment-title">New prepayment</h4><button type="button" class="button tertiary compact" aria-label="Close" data-dismiss>&times;</button></header><div class="prepayment-form-scroll">' + context + '<p data-feedback role="status" tabindex="-1">Loading requests&hellip;</p><form id="new-prepayment-form" hidden novalidate><fieldset class="prepayment-form-fields"><div class="prepayment-request-grid"><section class="prepayment-request-context" data-request-selector><label class="field"><span>Prepayment request</span><select name="request"></select></label>' + (canEditRequester ? field("Requested by *", "requestedBy", "email", 'required maxlength="100"') : '<label class="field"><span>Requested by</span><input type="email" value="' + escapeHtml(requestedBy) + '" readonly></label>') + '</section><section class="prepayment-services-section"><header><h5>Services</h5><span data-services-summary aria-live="polite"></span></header><div class="prepayment-service-options" data-service-options></div></section><section class="prepayment-request-details" data-new-request><h5>New request</h5><div class="prepayment-request-column">' + field("Request name *", "requestName", "text", 'required maxlength="120"') + '<label class="field"><span>Observations</span><textarea name="observations" rows="2"></textarea></label></div><div class="prepayment-request-column prepayment-request-documents">' + attachmentField("Proforma / invoices *", "proforma") + '</div></section><section class="prepayment-payment-section"><h5>Prepayments</h5><div class="prepayment-plan-controls">' + amountField("Total amount *", "requestAmount") + select("Transaction type", "transactionType", ["Full Payment", "Partial Payment"]) + '<div data-distribution hidden>' + select("Distribution", "distribution", ["Equal", "Manual"]) + '</div><button type="button" class="button tertiary compact" data-add-payment>+ Add prepayment</button></div><small data-payment-hint aria-live="polite"></small><div class="prepayment-entry-list" data-payment-rows></div></section></div></fieldset></form></div><footer class="prepayment-form-actions"><button type="button" class="button tertiary" data-close>Cancel</button><button type="submit" form="new-prepayment-form" class="button primary" disabled>Save prepayments</button></footer></div>';
  document.body.appendChild(dialog);
  const form = dialog.querySelector("form");
  const input = name => form.elements.namedItem(name);
  const feedback = dialog.querySelector("[data-feedback]");
  const reportError = message => {
    feedback.textContent = message;
    showFeedback(message, "error");
  };
  const dropdowns = [];
  const attachments = {};
  let uploadedProforma = null;
  let lockedRequestId = "";
  let serviceLinks = [];
  const updateServiceChoices = () => {
    const requestId = lockedRequestId || input("request").value;
    dialog.querySelector("[data-service-options]").innerHTML = candidates.map(item => {
      const linkedIds = serviceLinks.filter(link => idOf(link.Booking_Service) === String(item.id)).map(link => idOf(link.Prepayment_Request));
      const linkedHere = linkedIds.includes(requestId);
      if (linkedHere) selectedServices.add(String(item.id));
      return '<label class="prepayment-service-option"><input type="checkbox" data-prepayment-service="' + escapeHtml(item.id) + '"' + (selectedServices.has(String(item.id)) ? ' checked' : '') + (lockedRequestId || linkedHere ? ' disabled' : '') + '><span><strong>' + text(item.Product_Description || item.Name) + '</strong>' + (linkedHere ? '<small>Already in this request</small>' : linkedIds.length ? '<small>' + linkedIds.length + ' associated requests</small>' : '') + '</span><time>' + text(String(item.Service_Date || "").slice(0, 10)) + '</time><span>' + (item.Total_Purchase_Price == null ? '—' : text(money({ Amount: item.Total_Purchase_Price, Currency: "EUR" }))) + '</span></label>';
    }).join("");
    const selected = includedServices();
    dialog.querySelector("[data-services-summary]").textContent = selected.length + " selected" + (selectedTotal() ? " · " + selectedTotal() + " EUR" : "");
    const ordered = [...selected].sort((a, b) => String(a.Service_Date || "9999").localeCompare(String(b.Service_Date || "9999")));
    rows.forEach(row => {
      if (row.saved) return;
      const previous = row.input("referenceService").value;
      row.input("referenceService").innerHTML = ordered.map(item => '<option value="' + escapeHtml(item.id) + '">' + text(item.Product_Description || item.Name || item.id) + ' · ' + text(String(item.Service_Date || "").slice(0, 10) || "No service date") + '</option>').join("");
      row.input("referenceService").value = selectedServices.has(previous) ? previous : String(ordered[0]?.id || "");
      row.referenceChanged = previous && previous !== row.input("referenceService").value ? "Reference updated: the previous service is no longer selected." : "";
      row.referenceDropdown?.sync();
      row.updateDueDate();
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
    attachments[name] = [];
    const renderFiles = () => {
      list.hidden = !attachments[name].length;
      list.innerHTML = attachments[name].map((file, index) => '<span class="card-transaction-file"><span>' + text(file.name) + '</span><button type="button" data-remove-file="' + index + '" aria-label="Remove ' + escapeHtml(file.name) + '">&times;</button></span>').join("");
    };
    const addFiles = files => {
      if (saving || createdRequestId || input("request").value) return;
      attachments[name].push(...Array.from(files || []));
      picker.value = "";
      renderFiles();
    };
    list.addEventListener("click", event => {
      const button = event.target.closest("[data-remove-file]");
      if (!button || saving || createdRequestId || input("request").value) return;
      attachments[name].splice(Number(button.dataset.removeFile), 1);
      renderFiles();
    });
    dropzone.addEventListener("click", () => picker.click());
    picker.addEventListener("change", () => addFiles(picker.files));
    dropzone.addEventListener("dragover", event => { event.preventDefault(); if (!dropzone.disabled) dropzone.classList.add("is-dragging"); });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("is-dragging"));
    dropzone.addEventListener("drop", event => {
      event.preventDefault();
      dropzone.classList.remove("is-dragging");
      addFiles(event.dataTransfer.files);
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
    rows.forEach((row, index) => {
      row.element.querySelector("[data-payment-number]").textContent = "Payment " + (index + 1);
      row.element.querySelector("[data-remove]").disabled = rows.length === 1 || row.saved;
      row.input("amount").readOnly = !partial || equal;
      row.input("percent").readOnly = !partial || equal;
      if (((!partial && rows.length === 1) || (partial && !equal && row.autoAmount && rows.length === 1 && allocatedBefore() === 0)) && !row.saved) row.input("amount").value = total > 0 ? (total / 100).toFixed(2) : "";
      if (!row.saved && row !== percentSource) row.input("percent").value = total > 0 && row.input("amount").value !== "" ? (cents(row.input("amount").value) / total * 100).toFixed(2) : "";
    });
    const allocated = allocatedBefore() + rows.reduce((sum, row) => sum + cents(row.input("amount").value), 0);
    dialog.querySelector("[data-payment-hint]").textContent = !partial && rows.length > 1 ? "Full Payment allows one prepayment. Remove extra lines or select Partial Payment." : total > 0 ? "Allocated: " + money({ Amount: allocated / 100 }) + " / " + money({ Amount: total / 100 }) + ". Remaining: " + money({ Amount: (total - allocated) / 100 }) : "Enter the total amount in EUR, then distribute it across the prepayments.";
  };
  const addRow = () => {
    const index = ++nextRow;
    const element = document.createElement("article");
    element.className = "prepayment-entry";
    element.innerHTML = '<header><strong data-payment-number>Payment ' + index + '</strong><details class="prepayment-reference-name"><summary><span data-payment-reference></span> <span class="prepayment-edit-reference">Edit</span></summary>' + field("Payment reference", "paymentName" + index, "text", 'required maxlength="120"') + '</details><button type="button" class="button tertiary compact" data-remove aria-label="Remove payment" title="Remove payment"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg></button></header><div class="prepayment-entry-fields">' + amountField("Amount *", "amount" + index) + field("Percent", "percent" + index, "number", 'min="0" max="100" step="0.01"') + select("Payment timing", "timing" + index, timingOptions) + '<div class="prepayment-due-field">' + field("Due date *", "dueDate" + index, "date", 'required aria-describedby="due-help-' + index + ' due-error-' + index + '"') + '<details class="prepayment-date-help"><summary aria-label="Due date rules">Date rules</summary><small id="due-help-' + index + '">Monday–Friday. After 14:00 Europe/Madrid, same-day payments require Administration. Automatic dates cannot be in the past.</small></details><small class="prepayment-date-error" id="due-error-' + index + '" data-date-error aria-live="polite"></small></div></div><div class="prepayment-calculation" data-calculation hidden><div class="prepayment-reference-line"><strong>Reference service</strong><span data-reference-label></span><button type="button" class="button tertiary compact" data-change-reference>Change</button></div><div data-reference-picker hidden><select name="referenceService' + index + '" aria-label="Reference service"></select></div><small data-reference-change aria-live="polite"></small><small data-calculation-text></small><small data-adjustment></small><small class="prepayment-date-error" data-reference-error></small></div>';
    dialog.querySelector("[data-payment-rows]").appendChild(element);
    const row = { element, saved: false, autoAmount: index === 1, input: name => input(name + index) };
    rows.push(row);
    row.input("timing").value = "Specific Date";
    const timingDropdown = syncServiceStatusDropdown(row.input("timing"), { enhance: true, plain: true, multiline: true, label: "Payment timing" });
    row.referenceDropdown = syncServiceStatusDropdown(row.input("referenceService"), { enhance: true, plain: true, multiline: true, label: "Reference service" });
    row.dropdowns = [timingDropdown, row.referenceDropdown].filter(Boolean);
    dropdowns.push(...row.dropdowns);
    element.querySelector("[data-change-reference]").addEventListener("click", () => {
      element.querySelector("[data-reference-picker]").hidden = false;
      row.referenceDropdown?.open();
    });
    row.validateDate = () => {
      const due = row.input("dueDate");
      const automatic = row.input("timing").value !== "Specific Date";
      const message = row.referenceError || prepaymentDateError(state, due.value, automatic);
      due.setCustomValidity(message);
      element.querySelector("[data-date-error]").textContent = message;
      return message;
    };
    row.updateDueDate = () => {
      if (row.saved) return;
      const referenceService = includedServices().find(item => String(item.id) === row.input("referenceService").value);
      const timing = row.input("timing").value;
      const automatic = timing !== "Specific Date";
      element.querySelector("[data-calculation]").hidden = !automatic;
      row.input("dueDate").readOnly = automatic;
      element.querySelector("[data-change-reference]").hidden = includedServices().length <= 1;
      if (!automatic || includedServices().length <= 1) element.querySelector("[data-reference-picker]").hidden = true;
      element.querySelector("[data-reference-label]").textContent = referenceService ? (referenceService.Product_Description || referenceService.Name || referenceService.id) + " · " + (prepaymentDayLabel(referenceService.Service_Date) || "No service date") : "No reference service selected";
      element.querySelector("[data-reference-change]").textContent = row.referenceChanged || "";
      row.referenceError = "";
      if (automatic) {
        const calculation = prepaymentDateCalculation(timing, referenceService?.Service_Date);
        row.calculation = calculation;
        row.input("dueDate").value = calculation.final || "";
        row.referenceError = calculation.final ? "" : "This service has no valid service date. Choose another reference or Specific Date.";
        const days = Number(timing.match(/\d+/)?.[0]);
        element.querySelector("[data-calculation-text]").textContent = calculation.original ? prepaymentDayLabel(referenceService.Service_Date) + (timing.startsWith("Within") ? " + " : " − ") + days + " days → " + prepaymentDayLabel(calculation.original) : "";
        element.querySelector("[data-adjustment]").textContent = calculation.adjusted ? "Adjusted to " + prepaymentDayLabel(calculation.final) + ": calculated date " + prepaymentDayLabel(calculation.original) + " falls on a weekend." : "";
      }
      element.querySelector("[data-reference-error]").textContent = row.referenceError;
      if (row.input("dueDate").value || automatic) row.validateDate();
    };
    row.input("timing").addEventListener("change", row.updateDueDate);
    row.input("referenceService").addEventListener("change", () => {
      row.referenceChanged = "";
      row.updateDueDate();
      element.querySelector("[data-reference-picker]").hidden = true;
      element.querySelector("[data-change-reference]").focus();
    });
    const validateDueDate = () => {
      if (row.input("timing").value === "Specific Date" && isWeekendDueDate(row.input("dueDate").value)) {
        row.input("dueDate").value = "";
        row.input("dueDate").setCustomValidity(weekendDueDateMessage);
        element.querySelector("[data-date-error]").textContent = weekendDueDateMessage;
        return;
      }
      row.validateDate();
    };
    row.input("dueDate").addEventListener("input", validateDueDate);
    row.input("dueDate").addEventListener("change", validateDueDate);
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
    const updateReferenceName = () => { element.querySelector("[data-payment-reference]").textContent = row.input("paymentName").value || "Payment reference"; };
    row.input("paymentName").addEventListener("input", updateReferenceName);
    updateReferenceName();
    element.querySelector("[data-remove]").addEventListener("click", () => {
      if (saving || row.saved || rows.length === 1) return;
      rows.splice(rows.indexOf(row), 1);
      row.dropdowns.forEach(control => control.destroy());
      element.remove();
      updateRows();
    });
    updateRows();
    updateServiceChoices();
    return row;
  };
  addButton.addEventListener("click", () => { if (!saving && transactionType() === "Partial Payment") addRow().input("amount").focus(); });

  let saving = false;
  let createdRequestId = "";
  const close = (options = {}) => {
    if (saving) return;
    try {
      const pending = pendingPrepaymentCreation(state, bookingId, supplierId);
      const disposition = prepaymentCreationDisposition(pending);
      if (!options.preserve && pending && disposition === "draft") discardUnsentPrepaymentCreation(state, pending);
      if (!options.quiet) {
        if (disposition === "draft") showFeedback("Unsent prepayment draft discarded. Existing CRM records were kept.", "info");
        if (disposition === "recorded") showFeedback("Created CRM records are already submitted. Closing keeps their pending recovery.", "info");
        if (disposition === "unknown") showFeedback("Creation is unconfirmed. Closing keeps recovery; check CRM before creating another request or payment.", "error");
      }
    } catch (error) { reportError(error.message); return; }
    dropdowns.forEach(control => control.destroy()); dialog.remove(); previousFocus?.focus();
  };
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
  try {
    for (const candidate of candidates) {
      serviceLinks.push(...await searchAll(requestServicesModule, "(Booking_Service:equals:" + escapeCriteriaValue(candidate.id) + ")"));
    }
  } catch (error) { reportError("Could not load service associations. " + error.message); return; }
  if (!dialog.isConnected || String(state.selectedBookingId) !== bookingId) return;
  form.hidden = false;
  dialog.querySelector('[type="submit"]').disabled = false;
  feedback.textContent = supplierId ? "" : "This service has no linked supplier. Add a supplier to the service before creating a prepayment.";
  const requests = data.requests.filter(request => supplierId && idOf(request.Supplier) === supplierId && (!request.Currency || request.Currency === "EUR") && !["Cancelled", "Discarded", "Fully Paid"].includes(request.Status));
  dialog.querySelector("[data-request-selector]").hidden = false;
  input("request").innerHTML = '<option value="">Create new request</option>' + requests.map(request => '<option value="' + escapeHtml(request.id) + '">' + text(request.Name) + ' · ' + text(getLookupName(request.Supplier)) + '</option>').join("");
  input("request").value = "";
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
    if (canEditRequester) input("requestedBy").value = request ? String(request.Requested_By_2 || "") : requestedBy;
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
    if (saving) return;
    try {
      const pending = pendingPrepaymentCreation(state, bookingId, supplierId);
      if (pending) { close({ preserve: true, quiet: true }); openPrepaymentRecovery(elements, state, pending, onSaved); return; }
    } catch (error) { reportError(error.message); return; }
    try { validatePrepaymentServices(includedServices(), bookingId, supplierId); }
    catch (error) {
      if (error.code === "MISSING_SUPPLIER") showMissingPrepaymentSupplier(error.message);
      else reportError(error.message);
      return;
    }
    rows.forEach(row => row.updateDueDate());
    const dateError = rows.map(row => row.validateDate()).find(Boolean);
    if (dateError) { reportError(dateError); return; }
    if (isPrepaymentTimeRestricted(state, rows.map(row => row.input("dueDate").value))) {
      reportError("A partir de las 14:00 (hora de Madrid) no puedes registrar prepagos con fecha de hoy. Cambia la fecha de esos prepagos a un d\u00eda posterior. En caso de urgencia, contacta directamente con Administraci\u00f3n.");
      return;
    }
    if (transactionType() === "Full Payment" && rows.length > 1) {
      reportError("Full Payment requires a single prepayment. Remove extra prepayments or select Partial Payment.");
      return;
    }
    updateRows();
    if (rows.some(row => !row.saved && isWeekendDueDate(row.input("dueDate").value))) {
      reportError(weekendDueDateMessage);
      return;
    }
    if (!form.reportValidity()) { reportError("Complete all required fields and check the amounts and dates before saving."); return; }
    if (String(state.selectedBookingId) !== bookingId) { reportError("Booking changed. Close and reopen the form."); return; }
    if (rows.some(row => !row.input("paymentName").value.trim()) || (!input("request").value && !createdRequestId && !input("requestName").value.trim())) { reportError("Enter a name for the request and prepayment."); return; }
    if (!supplierId) { reportError("Add a supplier to this service before creating a prepayment."); return; }
    if (canEditRequester && !canManagePrepaymentRequester(state)) { reportError("Your requester permissions changed. Close and reopen this form before saving."); return; }
    const requesterEmail = canEditRequester ? input("requestedBy").value.trim() : requestedBy;
    if (canEditRequester && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requesterEmail)) { reportError("Enter a valid email in Requested By."); return; }
    const total = cents(input("requestAmount").value);
    if (!Number.isFinite(total) || total <= 0) { reportError("Enter a total amount greater than zero in EUR. Existing requests must have their Amount set before adding prepayments."); return; }
    if (rows.some(row => !Number.isFinite(Number(row.input("amount").value)) || cents(row.input("amount").value) <= 0)) { reportError("Each prepayment must have an amount greater than zero in EUR."); return; }
    if (transactionType() !== "Partial Payment" && previousPayments().length) { reportError("This Full Payment request already has a prepayment."); return; }
    const allocated = allocatedBefore() + rows.reduce((sum, row) => sum + cents(row.input("amount").value), 0);
    if (allocated !== total) { reportError("Prepayments must add up to the total amount of " + (total / 100).toFixed(2) + " EUR."); return; }
    if (!createdRequestId && !input("request").value && !attachments.proforma?.length) {
      reportError("Attach at least one proforma or invoice document before saving.");
      return;
    }
    saving = true;
    form.querySelector("fieldset").disabled = true;
    dialog.querySelector('[type="submit"]').disabled = true;
    feedback.textContent = "Saving prepayment…";
    try {
      const freshServices = await readPrepaymentServices(includedServices(), bookingId, supplierId);
      let referenceDatesChanged = false;
      for (const fresh of freshServices) {
        const candidate = candidates.find(item => String(item.id) === String(fresh.id));
        if (!candidate || !Object.prototype.hasOwnProperty.call(fresh, "Service_Date") || fresh.Service_Date === candidate.Service_Date) continue;
        if (rows.some(row => !row.saved && row.input("timing").value !== "Specific Date" && row.input("referenceService").value === String(fresh.id))) referenceDatesChanged = true;
        candidate.Service_Date = fresh.Service_Date;
      }
      if (referenceDatesChanged) {
        updateServiceChoices();
        throw new Error("A reference service date changed in CRM. Due dates have been recalculated. Review them and save again.");
      }
      supplierCode = await requireSupplierPaymentReference(supplierId);
      await requirePaymentSettlement(bookingId, supplierId, includedServices());
      const finalDateError = rows.map(row => row.validateDate()).find(Boolean);
      if (finalDateError) throw new Error(finalDateError);
      if (isPrepaymentTimeRestricted(state, rows.map(row => row.input("dueDate").value))) throw new Error("La espera ha superado las 14:00 (hora de Madrid). Revisa las fechas de los prepagos antes de continuar.");
      if (String(state.selectedBookingId) !== bookingId) throw new Error("Booking changed. Close and reopen the form.");
      const existingRequestId = input("request").value;
      const requestPayload = existingRequestId ? null : { Name: input("requestName").value.trim(), Booking: { id: bookingId }, Supplier: { id: supplierId }, Status: "To Be Paid", Currency: "EUR", Amount: total / 100, Transaction_Type: input("transactionType").value, Requested_Date: new Date().toISOString().slice(0, 19) + "+00:00", Requested_By_2: requesterEmail, MFSP_Reference: reference, Supplier_Code: supplierCode, Observations: input("observations").value };
      uploadedProforma = [];
      if (!existingRequestId) for (const file of attachments.proforma) uploadedProforma.push(...await uploadFile(file));
      const operation = beginPrepaymentCreation(state, {
        bookingId, supplierId, serviceIds: includedServices().map(service => String(service.id)),
        newRequest: !existingRequestId, requestId: existingRequestId, requestPayload,
        requestAmount: total / 100, requesterEmail, documents: uploadedProforma,
        payments: rows.map(row => {
          const value = name => row.input(name).value;
          const payload = { Name: value("paymentName").trim(), Amount: Number(value("amount")), Currency: "EUR", When_To_Be_Paid: value("timing"), Due_Date: value("dueDate"), Accounting_Status: "Pending invoice" };
          if (value("percent") !== "") payload.Percent = Number(value("percent"));
          const referenceService = value("referenceService");
          return { payload, referenceService, referenceDate: candidates.find(service => String(service.id) === referenceService)?.Service_Date || "" };
        })
      });
      await executePrepaymentCreation(state, operation);
      createdRequestId = operation.requestId;
      finishPrepaymentCreation(state, operation);
      saving = false;
      close({ quiet: true });
      data.loaded = true;
      if (state.prepaymentsData === data) renderPrepayments(elements, state);
      if (onSaved && String(state.selectedBookingId) === bookingId) onSaved();
      if (String(state.selectedBookingId) === bookingId) await ensurePrepaymentsLoaded(elements, state, true);
    } catch (error) {
      if (error.code === "MISSING_SUPPLIER") showMissingPrepaymentSupplier(error.message);
      let pending;
      try { pending = pendingPrepaymentCreation(state, bookingId, supplierId); } catch (_) { /* Preserve the original error. */ }
      if (pending) {
        createdRequestId = pending.requestId || pending.slots.request?.id || "";
        data.loaded = false;
      }
      reportError((pending ? prepaymentCreationSummary(pending) + " Close and reopen this form to review recovery. " : "") + (error.message || "Could not save prepayment."));
      if (createdRequestId) {
        input("request").disabled = true;
        dialog.querySelectorAll("[data-new-request] input, [data-new-request] select, [data-new-request] textarea, [data-new-request] button").forEach(node => { node.disabled = true; });
      }
    } finally { saving = false; form.querySelector("fieldset").disabled = false; dialog.querySelector('[type="submit"]').disabled = false; }
  });
}

export async function uploadFile(file) {
  if (!file) throw new Error("Attach a proforma or invoice document before saving.");
  const response = await window.ZOHO.CRM.API.uploadFile({ CONTENT_TYPE: "multipart", PARTS: [{ headers: { "Content-Disposition": "file;" }, content: "__FILE__" }], FILE: { fileParam: "content", file } });
  const result = (Array.isArray(response) ? response : response?.data || [])[0];
  if (!result?.details?.id || String(result.status || result.code || "").toLowerCase() === "error") throw new Error(result?.message || "Could not upload " + file.name);
  return [{ File_Id__s: result.details.id, file: { name: file.name, size: file.size } }];
}

export async function savePrepaymentProforma(requestId, documents, field = "Proforma_Attached", options = {}) {
  if (!["Proforma_Attached", "Invoice_Attached"].includes(field)) throw new Error("Invalid request document field.");
  // Keep uncertain writes across retries, including the creation form's array.
  const saveState = options.saveState || (documents.saveState ||= {});
  const verify = async attempt => {
    const request = await requestCrmAttachmentsV8(MODULES.prepaymentRequests, requestId, field);
    if (!request || !Object.prototype.hasOwnProperty.call(request, field)) {
      throw new Error("CRM did not return " + field + " for request " + requestId + ". Check this user's read access to Prepayment_Requests and this field before retrying.");
    }
    const files = request?.[field];
    if (!Array.isArray(files)) return null;
    const attachmentId = file => String(file.attachment_Id || file.id || "");
    const used = new Set();
    const unmatched = [];
    attempt.fileIds.forEach((id, documentIndex) => {
      const index = files.findIndex((file, index) => !used.has(index) &&
        [file.File_Id__s, file.File_Id, file.file_Id, file.file_id, file.$file_id, file.id].some(value => value != null && String(value) === String(id)));
      if (index < 0) unmatched.push(attempt.documents[documentIndex]);
      else used.add(index);
    });
    // v8 can return a different encrypted file ID. Match only newly created
    // attachment links with a unique exact name and byte size.
    const added = unmatched.every(document => {
      const metadata = document?.file;
      if (!metadata?.name || !Number.isFinite(metadata.size) || metadata.size <= 0) return false;
      if (unmatched.filter(other => other?.file?.name === metadata.name && other?.file?.size === metadata.size).length !== 1) return false;
      const matches = files.map((file, index) => ({ file, index })).filter(({ file, index }) =>
        !used.has(index) && attachmentId(file) && !attempt.beforeIds.includes(attachmentId(file)) &&
        (file.File_Name__s || file.file_Name || file.File_Name || file.file_name) === metadata.name &&
        Number(file.Size__s ?? file.original_Size_Byte ?? file.File_Size__s) === metadata.size);
      if (matches.length !== 1) return false;
      used.add(matches[0].index);
      return true;
    });
    return added && attempt.retained.every(id => files.some(file => attachmentId(file) === id)) &&
      !files.some(file => attempt.removals.includes(attachmentId(file))) ? files : null;
  };
  const verifyWithRetry = async attempt => {
    let files = await verify(attempt);
    for (const delay of [300, 800, 1500]) {
      if (files) break;
      await new Promise(resolve => setTimeout(resolve, delay));
      files = await verify(attempt);
    }
    return files;
  };
  if (saveState.pending) {
    const files = await verifyWithRetry(saveState.pending);
    if (!files) throw new Error("CRM did not confirm the previous document save. Close and reopen the form to check the saved documents before adding them again.");
    const sameOperation = saveState.pending.key === JSON.stringify([requestId, field, (documents || []).map(file => file.File_Id__s), options.removeIds || []]);
    if (!sameOperation) throw new Error("The previous documents were saved. Close and reopen the form before changing the document selection.");
    return files;
  }
  const fileIds = (documents || []).map(document => document.File_Id__s).filter(Boolean);
  const attachmentId = file => String(file.attachment_Id || file.id || "");
  const removals = options.removeIds || [];
  const retained = (options.existing || []).filter(file => !removals.includes(attachmentId(file)));
  const deletions = (options.existing || []).filter(file => removals.includes(attachmentId(file))).map(file => ({ attachment_id: attachmentId(file), _delete: null }));
  if (!fileIds.length && !deletions.length) throw new Error("The document upload did not return a file ID.");
  const before = await requestCrmAttachmentsV8(MODULES.prepaymentRequests, requestId, field);
  if (!before || !Object.prototype.hasOwnProperty.call(before, field)) {
    throw new Error("CRM did not return " + field + ". Check this user's read access before saving documents.");
  }
  if (before[field] != null && !Array.isArray(before[field])) throw new Error("CRM returned an unexpected document format.");
  const canonicalDeletions = deletions.map(item => ({ id: item.attachment_id, _delete: null }));
  const changes = [...fileIds.map(id => ({ File_Id__s: id })), ...canonicalDeletions];
  saveState.pending = {
    key: JSON.stringify([requestId, field, (documents || []).map(file => file.File_Id__s), removals]),
    fileIds, documents: documents.filter(document => document.File_Id__s).map(document => ({ file: document.file && { ...document.file } })),
    beforeIds: (before[field] || []).map(attachmentId),
    retained: retained.map(attachmentId), removals
  };
  options.onPendingChange?.();
  let result;
  try {
    result = await requestCrmAttachmentsV8(MODULES.prepaymentRequests, requestId, field, changes);
  } catch (error) {
    // An explicit rejection is safe to retry; an uncertain response is read-only.
    if (["INVALID_DATA", "NO_PERMISSION", "AUTHORIZATION_FAILED", "MANDATORY_NOT_FOUND"].includes(error.code)) { delete saveState.pending; options.onPendingChange?.(); }
    throw error;
  }
  if (String(result?.status || "").toLowerCase() === "error" ||
      (result?.code && String(result.code).toUpperCase() !== "SUCCESS")) {
    delete saveState.pending;
    options.onPendingChange?.();
    throw new Error("Could not save " + field + ": " + (result.message || "CRM rejected the update") +
      " [" + (result.code || "ERROR") + "]. Check this user's edit access to Prepayment_Requests and this field.");
  }
  const files = await verifyWithRetry(saveState.pending);
  if (files) return files;
  throw new Error("CRM did not confirm that the documents were attached. Retry to verify the previous save without uploading again.");
}
