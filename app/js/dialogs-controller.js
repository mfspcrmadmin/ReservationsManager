import { crmExecuteFunction, crmGetAllRecords } from "./api.js";
import { MODULES } from "./constants.js";
import { elements } from "./dom.js";
import { clearLoading, setError, setNotice } from "./render.js";
import { state } from "./state.js";
import { ensureBookingTravelersLoaded } from "./travelers-controller.js";
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

export function onOpenPrepaymentRequestDialog() {
  if (!state.selectedService || !state.selectedBooking) {
    return;
  }

  var service = state.selectedService;
  var booking = state.selectedBooking;
  var supplierReference = String(service.Ezus_Supplier_Reference || service.EZUS_Supplier_Reference || "");
  if (supplierReference.indexOf("-supnew-") !== -1) {
    supplierReference = supplierReference.replace(/^.*-supnew-/, "");
  }
  var amount = service.Total_Purchase_Price || service.Purchase_Price || "";
  var today = new Date().toISOString().slice(0, 10);

  elements.prepaymentRequestForm.reset();
  setPrepaymentSummaryValue(elements.prepaymentMfspReference, booking.MFSP_Reference || service.Booking_Reference || "");
  setPrepaymentSummaryValue(elements.prepaymentBookingName, booking.Deal_Name || booking.Name || (booking.Booking && booking.Booking.name) || "");
  setPrepaymentSummaryValue(elements.prepaymentSupplierReference, supplierReference || service.Supplier_Reference || "");
  setPrepaymentSummaryValue(elements.prepaymentSupplierName, service.Supplier_Name || (service.Supplier && service.Supplier.name) || "");
  setPrepaymentSummaryValue(elements.prepaymentServiceId, service.id || "");
  elements.prepaymentServiceId.textContent = "Service ID: " + (service.id || "-");
  setPrepaymentSummaryValue(elements.prepaymentServiceName, service.Product_Description || service.Name || "");
  setPrepaymentSummaryValue(elements.prepaymentServiceDate, String(service.Service_Date || "").slice(0, 10));
  setPrepaymentSummaryValue(elements.prepaymentRequestedBy, state.currentUserEmail || "");
  setPrepaymentSummaryValue(elements.prepaymentRequestedDate, today);
  elements.prepaymentTotalAmount.value = amount;
  renderPrepaymentRows([{ amount: amount, percent: "100", whenToBePaid: "On a specific date", paymentDate: getNextAllowedPaymentDate() }]);
  elements.prepaymentAddPayment.hidden = true;
  elements.prepaymentRequestDialog.hidden = false;
}

export function onPrepaymentTransactionTypeChange() {
  var isPartial = elements.prepaymentTransactionType.value === "Partial Payment";
  elements.prepaymentAddPayment.hidden = !isPartial;
  if (!isPartial) {
    renderPrepaymentRows([{ amount: elements.prepaymentTotalAmount.value || "", percent: "100", whenToBePaid: "On a specific date", paymentDate: getNextAllowedPaymentDate() }]);
  }
}

export function onAddPrepaymentRow() {
  if (elements.prepaymentTransactionType.value !== "Partial Payment") {
    return;
  }
  appendPrepaymentRow({ amount: "", percent: "", whenToBePaid: "On a specific date", paymentDate: getNextAllowedPaymentDate() });
}

export function onClosePrepaymentRequestDialog() {
  elements.prepaymentRequestDialog.hidden = true;
}

export async function onSubmitPrepaymentRequest(event) {
  event.preventDefault();
  var file = elements.prepaymentProforma.files && elements.prepaymentProforma.files[0];
  if (!file) {
    return;
  }

  var submitButton = elements.prepaymentRequestSubmit;
  submitButton.disabled = true;
  submitButton.textContent = "Creating…";
  setError(elements, "");

  try {
    var args = {
      mfsp_reference: getPrepaymentSummaryValue(elements.prepaymentMfspReference),
      booking_name: getPrepaymentSummaryValue(elements.prepaymentBookingName),
      supplier_reference: getPrepaymentSummaryValue(elements.prepaymentSupplierReference),
      supplier_name: getPrepaymentSummaryValue(elements.prepaymentSupplierName),
      service_id: getPrepaymentSummaryValue(elements.prepaymentServiceId),
      service_name: getPrepaymentSummaryValue(elements.prepaymentServiceName),
      service_date: getPrepaymentSummaryValue(elements.prepaymentServiceDate),
      requested_by: getPrepaymentSummaryValue(elements.prepaymentRequestedBy),
      requested_date: getPrepaymentSummaryValue(elements.prepaymentRequestedDate),
      observations: elements.prepaymentObservations.value,
      transaction_type: elements.prepaymentTransactionType.value,
      total_proforma_amount: elements.prepaymentTotalAmount.value,
      payments: getPrepaymentRows(),
      proforma_file_name: file.name,
      proforma_file_type: file.type,
      proforma_file_base64: await readFileAsBase64(file)
    };
    var response = await crmExecuteFunction("creator_createprepaymentrequest", {
      requestBody: JSON.stringify(args)
    });
    var result = extractPrepaymentResult(response);
    if (result && (result.success === false || result.status === "error" || result.error === true)) {
      throw new Error(result.message || "Creator could not create the payment request.");
    }
    onClosePrepaymentRequestDialog();
    setNotice(elements, "Pre-payment request created successfully.");
  } catch (error) {
    setError(elements, error && error.message ? error.message : "Could not create the pre-payment request.");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Submit";
  }
}

function setPrepaymentSummaryValue(element, value) {
  var normalizedValue = String(value || "");
  element.dataset.value = normalizedValue;
  element.textContent = normalizedValue || "-";
}

function getPrepaymentSummaryValue(element) {
  return element.dataset.value || "";
}

function renderPrepaymentRows(rows) {
  elements.prepaymentPaymentsList.innerHTML = "";
  rows.forEach(appendPrepaymentRow);
}

function appendPrepaymentRow(row) {
  var item = document.createElement("div");
  item.className = "prepayment-payment-row";
  item.innerHTML = [
    '<label class="field"><span>Amount <em>*</em></span><div class="booking-form-currency"><span class="booking-form-currency-symbol">EUR</span><input data-prepayment-payment="amount" type="number" min="0" step="0.01" required value="' + escapeHtml(row.amount || "") + '"></div></label>',
    '<label class="field"><span>Percent <em>*</em></span><input data-prepayment-payment="percent" type="number" min="0" max="100" step="0.01" required value="' + escapeHtml(row.percent || "") + '"></label>',
    '<label class="field"><span>When To Be Paid</span><select data-prepayment-payment="when-to-be-paid">' + buildWhenToBePaidOptions(row.whenToBePaid) + '</select></label>',
    '<label class="field"><span>Payment Date <em>*</em></span><input data-prepayment-payment="payment-date" type="date" required value="' + escapeHtml(row.paymentDate || "") + '"></label>',
    '<button class="button tertiary compact prepayment-remove-payment" type="button" aria-label="Remove payment">×</button>'
  ].join("");
  item.querySelector(".prepayment-remove-payment").addEventListener("click", function () {
    if (elements.prepaymentPaymentsList.children.length > 1) {
      item.remove();
    }
  });
  elements.prepaymentPaymentsList.appendChild(item);
}

function getPrepaymentRows() {
  return Array.prototype.map.call(elements.prepaymentPaymentsList.querySelectorAll(".prepayment-payment-row"), function (row) {
    return {
      amount: row.querySelector('[data-prepayment-payment="amount"]').value,
      percent: row.querySelector('[data-prepayment-payment="percent"]').value,
      when_to_be_paid: row.querySelector('[data-prepayment-payment="when-to-be-paid"]').value,
      payment_date: row.querySelector('[data-prepayment-payment="payment-date"]').value
    };
  });
}

function buildWhenToBePaidOptions(selectedValue) {
  var values = ["On a specific date", "Within 1 day", "Within 2 days", "Within 3 days", "10 days prior to service date", "15 days prior to service date", "20 days prior to service date", "30 days prior to service date"];
  return values.map(function (value) {
    return '<option value="' + escapeHtml(value) + '"' + (value === selectedValue ? " selected" : "") + ">" + escapeHtml(value) + "</option>";
  }).join("");
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

function getNextAllowedPaymentDate() {
  var date = new Date();
  if (date.getHours() >= 14) {
    date.setDate(date.getDate() + 1);
  }
  return date.toISOString().slice(0, 10);
}

function readFileAsBase64(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () {
      resolve(String(reader.result || "").split(",").pop() || "");
    };
    reader.onerror = function () { reject(new Error("The proforma file could not be read.")); };
    reader.readAsDataURL(file);
  });
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
    '<div class="change-request-dialog-heading"><div><span class="change-request-eyebrow">Booking report</span><h4>Cancellation</h4></div><div class="change-request-identifiers"><code>Booking ID: ' + escapeHtml(values.booking_id) + '</code><code>Layout: ' + escapeHtml(values.booking_layout || "-") + '</code><code>Accounting rep ID: ' + escapeHtml(values.accounting_rep_id || "-") + '</code></div></div>',
    '<form class="booking-form"><section class="record-context cancellation-context"><div class="record-context-section"><h5>Booking</h5><dl><div><dt>Agency</dt><dd>' + escapeHtml(values.agency_name || "-") + '</dd></div><div><dt>Agent contact</dt><dd>' + escapeHtml(values.agent_contact_name || "-") + '</dd></div><div><dt>MFSP reference</dt><dd>' + escapeHtml(values.mfsp_reference || "-") + '</dd></div><div><dt>Name</dt><dd>' + escapeHtml(values.booking_name || "-") + '</dd></div></dl></div><div class="record-context-section"><h5>Report</h5><dl><div><dt>Reported by</dt><dd>' + escapeHtml(values.reported_by || "-") + '</dd></div><div><dt>Date</dt><dd>' + escapeHtml(values.date_field) + '</dd></div></dl></div></section>',
    hiddenCancellationFields(values),
    '<div class="change-request-form-grid">',
    '<label class="field cancellation-field--compact"><span>Cancellation received on</span><input name="cancellation_received_on" type="date"></label><label class="field cancellation-field--compact"><span>Days left before arrival day ' + infoTooltip("When cancellation email was received") + '</span><input name="days_left_arrival" type="number" min="0"></label>',
    '<label class="field cancellation-field--compact"><span>Cancellation fee</span><input name="cancellation_fee" type="text"></label>',
    cancellationCurrency("Paid amount", "paid_amount", values.paid_amount), cancellationCurrency("Amount", "amount", values.amount, "Total trip cost − cancellation fee"), cancellationCurrency("Booking cost", "booking_cost", values.booking_cost, "Suppliers cancellation fees"), cancellationCurrency("Commission", "comission", values.comission), cancellationCurrency("Balance due amount", "balance_due_amount", values.balance_due_amount),
    '<label class="field"><span>Transaction type</span><select name="transaction_type"><option value="">Select…</option><option>Refund</option><option>Credited</option></select></label><label class="field cancellation-description"><span>Reason for cancellation</span><textarea name="reason_for_cancelation" rows="5"></textarea></label><label class="field cancellation-description"><span>Trip postponed ' + infoTooltip("Enter tentative dates or the locator for the new trip.") + '</span><textarea name="trip_postponed" rows="4"></textarea></label>',
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
    '<div class="change-request-dialog-heading"><div><span class="change-request-eyebrow">Booking report</span><h4>Change request</h4></div><div class="change-request-identifiers"><code>Booking ID: ' + escapeHtml(values.booking_id) + '</code><code>Layout: ' + escapeHtml(values.booking_layout || "-") + '</code><code>Accounting rep ID: ' + escapeHtml(values.accounting_rep_id || "-") + '</code></div></div>',
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

export async function onCreatePaymentRequestClick() {
  if (!state.selectedBooking) {
    setError(elements, "Load a booking before creating a payment request.");
    return;
  }

  await ensureBookingTravelersLoaded();
  openTravelersPaymentRequestDialog();
}

function openTravelersPaymentRequestDialog() {
  var booking = state.selectedBooking;
  var total = Number(booking.Sales_Price_inc_Taxes || booking.Amount || 0);
  var balance = Number(booking.Balance_Amount || booking.Balance_due_amount || total);
  var deposit = total * 0.3;
  var recipients = [{ role: "Agent", name: booking.Contact_Name && booking.Contact_Name.name || "", email: booking.Agent_Email || "", selected: true, amount: deposit, percent: 100 }].concat((state.travelers || []).map(function (traveler) { return { role: "Traveller", name: [traveler.Forename, traveler.Name].filter(Boolean).join(" "), email: traveler.Email || "", selected: false, amount: "", percent: "" }; }));
  var dialog = document.createElement("div");
  dialog.className = "booking-action-dialog";
  dialog.innerHTML = '<div class="booking-action-dialog-backdrop"></div><div class="booking-action-dialog-panel booking-action-dialog-panel--wide" role="dialog"><h4>Travelers Payment Request</h4><form class="booking-form"><div class="prepayment-request-grid"><section><h5>Booking Information</h5><label class="field"><span>Booking Id</span><input name="booking_id" readonly value="' + escapeHtml(booking.id || "") + '"></label><label class="field"><span>Desk Ticket ID</span><input name="desk_ticket_id" required value="' + escapeHtml(booking.Desk_Ticket_ID || booking.Primary_ticket_ID || "") + '"></label><label class="field"><span>Pipeline</span><select name="pipeline"><option>Ezus</option><option>Tourplan</option></select></label><label class="field"><span>Booking Name</span><input name="booking_name" readonly value="' + escapeHtml(booking.Deal_Name || "") + '"></label><label class="field"><span>MFSP Reference</span><input name="mfsp_reference" readonly value="' + escapeHtml(booking.MFSP_Reference || "") + '"></label></section><section><h5>Finance Information</h5><label class="field"><span>Balance Due Amount</span><input name="balance_due_amount" readonly value="' + balance + '"></label><label class="field"><span>Deposit %</span><input name="deposit_percentage" type="number" value="30"></label><label class="field"><span>Deposit Amount</span><input name="deposit_amount" readonly value="' + deposit.toFixed(2) + '"></label><label class="field"><span>Total Booking Amount</span><input name="total_booking_amount" readonly value="' + total + '"></label></section><section><h5>Payment Request</h5><label class="field"><span>Payment Action</span><select name="payment_action"><option>Record &amp; Send Request</option><option>Record Only</option></select></label><label class="field"><span>Requested by - Name</span><input name="requested_by_name" value="' + escapeHtml(state.currentUserName || booking.Owner && booking.Owner.name || "") + '"></label><label class="field"><span>Requested by - Email</span><input name="requested_by_email" value="' + escapeHtml(state.currentUserEmail || booking.Owner && booking.Owner.email || "") + '"></label><label class="field"><span>Payment Method</span><select name="payment_method"><option>Airwallex</option><option>Bank Transfer</option><option>Credit Applied</option></select></label><label class="field"><span>Event Type</span><select name="event_type"><option>Deposit</option><option>Balance</option><option>Planning Fee</option><option>Supplement</option></select></label><label class="field"><span>Total Payment Request Amount</span><input name="total_payment_request_amount" type="number" step="0.01" value="' + deposit.toFixed(2) + '"></label><label class="field"><span>Split Method</span><select name="split_method"><option>Manual Split</option><option>Equal Split</option></select></label></section><section class="prepayment-request-grid"><h5>Recipients</h5><div class="travelers-payment-recipients">' + recipients.map(renderRecipient).join("") + '</div></section></div><div class="booking-action-dialog-footer booking-action-dialog-footer--split"><button class="button tertiary compact" type="button" data-close>Cancel</button><button class="button booking-action-button compact" type="submit">Submit</button></div></form></div>';
  document.body.appendChild(dialog);
  dialog.querySelector("[data-close]").onclick = function () { dialog.remove(); };
  dialog.querySelector(".booking-action-dialog-backdrop").onclick = function () { dialog.remove(); };
  dialog.querySelector("form").onsubmit = async function (event) { event.preventDefault(); var form = event.currentTarget; var data = Object.fromEntries(new FormData(form)); data.recipients = Array.prototype.map.call(form.querySelectorAll(".travelers-payment-recipient"), function (row) { return { use_this_recipient: row.querySelector("input[type=checkbox]").checked, amount_to_pay: row.querySelector('[data-key=amount]').value, percent_to_pay: row.querySelector('[data-key=percent]').value, role: row.querySelector('[data-key=role]').value, full_name: row.querySelector('[data-key=name]').value, email: row.querySelector('[data-key=email]').value }; }); var response = await crmExecuteFunction("creator_createtravelerspaymentrequest", { requestBody: JSON.stringify(data) }); var result = extractPrepaymentResult(response); if (result.success === false) { setError(elements, result.message || "Could not create payment request."); return; } dialog.remove(); setNotice(elements, "Travelers payment request created successfully."); };
}

function renderRecipient(recipient) {
  return '<div class="travelers-payment-recipient"><input type="checkbox"' + (recipient.selected ? " checked" : "") + '><div class="currency-input"><span>€</span><input data-key="amount" type="number" step="0.01" value="' + recipient.amount + '"></div><input data-key="percent" type="number" step="0.01" value="' + recipient.percent + '"><select data-key="role"><option' + (recipient.role === "Agent" ? " selected" : "") + '>Agent</option><option' + (recipient.role === "Traveller" ? " selected" : "") + '>Traveller</option></select><input data-key="name" value="' + escapeHtml(recipient.name) + '"><input data-key="email" type="email" value="' + escapeHtml(recipient.email) + '"></div>';
}

export function onCloseCardPurchaseDialog() {
  state.cardPurchaseDialogOpen = false;
  elements.cardPurchaseDialog.hidden = true;
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
    var payload = {
      mfsp_reference: elements.cardPurchaseMfspReference.textContent,
      booking_name: elements.cardPurchaseBookingName.textContent,
      service_id: service.id || "",
      supplier_code: elements.cardPurchaseSupplierCode.textContent === "-" ? "" : elements.cardPurchaseSupplierCode.textContent,
      supplier_name: elements.cardPurchaseSupplierName.textContent === "-" ? "" : elements.cardPurchaseSupplierName.textContent,
      service_name: elements.cardPurchaseServiceName.textContent === "-" ? "" : elements.cardPurchaseServiceName.textContent,
      service_date: elements.cardPurchaseServiceDate.value,
      amount: elements.cardPurchaseAmount.value,
      status: "Pending Accounting Review",
      observations: elements.cardPurchaseObservations.value,
      requested_by: elements.cardPurchaseRequestedBy.value
    };
    var response = await crmExecuteFunction("customapi_createcardpurchase", {
      requestBody: JSON.stringify(payload)
    });
    var result = extractPrepaymentResult(response);
    if (result && (result.success === false || result.status === "error" || result.error === true)) {
      throw new Error(result.message || "Creator could not record the card purchase.");
    }
    onCloseCardPurchaseDialog();
    setNotice(elements, result && result.email_sent === false
      ? "Card purchase recorded successfully, but the notification email could not be sent."
      : "Card purchase recorded successfully. A notification email has been sent.");
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
  elements.cardPurchaseServiceId.textContent = "Service ID: " + (service.id || "-");
  elements.cardPurchaseSupplierName.textContent = service.Supplier_Name || service.Supplier && service.Supplier.name || "-";
  elements.cardPurchaseSupplierCode.textContent = supplierCode || "-";
  elements.cardPurchaseServiceName.textContent = service.Product_Description || service.Name || "-";
  elements.cardPurchaseRequestedBy.value = state.currentUserEmail || booking.Owner && booking.Owner.email || "";
  elements.cardPurchaseAmount.value = "";
  elements.cardPurchaseServiceDate.value = String(service.Service_Date || "").slice(0, 10);
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
  const fields = ["Name", "Owner", "Owner_Type", "Record_Status__s"].join(",");

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
    const ownerLookup = record && record.Owner && typeof record.Owner === "object" ? record.Owner : {};
    return {
      value: String(record.id || "").trim(),
      label: String(record.Name || "").trim() || "Unnamed payment account",
      ownerId: String(ownerLookup.id || ownerLookup.user_id || ownerLookup.zuid || "").trim(),
      ownerName: String(ownerLookup.name || "").trim(),
      ownerEmail: String(ownerLookup.email || "").trim()
    };
  }).filter(function (option) {
    return Boolean(option.value);
  }).sort(function (left, right) {
    return left.label.localeCompare(right.label);
  });
}

function resolveDefaultPaymentAccountValue(options) {
  const currentUserId = String(state.currentUserId || "").trim();
  const currentUserName = normalizeComparableText(state.currentUserName || "");
  const currentUserEmail = normalizeComparableText(state.currentUserEmail || "");

  for (var index = 0; index < (options || []).length; index += 1) {
    var option = options[index];

    if (!option) {
      continue;
    }

    if (currentUserId && option.ownerId === currentUserId) {
      return option.value;
    }

    if (currentUserEmail && normalizeComparableText(option.ownerEmail) === currentUserEmail) {
      return option.value;
    }

    if (currentUserName && normalizeComparableText(option.ownerName) === currentUserName) {
      return option.value;
    }
  }

  return options && options.length ? options[0].value : "";
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
  elements.cardPurchasePaymentAccount.innerHTML = options.map(function (option) {
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
