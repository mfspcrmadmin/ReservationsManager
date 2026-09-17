import { crmGetRelatedRecords } from "./api.js";
import { MODULES } from "./constants.js";
import { ensurePrepaymentsLoaded, renderPrepayments } from "./prepayments-controller.js";
import { escapeHtml, formatCurrency, formatDateTime, getLookupName } from "./utils.js";

export function renderPaymentsWorkspace(elements, state) {
  const activeTab = state.activePaymentTab || "travelers";
  const tabs = { travelers: elements.paymentTabTravelers, refunds: elements.paymentTabRefunds, prepayments: elements.paymentTabPrepayments, cardPurchases: elements.paymentTabCardPurchases, renfe: elements.paymentTabRenfe };
  const panels = { travelers: elements.paymentTravelersPanel, refunds: elements.paymentRefundsPanel, prepayments: elements.paymentPrepaymentsPanel, cardPurchases: elements.paymentCardPurchasesPanel, renfe: elements.paymentRenfePanel };
  Object.keys(tabs).forEach(function (key) {
    if (tabs[key]) { const active = key === activeTab; tabs[key].classList.toggle("active", active); tabs[key].setAttribute("aria-selected", active ? "true" : "false"); }
    if (panels[key]) panels[key].hidden = key !== activeTab;
  });
  renderCardPurchases(elements, state);
  renderPrepayments(elements, state);
}

export async function setPaymentTab(elements, state, tabName) {
  state.activePaymentTab = tabName;
  renderPaymentsWorkspace(elements, state);
  if (tabName === "cardPurchases") await ensureCardPurchasesLoaded(elements, state);
  if (tabName === "prepayments") await ensurePrepaymentsLoaded(elements, state);
}

export async function refreshCardPurchases(elements, state) {
  if (state.cardPurchasesLoading || !state.selectedBookingId) return;
  resetCardPurchases(state);
  await ensureCardPurchasesLoaded(elements, state);
}

export async function ensureCardPurchasesLoaded(elements, state) {
  const bookingId = String(state.selectedBookingId || "").trim();
  if (!bookingId) { resetCardPurchases(state); renderCardPurchases(elements, state); return; }
  if (state.cardPurchasesLoading || (state.cardPurchasesLoaded && state.cardPurchasesLoadedBookingId === bookingId)) return;
  state.cardPurchasesLoading = true;
  state.cardPurchasesError = "";
  renderCardPurchases(elements, state);
  try {
    const records = await crmGetRelatedRecords(MODULES.bookings, bookingId, "Card_Purchases", { perPage: 200 });
    state.cardPurchases = records.sort(function (left, right) {
      return String(right.Transaction_Date || "").localeCompare(String(left.Transaction_Date || ""));
    });
    state.cardPurchasesLoaded = true;
    state.cardPurchasesLoadedBookingId = bookingId;
  } catch (error) {
    resetCardPurchases(state);
    state.cardPurchasesError = error && error.message ? error.message : "Could not load card transactions.";
  } finally {
    state.cardPurchasesLoading = false;
    renderCardPurchases(elements, state);
  }
}

function renderCardPurchases(elements, state) {
  if (!elements.cardPurchasesBody) return;
  if (elements.cardTransactionsTitle) {
    const countAvailable = state.selectedBookingId && state.cardPurchasesLoaded && state.cardPurchasesLoadedBookingId === String(state.selectedBookingId) && !state.cardPurchasesLoading && !state.cardPurchasesError;
    elements.cardTransactionsTitle.textContent = "Card Transactions" + (countAvailable ? " (" + state.cardPurchases.length + ")" : "");
  }
  if (elements.refreshCardPurchases) {
    elements.refreshCardPurchases.disabled = !state.selectedBookingId || state.cardPurchasesLoading;
    elements.refreshCardPurchases.classList.toggle("is-loading", state.cardPurchasesLoading);
  }
  if (state.cardPurchasesLoading) return renderMessage(elements, "Loading card transactions...");
  if (state.cardPurchasesError) return renderMessage(elements, state.cardPurchasesError);
  if (!state.cardPurchasesLoaded) return renderMessage(elements, "Open this tab to load card transactions for the selected booking.");
  if (!state.cardPurchases.length) return renderMessage(elements, "No card transactions found for this booking.");
  elements.cardPurchasesBody.innerHTML = state.cardPurchases.map(renderCardPurchaseRow).join("");
}

function renderCardPurchaseRow(record) {
  return "<tr>" +
    "<td><strong>" + escapeHtml(record.Name || "-") + "</strong></td>" +
    "<td>" + renderTransactionType(record.Transaction_Type) + "</td>" +
    "<td>" + renderStatus(record.Accounting_Status) + "</td>" +
    "<td>" + escapeHtml(formatCurrency(record.Amount)) + "</td>" +
    "<td>" + escapeHtml(formatDateTime(record.Transaction_Date)) + "</td>" +
    "<td>" + escapeHtml(getLookupName(record.Card_Payment_Account) || "-") + "</td>" +
    "<td>" + escapeHtml(getLookupName(record.Supplier) || "-") + "</td>" +
    "<td>" + escapeHtml(getLookupName(record.Boking_Service) || "-") + "</td>" +
    "<td>" + escapeHtml(getLookupName(record.Original_Card_Purchase) || "-") + "</td>" +
    "<td>" + escapeHtml(record.Transaction_Notes || "-") + "</td>" +
    "<td>" + renderAttachments(record) + "</td></tr>";
}

function renderMessage(elements, message) { elements.cardPurchasesBody.innerHTML = '<tr><td colspan="11" class="table-empty">' + escapeHtml(message) + "</td></tr>"; }
function renderStatus(value) { return renderBadge(value, String(value || "").toLowerCase().indexOf("refund") !== -1 ? "is-refund" : String(value || "").toLowerCase() === "paid" ? "is-paid" : "is-neutral"); }
function renderTransactionType(value) { const normal = String(value || "").toLowerCase(); return renderBadge(value, normal === "refund" ? "is-refund" : normal === "purchase" ? "is-paid" : "is-neutral"); }
function renderBadge(value, modifier) { return '<span class="card-purchase-status ' + modifier + '">' + escapeHtml(value || "-") + "</span>"; }

function renderAttachments(record) {
  const files = normalizeAttachments(record.Supporting_Documents);
  if (!files.length) return '<span class="card-purchase-file-empty">-</span>';
  return '<div class="card-purchase-files">' + files.map(function (file, index) {
    return '<button class="card-purchase-file" type="button" data-card-purchase-file data-record-id="' + escapeAttribute(record.id) + '" data-file-index="' + index + '" title="Preview ' + escapeAttribute(file.name) + '">' + escapeHtml(file.name) + "</button>";
  }).join("") + "</div>";
}

export async function previewCardPurchaseFile(state, recordId, fileIndex) {
  const record = state.cardPurchases.find(function (item) { return String(item.id) === String(recordId); });
  const file = record && normalizeAttachments(record.Supporting_Documents)[Number(fileIndex)];
  if (!file) return;
  const dialog = createPreviewDialog(file.name);
  document.body.appendChild(dialog.element);
  try { showFilePreview(dialog, file.url || await getFileSource(file), file); }
  catch (error) { dialog.content.innerHTML = '<p class="card-purchase-preview-error">The file preview could not be loaded.</p>'; }
}

function normalizeAttachments(value) {
  const rawFiles = Array.isArray(value) ? value : value ? [value] : [];
  return rawFiles.map(function (file) {
    if (typeof file === "string") return { name: file, id: "", url: "" };
    return {
      // Zoho may return `name: Attachment` as the field label; prefer the uploaded file name.
      name: file.File_Name || file.file_Name || file.file_name || file.filename || file.fileName || file.name || "Attachment",
      id: file.id || file.file_id || file.file_Id || file.File_Id || "",
      url: file.url || file.file_url || file.preview_url || file.download_url || "",
      type: file.type || file.mime_type || file.content_type || ""
    };
  });
}
function resetCardPurchases(state) { state.cardPurchases = []; state.cardPurchasesLoaded = false; state.cardPurchasesLoadedBookingId = ""; }
async function getFileSource(file) { if (!file.id || !window.ZOHO || !window.ZOHO.CRM || !window.ZOHO.CRM.API || !window.ZOHO.CRM.API.getFile) throw new Error("File is not available for preview."); return window.ZOHO.CRM.API.getFile({ id: file.id }); }
function createPreviewDialog(fileName) {
  const element = document.createElement("div"); let cleanup = function () {};
  element.className = "booking-action-dialog card-purchase-preview-dialog";
  element.innerHTML = '<div class="booking-action-dialog-backdrop"></div><div class="booking-action-dialog-panel booking-action-dialog-panel--wide card-purchase-preview-panel" role="dialog" aria-modal="true" aria-label="File preview"><div class="card-purchase-preview-heading"><h4>' + escapeHtml(fileName) + '</h4><button class="booking-action-dialog-dismiss" type="button" aria-label="Close preview">×</button></div><div class="card-purchase-preview-content"><p>Loading preview...</p></div></div>';
  const close = function () { cleanup(); element.remove(); };
  element.querySelector(".booking-action-dialog-backdrop").addEventListener("click", close); element.querySelector(".booking-action-dialog-dismiss").addEventListener("click", close);
  return { element: element, content: element.querySelector(".card-purchase-preview-content"), setCleanup: function (callback) { cleanup = callback; } };
}
function showFilePreview(dialog, source, file) {
  const blob = toBlob(source, file.type); const url = typeof source === "string" && /^(https?:|data:|blob:)/i.test(source) ? source : URL.createObjectURL(blob); const isObjectUrl = url.indexOf("blob:") === 0;
  const isImage = /^image\//i.test(blob.type || file.type) || /\.(avif|gif|jpe?g|png|svg|webp)$/i.test(file.name); const isPdf = /^application\/pdf$/i.test(blob.type || file.type) || /\.pdf$/i.test(file.name);
  dialog.content.innerHTML = isImage ? '<img src="' + escapeAttribute(url) + '" alt="' + escapeAttribute(file.name) + '">' : isPdf ? '<iframe src="' + escapeAttribute(url) + '" title="' + escapeAttribute(file.name) + '"></iframe>' : '<p>This file cannot be previewed here.</p><a class="button tertiary compact" href="' + escapeAttribute(url) + '" download="' + escapeAttribute(file.name) + '">Download file</a>';
  if (isObjectUrl) dialog.setCleanup(function () { URL.revokeObjectURL(url); });
}
function toBlob(source, type) { if (source instanceof Blob) return source; if (source instanceof ArrayBuffer) return new Blob([source], { type: type || "application/octet-stream" }); if (ArrayBuffer.isView(source)) return new Blob([source], { type: type || "application/octet-stream" }); return new Blob([source], { type: type || "application/octet-stream" }); }
function escapeAttribute(value) { return escapeHtml(String(value || "")).replace(/`/g, "&#96;"); }
