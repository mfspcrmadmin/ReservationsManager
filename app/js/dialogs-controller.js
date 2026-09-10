import { crmCreateRecord, crmExecuteFunction, crmGetAllRecords, crmGetRecord, crmSearchRecord, crmUpdateRecord } from "./api.js";
import { MODULES } from "./constants.js";
import { elements } from "./dom.js";
import { clearLoading, setError, setNotice } from "./render.js";
import { state } from "./state.js";
import { escapeHtml, getLayoutValue, normalizeComparableText } from "./utils.js";

const ZOHO_SDK_TIMEOUT_MS = 4000;

export async function onRecordCardPurchase() {
  if (!state.selectedService) {
    return;
  }

  setError(elements, "");
  state.cardPurchaseDialogOpen = true;
  elements.cardPurchaseDialog.hidden = false;
  initializeCardPurchaseForm();
}

function extractPrepaymentResult(response) {
  var candidate = response && response.details && response.details.output
    ? response.details.output
    : response && response.details && response.details.response
      ? response.details.response
      : response;

  if (typeof candidate === "string") {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      return { status: /error|fail|exception/i.test(candidate) ? "error" : "success", message: candidate };
    }
  }

  return candidate || {};
}

export function onOpenBookingReportDialog() {
  if (!state.selectedBooking) {
    setError(elements, "Load a booking before reporting a cancellation or change.");
    return;
  }

  state.bookingReportDialogOpen = true;
  elements.bookingReportDialog.hidden = false;
}

export function onCloseBookingReportDialog() {
  state.bookingReportDialogOpen = false;
  elements.bookingReportDialog.hidden = true;
}

export function onChooseBookingReport(reportType) {
  if (!state.selectedBooking) {
    setError(elements, "Load a booking before reporting a cancellation or change.");
    return;
  }

  onCloseBookingReportDialog();
  setError(elements, "");
  if (reportType === "change request") {
    openChangeRequestDialog();
    return;
  }

  if (reportType === "cancellation") {
    openCancellationDialog();
    return;
  }

  setNotice(elements, "Report " + reportType + " is visible, but it is not wired to a backend action yet.");
}

function openCancellationDialog() {
  const booking = state.selectedBooking;
  const accountingRep = booking.Accounting_Rep || {};
  const accountingRepId = typeof accountingRep === "object" ? accountingRep.id || "" : "";
  const pvp = booking.Sales_Price_inc_Taxes || booking.Sales_Price || "";
  const values = {
    booking_layout: getLayoutValue(booking.Layout), booking_id: booking.id || "", reported_by: state.currentUserEmail || booking.Owner && booking.Owner.email || "", accounting_rep_id: accountingRepId,
    date_field: new Date().toISOString().slice(0, 10), agency_name: booking.Account_Name && booking.Account_Name.name || booking.Agency_Name || "", agent_contact_name: booking.Contact_Name && booking.Contact_Name.name || booking.Agent_Contact_Name || "",
    mfsp_reference: booking.MFSP_Reference || "", booking_name: booking.Deal_Name || booking.Name || "", paid_amount: booking.Total_Paid_Amount || "", amount: pvp,
    booking_cost: booking.Purchase_Price_inc_Taxes || booking.Purchase_Price || "", comission: booking.Final_Commission || "", balance_due_amount: booking.Balance_Amount || booking.Balance_due_amount || ""
  };
  const dialog = document.createElement("div");
  dialog.className = "booking-action-dialog cancellation-dialog";
  dialog.innerHTML = [
    '<div class="booking-action-dialog-backdrop"></div><div class="booking-action-dialog-panel booking-action-dialog-panel--wide cancellation-dialog-panel" role="dialog" aria-modal="true">',
    '<div class="change-request-dialog-heading"><div><span class="change-request-eyebrow">Booking report</span><h4>Cancellation</h4></div></div>',
    '<form class="booking-form"><section class="record-context cancellation-context"><div class="record-context-section"><h5>Booking</h5><dl><div><dt>Agency</dt><dd>' + escapeHtml(values.agency_name || "-") + '</dd></div><div><dt>Agent contact</dt><dd>' + escapeHtml(values.agent_contact_name || "-") + '</dd></div><div><dt>MFSP reference</dt><dd>' + escapeHtml(values.mfsp_reference || "-") + '</dd></div><div><dt>Name</dt><dd>' + escapeHtml(values.booking_name || "-") + '</dd></div></dl></div><div class="record-context-section"><h5>Report</h5><dl><div><dt>Reported by</dt><dd>' + escapeHtml(values.reported_by || "-") + '</dd></div><div><dt>Date</dt><dd>' + escapeHtml(values.date_field) + '</dd></div></dl></div></section>',
    hiddenCancellationFields(values),
    '<div class="change-request-form-grid">',
    '<label class="field cancellation-field--compact"><span>Cancellation received on</span><input name="cancellation_received_on" type="date"></label><label class="field cancellation-field--compact"><span>Transaction type</span><select name="transaction_type"><option value="">Select…</option><option>Refund</option><option>Credited</option></select></label>',
    '<label class="field cancellation-field--compact"><span>Cancellation fee</span><input name="cancellation_fee" type="text"></label>',
    cancellationCurrency("Paid amount", "paid_amount", values.paid_amount), cancellationCurrency("Amount", "amount", values.amount, "Total trip cost − cancellation fee"), cancellationCurrency("Booking cost", "booking_cost", values.booking_cost, "Suppliers cancellation fees"), cancellationCurrency("Commission", "comission", values.comission), cancellationCurrency("Balance due amount", "balance_due_amount", values.balance_due_amount),
    '<label class="field cancellation-description"><span>Reason for cancellation</span><textarea name="reason_for_cancelation" rows="5"></textarea></label><label class="field cancellation-description"><span>Trip postponed ' + infoTooltip("Enter tentative dates or the locator for the new trip.") + '</span><textarea name="trip_postponed" rows="4"></textarea></label>',
    '</div><aside class="cancellation-policy"><strong>MADE FOR SPAIN and PORTUGAL CANCELLATION POLICY</strong><p>40+ days: 20% of trip cost (less hotels) plus non-refundable expenses.<br>39–25 days: 50%. · 24–15 days: 75%. · Less than 15 days: 100%.</p><p>Accommodation and airline tickets are subject to suppliers’ refund policies.</p></aside><div class="booking-action-dialog-footer booking-action-dialog-footer--split"><div class="booking-action-dialog-footer-actions"><button class="button tertiary compact" type="button" data-back>Back</button><button class="button tertiary compact" type="button" data-close>Cancel</button></div><button class="button booking-action-button compact" type="submit">Submit</button></div></form></div>'
  ].join("");
  document.body.appendChild(dialog);
  dialog.querySelector("[data-close]").onclick = function () { dialog.remove(); };
  dialog.querySelector("[data-back]").onclick = function () { dialog.remove(); onOpenBookingReportDialog(); };
  dialog.querySelector(".booking-action-dialog-backdrop").onclick = function () { dialog.remove(); };
  dialog.querySelector("form").addEventListener("submit", async function (event) {
    event.preventDefault(); const button = event.currentTarget.querySelector('[type="submit"]'); const payload = Object.fromEntries(new FormData(event.currentTarget)); button.disabled = true;
    try { const result = extractPrepaymentResult(await crmExecuteFunction("customapi_createreportcancellation", { requestBody: JSON.stringify(payload) })); if (!result || result.success === false || result.error === true) throw new Error(result && result.message || "Creator could not create the cancellation."); dialog.remove(); setNotice(elements, "Cancellation created successfully."); }
    catch (error) { setError(elements, error.message || "Could not create the cancellation."); } finally { button.disabled = false; }
  });
}

function hiddenCancellationFields(values) { return ["booking_layout", "booking_id", "reported_by", "accounting_rep_id", "date_field", "agency_name", "agent_contact_name", "mfsp_reference", "booking_name"].map(function (key) { return '<input type="hidden" name="' + key + '" value="' + escapeHtml(values[key]) + '">'; }).join(""); }
function cancellationCurrency(label, name, value, help) { return '<label class="field"><span>' + label + ' <em>*</em>' + (help ? " " + infoTooltip(help) : "") + '</span><div class="booking-form-currency"><span class="booking-form-currency-symbol">EUR</span><input name="' + name + '" type="number" min="0" step="0.01" required value="' + escapeHtml(value) + '"></div></label>'; }
function infoTooltip(message) { return '<span class="field-info" tabindex="0" data-tooltip="' + escapeHtml(message) + '" aria-label="More information">i</span>'; }

function openChangeRequestDialog() {
  const booking = state.selectedBooking;
  const accountingRep = booking.Accounting_Rep || booking.Accounting_Representative || {};
  const accountingRepId = typeof accountingRep === "object" ? accountingRep.id || "" : "";
  const pvp = booking.Sales_Price_inc_Taxes || booking.Sales_Price || "";
  const cost = booking.Purchase_Price_inc_Taxes || booking.Purchase_Price || "";
  const commission = booking.Final_Commission || "";
  const values = {
    booking_layout: getLayoutValue(booking.Layout),
    booking_id: booking.id || "",
    reported_by: state.currentUserEmail || booking.Owner && booking.Owner.email || "",
    accounting_rep_id: accountingRepId,
    date_field: new Date().toISOString().slice(0, 10),
    mfsp_reference: booking.MFSP_Reference || "",
    booking_name: booking.Deal_Name || booking.Name || "",
    new_pvp: pvp,
    new_cost: cost,
    comission: commission
  };
  const dialog = document.createElement("div");
  dialog.className = "booking-action-dialog change-request-dialog";
  dialog.innerHTML = [
    '<div class="booking-action-dialog-backdrop"></div>',
    '<div class="booking-action-dialog-panel booking-action-dialog-panel--wide change-request-dialog-panel" role="dialog" aria-modal="true" aria-label="Change request">',
    '<div class="change-request-dialog-heading"><div><span class="change-request-eyebrow">Booking report</span><h4>Change request</h4></div></div>',
    '<form class="booking-form">',
    '<section class="record-context change-request-context"><div class="record-context-section"><h5>Booking</h5><dl><div><dt>MFSP reference</dt><dd>' + escapeHtml(values.mfsp_reference || "-") + '</dd></div><div><dt>Name</dt><dd>' + escapeHtml(values.booking_name || "-") + '</dd></div></dl></div><div class="record-context-section"><h5>Report</h5><dl><div><dt>Reported by</dt><dd>' + escapeHtml(values.reported_by || "-") + '</dd></div><div><dt>Date</dt><dd>' + escapeHtml(values.date_field) + '</dd></div></dl></div></section>',
    '<input name="booking_layout" type="hidden" value="' + escapeHtml(values.booking_layout) + '"><input name="booking_id" type="hidden" value="' + escapeHtml(values.booking_id) + '"><input name="reported_by" type="hidden" value="' + escapeHtml(values.reported_by) + '"><input name="accounting_rep_id" type="hidden" value="' + escapeHtml(values.accounting_rep_id) + '"><input name="date_field" type="hidden" value="' + escapeHtml(values.date_field) + '"><input name="mfsp_reference" type="hidden" value="' + escapeHtml(values.mfsp_reference) + '"><input name="booking_name" type="hidden" value="' + escapeHtml(values.booking_name) + '">',
    '<div class="change-request-form-grid">',
    renderChangeCurrencyField("New PVP", "new_pvp", values.new_pvp),
    renderChangeCurrencyField("New Cost", "new_cost", values.new_cost),
    renderChangeCurrencyField("Commission", "comission", values.comission),
    '<label class="field"><span>Transaction type</span><select name="transaction_type"><option value="">Select…</option><option value="Refund">Refund</option><option value="Additional Payment">Additional Payment</option></select></label>',
    '<label class="field"><span>Transaction amount</span><div class="booking-form-currency"><span class="booking-form-currency-symbol">EUR</span><input name="transaction_amount" type="number" min="0" step="0.01"></div></label>',
    '<label class="field change-request-description"><span>Change description</span><textarea name="change_description" rows="5"></textarea></label>',
    '</div><div class="booking-action-dialog-footer booking-action-dialog-footer--split"><div class="booking-action-dialog-footer-actions"><button class="button tertiary compact" type="button" data-back>Back</button><button class="button tertiary compact" type="button" data-close>Cancel</button></div><button class="button booking-action-button compact" type="submit">Submit</button></div></form></div>'
  ].join("");
  document.body.appendChild(dialog);
  dialog.querySelector("[data-close]").addEventListener("click", function () { dialog.remove(); });
  dialog.querySelector("[data-back]").addEventListener("click", function () { dialog.remove(); onOpenBookingReportDialog(); });
  dialog.querySelector(".booking-action-dialog-backdrop").addEventListener("click", function () { dialog.remove(); });
  dialog.querySelector("form").addEventListener("submit", async function (event) {
    event.preventDefault();
    const submitButton = event.currentTarget.querySelector('[type="submit"]');
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    submitButton.disabled = true;
    submitButton.textContent = "Submitting…";
    try {
      const response = await crmExecuteFunction("customapi_createreportchange", { requestBody: JSON.stringify(payload) });
      const result = extractPrepaymentResult(response);
      if (!result || result.success === false || result.status === "error" || result.error === true) {
        throw new Error(result && result.message || "Creator could not create the change request.");
      }
      dialog.remove();
      setNotice(elements, "Change request created successfully.");
    } catch (error) {
      setError(elements, error && error.message ? error.message : "Could not create the change request.");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Submit";
    }
  });
}

function renderChangeCurrencyField(label, name, value) {
  return '<label class="field"><span>' + label + ' <em>*</em></span><div class="booking-form-currency"><span class="booking-form-currency-symbol">EUR</span><input name="' + name + '" type="number" min="0" step="0.01" required value="' + escapeHtml(value) + '"></div></label>';
}

export function onCreatePaymentRequestClick() {
  if (!state.selectedBooking) {
    setError(elements, "Load a booking before creating a payment request.");
    return;
  }

  var bookingId = String(state.selectedBooking.id || "").trim();
  window.open(
    "https://creatorapp.zoho.eu/madeforspainandportugal/administration-manager#Form:Travellers_Payment_Request_Form?Booking_Id=" + encodeURIComponent(bookingId),
    "_blank",
    "noopener,noreferrer"
  );
}

export function onCloseCardPurchaseDialog() {
  state.cardPurchaseDialogOpen = false;
  elements.cardPurchaseDialog.hidden = true;
}

export function onCardPurchaseTransactionTypeChange(transactionType) {
  state.cardPurchaseTransactionType = transactionType === "Refund" ? "Refund" : "Purchase";
  renderCardPurchaseTransactionType();
}

export function onCardPurchaseOriginalPurchaseChange() {
  var selectedOption = elements.cardPurchaseOriginalPurchase && elements.cardPurchaseOriginalPurchase.selectedOptions[0];
  if (!selectedOption || !selectedOption.value) {
    return;
  }

  var originalAmount = selectedOption.getAttribute("data-amount");
  if (originalAmount !== null && originalAmount !== "") {
    elements.cardPurchaseAmount.value = originalAmount;
  }
}

export function onCardPurchaseSupportingDocumentsChange(files) {
  addCardPurchaseSupportingDocuments(files);
  if (elements.cardPurchaseSupportingDocuments) elements.cardPurchaseSupportingDocuments.value = "";
}

export function onCardPurchaseSupportingDocumentsDrop(files) {
  addCardPurchaseSupportingDocuments(files);
}

export async function onSubmitCardPurchaseForm(event) {
  event.preventDefault();
  var service = state.selectedService;
  var booking = state.selectedBooking;
  var submitButton = elements.cardPurchaseSubmit;
  setError(elements, "");

  if (!service || !booking) {
    setError(elements, "Load a booking and select a service before recording a card purchase.");
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "Submitting…";
  try {
    var transactionType = state.cardPurchaseTransactionType || "Purchase";
    var isRefund = transactionType === "Refund";
    var amount = elements.cardPurchaseAmount.value;
    var transactionDate = elements.cardPurchaseServiceDate.value;
    var originalPurchaseId = elements.cardPurchaseOriginalPurchase.value;
    if (!elements.cardPurchasePaymentAccount.value) throw new Error("Select a card payment account.");
    if (isRefund && !originalPurchaseId) throw new Error("Select the original card purchase.");
    var payload = {
      Name: transactionType + " - " + (booking.MFSP_Reference || booking.Deal_Name || booking.id),
      Booking: { id: booking.id },
      Boking_Service: { id: service.id },
      Card_Payment_Account: { id: elements.cardPurchasePaymentAccount.value },
      Transaction_Type: transactionType,
      Accounting_Status: isRefund ? "Pending credit note" : "Pending invoice",
      Amount: Number(amount),
      Transaction_Date: toCrmDateTime(transactionDate),
      Transaction_Notes: elements.cardPurchaseObservations.value
    };
    var supplierId = service.Supplier && (service.Supplier.id || service.Supplier.value) || service.Supplier_Id || "";
    if (supplierId) {
      payload.Supplier = { id: supplierId };
    }
    var settlementId = getLookupId(service.Supplier_Settlement);
    if (settlementId) {
      payload.Settlement = { id: settlementId };
    }
    if (isRefund) {
      payload.Original_Card_Purchase = { id: originalPurchaseId };
    }
    var supportingDocuments = state.cardPurchaseSupportingDocuments.length
      ? await uploadCardPurchaseSupportingDocuments(state.cardPurchaseSupportingDocuments)
      : [];
    var cardPurchase = await crmCreateRecord(MODULES.cardPurchases, payload);
    if (supportingDocuments.length) {
      var cardPurchaseId = cardPurchase.id || cardPurchase.details && cardPurchase.details.id;
      if (!cardPurchaseId) {
        throw new Error("The card transaction was created without a record ID, so Supporting Documents could not be saved.");
      }
      await saveCardPurchaseSupportingDocuments(cardPurchaseId, supportingDocuments);
    }
    state.cardPurchasesLoaded = false;
    state.cardPurchasesLoadedBookingId = "";
    onCloseCardPurchaseDialog();
    setNotice(elements, transactionType + " recorded successfully in CRM.");
  } catch (error) {
    setError(elements, error && error.message ? error.message : "Could not record the card purchase.");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Submit";
  }
}

function initializeCardPurchaseForm() {
  if (!elements.cardPurchaseForm) {
    return;
  }

  elements.cardPurchaseForm.reset();
  var service = state.selectedService || {};
  var booking = state.selectedBooking || {};
  var supplierCode = String(service.Ezus_Supplier_Reference || service.EZUS_Supplier_Reference || service.Supplier_Reference || "");
  if (supplierCode.indexOf("-supnew-") !== -1) {
    supplierCode = supplierCode.replace(/^.*-supnew-/, "");
  }
  elements.cardPurchaseMfspReference.textContent = booking.MFSP_Reference || service.Booking_Reference || "-";
  elements.cardPurchaseBookingName.textContent = booking.Deal_Name || booking.Name || booking.Booking && booking.Booking.name || "-";
  elements.cardPurchaseSupplierName.textContent = service.Supplier_Name || service.Supplier && service.Supplier.name || "-";
  elements.cardPurchaseSupplierCode.textContent = supplierCode || "-";
  elements.cardPurchaseServiceName.textContent = service.Product_Description || service.Name || "-";
  elements.cardPurchaseServiceContextDate.textContent = String(service.Service_Date || "").slice(0, 10) || "-";
  elements.cardPurchaseAmount.value = "";
  var today = new Date().toISOString().slice(0, 10);
  elements.cardPurchaseServiceDate.value = today;
  state.cardPurchaseSupportingDocuments = [];
  renderCardPurchaseSupportingDocuments();
  state.cardPurchaseTransactionType = "Purchase";
  renderCardPurchaseTransactionType();
  hydrateCardPurchaseAccounts();
  hydrateOriginalCardPurchaseOptions();
}

function addCardPurchaseSupportingDocuments(files) {
  var incoming = Array.prototype.slice.call(files || []);
  if (!incoming.length) return;
  var filesToAdd = incoming.filter(function (file) {
    return !state.cardPurchaseSupportingDocuments.some(function (existing) {
      return existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified;
    });
  });
  if (state.cardPurchaseSupportingDocuments.length + filesToAdd.length > 5) {
    setError(elements, "Supporting Documents allows a maximum of 5 files.");
    filesToAdd = filesToAdd.slice(0, Math.max(0, 5 - state.cardPurchaseSupportingDocuments.length));
  }
  state.cardPurchaseSupportingDocuments = state.cardPurchaseSupportingDocuments.concat(filesToAdd);
  renderCardPurchaseSupportingDocuments();
}

function renderCardPurchaseSupportingDocuments() {
  if (!elements.cardPurchaseSupportingDocumentsList) return;
  elements.cardPurchaseSupportingDocumentsList.innerHTML = state.cardPurchaseSupportingDocuments.map(function (file, index) {
    return '<span class="card-transaction-file"><span>' + escapeHtml(file.name) + '</span><button type="button" data-card-purchase-file-remove="' + index + '" aria-label="Remove ' + escapeHtml(file.name) + '">×</button></span>';
  }).join("");
  Array.prototype.forEach.call(elements.cardPurchaseSupportingDocumentsList.querySelectorAll("[data-card-purchase-file-remove]"), function (button) {
    button.addEventListener("click", function () {
      state.cardPurchaseSupportingDocuments.splice(Number(button.dataset.cardPurchaseFileRemove), 1);
      renderCardPurchaseSupportingDocuments();
    });
  });
}

async function uploadCardPurchaseSupportingDocuments(files) {
  var uploaded = [];
  for (var index = 0; index < files.length; index += 1) {
    var file = files[index];
    var response = await window.ZOHO.CRM.API.uploadFile({
      CONTENT_TYPE: "multipart",
      PARTS: [{
        headers: {
          "Content-Disposition": "file;"
        },
        content: "__FILE__"
      }],
      FILE: {
        fileParam: "content",
        file: file
      }
    });
    var entries = response && Array.isArray(response.data) ? response.data : Array.isArray(response) ? response : [];
    var result = entries[0] || {};
    var fileId = result.details && result.details.id;
    if (!fileId || String(result.status || result.code || "").toLowerCase() === "error") {
      throw new Error(result.message || "Could not upload " + file.name + ".");
    }
    uploaded.push({ File_Id__s: fileId });
  }
  return uploaded;
}

async function saveCardPurchaseSupportingDocuments(cardPurchaseId, supportingDocuments) {
  var fileIds = supportingDocuments.map(function (document) {
    return document && document.File_Id__s;
  }).filter(Boolean);
  var payloadVariants = [
    fileIds.map(function (fileId) { return { $file_id: fileId }; }),
    fileIds.map(function (fileId) { return { file_id: fileId }; }),
    fileIds,
    { $file_id: fileIds }
  ];
  var lastResult = null;

  for (var index = 0; index < payloadVariants.length; index += 1) {
    lastResult = await crmUpdateRecord(MODULES.cardPurchases, {
      id: cardPurchaseId,
      Supporting_Documents: payloadVariants[index]
    });
    if (String(lastResult.status || "").toLowerCase() === "error" || String(lastResult.code || "").toUpperCase() !== "SUCCESS") {
      continue;
    }
    var refreshedCardPurchase = await crmGetRecord(MODULES.cardPurchases, cardPurchaseId);
    if (refreshedCardPurchase && refreshedCardPurchase.Supporting_Documents) {
      return;
    }
  }

  throw new Error(
    lastResult && (lastResult.message || lastResult.code) ||
    "The card transaction was created, but Supporting Documents could not be saved."
  );
}

function renderCardPurchaseTransactionType() {
  var isRefund = state.cardPurchaseTransactionType === "Refund";
  elements.cardPurchaseTransactionPurchase.classList.toggle("is-selected", !isRefund);
  elements.cardPurchaseTransactionRefund.classList.toggle("is-selected", isRefund);
  elements.cardPurchaseTransactionPurchase.classList.toggle("tertiary", isRefund);
  elements.cardPurchaseTransactionRefund.classList.toggle("tertiary", !isRefund);
  elements.cardPurchaseTransactionPurchase.setAttribute("aria-pressed", isRefund ? "false" : "true");
  elements.cardPurchaseTransactionRefund.setAttribute("aria-pressed", isRefund ? "true" : "false");
  elements.cardPurchaseRefundFields.hidden = !isRefund;
  elements.cardPurchasePurchaseFields.hidden = false;
  elements.cardPurchaseAmount.required = true;
  elements.cardPurchaseServiceDate.required = true;
  elements.cardPurchaseOriginalPurchase.required = isRefund;
  elements.cardPurchaseSubmit.textContent = isRefund ? "Record cancellation" : "Record purchase";
}

async function hydrateOriginalCardPurchaseOptions() {
  var bookingId = state.selectedBooking && state.selectedBooking.id;
  var serviceId = state.selectedService && state.selectedService.id;
  if (!bookingId || !serviceId || !elements.cardPurchaseOriginalPurchase) return;
  elements.cardPurchaseOriginalPurchase.innerHTML = '<option value="">Loading purchases...</option>';
  elements.cardPurchaseOriginalPurchase.disabled = true;
  try {
    var criteria = "(Booking:equals:" + bookingId + ")and(Boking_Service:equals:" + serviceId + ")";
    var records = await crmSearchRecord(MODULES.cardPurchases, criteria, 1, 200);
    var purchases = records.filter(function (record) {
      return record.Transaction_Type === "Purchase" && getLookupId(record.Boking_Service) === String(serviceId);
    });
    elements.cardPurchaseOriginalPurchase.innerHTML = '<option value="">Select a purchase</option>' + purchases.map(function (record) {
      var transactionDate = String(record.Transaction_Date || "").slice(0, 10);
      var label = (record.Name || "Purchase") + " — " + String(record.Amount || "0") + (transactionDate ? " · " + transactionDate : "");
      return '<option value="' + escapeHtml(record.id) + '" data-amount="' + escapeHtml(String(record.Amount || "")) + '">' + escapeHtml(label) + "</option>";
    }).join("");
    elements.cardPurchaseOriginalPurchase.disabled = false;
  } catch (error) {
    elements.cardPurchaseOriginalPurchase.innerHTML = '<option value="">Could not load purchases</option>';
  }
}

function getLookupId(value) {
  if (value && typeof value === "object") {
    return String(value.id || value.value || "");
  }
  return String(value || "");
}

function toCrmDateTime(value) {
  return String(value || "") + "T12:00:00+02:00";
}

async function hydrateCardPurchaseAccounts() {
  if (state.paymentAccountsLoading) {
    renderPaymentAccountSelect({
      loading: true,
      options: state.paymentAccountOptions
    });
    return;
  }

  if (state.paymentAccountsLoaded) {
    renderPaymentAccountSelect({
      options: state.paymentAccountOptions,
      errorMessage: state.paymentAccountsError
    });
    return;
  }

  state.paymentAccountsLoading = true;
  renderPaymentAccountSelect({
    loading: true,
    options: state.paymentAccountOptions
  });

  try {
    const records = await loadAllPaymentAccountRecords();
    state.paymentAccountOptions = buildPaymentAccountOptions(records);
    state.paymentAccountsLoaded = true;
    state.paymentAccountsError = "";
  } catch (error) {
    state.paymentAccountOptions = [];
    state.paymentAccountsLoaded = false;
    state.paymentAccountsError = error && error.message ? error.message : "Could not load payment accounts.";
  } finally {
    state.paymentAccountsLoading = false;
    renderPaymentAccountSelect({
      options: state.paymentAccountOptions,
      errorMessage: state.paymentAccountsError
    });
  }
}

async function loadAllPaymentAccountRecords() {
  const aggregated = [];
  const perPage = 100;
  const fields = ["Name", "Card_Holder", "Owner_Type", "Record_Status__s"].join(",");

  for (var page = 1; page <= 10; page += 1) {
    var pageRecords = await withTimeout(
      crmGetAllRecords(MODULES.paymentAccounts, page, perPage, {
        fields: fields
      }),
      ZOHO_SDK_TIMEOUT_MS,
      "Payment accounts load timed out"
    );

    if (!pageRecords.length) {
      break;
    }

    aggregated.push.apply(aggregated, pageRecords);

    if (pageRecords.length < perPage) {
      break;
    }
  }

  return aggregated;
}

function buildPaymentAccountOptions(records) {
  return (records || []).filter(function (record) {
    const ownerType = normalizeComparableText(record && record.Owner_Type);
    const recordStatus = normalizeComparableText(record && record.Record_Status__s);

    return ownerType === "own" && recordStatus !== "trash";
  }).map(function (record) {
    const cardHolder = record && record.Card_Holder && typeof record.Card_Holder === "object" ? record.Card_Holder : {};
    return {
      value: String(record.id || "").trim(),
      label: String(record.Name || "").trim() || "Unnamed payment account",
      cardHolderId: String(cardHolder.id || cardHolder.user_id || cardHolder.zuid || "").trim(),
      cardHolderName: String(cardHolder.name || "").trim(),
      cardHolderEmail: String(cardHolder.email || "").trim()
    };
  }).filter(function (option) {
    return Boolean(option.value);
  }).sort(function (left, right) {
    return left.label.localeCompare(right.label);
  });
}

function resolveDefaultPaymentAccountValue(options) {
  const currentUserId = String(state.currentUserRelationshipUserId || state.currentUserId || "").trim();
  const currentUserName = normalizeComparableText(state.currentUserName || "");
  const currentUserEmail = normalizeComparableText(state.currentUserEmail || "");

  for (var index = 0; index < (options || []).length; index += 1) {
    var option = options[index];

    if (!option) {
      continue;
    }

    if (currentUserId && option.cardHolderId === currentUserId) {
      return option.value;
    }

    if (currentUserEmail && normalizeComparableText(option.cardHolderEmail) === currentUserEmail) {
      return option.value;
    }

    if (currentUserName && normalizeComparableText(option.cardHolderName) === currentUserName) {
      return option.value;
    }
  }

  return "";
}

function renderPaymentAccountSelect(config) {
  const settings = config || {};
  const options = Array.isArray(settings.options) ? settings.options : [];
  const isLoading = Boolean(settings.loading);
  const errorMessage = String(settings.errorMessage || "").trim();

  if (!elements.cardPurchasePaymentAccount || !elements.cardPurchaseAccountStatus) {
    return;
  }

  if (isLoading) {
    elements.cardPurchasePaymentAccount.innerHTML = '<option value="">Loading payment accounts...</option>';
    elements.cardPurchasePaymentAccount.disabled = true;
    elements.cardPurchaseAccountStatus.textContent = "Loading own payment accounts...";
    elements.cardPurchaseAccountStatus.className = "booking-form-help";
    return;
  }

  if (errorMessage) {
    elements.cardPurchasePaymentAccount.innerHTML = '<option value="">Payment accounts unavailable</option>';
    elements.cardPurchasePaymentAccount.disabled = true;
    elements.cardPurchaseAccountStatus.textContent = errorMessage;
    elements.cardPurchaseAccountStatus.className = "booking-form-help booking-form-help--error";
    return;
  }

  if (!options.length) {
    elements.cardPurchasePaymentAccount.innerHTML = '<option value="">No own payment accounts available</option>';
    elements.cardPurchasePaymentAccount.disabled = true;
    elements.cardPurchaseAccountStatus.textContent = "Only payment accounts with Owner Type set to Own are available here.";
    elements.cardPurchaseAccountStatus.className = "booking-form-help";
    return;
  }

  const defaultValue = resolveDefaultPaymentAccountValue(options);
  elements.cardPurchasePaymentAccount.innerHTML = '<option value="">Select a card payment account...</option>' + options.map(function (option) {
    return '<option value="' + escapeHtml(option.value) + '"' + (option.value === defaultValue ? " selected" : "") + ">" +
      escapeHtml(option.label) +
      "</option>";
  }).join("");
  elements.cardPurchasePaymentAccount.disabled = false;
  elements.cardPurchaseAccountStatus.textContent = "";
  elements.cardPurchaseAccountStatus.className = "booking-form-help";
}

function withTimeout(promise, timeoutMs, timeoutMessage) {
  return new Promise(function (resolve, reject) {
    var settled = false;
    var timer = window.setTimeout(function () {
      if (settled) {
        return;
      }

      settled = true;
      reject(new Error(timeoutMessage || "The request timed out."));
    }, timeoutMs);

    promise.then(function (value) {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timer);
      resolve(value);
    }).catch(function (error) {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timer);
      reject(error);
    });
  });
}
