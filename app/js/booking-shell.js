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
  const summaryView = state.summaryView || "basic";
  const switchButtons = {
    basic: elements.summaryViewBasic,
    financial: elements.summaryViewFinancial,
    contact: elements.summaryViewContact,
    desk: elements.summaryViewDesk,
    analytics: elements.summaryViewAnalytics,
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
  renderBookingAdminActions(elements, state, booking);

  if (!booking) {
    if (elements.bookingMainShell) {
      elements.bookingMainShell.classList.add("is-empty-workspace");
    }
    elements.summaryDashboard.innerHTML = renderWorkspaceEmptyState(state);
    if (elements.summaryQuickAccess) {
      elements.summaryQuickAccess.innerHTML = renderWorkspaceQuickAccess(true);
    }
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

  if (elements.bookingMainShell) {
    elements.bookingMainShell.classList.remove("is-empty-workspace");
  }
  elements.summaryDashboard.innerHTML = renderWorkspaceDashboard(booking, state);
  if (elements.summaryQuickAccess) {
    elements.summaryQuickAccess.innerHTML = renderWorkspaceQuickAccess(false);
  }
  elements.summaryBlueprintPanel.innerHTML = renderBookingBlueprintPanel(state);
  const workflowSlot = elements.summaryDashboard.querySelector(".workspace-workflow-slot");
  if (workflowSlot) {
    workflowSlot.appendChild(elements.summaryBlueprintPanel);
  }
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
  const ownerOptions = buildBookingBrowserOwnerOptions(state);
  const stageOptions = buildBookingBrowserStageOptions(state.bookings, state.bookingBrowserStageOptions);
  const hasStageOptions = stageOptions.length > 0;
  const filteredBookings = filterBookingsForBrowser(state.bookings, state);
  const pendingOwnerId = state.bookingBrowserPendingOwnerId || "";
  const pendingStages = Array.isArray(state.bookingBrowserPendingStages) ? state.bookingBrowserPendingStages : [];
  const isWide = Boolean(state.bookingBrowserWide);
  const columnCount = isWide ? 9 : 4;
  const isWorkspaceLoading = !state.initialized || state.bookingBrowserLoading;

  applyBookingBrowserLayoutState(elements, state);
  elements.bookingBrowserHead.innerHTML = buildBookingBrowserHeaders(isWide);

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

  if (!filteredBookings.length) {
    elements.bookingBrowserBody.innerHTML = [
      '<tr class="booking-browser-empty-row">',
      '  <td colspan="' + columnCount + '" class="table-empty booking-browser-empty">',
      '    <strong>No bookings found</strong>',
      '    <span>Try changing the owner or stage filters.</span>',
      '  </td>',
      '</tr>'
    ].join("");
    return;
  }

  elements.bookingBrowserBody.innerHTML = filteredBookings.map(function (booking) {
    const isActive = String(booking.id) === String(state.selectedBookingId || "") ? " active-row" : "";

    return [
      '<tr class="booking-browser-row' + isActive + '" data-browser-booking-id="' + escapeHtml(booking.id) + '">',
      "  <td>" + escapeHtml(booking.Deal_Name || "-") + "</td>",
      "  <td>" + escapeHtml(booking.MFSP_Reference || "-") + "</td>",
      "  <td>" + escapeHtml(formatDate(booking.Arrival_Date)) + "</td>",
      isWide ? "  <td>" + escapeHtml(formatDate(booking.Departure_Date)) + "</td>" : "",
      "  <td>" + escapeHtml(booking.Stage || "-") + "</td>",
      isWide ? "  <td>" + escapeHtml(booking.Travelers_Number || "-") + "</td>" : "",
      isWide ? "  <td>" + escapeHtml(getLookupName(booking.Account_Name) || "-") + "</td>" : "",
      isWide ? "  <td>" + escapeHtml(getLookupName(booking.Primary_Contact) || "-") + "</td>" : "",
      isWide ? "  <td>" + escapeHtml(formatCurrency(booking.Sales_Price)) + "</td>" : "",
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

function buildBookingBrowserHeaders(isWide) {
  const headers = ["Booking", "MFSP", "Arrival date"];

  if (isWide) {
    headers.push("Departure date");
  }

  headers.push("Stage");

  if (isWide) {
    headers.push("Travelers", "Agency", "Primary contact", "Sales price");
  }

  return headers.map(function (label) {
    return "<th>" + escapeHtml(label) + "</th>";
  }).join("");
}

function applyBookingBrowserLayoutState(elements, state) {
  var isWide = Boolean(state.bookingBrowserWide);
  var isCollapsed = Boolean(state.bookingBrowserCollapsed);

  if (elements.bookingHubShell) {
    elements.bookingHubShell.classList.toggle("is-browser-wide", isWide && !isCollapsed);
    elements.bookingHubShell.classList.toggle("is-browser-collapsed", isCollapsed);
  }

  if (elements.bookingBrowserPanel) {
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
      title: "Contacts",
      items: [
        buildSummaryItem("Contact", getBookingValue(booking, ["Contact_Name", "Primary_Contact"])),
        buildSummaryItem("Contact Email", getBookingValue(booking, ["Agent_Email", "Travel_Agent_Email"])),
        buildSummaryItem("Client", getBookingValue(booking, ["Client_Name", "Account_Name", "Agency"])),
        buildSummaryItem("Client Type", getBookingValue(booking, ["Client_Type"]))
      ]
    },
    analytics: {
      title: "Trip profile",
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
    buildSummaryItem("Priority", ticket.priority || "-"),
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
    '    <strong>Choose a booking to start working.</strong>',
    '    <p>Select a record from the queue or search by MFSP reference or booking name.</p>',
    "  </div>",
    '  <ol class="workspace-empty-steps">',
    '    <li><span>1</span>Review booking status and workflow</li>',
    '    <li><span>2</span>Check trip information and actions</li>',
    '    <li><span>3</span>Manage services, emails and travelers</li>',
    "  </ol>",
    "</section>"
  ].join("");
}

function renderWorkspaceDashboard(booking) {
  const owner = getBookingOwnerInfo(booking);
  const tripContactLabel = normalizeComparableText(getBookingValue(booking, ["Client_Type"])) === "direct client"
    ? "Trip main contact"
    : "Agent";

  return [
    '<section class="workspace-surface workspace-hero-card booking-header">',
    '  <div class="workspace-hero-top booking-header-top">',
    '    <div class="workspace-hero-copy">',
    '      <span class="workspace-section-eyebrow">Active booking</span>',
    '      <h2>' + escapeHtml(booking.Deal_Name || booking.MFSP_Reference || "Booking") + "</h2>",
    '      <p>' + escapeHtml(booking.MFSP_Reference || "-") + " · " + escapeHtml(getLookupName(booking.Account_Name) || "No agency linked") + "</p>",
    "    </div>",
    '    <div class="booking-header-contacts"><div class="booking-header-contact"><span class="label">Owner</span><strong>' + escapeHtml(owner && owner.label ? owner.label : "-") + '</strong></div><div class="booking-header-contact"><span class="label">' + escapeHtml(tripContactLabel) + '</span><strong>' + escapeHtml(getLookupName(booking.Contact_Name) || "-") + "</strong></div></div>",
    "  </div>",
    '  <div class="booking-header-metadata" aria-label="Booking details">',
    '    <span class="booking-header-metadata-item"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/></svg>' + escapeHtml(formatDate(booking.Arrival_Date)) + " - " + escapeHtml(formatDate(booking.Departure_Date)) + "</span>",
    '    <span class="booking-header-metadata-item"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg>' + escapeHtml(getTripDurationLabel(booking)) + "</span>",
    '    <span class="booking-header-metadata-item"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3.5 19c.5-3 2.4-5 5.5-5s5 2 5.5 5M16 5.5a3 3 0 0 1 0 5.7M17.5 14c1.8.4 3 1.8 3.4 4"/></svg>' + escapeHtml(firstTextValue(booking.Travelers_Number, booking.Travellers_Number)) + " travelers</span>",
    "  </div>",
    '  <div class="booking-header-trip-line">' + escapeHtml(formatDate(booking.Arrival_Date)) + " → " + escapeHtml(formatDate(booking.Departure_Date)) + "<span>·</span>" + escapeHtml(getTripDurationLabel(booking)) + "<span>·</span>" + escapeHtml(firstTextValue(booking.Travelers_Number, booking.Travellers_Number)) + " travelers</div>",
    '  <div class="workspace-workflow-slot"></div>',
    "</section>"
  ].join("");
}

function renderWorkspaceQuickAccess(isDisabled) {
  return [
    '<section class="summary-quick-access-card">',
    '  <div class="workspace-surface-header">',
    "    <h3>Quick access</h3>",
    "  </div>",
    '  <div class="workspace-system-grid">',
    buildWorkspaceSystemButton("Desk", "desk", isDisabled),
    buildWorkspaceSystemButton("Ezus", "ezus", isDisabled),
    buildWorkspaceSystemButton("WorkDrive", "workdrive", isDisabled),
    buildWorkspaceSystemButton("Itinerary Link", "itinerary", isDisabled),
    "  </div>",
    '  <div class="quick-access-payments">',
    '    <span class="label">Payments & reports</span>',
    '  <div class="workspace-admin-grid">',
    buildWorkspaceAdminButton("Travelers Payments", "travellers-payments", isDisabled),
    buildWorkspaceAdminButton("Prepayments", "prepayments", isDisabled),
    "  </div>",
    "  </div>",
    '  <div class="quick-access-internal-requests">',
    '    <span class="label">Internal requests</span>',
    '    <div class="workspace-admin-grid">',
    buildWorkspaceInternalRequestButton("Create Product Request", "product", isDisabled),
    buildWorkspaceInternalRequestButton("Create IT Request", "it", isDisabled),
    "    </div>",
    "  </div>",
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
  const openTransitions = transitions.filter(function (transition) {
    return !isClosingBookingTransition(transition);
  });
  const closingTransitions = transitions.filter(function (transition) {
    return isClosingBookingTransition(transition);
  });

  return '<div class="summary-blueprint-transition-list">' +
    '<div class="workflow-transition-group workflow-transition-group--open">' + renderWorkflowTransitionButtons(openTransitions, true) + "</div>" +
    (closingTransitions.length ? '<div class="workflow-transition-group workflow-transition-group--closing">' + renderWorkflowTransitionButtons(closingTransitions, false) + "</div>" : "") +
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

function buildWorkspaceInternalRequestButton(label, requestType, isDisabled) {
  return [
    '<button class="workspace-admin-button workspace-internal-request-button" type="button" data-internal-request="' + escapeHtml(requestType) + '"' + (isDisabled ? " disabled" : "") + ">",
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
