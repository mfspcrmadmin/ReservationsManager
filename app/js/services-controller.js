import { crmExecuteFunction, crmUpdateRecord } from "./api.js";
import { onOpenPrepaymentRequestDialog } from "./dialogs-controller.js";
import { MODULES, SERVICE_TABLE_COLUMNS, SERVICE_TABLE_COLUMNS_STORAGE_KEY } from "./constants.js";
import { buildGroupedRows } from "./data.js";
import { elements } from "./dom.js";
import {
  applyStatusSelectAppearance,
  clearLoading,
  renderActiveTab,
  renderSelectionPanel,
  renderServicesTable,
  setError,
  setNotice,
  showLoading,
  syncBulkActionMode
} from "./render.js";
import { state } from "./state.js";
import { escapeHtml, normalizeComparableText } from "./utils.js";

let reloadBookingWorkspaceHandler = null;
let serviceStatusPreviewFeedbackTimeout = 0;
let draggedServiceColumnKey = "";

export function configureServicesController(config) {
  const settings = config || {};
  reloadBookingWorkspaceHandler = typeof settings.reloadBookingWorkspace === "function"
    ? settings.reloadBookingWorkspace
    : null;
}

export function renderServicesWorkspace() {
  renderServicesTable({
    elements: elements,
    state: state,
    onSelectService: selectService,
    onSelectStep: selectStep,
    onToggleStepCollapsed: toggleStepCollapsed,
    onToggleServiceSelection: toggleServiceSelection,
    onToggleGroupSelection: toggleGroupSelection
  });
  syncSelectAllCheckbox();
  renderSelectionPanel(elements, state);
  renderActiveTab(elements, state);
}

export function initializeServiceTableColumns() {
  state.serviceTableColumns = sanitizeServiceTableColumns(readStoredServiceTableColumns());
}

export function setServiceView(view) {
  state.serviceView = view;
  renderServicesWorkspace();
}

export function setServiceDetailTab(tabName) {
  if (tabName !== "basic" && tabName !== "financial" && tabName !== "step") {
    return;
  }

  const currentNotes = elements.fieldServiceNotes ? elements.fieldServiceNotes.value : "";
  state.serviceDetailTab = tabName;
  renderSelectionPanel(elements, state);
  if (elements.fieldServiceNotes) {
    elements.fieldServiceNotes.value = currentNotes;
  }
}

export function syncBulkPanels() {
  syncBulkActionMode(elements);
  syncBulkStatusActionState();
}

export function syncBulkStatusActionState() {
  const hasSelectedServices = Object.keys(state.selectedServiceIds).length > 0;
  elements.applyBulkStatus.disabled = !hasSelectedServices || !elements.bulkStatusEzus.value;
  applyStatusSelectAppearance(elements.bulkStatusEzus, elements.bulkStatusEzus.value);
}

export function onSelectedServiceStatusChange() {
  if (!state.selectedService || !elements.fieldStatusEzus.value) {
    return;
  }

  state.serviceStatusDraftValue = elements.fieldStatusEzus.value || "";
  onSaveService({ preventDefault: function () {} });
}

export function onRequestServicePrepayment() {
  onOpenPrepaymentRequestDialog();
}

export function onRecordRenfePrepayment() {
  if (!state.selectedService || !state.selectedBooking) {
    return;
  }

  openRenfePrepaymentDialog();
}

export function onServiceFilterToggleClick(filterKey, event) {
  event.preventDefault();
  event.stopPropagation();
  state.serviceFilterMenuOpen = state.serviceFilterMenuOpen === filterKey ? "" : filterKey;
  renderServicesWorkspace();
}

export function onServiceMultiFilterChange(filterKey, menuElement) {
  state.serviceFilters[filterKey] = Array.prototype.map.call(
    menuElement.querySelectorAll("input[data-service-filter-option]:checked"),
    function (input) {
      return input.value;
    }
  );
  applyServiceFilter();
}

export function onServiceSupplierFilterChange() {
  state.serviceFilters.supplier = elements.serviceFilterSupplier.value || "";
  applyServiceFilter();
}

export function onHideNonOperationalServicesChange() {
  state.hideNonOperationalServices = Boolean(elements.hideNonOperationalServices.checked);
  applyServiceFilter();
}

export function onServicesHeadRowChange(event) {
  if (event.target && event.target.id === "services-select-all") {
    toggleAllVisibleServices(event.target.checked);
  }
}

export function onToggleServiceColumnsPanel() {
  state.serviceColumnsPanelOpen = !state.serviceColumnsPanelOpen;
  renderServicesWorkspace();
}

export function onResetServiceColumns() {
  state.serviceTableColumns = getDefaultServiceTableColumns();
  saveServiceTableColumns();
  renderServicesWorkspace();
}

export function onServiceColumnsListChange(event) {
  const columnKey = event.target && event.target.getAttribute("data-column-visibility");

  if (!columnKey) {
    return;
  }

  const column = state.serviceTableColumns.find(function (entry) {
    return entry.key === columnKey;
  });

  if (!column) {
    return;
  }

  if (!event.target.checked && getVisibleServiceColumnCount() === 1) {
    event.target.checked = true;
    return;
  }

  column.visible = event.target.checked;
  saveServiceTableColumns();
  renderServicesWorkspace();
}

export function onServiceColumnsListDragStart(event) {
  const row = getColumnEditorRow(event.target);

  if (!row) {
    return;
  }

  draggedServiceColumnKey = row.getAttribute("data-column-key") || "";
  row.classList.add("is-dragging");

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", draggedServiceColumnKey);
  }
}

export function onServiceColumnsListDragOver(event) {
  const row = getColumnEditorRow(event.target);

  if (!row || !draggedServiceColumnKey || row.getAttribute("data-column-key") === draggedServiceColumnKey) {
    return;
  }

  event.preventDefault();
  clearColumnDragIndicators();
  row.classList.add(event.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2
    ? "is-drag-over-after"
    : "is-drag-over-before");

  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "move";
  }
}

export function onServiceColumnsListDrop(event) {
  const targetRow = getColumnEditorRow(event.target);
  const targetKey = targetRow && targetRow.getAttribute("data-column-key");
  const sourceKey = draggedServiceColumnKey || (event.dataTransfer && event.dataTransfer.getData("text/plain"));

  event.preventDefault();
  clearColumnDragIndicators();

  if (!sourceKey || !targetKey || sourceKey === targetKey) {
    return;
  }

  const sourceIndex = state.serviceTableColumns.findIndex(function (column) {
    return column.key === sourceKey;
  });
  const targetIndex = state.serviceTableColumns.findIndex(function (column) {
    return column.key === targetKey;
  });

  if (sourceIndex === -1 || targetIndex === -1) {
    return;
  }

  const insertAfterTarget = event.clientY > targetRow.getBoundingClientRect().top + targetRow.offsetHeight / 2;
  const reordered = state.serviceTableColumns.slice();
  const movedColumn = reordered.splice(sourceIndex, 1)[0];
  const adjustedTargetIndex = reordered.findIndex(function (column) {
    return column.key === targetKey;
  });
  reordered.splice(adjustedTargetIndex + (insertAfterTarget ? 1 : 0), 0, movedColumn);
  state.serviceTableColumns = reordered;
  saveServiceTableColumns();
  renderServicesWorkspace();
}

export function onServiceColumnsListDragEnd() {
  draggedServiceColumnKey = "";
  clearColumnDragIndicators();
}

export function resetServiceFilters() {
  state.serviceFilters = {
    status: [],
    supplier: "",
    category: [],
    subcategory: [],
    subdestination: []
  };
  state.hideNonOperationalServices = true;
  if (elements.hideNonOperationalServices) {
    elements.hideNonOperationalServices.checked = true;
  }
  state.serviceFilterMenuOpen = "";
}

export function createSelectionSnapshot() {
  return {
    selectedServiceIds: Object.keys(state.selectedServiceIds),
    selectedServiceId: state.selectedServiceId,
    selectedStepId: state.selectedStepId,
    selectedItemType: state.selectedItemType
  };
}

export function restoreSelectionSnapshot(snapshot) {
  state.selectedServiceIds = {};

  snapshot.selectedServiceIds.forEach(function (serviceId) {
    if (state.services.some(function (service) {
      return service.id === serviceId;
    })) {
      state.selectedServiceIds[serviceId] = true;
    }
  });

  if (snapshot.selectedItemType === "service" && snapshot.selectedServiceId) {
    state.selectedService = state.services.find(function (service) {
      return service.id === snapshot.selectedServiceId;
    }) || null;

    if (state.selectedService) {
      state.selectedServiceId = snapshot.selectedServiceId;
      state.selectedItemType = "service";
      state.selectedStepId = state.selectedService.Step && state.selectedService.Step.id ? state.selectedService.Step.id : "";
      state.selectedStep = state.selectedStepId ? state.stepIndex[state.selectedStepId] || null : null;
      return;
    }
  }

  if (snapshot.selectedStepId === "__no_step__") {
    state.selectedStepId = "__no_step__";
    state.selectedStep = null;
    state.selectedServiceId = "";
    state.selectedService = null;
    state.selectedItemType = "step";
    return;
  }

  if (snapshot.selectedItemType === "step" && snapshot.selectedStepId) {
    state.selectedStep = state.stepIndex[snapshot.selectedStepId] || null;

    if (state.selectedStep) {
      state.selectedStepId = snapshot.selectedStepId;
      state.selectedServiceId = "";
      state.selectedService = null;
      state.selectedItemType = "step";
      return;
    }
  }
}

export function applyServiceFilter() {
  const normalizedStatuses = state.serviceFilters.status.map(normalizeComparableText);
  const normalizedSupplier = normalizeComparableText(state.serviceFilters.supplier);
  const normalizedCategories = state.serviceFilters.category.map(normalizeComparableText);
  const normalizedSubcategories = state.serviceFilters.subcategory.map(normalizeComparableText);
  const normalizedSubdestinations = state.serviceFilters.subdestination.map(normalizeComparableText);

  state.filteredServices = state.services.filter(function (service) {
    const matchesOperationalFilter = !state.hideNonOperationalServices || serviceRequiresOperationalManagement(service);
    const matchesStatus = !normalizedStatuses.length ||
      normalizedStatuses.indexOf(normalizeComparableText(service.Status_EZUS || "")) !== -1;
    const matchesSupplier = !normalizedSupplier ||
      normalizeComparableText(service.Supplier_Name || "") === normalizedSupplier;
    const matchesCategory = !normalizedCategories.length ||
      normalizedCategories.indexOf(normalizeComparableText(service.Category || "")) !== -1;
    const matchesSubcategory = !normalizedSubcategories.length ||
      normalizedSubcategories.indexOf(normalizeComparableText(service.Subcategory || "")) !== -1;
    const matchesSubdestination = !normalizedSubdestinations.length ||
      normalizedSubdestinations.indexOf(normalizeComparableText(service.Subdestination || "")) !== -1;

    return matchesOperationalFilter && matchesStatus && matchesSupplier && matchesCategory && matchesSubcategory && matchesSubdestination;
  });

  buildGroupedRows(state);
  renderServicesWorkspace();
}

function serviceRequiresOperationalManagement(service) {
  const fieldNames = [
    "Requires_Operational_Management",
    "Requires_Operational_Management_",
    "Requires_Operational",
    "Operational_Management_Required"
  ];

  for (let index = 0; index < fieldNames.length; index += 1) {
    const value = service && service[fieldNames[index]];

    // Do not use truthiness here: an unchecked CRM checkbox is `false`.
    if (value !== undefined && value !== null && value !== "") {
      return ["true", "yes", "1", "required"].indexOf(normalizeComparableText(value)) !== -1;
    }
  }

  // If the checkbox is absent, it is not marked and therefore non-operational.
  return false;
}

export function selectService(serviceId) {
  state.selectedServiceId = serviceId;
  state.selectedService = state.services.find(function (service) {
    return service.id === serviceId;
  }) || null;
  state.selectedItemType = "service";
  state.serviceDetailTab = "basic";
  state.serviceStatusDraftValue = "";
  state.selectedStepId = state.selectedService && state.selectedService.Step && state.selectedService.Step.id ? state.selectedService.Step.id : "";
  state.selectedStep = state.selectedStepId ? state.stepIndex[state.selectedStepId] || null : null;

  renderServicesWorkspace();
}

export function closeServiceDetails() {
  state.selectedServiceId = "";
  state.selectedService = null;
  state.selectedStepId = "";
  state.selectedStep = null;
  state.selectedItemType = "";
  state.serviceStatusDraftValue = "";

  renderServicesWorkspace();
}

export function selectStep(stepId, rawStepId) {
  state.selectedStepId = rawStepId || stepId || "";
  state.selectedStep = stepId ? state.stepIndex[stepId] || null : null;
  state.selectedServiceId = "";
  state.selectedService = null;
  state.selectedItemType = "step";
  state.serviceStatusDraftValue = "";

  renderServicesWorkspace();
}

export async function onApplyBulkStatus() {
  const selectedIds = Object.keys(state.selectedServiceIds);
  const nextStatus = elements.bulkStatusEzus.value;

  if (!selectedIds.length || !nextStatus) {
    return;
  }

  showLoading(elements, state, "Updating selected services...");

  try {
    for (const serviceId of selectedIds) {
      const result = await crmUpdateRecord(MODULES.bookingServices, {
        id: serviceId,
        Status_EZUS: nextStatus
      });
      const status = String(result.status || result.code || "").toLowerCase();

      if (status && status !== "success") {
        throw new Error(result.message || "Zoho CRM did not confirm the bulk update.");
      }

      const service = state.services.find(function (record) {
        return record.id === serviceId;
      });

      if (service) {
        service.Status_EZUS = nextStatus;
      }
    }

    state.selectedServiceIds = {};
    renderServicesWorkspace();
    setNotice(
      elements,
      "Status updated for " + selectedIds.length + (selectedIds.length === 1 ? " selected service." : " selected services.")
    );
  } catch (error) {
    setError(elements, error.message || "Could not update the selected services.");
  } finally {
    clearLoading(elements, state);
  }
}

export async function onCreateDraftForSelection(purpose, draftLabel) {
  const selectedIds = getSelectedServiceIdsForAction();

  if (!selectedIds.length) {
    return;
  }

  showLoading(elements, state, "Creating " + draftLabel + " draft...");

  try {
    const response = await crmExecuteFunction("drafts_new_createdraftsforselection_1", {
      serviceIds: formatSelectedServiceIds(selectedIds),
      purpose: purpose
    });

    let message = "Draft request created for " + selectedIds.length + (selectedIds.length === 1 ? " service." : " services.");

    if (response && response.details && typeof response.details.output === "string" && response.details.output) {
      message = response.details.output;
    } else if (response && response.message) {
      message = response.message;
    }

    if (reloadBookingWorkspaceHandler) {
      await reloadBookingWorkspaceHandler(state.selectedBookingId, {
        preserveNotice: true,
        preserveSelection: true
      });
    }
    setNotice(elements, message);
  } catch (error) {
    setError(elements, error.message || "Could not create drafts for the selected services.");
  } finally {
    clearLoading(elements, state);
  }
}

export async function onSaveService(event) {
  event.preventDefault();

  if (!state.selectedService) {
    return;
  }

  showLoading(elements, state, "Saving booking service...");

  const payload = {
    id: state.selectedService.id,
    Status_EZUS: elements.fieldStatusEzus.value,
    Service_Notes: elements.fieldServiceNotes.value
  };

  try {
    const result = await crmUpdateRecord(MODULES.bookingServices, payload);
    const status = String(result.status || result.code || "").toLowerCase();

    if (status && status !== "success") {
      throw new Error(result.message || "Zoho CRM did not confirm the update.");
    }

    state.selectedService.Status_EZUS = payload.Status_EZUS;
    state.selectedService.Service_Notes = payload.Service_Notes;
    state.serviceStatusDraftValue = "";

    renderServicesWorkspace();
    playServiceStatusSavedFeedback();
    setNotice(elements, "Booking service updated successfully.");
  } catch (error) {
    setError(elements, error.message || "Could not save the booking service.");
  } finally {
    clearLoading(elements, state);
  }
}

export function toggleServiceSelection(serviceId, isSelected) {
  if (isSelected) {
    state.selectedServiceIds[serviceId] = true;
  } else {
    delete state.selectedServiceIds[serviceId];
  }

  renderServicesWorkspace();
}

export function toggleGroupSelection(stepId, isSelected) {
  const group = state.groupedRows.find(function (row) {
    return row.stepId === stepId;
  });

  if (!group) {
    return;
  }

  group.services.forEach(function (service) {
    if (isSelected) {
      state.selectedServiceIds[service.id] = true;
    } else {
      delete state.selectedServiceIds[service.id];
    }
  });

  renderServicesWorkspace();
}

export function toggleStepCollapsed(stepId) {
  if (state.collapsedStepIds[stepId]) {
    delete state.collapsedStepIds[stepId];
  } else {
    state.collapsedStepIds[stepId] = true;
  }

  renderServicesWorkspace();
}

export function playServiceStatusSavedFeedback() {
  if (!elements.fieldStatusEzus) {
    return;
  }

  elements.fieldStatusEzus.classList.remove("is-updated");
  void elements.fieldStatusEzus.offsetWidth;
  elements.fieldStatusEzus.classList.add("is-updated");

  if (serviceStatusPreviewFeedbackTimeout) {
    window.clearTimeout(serviceStatusPreviewFeedbackTimeout);
  }

  serviceStatusPreviewFeedbackTimeout = window.setTimeout(function () {
    elements.fieldStatusEzus.classList.remove("is-updated");
    serviceStatusPreviewFeedbackTimeout = 0;
  }, 1600);
}

function openRenfePrepaymentDialog() {
  const service = state.selectedService;
  const booking = state.selectedBooking;
  const requestedBy = state.currentUserEmail || booking.Owner && booking.Owner.email || "";
  const values = {
    service_id: service.id || "",
    requested_date: new Date().toISOString().slice(0, 10),
    requested_by: requestedBy,
    mfsp_reference: booking.MFSP_Reference || service.Booking_Reference || "",
    booking_name: booking.Deal_Name || booking.Name || booking.Booking && booking.Booking.name || "",
    localizador_ticket_renfe: getRenfeServiceValue(service, ["Localizador_Ticket_RENFE", "Localizador_RENFE", "RENFE_Ticket_Locator", "Ticket_Locator"]),
    total_tickets_amount: getRenfeServiceValue(service, ["Total_Tickets_Amount", "Total_Purchase_Price", "Purchase_Price", "Total_Amount"]),
    observations: service.Service_Notes || ""
  };
  const dialog = document.createElement("div");
  dialog.className = "booking-action-dialog";
  dialog.innerHTML = [
    '<div class="booking-action-dialog-backdrop"></div>',
    '<div class="booking-action-dialog-panel booking-action-dialog-panel--wide renfe-payment-dialog-panel" role="dialog" aria-modal="true" aria-labelledby="renfe-payment-dialog-title">',
    '<div class="renfe-payment-dialog-heading"><h4 id="renfe-payment-dialog-title">RENFE Payments Form</h4><code class="renfe-payment-service-id">Service ID: ' + escapeHtml(values.service_id) + "</code></div>",
    '<form class="booking-form renfe-payment-form">',
    '<input name="service_id" type="hidden" value="' + escapeHtml(values.service_id) + '">',
    '<div class="renfe-payment-form-grid">',
    renderRenfeField("Requested Date", "requested_date", values.requested_date, { readOnly: true, type: "date" }),
    renderRenfeField("Requested By", "requested_by", values.requested_by, { readOnly: true, type: "email" }),
    renderRenfeField("MFSP Reference", "mfsp_reference", values.mfsp_reference, { readOnly: true, required: true }),
    renderRenfeField("Booking Name", "booking_name", values.booking_name, { readOnly: true, required: true }),
    renderRenfeField("Localizador Ticket RENFE", "localizador_ticket_renfe", values.localizador_ticket_renfe, { required: true }),
    renderRenfeCurrencyField("Total Tickets Amount", "total_tickets_amount", values.total_tickets_amount),
    '<label class="field renfe-payment-observations"><span>Observations</span><textarea name="observations" rows="5">' + escapeHtml(values.observations) + "</textarea></label>",
    "</div>",
    '<div class="booking-action-dialog-footer booking-action-dialog-footer--split"><button class="button tertiary compact" type="button" data-close>Cancel</button><button class="button booking-action-button compact" type="submit">Submit</button></div>',
    "</form></div>"
  ].join("");

  document.body.appendChild(dialog);
  setError(elements, "");
  dialog.querySelector("[data-close]").addEventListener("click", function () { dialog.remove(); });
  dialog.querySelector(".booking-action-dialog-backdrop").addEventListener("click", function () { dialog.remove(); });
  dialog.querySelector("form").addEventListener("submit", async function (event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = form.querySelector('[type="submit"]');
    const payload = Object.fromEntries(new FormData(form));
    const functionName = "customapi_createrenfepayment";

    submitButton.disabled = true;
    submitButton.textContent = "Submitting…";
    try {
      recordRenfePaymentDebug("request", { functionName: functionName, payload: payload });
      const response = await crmExecuteFunction(functionName, {
        requestBody: JSON.stringify(payload)
      });
      recordRenfePaymentDebug("response", { functionName: functionName, payload: payload, response: response });
      const result = extractRenfePaymentResult(response);
      if (result.success === false || result.status === "error" || result.error === true) {
        throw new Error(result.message || "Creator could not record the RENFE payment.");
      }
      dialog.remove();
      setNotice(elements, "RENFE payment recorded successfully.");
    } catch (error) {
      console.error("[RENFE payment] raw CRM SDK error", error);
      recordRenfePaymentDebug("error", { functionName: functionName, payload: payload, error: serializeRenfePaymentError(error) });
      setError(elements, (error && error.message ? error.message : "Could not record the RENFE payment.") + " Check the browser console for [RENFE payment] debug details.");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Submit";
    }
  });
}

function renderRenfeField(label, name, value, options) {
  const settings = options || {};
  const attributes = [
    'name="' + name + '"',
    'value="' + escapeHtml(value) + '"',
    settings.type ? 'type="' + settings.type + '"' : "type=\"text\"",
    settings.readOnly ? "readonly" : "",
    settings.required ? "required" : "",
    settings.step ? 'step="' + settings.step + '"' : "",
    settings.min ? 'min="' + settings.min + '"' : ""
  ].filter(Boolean).join(" ");
  return '<label class="field"><span>' + label + (settings.required ? " <em>*</em>" : "") + "</span><input " + attributes + "></label>";
}

function renderRenfeCurrencyField(label, name, value) {
  return '<label class="field"><span>' + label + ' <em>*</em></span><div class="booking-form-currency"><span class="booking-form-currency-symbol">EUR</span><input name="' + name + '" value="' + escapeHtml(value) + '" type="number" min="0.01" step="0.01" required></div></label>';
}

function getRenfeServiceValue(service, fieldNames) {
  for (let index = 0; index < fieldNames.length; index += 1) {
    const value = service[fieldNames[index]];
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      return typeof value === "object" && value.name ? value.name : String(value);
    }
  }
  return "";
}

function extractRenfePaymentResult(response) {
  const candidate = response && response.details && (response.details.output || response.details.response)
    ? response.details.output || response.details.response
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

function recordRenfePaymentDebug(eventName, details) {
  const entry = {
    at: new Date().toISOString(),
    event: eventName,
    details: details
  };
  window.__renfePaymentDebug = entry;
  if (eventName === "error") {
    console.error("[RENFE payment]", entry);
  } else {
    console.info("[RENFE payment]", entry);
  }
}

function serializeRenfePaymentError(error) {
  if (!error) {
    return { message: "Unknown error" };
  }
  return {
    name: error.name || "Error",
    message: error.message || String(error),
    code: error.code || "",
    details: error.details || ""
  };
}

function toggleAllVisibleServices(isSelected) {
  getVisibleServiceIds().forEach(function (serviceId) {
    if (isSelected) {
      state.selectedServiceIds[serviceId] = true;
    } else {
      delete state.selectedServiceIds[serviceId];
    }
  });

  renderServicesWorkspace();
}

function getColumnEditorRow(target) {
  return target && target.closest ? target.closest(".column-editor-row[data-column-key]") : null;
}

function clearColumnDragIndicators() {
  if (!elements.serviceColumnsList) {
    return;
  }

  Array.prototype.forEach.call(
    elements.serviceColumnsList.querySelectorAll(".column-editor-row.is-dragging, .column-editor-row.is-drag-over-before, .column-editor-row.is-drag-over-after"),
    function (row) {
      row.classList.remove("is-dragging", "is-drag-over-before", "is-drag-over-after");
    }
  );
}

function getVisibleServiceIds() {
  return state.filteredServices.map(function (service) {
    return service.id;
  });
}

function syncSelectAllCheckbox() {
  if (!elements.serviceSelectAll) {
    return;
  }

  const visibleIds = getVisibleServiceIds();
  const selectedVisibleCount = visibleIds.filter(function (serviceId) {
    return Boolean(state.selectedServiceIds[serviceId]);
  }).length;

  elements.serviceSelectAll.checked = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;
  elements.serviceSelectAll.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleIds.length;
  elements.serviceSelectAll.disabled = visibleIds.length === 0;
}

function getVisibleServiceColumnCount() {
  return state.serviceTableColumns.filter(function (entry) {
    return entry.visible;
  }).length;
}

function getDefaultServiceTableColumns() {
  return SERVICE_TABLE_COLUMNS.map(function (column) {
    return {
      key: column.key,
      visible: true
    };
  });
}

function readStoredServiceTableColumns() {
  try {
    const rawValue = window.localStorage.getItem(SERVICE_TABLE_COLUMNS_STORAGE_KEY);

    if (!rawValue) {
      return null;
    }

    return JSON.parse(rawValue);
  } catch (error) {
    return null;
  }
}

function saveServiceTableColumns() {
  try {
    window.localStorage.setItem(
      SERVICE_TABLE_COLUMNS_STORAGE_KEY,
      JSON.stringify(state.serviceTableColumns)
    );
  } catch (error) {
    return;
  }
}

function sanitizeServiceTableColumns(value) {
  const defaults = getDefaultServiceTableColumns();

  if (!Array.isArray(value)) {
    return defaults;
  }

  const knownColumns = {};
  SERVICE_TABLE_COLUMNS.forEach(function (column) {
    knownColumns[column.key] = true;
  });

  const normalized = [];
  const seen = {};

  value.forEach(function (entry) {
    const key = entry && entry.key ? String(entry.key) : "";

    if (!key || !knownColumns[key] || seen[key]) {
      return;
    }

    normalized.push({
      key: key,
      visible: entry.visible !== false
    });
    seen[key] = true;
  });

  defaults.forEach(function (entry) {
    if (!seen[entry.key]) {
      normalized.push(entry);
    }
  });

  if (!normalized.some(function (entry) {
    return entry.visible;
  })) {
    normalized[0].visible = true;
  }

  return normalized;
}

function getSelectedServiceIdsForAction() {
  return Object.keys(state.selectedServiceIds);
}

function formatSelectedServiceIds(serviceIds) {
  return serviceIds.join("|||");
}
