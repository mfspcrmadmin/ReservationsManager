import { SERVICE_TABLE_COLUMNS, STATUS_OPTIONS } from "./constants.js";
import {
  escapeHtml,
  formatCurrency,
  formatDate,
  formatDateTime,
  getBookingOwnerInfo,
  getBookingStageValue,
  getLookupName,
  normalizeComparableText,
  getStepDisplayName,
  getStepInternalName
} from "./utils.js";

let noticeDismissTimer = null;
let noticeExitTimer = null;
let errorExitTimer = null;
const NOTICE_DISMISS_DELAY_MS = 5000;
const FLOATING_MESSAGE_EXIT_MS = 160;

export function hideSearchResults(elements) {
  elements.searchResultsCard.hidden = true;
  elements.searchResultsCount.textContent = "0 matches";
  elements.searchResultsBody.innerHTML = '<tr><td colspan="5" class="table-empty">No matching bookings yet.</td></tr>';
}

export function renderSearchResults(options) {
  const elements = options.elements;
  const records = options.records;
  const onBookingSelected = options.onBookingSelected;

  if (!records || !records.length) {
    hideSearchResults(elements);
    return;
  }

  elements.searchResultsCard.hidden = false;
  elements.searchResultsCount.textContent = records.length + (records.length === 1 ? " match" : " matches");
  elements.searchResultsBody.innerHTML = records.map(function (record) {
    return [
      '<tr data-booking-id="' + escapeHtml(record.id) + '">',
      "  <td>" + escapeHtml(record.MFSP_Reference || "-") + "</td>",
      "  <td>" + escapeHtml(record.Deal_Name || "-") + "</td>",
      "  <td>" + escapeHtml(getLookupName(record.Account_Name) || "-") + "</td>",
      "  <td>" + escapeHtml(getBookingStageValue(record) || "-") + "</td>",
      "  <td>" + escapeHtml(formatDate(record.Arrival_Date)) + "</td>",
      "</tr>"
    ].join("");
  }).join("");

  Array.prototype.forEach.call(elements.searchResultsBody.querySelectorAll("tr[data-booking-id]"), function (row) {
    row.addEventListener("click", function () {
      const bookingId = row.getAttribute("data-booking-id");
      const match = records.find(function (record) {
        return record.id === bookingId;
      });

      if (match) {
        onBookingSelected(match);
      }
    });
  });
}

export function setNotice(elements, message, options) {
  const settings = options || {};
  if (noticeDismissTimer) {
    window.clearTimeout(noticeDismissTimer);
    noticeDismissTimer = null;
  }

  if (message) {
    if (noticeExitTimer) {
      window.clearTimeout(noticeExitTimer);
      noticeExitTimer = null;
    }
    elements.notice.classList.remove("is-dismissing");
    elements.notice.hidden = false;
    elements.noticeText.textContent = message;
  } else {
    dismissFloatingMessage(elements.notice, elements.noticeText, function (timer) {
      noticeExitTimer = timer;
    });
  }
  elements.notice.classList.toggle("is-loading", Boolean(message) && Boolean(settings.loading));

  if (message && !settings.loading) {
    noticeDismissTimer = window.setTimeout(function () {
      setNotice(elements, "");
      noticeDismissTimer = null;
    }, NOTICE_DISMISS_DELAY_MS);
  }
}

export function setError(elements, message) {
  if (message) {
    setNotice(elements, "");
  }
  if (message) {
    if (errorExitTimer) {
      window.clearTimeout(errorExitTimer);
      errorExitTimer = null;
    }
    elements.error.classList.remove("is-dismissing");
    elements.error.hidden = false;
    elements.errorText.textContent = message;
  } else {
    dismissFloatingMessage(elements.error, elements.errorText, function (timer) {
      errorExitTimer = timer;
    });
  }
}

function dismissFloatingMessage(element, textElement, setTimer) {
  if (element.hidden) {
    textElement.textContent = "";
    return;
  }

  element.classList.remove("is-loading");
  element.classList.add("is-dismissing");
  setTimer(window.setTimeout(function () {
    element.hidden = true;
    element.classList.remove("is-dismissing");
    textElement.textContent = "";
    setTimer(null);
  }, FLOATING_MESSAGE_EXIT_MS));
}

export function renderActiveTab(elements, state) {
  const activeTab = state.activeTab || "services";
  const isBookingTab = activeTab === "booking";
  const isServicesTab = activeTab === "services";
  const isEmailsTab = activeTab === "emails";
  const isPaymentsTab = activeTab === "payments";
  const isReportsTab = activeTab === "reports";
  const isDeskTab = activeTab === "desk";
  const isTravelersTab = activeTab === "travelers";

  if (elements.tabBooking) {
    elements.tabBooking.classList.toggle("active", isBookingTab);
  }

  elements.tabServices.classList.toggle("active", isServicesTab);
  elements.tabEmails.classList.toggle("active", isEmailsTab);
  if (elements.tabPayments) {
    elements.tabPayments.classList.toggle("active", isPaymentsTab);
  }
  if (elements.tabReports) {
    elements.tabReports.classList.toggle("active", isReportsTab);
  }
  if (elements.summaryViewDesk) {
    elements.summaryViewDesk.classList.toggle("active", isDeskTab);
  }
  if (elements.tabTravelers) {
    elements.tabTravelers.classList.toggle("active", isTravelersTab);
  }

  if (elements.manageBookingPanel) {
    elements.manageBookingPanel.hidden = !isBookingTab && !isDeskTab;
    elements.manageBookingPanel.classList.toggle("is-desk-view", isDeskTab);
  }

  elements.manageServicesPanel.hidden = !isServicesTab;
  elements.manageEmailsPanel.hidden = !isEmailsTab;
  if (elements.managePaymentsPanel) {
    elements.managePaymentsPanel.hidden = !isPaymentsTab;
  }
  if (elements.manageReportsPanel) {
    elements.manageReportsPanel.hidden = !isReportsTab;
  }
  if (elements.manageTravelersPanel) {
    elements.manageTravelersPanel.hidden = !isTravelersTab;
  }
}

export function setButtonsDisabled(elements, state, disabled) {
  const hasSelectedServices = Object.keys(state.selectedServiceIds).length > 0;
  const hasServicesWorkspace = Boolean(state.selectedBooking) && state.services.length > 0;
  const hasBulkStatusSelection = Boolean(elements.bulkStatusEzus.value);
  elements.loadBooking.disabled = disabled;
  elements.bookingSearch.disabled = disabled;
  if (elements.bookingBrowserOwner) {
    elements.bookingBrowserOwner.disabled = disabled;
  }
  if (elements.bookingBrowserStagesToggle) {
    elements.bookingBrowserStagesToggle.disabled = disabled;
  }
  if (elements.bookingBrowserLoad) {
    elements.bookingBrowserLoad.disabled = disabled;
  }
  if (elements.bookingBrowserSizeToggle) {
    elements.bookingBrowserSizeToggle.disabled = disabled;
  }
  if (elements.bookingBrowserCollapseToggle) {
    elements.bookingBrowserCollapseToggle.disabled = disabled;
  }
  if (elements.bookingBrowserRailToggle) {
    elements.bookingBrowserRailToggle.disabled = disabled;
  }
  [elements.tabBooking, elements.tabServices, elements.tabEmails, elements.tabTravelers].forEach(function (tab) {
    if (tab) {
      tab.disabled = disabled;
    }
  });
  if (elements.clearBooking) {
    elements.clearBooking.disabled = disabled || !state.selectedBooking;
  }
  elements.createAxus.disabled = disabled || !state.selectedBooking;
  elements.syncEzus.disabled = disabled || !state.selectedBooking || state.syncingEzus;
  [elements.syncProjectInfo, elements.syncTravelers, elements.syncServices, elements.syncContact].forEach(function (button) {
    if (button) {
      button.disabled = disabled || !state.selectedBooking || state.syncingEzus;
    }
  });
  elements.openBookingReportDialog.disabled = disabled || !state.selectedBooking;
  elements.createPaymentRequest.disabled = disabled || !state.selectedBooking;
  elements.saveService.disabled = disabled || !state.selectedService;
  elements.fieldStatusEzus.disabled = disabled || !state.selectedService;
  if (elements.serviceActionPrepayment) {
    elements.serviceActionPrepayment.disabled = disabled || !state.selectedService;
  }
  if (elements.serviceActionCardPurchase) {
    elements.serviceActionCardPurchase.disabled = disabled || !state.selectedService;
  }
  if (elements.serviceActionRenfe) {
    elements.serviceActionRenfe.disabled = disabled || !state.selectedService;
  }
  elements.toggleServiceColumns.disabled = disabled;
  elements.resetServiceColumns.disabled = disabled;
  elements.bulkActionMode.disabled = disabled || !hasServicesWorkspace;
  elements.applyBulkStatus.disabled = disabled || !hasSelectedServices || !hasBulkStatusSelection;
  elements.bulkStatusEzus.disabled = disabled || !hasSelectedServices;
  elements.createAvailabilityDraft.disabled = disabled || !hasSelectedServices;
  elements.createReservationsDraft.disabled = disabled || !hasSelectedServices;
  elements.mailEditDraft.disabled = disabled || state.draftEditorSaving || state.draftEditorOpen;

  if (elements.mailDeleteDraft) {
    elements.mailDeleteDraft.disabled = disabled || state.draftEditorSaving || state.draftEditorOpen || state.outlookConfirmOpen;
  }

  if (elements.serviceSelectAll) {
    elements.serviceSelectAll.disabled = disabled || !state.filteredServices.length;
  }
}

export function showLoading(elements, state, message) {
  setError(elements, "");
  setNotice(elements, message, {
    loading: true
  });
  setButtonsDisabled(elements, state, true);
}

export function clearLoading(elements, state) {
  elements.notice.classList.remove("is-loading");
  setButtonsDisabled(elements, state, false);
}

export function populateStatusOptions(elements) {
  const optionsMarkup = STATUS_OPTIONS.map(function (value) {
    return renderStatusOption(value);
  }).join("");
  const bulkOptionsMarkup = ['<option value="">Select status</option>', optionsMarkup].join("");

  elements.fieldStatusEzus.innerHTML = optionsMarkup;
  elements.bulkStatusEzus.innerHTML = bulkOptionsMarkup;
  elements.bulkStatusEzus.value = "";
  applyStatusSelectAppearance(elements.fieldStatusEzus, elements.fieldStatusEzus.value);
  applyStatusSelectAppearance(elements.bulkStatusEzus, "");
}

export function applyStatusSelectAppearance(selectElement, status) {
  if (!selectElement) {
    return;
  }

  const statusSelectModifier = getStatusSelectModifier(status);
  selectElement.className = ["service-status-select", statusSelectModifier].filter(Boolean).join(" ");
}

export function syncBulkActionMode(elements) {
  const mode = elements.bulkActionMode.value || "status";
  elements.bulkStatusPanel.hidden = mode !== "status";
  elements.bulkDraftsPanel.hidden = mode !== "drafts";
}

export function renderBookingSummary(elements, state) {
  const booking = state.selectedBooking;
  const summaryView = state.summaryView || "basic";
  const switchButtons = {
    basic: elements.summaryViewBasic,
    financial: elements.summaryViewFinancial,
    contact: elements.summaryViewContact,
    analytics: elements.summaryViewAnalytics,
    team: elements.summaryViewTeam
  };

  Object.keys(switchButtons).forEach(function (viewKey) {
    const button = switchButtons[viewKey];

    if (!button) {
      return;
    }

    button.classList.toggle("active", summaryView === viewKey);
    button.classList.toggle("is-active", summaryView === viewKey);
    button.setAttribute("aria-selected", summaryView === viewKey ? "true" : "false");
  });

  if (!booking) {
    elements.summaryBookingHero.innerHTML = "";
    elements.summaryContent.innerHTML = renderSummaryEmptyState();
    return;
  }

  elements.summaryBookingHero.innerHTML = renderSummaryHero(booking);
  elements.summaryContent.innerHTML = renderSummaryMainPanel(booking, summaryView);
}

export function renderBookingWorkspace(elements, state) {
  const booking = state.selectedBooking;

  if (!booking) {
    elements.summaryDashboard.innerHTML = renderWorkspaceEmptyState();
    elements.summaryBlueprintPanel.innerHTML = renderBookingBlueprintPlaceholder(
      "Workflow",
      "Load a booking to review its current state and next actions."
    );
    elements.summarySearchShell.classList.remove("is-booking-loaded");
    renderBookingActionArea(elements, null);
    if (elements.clearBooking) {
      elements.clearBooking.disabled = true;
    }
    elements.createAxus.disabled = true;
    elements.syncEzus.disabled = true;
    elements.openBookingReportDialog.disabled = true;
    elements.createPaymentRequest.disabled = true;
    return;
  }

  elements.summaryDashboard.innerHTML = renderWorkspaceDashboard(booking, state);
  elements.summaryBlueprintPanel.innerHTML = renderBookingBlueprintPanel(state);
  elements.summarySearchShell.classList.add("is-booking-loaded");
  renderBookingActionArea(elements, booking);
  if (elements.clearBooking) {
    elements.clearBooking.disabled = false;
  }
  elements.createAxus.disabled = false;
  elements.syncEzus.disabled = state.syncingEzus;
  elements.openBookingReportDialog.disabled = false;
  elements.createPaymentRequest.disabled = false;
}

export function renderTravelersPanel(options) {
  const elements = options.elements;
  const state = options.state;
  const onTravelerSelected = options.onTravelerSelected;
  const travelers = Array.isArray(state.travelers) ? state.travelers : [];
  const selectedTraveler = state.selectedTraveler || null;
  const travelerPhoneFields = ["Pax_Phone", "PAX_Phone", "Phone", "Phone_Number", "Contact_Phone", "Mobile", "Mobile_Phone"];
  const travelerAgeFields = ["New_Age", "Age"];

  ["travelerSelectionTitle", "travelerCount", "travelerEmpty", "travelerPanel", "travelerInfoList", "travelerContactList", "travelerProfileList"].forEach(function (key) {
    if (!elements[key]) {
      elements[key] = { hidden: true, textContent: "", innerHTML: "" };
    }
  });

  if (elements.travelerCount) {
    elements.travelerCount.textContent = travelers.length + (travelers.length === 1 ? " traveler" : " travelers");
  }

  if (!state.selectedBooking) {
    elements.travelerSelectionTitle.textContent = "Selected traveler";
    elements.travelerEmpty.hidden = false;
    elements.travelerEmpty.textContent = "Load a booking to inspect traveler details.";
    elements.travelerPanel.hidden = true;
    elements.travelersBody.innerHTML = '<p class="travelers-list-empty">Load a booking to see travelers.</p>';
    return;
  }

  if (state.travelersLoading) {
    elements.travelerSelectionTitle.textContent = "Selected traveler";
    elements.travelerEmpty.hidden = false;
    elements.travelerEmpty.textContent = "Loading travelers for this booking...";
    elements.travelerPanel.hidden = true;
    elements.travelersBody.innerHTML = '<p class="travelers-list-empty">Loading travelers...</p>';
    return;
  }

  if (state.travelersError) {
    elements.travelerSelectionTitle.textContent = "Selected traveler";
    elements.travelerEmpty.hidden = false;
    elements.travelerEmpty.textContent = state.travelersError;
    elements.travelerPanel.hidden = true;
    elements.travelersBody.innerHTML = '<p class="travelers-list-empty">' + escapeHtml(state.travelersError) + "</p>";
    return;
  }

  if (!travelers.length) {
    elements.travelerSelectionTitle.textContent = "Selected traveler";
    elements.travelerEmpty.hidden = false;
    elements.travelerEmpty.textContent = "No travelers were found for this booking.";
    elements.travelerPanel.hidden = true;
    elements.travelersBody.innerHTML = '<p class="travelers-list-empty">No travelers found for this booking.</p>';
    return;
  }

  elements.travelersBody.innerHTML = travelers.map(function (traveler) {
    var isLeadTraveler = getLeadPaxLabel(traveler.Lead_Pax !== undefined ? traveler.Lead_Pax : traveler.Lead !== undefined ? traveler.Lead : traveler.lead) === "Yes";
    var email = getTravelerFieldText(traveler, ["Email", "email"]);
    var phone = getTravelerFieldText(traveler, travelerPhoneFields.concat(["phone"]));
    var age = getTravelerFieldText(traveler, travelerAgeFields.concat(["age"]));
    var dateOfBirth = getTravelerFieldText(traveler, ["Date_of_Birth", "date_of_birth"]);
    var nationality = getTravelerFieldText(traveler, ["Nationality", "nationality"]);
    var passportNumber = getTravelerFieldText(traveler, ["Passport_Number", "passport_number"]);
    var dietaryRestrictions = getTravelerFieldText(traveler, ["Allergies_Dietary_Restrictions", "allergies_dietary_restrictions"]);
    var mobilityNeeds = getTravelerFieldText(traveler, ["Mobility_Needs", "mobility_needs"]);

    return [
      '<article class="traveler-list-item">',
      '  <header class="traveler-card-header">',
      '    <h3 class="traveler-list-name">' + escapeHtml(buildTravelerDisplayName(traveler)) + "</h3>",
      isLeadTraveler ? '    <span class="traveler-lead-badge">' + travelerIcon("star") + "Lead Traveller</span>" : "",
      "  </header>",
      '  <div class="traveler-contact-details">' +
        buildTravelerFact("mail", "Email", email) +
        buildTravelerFact("phone", "Phone", phone) +
      "  </div>",
      '  <div class="traveler-personal-details">' +
        buildTravelerAgeFact(age, dateOfBirth) +
        buildTravelerPassportFact(passportNumber, nationality) +
      "  </div>",
      '  <div class="traveler-profile-details">' +
        buildTravelerFact("dietary", "Dietary restrictions", dietaryRestrictions) +
        buildTravelerFact("mobility", "Mobility needs", mobilityNeeds) +
      "  </div>",
      "</article>"
    ].join("");
  }).join("");

  if (!selectedTraveler) {
    elements.travelerSelectionTitle.textContent = "Selected traveler";
    elements.travelerEmpty.hidden = false;
    elements.travelerEmpty.textContent = "Select a traveler to inspect the full profile.";
    elements.travelerPanel.hidden = true;
    return;
  }

  elements.travelerSelectionTitle.textContent = buildTravelerDisplayName(selectedTraveler);
  elements.travelerEmpty.hidden = true;
  elements.travelerPanel.hidden = false;
  elements.travelerInfoList.innerHTML = [
    buildCompactDetailRow("Forename", getTravelerFieldText(selectedTraveler, ["Forename"])),
    buildCompactDetailRow("Surname", getTravelerFieldText(selectedTraveler, ["Name"])),
    buildCompactDetailRow("Lead Pax", getLeadPaxLabel(selectedTraveler.Lead_Pax)),
    buildCompactDetailRow("Email", getTravelerFieldText(selectedTraveler, ["Email"])),
    buildCompactDetailRow("Phone", getTravelerFieldText(selectedTraveler, travelerPhoneFields)),
    buildCompactDetailRow("Age", getTravelerFieldText(selectedTraveler, travelerAgeFields)),
    buildCompactDetailRow("Date of birth", getTravelerFieldText(selectedTraveler, ["Date_of_Birth"])),
    buildCompactDetailRow("Passport number", getTravelerFieldText(selectedTraveler, ["Passport_Number"])),
    buildCompactDetailRow("Nationality", getTravelerFieldText(selectedTraveler, ["Nationality"]))
  ].join("");
  elements.travelerContactList.innerHTML = [
    buildCompactDetailRow("Email", getTravelerFieldText(selectedTraveler, ["Email"])),
    buildCompactDetailRow("Phone", getTravelerFieldText(selectedTraveler, travelerPhoneFields))
  ].join("");
  elements.travelerProfileList.innerHTML = [
    buildTravelerProfileRow("Traveler motivation", getTravelerFieldText(selectedTraveler, ["Traveller_Motivation", "Traveler_Motivation"])),
    buildTravelerProfileRow("Special requests", getTravelerFieldText(selectedTraveler, ["Special_Requests"])),
    buildTravelerProfileRow("Size/Weight", getTravelerFieldText(selectedTraveler, ["Size_Weight"])),
    buildTravelerProfileRow("Mobility needs", getTravelerFieldText(selectedTraveler, ["Mobility_Needs"]), "traveler-profile-row--warning"),
    buildTravelerProfileRow("Allergies/Dietary Restrictions", getTravelerFieldText(selectedTraveler, ["Allergies_Dietary_Restrictions"]), "traveler-profile-row--alert")
  ].join("");
}

export function renderBookingBrowser(options) {
  const elements = options.elements;
  const state = options.state;
  const onBookingSelected = options.onBookingSelected;
  const ownerOptions = buildBookingBrowserOwnerOptions(state);
  const stageOptions = buildBookingBrowserStageOptions(state.bookings, state.bookingBrowserStageOptions);
  const hasStageOptions = stageOptions.length > 0;
  const filteredBookings = filterBookingsForBrowser(state.bookings, state);
  const pendingOwnerId = state.bookingBrowserPendingOwnerId || "";
  const pendingStages = Array.isArray(state.bookingBrowserPendingStages) ? state.bookingBrowserPendingStages : [];
  const canApplyFilters = Boolean(pendingOwnerId && pendingStages.length);

  elements.bookingBrowserOwner.innerHTML = ownerOptions.map(function (option) {
    return '<option value="' + escapeHtml(option.value) + '"' + (option.value === pendingOwnerId ? " selected" : "") + ">" +
      escapeHtml(option.label) +
      "</option>";
  }).join("");

  elements.bookingBrowserStagesMenu.innerHTML = hasStageOptions
    ? [
      '<label class="booking-stage-option booking-stage-option--toggle-all">',
      '  <input type="checkbox" data-stage-filter-toggle-all' + (pendingStages.length === stageOptions.length ? " checked" : "") + '>',
      '  <span>Select / deselect all</span>',
      "</label>",
      stageOptions.map(function (stageValue) {
        const isSelected = pendingStages.indexOf(stageValue) !== -1;
        return [
          '<label class="booking-stage-option">',
          '  <input type="checkbox" data-stage-filter value="' + escapeHtml(stageValue) + '"' + (isSelected ? " checked" : "") + '>',
          '  <span>' + escapeHtml(stageValue) + "</span>",
          "</label>"
        ].join("");
      }).join("")
    ].join("")
    : '<div class="booking-stage-empty">No stages available in the current booking list.</div>';
  elements.bookingBrowserStagesMenu.hidden = !state.bookingBrowserStagesMenuOpen;
  elements.bookingBrowserStagesToggle.textContent = hasStageOptions
    ? getBookingBrowserStagesLabel(stageOptions, pendingStages)
    : "No stages available";
  elements.bookingBrowserStagesToggle.disabled = !hasStageOptions;
  elements.bookingBrowserLoad.disabled = !canApplyFilters;
  elements.bookingBrowserStagesToggle.setAttribute("aria-expanded", state.bookingBrowserStagesMenuOpen ? "true" : "false");
  elements.bookingBrowserStagesMenu.setAttribute("aria-hidden", state.bookingBrowserStagesMenuOpen ? "false" : "true");

  var stageFilterContainer = elements.bookingBrowserStagesToggle.closest(".booking-stage-filter");

  if (stageFilterContainer) {
    stageFilterContainer.classList.toggle("is-open", state.bookingBrowserStagesMenuOpen);
    stageFilterContainer.classList.toggle("is-empty", !hasStageOptions);
  }

  elements.bookingBrowserCount.textContent = filteredBookings.length + (filteredBookings.length === 1 ? " booking found" : " bookings found");

  if (state.bookingBrowserLoading) {
    elements.bookingBrowserBody.innerHTML = [
      '<tr>',
      '  <td colspan="4" class="table-empty table-empty-loading">',
      '    <span class="table-loading-indicator" aria-hidden="true"></span>',
      '  </td>',
      '</tr>'
    ].join("");
    return;
  }

  if (!filteredBookings.length) {
    var emptyMessage = !state.bookingBrowserFiltersApplied
      ? "Load bookings to see results."
      : !state.bookingBrowserOwnerId
        ? "Select an owner to show bookings."
        : !state.bookingBrowserStages.length
          ? "Select at least one stage to show bookings."
          : "No bookings match the selected owner and stages.";

    elements.bookingBrowserBody.innerHTML = '<tr><td colspan="4" class="table-empty">' + escapeHtml(emptyMessage) + "</td></tr>";
    return;
  }

  elements.bookingBrowserBody.innerHTML = filteredBookings.map(function (booking) {
    const isActive = booking.id === state.selectedBookingId ? " active-row" : "";

    return [
      '<tr class="booking-browser-row' + isActive + '" data-browser-booking-id="' + escapeHtml(booking.id) + '">',
      "  <td>" + escapeHtml(booking.MFSP_Reference || "-") + "</td>",
      "  <td>" + escapeHtml(booking.Deal_Name || "-") + "</td>",
      "  <td>" + escapeHtml(getBookingStageValue(booking) || "-") + "</td>",
      "  <td>" + escapeHtml(formatDate(booking.Arrival_Date)) + "</td>",
      "</tr>"
    ].join("");
  }).join("");

  Array.prototype.forEach.call(elements.bookingBrowserBody.querySelectorAll("tr[data-browser-booking-id]"), function (row) {
    row.addEventListener("click", function () {
      const bookingId = row.getAttribute("data-browser-booking-id");
      const booking = state.bookings.find(function (entry) {
        return entry.id === bookingId;
      });

      if (booking) {
        onBookingSelected(booking);
      }
    });
  });
}

function renderSummaryEmptyState() {
  return [
    '<section class="summary-empty-state">',
    '  <span class="summary-empty-eyebrow">No booking loaded</span>',
    '  <strong>Select a booking to see its operational context.</strong>',
    '  <p>Use the search field or the booking queue to load a record and continue working without switching views.</p>',
    "</section>"
  ].join("");
}

function renderWorkspaceEmptyState() {
  return [
    '<div class="workspace-dashboard-grid">',
    '  <section class="workspace-surface">',
    '    <div class="workspace-surface-header">',
    "      <h3>Quick access</h3>",
    "    </div>",
    '    <div class="workspace-system-grid">',
    buildWorkspaceSystemButton("Desk", "desk", true),
    buildWorkspaceSystemButton("Ezus", "ezus", true),
    buildWorkspaceSystemButton("WorkDrive", "workdrive", true),
    buildWorkspaceSystemButton("Itinerary Link", "itinerary", true),
    "    </div>",
    '    <div class="workspace-admin-grid">',
    buildWorkspaceAdminButton("Travelers Payments", "travellers-payments", true),
    buildWorkspaceAdminButton("Prepayments", "prepayments", true),
    "    </div>",
    "  </section>",
    "</div>"
  ].join("");
}

function renderWorkspaceDashboard(booking, state) {
  return [
    '<div class="workspace-dashboard-grid">',
    '  <section class="workspace-surface">',
    '    <div class="workspace-surface-header">',
    "      <h3>Quick access</h3>",
    "    </div>",
    '    <div class="workspace-system-grid">',
    buildWorkspaceSystemButton("Desk", "desk"),
    buildWorkspaceSystemButton("Ezus", "ezus"),
    buildWorkspaceSystemButton("WorkDrive", "workdrive"),
    buildWorkspaceSystemButton("Itinerary Link", "itinerary"),
    "    </div>",
    '    <div class="workspace-admin-grid">',
    buildWorkspaceAdminButton("Travelers Payments", "travellers-payments"),
    buildWorkspaceAdminButton("Prepayments", "prepayments"),
    "    </div>",
    "  </section>",
    "</div>"
  ].join("");
}

function renderBookingActionArea(elements, booking) {
  if (!booking) {
    elements.actionEzusSyncAt.textContent = "-";
    elements.actionEzusSyncBy.textContent = "-";
    elements.actionHasAxus.textContent = "Not set";
    elements.actionHasAxus.className = "action-status-badge action-status-badge--neutral";
    elements.actionEzusSyncWarning.hidden = true;
    elements.actionEzusSyncWarning.textContent = "";
    elements.actionEzusSyncWarning.className = "action-sync-message";
    return;
  }

  const lastSyncAtRaw = getBookingRawValue(booking, [
    "Last_Ezus_Sync_At",
    "Last EZUS Sync At",
    "Last_EZUS_Sync_At"
  ]);
  const lastSyncBy = getBookingValue(booking, [
    "Last_Ezus_Sync_By",
    "Last EZUS Sync By",
    "Last_EZUS_Sync_By"
  ]);
  const hasAxus = getBookingValue(booking, [
    "Has_Axus",
    "Has AXUS",
    "Has_Axus_",
    "AXUS_Created"
  ]);
  const hasAxusState = resolveHasAxusState(hasAxus);
  const syncMessage = buildEzusSyncMessage(booking, lastSyncAtRaw);

  elements.actionEzusSyncAt.textContent = lastSyncAtRaw ? formatDateTime(lastSyncAtRaw) : "-";
  elements.actionEzusSyncBy.textContent = lastSyncBy || "-";
  elements.actionHasAxus.textContent = hasAxusState.label;
  elements.actionHasAxus.className = "action-status-badge " + hasAxusState.className;
  elements.actionEzusSyncWarning.hidden = !syncMessage;
  elements.actionEzusSyncWarning.textContent = syncMessage ? syncMessage.text : "";
  elements.actionEzusSyncWarning.className = "action-sync-message " + (syncMessage ? syncMessage.className : "");
}

function renderSummaryMainPanel(booking, viewName) {
  if (viewName === "financial") {
    return renderFinancialSummaryView(booking);
  }

  const summaryViews = {
    basic: {
      title: "Core details",
      items: [
        buildSummaryItem("MFSP", booking.MFSP_Reference || "-"),
        buildSummaryItem("Agency", getLookupName(booking.Account_Name) || "-"),
        buildSummaryItem("Booking owner", getLookupName(booking.Owner) || "-"),
        buildSummaryItem("Primary contact", getLookupName(booking.Contact_Name) || "-"),
        buildSummaryItem("Traveler type", getBookingValue(booking, ["Traveler_Type"])),
        buildSummaryItem("Trip type", getBookingValue(booking, ["Trip_Type"]))
      ]
    },
    contact: {
      title: "Contacts",
      items: [
        buildSummaryItem("Contact name", getLookupName(booking.Contact_Name) || "-"),
        buildSummaryItem("Contact email", getBookingValue(booking, ["Agent_Email", "Travel_Agent_Email"])),
        buildSummaryItem("Agency", getLookupName(booking.Account_Name) || "-")
      ]
    },
    analytics: {
      title: "Trip profile",
      items: [
        buildSummaryItem("Traveler type", getBookingValue(booking, ["Traveler_Type"])),
        buildSummaryItem("Trip type", getBookingValue(booking, ["Trip_Type"])),
        buildSummaryItem("Department", getBookingValue(booking, ["Department"])),
        buildSummaryItem("Client type", getBookingValue(booking, ["Client_Type"])),
        buildSummaryItem("Countries visited", getBookingValue(booking, ["Countries_Visited"]))
      ]
    },
    team: {
      title: "Internal ownership",
      items: [
        buildSummaryItem("Booking owner", getLookupName(booking.Owner) || "-"),
        buildSummaryItem("Sales rep", getBookingValue(booking, ["Sales_Rep", "Sales_Representative", "Salesperson"])),
        buildSummaryItem("Reservations rep", getBookingValue(booking, ["Reservation_Rep", "Reservations_Rep", "Reservations_Representative"])),
        buildSummaryItem("Accounting rep", getBookingValue(booking, ["Accounting_Rep", "Accounting_Representative"])),
        buildSummaryItem("Guest relations", getBookingValue(booking, ["Guest_Relations_Rep", "Guest_Relations_Representative"])),
        buildSummaryItem("24h rep", getBookingValue(booking, ["Hour_Rep", "Rep_24h", "24h_Rep", "TwentyFourHour_Rep", "TwentyFour_Hour_Rep"]))
      ]
    }
  };
  const section = summaryViews[viewName] || summaryViews.basic;

  return [
    '<div class="summary-view-layout">',
    '  <section class="summary-section">',
    '    <div class="summary-section-header">',
    '      <h2>' + escapeHtml(section.title) + "</h2>",
    "    </div>",
    '    <div class="summary-cards-grid">' + section.items.join("") + "</div>",
    "  </section>",
    "</div>"
  ].join("");
}

function renderBookingBlueprintPanel(state) {
  const blueprintState = state.bookingBlueprint;
  const processInfo = blueprintState && blueprintState.processInfo && typeof blueprintState.processInfo === "object"
    ? blueprintState.processInfo
    : {};
  const currentPicklist = processInfo.current_picklist && typeof processInfo.current_picklist === "object"
    ? processInfo.current_picklist
    : {};
  const transitions = Array.isArray(blueprintState && blueprintState.transitions)
    ? blueprintState.transitions
    : [];
  const currentStateLabel = currentPicklist.value || processInfo.field_value || "-";
  const currentStateColor = currentPicklist.colour_code || "#0f766e";

  if (state.bookingBlueprintLoading) {
    return renderBookingBlueprintPlaceholder(
      "Workflow",
      "Fetching the current stage and available actions for this booking.",
      "summary-blueprint-panel--loading"
    );
  }

  if (state.bookingBlueprintError) {
    return renderBookingBlueprintPlaceholder(
      "Workflow",
      state.bookingBlueprintError,
      "summary-blueprint-panel--error"
    );
  }

  return [
    '<aside class="summary-blueprint-panel">',
    '  <div class="summary-blueprint-header">',
    "    <h3>Booking workflow</h3>",
    "  </div>",
    '  <div class="summary-blueprint-current">',
    '    <span class="label">Current stage</span>',
    '    <div class="summary-blueprint-state-row">',
    '      <span class="summary-blueprint-state" style="' + escapeHtml(buildBlueprintStateStyle(currentStateColor)) + '">' + escapeHtml(currentStateLabel) + "</span>",
    "    </div>",
    "  </div>",
    '  <div class="summary-blueprint-actions">',
    '    <div class="summary-blueprint-actions-top">',
    '      <span class="label">Next actions</span>',
      '      <span class="badge subtle">' + escapeHtml(String(transitions.length)) + (transitions.length === 1 ? " action" : " actions") + "</span>",
    "    </div>",
    transitions.length ? renderBookingBlueprintTransitions(transitions) : '<div class="summary-blueprint-empty">No transitions are currently available for this booking.</div>',
    "  </div>",
    "</aside>"
  ].join("");
}

function renderBookingBlueprintPlaceholder(title, message, modifierClass) {
  const panelClassName = ["summary-blueprint-panel", modifierClass || ""].filter(Boolean).join(" ");

  return [
    '<aside class="' + escapeHtml(panelClassName) + '">',
    '  <div class="summary-blueprint-header">',
    "    <h3>Booking workflow</h3>",
    "  </div>",
    '  <div class="summary-blueprint-empty summary-blueprint-empty--panel">' + escapeHtml(message || "") + "</div>",
    "</aside>"
  ].join("");
}

function renderBookingBlueprintTransitions(transitions) {
  return '<div class="summary-blueprint-transition-list">' + transitions.map(function (transition) {
    const transitionId = transition && transition.id ? String(transition.id) : "";
    const transitionName = transition && transition.name ? String(transition.name) : (transition && transition.next_field_value ? String(transition.next_field_value) : "Transition");
    const transitionColor = transition && transition.color_code ? String(transition.color_code) : "#eefaf7";
    const transitionTextColor = transition && transition.text_color_code ? String(transition.text_color_code) : "#132019";
    const transitionFields = Array.isArray(transition && transition.fields) ? transition.fields : [];
    const requiresFields = transitionFields.length > 0;
    const isDisabled = transition && transition.criteria_matched === false;
    const helperText = requiresFields
      ? transitionFields.length + (transitionFields.length === 1 ? " required field" : " required fields")
      : transition && transition.next_field_value
        ? "Move to: " + transition.next_field_value
        : "Ready to run";

    return [
      '<button class="blueprint-transition-button" type="button" data-blueprint-transition-id="' + escapeHtml(transitionId) + '" data-blueprint-transition-name="' + escapeHtml(transitionName) + '" style="' + escapeHtml(buildBlueprintTransitionStyle(transitionColor, transitionTextColor)) + '"' + (isDisabled ? " disabled" : "") + ">",
      '  <span class="blueprint-transition-button-name">' + escapeHtml(transitionName) + "</span>",
      '  <span class="blueprint-transition-button-meta">' + escapeHtml(helperText) + "</span>",
      "</button>"
    ].join("");
  }).join("") + "</div>";
}

function buildBlueprintStateStyle(color) {
  return [
    "background:" + color,
    "border-color:" + color,
    "color:" + getReadableTextColor(color)
  ].join("; ");
}

function buildBlueprintTransitionStyle(backgroundColor, textColor) {
  const softenedBackground = buildSoftenedBlueprintColor(backgroundColor, 0.2);
  const softenedBorder = buildSoftenedBlueprintColor(backgroundColor, 0.72);
  const metaColor = "rgba(19,32,25,0.72)";

  return [
    "background:" + softenedBackground,
    "border-color:" + softenedBorder,
    "color:#132019",
    "--blueprint-meta-color:" + metaColor
  ].join("; ");
}

function getReadableTextColor(color) {
  const hex = String(color || "").replace("#", "").trim();

  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return "#ffffff";
  }

  const red = parseInt(hex.slice(0, 2), 16);
  const green = parseInt(hex.slice(2, 4), 16);
  const blue = parseInt(hex.slice(4, 6), 16);
  const luminance = (red * 0.299) + (green * 0.587) + (blue * 0.114);

  return luminance > 170 ? "#132019" : "#ffffff";
}

function buildSoftenedBlueprintColor(color, alpha) {
  const hex = String(color || "").replace("#", "").trim();

  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return color;
  }

  const red = parseInt(hex.slice(0, 2), 16);
  const green = parseInt(hex.slice(2, 4), 16);
  const blue = parseInt(hex.slice(4, 6), 16);

  return "rgba(" + red + ", " + green + ", " + blue + ", " + alpha + ")";
}

function buildSummaryItem(label, value) {
  const normalizedValue = value !== null && value !== undefined && value !== "" ? String(value) : "-";

  return [
    '<article class="summary-card-item">',
    '  <span class="label">' + escapeHtml(label) + "</span>",
    '  <strong>' + escapeHtml(normalizedValue) + "</strong>",
    "</article>"
  ].join("");
}

function renderFinancialSummaryView(booking) {
  const leftColumn = [
    buildSummaryMetricRow("Sales Price", formatCurrency(booking.Sales_Price_inc_Taxes)),
    buildSummaryMetricRow("Purchase Price", formatCurrency(booking.Purchase_Price_inc_Taxes)),
    buildSummaryMetricRow("Gross Margin", formatCurrency(getGrossMarginValue(booking))),
    buildSummaryMetricRow("Net Margin", formatCurrency(getNetMarginValue(booking)))
  ];
  const rightColumn = [
    buildSummaryMetricRow("Balance Amount", formatCurrency(booking.Balance_Amount)),
    buildSummaryMetricRow("Total Requested Amount", formatCurrency(getBookingRawValue(booking, ["Total_Requested_Amount"]))),
    buildSummaryMetricRow("Total Paid Amount", formatCurrency(getBookingRawValue(booking, ["Total_Paid_Amount"]))),
    buildSummaryMetricRow("Total Refund Amount", formatCurrency(getBookingRawValue(booking, ["Total_Refund_Amount"])))
  ];

  return [
    '<div class="summary-view-layout">',
    '  <section class="summary-section">',
    '    <div class="summary-section-header">',
    "      <h2>Financial snapshot</h2>",
    "    </div>",
    '    <div class="summary-financial-grid">',
    '      <section class="summary-metric-panel"><h3>Revenue</h3>' + leftColumn.join("") + "</section>",
    '      <section class="summary-metric-panel"><h3>Payments</h3>' + rightColumn.join("") + "</section>",
    "    </div>",
    "  </section>",
    "</div>"
  ].join("");
}

function buildSummaryMetricRow(label, value) {
  return [
    '<div class="summary-metric-row">',
    '  <span class="label">' + escapeHtml(label) + "</span>",
    '  <strong>' + escapeHtml(value !== null && value !== undefined && value !== "" ? String(value) : "-") + "</strong>",
    "</div>"
  ].join("");
}

function renderSummaryHero(booking) {
  return [
    '<section class="summary-overview-hero">',
    '  <div class="summary-overview-bar">',
    '    <span class="summary-overview-kicker">Active booking</span>',
    '    <strong class="summary-overview-bar-title">' + escapeHtml(booking.Deal_Name || booking.MFSP_Reference || "Booking") + "</strong>",
    '    <span class="summary-overview-bar-divider" aria-hidden="true">|</span>',
    '    <span class="summary-overview-subtitle">MFSP ' + escapeHtml(booking.MFSP_Reference || "-") + "</span>",
    "  </div>",
    '  <div class="summary-overview-meta summary-overview-meta-inline">',
    '    <article class="summary-overview-meta-item">',
    '      <span class="label">Arrival</span>',
    '      <strong>' + escapeHtml(formatDate(booking.Arrival_Date)) + '</strong>',
    "    </article>",
    '    <article class="summary-overview-meta-item">',
    '      <span class="label">Departure</span>',
    '      <strong>' + escapeHtml(formatDate(booking.Departure_Date)) + '</strong>',
    "    </article>",
    '    <article class="summary-overview-meta-item">',
    '      <span class="label">Trip Duration</span>',
    '      <strong>' + escapeHtml(getTripDurationLabel(booking)) + '</strong>',
    "    </article>",
    '    <article class="summary-overview-meta-item">',
    '      <span class="label">Travelers</span>',
    '      <strong>' + escapeHtml(firstTextValue(booking.Travelers_Number, booking.Travellers_Number)) + '</strong>',
    "    </article>",
    "  </div>",
    "</section>"
  ].join("");
}

function getTripDurationLabel(booking) {
  var explicitDuration = getBookingValue(booking, ["Trip_Duration", "Trip_Duration_Days"]);

  if (explicitDuration && explicitDuration !== "-") {
    return explicitDuration;
  }

  var arrival = parseDateOnlyValue(booking.Arrival_Date);
  var departure = parseDateOnlyValue(booking.Departure_Date);

  if (!arrival || !departure) {
    return "-";
  }

  var diffDays = Math.round((departure.getTime() - arrival.getTime()) / (24 * 60 * 60 * 1000));
  var normalizedDays = Math.max(diffDays, 1);

  return normalizedDays + (normalizedDays === 1 ? " day" : " days");
}

function parseDateOnlyValue(value) {
  var normalized = String(value || "").trim();

  if (!normalized) {
    return null;
  }

  var match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (!match) {
    return null;
  }

  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function buildWorkspaceSystemButton(label, systemKey, isDisabled) {
  return [
    '<button class="workspace-system-button" type="button" data-workspace-link="' + escapeHtml(systemKey) + '"' + (isDisabled ? " disabled" : "") + ">",
    '  <span class="workspace-system-title">' + escapeHtml(label) + "</span>",
    "</button>"
  ].join("");
}

function buildWorkspaceAdminButton(label, linkKey, isDisabled) {
  return [
    '<button class="workspace-admin-button" type="button" data-workspace-link="' + escapeHtml(linkKey) + '"' + (isDisabled ? " disabled" : "") + ">",
    '  <span class="workspace-admin-title">' + escapeHtml(label) + "</span>",
    "</button>"
  ].join("");
}

function buildEzusSyncMessage(booking, lastSyncAtRaw) {
  const stage = String(getBookingStageValue(booking) || "").trim();
  const staleStages = {
    testing: true,
    "reservation in progress": true,
    "reservation in progresss": true,
    "changes requested": true,
    quotation: true
  };
  const normalizedStage = normalizeComparableText(stage);

  if (!lastSyncAtRaw) {
    return {
      text: staleStages[normalizedStage]
        ? "Synchronization required: this trip is in an active stage and no EZUS sync has been recorded yet."
        : "No EZUS sync has been recorded yet for this trip.",
      className: staleStages[normalizedStage] ? "action-sync-message--alert" : "action-sync-message--success"
    };
  }

  const lastSyncAt = new Date(lastSyncAtRaw);

  if (Number.isNaN(lastSyncAt.getTime())) {
    return {
      text: "The last EZUS sync date is not available yet.",
      className: "action-sync-message--success"
    };
  }

  const elapsedMs = Date.now() - lastSyncAt.getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const relativeText = formatElapsedTime(elapsedMs);

  if (staleStages[normalizedStage] && elapsedMs > dayMs) {
    return {
      text: "Synchronization required: this trip was last synced " + relativeText + " ago.",
      className: "action-sync-message--alert"
    };
  }

  return {
    text: "This trip was synced " + relativeText + " ago.",
    className: "action-sync-message--success"
  };
}

function resolveHasAxusState(value) {
  const normalizedValue = normalizeComparableText(value);

  if (normalizedValue.indexOf("yes") !== -1) {
    return {
      label: "AXUS",
      className: "action-status-badge--axus"
    };
  }

  if (normalizedValue === "no" || normalizedValue.indexOf("no") !== -1) {
    return {
      label: "EZUS",
      className: "action-status-badge--ezus"
    };
  }

  return {
    label: value || "AXUS status unknown",
    className: "action-status-badge--neutral"
  };
}

function formatElapsedTime(elapsedMs) {
  var minuteMs = 60 * 1000;
  var hourMs = 60 * minuteMs;
  var dayMs = 24 * hourMs;
  var roundedValue;

  if (elapsedMs < hourMs) {
    roundedValue = Math.max(1, Math.floor(elapsedMs / minuteMs));
    return roundedValue + (roundedValue === 1 ? " minute" : " minutes");
  }

  if (elapsedMs < dayMs) {
    roundedValue = Math.max(1, Math.floor(elapsedMs / hourMs));
    return roundedValue + (roundedValue === 1 ? " hour" : " hours");
  }

  roundedValue = Math.max(1, Math.floor(elapsedMs / dayMs));
  return roundedValue + (roundedValue === 1 ? " day" : " days");
}

function buildBookingBrowserOwnerOptions(state) {
  if (Array.isArray(state.bookingBrowserOwnerOptions) && state.bookingBrowserOwnerOptions.length) {
    return [{ value: "", label: "Select owner" }].concat(state.bookingBrowserOwnerOptions);
  }

  const ownersById = {};

  state.bookings.forEach(function (booking) {
    const owner = getBookingOwnerInfo(booking);

    if (!owner || !owner.value || ownersById[owner.value]) {
      return;
    }

    ownersById[owner.value] = owner.label;
  });

  return [{ value: "", label: "Select owner" }].concat(
    Object.keys(ownersById).sort(function (left, right) {
      return ownersById[left].localeCompare(ownersById[right]);
    }).map(function (ownerId) {
      return {
        value: ownerId,
        label: ownersById[ownerId]
      };
    })
  );
}


function renderServiceFilterControls(elements, state) {
  const filters = state.serviceFilters || {
    status: [],
    supplier: "",
    category: [],
    subcategory: [],
    subdestination: []
  };
  const options = buildServiceFilterOptions(state.services);

  renderServiceMultiFilter(
    elements.serviceFilterStatusToggle,
    elements.serviceFilterStatusMenu,
    options.status,
    filters.status,
    state.serviceFilterMenuOpen === "status",
    "All statuses"
  );
  renderServiceSupplierFilter(elements.serviceFilterSupplier, options.supplier, filters.supplier);
  renderServiceMultiFilter(
    elements.serviceFilterCategoryToggle,
    elements.serviceFilterCategoryMenu,
    options.category,
    filters.category,
    state.serviceFilterMenuOpen === "category",
    "All categories"
  );
  renderServiceMultiFilter(
    elements.serviceFilterSubcategoryToggle,
    elements.serviceFilterSubcategoryMenu,
    options.subcategory,
    filters.subcategory,
    state.serviceFilterMenuOpen === "subcategory",
    "All subcategories"
  );
  renderServiceMultiFilter(
    elements.serviceFilterSubdestinationToggle,
    elements.serviceFilterSubdestinationMenu,
    options.subdestination,
    filters.subdestination,
    state.serviceFilterMenuOpen === "subdestination",
    "All subdestinations"
  );
}

function renderServiceMultiFilter(toggleElement, menuElement, options, selectedValues, isOpen, emptyLabel) {
  const selected = Array.isArray(selectedValues) ? selectedValues : [];
  const hasOptions = options.length > 0;

  toggleElement.textContent = hasOptions
    ? getServiceMultiFilterLabel(options, selected, emptyLabel)
    : emptyLabel;
  toggleElement.disabled = !hasOptions;
  toggleElement.setAttribute("aria-expanded", isOpen ? "true" : "false");

  menuElement.innerHTML = hasOptions
    ? options.map(function (optionValue) {
      const isSelected = selected.indexOf(optionValue) !== -1;
      return [
        '<label class="service-multi-filter-option">',
        '  <input type="checkbox" data-service-filter-option value="' + escapeHtml(optionValue) + '"' + (isSelected ? " checked" : "") + '>',
        '  <span>' + escapeHtml(optionValue) + "</span>",
        "</label>"
      ].join("");
    }).join("")
    : '<div class="service-multi-filter-empty">No options available.</div>';
  menuElement.hidden = !isOpen || !hasOptions;
  menuElement.setAttribute("aria-hidden", isOpen && hasOptions ? "false" : "true");

  var filterContainer = toggleElement.closest(".service-multi-filter");

  if (filterContainer) {
    filterContainer.classList.toggle("is-open", isOpen && hasOptions);
    filterContainer.classList.toggle("is-empty", !hasOptions);
  }
}

function renderServiceSupplierFilter(selectElement, options, selectedValue) {
  selectElement.innerHTML = ['<option value="">All suppliers</option>'].concat(
    options.map(function (optionValue) {
      return '<option value="' + escapeHtml(optionValue) + '"' + (optionValue === selectedValue ? " selected" : "") + ">" +
        escapeHtml(optionValue) +
        "</option>";
    })
  ).join("");
  selectElement.disabled = options.length === 0;
}

function buildServiceFilterOptions(services) {
  return {
    status: getServiceFilterOptionList(services, function (service) {
      return service.Status_EZUS || "";
    }, STATUS_OPTIONS),
    supplier: getServiceFilterOptionList(services, function (service) {
      return service.Supplier_Name || "";
    }),
    category: getServiceFilterOptionList(services, function (service) {
      return service.Category || "";
    }),
    subcategory: getServiceFilterOptionList(services, function (service) {
      return service.Subcategory || "";
    }),
    subdestination: getServiceFilterOptionList(services, function (service) {
      return service.Subdestination || "";
    })
  };
}

function getServiceFilterOptionList(services, reader, preferredOrder) {
  const seen = {};
  const options = [];

  (services || []).forEach(function (service) {
    var value = String(reader(service) || "").trim();

    if (!value || seen[value]) {
      return;
    }

    seen[value] = true;
    options.push(value);
  });

  if (Array.isArray(preferredOrder) && preferredOrder.length) {
    return preferredOrder.filter(function (value) {
      return seen[value];
    }).concat(
      options.filter(function (value) {
        return preferredOrder.indexOf(value) === -1;
      }).sort(function (left, right) {
        return left.localeCompare(right);
      })
    );
  }

  return options.sort(function (left, right) {
    return left.localeCompare(right);
  });
}

function getServiceMultiFilterLabel(options, selectedValues, emptyLabel) {
  if (!selectedValues.length) {
    return emptyLabel;
  }

  if (selectedValues.length === options.length) {
    return emptyLabel;
  }

  if (selectedValues.length === 1) {
    return selectedValues[0];
  }

  return selectedValues.length + " selected";
}

function buildBookingBrowserStageOptions(bookings, fallbackStages) {
  if (Array.isArray(fallbackStages) && fallbackStages.length) {
    return fallbackStages.slice().sort();
  }

  const seen = {};
  const stages = [];

  bookings.forEach(function (booking) {
    var stage = String(getBookingStageValue(booking) || "").trim();

    if (!stage || seen[stage]) {
      return;
    }

    seen[stage] = true;
    stages.push(stage);
  });

  (fallbackStages || []).forEach(function (stage) {
    var normalizedStage = String(stage || "").trim();

    if (!normalizedStage || seen[normalizedStage]) {
      return;
    }

    seen[normalizedStage] = true;
    stages.push(normalizedStage);
  });

  return stages.sort();
}

function filterBookingsForBrowser(bookings, state) {
  if (!state.bookingBrowserFiltersApplied || !state.bookingBrowserOwnerId || !state.bookingBrowserStages.length) {
    return [];
  }

  var selectedStages = state.bookingBrowserStages.map(function (stage) {
    return normalizeComparableText(stage);
  });

  return bookings.filter(function (booking) {
    const owner = getBookingOwnerInfo(booking);
    const stageValue = normalizeComparableText(getBookingStageValue(booking) || "");
    const matchesOwner = !state.bookingBrowserOwnerId || owner && owner.value === state.bookingBrowserOwnerId;
    const matchesStage = !selectedStages.length || selectedStages.indexOf(stageValue) !== -1;

    return matchesOwner && matchesStage;
  }).sort(function (left, right) {
    const leftArrival = left.Arrival_Date || "";
    const rightArrival = right.Arrival_Date || "";

    if (leftArrival === rightArrival) {
      return String(left.Deal_Name || "").localeCompare(String(right.Deal_Name || ""));
    }

    return leftArrival.localeCompare(rightArrival);
  });
}

function getBookingValue(booking, keys) {
  var rawValue = getBookingRawValue(booking, keys);

  if (rawValue === null || rawValue === undefined || rawValue === "") {
    return "-";
  }

  if (typeof rawValue === "object") {
    return getLookupName(rawValue) || "-";
  }

  return String(rawValue);
}

function getBookingRawValue(booking, keys) {
  for (var index = 0; index < keys.length; index += 1) {
    var value = booking[keys[index]];

    if (value === null || value === undefined || value === "") {
      continue;
    }

    return value;
  }

  return "";
}

function getGrossMarginValue(booking) {
  var rawValue = getBookingRawValue(booking, ["Gross_Margin", "Gross_Margin_Amount"]);

  if (rawValue !== "") {
    return rawValue;
  }

  if (booking.Sales_Price_inc_Taxes !== null && booking.Sales_Price_inc_Taxes !== undefined && booking.Sales_Price_inc_Taxes !== "" &&
      booking.Purchase_Price_inc_Taxes !== null && booking.Purchase_Price_inc_Taxes !== undefined && booking.Purchase_Price_inc_Taxes !== "") {
    return (Number(booking.Sales_Price_inc_Taxes) || 0) - (Number(booking.Purchase_Price_inc_Taxes) || 0);
  }

  return "";
}

function getNetMarginValue(booking) {
  var rawValue = getBookingRawValue(booking, ["Net_Margin", "Net_Margin_Amount"]);

  if (rawValue !== "") {
    return rawValue;
  }

  return "";
}

function firstTextValue() {
  for (var index = 0; index < arguments.length; index += 1) {
    var value = arguments[index];

    if (value !== null && value !== undefined && value !== "") {
      return String(value);
    }
  }

  return "-";
}

function getBookingBrowserStagesLabel(allStages, selectedStages) {
  if (!selectedStages.length) {
    return "Select stages";
  }

  if (selectedStages.length === allStages.length) {
    return "All stages";
  }

  if (selectedStages.length === 1) {
    return selectedStages[0];
  }

  return selectedStages.length + " stages selected";
}

export function renderServicesTable(options) {
  const elements = options.elements;
  const state = options.state;
  const selectedCount = Object.keys(state.selectedServiceIds).length;
  const hasServicesWorkspace = Boolean(state.selectedBooking) && state.services.length > 0;
  const visibleColumns = getVisibleServiceColumns(state);
  const hasBulkStatusSelection = Boolean(elements.bulkStatusEzus.value);

  renderServiceFilterControls(elements, state);
  elements.serviceCount.textContent = state.services.length + (state.services.length === 1 ? " service" : " services") +
    (selectedCount ? " | " + selectedCount + " selected" : "");
  elements.bulkActions.hidden = !hasServicesWorkspace || selectedCount === 0;
  elements.serviceColumnsPanel.hidden = !state.serviceColumnsPanelOpen;
  elements.bulkSelectionCopy.textContent = selectedCount + (selectedCount === 1 ? " service selected" : " services selected");
  elements.bulkActionMode.disabled = !hasServicesWorkspace;
  elements.applyBulkStatus.disabled = selectedCount === 0 || !hasBulkStatusSelection;
  elements.bulkStatusEzus.disabled = selectedCount === 0;
  elements.createAvailabilityDraft.disabled = selectedCount === 0;
  elements.createReservationsDraft.disabled = selectedCount === 0;
  elements.viewFlat.classList.toggle("active", state.serviceView === "flat");
  elements.viewGrouped.classList.toggle("active", state.serviceView === "grouped");
  renderServiceColumnsEditor(elements, state);
  renderServiceTableHead(elements, state, visibleColumns);
  syncBulkActionMode(elements);

  if (state.serviceView === "grouped") {
    renderGroupedServicesTable(options);
    return;
  }

  renderFlatServicesTable(options);
}

export function renderEmailsPanel(elements, state) {
  const activeRecords = state.emailDrafts;
  const activeCountLabel = activeRecords.length + (activeRecords.length === 1 ? " draft" : " drafts");

  state.activeMailTab = "drafts";

  if (elements.emailsSummaryCount) {
    elements.emailsSummaryCount.textContent = activeCountLabel;
  }
  if (elements.draftsListCount) {
    elements.draftsListCount.textContent = activeCountLabel;
  }
  if (elements.refreshBookingMails) {
    elements.refreshBookingMails.disabled = !state.selectedBooking || state.emailsLoading || state.draftEditorSaving;
    elements.refreshBookingMails.classList.toggle("is-loading", state.emailsLoading);
  }

  if (!state.selectedBooking) {
    elements.emailsEmptyState.hidden = false;
    elements.emailsEmptyState.textContent = "Load a booking to see related email drafts.";
    elements.emailsContentPanel.hidden = true;
    return;
  }

  if (state.emailsLoading) {
    elements.emailsEmptyState.hidden = false;
    elements.emailsEmptyState.textContent = "Loading related email drafts...";
    elements.emailsContentPanel.hidden = true;
    return;
  }

  if (state.draftEmailsError && !state.emailDrafts.length) {
    elements.emailsEmptyState.hidden = false;
    elements.emailsEmptyState.textContent = state.draftEmailsError;
    elements.emailsContentPanel.hidden = true;
    return;
  }

  elements.emailsEmptyState.hidden = true;
  elements.emailsContentPanel.hidden = false;
  elements.mailListHeading.textContent = "Drafts";
  elements.activeMailListCount.textContent = activeCountLabel;

  const emptyMessage = state.draftEmailsError || "No related draft emails found.";
  const selectedRecordId = getValidatedSelectedMailRecordId(state, activeRecords);
  const selectedRecord = getMailRecordById(activeRecords, "drafts", selectedRecordId);
  const selectedCacheKey = selectedRecordId ? buildMailCacheKey("drafts", selectedRecordId) : "";
  const selectedContentRecord = selectedCacheKey ? state.mailContentByKey[selectedCacheKey] || null : null;

  elements.activeMailList.innerHTML = renderMailList(
    activeRecords,
    "drafts",
    selectedRecordId,
    emptyMessage
  );

  if (!selectedRecord) {
    elements.mailViewerEmpty.hidden = false;
    elements.mailViewerContent.hidden = true;
    elements.mailViewerActions.hidden = true;
    elements.mailDraftEditor.hidden = true;
    elements.mailDraftDebugId.hidden = true;
    elements.mailViewerBody.hidden = false;
    elements.mailViewerEmpty.innerHTML = activeRecords.length
      ? '<span class="mail-viewer-empty-eyebrow">Draft preview</span><strong>Select a draft</strong><p>Choose a draft from the list to view its content.</p>'
      : escapeHtml(emptyMessage);
    elements.mailViewerBody.innerHTML = buildMailViewerMarkup("");
    return;
  }

  if (selectedCacheKey && state.mailViewerLoadingKey === selectedCacheKey && !selectedContentRecord) {
    elements.mailViewerEmpty.hidden = false;
    elements.mailViewerContent.hidden = true;
    elements.mailViewerActions.hidden = true;
    elements.mailDraftEditor.hidden = true;
    elements.mailDraftDebugId.hidden = true;
    elements.mailViewerBody.hidden = false;
    elements.mailViewerEmpty.textContent = "Loading full draft content...";
    elements.mailViewerBody.innerHTML = buildMailViewerMarkup("");
    return;
  }

  if (selectedCacheKey && state.mailViewerErrorKey === selectedCacheKey && state.mailViewerError && !selectedContentRecord) {
    elements.mailViewerEmpty.hidden = false;
    elements.mailViewerContent.hidden = true;
    elements.mailViewerActions.hidden = true;
    elements.mailDraftEditor.hidden = true;
    elements.mailDraftDebugId.hidden = true;
    elements.mailViewerBody.hidden = false;
    elements.mailViewerEmpty.textContent = state.mailViewerError;
    elements.mailViewerBody.innerHTML = buildMailViewerMarkup("");
    return;
  }

  const viewerRecord = selectedContentRecord || selectedRecord;
  const subject = getMailSubject(viewerRecord);
  const toValue = formatMailValue(getMailField(viewerRecord, ["to", "To", "to_address", "To_Address", "recipient", "Recipient"])) || "-";
  const ccValue = formatMailValue(getMailField(viewerRecord, ["cc", "CC", "cc_address", "Cc_Address", "carbon_copy", "Carbon_Copy"])) || "-";
  const timeValue = getMailField(viewerRecord, [
    "time",
    "Time",
    "sent_time",
    "Sent_Time",
    "message_time",
    "Message_Time",
    "Created_Time",
    "created_time",
    "scheduled_time",
    "Scheduled_Time",
    "Modified_Time",
    "modified_time"
  ]);
  const htmlContent = getMailHtmlContent(viewerRecord);

  elements.mailViewerEmpty.hidden = true;
  elements.mailViewerContent.hidden = false;
  elements.mailViewerKind.textContent = "Draft";
  elements.mailViewerSubject.textContent = subject;
  elements.mailViewerPreview.textContent = "";
  elements.mailViewerPreview.hidden = true;
  elements.mailViewerTo.textContent = toValue;
  elements.mailViewerCc.textContent = ccValue;
  elements.mailViewerTime.textContent = timeValue ? formatDateTime(timeValue) : "-";
  elements.mailViewerActions.hidden = false;
  if (elements.mailOpenOutlook) {
    elements.mailOpenOutlook.disabled = state.draftEditorSaving || state.outlookConfirmOpen;
  }
  if (elements.mailCopyFormattedBody) {
    elements.mailCopyFormattedBody.disabled = state.draftEditorSaving || state.outlookConfirmOpen;
  }
  elements.mailEditDraft.disabled = state.draftEditorSaving || state.draftEditorOpen || state.outlookConfirmOpen;
  if (elements.mailDeleteDraft) {
    elements.mailDeleteDraft.disabled = state.draftEditorSaving || state.draftEditorOpen || state.outlookConfirmOpen;
  }
  elements.mailDraftEditor.hidden = !state.draftEditorOpen;
  elements.mailSaveDraft.disabled = state.draftEditorSaving;
  elements.mailCancelDraftEdit.disabled = state.draftEditorSaving;
  elements.mailViewerSubject.hidden = state.draftEditorOpen;
  elements.mailViewerMeta.hidden = state.draftEditorOpen;
  elements.mailViewerBody.hidden = state.draftEditorOpen;
  elements.mailDraftDebugId.hidden = !selectedRecordId;
  elements.mailDraftDebugId.textContent = selectedRecordId ? "Draft ID: " + selectedRecordId : "";

  const editorFields = state.draftEditorFields || {
    email_to: getMailEditorValue(getMailField(viewerRecord, ["to", "To", "to_address", "To_Address", "recipient", "Recipient"])),
    email_cc: getMailEditorValue(getMailField(viewerRecord, ["cc", "CC", "cc_address", "Cc_Address", "carbon_copy", "Carbon_Copy"])),
    email_subject: subject,
    email_content: htmlContent
  };
  elements.mailEditTo.value = editorFields.email_to || "";
  elements.mailEditCc.value = editorFields.email_cc || "";
  elements.mailEditSubject.value = editorFields.email_subject || "";
  elements.mailEditContent.value = editorFields.email_content || "";
  elements.mailEditVisual.innerHTML = editorFields.email_content || "<p></p>";
  elements.mailEditorModeVisual.classList.toggle("active", state.draftEditorMode === "visual");
  elements.mailEditorModeHtml.classList.toggle("active", state.draftEditorMode === "html");
  elements.mailEditorModeVisual.setAttribute("aria-selected", state.draftEditorMode === "visual" ? "true" : "false");
  elements.mailEditorModeHtml.setAttribute("aria-selected", state.draftEditorMode === "html" ? "true" : "false");
  elements.mailEditContentLabel.textContent = state.draftEditorMode === "visual" ? "Content (visual)" : "Content (HTML)";
  elements.mailEditVisual.hidden = state.draftEditorMode !== "visual";
  elements.mailEditContent.hidden = state.draftEditorMode !== "html";
  elements.mailSaveDraft.textContent = state.draftEditorSaving ? "Saving..." : "Save draft";
  if (elements.mailOutlookConfirm) {
    elements.mailOutlookConfirm.hidden = !state.outlookConfirmOpen;
  }
  if (elements.mailOutlookConfirmMessage) {
    elements.mailOutlookConfirmMessage.textContent = state.draftEditorSaving
      ? "Removing this draft from this view..."
      : "If you choose Yes, this draft will be removed from this view.";
  }
  if (elements.mailOutlookConfirmYes) {
    elements.mailOutlookConfirmYes.disabled = state.draftEditorSaving;
    elements.mailOutlookConfirmYes.textContent = state.draftEditorSaving ? "Removing..." : "Yes";
  }
  if (elements.mailOutlookConfirmNo) {
    elements.mailOutlookConfirmNo.disabled = state.draftEditorSaving;
  }

  elements.mailViewerBody.innerHTML = buildMailViewerMarkup(htmlContent);
}

function renderMailList(records, tabName, selectedRecordId, emptyMessage) {
  if (!records.length) {
    return '<div class="table-empty">' + escapeHtml(emptyMessage) + "</div>";
  }

  return records.map(function (record, index) {
    const recordId = getMailRecordId(record, index, tabName);
    const subject = getMailSubject(record);
    const toValue = formatMailValue(getMailField(record, ["to", "To", "to_address", "To_Address", "recipient", "Recipient"]));
    const timeValue = getMailField(record, [
      "time",
      "Time",
      "sent_time",
      "Sent_Time",
      "message_time",
      "Message_Time",
      "Created_Time",
      "created_time",
      "scheduled_time",
      "Scheduled_Time",
      "Modified_Time",
      "modified_time"
    ]);
    const selectedClass = recordId === selectedRecordId ? " active" : "";

    return [
      '<article class="mail-list-item' + selectedClass + '" data-mail-tab="' + escapeHtml(tabName) + '" data-mail-record-id="' + escapeHtml(recordId) + '">',
      '  <div class="mail-list-item-time">' + escapeHtml(timeValue ? formatDateTime(timeValue) : "-") + "</div>",
      '  <strong class="mail-list-item-subject">' + escapeHtml(subject) + "</strong>",
      renderMailRow("To", toValue || "-"),
      "</article>"
    ].join("");
  }).join("");
}

function renderMailRow(label, value) {
  return [
    '<div class="mail-list-row">',
    '  <span class="mail-list-label">' + escapeHtml(label) + "</span>",
    '  <span class="mail-list-value">' + escapeHtml(value) + "</span>",
    "</div>"
  ].join("");
}

function getValidatedSelectedMailRecordId(state, records) {
  const currentId = state.selectedDraftRecordId;
  return getMailRecordById(records, "drafts", currentId) ? currentId : "";
}

function getMailRecordById(records, tabName, recordId) {
  if (!recordId) {
    return null;
  }

  for (var index = 0; index < records.length; index += 1) {
    if (getMailRecordId(records[index], index, tabName) === recordId) {
      return records[index];
    }
  }

  return null;
}

function getMailRecordId(record, index, tabName) {
  return String(getMailField(record, ["id", "ID", "message_id", "Message_ID"]) || (tabName + "-" + index));
}

function buildMailCacheKey(tabName, recordId) {
  return tabName + "::" + recordId;
}

function getMailSubject(record) {
  return getMailField(record, ["subject", "Subject", "name", "Name"]) || "No subject";
}

function getMailPreview(record) {
  return stripHtml(getMailField(record, ["summary", "Summary", "content", "Content", "snippet", "Snippet", "description", "Description"]) || "");
}

function getMailHtmlContent(record) {
  return getMailField(record, ["content", "Content", "body", "Body", "html", "HTML", "message", "Message"]) || "";
}

function getMailField(record, keys) {
  for (var index = 0; index < keys.length; index += 1) {
    var value = record[keys[index]];

    if (value !== null && value !== undefined && value !== "") {
      return value;
    }
  }

  return "";
}

function formatMailValue(value) {
  if (!value) {
    return "";
  }

  if (Array.isArray(value)) {
    return value.map(formatMailValue).filter(Boolean).join(", ");
  }

  if (typeof value === "object") {
    return value.email || value.address || value.name || "";
  }

  return String(value);
}

function getMailEditorValue(value) {
  if (!value) {
    return "";
  }

  if (Array.isArray(value)) {
    return value.map(getMailEditorValue).filter(Boolean).join(", ");
  }

  if (typeof value === "object") {
    return value.email || value.address || value.name || "";
  }

  return String(value);
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function buildMailViewerMarkup(content) {
  const cleanedContent = extractMailBody(content);
  const sanitizedContent = sanitizeMailHtml(cleanedContent);
  const hasHtmlContent = /<\/?[a-z][\s\S]*>/i.test(cleanedContent);
  const bodyMarkup = hasHtmlContent && sanitizedContent
    ? sanitizedContent
    : '<pre class="mail-plain-text">' + escapeHtml(stripHtml(cleanedContent) || "No message content available.") + "</pre>";

  return '<div class="mail-html-content">' + bodyMarkup + "</div>";
}

function extractMailBody(content) {
  const value = String(content || "");
  const bodyMatch = value.match(/<body[^>]*>([\s\S]*?)<\/body>/i);

  return bodyMatch ? bodyMatch[1] : value;
}

function sanitizeMailHtml(content) {
  return String(content || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<base[\s\S]*?>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, "")
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/<(iframe|object|embed|form)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(iframe|object|embed|form)\b[^>]*\/?>/gi, "");
}

function renderFlatServicesTable(options) {
  const elements = options.elements;
  const state = options.state;
  const onSelectService = options.onSelectService;
  const onToggleServiceSelection = options.onToggleServiceSelection;
  const visibleColumns = getVisibleServiceColumns(state);
  const columnCount = visibleColumns.length + 1;

  if (!state.filteredServices.length) {
    elements.servicesBody.innerHTML = '<tr><td colspan="' + columnCount + '" class="table-empty">No services match the current filter.</td></tr>';
    return;
  }

  elements.servicesBody.innerHTML = state.filteredServices.map(function (service) {
    const activeClass = service.id === state.selectedServiceId ? "active" : "";
    const selectedClass = state.selectedServiceIds[service.id] ? "is-selected" : "";
    return [
      '<tr class="' + activeClass + " " + selectedClass + '" data-service-id="' + escapeHtml(service.id) + '">',
      '  <td class="select-column"><input class="table-checkbox service-select-checkbox" type="checkbox" data-service-checkbox="' + escapeHtml(service.id) + '"' + (state.selectedServiceIds[service.id] ? " checked" : "") + ' aria-label="Select service"></td>',
      visibleColumns.map(function (column) {
        return renderServiceTableCell(column, service, state);
      }).join(""),
      "</tr>"
    ].join("");
  }).join("");

  Array.prototype.forEach.call(elements.servicesBody.querySelectorAll("tr[data-service-id]"), function (row) {
    row.addEventListener("click", function () {
      onSelectService(row.getAttribute("data-service-id"));
    });
  });

  Array.prototype.forEach.call(elements.servicesBody.querySelectorAll("input[data-service-checkbox]"), function (checkbox) {
    checkbox.addEventListener("click", function (event) {
      event.stopPropagation();
    });

    checkbox.addEventListener("change", function () {
      onToggleServiceSelection(
        checkbox.getAttribute("data-service-checkbox"),
        checkbox.checked
      );
    });
  });
}

function renderGroupedServicesTable(options) {
  const elements = options.elements;
  const state = options.state;
  const onSelectService = options.onSelectService;
  const onSelectStep = options.onSelectStep;
  const onToggleServiceSelection = options.onToggleServiceSelection;
  const onToggleGroupSelection = options.onToggleGroupSelection;
  const onToggleStepCollapsed = options.onToggleStepCollapsed;
  const visibleColumns = getVisibleServiceColumns(state);
  const columnCount = visibleColumns.length + 1;

  if (!state.groupedRows.length) {
    elements.servicesBody.innerHTML = '<tr><td colspan="' + columnCount + '" class="table-empty">No services match the current filter.</td></tr>';
    return;
  }

  const rows = [];
  let currentDayKey = null;

  state.groupedRows.forEach(function (group) {
    if (group.dayKey !== currentDayKey) {
      currentDayKey = group.dayKey;
      rows.push(
        '<tr class="day-row">' +
        '<td colspan="' + columnCount + '" class="day-cell">' +
        '<span class="day-chip">' + escapeHtml(formatGroupedDayLabel(group.dayKey)) + "</span>" +
        "</td>" +
        "</tr>"
      );
    }

    const stepName = group.step ? getStepDisplayName(group.step) || "No step linked" : "No step linked";
    const stepStatus = group.step ? group.step.Status || "-" : "-";
    const stepClassification = group.step
      ? [group.step.Step_Category || "-", group.step.Step_Type || "-"].join(" · ")
      : "Services without a booking step";
    const stepSchedule = group.step ? formatStepTimeRange(group.step.Start_Date_Time, group.step.End_Date_Time) : "";
    const stepActive = state.selectedItemType === "step" && state.selectedStepId === group.stepId ? "active" : "";
    const groupSelection = getGroupSelectionState(group.services, state.selectedServiceIds);
    const isCollapsed = Boolean(state.collapsedStepIds[group.stepId]);

    rows.push(
      '<tr class="step-row ' + stepActive + (isCollapsed ? " is-collapsed" : "") + '" data-step-id="' + escapeHtml(group.stepId) + '">' +
      '<td colspan="' + columnCount + '" class="step-cell">' +
      '<div class="step-card">' +
      '<div class="step-card-top">' +
      '<div class="step-card-title-wrap">' +
      '<button class="step-collapse-toggle" type="button" data-step-collapse-id="' + escapeHtml(group.stepId) + '" aria-label="' + (isCollapsed ? "Expand step" : "Collapse step") + '" aria-expanded="' + (!isCollapsed ? "true" : "false") + '">' + (isCollapsed ? "›" : "⌄") + '</button>' +
      '<input class="table-checkbox group-select-checkbox" type="checkbox" data-group-step-id="' + escapeHtml(group.stepId) + '"' + (groupSelection.checked ? " checked" : "") + ' aria-label="Select all services in this step" title="Select all services in this step">' +
      '<div class="step-card-labels">' +
      '<span class="step-card-title">' + escapeHtml(stepName) + '</span>' +
      '<div class="step-card-meta">' + escapeHtml(stepClassification) + '</div>' +
      '</div>' +
      '</div>' +
      '<div class="step-card-top-meta">' + (stepSchedule ? '<span class="step-time">' + escapeHtml(stepSchedule) + '</span>' : "") + '<span class="step-service-count">' + escapeHtml(group.services.length + (group.services.length === 1 ? " service" : " services")) + '</span>' + renderStatusPill(stepStatus) + '</div>' +
      '</div>' +
      '<div class="step-card-financial"><span>Sales <strong>' + escapeHtml(formatCurrency(group.totalSales)) + '</strong></span><span>Purchase <strong>' + escapeHtml(formatCurrency(group.totalPurchase)) + '</strong></span></div>' +
      '</div>' +
      '</div>' +
      '</td>' +
      '</tr>'
    );

    if (!isCollapsed) {
      group.services.forEach(function (service) {
      const activeClass = state.selectedItemType === "service" && state.selectedServiceId === service.id ? "active" : "";
      const selectedClass = state.selectedServiceIds[service.id] ? "is-selected" : "";
      rows.push(
        '<tr class="step-service-row ' + activeClass + " " + selectedClass + '" data-service-id="' + escapeHtml(service.id) + '">' +
        '  <td class="select-column"><input class="table-checkbox service-select-checkbox" type="checkbox" data-service-checkbox="' + escapeHtml(service.id) + '"' + (state.selectedServiceIds[service.id] ? " checked" : "") + ' aria-label="Select service"></td>' +
        visibleColumns.map(function (column) {
          return renderServiceTableCell(column, service, state);
        }).join("") +
        "</tr>"
      );
      });
    }
  });

  elements.servicesBody.innerHTML = rows.join("");

  Array.prototype.forEach.call(elements.servicesBody.querySelectorAll("tr[data-service-id]"), function (row) {
    row.addEventListener("click", function () {
      onSelectService(row.getAttribute("data-service-id"));
    });
  });

  Array.prototype.forEach.call(elements.servicesBody.querySelectorAll("input[data-service-checkbox]"), function (checkbox) {
    checkbox.addEventListener("click", function (event) {
      event.stopPropagation();
    });

    checkbox.addEventListener("change", function () {
      onToggleServiceSelection(
        checkbox.getAttribute("data-service-checkbox"),
        checkbox.checked
      );
    });
  });

  Array.prototype.forEach.call(elements.servicesBody.querySelectorAll("tr[data-step-id]"), function (row) {
    row.addEventListener("click", function () {
      const rawStepId = row.getAttribute("data-step-id");
      onSelectStep(rawStepId === "__no_step__" ? "" : rawStepId, rawStepId);
    });
  });

  Array.prototype.forEach.call(elements.servicesBody.querySelectorAll("input[data-group-step-id]"), function (checkbox) {
    const group = state.groupedRows.find(function (row) {
      return row.stepId === checkbox.getAttribute("data-group-step-id");
    });
    const groupSelection = group ? getGroupSelectionState(group.services, state.selectedServiceIds) : null;

    if (groupSelection) {
      checkbox.indeterminate = groupSelection.indeterminate;
    }

    checkbox.addEventListener("click", function (event) {
      event.stopPropagation();
    });

    checkbox.addEventListener("change", function () {
      onToggleGroupSelection(
        checkbox.getAttribute("data-group-step-id"),
        checkbox.checked
      );
    });
  });

  Array.prototype.forEach.call(elements.servicesBody.querySelectorAll("button[data-step-collapse-id]"), function (button) {
    button.addEventListener("click", function (event) {
      event.stopPropagation();
      onToggleStepCollapsed(button.getAttribute("data-step-collapse-id"));
    });
  });
}

function getGroupSelectionState(services, selectedServiceIds) {
  const total = services.length;
  const selected = services.filter(function (service) {
    return Boolean(selectedServiceIds[service.id]);
  }).length;

  return {
    checked: total > 0 && selected === total,
    indeterminate: selected > 0 && selected < total
  };
}

function renderServiceColumnsEditor(elements, state) {
  const visibleCount = getVisibleServiceColumns(state).length;

  elements.serviceColumnsList.innerHTML = state.serviceTableColumns.map(function (column) {
    const definition = getColumnDefinition(column.key);

    if (!definition) {
      return "";
    }

    return [
      '<div class="column-editor-row' + (column.visible ? "" : " is-muted") + '" data-column-key="' + escapeHtml(column.key) + '" draggable="true">',
      '  <span class="column-drag-handle" aria-hidden="true" title="Drag to reorder">&#8942;&#8942;</span>',
      '  <label class="column-editor-toggle">',
      '    <input class="table-checkbox" type="checkbox" data-column-visibility="' + escapeHtml(column.key) + '"' + (column.visible ? " checked" : "") + ((column.visible && visibleCount === 1) ? " disabled" : "") + '>',
      '    <span>' + escapeHtml(definition.label) + "</span>",
      "  </label>",
      "</div>"
    ].join("");
  }).join("");
}

function renderServiceTableHead(elements, state, visibleColumns) {
  elements.servicesHeadRow.innerHTML = [
    '<th class="select-column"><input id="services-select-all" class="table-checkbox" type="checkbox" aria-label="Select all visible services"></th>',
    visibleColumns.map(function (column) {
      return '<th class="' + escapeHtml(getServiceColumnClassName(column.key)) + '">' + escapeHtml(column.label) + "</th>";
    }).join("")
  ].join("");

  elements.serviceSelectAll = document.getElementById("services-select-all");
}

function getVisibleServiceColumns(state) {
  return state.serviceTableColumns.filter(function (column) {
    return column.visible;
  }).map(function (column) {
    return getColumnDefinition(column.key);
  }).filter(Boolean);
}

function getColumnDefinition(columnKey) {
  return SERVICE_TABLE_COLUMNS.find(function (column) {
    return column.key === columnKey;
  }) || null;
}

function getServiceColumnClassName(columnKey) {
  return "service-column service-column-" + String(columnKey || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .toLowerCase();
}

function renderServiceCell(columnKey, content) {
  return '<td class="' + escapeHtml(getServiceColumnClassName(columnKey)) + '">' + content + "</td>";
}

function getServiceFieldDisplayValue(value) {
  return value === null || value === undefined || value === "" ? "-" : String(value);
}

function normalizeStatusValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getStatusTheme(status) {
  const normalizedStatus = normalizeStatusValue(status);

  switch (normalizedStatus) {
    case "unassigned":
      return {
        modifier: "status-pill--unassigned",
        background: "#edf1f5",
        color: "#586271"
      };
    case "blocked":
      return {
        modifier: "status-pill--blocked",
        background: "#dbeafe",
        color: "#1e3a8a"
      };
    case "confirmed":
      return {
        modifier: "status-pill--confirmed",
        background: "#dcfce7",
        color: "#15803d"
      };
    case "on request":
      return {
        modifier: "status-pill--on-request",
        background: "#e0f2fe",
        color: "#0369a1"
      };
    case "alert":
      return {
        modifier: "status-pill--alert",
        background: "#ffedd5",
        color: "#c2410c"
      };
    case "optional":
      return {
        modifier: "status-pill--optional",
        background: "#ede9fe",
        color: "#6d28d9"
      };
    case "pre payment requested":
      return {
        modifier: "status-pill--pre-payment-requested",
        background: "#f3e8ff",
        color: "#9333ea"
      };
    case "partially pre paid":
    case "partially per paid":
      return {
        modifier: "status-pill--partially-pre-paid",
        background: "#fed7aa",
        color: "#c2410c"
      };
    case "fully prepaid":
    case "fully pre paid":
    case "pre paid":
      return {
        modifier: "status-pill--fully-prepaid",
        background: "#fef3c7",
        color: "#a16207"
      };
    case "nbtm confirmed":
      return {
        modifier: "status-pill--nbtm-confirmed",
        background: "#d1fae5",
        color: "#0f766e"
      };
    case "cancelled":
      return {
        modifier: "status-pill--cancelled",
        background: "#fee2e2",
        color: "#b91c1c"
      };
    case "cancelled with charges":
    case "cancelled w charges":
      return {
        modifier: "status-pill--cancelled-with-charges",
        background: "#fce7f3",
        color: "#be185d"
      };
    case "email draft created":
    case "availability draft created":
      return {
        modifier: "status-pill--draft-created",
        background: "#e0e7ff",
        color: "#4338ca"
      };
    default:
      return {
        modifier: "",
        background: "#f5f8f6",
        color: "#526b63"
      };
  }
}

function getStatusPillModifier(status) {
  return getStatusTheme(status).modifier;
}

function renderStatusPill(status) {
  const modifierClass = getStatusPillModifier(status);
  const classes = ["status-pill"];

  if (modifierClass) {
    classes.push(modifierClass);
  }

  return '<span class="' + escapeHtml(classes.join(" ")) + '">' + escapeHtml(status || "-") + "</span>";
}

function renderStatusOption(status) {
  const theme = getStatusTheme(status);
  const inlineStyle = [
    "background-color: " + theme.background,
    "color: " + theme.color,
    "font-weight: 700"
  ].join("; ");

  return '<option value="' + escapeHtml(status) + '" style="' + escapeHtml(inlineStyle) + '">' + escapeHtml(status) + "</option>";
}

function renderServiceTableCell(column, service, state) {
  const step = service.Step && service.Step.id ? state.stepIndex[service.Step.id] || service.Step : service.Step;

  switch (column.key) {
    case "name":
      return renderServiceCell(
        column.key,
        '<div class="service-sequence"><strong>' + escapeHtml(service.Name || "-") + "</strong></div>"
      );
    case "serviceName":
      return renderServiceCell(
        column.key,
        '<div class="service-title"><strong>' + escapeHtml(service.Product_Description || "-") + "</strong></div>"
      );
    case "date":
      return renderServiceCell(column.key, escapeHtml(formatDate(service.Service_Date)));
    case "serviceDateTime":
      return renderServiceCell(column.key, escapeHtml(formatDateTime(service.Service_Date_Time)));
    case "step":
      return renderServiceCell(column.key, escapeHtml(getStepDisplayName(step) || "-"));
    case "paxNumber":
      return renderServiceCell(
        column.key,
        escapeHtml(getServiceFieldDisplayValue(service.Number_of_Pax !== undefined ? service.Number_of_Pax : service.PAX_Number))
      );
    case "destination":
      return renderServiceCell(column.key, escapeHtml(service.Destination || "-"));
    case "subdestination":
      return renderServiceCell(column.key, escapeHtml(service.Subdestination || "-"));
    case "category":
      return renderServiceCell(column.key, escapeHtml(service.Category || "-"));
    case "subcategory":
      return renderServiceCell(column.key, escapeHtml(service.Subcategory || "-"));
    case "supplier":
      return renderServiceCell(column.key, escapeHtml(service.Supplier_Name || "-"));
    case "serviceNotes":
      return renderServiceCell(column.key, escapeHtml(getServiceFieldDisplayValue(service.Service_Notes)));
    case "status":
      return renderServiceCell(column.key, renderStatusPill(service.Status_EZUS));
    case "sales":
      return renderServiceCell(column.key, escapeHtml(formatCurrency(service.Total_Sales_Price)));
    case "purchase":
      return renderServiceCell(column.key, escapeHtml(formatCurrency(service.Total_Purchase_Price)));
    default:
      return renderServiceCell(column.key, "-");
  }
}

export function renderSelectionPanel(elements, state) {
  const hasOpenDetails = Boolean(state.selectedService || state.selectedStep);
  elements.servicesWorkspace.classList.toggle("details-open", hasOpenDetails);
  elements.closeServiceDetails.hidden = !hasOpenDetails;
  elements.selectionTitle.textContent = state.selectedService
    ? "Service details"
    : state.selectedItemType === "step"
      ? "Step details"
      : "Details";

  if (state.selectedService) {
    renderSelectedService(elements, state);
    elements.stepPanel.hidden = true;
  } else {
    renderEmptyServiceState(elements, state);
    renderSelectedStep(elements, state);
  }
}

function renderSelectedService(elements, state) {
  const service = state.selectedService;
  const linkedStep = service.Step && service.Step.id ? state.stepIndex[service.Step.id] || service.Step : service.Step;
  const activeTab = state.serviceDetailTab || "basic";
  const savedStatus = service.Status_EZUS || "-None-";
  const selectedStatus = state.serviceStatusDraftValue || savedStatus;
  const showRenfeAction = shouldShowRenfePrepaymentAction(service);

  elements.servicePanel.hidden = false;
  elements.serviceEmpty.hidden = true;
  elements.saveService.disabled = false;
  elements.fieldStatusEzus.disabled = false;
  elements.detailName.textContent = service.Name || "-";
  elements.detailDescription.textContent = service.Product_Description || "-";
  elements.detailDate.textContent = formatDate(service.Service_Date);
  elements.fieldStatusEzus.value = selectedStatus;
  applyStatusSelectAppearance(elements.fieldStatusEzus, selectedStatus);
  elements.fieldServiceNotes.value = service.Service_Notes || "";
  elements.serviceActionPrepayment.disabled = false;
  elements.serviceActionCardPurchase.disabled = false;
  elements.serviceActionRenfe.hidden = !showRenfeAction;
  elements.serviceActionRenfe.disabled = !showRenfeAction;
  elements.serviceDetailTabBasic.classList.toggle("active", activeTab === "basic");
  elements.serviceDetailTabFinancial.classList.toggle("active", activeTab === "financial");
  elements.serviceDetailTabStep.classList.toggle("active", activeTab === "step");
  elements.serviceDetailTabBasic.setAttribute("aria-selected", activeTab === "basic" ? "true" : "false");
  elements.serviceDetailTabFinancial.setAttribute("aria-selected", activeTab === "financial" ? "true" : "false");
  elements.serviceDetailTabStep.setAttribute("aria-selected", activeTab === "step" ? "true" : "false");
  elements.serviceDetailContent.innerHTML = buildSelectedServiceTabMarkup(service, linkedStep, activeTab, state);
}

function renderEmptyServiceState(elements, state) {
  const message = state.selectedStep
    ? "No service selected for this step. Choose a service row if you want to edit it."
    : "Select a step or service to view its details.";

  elements.serviceEmpty.textContent = message;
  elements.serviceEmpty.hidden = false;
  elements.servicePanel.hidden = true;
  elements.saveService.disabled = true;
  elements.fieldStatusEzus.disabled = true;
  elements.serviceActionPrepayment.disabled = true;
  elements.serviceActionCardPurchase.disabled = true;
  elements.serviceActionRenfe.disabled = true;
  elements.serviceActionRenfe.hidden = true;
}

function renderSelectedStep(elements, state) {
  if (state.selectedStepId === "__no_step__") {
    elements.stepPanel.hidden = false;
    elements.stepName.textContent = "No step linked";
    elements.stepReference.textContent = "Services without a booking step";
    elements.stepStatus.textContent = "-";
    elements.stepType.textContent = "-";
    elements.stepCategory.textContent = "-";
    elements.stepTravellers.textContent = "-";
    elements.stepStart.textContent = "-";
    elements.stepEnd.textContent = "-";
    elements.stepPcm.textContent = "-";
    elements.stepServiceCount.textContent = String(
      state.filteredServices.filter(function (service) {
        return !service.Step || !service.Step.id;
      }).length
    );
    return;
  }

  if (!state.selectedStep) {
    elements.stepPanel.hidden = true;
    return;
  }

  elements.stepPanel.hidden = false;

  const linkedServices = state.services.filter(function (service) {
    return service.Step && service.Step.id === state.selectedStep.id;
  });

  elements.stepName.textContent = getStepDisplayName(state.selectedStep) || "-";
  elements.stepReference.textContent = getStepInternalName(state.selectedStep) || "-";
  elements.stepStatus.textContent = state.selectedStep.Status || "-";
  elements.stepType.textContent = state.selectedStep.Step_Type || "-";
  elements.stepCategory.textContent = state.selectedStep.Step_Category || "-";
  elements.stepTravellers.textContent = String(state.selectedStep.Travelers_Number || state.selectedStep.Travellers_Number || "-");
  elements.stepStart.textContent = formatDateTime(state.selectedStep.Start_Date_Time);
  elements.stepEnd.textContent = formatDateTime(state.selectedStep.End_Date_Time);
  elements.stepPcm.textContent = state.selectedStep.PCM_Code || "-";
  elements.stepServiceCount.textContent = String(linkedServices.length);
}

function buildSelectedServiceTabMarkup(service, step, activeTab, state) {
  const basicRows = [
    buildCompactDetailRow("Service date", formatDate(service.Service_Date)),
    buildCompactDetailRow("PAX number", getServiceFieldText(service, ["Number_of_Pax", "PAX_Number"])),
    buildCompactDetailRow("Supplier", getServiceFieldText(service, ["Supplier_Name", "Supplier"])),
    buildCompactDetailRow("Step name", getStepDisplayName(step) || "No step linked")
  ];
  const financialRows = [
    buildCompactDetailRow("Total sales", formatCurrency(service.Total_Sales_Price)),
    buildCompactDetailRow("Total purchase", formatCurrency(service.Total_Purchase_Price)),
    buildCompactDetailRow("Payment method", getServiceFieldText(service, ["Payment_Method", "PaymentMethod", "Method_of_Payment"])),
    buildCompactDetailRow("Payment conditions", getServiceFieldText(service, ["Payment_Conditions", "Payment_Condition", "PaymentConditions", "Conditions_of_Payment"]))
  ];
  const stepRows = step
    ? [
      buildCompactDetailRow("Step name", getStepDisplayName(step) || "-"),
      buildCompactDetailRow("Status", step.Status || "-"),
      buildCompactDetailRow("Type", step.Step_Type || "-"),
      buildCompactDetailRow("Category", step.Step_Category || "-"),
      buildCompactDetailRow("Start", formatDateTime(step.Start_Date_Time)),
      buildCompactDetailRow("End", formatDateTime(step.End_Date_Time)),
      buildCompactDetailRow("Travelers", getServiceFieldText(step, ["Travelers_Number", "Travellers_Number"])),
      buildCompactDetailRow("PCM Code", step.PCM_Code || "-"),
      buildCompactDetailRow("Related services", String(getLinkedServiceCountForStep(step, state)))
    ]
    : [buildCompactDetailRow("Step", "No step linked")];
  const tabs = {
    basic: basicRows,
    financial: financialRows,
    step: stepRows
  };

  return '<div class="detail-list compact-detail-list">' + (tabs[activeTab] || tabs.basic).join("") + "</div>";
}

function buildCompactDetailRow(label, value) {
  return [
    '<div class="detail-list-row compact-detail-row">',
    '  <span class="label">' + escapeHtml(label) + "</span>",
    '  <strong>' + escapeHtml(value !== null && value !== undefined && value !== "" ? String(value) : "-") + "</strong>",
    "</div>"
  ].join("");
}

function buildTravelerProfileRow(label, value, modifierClass) {
  var normalizedValue = value !== null && value !== undefined && value !== "" ? String(value) : "-";
  var hasValue = normalizedValue !== "-";
  var className = ["detail-list-row", "compact-detail-row", "traveler-profile-row", hasValue && modifierClass ? modifierClass : ""]
    .filter(Boolean)
    .join(" ");

  return [
    '<div class="' + escapeHtml(className) + '">',
    '  <span class="label">' + escapeHtml(label) + "</span>",
    '  <strong>' + escapeHtml(normalizedValue) + "</strong>",
    "</div>"
  ].join("");
}

function getTravelerFieldText(traveler, keys) {
  for (var index = 0; index < keys.length; index += 1) {
    var value = traveler && traveler[keys[index]];

    if (value === null || value === undefined || value === "") {
      continue;
    }

    if (typeof value === "object") {
      return getLookupName(value) || "-";
    }

    return String(value);
  }

  return "-";
}

function getLeadPaxLabel(value) {
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  var normalizedValue = normalizeComparableText(value);

  if (!normalizedValue) {
    return "-";
  }

  if (normalizedValue === "true" || normalizedValue === "yes" || normalizedValue === "lead pax") {
    return "Yes";
  }

  if (normalizedValue === "false" || normalizedValue === "no") {
    return "No";
  }

  return String(value);
}

function buildTravelerDisplayName(traveler) {
  var forename = getTravelerFieldText(traveler, ["Forename", "forename"]);
  var surname = getTravelerFieldText(traveler, ["Name", "Surname", "surname"]);

  if (forename === "-" && surname === "-") {
    return "Selected traveler";
  }

  return [forename !== "-" ? forename : "", surname !== "-" ? surname : ""].join(" ").trim() || "Selected traveler";
}

function buildTravelerFact(icon, label, value) {
  if (!value || value === "-") {
    return "";
  }

  return '<div class="traveler-fact">' + travelerIcon(icon) + '<div><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + "</strong></div></div>";
}

function buildTravelerAgeFact(age, dateOfBirth) {
  if (age === "-" && dateOfBirth === "-") {
    return "";
  }

  var ageLabel = age === "-" ? "Age not provided" : age + " years";
  var birthLabel = dateOfBirth === "-" ? "" : '<small>Born ' + escapeHtml(formatTravelerBirthDate(dateOfBirth)) + "</small>";
  return '<div class="traveler-fact traveler-fact--age">' + travelerIcon("calendar") + '<div><span>Age</span><strong>' + escapeHtml(ageLabel) + "</strong>" + birthLabel + "</div></div>";
}

function buildTravelerPassportFact(passportNumber, nationality) {
  if (passportNumber === "-" && nationality === "-") {
    return "";
  }

  var passportLabel = passportNumber === "-" ? "Not provided" : passportNumber;
  var nationalityLabel = nationality === "-" ? "" : '<small>Nationality ' + escapeHtml(nationality) + "</small>";
  return '<div class="traveler-fact traveler-fact--passport">' + travelerIcon("passport") + '<div><span>Passport</span><strong>' + escapeHtml(passportLabel) + "</strong>" + nationalityLabel + "</div></div>";
}

function formatTravelerBirthDate(value) {
  var normalizedValue = String(value || "").trim();
  var match = normalizedValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return normalizedValue;
  }

  var date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}

function travelerIcon(name) {
  var icons = {
    star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></svg>',
    mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4.5 7 7.5 5.5L19.5 7"/></svg>',
    phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.8 4.8 5.2c-.8.5-1.1 1.5-.7 2.4 2.6 6 5.9 9.3 11.9 11.9.9.4 1.9.1 2.4-.7l1.4-2.2-3.5-2.4-1.6 1.6c-2.5-1.2-4.6-3.3-5.8-5.8l1.6-1.6L7 3.8Z"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/></svg>',
    globe: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M4.5 12h15M12 4c2 2.2 3 5 3 8s-1 5.8-3 8c-2-2.2-3-5-3-8s1-5.8 3-8Z"/></svg>',
    passport: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3.5" width="16" height="17" rx="2"/><circle cx="12" cy="11" r="2.5"/><path d="M8.5 17c.8-1.5 2-2.2 3.5-2.2s2.7.7 3.5 2.2"/></svg>',
    dietary: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v7M4.5 3v4a2.5 2.5 0 0 0 5 0V3M7 10v11M16.5 3v18M16.5 3c-2.4 1.8-3.3 4.5-2.5 8h2.5"/></svg>',
    mobility: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="4.5" r="1.8"/><path d="m10.5 9 2.2 1.8 3.8.3M12.7 10.8l-1.5 4.2 2.2 2.2M11.2 15l-3.7 3.7M12 8.5l-2.5 1.4"/></svg>'
  };

  return '<span class="traveler-fact-icon traveler-fact-icon--' + name + '">' + (icons[name] || "") + "</span>";
}

function getServiceFieldText(record, keys) {
  for (var index = 0; index < keys.length; index += 1) {
    var value = record && record[keys[index]];

    if (value === null || value === undefined || value === "") {
      continue;
    }

    if (typeof value === "object") {
      return getLookupName(value) || "-";
    }

    return String(value);
  }

  return "-";
}

function getLinkedServiceCountForStep(step, state) {
  if (!step || !step.id) {
    return 0;
  }

  return state.services.filter(function (service) {
    return service.Step && service.Step.id === step.id;
  }).length;
}

function getStatusSelectModifier(status) {
  var pillModifier = getStatusPillModifier(status);

  return pillModifier ? pillModifier.replace("status-pill--", "service-status-select--") : "";
}

function formatStepTimeRange(startValue, endValue) {
  if (!startValue) {
    return "";
  }

  const formatTime = function (value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: false
    }).format(date);
  };
  const startTime = formatTime(startValue);
  const endTime = formatTime(endValue);

  return startTime && endTime && endTime !== startTime ? startTime + "–" + endTime : startTime;
}

function formatGroupedDayLabel(dayKey) {
  if (!dayKey) {
    return "No day assigned";
  }

  var date = new Date(dayKey + "T12:00:00");

  if (Number.isNaN(date.getTime())) {
    return dayKey;
  }

  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function shouldShowRenfePrepaymentAction(service) {
  var ezusSupplierReference = getServiceFieldText(service, [
    "Ezus_Supplier_Reference",
    "EZUS_Supplier_Reference",
    "EzusSupplierReference",
    "Supplier_Reference",
    "SupplierReference"
  ]);

  return String(ezusSupplierReference || "").trim().toUpperCase() === "MADEFORSPAIN-0601-SUPNEW-RENFET";
}
