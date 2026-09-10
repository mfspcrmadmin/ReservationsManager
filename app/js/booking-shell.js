import { updateBookingQueueOverlay } from "./booking-queue-overlay.js";
import { observeQueueDeskCells } from "./booking-queue-desk.js";
import { renderBookingTags } from "./booking-tags.js";
import { getQueueTablePreferences, getQueueVisibleColumns, queueColumnButton, configureQueueTable } from "./booking-queue-table.js";
import {
  escapeHtml,
  formatCurrency,
  formatDate,
  formatDateTime,
  getBookingOwnerInfo,
  getBookingStageValue,
  getLookupName,
  normalizeComparableText
} from "./utils.js";

export function renderBookingSummary(elements, state) {
  const booking = state.selectedBooking;
  if (elements.bookingPersonalTags) elements.bookingPersonalTags.innerHTML = renderBookingTags(booking, false);
  const summaryView = state.summaryView || "basic";
  const switchButtons = {
    basic: elements.summaryViewBasic,
    financial: elements.summaryViewFinancial,
    desk: elements.summaryViewDesk,
    travelers: elements.summaryViewTravelers,
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
    elements.summaryContent.hidden = false;
    elements.summaryContent.innerHTML = renderSummaryEmptyState();
    if (elements.summaryTravelersView) {
      elements.summaryTravelersView.hidden = true;
    }
    return;
  }

  if (summaryView === "desk") {
    elements.summaryContent.hidden = false;
    elements.summaryContent.innerHTML = renderDeskSummaryPanel(booking, state);
    if (elements.summaryTravelersView) {
      elements.summaryTravelersView.hidden = true;
    }
    return;
  }

  /* Shared context lives in the Active booking surface, not in the detail panel. */
  elements.summaryBookingHero.innerHTML = "";
  elements.summaryContent.hidden = summaryView === "travelers";
  elements.summaryContent.innerHTML = summaryView === "travelers" ? "" : renderSummaryMainPanel(booking, summaryView);
  if (elements.summaryTravelersView) {
    elements.summaryTravelersView.hidden = summaryView !== "travelers";
  }
}

export function renderBookingWorkspace(elements, state) {
  const booking = state.selectedBooking;
  applyBookingBrowserLayoutState(elements, state);
  applyBookingRailLayoutState(elements, state);
  renderBookingAdminActions(elements, state, booking);

  if (!booking) {
    state.workspaceFocusMode = false;
    if (elements.bookingMainShell) {
      elements.bookingMainShell.classList.add("is-empty-workspace");
      elements.bookingMainShell.classList.remove("is-workspace-focus");
    }
    if (elements.toggleWorkspaceFocus) {
      elements.toggleWorkspaceFocus.disabled = true;
      elements.toggleWorkspaceFocus.setAttribute("aria-pressed", "false");
      elements.toggleWorkspaceFocus.setAttribute("title", "Focus workspace");
      elements.toggleWorkspaceFocus.setAttribute("aria-label", "Focus workspace");
    }
    elements.summaryDashboard.innerHTML = renderWorkspaceEmptyState(state);
    elements.summaryBlueprintPanel.innerHTML = renderBookingBlueprintPlaceholder(
      "Workflow",
      "Load a booking to review its current state and next actions."
    );
    elements.summarySearchShell.classList.remove("is-booking-loaded");
    renderBookingActionArea(elements, null, state);
    if (elements.clearBooking) {
      elements.clearBooking.disabled = true;
    }
    elements.createAxus.disabled = true;
    elements.syncEzus.disabled = true;
    elements.openBookingReportDialog.disabled = true;
    elements.createPaymentRequest.disabled = true;
    return;
  }

  if (elements.bookingMainShell) {
    elements.bookingMainShell.classList.remove("is-empty-workspace");
  }
  if (elements.toggleWorkspaceFocus) {
    elements.toggleWorkspaceFocus.disabled = false;
  }
  elements.summaryDashboard.innerHTML = renderWorkspaceDashboard(booking, state);
  elements.summaryBlueprintPanel.innerHTML = renderBookingBlueprintPanel(state);
  const workflowSlot = elements.summaryDashboard.querySelector(".workspace-workflow-slot");
  if (workflowSlot) {
    workflowSlot.appendChild(elements.summaryBlueprintPanel);
  }
  elements.summarySearchShell.classList.add("is-booking-loaded");
  renderBookingActionArea(elements, booking, state);
  if (elements.clearBooking) {
    elements.clearBooking.disabled = false;
  }
  elements.createAxus.disabled = false;
  elements.syncEzus.disabled = state.syncingEzus;
  elements.openBookingReportDialog.disabled = false;
  elements.createPaymentRequest.disabled = !state.currentUserIsAdministrator;
}

function applyBookingRailLayoutState(elements, state) {
  const isCollapsed = Boolean(state.bookingRailCollapsed);

  if (elements.bookingMainShell) {
    elements.bookingMainShell.classList.toggle("is-rail-collapsed", isCollapsed);
  }
  if (elements.bookingRail) {
    elements.bookingRail.classList.toggle("is-collapsed", isCollapsed);
  }
  if (elements.bookingRailToggle) {
    elements.bookingRailToggle.hidden = !isCollapsed;
  }
}

function renderBookingAdminActions(elements, state, booking) {
  if (!elements.bookingAdminActions || !elements.openNativeBooking) {
    return;
  }

  const isAdministrator = Boolean(state.currentUserIsAdministrator);
  const bookingId = String(booking && (booking.id || booking.Id) || "").trim();

  elements.bookingAdminActions.hidden = !isAdministrator;
  elements.openNativeBooking.classList.toggle("is-disabled", !bookingId);
  elements.openNativeBooking.setAttribute("aria-disabled", bookingId ? "false" : "true");

  if (bookingId) {
    elements.openNativeBooking.href = "https://crm.zoho.eu/crm/org20093299576/tab/Potentials/" + encodeURIComponent(bookingId);
  } else {
    elements.openNativeBooking.removeAttribute("href");
  }
}

export function renderBookingBrowser(options) {
  const elements = options.elements;
  const state = options.state;
  const onBookingSelected = options.onBookingSelected;
  const onSyncBooking = options.onSyncBooking;
  // Disconnect observations from the previous render, including empty states.
  observeQueueDeskCells(elements.bookingBrowserBody, null, null);
  const ownerOptions = buildBookingBrowserOwnerOptions(state);
  const stageOptions = buildBookingBrowserStageOptions(state.bookings, state.bookingBrowserStageOptions);
  const hasStageOptions = stageOptions.length > 0;
  const filteredBookings = filterBookingsForBrowser(state.bookings, state);
  const pendingOwnerId = state.bookingBrowserPendingOwnerId || "";
  const pendingStages = Array.isArray(state.bookingBrowserPendingStages) ? state.bookingBrowserPendingStages : [];
  const isWide = Boolean(state.bookingBrowserWide);
  const tablePreferences = getQueueTablePreferences(state);
  const visibleColumns = getQueueVisibleColumns(tablePreferences, isWide);
  const columnCount = visibleColumns.length + 1;
  const isWorkspaceLoading = !state.initialized || state.bookingBrowserLoading;

  applyBookingBrowserLayoutState(elements, state);
  elements.bookingBrowserHead.innerHTML = visibleColumns.map(column => '<th data-service-column-key="' + column.key + '">' + escapeHtml(column.label) + '</th>').join("") + queueColumnButton();
  configureQueueTable(elements, tablePreferences, isWide, () => renderBookingBrowser(options));

  elements.bookingBrowserSearchBy.innerHTML = buildBookingBrowserSearchByOptions(
    state.bookingBrowserSearchField
  );
  elements.bookingBrowserOwner.innerHTML = buildBookingBrowserOwnerOptionMarkup(
    ownerOptions,
    pendingOwnerId
  );

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
  elements.bookingBrowserSearchBy.disabled = isWorkspaceLoading;
  elements.bookingBrowserOwner.disabled = isWorkspaceLoading;
  elements.bookingBrowserStagesToggle.disabled = isWorkspaceLoading || !hasStageOptions;
  if (elements.bookingBrowserLoad) {
    elements.bookingBrowserLoad.disabled = isWorkspaceLoading || !(pendingOwnerId && pendingStages.length);
  }
  if (elements.bookingBrowserSizeToggle) {
    elements.bookingBrowserSizeToggle.disabled = isWorkspaceLoading;
  }
  if (elements.bookingBrowserCollapseToggle) {
    elements.bookingBrowserCollapseToggle.disabled = isWorkspaceLoading;
  }
  if (elements.bookingBrowserRailToggle) {
    elements.bookingBrowserRailToggle.disabled = isWorkspaceLoading;
  }
  elements.bookingBrowserStagesToggle.setAttribute("aria-expanded", state.bookingBrowserStagesMenuOpen ? "true" : "false");
  elements.bookingBrowserStagesMenu.setAttribute("aria-hidden", state.bookingBrowserStagesMenuOpen ? "false" : "true");

  var stageFilterContainer = elements.bookingBrowserStagesToggle.closest(".booking-stage-filter");

  if (stageFilterContainer) {
    stageFilterContainer.classList.toggle("is-open", state.bookingBrowserStagesMenuOpen);
    stageFilterContainer.classList.toggle("is-empty", !hasStageOptions);
  }

  elements.bookingBrowserCount.textContent = "Bookings (" + filteredBookings.length + ")";

  if (state.bookingBrowserLoading) {
    elements.bookingBrowserBody.innerHTML = [
      '<tr>',
       '  <td colspan="' + columnCount + '" class="table-empty table-empty-loading" aria-label="Loading bookings">',
       '    <span class="table-loading-indicator" aria-hidden="true"></span>',
      "  </td>",
      "</tr>"
    ].join("");
    return;
  }

  if (state.bookingBrowserError || !filteredBookings.length) {
    const query = state.bookingBrowserQueryDebug;
    const diagnostic = query
      ? 'CRM records received: ' + query.received + '. ' + query.ownerField + ': ' + query.ownerId + '. ' + query.stageField + ': ' + query.stages.join(', ')
      : 'Loaded records: ' + state.bookings.length + '. Filters applied: ' + Boolean(state.bookingBrowserFiltersApplied);
    elements.bookingBrowserBody.innerHTML = [
      '<tr class="booking-browser-empty-row">',
      '  <td colspan="' + columnCount + '" class="table-empty booking-browser-empty">',
      '    <strong>' + (state.bookingBrowserError ? 'Could not load bookings' : 'No bookings found') + '</strong>',
      '    <span>' + escapeHtml(state.bookingBrowserError || (state.bookings.length ? 'The current filters exclude the loaded bookings.' : 'CRM returned no bookings for this search.')) + '</span>',
      '    <details class="booking-queue-search-details"><summary>Search details</summary><p>' + escapeHtml(diagnostic) + '</p></details>',
      '  </td>',
      '</tr>'
    ].join("");
    return;
  }

  elements.bookingBrowserBody.innerHTML = filteredBookings.map(function (booking) {
    const isActive = String(booking.id) === String(state.selectedBookingId || "") ? " active-row" : "";

    return [
      '<tr class="booking-browser-row' + isActive + '" data-browser-booking-id="' + escapeHtml(booking.id) + '">',
      visibleColumns.map(function (column) {
        return '<td data-queue-column="' + column.key + '"' + (column.key === "sync" ? ' class="booking-browser-sync-cell"' : '') + '>' + renderQueueCell(column.key, booking, state) + '</td>';
      }).join(""),
      '<td class="queue-columns-spacer"></td>',
      "</tr>"
    ].join("");
  }).join("");

  observeQueueDeskCells(elements.bookingBrowserBody, options.onLoadDeskTicket, formatDeskLatestInteraction);
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

  Array.prototype.forEach.call(elements.bookingBrowserBody.querySelectorAll("[data-browser-sync-booking-id]"), function (button) {
    button.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      const bookingId = button.getAttribute("data-browser-sync-booking-id");
      const booking = state.bookings.find(function (entry) { return String(entry.id) === String(bookingId); });
      if (booking && onSyncBooking) onSyncBooking(booking);
    });
  });
}

function renderQueueCell(key, booking, state) {
  switch (key) {
    case "booking": return escapeHtml(booking.Deal_Name || "-") + renderBookingTags(booking, true);
    case "mfsp": return escapeHtml(booking.MFSP_Reference || "-");
    case "arrival": return escapeHtml(formatDate(booking.Arrival_Date));
    case "departure": return escapeHtml(formatDate(booking.Departure_Date));
    case "stage": return renderBookingBrowserStage(booking.Stage);
    case "travelers": return escapeHtml(booking.Travelers_Number || "-");
    case "agency": return escapeHtml(getLookupName(booking.Account_Name) || "-");
    case "contact": return escapeHtml(getLookupName(booking.Primary_Contact) || "-");
    case "sales": return escapeHtml(formatCurrency(booking.Sales_Price));
    case "sync": return renderBookingBrowserSync(booking, state);
    case "desk": {
      const ticketId = firstTextValue(booking.Desk_Ticket_ID, booking.Desk_Ticket_Id, booking.DeskTicketID, booking["Desk Ticket ID"]);
      if (!ticketId || ticketId === "-") return "No Desk ticket";
      const selectedTicket = String(booking.id) === String(state.selectedBookingId) && state.deskTicketLoadedBookingId === state.selectedBookingId ? state.deskTicket : null;
      return '<strong data-queue-desk-ticket="' + escapeHtml(ticketId) + '">' + escapeHtml(selectedTicket ? formatDeskLatestInteraction(selectedTicket) : "Loading latest interaction…") + '</strong>';
    }
    default: return "";
  }
}

function renderBookingBrowserSync(booking, state) {
  const lastSyncAtRaw = getBookingRawValue(booking, ["Last_Ezus_Sync_At", "Last EZUS Sync At", "Last_EZUS_Sync_At"]);
  const lastSyncBy = getBookingValue(booking, ["Last_Ezus_Sync_By", "Last EZUS Sync By", "Last_EZUS_Sync_By"]);
  const lastSyncAt = lastSyncAtRaw ? new Date(lastSyncAtRaw) : null;
  const syncLabel = lastSyncAt && !Number.isNaN(lastSyncAt.getTime())
    ? formatElapsedTime(Date.now() - lastSyncAt.getTime()) + " ago"
    : "No sync recorded";
  const syncMessage = buildEzusSyncMessage(booking, lastSyncAtRaw);
  const tooltip = "Last synchronized by: " + (lastSyncBy || "Unknown") + ". When: " + (lastSyncAtRaw ? formatDateTime(lastSyncAtRaw) : "Unknown");
  const isSyncing = Boolean(state.syncingEzusBookingIds && state.syncingEzusBookingIds[String(booking.id)]);
  const canSync = Boolean(booking.Ezus_Project_ID) && !isSyncing;
  return [
    '<div class="booking-browser-sync">',
    '  <strong title="' + escapeHtml(tooltip) + '">' + escapeHtml(syncLabel) + "</strong>",
    '  <button class="button tertiary compact booking-browser-sync-button' + (isSyncing ? " is-loading" : "") + '" type="button" data-browser-sync-booking-id="' + escapeHtml(booking.id) + '"' + (canSync ? "" : " disabled") + (isSyncing ? ' aria-label="Synchronizing with EZUS" aria-busy="true"' : "") + ">" + (isSyncing ? '<span class="booking-browser-sync-spinner" aria-hidden="true"></span><span>Syncing...</span>' : "Sync EZUS") + "</button>",
    syncMessage ? '  <span class="booking-browser-sync-note ' + escapeHtml(syncMessage.className) + '">' + escapeHtml(syncMessage.text) + "</span>" : "",
    "</div>"
  ].join("");
}

function renderBookingBrowserStage(stage) {
  const label = String(stage || "-");
  const color = getBookingBrowserStageColor(label);

  if (!color) {
    return '<span class="booking-browser-stage">' + escapeHtml(label) + "</span>";
  }

  return '<span class="booking-browser-stage" style="background-color:' + color + "; color:" + getReadableTextColor(color) + '">' +
    escapeHtml(label) +
    "</span>";
}

function getBookingBrowserStageColor(stage) {
  const normalizedStage = normalizeComparableText(stage);
  const colors = {
    "quotation": "#add9ff",
    "quotation1": "#add9ff",
    "copy quote": "#f5c72f",
    "in progress": "#25b52a",
    "in review": "#25b52a",
    "closed won": "#25b52a",
    "confirmed": "#25b52a",
    "closed": "#25b52a",
    "cancelled w/charges": "#eb4d4d",
    "cancelled w/charges1": "#177ba0",
    "closed lost": "#eb4d4d",
    "dead": "#eb4d4d",
    "dead1": "#f00707",
    "pending assignation": "#5d4ffb",
    "reservation in progress": "#ffda62",
    "changes requested": "#f27e22",
    "all services confirmed": "#98d681",
    "cancelled": "#9a2e47",
    "fid in review": "#e972fd",
    "fid sent": "#25b52a",
    "on tour": "#578c42",
    "trip accounting closure": "#168aef",
    "booking closed": "#25b52a",
    "pending review": "#f6c1ff",
    "review done": "#34a617",
    "request qualified": "#8a37be",
    "proposal sent": "#98d681",
    "mi - migrated": "#f27e22",
    "testing": "#4137be"
  };

  if (colors[normalizedStage]) {
    return colors[normalizedStage];
  }

  const displayStageAliases = {
    "qu - quotation": "quotation",
    "cc - copy quote": "copy quote",
    "ip - in progress": "in progress",
    "ir - in review": "in review",
    "ac - accepted": "closed won",
    "cf - confirmed": "confirmed",
    "cl - closed": "closed",
    "cg - cancelled w/charges": "cancelled w/charges",
    "cx - cancelled": "closed lost",
    "de - dead": "dead",
    "ir - migrated": "mi - migrated"
  };

  return colors[displayStageAliases[normalizedStage]] || "";
}

function applyBookingBrowserLayoutState(elements, state) {
  var isWide = Boolean(state.bookingBrowserWide);
  var isCollapsed = Boolean(state.bookingBrowserCollapsed);

  if (elements.bookingHubShell) {
    elements.bookingHubShell.classList.toggle("is-browser-collapsed", isCollapsed);
  }

  if (elements.bookingBrowserPanel) {
    updateBookingQueueOverlay(elements.bookingBrowserPanel, isWide && !isCollapsed);
    elements.bookingBrowserPanel.classList.toggle("is-wide", isWide && !isCollapsed);
    elements.bookingBrowserPanel.classList.toggle("is-collapsed", isCollapsed);
  }

  if (elements.bookingBrowserHead) {
    elements.bookingBrowserHead.closest("table").classList.toggle("is-wide", isWide);
  }

  if (elements.bookingBrowserSizeToggle) {
    elements.bookingBrowserSizeToggle.innerHTML = isWide
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3v6H3M3 3l6 6M15 3v6h6M21 3l-6 6M9 21v-6H3M3 21l6-6M15 21v-6h6M21 21l-6-6"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M3 3l6 6M16 3h5v5M21 3l-6 6M8 21H3v-5M3 21l6-6M16 21h5v-5M21 21l-6-6"/></svg>';
    elements.bookingBrowserSizeToggle.setAttribute("aria-label", isWide ? "Make booking queue compact" : "Expand booking queue");
    elements.bookingBrowserSizeToggle.setAttribute("title", isWide ? "Make compact" : "Expand");
    elements.bookingBrowserSizeToggle.setAttribute("aria-expanded", String(isWide && !isCollapsed));
    elements.bookingBrowserSizeToggle.disabled = isCollapsed;
  }

  if (elements.bookingBrowserCollapseToggle) {
    elements.bookingBrowserCollapseToggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
    elements.bookingBrowserCollapseToggle.setAttribute("aria-label", "Close booking queue");
    elements.bookingBrowserCollapseToggle.setAttribute("title", "Close booking queue");
  }

  if (elements.bookingBrowserRailToggle) {
    elements.bookingBrowserRailToggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h14v13H5zM8 9h7M8 13h7"/></svg><span>Bookings</span>';
    elements.bookingBrowserRailToggle.setAttribute("aria-label", "Open booking queue");
    elements.bookingBrowserRailToggle.setAttribute("title", "Open booking queue");
    elements.bookingBrowserRailToggle.hidden = !isCollapsed;
  }
}

function renderSummaryEmptyState() {
  return [
    '<section class="summary-empty-state">',
    '  <span class="summary-empty-eyebrow">No booking loaded</span>',
    '  <strong>Select a booking to see its operational context.</strong>',
    '  <p>Use the queue on the left or the search field above to load a record and continue working without leaving the workspace.</p>',
    "</section>"
  ].join("");
}

function renderSummaryMainPanel(booking, viewName) {
  if (viewName === "financial") {
    return renderFinancialSummaryView(booking);
  }

  const summaryViews = {
    basic: {
      title: "Booking Information",
      items: [
        buildSummaryItem("Booking Name", getBookingValue(booking, ["Deal_Name", "Name", "Booking_Name"])),
        buildSummaryItem("Arrival Date", formatDate(booking.Arrival_Date)),
        buildSummaryItem("Departure Date", formatDate(booking.Departure_Date)),
        buildSummaryItem("Trip Duration", getTripDurationLabel(booking)),
        buildSummaryItem("Travelers Number", firstTextValue(booking.Travellers_Number, booking.Travelers_Number, booking.Number_of_Travelers))
      ]
    },
    contact: {
      title: "Client",
      items: [
        buildSummaryItem("Contact", getBookingValue(booking, ["Contact_Name", "Primary_Contact"])),
        buildSummaryItem("Contact Email", getBookingValue(booking, ["Agent_Email", "Travel_Agent_Email"])),
        buildSummaryItem("Client", getBookingValue(booking, ["Client_Name", "Account_Name", "Agency"])),
        buildSummaryItem("Client Type", getBookingValue(booking, ["Client_Type"]))
      ]
    },
    analytics: {
      title: "Analitics",
      items: [
        buildSummaryItem("Traveler type", getBookingValue(booking, ["Traveler_Type", "Traveller_Type", "Travellers_Type"])),
        buildSummaryItem("Trip type", getBookingValue(booking, ["Trip_Type"])),
        buildSummaryItem("Department", getBookingValue(booking, ["Department"])),
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
  const sections = viewName === "team"
    ? [summaryViews.team]
    : [summaryViews.basic, summaryViews.contact, summaryViews.analytics];

  return [
    '<div class="summary-view-layout">',
    sections.map(function (section) {
      return '<section class="summary-section"><div class="summary-section-header"><h2>' +
        escapeHtml(section.title) + '</h2></div><div class="summary-cards-grid">' +
        section.items.join("") + '</div></section>';
    }).join(""),
    "</div>"
  ].join("");
}

function renderDeskSummaryPanel(booking, state) {
  var ticketId = firstTextValue(booking.Desk_Ticket_ID, booking.Desk_Ticket_Id, booking.DeskTicketID, booking["Desk Ticket ID"]);
  var ticket = state.deskTicket;

  if (!ticketId || ticketId === "-") {
    return '<section class="summary-section"><div class="summary-section-header"><h2>Desk</h2></div><p class="summary-empty-state">This booking has no associated Desk ticket.</p></section>';
  }

  if (state.deskTicketLoading) {
    return '<section class="summary-section"><div class="summary-section-header"><h2>Desk</h2></div><p class="summary-empty-state">Loading the latest ticket interaction…</p></section>';
  }

  if (state.deskTicketError) {
    return '<section class="summary-section"><div class="summary-section-header"><h2>Desk</h2></div><p class="summary-empty-state">' + escapeHtml(state.deskTicketError) + '</p></section>';
  }

  if (!ticket) {
    return '<section class="summary-section"><div class="summary-section-header"><h2>Desk</h2></div><p class="summary-empty-state">No Desk information is available yet.</p></section>';
  }

  var interaction = ticket.latest_interaction || {};
  var party = interaction.party === "agent" ? "Our team" : interaction.party === "customer" ? "Customer" : "System";
  var openButton = ticket.url
    ? '<a class="button tertiary compact" href="' + escapeHtml(ticket.url) + '" target="_blank" rel="noopener noreferrer">Open in Desk</a>'
    : "";

  return [
    '<section class="summary-section">',
    '  <div class="summary-section-header"><h2>Desk</h2>' + openButton + '</div>',
    '  <div class="summary-cards-grid">',
    buildSummaryItem("Ticket", ticket.ticket_number || ticket.id || ticketId),
    buildSummaryItem("Status", ticket.status || "-"),
    buildSummaryItem("Last interaction", party),
    buildSummaryItem("When", interaction.created_time ? formatDateTime(interaction.created_time) : "-"),
    buildSummaryItem("By", interaction.author_name || "-"),
    '  </div>',
    '  <article class="summary-metric-panel"><h3>Latest message</h3><p>' + escapeHtml(interaction.summary || "No message preview is available.") + '</p></article>',
    '</section>'
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

function renderSummaryHero(booking) {
  return [
    '<section class="summary-overview-hero">',
    '  <div class="summary-overview-bar">',
    '    <span class="summary-overview-kicker">Booking reference</span>',
    '    <strong class="summary-overview-bar-title">MFSP ' + escapeHtml(booking.MFSP_Reference || "-") + "</strong>",
    "  </div>",
    '  <div class="summary-overview-meta summary-overview-meta-inline">',
    '    <article class="summary-overview-meta-item">',
    '      <span class="label">Arrival</span>',
    '      <strong>' + escapeHtml(formatDate(booking.Arrival_Date)) + "</strong>",
    "    </article>",
    '    <article class="summary-overview-meta-item">',
    '      <span class="label">Departure</span>',
    '      <strong>' + escapeHtml(formatDate(booking.Departure_Date)) + "</strong>",
    "    </article>",
    '    <article class="summary-overview-meta-item">',
    '      <span class="label">Trip Duration</span>',
    '      <strong>' + escapeHtml(getTripDurationLabel(booking)) + "</strong>",
    "    </article>",
    '    <article class="summary-overview-meta-item">',
    '      <span class="label">Travelers</span>',
    '      <strong>' + escapeHtml(firstTextValue(booking.Travelers_Number, booking.Travellers_Number)) + "</strong>",
    "    </article>",
    "  </div>",
    "</section>"
  ].join("");
}

function renderWorkspaceEmptyState(state) {
  const isBookingQueueLoading = !state.initialized || state.bookingBrowserLoading;

  if (isBookingQueueLoading) {
    return [
      '<section class="workspace-surface workspace-empty-state workspace-empty-state--loading" aria-live="polite">',
      '  <div class="workspace-empty-state-copy">',
      '    <span class="table-loading-indicator" aria-hidden="true"></span>',
      '    <strong>Please wait, loading your workspace…</strong>',
      '  </div>',
      '</section>'
    ].join("");
  }

  return [
    '<section class="workspace-surface workspace-empty-state">',
    '  <div class="workspace-empty-state-copy">',
    '    <span class="workspace-section-eyebrow">Booking workspace</span>',
    '    <strong>Choose a booking to start working</strong>',
    "  </div>",
    "</section>"
  ].join("");
}

function renderWorkspaceDashboard(booking) {
  const tripContactLabel = normalizeComparableText(getBookingValue(booking, ["Client_Type"])) === "direct client"
    ? "Trip main contact"
    : "Agent";

  return [
    '<section class="workspace-surface workspace-hero-card booking-header">',
    '  <div class="workspace-hero-top booking-header-top">',
    '    <div class="workspace-hero-copy">',
    '      <span class="workspace-section-eyebrow">Active booking</span>',
    '      <h2>' + escapeHtml([booking.MFSP_Reference, booking.Deal_Name].filter(Boolean).join(" · ") || "Booking") + "</h2>",
    '      <p class="booking-header-agency-contact-line"><span>' + escapeHtml(getLookupName(booking.Account_Name) || "No agency linked") + '</span><span class="booking-header-agent-inline" aria-label="' + escapeHtml(tripContactLabel) + '"><b aria-hidden="true">|</b><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3.5 19c.5-3 2.4-5 5.5-5s5 2 5.5 5M16 5.5a3 3 0 0 1 0 5.7M17.5 14c1.8.4 3 1.8 3.4 4"/></svg>' + escapeHtml(getLookupName(booking.Contact_Name) || "-") + "</span></p>",
    '      <p class="booking-header-agency-line"><span>' + escapeHtml(booking.MFSP_Reference || "-") + " · " + escapeHtml(getLookupName(booking.Account_Name) || "No agency linked") + '</span><span class="booking-header-agent-inline" aria-label="' + escapeHtml(tripContactLabel) + '"><b aria-hidden="true">|</b><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3.5 19c.5-3 2.4-5 5.5-5s5 2 5.5 5M16 5.5a3 3 0 0 1 0 5.7M17.5 14c1.8.4 3 1.8 3.4 4"/></svg>' + escapeHtml(getLookupName(booking.Contact_Name) || "-") + "</span></p>",
    '  <div class="booking-header-metadata" aria-label="Booking details">',
    '    <span class="booking-header-metadata-item"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/></svg>' + escapeHtml(formatDate(booking.Arrival_Date)) + " - " + escapeHtml(formatDate(booking.Departure_Date)) + "</span>",
    '    <span class="booking-header-metadata-item"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg>' + escapeHtml(getTripDurationLabel(booking)) + "</span>",
    '    <span class="booking-header-metadata-item"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3.5 19c.5-3 2.4-5 5.5-5s5 2 5.5 5M16 5.5a3 3 0 0 1 0 5.7M17.5 14c1.8.4 3 1.8 3.4 4"/></svg>' + escapeHtml(firstTextValue(booking.Travelers_Number, booking.Travellers_Number)) + " travelers</span>",
    "  </div>",
    "    </div>",
    "  </div>",
    '  <div class="booking-header-trip-line">' + escapeHtml(formatDate(booking.Arrival_Date)) + " → " + escapeHtml(formatDate(booking.Departure_Date)) + "<span>·</span>" + escapeHtml(getTripDurationLabel(booking)) + "<span>·</span>" + escapeHtml(firstTextValue(booking.Travelers_Number, booking.Travellers_Number)) + " travelers</div>",
    '  <div class="workspace-workflow-slot"></div>',
    "</section>"
  ].join("");
}

function buildWorkspaceContextItem(label, value) {
  return [
    '<article class="workspace-context-item">',
    '  <span class="label">' + escapeHtml(label) + "</span>",
    '  <strong>' + escapeHtml(value || "-") + "</strong>",
    "</article>"
  ].join("");
}

function renderBookingActionArea(elements, booking, state) {
  if (!booking) {
    elements.actionEzusSyncAt.textContent = "-";
    if (elements.bookingTravelStatus) {
      elements.bookingTravelStatus.textContent = "-";
    }
    if (elements.bookingDeskStatus) {
      elements.bookingDeskStatus.textContent = "-";
    }
    if (elements.bookingSyncInfo) {
      elements.bookingSyncInfo.removeAttribute("data-tooltip");
      elements.bookingSyncInfo.hidden = true;
    }
    if (elements.actionHasAxus) {
      elements.actionHasAxus.textContent = "Not set";
      elements.actionHasAxus.className = "";
    }
    renderItineraryLinkControl(elements, "");
    renderBookingQuickAccess(elements, null, "");
    elements.actionEzusSyncWarning.hidden = true;
    elements.actionEzusSyncWarning.textContent = "";
    elements.actionEzusSyncWarning.className = "booking-status-note";
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
  const travelStatus = getBookingTravelStatus(booking);

  var lastSyncAt = lastSyncAtRaw ? new Date(lastSyncAtRaw) : null;
  elements.actionEzusSyncAt.textContent = lastSyncAt && !Number.isNaN(lastSyncAt.getTime())
    ? formatElapsedTime(Date.now() - lastSyncAt.getTime()) + " ago"
    : "No sync recorded";
  if (elements.bookingSyncInfo) {
    elements.bookingSyncInfo.hidden = !lastSyncAtRaw;
    elements.bookingSyncInfo.setAttribute(
      "data-tooltip",
      "Last synchronized by: " + (lastSyncBy || "Unknown") + ". When: " + (lastSyncAtRaw ? formatDateTime(lastSyncAtRaw) : "Unknown")
    );
  }
  if (elements.bookingTravelStatus) {
    elements.bookingTravelStatus.textContent = travelStatus ? travelStatus.label : "Dates unavailable";
  }
  if (elements.actionHasAxus) {
    elements.actionHasAxus.textContent = hasAxusState.label;
    elements.actionHasAxus.className = "action-status-badge " + hasAxusState.className;
  }
  renderItineraryLinkControl(elements, getItineraryLinkValue(booking));
  renderBookingQuickAccess(elements, booking, hasAxusState.label);
  renderBookingDeskStatus(elements, booking, state);
  elements.actionEzusSyncWarning.hidden = !syncMessage;
  elements.actionEzusSyncWarning.textContent = syncMessage ? syncMessage.text : "";
  elements.actionEzusSyncWarning.className = "booking-status-note " + (syncMessage ? syncMessage.className : "");
}

function renderBookingQuickAccess(elements, booking, itineraryFormat) {
  if (!elements.bookingQuickAccess) {
    return;
  }

  const deskTicketId = getBookingQuickAccessValue(booking, ["Desk Ticket ID", "Desk_Ticket_ID", "Desk_Ticket_Id", "DeskTicketID"]);
  const workdriveFolderId = getBookingQuickAccessValue(booking, ["Booking Workdrive Folder ID", "Booking_Workdrive_Folder_ID", "Booking_WorkDrive_Folder_ID", "BookingWorkdriveFolderID", "Workdrive_Folder_ID"]);
  const ezusProjectApi = getBookingQuickAccessValue(booking, ["Ezus Project API", "Ezus_Project_API", "Ezus_Project_Api", "EzusProjectAPI", "Ezus_Project_ID"]);
  const axusItineraryId = getBookingQuickAccessValue(booking, ["Axus Itinerary ID", "Axus_Itinerary_ID", "AXUS_Itinerary_ID", "Axus_Itinerary_Id", "AXUS Itinerary ID"]);
  const isAxus = itineraryFormat === "AXUS";
  const isEzus = itineraryFormat === "EZUS";

  setQuickAccessLink(elements.quickAccessDesk, deskTicketId, "https://desk.zoho.eu/agent/madeforspainandportugal/new-request-handling/tickets/details/");
  setQuickAccessLink(elements.quickAccessWorkdrive, workdriveFolderId, "https://workdrive.zoho.eu/folder/");
  setQuickAccessLink(elements.quickAccessEzus, isEzus ? ezusProjectApi : "", "https://pro.ezus.io/project?id=");
  setQuickAccessLink(elements.quickAccessAxus, isAxus ? axusItineraryId : "", "https://axustravelapp.com/admin/itinerary/");

  elements.bookingQuickAccess.hidden = !booking || ![deskTicketId, workdriveFolderId, isEzus ? ezusProjectApi : "", isAxus ? axusItineraryId : ""].some(Boolean);
}

function getBookingQuickAccessValue(booking, fieldNames) {
  const value = booking ? getBookingValue(booking, fieldNames) : "";
  return value && value !== "-" ? value : "";
}

function setQuickAccessLink(linkElement, id, urlPrefix) {
  if (!linkElement) {
    return;
  }

  linkElement.hidden = !id;
  if (id) {
    linkElement.href = urlPrefix + encodeURIComponent(id);
  } else {
    linkElement.removeAttribute("href");
  }
}

function renderItineraryLinkControl(elements, itineraryLink) {
  if (!elements.actionItineraryOpen || !elements.actionItineraryEdit || !elements.actionItineraryForm) {
    return;
  }

  const hasItineraryLink = Boolean(itineraryLink);
  elements.actionItineraryLink.classList.toggle("is-missing", !hasItineraryLink);
  elements.actionItineraryOpen.hidden = false;
  elements.actionItineraryOpen.textContent = hasItineraryLink ? "Open itinerary ↗" : "Itinerary link required";
  elements.actionItineraryOpen.setAttribute("aria-label", hasItineraryLink ? "Open itinerary" : "Add required itinerary link");
  elements.actionItineraryEdit.hidden = !hasItineraryLink;
  elements.actionItineraryEdit.textContent = "Edit";
  elements.actionItineraryForm.hidden = true;
  elements.actionItineraryLink.classList.remove("is-editing");
}

function getItineraryLinkValue(booking) {
  var fieldNames = ["Axus_Link", "AXUS_Link", "AXUS Link", "Axus Link"];

  for (var index = 0; index < fieldNames.length; index += 1) {
    var rawValue = booking && booking[fieldNames[index]];
    var itineraryLink = rawValue === null || rawValue === undefined ? "" : String(rawValue).trim();
    var normalizedLink = itineraryLink.toLowerCase();

    if (itineraryLink && normalizedLink !== "null" && normalizedLink !== "undefined" && itineraryLink !== "-") {
      return itineraryLink;
    }
  }

  return "";
}

function renderBookingDeskStatus(elements, booking, state) {
  if (!elements.bookingDeskStatus) {
    return;
  }

  var ticketId = firstTextValue(booking.Desk_Ticket_ID, booking.Desk_Ticket_Id, booking.DeskTicketID, booking["Desk Ticket ID"]);
  var ticket = state && state.deskTicket;

  if (!ticketId || ticketId === "-") {
    elements.bookingDeskStatus.textContent = "No Desk ticket";
    return;
  }

  if (state && state.deskTicketLoading) {
    elements.bookingDeskStatus.textContent = "Loading latest interaction…";
    return;
  }

  if (state && state.deskTicketError) {
    elements.bookingDeskStatus.textContent = "Interaction unavailable";
    return;
  }

  if (!ticket) {
    elements.bookingDeskStatus.textContent = "No interaction available";
    return;
  }

  elements.bookingDeskStatus.textContent = formatDeskLatestInteraction(ticket);
}

export function formatDeskLatestInteraction(ticket) {
  if (!ticket) return "No interaction available";
  var interaction = ticket.latest_interaction || {};
  var party = interaction.party === "agent" ? "Our team" : interaction.party === "customer" ? "Client" : "System";
  var author = interaction.author_name ? " · " + interaction.author_name : "";
  var interactionTime = interaction.created_time ? new Date(interaction.created_time) : null;
  var elapsed = interactionTime && !Number.isNaN(interactionTime.getTime())
    ? " · " + formatElapsedTime(Date.now() - interactionTime.getTime()) + " ago"
    : "";

  return party + author + elapsed;
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
  const orderedTransitions = transitions.slice().sort(function (left, right) {
    return Number(isClosingBookingTransition(left)) - Number(isClosingBookingTransition(right));
  });
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
    '<section class="booking-workflow">',
    '  <div class="booking-workflow-heading">',
    '    <span class="booking-workflow-title">Workflow</span>',
    "  </div>",
    '  <div class="booking-workflow-row">',
    '    <div class="booking-workflow-timeline" aria-label="Booking workflow status">',
    '        <span class="summary-blueprint-state" style="' + escapeHtml(buildBlueprintStateStyle(currentStateColor)) + '">' + escapeHtml(currentStateLabel) + "</span>",
    "    </div>",
    orderedTransitions.length
      ? '    <div class="booking-workflow-actions">' + renderBookingBlueprintTransitions(orderedTransitions) + "</div>"
      : '    <span class="booking-workflow-empty">No workflow action is currently required.</span>',
    "  </div>",
    "</section>"
  ].join("");
}

function renderBookingBlueprintPlaceholder(title, message, modifierClass) {
  const panelClassName = ["booking-workflow", modifierClass || ""].filter(Boolean).join(" ");

  return [
    '<section class="' + escapeHtml(panelClassName) + '">',
    '  <span class="booking-workflow-title">' + escapeHtml(title || "Workflow") + "</span>",
    '  <span class="booking-workflow-empty">' + escapeHtml(message || "") + "</span>",
    "</section>"
  ].join("");
}

function renderBookingBlueprintTransitions(transitions) {
  return '<div class="summary-blueprint-transition-list">' +
    '<div class="workflow-transition-group">' + renderWorkflowTransitionButtons(transitions, true) + "</div>" +
    "</div>";
}

function renderWorkflowTransitionButtons(transitions, canContainPrimary) {
  return transitions.map(function (transition, index) {
    const transitionId = transition && transition.id ? String(transition.id) : "";
    const transitionName = transition && transition.name ? String(transition.name) : (transition && transition.next_field_value ? String(transition.next_field_value) : "Transition");
    const transitionColor = transition && transition.color_code ? String(transition.color_code) : "#eefaf7";
    const transitionTextColor = transition && transition.text_color_code ? String(transition.text_color_code) : "#132019";
    const transitionFields = Array.isArray(transition && transition.fields) ? transition.fields : [];
    const requiresFields = transitionFields.length > 0;
    const isDisabled = transition && transition.criteria_matched === false;
    const normalizedName = normalizeComparableText(transitionName);
    const isDestructive = normalizedName.indexOf("cancel") !== -1 || normalizedName.indexOf("dead") !== -1;
    const actionClassName = ["blueprint-transition-button", canContainPrimary && index === 0 && !isDisabled ? "blueprint-transition-button--primary" : "", isDestructive ? "blueprint-transition-button--danger" : ""].filter(Boolean).join(" ");
    const helperText = requiresFields
      ? transitionFields.length + (transitionFields.length === 1 ? " required field" : " required fields")
      : transition && transition.next_field_value
        ? "Move to: " + transition.next_field_value
        : "Ready to run";

    return [
      '<button class="' + escapeHtml(actionClassName) + '" type="button" title="' + escapeHtml(transitionName) + '" data-blueprint-transition-id="' + escapeHtml(transitionId) + '" data-blueprint-transition-name="' + escapeHtml(transitionName) + '" style="' + escapeHtml(buildBlueprintTransitionStyle(transitionColor, transitionTextColor)) + '"' + (isDisabled ? " disabled" : "") + ">",
      '  <span class="blueprint-transition-button-name">' + escapeHtml(transitionName) + "</span>",
      '  <span class="blueprint-transition-button-meta">' + escapeHtml(helperText) + "</span>",
      "</button>"
    ].join("");
  }).join("");
}

function isClosingBookingTransition(transition) {
  const targetStage = normalizeComparableText(transition && transition.next_field_value || "");
  const transitionState = normalizeComparableText(transition && transition.state || "");

  if (transitionState === "closed") {
    return true;
  }

  return ["closed", "cancelled", "canceled", "dead", "booking completed", "trip accounting closure"].some(function (closingStage) {
    return targetStage.indexOf(closingStage) !== -1;
  });
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

function buildSummaryMetricRow(label, value) {
  return [
    '<div class="summary-metric-row">',
    '  <span class="label">' + escapeHtml(label) + "</span>",
    '  <strong>' + escapeHtml(value !== null && value !== undefined && value !== "" ? String(value) : "-") + "</strong>",
    "</div>"
  ].join("");
}

export function isBookingSyncRequired(booking) {
  if (!booking) return false;
  const lastSyncAtRaw = getBookingRawValue(booking, ["Last_Ezus_Sync_At", "Last EZUS Sync At", "Last_EZUS_Sync_At"]);
  return Boolean(buildEzusSyncMessage(booking, lastSyncAtRaw));
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
    return staleStages[normalizedStage]
      ? { text: "You must sync", className: "action-sync-message--alert" }
      : null;
  }

  const lastSyncAt = new Date(lastSyncAtRaw);

  if (Number.isNaN(lastSyncAt.getTime())) {
    return null;
  }

  const elapsedMs = Date.now() - lastSyncAt.getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  if (staleStages[normalizedStage] && elapsedMs > dayMs) {
    return {
      text: "You must sync",
      className: "action-sync-message--alert"
    };
  }

  return null;
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
    label: value || "Unknown",
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

function getTripDurationLabel(booking) {
  var explicitDuration = getBookingValue(booking, ["Trip_Duration", "Trip_Duration_Days"]);

  if (explicitDuration && explicitDuration !== "-") {
    const numericDuration = Number(explicitDuration);
    if (!isNaN(numericDuration)) {
      return numericDuration + (numericDuration === 1 ? " day" : " days");
    }

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

function getBookingTravelStatus(booking) {
  var arrival = parseDateOnlyValue(booking.Arrival_Date);
  var departure = parseDateOnlyValue(booking.Departure_Date);

  if (!arrival || !departure) {
    return null;
  }

  var today = new Date();
  today = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  var dayMs = 24 * 60 * 60 * 1000;

  if (today < arrival) {
    var daysToArrival = Math.round((arrival.getTime() - today.getTime()) / dayMs);
    return {
      type: "upcoming",
      label: daysToArrival + (daysToArrival === 1 ? " day to arrival" : " days to arrival")
    };
  }

  if (today <= departure) {
    return { type: "on-tour", label: "On Tour" };
  }

  var daysSinceDeparture = Math.round((today.getTime() - departure.getTime()) / dayMs);
  return {
    type: "past",
    label: daysSinceDeparture + (daysSinceDeparture === 1 ? " day since departure" : " days since departure")
  };
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

function buildBookingBrowserOwnerOptions(state) {
  return Array.isArray(state.bookingBrowserOwnerOptions)
    ? state.bookingBrowserOwnerOptions.slice()
    : [];
}

function buildBookingBrowserSearchByOptions(selectedValue) {
  const options = [
    { value: "booking_owner", label: "Booking Owner" },
    { value: "sales_rep", label: "Sales rep" },
    { value: "reservations_rep", label: "Reservations rep" },
    { value: "accounting_rep", label: "Accounting rep" },
    { value: "guest_relations_rep", label: "Guest relations rep" },
    { value: "hour_rep", label: "24h rep" }
  ];

  return options.map(function (option) {
    return '<option value="' + option.value + '"' + (option.value === selectedValue ? " selected" : "") + ">" +
      escapeHtml(option.label) +
      "</option>";
  }).join("");
}

function buildBookingBrowserOwnerOptionMarkup(ownerOptions, selectedOwnerId) {
  const selectedOption = (ownerOptions || []).find(function (option) {
    return option && option.value === selectedOwnerId;
  });
  const selectedRole = String(selectedOption && selectedOption.role || "").trim();
  const groups = {};

  (ownerOptions || []).forEach(function (option) {
    if (!option || !option.value || !option.label) {
      return;
    }

    const role = String(option.role || "Other").trim() || "Other";
    groups[role] = groups[role] || [];
    groups[role].push(option);
  });

  const roles = Object.keys(groups).sort(function (left, right) {
    if (left === selectedRole) {
      return -1;
    }
    if (right === selectedRole) {
      return 1;
    }
    return left.localeCompare(right);
  });
  const placeholder = '<option value="">Select owner</option>';

  return placeholder + roles.map(function (role) {
    const options = groups[role].sort(function (left, right) {
      return left.label.localeCompare(right.label);
    }).map(function (option) {
      return '<option value="' + escapeHtml(option.value) + '"' + (option.value === selectedOwnerId ? " selected" : "") + ">" +
        escapeHtml(option.label) +
        "</option>";
    }).join("");

    return '<optgroup label="' + escapeHtml(role) + '">' + options + "</optgroup>";
  }).join("");
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
    const stageValue = normalizeComparableText(getBookingStageValue(booking) || "");
    const matchesStage = !selectedStages.length || selectedStages.indexOf(stageValue) !== -1;

    // The API query already applies the selected search field and User ID.
    // Do not re-check Booking Owner here, because the selected field can be a rep lookup.
    return matchesStage;
  }).sort(function (left, right) {
    const leftArrival = left.Arrival_Date || "";
    const rightArrival = right.Arrival_Date || "";

    if (leftArrival === rightArrival) {
      return String(left.Deal_Name || "").localeCompare(String(right.Deal_Name || ""));
    }

    return leftArrival.localeCompare(rightArrival);
  });
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

function buildBlueprintStateStyle(color) {
  return [
    "background:" + color,
    "border-color:" + color,
    "color:" + getReadableTextColor(color)
  ].join("; ");
}

function buildBlueprintTransitionStyle(backgroundColor, textColor) {
  const softenedBackground = buildSoftenedBlueprintColor(backgroundColor, 0.1);
  const softenedBorder = buildSoftenedBlueprintColor(backgroundColor, 0.72);
  const metaColor = textColor || "rgba(19,32,25,0.72)";

  return [
    "background:" + softenedBackground,
    "border-color:" + softenedBorder,
    "--blueprint-hover-border:" + softenedBorder,
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

function getBookingValue(booking, keys) {
  var rawValue = getBookingRawValue(booking, keys);

  if (rawValue === null || rawValue === undefined || rawValue === "") {
    return "-";
  }

  if (Array.isArray(rawValue)) {
    var values = rawValue.map(function (value) {
      return getLookupName(value) || String(value || "");
    }).filter(function (value) {
      return value !== "";
    });

    return values.length ? values.join(", ") : "-";
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
    var candidate = arguments[index];

    if (candidate !== null && candidate !== undefined && String(candidate).trim() !== "") {
      return String(candidate).trim();
    }
  }

  return "-";
}
