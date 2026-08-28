import { crmExecuteFunction, crmGetAllRecords, crmGetAllUsers, crmGetFields, crmGetRecord, crmSearchRecord, crmUpdateRecord } from "./api.js";
import { MODULES, SERVICE_TABLE_COLUMNS, SERVICE_TABLE_COLUMNS_STORAGE_KEY } from "./constants.js";
import {
  buildGroupedRows,
  cacheBookingLookup,
  indexBookings,
  indexSteps,
  loadBookingServicesForBooking,
  loadBookingStepsForBooking,
  searchBookingByInput
} from "./data.js";
import {
  renderBookingBrowser,
  renderBookingSummary,
  renderBookingWorkspace
} from "./booking-shell.js";
import {
  onChooseBookingReport,
  onCloseBookingReportDialog,
  onCloseCardPurchaseDialog,
  onClosePrepaymentRequestDialog,
  onAddPrepaymentRow,
  onCreatePaymentRequestClick,
  onOpenBookingReportDialog,
  onRecordCardPurchase,
  onCardPurchaseTransactionTypeChange,
  onCardPurchaseOriginalPurchaseChange,
  onCardPurchaseSupportingDocumentsChange,
  onCardPurchaseSupportingDocumentsDrop,
  onPrepaymentTransactionTypeChange,
  onSubmitPrepaymentRequest,
  onSubmitCardPurchaseForm
} from "./dialogs-controller.js";
import {
  ensureBookingTravelersLoaded,
  renderTravelersWorkspace,
  resetTravelersState
} from "./travelers-controller.js";
import {
  previewCardPurchaseFile,
  refreshCardPurchases,
  renderPaymentsWorkspace,
  setPaymentTab
} from "./payments-controller.js";
import {
  applyServiceFilter,
  closeBulkActionMenus,
  clearServiceSelection,
  closeServiceDetails,
  configureServicesController,
  createSelectionSnapshot,
  initializeServiceTableColumns,
  onApplyBulkStatus,
  onCreateDraftForSelection,
  onRequestServicePrepayment,
  onRecordRenfePrepayment,
  onResetServiceColumns,
  onSaveService,
  onSelectedServiceStatusChange,
  onHideNonOperationalServicesChange,
  onServiceColumnsListChange,
  onServiceColumnsListDragEnd,
  onServiceColumnsListDragOver,
  onServiceColumnsListDragStart,
  onServiceColumnsListDrop,
  onServiceFilterToggleClick,
  onServiceMultiFilterChange,
  onServiceSupplierFilterChange,
  onServicesHeadRowChange,
  onToggleServiceColumnsPanel,
  onUpdateServiceNotes,
  renderServicesWorkspace,
  resetServiceFilters,
  restoreSelectionSnapshot,
  setServiceDetailTab,
  setServiceView,
  syncBulkPanels,
  syncBulkStatusActionState,
  toggleBulkDraftsMenu,
  toggleBulkStatusPopover
} from "./services-controller.js";
import { elements } from "./dom.js";
import {
  clearLoading,
  hideSearchResults,
  populateStatusOptions,
  renderActiveTab,
  renderEmailsPanel,
  renderSearchResults,
  renderSelectionPanel,
  setButtonsDisabled,
  setError,
  setNotice,
  showLoading
} from "./render.js";
import { state } from "./state.js";
import {
  DRAFT_FROM_LOGIN_USER_VALUE,
  buildBookingLabel,
  dedupeBookings,
  escapeHtml,
  escapeCriteriaValue,
  getApiErrorDetails,
  getBookingOwnerInfo,
  normalizeBookingCandidate,
  normalizeComparableText
} from "./utils.js";

const MANUAL_BOOKING_STAGE_OPTIONS = [
  "Request Qualified",
  "Testing",
  "Quotation",
  "Proposal Sent",
  "Pending Res Assignment",
  "Reservation In Progress",
  "Changes Requested",
  "All Services Confirmed",
  "FID Sent",
  "Pending Review",
  "FID In Review",
  "Review Done",
  "On Tour",
  "Trip Accounting Closure",
  "Cancelled",
  "Cancelled W/Charges",
  "Dead",
  "Booking Completed"
];
const ZOHO_SDK_TIMEOUT_MS = 4000;

function bindEvents() {
  elements.loadBooking.addEventListener("click", onLoadBookingClick);
  elements.bookingSearch.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" || event.isComposing) {
      return;
    }
    event.preventDefault();
    onLoadBookingClick();
  });
  elements.clearBooking.addEventListener("click", onClearBookingClick);
  elements.createAxus.addEventListener("click", onCreateAxusClick);
  elements.actionItineraryOpen.addEventListener("click", onOpenItineraryLink);
  elements.actionItineraryEdit.addEventListener("click", onEditItineraryLink);
  elements.actionItineraryForm.addEventListener("submit", onSaveItineraryLink);
  elements.syncEzus.addEventListener("click", onSyncEzusClick);
  elements.syncProjectInfo.addEventListener("click", function () {
    onRunAdminEzusSync("project", "Project information");
  });
  elements.syncTravelers.addEventListener("click", function () {
    onRunAdminEzusSync("travellers", "Travelers");
  });
  elements.syncServices.addEventListener("click", function () {
    onRunAdminEzusSync("services", "Services");
  });
  elements.syncContact.addEventListener("click", onSyncContactToEzus);
  elements.openBookingReportDialog.addEventListener("click", onOpenBookingReportDialog);
  elements.createPaymentRequest.addEventListener("click", onCreatePaymentRequestClick);
  elements.bookingReportDialogBackdrop.addEventListener("click", onCloseBookingReportDialog);
  elements.bookingReportDialogClose.addEventListener("click", onCloseBookingReportDialog);
  elements.bookingReportCancellation.addEventListener("click", function () {
    onChooseBookingReport("cancellation");
  });
  elements.bookingReportChange.addEventListener("click", function () {
    onChooseBookingReport("change request");
  });
  elements.cardPurchaseDialogBackdrop.addEventListener("click", onCloseCardPurchaseDialog);
  elements.cardPurchaseDialogClose.addEventListener("click", onCloseCardPurchaseDialog);
  elements.cardPurchaseForm.addEventListener("submit", onSubmitCardPurchaseForm);
  elements.cardPurchaseTransactionPurchase.addEventListener("click", function () { onCardPurchaseTransactionTypeChange("Purchase"); });
  elements.cardPurchaseTransactionRefund.addEventListener("click", function () { onCardPurchaseTransactionTypeChange("Refund"); });
  elements.cardPurchaseOriginalPurchase.addEventListener("change", onCardPurchaseOriginalPurchaseChange);
  elements.cardPurchaseSupportingDocuments.addEventListener("change", function (event) { onCardPurchaseSupportingDocumentsChange(event.target.files); });
  elements.cardPurchaseSupportingDocumentsDropzone.addEventListener("click", function () { elements.cardPurchaseSupportingDocuments.click(); });
  elements.cardPurchaseSupportingDocumentsDropzone.addEventListener("dragover", function (event) { event.preventDefault(); elements.cardPurchaseSupportingDocumentsDropzone.classList.add("is-dragging"); });
  elements.cardPurchaseSupportingDocumentsDropzone.addEventListener("dragleave", function () { elements.cardPurchaseSupportingDocumentsDropzone.classList.remove("is-dragging"); });
  elements.cardPurchaseSupportingDocumentsDropzone.addEventListener("drop", function (event) { event.preventDefault(); elements.cardPurchaseSupportingDocumentsDropzone.classList.remove("is-dragging"); onCardPurchaseSupportingDocumentsDrop(event.dataTransfer.files); });
  elements.prepaymentRequestDialogBackdrop.addEventListener("click", onClosePrepaymentRequestDialog);
  elements.prepaymentRequestDialogClose.addEventListener("click", onClosePrepaymentRequestDialog);
  elements.prepaymentRequestForm.addEventListener("submit", onSubmitPrepaymentRequest);
  elements.prepaymentAddPayment.addEventListener("click", onAddPrepaymentRow);
  elements.prepaymentTransactionType.addEventListener("change", onPrepaymentTransactionTypeChange);
  if (elements.tabBooking) {
    elements.tabBooking.addEventListener("click", function () {
      setSummaryView("basic");
      switchTab("booking");
    });
  }
  elements.tabServices.addEventListener("click", function () {
    switchTab("services");
  });
  elements.tabEmails.addEventListener("click", function () {
    switchTab("emails");
  });
  if (elements.tabPayments) {
    elements.tabPayments.addEventListener("click", function () {
      switchTab("payments");
    });
  }
  if (elements.paymentTabTravelers) {
    elements.paymentTabTravelers.addEventListener("click", function () {
      setPaymentTab(elements, state, "travelers");
    });
  }
  if (elements.paymentTabPrepayments) {
    elements.paymentTabPrepayments.addEventListener("click", function () {
      setPaymentTab(elements, state, "prepayments");
    });
  }
  if (elements.paymentTabCardPurchases) {
    elements.paymentTabCardPurchases.addEventListener("click", function () {
      setPaymentTab(elements, state, "cardPurchases");
    });
  }
  if (elements.refreshCardPurchases) {
    elements.refreshCardPurchases.addEventListener("click", function () {
      refreshCardPurchases(elements, state);
    });
  }
  if (elements.paymentTabRenfe) {
    elements.paymentTabRenfe.addEventListener("click", function () {
      setPaymentTab(elements, state, "renfe");
    });
  }
  if (elements.cardPurchasesBody) {
    elements.cardPurchasesBody.addEventListener("click", function (event) {
      const button = event.target.closest("[data-card-purchase-file]");
      if (!button) {
        return;
      }
      previewCardPurchaseFile(state, button.dataset.recordId, button.dataset.fileIndex);
    });
  }
  if (elements.tabReports) {
    elements.tabReports.addEventListener("click", function () {
      switchTab("reports");
    });
  }
  if (elements.tabTravelers) {
    elements.tabTravelers.addEventListener("click", function () {
      switchTab("travelers");
    });
  }
  elements.noticeClose.addEventListener("click", function () {
    setNotice(elements, "");
  });
  elements.errorClose.addEventListener("click", function () {
    setError(elements, "");
  });
  elements.summaryViewBasic.addEventListener("click", function () {
    setSummaryView("basic");
  });
  elements.summaryViewFinancial.addEventListener("click", function () {
    setSummaryView("financial");
  });
  elements.summaryViewContact.addEventListener("click", function () {
    setSummaryView("contact");
  });
  if (elements.summaryViewDesk) {
    elements.summaryViewDesk.addEventListener("click", function () {
      switchTab("desk");
    });
  }
  elements.summaryViewAnalytics.addEventListener("click", function () {
    setSummaryView("analytics");
  });
  if (elements.summaryViewTravelers) {
    elements.summaryViewTravelers.addEventListener("click", function () {
      setSummaryView("travelers");
    });
  }
  elements.summaryViewTeam.addEventListener("click", function () {
    setSummaryView("team");
  });
  elements.summaryBlueprintPanel.addEventListener("click", onWorkspaceActionClick);
  elements.summaryDashboard.addEventListener("click", onWorkspaceActionClick);
  elements.bookingBrowserOwner.addEventListener("change", onBookingBrowserOwnerChange);
  elements.bookingBrowserStagesToggle.addEventListener("click", onBookingBrowserStagesToggleClick);
  elements.bookingBrowserStagesMenu.addEventListener("change", onBookingBrowserStagesChange);
  if (elements.bookingBrowserLoad) {
    elements.bookingBrowserLoad.addEventListener("click", onBookingBrowserLoadClick);
  }
  if (elements.bookingBrowserSizeToggle) {
    elements.bookingBrowserSizeToggle.addEventListener("click", onBookingBrowserSizeToggleClick);
  }
  if (elements.bookingBrowserCollapseToggle) {
    elements.bookingBrowserCollapseToggle.addEventListener("click", onBookingBrowserCollapseToggleClick);
  }
  if (elements.bookingBrowserRailToggle) {
    elements.bookingBrowserRailToggle.addEventListener("click", onBookingBrowserCollapseToggleClick);
  }
  if (elements.bookingRailToggle) {
    elements.bookingRailToggle.addEventListener("click", onBookingRailToggleClick);
  }
  if (elements.bookingRailCollapseToggle) {
    elements.bookingRailCollapseToggle.addEventListener("click", onBookingRailToggleClick);
  }
  document.addEventListener("click", onDocumentClick);
  elements.refreshBookingMails.addEventListener("click", onRefreshBookingMailsClick);
  elements.activeMailList.addEventListener("click", onActiveMailListClick);
  elements.mailSendDraft.addEventListener("click", onSendDraftClick);
  elements.mailEditDraft.addEventListener("click", onEditCommunicationClick);
  elements.mailEditFromButton.addEventListener("click", function () { openInlineCommunicationEditor("from"); });
  elements.mailEditToButton.addEventListener("click", function () { openInlineCommunicationEditor("to"); });
  elements.mailEditCcButton.addEventListener("click", function () { openInlineCommunicationEditor("cc"); });
  elements.mailEditContentButton.addEventListener("click", openCommunicationContentEditor);
  elements.mailContentEditCancel.addEventListener("click", closeCommunicationContentEditor);
  elements.mailContentEditCancelTop.addEventListener("click", closeCommunicationContentEditor);
  elements.mailContentEditSave.addEventListener("click", saveCommunicationContentEditor);
  elements.mailInlineFromCancel.addEventListener("click", closeInlineCommunicationEditor);
  elements.mailInlineToCancel.addEventListener("click", closeInlineCommunicationEditor);
  elements.mailInlineCcCancel.addEventListener("click", closeInlineCommunicationEditor);
  elements.mailInlineFromSave.addEventListener("click", saveInlineCommunicationEditor);
  elements.mailInlineToSave.addEventListener("click", saveInlineCommunicationEditor);
  elements.mailInlineCcSave.addEventListener("click", saveInlineCommunicationEditor);
  [elements.mailInlineToInput, elements.mailInlineCcInput].forEach(function (input) {
    input.addEventListener("keydown", onInlineEmailKeydown);
    input.addEventListener("blur", onInlineEmailBlur);
  });
  [elements.mailInlineToChips, elements.mailInlineCcChips].forEach(function (container) { container.addEventListener("click", onInlineEmailChipClick); });
  elements.mailCancelDraftEdit.addEventListener("click", onCancelCommunicationEdit);
  elements.mailDraftEditor.addEventListener("submit", onSaveCommunicationEdit);
  elements.mailEditorModeVisual.addEventListener("click", function () { setCommunicationEditorMode("visual"); });
  elements.mailEditorModeHtml.addEventListener("click", function () { setCommunicationEditorMode("html"); });
  [elements.mailEditFrom, elements.mailEditTo, elements.mailEditCc, elements.mailEditSubject, elements.mailEditContent, elements.mailEditVisual].forEach(function (input) {
    input.addEventListener("input", syncCommunicationEditorFields);
  });
  elements.mailEditServiceSearch.addEventListener("change", onCommunicationServiceAdd);
  elements.mailEditServicesList.addEventListener("click", onCommunicationServiceRemove);
  elements.mailSendModalClose.addEventListener("click", closeSendModal);
  elements.createDraftModalClose.addEventListener("click", closeCreateDraftModal);
  elements.mailFilterDraft.addEventListener("click", function () { state.emailStatusFilter = "Draft"; clearSelectedMailPreview(); renderEmailsPanel(elements, state); });
  elements.mailFilterSent.addEventListener("click", function () { state.emailStatusFilter = "Sent"; clearSelectedMailPreview(); renderEmailsPanel(elements, state); });
  elements.mailDeleteDraft.addEventListener("click", onDeleteDraftClick);
  elements.draftDeleteConfirmCancel.addEventListener("click", closeDraftDeleteConfirmation);
  elements.draftDeleteConfirmSubmit.addEventListener("click", onConfirmDraftDelete);
  elements.servicesHeadRow.addEventListener("change", onServicesHeadRowChange);
  elements.serviceFilterStatusToggle.addEventListener("click", function (event) {
    onServiceFilterToggleClick("status", event);
  });
  elements.serviceFilterStatusMenu.addEventListener("change", function () {
    onServiceMultiFilterChange("status", elements.serviceFilterStatusMenu);
  });
  elements.serviceFilterSupplier.addEventListener("change", onServiceSupplierFilterChange);
  elements.hideNonOperationalServices.addEventListener("change", onHideNonOperationalServicesChange);
  elements.serviceFilterCategoryToggle.addEventListener("click", function (event) {
    onServiceFilterToggleClick("category", event);
  });
  elements.serviceFilterCategoryMenu.addEventListener("change", function () {
    onServiceMultiFilterChange("category", elements.serviceFilterCategoryMenu);
  });
  elements.serviceFilterSubcategoryToggle.addEventListener("click", function (event) {
    onServiceFilterToggleClick("subcategory", event);
  });
  elements.serviceFilterSubcategoryMenu.addEventListener("change", function () {
    onServiceMultiFilterChange("subcategory", elements.serviceFilterSubcategoryMenu);
  });
  elements.serviceFilterSubdestinationToggle.addEventListener("click", function (event) {
    onServiceFilterToggleClick("subdestination", event);
  });
  elements.serviceFilterSubdestinationMenu.addEventListener("change", function () {
    onServiceMultiFilterChange("subdestination", elements.serviceFilterSubdestinationMenu);
  });
  elements.applyBulkStatus.addEventListener("click", onApplyBulkStatus);
  elements.clearServiceSelection.addEventListener("click", clearServiceSelection);
  elements.bulkStatusToggle.addEventListener("click", function (event) {
    event.stopPropagation();
    toggleBulkStatusPopover();
  });
  elements.bulkStatusPopover.addEventListener("click", function (event) {
    event.stopPropagation();
  });
  elements.bulkStatusCancel.addEventListener("click", closeBulkActionMenus);
  elements.bulkDraftsToggle.addEventListener("click", function (event) {
    event.stopPropagation();
    toggleBulkDraftsMenu();
  });
  elements.bulkDraftsMenu.addEventListener("click", function (event) {
    event.stopPropagation();
  });
  document.addEventListener("click", closeBulkActionMenus);
  elements.closeServiceDetails.addEventListener("click", closeServiceDetails);
  elements.bulkStatusEzus.addEventListener("change", syncBulkStatusActionState);
  elements.fieldStatusEzus.addEventListener("change", onSelectedServiceStatusChange);
  elements.updateServiceNotes.addEventListener("click", onUpdateServiceNotes);
  elements.serviceDetailTabBasic.addEventListener("click", function () {
    setServiceDetailTab("basic");
  });
  elements.serviceDetailTabFinancial.addEventListener("click", function () {
    setServiceDetailTab("financial");
  });
  elements.serviceDetailTabStep.addEventListener("click", function () {
    setServiceDetailTab("step");
  });
  elements.serviceActionPrepayment.addEventListener("click", onRequestServicePrepayment);
  elements.serviceActionCardPurchase.addEventListener("click", onRecordCardPurchase);
  elements.serviceActionRenfe.addEventListener("click", onRecordRenfePrepayment);
  elements.createAvailabilityDraft.addEventListener("click", function () {
    onCreateDraftForSelection("Check Availability", "availability");
    closeBulkActionMenus();
  });
  elements.createReservationsDraft.addEventListener("click", function () {
    onCreateDraftForSelection("Reservation", "reservations");
    closeBulkActionMenus();
  });
  elements.viewFlat.addEventListener("click", function () {
    setServiceView("flat");
  });
  elements.viewGrouped.addEventListener("click", function () {
    setServiceView("grouped");
  });
  elements.toggleServiceColumns.addEventListener("click", onToggleServiceColumnsPanel);
  elements.closeServiceColumns.addEventListener("click", onToggleServiceColumnsPanel);
  elements.serviceColumnsBackdrop.addEventListener("click", onToggleServiceColumnsPanel);
  elements.resetServiceColumns.addEventListener("click", onResetServiceColumns);
  elements.serviceColumnsList.addEventListener("change", onServiceColumnsListChange);
  elements.serviceColumnsList.addEventListener("dragstart", onServiceColumnsListDragStart);
  elements.serviceColumnsList.addEventListener("dragover", onServiceColumnsListDragOver);
  elements.serviceColumnsList.addEventListener("drop", onServiceColumnsListDrop);
  elements.serviceColumnsList.addEventListener("dragend", onServiceColumnsListDragEnd);
  document.addEventListener("keydown", onDocumentKeydown);
  elements.serviceForm.addEventListener("submit", onSaveService);
}

function openExternalWindow(url, errorMessage) {
  const openedWindow = window.open(url, "_blank", "noopener,noreferrer");

  if (!openedWindow) {
    setError(elements, errorMessage || "The page could not be opened. Please allow pop-ups for this page.");
    return false;
  }

  setError(elements, "");
  return true;
}

function getItineraryLinkValue(booking) {
  const fieldNames = [
    "Axus_Link",
    "AXUS_Link",
    "AXUS Link",
    "Axus Link"
  ];

  for (let index = 0; index < fieldNames.length; index += 1) {
    const rawValue = booking && booking[fieldNames[index]];
    const itineraryLink = rawValue === null || rawValue === undefined ? "" : String(rawValue).trim();

    if (itineraryLink && itineraryLink.toLowerCase() !== "null" && itineraryLink.toLowerCase() !== "undefined" && itineraryLink !== "-") {
      return itineraryLink;
    }
  }

  return "";
}

function onOpenItineraryLink() {
  const itineraryLink = getItineraryLinkValue(state.selectedBooking);

  if (!itineraryLink) {
    onEditItineraryLink();
    return;
  }

  openExternalWindow(itineraryLink, "The itinerary link could not be opened. Please allow pop-ups for this page.");
}

function onEditItineraryLink() {
  if (!state.selectedBooking || !elements.actionItineraryForm) {
    return;
  }

  const isOpening = elements.actionItineraryForm.hidden;
  elements.actionItineraryInput.value = getItineraryLinkValue(state.selectedBooking);
  elements.actionItineraryForm.hidden = !isOpening;
  elements.actionItineraryLink.classList.toggle("is-editing", isOpening);
  elements.actionItineraryEdit.textContent = isOpening ? "Cancel" : "Edit";

  if (isOpening) {
    elements.actionItineraryInput.focus();
  }
}

async function onSaveItineraryLink(event) {
  event.preventDefault();

  if (!state.selectedBooking || !state.selectedBookingId) {
    setError(elements, "Load a booking before adding an itinerary link.");
    return;
  }

  const itineraryLink = String(elements.actionItineraryInput.value || "").trim();
  if (!itineraryLink) {
    elements.actionItineraryInput.focus();
    return;
  }

  try {
    const parsedUrl = new URL(itineraryLink);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error("Invalid protocol");
    }
  } catch (error) {
    setError(elements, "Enter a valid itinerary URL starting with http:// or https://.");
    elements.actionItineraryInput.focus();
    return;
  }

  const saveButton = elements.actionItineraryForm.querySelector("button[type='submit']");
  saveButton.disabled = true;
  setError(elements, "");

  try {
    await crmUpdateRecord(MODULES.bookings, {
      id: state.selectedBookingId,
      Axus_Link: itineraryLink
    });
    state.selectedBooking.Axus_Link = itineraryLink;
    elements.actionItineraryForm.hidden = true;
    elements.actionItineraryLink.classList.remove("is-editing");
    elements.actionItineraryEdit.textContent = "Edit";
    renderBookingWorkspace(elements, state);
    setNotice(elements, "Itinerary link saved.");
  } catch (error) {
    setError(elements, error && error.message ? error.message : "The itinerary link could not be saved.");
  } finally {
    saveButton.disabled = false;
  }
}

function getWorkspaceExternalLinkUrl(linkKey) {
  const normalizedKey = String(linkKey || "").trim().toLowerCase();
  const booking = state.selectedBooking || {};
  const deskTicketId = getBookingLinkFieldValue(booking, [
    "Desk Ticket ID",
    "Desk_Ticket_ID",
    "Desk_Ticket_Id",
    "DeskTicketID"
  ]);
  const ezusProjectApi = getBookingLinkFieldValue(booking, [
    "Ezus Project API",
    "Ezus_Project_API",
    "Ezus_Project_Api",
    "EzusProjectAPI",
    "Ezus_Project_ID"
  ]);
  const workdriveFolderId = getBookingLinkFieldValue(booking, [
    "Booking Workdrive Folder ID",
    "Booking_Workdrive_Folder_ID",
    "Booking_WorkDrive_Folder_ID",
    "BookingWorkdriveFolderID",
    "Workdrive_Folder_ID"
  ]);
  const itineraryLink = getItineraryLinkValue(booking);

  if (normalizedKey === "desk" && deskTicketId) {
    return "https://desk.zoho.eu/agent/madeforspainandportugal/new-request-handling/tickets/details/" + encodeURIComponent(deskTicketId);
  }

  if (normalizedKey === "ezus" && ezusProjectApi) {
    return "https://pro.ezus.io/project?id=" + encodeURIComponent(ezusProjectApi);
  }

  if (normalizedKey === "workdrive" && workdriveFolderId) {
    return "https://workdrive.zoho.eu/folder/" + encodeURIComponent(workdriveFolderId);
  }

  if (normalizedKey === "itinerary" && itineraryLink) {
    return itineraryLink;
  }

  if (normalizedKey === "travellers-payments") {
    return "https://creatorapp.zoho.eu/madeforspainandportugal/administration-manager/#Report:All_Travellers_Payments";
  }

  if (normalizedKey === "prepayments") {
    return "https://creatorapp.zoho.eu/madeforspainandportugal/administration-manager/#Report:All_Pre_Payments";
  }

  if (normalizedKey === "product-request") {
    return "https://creatorapp.zoho.eu/madeforspainandportugal/product-manager#Form:Product_Request";
  }

  return "";
}

function getBookingLinkFieldValue(booking, keys) {
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    const value = booking && booking[key];

    if (value !== null && value !== undefined && String(value).trim() !== "") {
      return String(value).trim();
    }
  }

  return "";
}

function openWorkspaceExternalLink(linkKey) {
  if (!state.selectedBooking) {
    setError(elements, "Load a booking before opening workspace shortcuts.");
    return;
  }

  const url = getWorkspaceExternalLinkUrl(linkKey);

  if (!url) {
    setError(elements, "This booking does not have the data needed for that quick access link.");
    return;
  }

  openExternalWindow(url, "The external system could not be opened. Please allow pop-ups for this page.");
}

function clearActiveBookingWorkspace() {
  onCloseBookingReportDialog();
  onCloseCardPurchaseDialog();
  onClosePrepaymentRequestDialog();
  resetTravelersState();
  state.cardPurchases = [];
  state.cardPurchasesLoading = false;
  state.cardPurchasesLoaded = false;
  state.cardPurchasesLoadedBookingId = "";
  state.cardPurchasesError = "";
  state.selectedBookingId = "";
  state.selectedBooking = null;
  state.deskTicket = null;
  state.deskTicketLoading = false;
  state.deskTicketError = "";
  state.deskTicketLoadedBookingId = "";
  state.bookingBlueprint = null;
  state.bookingBlueprintLoading = false;
  state.bookingBlueprintError = "";
  state.services = [];
  state.filteredServices = [];
  state.steps = [];
  state.stepIndex = {};
  state.groupedRows = [];
  state.selectedServiceIds = {};
  state.selectedServiceId = "";
  state.selectedService = null;
  state.selectedStepId = "";
  state.selectedStep = null;
  state.selectedItemType = "service";
  state.serviceStatusDraftValue = "";
  state.emailDrafts = [];
  state.selectedDraftRecordId = "";
  state.mailContentByKey = {};
  state.mailViewerLoadingKey = "";
  state.mailViewerError = "";
  state.mailViewerErrorKey = "";
  state.draftEditorOpen = false;
  state.draftEditorSaving = false;
  state.draftEditorFields = null;
  state.outlookConfirmOpen = false;
  state.draftEmailsLoaded = false;
  state.emailsLoading = false;
  state.draftEmailsError = "";
  state.bookingReportDialogOpen = false;
}

function setSummaryView(viewName) {
  state.summaryView = viewName;
  renderBookingSummary(elements, state);

  if (viewName === "travelers") {
    ensureBookingTravelersLoaded();
  }

  if (viewName === "desk") {
    ensureDeskTicketLoaded();
  }
}

function onBookingBrowserOwnerChange() {
  state.bookingBrowserPendingOwnerId = elements.bookingBrowserOwner.value || "";
  renderBookingBrowserPanel();
}

function onBookingBrowserSizeToggleClick() {
  state.bookingBrowserWide = !state.bookingBrowserWide;
  renderBookingWorkspace(elements, state);
  renderBookingBrowserPanel();
}

function onBookingBrowserCollapseToggleClick() {
  state.bookingBrowserCollapsed = !state.bookingBrowserCollapsed;
  if (state.bookingBrowserCollapsed) {
    state.bookingBrowserStagesMenuOpen = false;
  }
  renderBookingWorkspace(elements, state);
  renderBookingBrowserPanel();
}

function onBookingBrowserStagesToggleClick(event) {
  event.preventDefault();
  event.stopPropagation();
  state.bookingBrowserStagesMenuOpen = !state.bookingBrowserStagesMenuOpen;
  renderBookingBrowserPanel();
}

function onBookingBrowserStagesChange(event) {
  var changedInput = event && event.target ? event.target : null;
  var stageInputs = Array.prototype.slice.call(
    elements.bookingBrowserStagesMenu.querySelectorAll("input[data-stage-filter]")
  );
  var toggleAllInput = elements.bookingBrowserStagesMenu.querySelector("input[data-stage-filter-toggle-all]");

  if (changedInput && changedInput.hasAttribute("data-stage-filter-toggle-all")) {
    stageInputs.forEach(function (input) {
      input.checked = changedInput.checked;
    });
  } else if (toggleAllInput) {
    toggleAllInput.checked = stageInputs.length > 0 && stageInputs.every(function (input) {
      return input.checked;
    });
  }

  state.bookingBrowserPendingStages = stageInputs.filter(function (input) {
    return input.checked;
  }).map(function (input) {
    return input.value;
  });
  renderBookingBrowserPanel();
}

function onBookingRailToggleClick() {
  state.bookingRailCollapsed = !state.bookingRailCollapsed;
  renderBookingWorkspace(elements, state);
}

async function onBookingBrowserLoadClick() {
  state.bookingBrowserOwnerId = String(state.bookingBrowserPendingOwnerId || "").trim();
  state.bookingBrowserStages = mergeUniqueTextValues(state.bookingBrowserPendingStages || []);
  state.bookingBrowserFiltersApplied = Boolean(state.bookingBrowserOwnerId && state.bookingBrowserStages.length);
  state.bookingBrowserStagesMenuOpen = false;
  renderBookingBrowserPanel();

  if (!state.bookingBrowserFiltersApplied) {
    return;
  }

  state.bookingBrowserLoading = true;
  renderBookingBrowserPanel();
  setButtonsDisabled(elements, state, true);

  try {
    const records = await loadBookingsForBrowserFilters(
      state.bookingBrowserOwnerId,
      state.bookingBrowserStages
    );
    const hydratedRecords = await hydrateBookingRecordsIfNeeded(records);
    const normalizedRecords = hydratedRecords.map(normalizeBookingCandidate);

    state.bookingBrowserRawDebugSamples = hydratedRecords
      .slice(0, 5)
      .map(summarizeRawBookingDebugRecord);
    state.bookings = normalizedRecords;
    indexBookings(state, normalizedRecords);
    syncBookingBrowserOwnerFilter(normalizedRecords);
    renderBookingBrowserPanel();

    setNotice(
      elements,
      normalizedRecords.length
        ? normalizedRecords.length + (normalizedRecords.length === 1 ? " booking loaded for the selected filters." : " bookings loaded for the selected filters.")
        : "No bookings found for the selected owner and stages."
    );
    state.initialized = true;
    renderBookingWorkspace(elements, state);
  } catch (error) {
    setError(elements, "Could not load bookings for the selected owner and stages.");
  } finally {
    state.bookingBrowserLoading = false;
    renderBookingBrowserPanel();
    renderBookingWorkspace(elements, state);
    clearLoading(elements, state);
  }
}

function onDocumentClick(event) {
  if (state.bookingBrowserStagesMenuOpen) {
    const withinStageFilter = event.target && event.target.closest ? event.target.closest(".booking-stage-filter") : null;

    if (!withinStageFilter) {
      state.bookingBrowserStagesMenuOpen = false;
      renderBookingBrowserPanel();
    }
  }

  if (!state.serviceFilterMenuOpen) {
    return;
  }

  const withinServiceFilter = event.target && event.target.closest ? event.target.closest(".service-multi-filter") : null;

  if (withinServiceFilter) {
    return;
  }

  state.serviceFilterMenuOpen = "";
  renderServicesWorkspace();
}

function onDocumentKeydown(event) {
  if (event.key === "Escape" && state.serviceColumnsPanelOpen) {
    onToggleServiceColumnsPanel();
  }
}

async function onActiveMailListClick(event) {
  const row = event.target && event.target.closest ? event.target.closest("[data-mail-record-id]") : null;

  if (!row) {
    return;
  }

  const tabName = row.getAttribute("data-mail-tab") || "drafts";
  const recordId = row.getAttribute("data-mail-record-id") || "";

  if (!recordId) {
    return;
  }

  state.selectedDraftRecordId = recordId;
  state.activeMailTab = tabName;
  state.mailViewerError = "";
  state.mailViewerErrorKey = "";
  state.draftEditorOpen = false;
  state.draftEditorFields = null;
  state.outlookConfirmOpen = false;
  closeDraftDeleteConfirmation();
  renderEmailsPanel(elements, state);

  await ensureSelectedMailContentLoaded(tabName, recordId);
}







async function onDeleteDraftClick() {
  if (state.activeMailTab !== "drafts" || !state.selectedBookingId || !state.selectedDraftRecordId || state.draftEditorSaving) {
    return;
  }
  state.draftDeleteConfirmOpen = true;
  elements.draftDeleteConfirmModal.hidden = false;
  renderEmailsPanel(elements, state);
}

function closeDraftDeleteConfirmation() {
  state.draftDeleteConfirmOpen = false;
  if (elements.draftDeleteConfirmModal) {
    elements.draftDeleteConfirmModal.hidden = true;
  }
  renderEmailsPanel(elements, state);
}

async function onConfirmDraftDelete() {
  if (!state.draftDeleteConfirmOpen || state.draftEditorSaving) {
    return;
  }
  closeDraftDeleteConfirmation();
  await deleteSelectedDraft("Communication deleted successfully.");
}







async function onRefreshBookingMailsClick() {
  if (!state.selectedBookingId || state.emailsLoading || state.draftEditorSaving) {
    return;
  }

  clearSelectedMailPreview();
  await ensureBookingEmailsLoaded(true);
  renderEmailsPanel(elements, state);
}



async function bootstrapBookings() {
  state.bookingBrowserLoading = true;
  renderBookingBrowserPanel();
  setButtonsDisabled(elements, state, true);

  try {
    let records = [];
    const bookingFieldNames = buildBookingListFieldNames(
      state.bookingModuleFieldApiNames,
      state.bookingStageFieldApiName
    );

    if (bookingFieldNames.length) {
      try {
        records = await withTimeout(
          crmGetAllRecords(MODULES.bookings, 1, 80, {
            fields: bookingFieldNames.join(",")
          }),
          ZOHO_SDK_TIMEOUT_MS,
          "ZOHO.CRM.API.getAllRecords timed out"
        );
      } catch (error) {}
    }

    if (!records.length) {
      records = await withTimeout(
        crmGetAllRecords(MODULES.bookings, 1, 80),
        ZOHO_SDK_TIMEOUT_MS,
        "ZOHO.CRM.API.getAllRecords timed out"
      );
    }

    state.bookingBrowserRawDebugSamples = records.slice(0, 5).map(summarizeRawBookingDebugRecord);
    records = await hydrateBookingRecordsIfNeeded(records);
    state.bookingBrowserRawDebugSamples = records.slice(0, 5).map(summarizeRawBookingDebugRecord);

    const normalizedRecords = records.map(normalizeBookingCandidate);

    state.bookings = normalizedRecords;
    indexBookings(state, normalizedRecords);
    syncBookingBrowserOwnerFilter(normalizedRecords);
    renderBookingBrowserPanel();

    if (!state.initialized) {
      setNotice(elements, "Bookings loaded. Choose one from the search box to open the reservation workspace.");
    } else {
      setNotice(elements, "Booking list refreshed.");
    }

    state.initialized = true;
    renderBookingWorkspace(elements, state);
  } catch (error) {
    setError(elements, "Could not load bookings from Zoho CRM.");
  } finally {
    state.bookingBrowserLoading = false;
    renderBookingBrowserPanel();
    renderBookingWorkspace(elements, state);
    clearLoading(elements, state);
  }
}

async function bootstrapBookingBrowserQueue() {
  if (!state.bookingBrowserPendingOwnerId) {
    state.bookingBrowserPendingOwnerId = resolveCurrentUserOwnerValueFromOptions(state.bookingBrowserOwnerOptions);
  }

  if (!state.bookingBrowserPendingStages.length && state.bookingBrowserStageOptions.length) {
    state.bookingBrowserPendingStages = state.bookingBrowserStageOptions.slice();
  }

  if (state.bookingBrowserPendingOwnerId && state.bookingBrowserPendingStages.length) {
    await onBookingBrowserLoadClick();
    return;
  }

  await bootstrapBookings();
}

async function loadBookingsForBrowserFilters(ownerId, stages) {
  const normalizedOwnerId = String(ownerId || "").trim();
  const normalizedStages = mergeUniqueTextValues(stages || []);

  if (!normalizedOwnerId || !normalizedStages.length) {
    return [];
  }

  const ownerFieldApiName = resolveBookingOwnerCriteriaField(state.bookingModuleFieldApiNames);
  const stageFieldApiName = resolveBookingStageCriteriaField(
    state.bookingModuleFieldApiNames,
    state.bookingStageFieldApiName
  );
  const escapedOwnerId = escapeCriteriaValue(normalizedOwnerId);
  const combinedResults = [];

  for (var stageIndex = 0; stageIndex < normalizedStages.length; stageIndex += 1) {
    var escapedStageValue = escapeCriteriaValue(normalizedStages[stageIndex]);

    for (var page = 1; page <= 10; page += 1) {
      var criteria = buildBookingBrowserSearchCriteria(
        ownerFieldApiName,
        escapedOwnerId,
        stageFieldApiName,
        escapedStageValue
      );
      var pageRecords = await withTimeout(
        crmSearchRecord(MODULES.bookings, criteria, page, 200),
        ZOHO_SDK_TIMEOUT_MS,
        "Booking search timed out"
      );

      if (!pageRecords.length) {
        break;
      }

      combinedResults.push.apply(combinedResults, pageRecords);

      if (pageRecords.length < 200) {
        break;
      }
    }
  }

  return dedupeBookings(combinedResults);
}

async function hydrateBookingStageOptions() {
  try {
    const fields = await withTimeout(
      crmGetFields(MODULES.bookings),
      ZOHO_SDK_TIMEOUT_MS,
      "ZOHO.CRM.META/API.getFields timed out"
    );
    const stageMetadata = extractBookingStageMetadata(fields);
    const stageOptions = getManualEzusStageOptions();

    state.bookingModuleFieldApiNames = stageMetadata.availableFieldApiNames;
    state.bookingStageFieldApiName = stageMetadata.fieldApiName;
    state.bookingStageDebug = Object.assign({}, stageMetadata.debug, {
      manualStageOptions: MANUAL_BOOKING_STAGE_OPTIONS.slice(),
      resolvedOptions: stageOptions.slice(),
      ignoredDetectedOptions: (stageMetadata.options || []).slice()
    });

    if (!stageOptions.length) {
      renderBookingBrowserPanel();
      return;
    }

    state.bookingBrowserStageOptions = stageOptions;
    state.bookingBrowserStages = state.bookingBrowserStages.filter(function (stage) {
      return stageOptions.indexOf(stage) !== -1;
    });
    state.bookingBrowserPendingStages = state.bookingBrowserPendingStages.filter(function (stage) {
      return stageOptions.indexOf(stage) !== -1;
    });
    if (!state.bookingBrowserPendingStages.length) {
      state.bookingBrowserPendingStages = stageOptions.slice();
    }
    renderBookingBrowserPanel();
  } catch (error) {
    state.bookingStageDebug = {
      error: error && error.message ? error.message : String(error),
      manualStageOptions: MANUAL_BOOKING_STAGE_OPTIONS.slice(),
      resolvedOptions: getManualEzusStageOptions()
    };
    state.bookingBrowserStageOptions = getManualEzusStageOptions();
    state.bookingBrowserStages = state.bookingBrowserStages.filter(function (stage) {
      return state.bookingBrowserStageOptions.indexOf(stage) !== -1;
    });
    state.bookingBrowserPendingStages = state.bookingBrowserPendingStages.filter(function (stage) {
      return state.bookingBrowserStageOptions.indexOf(stage) !== -1;
    });
    if (!state.bookingBrowserPendingStages.length) {
      state.bookingBrowserPendingStages = state.bookingBrowserStageOptions.slice();
    }
    renderBookingBrowserPanel();
  }
}

async function hydrateBookingRecordsIfNeeded(records) {
  if (!Array.isArray(records) || !records.length) {
    return [];
  }

  const normalizedPreview = records.map(normalizeBookingCandidate);
  const hasOwnerValues = normalizedPreview.some(function (booking) {
    const owner = getBookingOwnerInfo(booking);
    return Boolean(owner && owner.value);
  });
  const hasStageValues = normalizedPreview.some(function (booking) {
    return Boolean(String(booking.Stage || "").trim());
  });
  if (hasOwnerValues && hasStageValues) {
    return records;
  }

  const detailedRecords = await Promise.all(records.map(async function (record) {
    if (!record || !record.id) {
      return record;
    }

    try {
      return await crmGetRecord(MODULES.bookings, record.id);
    } catch (error) {
      return record;
    }
  }));

  return detailedRecords.filter(Boolean);
}

function syncBookingBrowserOwnerFilter(bookings) {
  const availableOwners = {};

  (state.bookingBrowserOwnerOptions || []).forEach(function (ownerOption) {
    if (ownerOption && ownerOption.value) {
      availableOwners[ownerOption.value] = true;
    }
  });

  bookings.forEach(function (booking) {
    const owner = getBookingOwnerInfo(booking);

    if (!owner || !owner.value) {
      return;
    }

    availableOwners[owner.value] = true;
  });

  if (state.bookingBrowserOwnerId && !availableOwners[state.bookingBrowserOwnerId]) {
    state.bookingBrowserOwnerId = "";
    state.bookingBrowserFiltersApplied = false;
  }

  if (state.bookingBrowserPendingOwnerId && availableOwners[state.bookingBrowserPendingOwnerId]) {
    return;
  }

  state.bookingBrowserPendingOwnerId = resolveCurrentUserOwnerValueFromOptions(state.bookingBrowserOwnerOptions)
    || resolveCurrentUserOwnerValue(bookings);
}

function resolveCurrentUserOwnerValueFromOptions(ownerOptions) {
  const currentUserId = String(state.currentUserId || "");
  const currentUserName = normalizeComparableText(state.currentUserName || "");
  const currentUserEmail = normalizeComparableText(state.currentUserEmail || "");

  if (!currentUserId && !currentUserName && !currentUserEmail) {
    return "";
  }

  for (var index = 0; index < (ownerOptions || []).length; index += 1) {
    var ownerOption = ownerOptions[index];

    if (!ownerOption || !ownerOption.value) {
      continue;
    }

    if (currentUserId && String(ownerOption.value) === currentUserId) {
      return ownerOption.value;
    }

    if (currentUserName && normalizeComparableText(ownerOption.label || "") === currentUserName) {
      return ownerOption.value;
    }

    if (currentUserEmail && normalizeComparableText(ownerOption.email || "") === currentUserEmail) {
      return ownerOption.value;
    }
  }

  return "";
}

function resolveCurrentUserOwnerValue(bookings) {
  const currentUserId = String(state.currentUserId || "");
  const currentUserName = normalizeComparableText(state.currentUserName || "");
  const currentUserEmail = normalizeComparableText(state.currentUserEmail || "");

  if (!currentUserId && !currentUserName && !currentUserEmail) {
    return "";
  }

  for (var index = 0; index < bookings.length; index += 1) {
    var owner = getBookingOwnerInfo(bookings[index]);

    if (!owner || !owner.value) {
      continue;
    }

    if (currentUserId && (owner.value === currentUserId || owner.id === currentUserId)) {
      return owner.value;
    }

    if (currentUserName && normalizeComparableText(owner.label || owner.name || "") === currentUserName) {
      return owner.value;
    }

    if (currentUserEmail && normalizeComparableText(owner.email || owner.label || "") === currentUserEmail) {
      return owner.value;
    }
  }

  return "";
}

async function hydrateCurrentUser() {
  const readers = [
    {
      label: "ZOHO.CRM.CONFIG.getCurrentUser().then(...)",
      read: function () {
        if (!ZOHO || !ZOHO.CRM || !ZOHO.CRM.CONFIG || typeof ZOHO.CRM.CONFIG.getCurrentUser !== "function") {
          return null;
        }

        return new Promise(function (resolve, reject) {
          try {
            var request = ZOHO.CRM.CONFIG.getCurrentUser();

            if (request && typeof request.then === "function") {
              request.then(function (data) {
                if (typeof console !== "undefined" && typeof console.log === "function") {
                  console.log("[Reservations Manager] ZOHO.CRM.CONFIG.getCurrentUser().then(...)", data);
                }

                resolve(data);
              }).catch(reject);
              return;
            }

            resolve(request);
          } catch (error) {
            reject(error);
          }
        });
      }
    },
    {
      label: "$Crm.user",
      read: function () {
        return window.$Crm && window.$Crm.user ? window.$Crm.user : null;
      }
    },
    {
      label: "ZOHO.CRM.CONFIG.getCurrentUser",
      read: function () {
        return ZOHO.CRM && ZOHO.CRM.CONFIG && typeof ZOHO.CRM.CONFIG.getCurrentUser === "function"
          ? ZOHO.CRM.CONFIG.getCurrentUser()
          : null;
      }
    },
    {
      label: "ZOHO.CRM.API.getCurrentUser",
      read: function () {
        return ZOHO.CRM && ZOHO.CRM.API && typeof ZOHO.CRM.API.getCurrentUser === "function"
          ? ZOHO.CRM.API.getCurrentUser()
          : null;
      }
    }
  ];
  state.currentUserDebugReaders = [];
  state.currentUserDebugSource = "";

  for (var index = 0; index < readers.length; index += 1) {
    try {
      var response = await withTimeout(
        Promise.resolve(readers[index].read()),
        ZOHO_SDK_TIMEOUT_MS,
        readers[index].label + " timed out"
      );
      var currentUser = extractCurrentUserInfo(response);

      state.currentUserDebugReaders.push({
        source: readers[index].label,
        hasResponse: Boolean(response),
        extractedUser: currentUser
      });

      if (!currentUser) {
        continue;
      }

      state.currentUserId = currentUser.id;
      state.currentUserName = currentUser.name;
      state.currentUserEmail = currentUser.email;
      state.currentUserDebugSource = readers[index].label;
      return;
    } catch (error) {
      state.currentUserDebugReaders.push({
        source: readers[index].label,
        error: error && error.message ? error.message : String(error)
      });
    }
  }
}

async function hydrateBookingBrowserOwners() {
  try {
    const relationshipRecords = await loadAllUserRelationshipRecords(
      [
        "Record_Status__s",
        "User_Alias",
        "User_ID",
        "Email",
        "Profile",
        "Role",
        "Sales_Rep",
        "Reservations_Rep",
        "Accounting_Rep",
        "Guest_Relations_Rep",
        "Hour_Rep"
      ].join(",")
    );
    let activeUsers = [];

    try {
      activeUsers = await loadAllActiveZohoUsers();
    } catch (activeUsersError) {}

    const ownerOptions = buildOwnerOptionsFromUserRelationships(relationshipRecords, activeUsers);

    if (typeof console !== "undefined" && typeof console.info === "function") {
      console.info("[Reservations Manager] owner load", {
        relationshipRecords: relationshipRecords.length,
        activeZohoUsers: activeUsers.length,
        ownerOptions: ownerOptions.length
      });
    }

    state.bookingBrowserOwnerOptions = ownerOptions;
    state.currentUserRelationshipUserId = resolveCurrentUserRelationshipUserId(relationshipRecords);
    state.currentUserIsAdministrator = isCurrentUserAdministrator(relationshipRecords);
    if (!state.bookingBrowserPendingOwnerId) {
      state.bookingBrowserPendingOwnerId = resolveCurrentUserOwnerValueFromOptions(ownerOptions);
    }
    state.bookingBrowserOwnerDebug = {
      source: "User_Relationships",
      countRecords: relationshipRecords.length,
      count: ownerOptions.length,
      sample: ownerOptions.slice(0, 12),
      rawSample: relationshipRecords.slice(0, 5).map(function (record) {
        return {
          id: record.id || "",
          User_Alias: record.User_Alias || "",
          User_ID: record.User_ID || "",
          Email: record.Email || "",
          Profile: getUserRelationshipProfile(record),
          Role: record.Role || "",
          Sales_Rep: summarizeRawDebugValue(record.Sales_Rep),
          Reservations_Rep: summarizeRawDebugValue(record.Reservations_Rep),
          Accounting_Rep: summarizeRawDebugValue(record.Accounting_Rep),
          Guest_Relations_Rep: summarizeRawDebugValue(record.Guest_Relations_Rep),
          Hour_Rep: summarizeRawDebugValue(record.Hour_Rep)
        };
      })
    };
    renderBookingBrowserPanel();
    renderBookingWorkspace(elements, state);
  } catch (error) {
    state.currentUserIsAdministrator = false;
    state.bookingBrowserOwnerDebug = {
      source: "User_Relationships",
      error: error && error.message ? error.message : String(error)
    };
    renderBookingBrowserPanel();
    renderBookingWorkspace(elements, state);
  }
}

async function onSendDraftClick() {
  if (
    state.activeMailTab !== "drafts" ||
    !state.selectedBookingId ||
    !state.selectedDraftRecordId ||
    state.draftEditorSaving ||
    state.draftEditorOpen
  ) {
    return;
  }

  const draftId = state.selectedDraftRecordId;
  const cacheKey = getMailCacheKey("drafts", draftId);
  const selectedCommunication = findMailRecordById(state.emailDrafts, "drafts", draftId);
  const communicationId = String(selectedCommunication && selectedCommunication.communication_id || "").trim();
  if (String(selectedCommunication && selectedCommunication.communication_status || "Draft").toLowerCase() === "sent") {
    return;
  }
  const fromEmail = String(selectedCommunication && (selectedCommunication.from || selectedCommunication.Sender_Email) || "").trim();

  if (!communicationId) {
    setError(elements, "The selected email is not linked to a Communication.");
    return;
  }

  if (!fromEmail) {
    setError(elements, "The selected Communication does not have a Sender Email.");
    return;
  }

  state.draftEditorSaving = true;
  state.draftSending = true;
  showSendModal("Sending email…", false);
  setError(elements, "");
  setNotice(elements, "Sending email...", { loading: true });
  renderEmailsPanel(elements, state);

  try {
    // The draft only stores rendered HTML. Communication remains the source
    // of truth for To, CC and the sender selected by the user.
    const response = await crmExecuteFunction("comm_sendcommunicationdraft", {
      communicationId: communicationId,
      draftId: draftId,
      fromEmail: fromEmail,
      actingUserEmail: fromEmail
    });
    const payload = extractFunctionPayload(response);
    const errorDetails = getFunctionPayloadErrorDetails(payload);

    if (errorDetails) {
      throw buildFunctionPayloadError(errorDetails);
    }

    // Communication drafts are retained. Reload so the viewer keeps showing
    // the latest stored draft instead of treating a sent email as deleted.
    delete state.mailContentByKey[cacheKey];
    await ensureBookingEmailsLoaded(true);
    state.selectedDraftRecordId = "";
    state.draftEditorOpen = false;
    state.draftEditorFields = null;
    state.draftEditorMode = "visual";
    state.outlookConfirmOpen = false;
    state.draftDeleteConfirmOpen = false;
    elements.draftDeleteConfirmModal.hidden = true;
    await loadBookingWorkspace(state.selectedBookingId, { preserveNotice: true });
    showSendModal("Email sent successfully.", false);
    setTimeout(closeSendModal, 900);
  } catch (error) {
    setNotice(elements, "");
    setError(elements, error.message || "Could not send the selected draft.");
    showSendModal(error.message || "Could not send the selected draft.", true);
  } finally {
    state.draftSending = false;
    state.draftEditorSaving = false;
    renderEmailsPanel(elements, state);
  }
}

function showSendModal(message, isError) {
  elements.mailSendModal.hidden = false;
  elements.mailSendSpinner.hidden = Boolean(isError);
  elements.mailSendModalMessage.textContent = message;
  elements.mailSendModalMessage.classList.toggle("is-error", Boolean(isError));
  elements.mailSendModalClose.hidden = !isError;
}

function closeSendModal() {
  elements.mailSendModal.hidden = true;
}

function closeCreateDraftModal() {
  elements.createDraftModal.hidden = true;
}

function getSelectedCommunicationRecord() {
  const id = state.selectedDraftRecordId;
  return state.mailContentByKey[getMailCacheKey("drafts", id)] || findMailRecordById(state.emailDrafts, "drafts", id);
}

function getCommunicationEditorFields(record) {
  record = record || {};
  return {
    email_from: getMailField(record, ["from", "From", "sender_email", "Sender_Email"]),
    email_to: getMailField(record, ["to", "To", "Recipient_To"]),
    email_cc: getMailField(record, ["cc", "CC", "Recipient_CC"]),
    email_subject: getMailField(record, ["subject", "Subject", "Rendered_Subject", "name", "Name"]),
    email_content: getMailField(record, ["content", "Content", "body", "Body", "html", "HTML"])
  };
}

function openInlineCommunicationEditor(field) {
  const record = getSelectedCommunicationRecord();
  if (!record || state.draftEditorSaving) return;
  state.communicationInlineEdit = field;
  if (field === "to" || field === "cc") {
    state.communicationInlineEmails[field] = splitCommunicationEmails(getCommunicationEditorFields(record)["email_" + field]);
  }
  renderEmailsPanel(elements, state);
}

function closeInlineCommunicationEditor() {
  state.communicationInlineEdit = "";
  renderEmailsPanel(elements, state);
}

function splitCommunicationEmails(value) {
  return String(value || "").split(/[;,]/).map(function (email) { return email.trim(); }).filter(Boolean);
}

function onInlineEmailKeydown(event) {
  if (event.key === "Enter") { event.preventDefault(); addInlineEmail(event.currentTarget); }
}

function onInlineEmailBlur(event) { addInlineEmail(event.currentTarget); }

function addInlineEmail(input) {
  const field = input === elements.mailInlineToInput ? "to" : "cc";
  const email = String(input.value || "").trim();
  if (!email) return;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setError(elements, "Enter a valid email address before adding it.");
    input.focus();
    return;
  }
  if (state.communicationInlineEmails[field].indexOf(email) === -1) state.communicationInlineEmails[field].push(email);
  input.value = "";
  setError(elements, "");
  renderEmailsPanel(elements, state);
}

function onInlineEmailChipClick(event) {
  const button = event.target.closest("[data-remove-email]");
  if (!button) return;
  const field = button.dataset.emailField;
  state.communicationInlineEmails[field] = state.communicationInlineEmails[field].filter(function (email) { return email !== button.dataset.removeEmail; });
  renderEmailsPanel(elements, state);
}

async function saveInlineCommunicationEditor() {
  const record = getSelectedCommunicationRecord();
  const field = state.communicationInlineEdit;
  if (!record || !record.communication_id || !field) return;
  const fields = getCommunicationEditorFields(record);
  if (field === "from") fields.email_from = elements.mailInlineFromSelect.value;
  else fields["email_" + field] = state.communicationInlineEmails[field].join(", ");
  state.draftEditorSaving = true;
  try {
    const response = await crmExecuteFunction("comm_updatecommunicationdraft", {
      communicationId: record.communication_id, draftId: record.draft_id || record.id,
      email_to: fields.email_to, email_from: fields.email_from, email_cc: fields.email_cc,
      email_subject: fields.email_subject, email_content: fields.email_content
    });
    const payload = extractFunctionPayload(response);
    const error = getFunctionPayloadErrorDetails(payload);
    if (error) throw buildFunctionPayloadError(error);
    const value = field === "from" ? fields.email_from : fields["email_" + field];
    record[field] = value;
    const listRecord = findMailRecordById(state.emailDrafts, "drafts", state.selectedDraftRecordId);
    if (listRecord) listRecord[field] = value;
    const cacheKey = getMailCacheKey("drafts", state.selectedDraftRecordId);
    if (state.mailContentByKey[cacheKey]) state.mailContentByKey[cacheKey][field] = value;
    state.communicationInlineEdit = "";
    const valueElement = field === "from" ? elements.mailViewerFrom : field === "to" ? elements.mailViewerTo : elements.mailViewerCc;
    const editorElement = field === "from" ? elements.mailInlineFrom : field === "to" ? elements.mailInlineTo : elements.mailInlineCc;
    const buttonElement = field === "from" ? elements.mailEditFromButton : field === "to" ? elements.mailEditToButton : elements.mailEditCcButton;
    valueElement.textContent = value || "-";
    valueElement.hidden = false;
    editorElement.hidden = true;
    buttonElement.hidden = false;
    setNotice(elements, "Communication updated successfully.");
  } catch (error) { setError(elements, error.message || "Could not update the communication."); }
  finally { state.draftEditorSaving = false; }
}

function openCommunicationContentEditor() {
  const record = getSelectedCommunicationRecord();
  if (!record || state.draftEditorSaving) return;
  elements.mailContentEditVisual.innerHTML = getCommunicationEditorFields(record).email_content || "<p></p>";
  state.communicationContentEditorOpen = true;
  elements.mailContentEditModal.hidden = false;
  elements.mailContentEditVisual.focus();
}

function closeCommunicationContentEditor() {
  if (state.draftEditorSaving) return;
  state.communicationContentEditorOpen = false;
  elements.mailContentEditModal.hidden = true;
}

async function saveCommunicationContentEditor() {
  const record = getSelectedCommunicationRecord();
  if (!record || !record.communication_id || state.draftEditorSaving) return;
  const fields = getCommunicationEditorFields(record);
  fields.email_content = elements.mailContentEditVisual.innerHTML;
  state.draftEditorSaving = true;
  elements.mailContentEditSave.disabled = true;
  try {
    const response = await crmExecuteFunction("comm_updatecommunicationdraft", {
      communicationId: record.communication_id, draftId: record.draft_id || record.id,
      email_to: fields.email_to, email_from: fields.email_from, email_cc: fields.email_cc,
      email_subject: fields.email_subject, email_content: fields.email_content
    });
    const payload = extractFunctionPayload(response);
    const error = getFunctionPayloadErrorDetails(payload);
    if (error) throw buildFunctionPayloadError(error);
    record.content = fields.email_content;
    const listRecord = findMailRecordById(state.emailDrafts, "drafts", state.selectedDraftRecordId);
    if (listRecord) listRecord.content = fields.email_content;
    const cacheKey = getMailCacheKey("drafts", state.selectedDraftRecordId);
    if (state.mailContentByKey[cacheKey]) state.mailContentByKey[cacheKey].content = fields.email_content;
    state.communicationContentEditorOpen = false;
    elements.mailContentEditModal.hidden = true;
    elements.mailViewerBody.innerHTML = fields.email_content;
    setNotice(elements, "Email content updated successfully.");
  } catch (error) {
    setError(elements, error.message || "Could not update the email content.");
  } finally {
    state.draftEditorSaving = false;
    elements.mailContentEditSave.disabled = false;
  }
}

function onEditCommunicationClick() {
  if (!state.selectedDraftRecordId || state.draftEditorSaving) return;
  state.draftEditorFields = getCommunicationEditorFields(getSelectedCommunicationRecord());
  state.draftEditorMode = "visual";
  state.draftEditorServiceIds = (recordServices(getSelectedCommunicationRecord())).map(function (service) { return String(service.id); });
  state.draftEditorOpen = true;
  renderEmailsPanel(elements, state);
}

function onCancelCommunicationEdit() {
  if (state.draftEditorSaving) return;
  state.draftEditorOpen = false;
  state.draftEditorFields = null;
  state.communicationInlineEdit = "";
  state.draftEditorServiceIds = [];
  renderEmailsPanel(elements, state);
}

function recordServices(record) {
  return Array.isArray(record && record.services) ? record.services : [];
}

function onCommunicationServiceAdd() {
  const serviceId = String(elements.mailEditServiceSearch.value || "").split(" | ")[0].trim();
  if ((state.services || []).some(function (service) { return String(service.id) === serviceId; }) && state.draftEditorServiceIds.indexOf(serviceId) === -1) {
    state.draftEditorServiceIds.push(serviceId);
  }
  elements.mailEditServiceSearch.value = "";
  renderEmailsPanel(elements, state);
}

function onCommunicationServiceRemove(event) {
  const button = event.target.closest("[data-remove-communication-service]");
  if (!button) return;
  state.draftEditorServiceIds = state.draftEditorServiceIds.filter(function (id) { return id !== button.dataset.removeCommunicationService; });
  renderEmailsPanel(elements, state);
}

function syncCommunicationEditorFields() {
  if (!state.draftEditorOpen) return;
  state.draftEditorFields = Object.assign({}, state.draftEditorFields || {}, {
    email_from: elements.mailEditFrom.value,
    email_to: elements.mailEditTo.value,
    email_cc: elements.mailEditCc.value,
    email_subject: elements.mailEditSubject.value,
    email_content: state.draftEditorMode === "visual" ? elements.mailEditVisual.innerHTML : elements.mailEditContent.value
  });
}

function setCommunicationEditorMode(mode) {
  syncCommunicationEditorFields();
  state.draftEditorMode = mode;
  renderEmailsPanel(elements, state);
}

async function onSaveCommunicationEdit(event) {
  event.preventDefault();
  const record = getSelectedCommunicationRecord();
  if (!record || !record.communication_id || state.draftEditorSaving) return;
  syncCommunicationEditorFields();
  const fields = state.draftEditorFields || {};
  state.draftEditorSaving = true;
  setError(elements, "");
  try {
    const response = await crmExecuteFunction("comm_updatecommunicationdraft", {
      communicationId: record.communication_id,
      draftId: record.draft_id || record.id,
      email_to: String(fields.email_to || "").trim(),
      email_from: String(fields.email_from || "").trim(),
      email_cc: String(fields.email_cc || "").trim(),
      email_subject: String(fields.email_subject || "").trim(),
      email_content: fields.email_content || ""
    });
    const payload = extractFunctionPayload(response);
    const error = getFunctionPayloadErrorDetails(payload);
    if (error) throw buildFunctionPayloadError(error);
    const servicesResponse = await crmExecuteFunction("comm_updatecommunicationservices", {
      communicationId: record.communication_id,
      serviceIds: state.draftEditorServiceIds.join("|||")
    });
    const servicesPayload = extractFunctionPayload(servicesResponse);
    const servicesError = getFunctionPayloadErrorDetails(servicesPayload);
    if (servicesError) throw buildFunctionPayloadError(servicesError);
    state.draftEditorOpen = false;
    state.draftEditorFields = null;
    state.draftEditorServiceIds = [];
    await ensureBookingEmailsLoaded(true);
    setNotice(elements, "Communication updated successfully.");
  } catch (error) {
    setError(elements, error.message || "Could not update the communication.");
  } finally {
    state.draftEditorSaving = false;
    renderEmailsPanel(elements, state);
  }
}

function resolveCurrentUserRelationshipUserId(records) {
  const currentUserId = String(state.currentUserId || "").trim();
  const currentUserEmail = normalizeComparableText(state.currentUserEmail || "");
  const currentUserName = normalizeComparableText(state.currentUserName || "");
  const match = (records || []).find(function (record) {
    const relationshipUser = extractUserRelationshipUser(record);
    const relationshipUserId = String(relationshipUser && relationshipUser.value || record && record.User_ID || "").trim();
    const relationshipEmail = normalizeComparableText(record && record.Email || "");
    const relationshipAlias = normalizeComparableText(record && record.User_Alias || "");

    return Boolean(
      (currentUserId && relationshipUserId === currentUserId) ||
      (currentUserEmail && relationshipEmail === currentUserEmail) ||
      (currentUserName && relationshipAlias === currentUserName)
    );
  });

  const matchedUser = extractUserRelationshipUser(match);
  return String(matchedUser && matchedUser.value || match && match.User_ID || currentUserId || "").trim();
}

function isCurrentUserAdministrator(records) {
  const currentUserId = String(state.currentUserId || "").trim();
  const currentUserEmail = normalizeComparableText(state.currentUserEmail || "");
  const currentUserName = normalizeComparableText(state.currentUserName || "");

  return (records || []).some(function (record) {
    if (normalizeComparableText(getUserRelationshipProfile(record)) !== "administrator") {
      return false;
    }

    const relationshipUserId = String(record && record.User_ID || "").trim();
    const relationshipEmail = normalizeComparableText(record && record.Email || "");
    const relationshipAlias = normalizeComparableText(record && record.User_Alias || "");

    return Boolean(
      (currentUserId && relationshipUserId === currentUserId) ||
      (currentUserEmail && relationshipEmail === currentUserEmail) ||
      (currentUserName && relationshipAlias === currentUserName)
    );
  });
}

function getUserRelationshipProfile(record) {
  const profile = record && (record.Profile || record.User_Profile || record.UserProfile);

  if (profile && typeof profile === "object") {
    return String(profile.name || profile.display_value || profile.label || profile.value || "").trim();
  }

  return String(profile || "").trim();
}

async function loadAllUserRelationshipRecords(fields) {
  const aggregated = [];
  const perPage = 100;

  for (var page = 1; page <= 10; page += 1) {
    var pageRecords = await withTimeout(
      crmGetAllRecords(MODULES.userRelationships, page, perPage, {
        fields: fields
      }),
      ZOHO_SDK_TIMEOUT_MS,
      "User_Relationships load timed out"
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

async function loadAllActiveZohoUsers() {
  const aggregated = [];
  const perPage = 100;

  for (var page = 1; page <= 10; page += 1) {
    var pageUsers = await withTimeout(
      crmGetAllUsers("ActiveUsers", page, perPage),
      ZOHO_SDK_TIMEOUT_MS,
      "Active users load timed out"
    );

    if (!pageUsers.length) {
      break;
    }

    aggregated.push.apply(aggregated, pageUsers);

    if (pageUsers.length < perPage) {
      break;
    }
  }

  return aggregated;
}

function buildOwnerOptionsFromUserRelationships(records, activeUsers) {
  const usersById = {};
  const activeUserIndex = buildActiveUserIndex(activeUsers);

  (records || []).forEach(function (record) {
    const userData = extractUserRelationshipUser(record);

    if (!userData || !isIncludedUserRelationshipOwner(record, userData, activeUserIndex) || usersById[userData.value]) {
      return;
    }

    usersById[userData.value] = userData;
  });

  return Object.keys(usersById).map(function (userId) {
    return usersById[userId];
  }).sort(function (left, right) {
    return left.label.localeCompare(right.label);
  });
}

function extractUserRelationshipUser(record) {
  if (!record || typeof record !== "object") {
    return null;
  }

  const role = String(record.Role || "").trim();
  const candidatesByRole = {
    "Sales Rep": record.Sales_Rep,
    "Reservations Rep": record.Reservations_Rep,
    "Accounting Rep": record.Accounting_Rep,
    "Guest Relations Rep": record.Guest_Relations_Rep,
    "24 HR Rep": record.Hour_Rep
  };
  const prioritizedCandidates = [
    candidatesByRole[role],
    record.Reservations_Rep,
    record.Sales_Rep,
    record.Accounting_Rep,
    record.Guest_Relations_Rep,
    record.Hour_Rep
  ];
  let userLookup = null;

  for (var index = 0; index < prioritizedCandidates.length; index += 1) {
    if (prioritizedCandidates[index]) {
      userLookup = prioritizedCandidates[index];
      break;
    }
  }

  const userId = String(
    record.User_ID ||
    getUserLookupValue(userLookup, ["id", "user_id", "zuid"]) ||
    ""
  ).trim();
  const userEmail = String(
    record.Email ||
    getUserLookupValue(userLookup, ["email", "user_email"]) ||
    ""
  ).trim();
  const userLabel = String(
    record.User_Alias ||
    getUserLookupValue(userLookup, ["name", "full_name", "display_value", "actual_value", "label"]) ||
    userEmail ||
    userId
  ).trim();

  if (!userId || !userLabel) {
    return null;
  }

  return {
    value: userId,
    label: userLabel,
    email: userEmail,
    alias: String(record.User_Alias || "").trim(),
    role: role
  };
}

function buildActiveUserIndex(activeUsers) {
  const index = {
    ids: {},
    emails: {}
  };

  (activeUsers || []).forEach(function (user) {
    var userId = String(user && (user.id || user.zuid || user.user_id) || "").trim();
    var userEmail = normalizeComparableText(user && (user.email || user.user_email || ""));

    if (userId) {
      index.ids[userId] = true;
    }

    if (userEmail) {
      index.emails[userEmail] = true;
    }
  });

  return index;
}

function isIncludedUserRelationshipOwner(record, userData, activeUserIndex) {
  const normalizedStatus = normalizeComparableText(
    record && (record.Record_Status__s || record.Record_Status || record.Status)
  );
  const normalizedRole = normalizeComparableText(record && record.Role);
  const hasActiveUserIndex = Boolean(
    activeUserIndex &&
    (Object.keys(activeUserIndex.ids).length || Object.keys(activeUserIndex.emails).length)
  );
  const matchesActiveZohoUser = Boolean(
    userData && (
      activeUserIndex.ids[userData.value] ||
      (userData.email && activeUserIndex.emails[normalizeComparableText(userData.email)])
    )
  );
  const hasAllowedRole = Boolean(
    normalizedRole &&
    normalizedRole !== "n/a" &&
    normalizedRole !== "-none-"
  );

  if (!hasAllowedRole) {
    return false;
  }

  if (hasActiveUserIndex) {
    return matchesActiveZohoUser;
  }

  return normalizedStatus === "available" || normalizedStatus === "active";
}

function getManualEzusStageOptions() {
  return MANUAL_BOOKING_STAGE_OPTIONS.filter(function (stage) {
    return isEzusStageLabel(stage);
  });
}

function buildBookingBrowserSearchCriteria(ownerFieldApiName, ownerId, stageFieldApiName, stageValue) {
  return "((" + ownerFieldApiName + ":equals:" + ownerId + ")and(" + stageFieldApiName + ":equals:" + stageValue + "))";
}

function resolveBookingOwnerCriteriaField(availableFieldApiNames) {
  return resolveBookingCriteriaField(
    [
      "Owner",
      "Booking_Owner",
      "BookingOwner",
      "Record_Owner",
      "Assigned_To",
      "Owner_Id",
      "SMOWNERID"
    ],
    availableFieldApiNames
  );
}

function resolveBookingStageCriteriaField(availableFieldApiNames, stageFieldApiName) {
  return resolveBookingCriteriaField(
    mergeUniqueTextValues(
      [stageFieldApiName],
      ["Stage", "Booking_Stage", "BookingStage", "Deal_Stage", "Pipeline_Stage"]
    ),
    availableFieldApiNames
  );
}

function resolveBookingCriteriaField(preferredFieldNames, availableFieldApiNames) {
  var availableFieldSet = {};
  var candidates = mergeUniqueTextValues(preferredFieldNames || []);

  (availableFieldApiNames || []).forEach(function (fieldName) {
    availableFieldSet[String(fieldName || "").trim()] = true;
  });

  for (var index = 0; index < candidates.length; index += 1) {
    var candidate = candidates[index];

    if (!candidate) {
      continue;
    }

    if (!Object.keys(availableFieldSet).length || availableFieldSet[candidate]) {
      return candidate;
    }
  }

  return candidates[0] || "";
}

function isEzusStageLabel(stage) {
  var normalizedStage = String(stage || "").trim();

  if (!normalizedStage) {
    return false;
  }

  return !/^[A-Z]{1,4}\s*-\s+/.test(normalizedStage);
}

function getUserLookupValue(lookup, keys) {
  if (!lookup || typeof lookup !== "object") {
    return "";
  }

  for (var index = 0; index < keys.length; index += 1) {
    var value = lookup[keys[index]];

    if (value !== null && value !== undefined && value !== "") {
      return value;
    }
  }

  return "";
}

async function hydrateOrgInfoDebug() {
  if (!window.ZOHO || !ZOHO.CRM || !ZOHO.CRM.CONFIG || typeof ZOHO.CRM.CONFIG.getOrgInfo !== "function") {
    state.orgInfoDebug = {
      status: "not-available"
    };
    renderBookingBrowserPanel();
    return;
  }

  try {
    const orgInfo = await withTimeout(
      Promise.resolve(ZOHO.CRM.CONFIG.getOrgInfo()),
      ZOHO_SDK_TIMEOUT_MS,
      "ZOHO.CRM.CONFIG.getOrgInfo timed out"
    );

    state.orgInfoDebug = {
      status: "ok",
      response: orgInfo
    };
    renderBookingBrowserPanel();
  } catch (error) {
    state.orgInfoDebug = {
      status: "error",
      message: error && error.message ? error.message : String(error)
    };
    renderBookingBrowserPanel();
  }
}

function registerZohoEmbeddedAppListeners() {
  if (!window.ZOHO || !ZOHO.embeddedApp || typeof ZOHO.embeddedApp.on !== "function") {
    state.pageLoadDebug = {
      status: "listener-api-unavailable"
    };
    return;
  }

  try {
    ZOHO.embeddedApp.on("PageLoad", function (data) {
      state.pageLoadDebug = {
        status: "event-received",
        data: data || null
      };
      renderBookingBrowserPanel();
    });

    state.pageLoadDebug = {
      status: "listener-registered"
    };
  } catch (error) {
    state.pageLoadDebug = {
      status: "listener-error",
      message: error && error.message ? error.message : String(error)
    };
  }
}

function withTimeout(promise, timeoutMs, timeoutMessage) {
  return new Promise(function (resolve, reject) {
    var isSettled = false;
    var timerId = window.setTimeout(function () {
      if (isSettled) {
        return;
      }

      isSettled = true;
      reject(new Error(timeoutMessage || "Operation timed out"));
    }, timeoutMs);

    Promise.resolve(promise).then(function (value) {
      if (isSettled) {
        return;
      }

      isSettled = true;
      window.clearTimeout(timerId);
      resolve(value);
    }).catch(function (error) {
      if (isSettled) {
        return;
      }

      isSettled = true;
      window.clearTimeout(timerId);
      reject(error);
    });
  });
}

function extractCurrentUserInfo(response) {
  if (!response) {
    return null;
  }

  var candidates = collectCurrentUserCandidates(response);

  for (var index = 0; index < candidates.length; index += 1) {
    var candidate = candidates[index];

    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    var userId = candidate.id || candidate.user_id || candidate.zuid || "";
    var userName = candidate.full_name || candidate.name || candidate.display_name || candidate.email || "";

    if (userId || userName) {
      return {
        id: String(userId || ""),
        name: String(userName || ""),
        email: String(candidate.email || candidate.user_email || "")
      };
    }
  }

  return null;
}

function collectCurrentUserCandidates(response) {
  var queue = [response];
  var candidates = [];
  var seenObjects = [];

  while (queue.length) {
    var current = queue.shift();

    if (!current) {
      continue;
    }

    if (typeof current === "object") {
      if (seenObjects.indexOf(current) !== -1) {
        continue;
      }

      seenObjects.push(current);
    }

    if (Array.isArray(current)) {
      Array.prototype.push.apply(queue, current);
      continue;
    }

    if (typeof current !== "object") {
      continue;
    }

    candidates.push(current);

    [
      "user",
      "users",
      "data",
      "currentUser",
      "current_user",
      "currentuser",
      "user_details",
      "details"
    ].forEach(function (key) {
      if (current[key]) {
        queue.push(current[key]);
      }
    });
  }

  return candidates;
}

function extractBookingStageOptionsFromFields(fields) {
  return extractBookingStageMetadata(fields).options;
}

function extractBookingStageMetadata(fields) {
  const result = {
    options: [],
    fieldApiName: "",
    availableFieldApiNames: [],
    debug: {
      candidateField: null,
      stageLikeFields: []
    }
  };

  if (!Array.isArray(fields) || !fields.length) {
    return result;
  }

  result.availableFieldApiNames = fields.map(function (field) {
    return String(field && field.api_name || "").trim();
  }).filter(function (apiName) {
    return Boolean(apiName);
  });
  result.debug.stageLikeFields = fields.filter(function (field) {
    return isLikelyStageField(field);
  }).map(summarizeStageFieldForDebug);

  const preferredApiNames = {
    Stage: true,
    Booking_Stage: true,
    BookingStage: true,
    Stage_Probability: true,
    StageProbability: true,
    Deal_Stage: true,
    Pipeline_Stage: true
  };
  var candidateField = null;

  for (var index = 0; index < fields.length; index += 1) {
    var field = fields[index];

    if (!field) {
      continue;
    }

    if (preferredApiNames[field.api_name] && isLikelyStageField(field)) {
      candidateField = field;
      break;
    }
  }

  if (!candidateField) {
    candidateField = fields.find(function (field) {
      return isLikelyStageField(field);
    }) || null;
  }

  if (!candidateField) {
    return result;
  }

  const seen = {};
  const stageOptions = extractStageOptionsFromField(candidateField);

  result.fieldApiName = String(candidateField.api_name || "").trim();
  result.debug.candidateField = summarizeStageFieldForDebug(candidateField);
  result.options = stageOptions.filter(function (value) {
    if (!value || seen[value]) {
      return false;
    }

    seen[value] = true;
    return true;
  });

  return result;
}

function summarizeStageFieldForDebug(field) {
  if (!field || typeof field !== "object") {
    return null;
  }

  return {
    api_name: field.api_name || "",
    display_label: field.display_label || field.field_label || "",
    data_type: field.data_type || field.json_type || field.type || "",
    option_sources: {
      pick_list_values: Array.isArray(field.pick_list_values) ? field.pick_list_values.length : 0,
      maps: Array.isArray(field.maps) ? field.maps.length : 0,
      stage_mappings: Array.isArray(field.stage_mappings) ? field.stage_mappings.length : 0,
      stage_probability_mappings: Array.isArray(field.stage_probability_mappings) ? field.stage_probability_mappings.length : 0,
      probability_mappings: Array.isArray(field.probability_mappings) ? field.probability_mappings.length : 0
    }
  };
}

function isLikelyStageField(field) {
  if (!field || typeof field !== "object") {
    return false;
  }

  var apiName = normalizeComparableText(field.api_name);
  var displayLabel = normalizeComparableText(field.display_label || field.field_label);
  var dataType = normalizeComparableText(field.data_type || field.json_type || field.type);
  var hasStageMapping = Boolean(
    (Array.isArray(field.pick_list_values) && field.pick_list_values.length) ||
    (Array.isArray(field.maps) && field.maps.length) ||
    (Array.isArray(field.stage_mappings) && field.stage_mappings.length) ||
    (Array.isArray(field.stage_probability_mappings) && field.stage_probability_mappings.length) ||
    (Array.isArray(field.probability_mappings) && field.probability_mappings.length)
  );

  if (apiName === "stage" || displayLabel === "stage") {
    return true;
  }

  if (apiName.indexOf("stage") !== -1 || displayLabel.indexOf("stage") !== -1) {
    return hasStageMapping || dataType.indexOf("pick") !== -1 || dataType.indexOf("stage") !== -1;
  }

  return false;
}

function extractStageOptionsFromField(field) {
  var rawCollections = [
    field && field.pick_list_values,
    field && field.maps,
    field && field.stage_mappings,
    field && field.stage_probability_mappings,
    field && field.probability_mappings,
    field && field.values,
    field && field.options
  ];
  var queue = rawCollections.filter(Array.isArray);
  var options = [];
  var seenObjects = [];

  while (queue.length) {
    var currentCollection = queue.shift();

    currentCollection.forEach(function (item) {
      if (!item) {
        return;
      }

      if (typeof item !== "object") {
        var primitiveValue = String(item).trim();

        if (primitiveValue) {
          options.push(primitiveValue);
        }

        return;
      }

      if (seenObjects.indexOf(item) !== -1) {
        return;
      }

      seenObjects.push(item);

      var optionValue = String(
        item.display_value ||
        item.actual_value ||
        item.reference_value ||
        item.value ||
        item.label ||
        item.name ||
        item.stage ||
        item.stage_name ||
        item.Stage ||
        item.Stage_Name ||
        ""
      ).trim();

      if (optionValue) {
        options.push(optionValue);
      }

      [
        item.pick_list_values,
        item.maps,
        item.stage_mappings,
        item.stage_probability_mappings,
        item.probability_mappings,
        item.values,
        item.options
      ].forEach(function (nestedCollection) {
        if (Array.isArray(nestedCollection) && nestedCollection.length) {
          queue.push(nestedCollection);
        }
      });
    });
  }

  return options;
}

function mergeUniqueTextValues() {
  var seen = {};
  var merged = [];

  Array.prototype.forEach.call(arguments, function (collection) {
    (collection || []).forEach(function (value) {
      var normalized = String(value || "").trim();

      if (!normalized || seen[normalized]) {
        return;
      }

      seen[normalized] = true;
      merged.push(normalized);
    });
  });

  return merged;
}

function summarizeRawBookingDebugRecord(record) {
  if (!record || typeof record !== "object") {
    return null;
  }

  var keys = Object.keys(record);
  var ownerKeys = keys.filter(function (key) {
    return normalizeComparableText(key).indexOf("owner") !== -1;
  });
  var stageKeys = keys.filter(function (key) {
    return normalizeComparableText(key).indexOf("stage") !== -1;
  });
  var ownerPreview = {};
  var stagePreview = {};

  ownerKeys.slice(0, 6).forEach(function (key) {
    ownerPreview[key] = summarizeRawDebugValue(record[key]);
  });
  stageKeys.slice(0, 6).forEach(function (key) {
    stagePreview[key] = summarizeRawDebugValue(record[key]);
  });

  return {
    id: record.id || "",
    booking: record.Deal_Name || record.Name || record.MFSP_Reference || "",
    owner_keys: ownerKeys,
    stage_keys: stageKeys,
    owner_preview: ownerPreview,
    stage_preview: stagePreview
  };
}

function summarizeRawDebugValue(value) {
  if (value === null || value === undefined || value === "") {
    return value;
  }

  if (typeof value !== "object") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.slice(0, 3).map(summarizeRawDebugValue);
  }

  var summary = {};

  [
    "id",
    "name",
    "full_name",
    "display_value",
    "actual_value",
    "value",
    "label",
    "email",
    "stage_name",
    "Stage_Name",
    "probability"
  ].forEach(function (key) {
    if (value[key] !== null && value[key] !== undefined && value[key] !== "") {
      summary[key] = value[key];
    }
  });

  return Object.keys(summary).length ? summary : Object.keys(value).slice(0, 8);
}

function buildBookingListFieldNames(availableFieldApiNames, stageFieldApiName) {
  const preferredFieldNames = [
    "MFSP_Reference",
    "Reference",
    "Booking_Reference",
    "Deal_Name",
    "Name",
    "Booking_Name",
    "Account_Name",
    "Agency",
    "Primary_Contact",
    "Contact_Name",
    "Travelers_Number",
    "Travellers_Number",
    "Number_of_Travelers",
    "Sales_Price_inc_Taxes",
    "Sales_Price",
    "Sales_Amount",
    "Total_Sales",
    "Total_Sales_Amount",
    "Amount",
    "Arrival_Date",
    "Departure_Date",
    "Start_Date",
    "End_Date",
    "Owner",
    "SMOWNERID",
    "Booking_Owner",
    "BookingOwner",
    "Record_Owner",
    "Owner_Id",
    "Assigned_To",
    "Owner_Name",
    "Booking_Owner_Name",
    "Stage",
    "Booking_Stage",
    "BookingStage",
    "Stage_Probability",
    "StageProbability",
    "Deal_Stage",
    "Pipeline_Stage"
  ];
  const availableFieldSet = {};
  const selected = {};

  (availableFieldApiNames || []).forEach(function (fieldName) {
    availableFieldSet[fieldName] = true;
  });

  if (stageFieldApiName) {
    preferredFieldNames.push(stageFieldApiName);
  }

  return preferredFieldNames.filter(function (fieldName) {
    if (!fieldName || selected[fieldName]) {
      return false;
    }

    if (Object.keys(availableFieldSet).length && !availableFieldSet[fieldName]) {
      return false;
    }

    selected[fieldName] = true;
    return true;
  });
}

function getBookingFromSearch() {
  const rawValue = elements.bookingSearch.value.trim();

  if (!rawValue) {
    return null;
  }

  return state.bookingIndex[rawValue] || state.bookingIndex[rawValue.toLowerCase()] || null;
}

function renderBookingBrowserPanel() {
  renderBookingBrowser({
    elements: elements,
    state: state,
    onBookingSelected: async function (booking) {
      cacheBookingLookup(state, booking);
      elements.bookingSearch.value = buildBookingLabel(booking);
      hideSearchResults(elements);
      await loadBookingWorkspace(booking.id);
    }
  });
}

async function switchTab(tabName) {
  state.activeTab = tabName;
  renderActiveTab(elements, state);

  if (tabName === "desk") {
    setSummaryView("desk");
  }

  if (tabName === "emails") {
    clearSelectedMailPreview();
    await ensureBookingEmailsLoaded();
    renderEmailsPanel(elements, state);
  }

  if (tabName === "travelers") {
    await ensureBookingTravelersLoaded();
    renderTravelersWorkspace();
  }

  if (tabName === "payments") {
    renderPaymentsWorkspace(elements, state);
    if (state.activePaymentTab === "cardPurchases") {
      await setPaymentTab(elements, state, "cardPurchases");
    }
  }

  renderBookingWorkspace(elements, state);
}

async function ensureBookingEmailsLoaded(forceReload) {
  if (!state.selectedBookingId) {
    renderEmailsPanel(elements, state);
    return;
  }

  if (state.draftEmailsLoaded && !forceReload) {
    renderEmailsPanel(elements, state);
    return;
  }

  state.emailsLoading = true;
  state.draftEmailsError = "";
  renderEmailsPanel(elements, state);

  try {
    state.emailDrafts = await loadBookingMailRecordsFromFunction(state.selectedBookingId, "drafts");
    state.draftEmailsLoaded = true;
  } catch (error) {
    state.emailDrafts = [];
    state.draftEmailsError = buildEmailLoadErrorMessage(error, "Draft emails");
    state.draftEmailsLoaded = false;
  } finally {
    state.emailsLoading = false;
    renderEmailsPanel(elements, state);
  }
}

async function loadBookingBlueprintForBooking(bookingId) {
  const response = await crmExecuteFunction("blueprint_getbookingblueprint", {
    bookingId: bookingId,
    moduleApiName: MODULES.bookings
  });
  const payload = extractFunctionPayload(response);
  const errorDetails = getFunctionPayloadErrorDetails(payload);

  if (errorDetails) {
    throw buildFunctionPayloadError(errorDetails);
  }

  return normalizeBookingBlueprintPayload(payload);
}

async function ensureDeskTicketLoaded() {
  var booking = state.selectedBooking;
  var ticketId = getBookingLinkFieldValue(booking || {}, ["Desk Ticket ID", "Desk_Ticket_ID", "Desk_Ticket_Id", "DeskTicketID"]);

  if (!booking || !ticketId || state.deskTicketLoading || state.deskTicketLoadedBookingId === state.selectedBookingId) {
    return;
  }

  var bookingId = state.selectedBookingId;
  state.deskTicketLoading = true;
  state.deskTicketError = "";
  renderBookingWorkspace(elements, state);
  renderBookingSummary(elements, state);

  try {
    var response = await crmExecuteFunction("desk_getticketlatestinteraction", {
      ticketId: ticketId
    });
    var payload = extractFunctionPayload(response);
    var errorDetails = getFunctionPayloadErrorDetails(payload);

    if (errorDetails) {
      throw buildFunctionPayloadError(errorDetails);
    }

    if (bookingId !== state.selectedBookingId) {
      return;
    }

    state.deskTicket = normalizeDeskTicketPayload(payload);
    state.deskTicketLoadedBookingId = bookingId;
  } catch (error) {
    if (bookingId === state.selectedBookingId) {
      state.deskTicketError = "Desk information could not be loaded. Check the Desk OAuth connection.";
    }
  } finally {
    if (bookingId === state.selectedBookingId) {
      state.deskTicketLoading = false;
      renderBookingWorkspace(elements, state);
      renderBookingSummary(elements, state);
    }
  }
}

function normalizeDeskTicketPayload(payload) {
  var ticket = payload && payload.ticket && typeof payload.ticket === "object" ? payload.ticket : payload || {};
  var interaction = ticket.latest_interaction && typeof ticket.latest_interaction === "object"
    ? ticket.latest_interaction
    : {};

  return {
    id: ticket.id || "",
    ticket_number: ticket.ticket_number || ticket.ticketNumber || "",
    status: ticket.status || "",
    priority: ticket.priority || "",
    url: ticket.url || "",
    latest_interaction: {
      party: interaction.party || "system",
      author_name: interaction.author_name || interaction.authorName || "",
      created_time: interaction.created_time || interaction.createdTime || "",
      summary: interaction.summary || ""
    }
  };
}

function normalizeBookingBlueprintPayload(payload) {
  const blueprint = payload && payload.blueprint && typeof payload.blueprint === "object" ? payload.blueprint : {};
  const processInfo = payload && payload.process_info && typeof payload.process_info === "object"
    ? payload.process_info
    : blueprint.process_info && typeof blueprint.process_info === "object"
      ? blueprint.process_info
      : {};
  const transitions = Array.isArray(payload && payload.transitions)
    ? payload.transitions
    : Array.isArray(blueprint.transitions)
      ? blueprint.transitions
      : [];

  return {
    blueprint: blueprint,
    processInfo: processInfo,
    transitions: transitions
  };
}

function buildBookingBlueprintLoadErrorMessage(error) {
  return error && error.message
    ? error.message
    : "Blueprint data could not be loaded for this booking.";
}

function findSelectedBookingBlueprintTransition(transitionId) {
  const transitions = Array.isArray(state.bookingBlueprint && state.bookingBlueprint.transitions)
    ? state.bookingBlueprint.transitions
    : [];

  for (var index = 0; index < transitions.length; index += 1) {
    if (String(transitions[index] && transitions[index].id || "") === String(transitionId || "")) {
      return transitions[index];
    }
  }

  return null;
}

async function loadBookingMailRecordsFromFunction(bookingId, mode) {
  const response = await crmExecuteFunction("comm_getcommunicationsforbooking", {
    bookingId: bookingId
  });
  const payload = extractFunctionPayload(response);
  const errorDetails = getFunctionPayloadErrorDetails(payload);

  if (errorDetails) {
    throw buildFunctionPayloadError(errorDetails);
  }

  return extractMailRecordsFromPayload(payload, mode);
}

async function ensureSelectedMailContentLoaded(tabName, recordId) {
  const cacheKey = getMailCacheKey(tabName, recordId);
  const selectedRecord = findMailRecordById(state.emailDrafts, "drafts", recordId);

  if (!selectedRecord) {
    return;
  }

  state.mailContentByKey[cacheKey] = Object.assign({}, selectedRecord);
  state.mailViewerLoadingKey = "";
  state.mailViewerError = "";
  state.mailViewerErrorKey = "";
  renderEmailsPanel(elements, state);
}

function clearSelectedMailPreview() {
  state.selectedDraftRecordId = "";
  state.mailViewerLoadingKey = "";
  state.mailViewerError = "";
  state.mailViewerErrorKey = "";
  state.draftEditorOpen = false;
  state.draftEditorSaving = false;
  state.draftEditorFields = null;
  state.draftEditorMode = "visual";
  state.outlookConfirmOpen = false;
}

function getMailListFunctionName() {
  return "email_getmoduleemaildrafts";
}

function getMailCacheKey(tabName, recordId) {
  return tabName + "::" + recordId;
}

function getFunctionPayloadErrorDetails(payload) {
  if (!payload) {
    return null;
  }

  if (typeof payload === "string") {
    return /auth|error|fail|exception/i.test(payload)
      ? {
          code: "",
          message: payload
        }
      : null;
  }

  if (Array.isArray(payload)) {
    return null;
  }

  const status = payload.status ? String(payload.status).toLowerCase() : "";
  const success = payload.success;
  const ok = payload.ok;
  const errorFlag = payload.error;
  const details = getApiErrorDetails(payload);
  const nestedApiCandidates = [
    payload.api_response,
    payload.api_response && Array.isArray(payload.api_response.data) ? payload.api_response.data[0] : null,
    payload.data,
    payload.data && Array.isArray(payload.data.data) ? payload.data.data[0] : null
  ];

  for (var nestedIndex = 0; nestedIndex < nestedApiCandidates.length; nestedIndex += 1) {
    var nestedCandidate = nestedApiCandidates[nestedIndex];
    var nestedDetails = getApiErrorDetails(nestedCandidate);
    var nestedStatus = nestedCandidate && nestedCandidate.status ? String(nestedCandidate.status).toLowerCase() : "";

    if (nestedDetails.code && nestedDetails.code.toLowerCase() !== "success") {
      return nestedDetails;
    }

    if (nestedStatus === "error") {
      return nestedDetails.code || nestedDetails.message
        ? nestedDetails
        : {
            code: "",
            message: "Zoho API returned an error while processing the function."
          };
    }
  }

  if (details.code && details.code.toLowerCase() !== "success") {
    return details;
  }

  if (status === "error" || success === false || ok === false || errorFlag === true) {
    return details.code || details.message
      ? details
      : {
          code: "",
          message: "The function returned an error payload."
        };
  }

  return null;
}

function extractFunctionPayload(response) {
  const candidates = [
    response && response.details && response.details.output,
    response && response.details && response.details.response,
    response && response.details,
    response && response.data,
    response
  ];

  for (var index = 0; index < candidates.length; index += 1) {
    var candidate = normalizeFunctionPayloadCandidate(candidates[index]);

    if (candidate !== null && candidate !== undefined && candidate !== "") {
      return candidate;
    }
  }

  return [];
}

function normalizeFunctionPayloadCandidate(candidate) {
  if (candidate === null || candidate === undefined || candidate === "") {
    return null;
  }

  if (typeof candidate === "string") {
    const parsed = parseJsonCandidate(candidate);
    return parsed !== null ? parsed : candidate;
  }

  if (typeof candidate === "object" && !Array.isArray(candidate) && !Object.keys(candidate).length) {
    return null;
  }

  return candidate;
}

function extractMailRecordsFromPayload(payload, mode) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const keyedRecords = [
    payload[mode],
    payload.emails,
    payload.drafts,
    payload.Email,
    payload.Draft,
    payload.Emails,
    payload.Drafts,
    payload.email_drafts,
    payload.__email_drafts,
    payload.communications,
    payload.data,
    payload.records,
    payload.items,
    payload.result,
    payload.output
  ];

  for (var index = 0; index < keyedRecords.length; index += 1) {
    var value = keyedRecords[index];
    var normalized = normalizeMailRecordCollection(value, mode);

    if (normalized) {
      return normalized;
    }
  }

  return [];
}

function extractMailContentRecord(payload, fallbackRecord, mode) {
  const normalized = normalizeMailContentCandidate(payload, mode);

  if (typeof normalized === "string") {
    return Object.assign({}, fallbackRecord || {}, {
      content: normalized
    });
  }

  if (!normalized || typeof normalized !== "object") {
    return Object.assign({}, fallbackRecord || {});
  }

  return Object.assign({}, fallbackRecord || {}, normalized);
}

function normalizeMailRecordCollection(value, mode) {
  if (Array.isArray(value)) {
    return value;
  }

  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    const parsed = parseJsonCandidate(value);
    return normalizeMailRecordCollection(parsed, mode);
  }

  if (typeof value === "object") {
    if (Array.isArray(value[mode])) {
      return value[mode];
    }

    if (Array.isArray(value.emails)) {
      return value.emails;
    }

    if (Array.isArray(value.drafts)) {
      return value.drafts;
    }

    if (Array.isArray(value.Emails)) {
      return value.Emails;
    }

    if (Array.isArray(value.Drafts)) {
      return value.Drafts;
    }

    if (Array.isArray(value.__email_drafts)) {
      return value.__email_drafts;
    }

    if (Array.isArray(value.communications)) {
      return value.communications;
    }

    if (Array.isArray(value.data)) {
      return value.data;
    }

    if (Array.isArray(value.records)) {
      return value.records;
    }
  }

  return null;
}

function normalizeMailContentCandidate(value, mode) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    const parsed = parseJsonCandidate(value);
    return parsed !== null ? normalizeMailContentCandidate(parsed, mode) : value;
  }

  if (Array.isArray(value)) {
    return value[0] || null;
  }

  if (typeof value !== "object") {
    return null;
  }

  if (Array.isArray(value[mode])) {
    return value[mode][0] || null;
  }

  if (Array.isArray(value.emails)) {
    return value.emails[0] || null;
  }

  if (Array.isArray(value.drafts)) {
    return value.drafts[0] || null;
  }

  if (Array.isArray(value.Email)) {
    return value.Email[0] || null;
  }

  if (Array.isArray(value.Draft)) {
    return value.Draft[0] || null;
  }

  if (Array.isArray(value.Emails)) {
    return value.Emails[0] || null;
  }

  if (Array.isArray(value.Drafts)) {
    return value.Drafts[0] || null;
  }

  if (Array.isArray(value.__email_drafts)) {
    return value.__email_drafts[0] || null;
  }

  const nestedCandidate = [
    value[mode],
    value.email,
    value.draft,
    value.Email,
    value.Draft,
    value.Emails,
    value.Drafts,
    value.__email_drafts,
    value.data,
    value.record,
    value.item,
    value.result,
    value.output
  ];

  for (var index = 0; index < nestedCandidate.length; index += 1) {
    var candidate = nestedCandidate[index];

    if (candidate === null || candidate === undefined || candidate === "") {
      continue;
    }

    if (candidate === value) {
      break;
    }

    return normalizeMailContentCandidate(candidate, mode);
  }

  return value;
}

function buildFunctionPayloadError(details) {
  const message = details.message || details.code || "Unknown function error";
  const error = new Error(message);
  error.code = details.code || "";
  return error;
}

function parseJsonCandidate(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed || (trimmed.charAt(0) !== "{" && trimmed.charAt(0) !== "[")) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    return null;
  }
}

function buildEmailLoadErrorMessage(error, label) {
  const details = getApiErrorDetails(error);

  if (details.code === "AUTHENTICATION_FAILURE") {
    return label + " could not be loaded. Zoho returned AUTHENTICATION_FAILURE for this widget session.";
  }

  if (details.message) {
    return label + " could not be loaded. " + details.message;
  }

  return label + " could not be loaded for this booking.";
}





function getSelectedDraftViewerRecord() {
  const draftId = state.selectedDraftRecordId;

  if (!draftId) {
    return null;
  }

  const cacheKey = getMailCacheKey("drafts", draftId);
  const cachedRecord = state.mailContentByKey[cacheKey];

  if (cachedRecord) {
    return cachedRecord;
  }

  return findMailRecordById(state.emailDrafts, "drafts", draftId);
}









function normalizeMailRecipientList(value) {
  return String(value || "")
    .split(/[;,]/)
    .map(function (item) {
      return item.trim();
    })
    .filter(Boolean)
    .join(",");
}













function buildMailtoUrl(to, cc, subject, body) {
  const normalizedTo = normalizeMailRecipientList(to);
  const path = normalizedTo
    .split(",")
    .filter(Boolean)
    .map(function (item) {
      return encodeURIComponent(item).replace(/%40/g, "@");
    })
    .join(",");
  const queryParts = [];

  if (cc) {
    queryParts.push("cc=" + encodeMailtoQueryValue(normalizeMailRecipientList(cc)));
  }

  if (subject) {
    queryParts.push("subject=" + encodeMailtoQueryValue(subject));
  }

  if (body) {
    queryParts.push("body=" + encodeMailtoQueryValue(String(body).replace(/\r?\n/g, "\r\n")));
  }

  return "mailto:" + path + (queryParts.length ? "?" + queryParts.join("&") : "");
}

function encodeMailtoQueryValue(value) {
  return encodeURIComponent(String(value || ""))
    .replace(/%20/g, "%20");
}



function normalizeDraftComparableValue(value) {
  return String(value || "")
    .split(",")
    .map(function (item) {
      return item.trim();
    })
    .filter(Boolean)
    .join(", ")
    .trim();
}





async function deleteSelectedDraft(successMessage) {
  if (state.activeMailTab !== "drafts" || !state.selectedBookingId || !state.selectedDraftRecordId || state.draftEditorSaving) {
    return;
  }

  const draftId = state.selectedDraftRecordId;
  const cacheKey = getMailCacheKey("drafts", draftId);

  state.draftEditorSaving = true;
  setError(elements, "");
  setNotice(elements, "Deleting draft...", {
    loading: true
  });
  renderEmailsPanel(elements, state);

  try {
    const selectedRecord = getSelectedCommunicationRecord();
    const communicationId = String(selectedRecord && selectedRecord.communication_id || "").trim();
    if (!communicationId) {
      throw new Error("The selected draft is not linked to a Communication.");
    }
    const response = await crmExecuteFunction("comm_deletecommunication", {
      communicationId: communicationId
    });
    const payload = extractFunctionPayload(response);
    const errorDetails = getFunctionPayloadErrorDetails(payload);

    if (errorDetails) {
      throw buildFunctionPayloadError(errorDetails);
    }

    removeMailRecordFromCollection(state.emailDrafts, "drafts", draftId);
    delete state.mailContentByKey[cacheKey];
    state.selectedDraftRecordId = "";
    state.draftEditorOpen = false;
    state.draftEditorFields = null;
    state.draftEditorMode = "visual";
    state.outlookConfirmOpen = false;
    setNotice(elements, getFunctionSuccessMessage(payload) || successMessage || "Draft deleted successfully.");
  } catch (error) {
    setNotice(elements, "");
    setError(elements, error.message || "Could not delete the selected draft.");
  } finally {
    state.draftEditorSaving = false;
    renderEmailsPanel(elements, state);
  }
}

function updateMailRecordInCollection(records, tabName, recordId, nextRecord) {
  for (var index = 0; index < records.length; index += 1) {
    if (getMailRecordId(records[index], index, tabName) === recordId) {
      records[index] = Object.assign({}, records[index], nextRecord);
      return;
    }
  }
}

function removeMailRecordFromCollection(records, tabName, recordId) {
  for (var index = 0; index < records.length; index += 1) {
    if (getMailRecordId(records[index], index, tabName) === recordId) {
      records.splice(index, 1);
      return;
    }
  }
}

function buildMailParticipantList(rawValue) {
  if (!rawValue) {
    return [];
  }

  return rawValue.split(",").map(function (item) {
    return item.trim();
  }).filter(Boolean).map(function (email) {
    return {
      user_name: "",
      email: email
    };
  });
}

function buildSingleMailParticipant(rawValue) {
  if (!rawValue) {
    return {
      user_name: "",
      email: ""
    };
  }

  return {
    user_name: "",
    email: rawValue
  };
}

function stripHtmlForMail(value) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function formatMailEditorValue(value) {
  if (!value) {
    return "";
  }

  if (Array.isArray(value)) {
    return value.map(formatMailEditorValue).filter(Boolean).join(", ");
  }

  if (typeof value === "object") {
    return value.email || value.address || value.name || "";
  }

  return String(value);
}

function getFunctionSuccessMessage(payload) {
  if (!payload) {
    return "";
  }

  if (typeof payload === "string") {
    return payload;
  }

  if (typeof payload === "object") {
    return payload.message || payload.details && payload.details.output || "";
  }

  return "";
}

function logDraftEditorDebug(step, details) {
  if (details === undefined) {
    console.log("[ReservationsManager:draft-editor]", step);
    return;
  }

  console.log("[ReservationsManager:draft-editor]", step, details);
}

function findMailRecordById(records, tabName, recordId) {
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

function getMailField(record, keys) {
  for (var index = 0; index < keys.length; index += 1) {
    var value = record[keys[index]];

    if (value !== null && value !== undefined && value !== "") {
      return value;
    }
  }

  return "";
}

async function onLoadBookingClick() {
  const rawInput = elements.bookingSearch.value.trim();
  let booking = getBookingFromSearch();

  if (!booking) {
    const matches = await searchBookingByInput(rawInput);

    if (matches.length > 1) {
      setNotice(elements, "More than one booking matches that search. Choose the correct one below.");
      renderSearchResults({
        elements: elements,
        records: matches,
        onBookingSelected: async function (match) {
          cacheBookingLookup(state, match);
          elements.bookingSearch.value = buildBookingLabel(match);
          hideSearchResults(elements);
          await loadBookingWorkspace(match.id);
        }
      });
      return;
    }

    booking = matches[0] || null;
  }

  if (!booking) {
    setError(elements, "No booking found for that MFSP reference or booking name.");
    return;
  }

  cacheBookingLookup(state, booking);
  hideSearchResults(elements);
  await loadBookingWorkspace(booking.id);
}

function onClearBookingClick() {
  clearActiveBookingWorkspace();
  elements.bookingSearch.value = "";
  if (elements.bookingReportDialog) {
    elements.bookingReportDialog.hidden = true;
  }
  hideSearchResults(elements);
  setError(elements, "");
  setNotice(elements, "");
  renderBookingWorkspace(elements, state);
  renderBookingSummary(elements, state);
  renderServicesWorkspace();
  renderSelectionPanel(elements, state);
  clearSelectedMailPreview();
  renderEmailsPanel(elements, state);
  renderTravelersWorkspace();
  renderBookingBrowserPanel();
}

async function loadBookingWorkspace(bookingId, options) {
  const settings = options || {};
  const selectionSnapshot = settings.preserveSelection ? createSelectionSnapshot() : null;
  showLoading(elements, state, "");
  state.bookingBlueprint = null;
  state.bookingBlueprintLoading = true;
  state.bookingBlueprintError = "";
  state.bookingBlueprintClosingMenuOpen = false;

  try {
    const bookingBlueprintPromise = loadBookingBlueprintForBooking(bookingId)
      .then(function (result) {
        return {
          ok: true,
          value: result
        };
      })
      .catch(function (error) {
        return {
          ok: false,
          error: error
        };
      });
    const bookingRecord = await crmGetRecord(MODULES.bookings, bookingId);
    const services = (await loadBookingServicesForBooking(bookingId)).sort(function (left, right) {
      const leftDate = left.Service_Date || "";
      const rightDate = right.Service_Date || "";

      if (leftDate === rightDate) {
        return String(left.Name || "").localeCompare(String(right.Name || ""));
      }

      return leftDate.localeCompare(rightDate);
    });
    const steps = (await loadBookingStepsForBooking(bookingId)).sort(function (left, right) {
      const leftDate = left.Start_Date_Time || "";
      const rightDate = right.Start_Date_Time || "";

      if (leftDate === rightDate) {
        return String(left.Name || "").localeCompare(String(right.Name || ""));
      }

      return leftDate.localeCompare(rightDate);
    });

    state.selectedBookingId = bookingId;
    state.selectedBooking = bookingRecord;
    state.cardPurchases = [];
    state.cardPurchasesLoading = false;
    state.cardPurchasesLoaded = false;
    state.cardPurchasesLoadedBookingId = "";
    state.cardPurchasesError = "";
    state.deskTicket = null;
    state.deskTicketLoading = false;
    state.deskTicketError = "";
    state.deskTicketLoadedBookingId = "";
    state.services = services;
    state.filteredServices = services.slice();
    state.steps = steps;
    indexSteps(state, steps);
    state.groupedRows = [];
    state.selectedServiceIds = {};
    state.selectedServiceId = "";
    state.selectedService = null;
    state.selectedStepId = "";
    state.selectedStep = null;
    state.selectedItemType = "service";
    state.serviceDetailTab = "basic";
    state.serviceStatusDraftValue = "";
    resetServiceFilters();
    state.emailDrafts = [];
    resetTravelersState();
    state.activeMailTab = "drafts";
    state.selectedDraftRecordId = "";
    state.mailContentByKey = {};
    state.mailViewerLoadingKey = "";
    state.mailViewerError = "";
    state.mailViewerErrorKey = "";
    state.draftEmailsLoaded = false;
    state.emailsLoading = false;
    state.draftEmailsError = "";

    try {
      const blueprintResult = await bookingBlueprintPromise;

      if (blueprintResult && blueprintResult.ok) {
        state.bookingBlueprint = blueprintResult.value;
        state.bookingBlueprintError = "";
      } else {
        state.bookingBlueprint = null;
        state.bookingBlueprintError = buildBookingBlueprintLoadErrorMessage(blueprintResult && blueprintResult.error);
      }
    } finally {
      state.bookingBlueprintLoading = false;
    }

    if (selectionSnapshot) {
      restoreSelectionSnapshot(selectionSnapshot);
    }

    renderBookingWorkspace(elements, state);
    renderBookingSummary(elements, state);
    void ensureDeskTicketLoaded();
    applyServiceFilter();
    renderSelectionPanel(elements, state);
    renderEmailsPanel(elements, state);
    renderTravelersWorkspace();
    renderBookingBrowserPanel();

    if (state.summaryView === "travelers") {
      await ensureBookingTravelersLoaded();
    }

    elements.bookingSearch.value = buildBookingLabel(bookingRecord);
    if (!settings.preserveNotice) {
      setNotice(elements, "Booking loaded. Select a service row to edit its operational fields.");
    }

    if (state.activeTab === "emails") {
      await ensureBookingEmailsLoaded();
    }

    if (state.activeTab === "travelers") {
      await ensureBookingTravelersLoaded(true);
    }
  } catch (error) {
    state.bookingBlueprint = null;
    state.bookingBlueprintLoading = false;
    state.bookingBlueprintError = "";
    setError(elements, "Could not load the selected booking or its booking services.");
  } finally {
    clearLoading(elements, state);
  }
}

async function onWorkspaceActionClick(event) {
  const closingMenuToggle = event.target && event.target.closest ? event.target.closest("[data-blueprint-closing-menu-toggle]") : null;

  if (closingMenuToggle) {
    event.stopPropagation();
    state.bookingBlueprintClosingMenuOpen = !state.bookingBlueprintClosingMenuOpen;
    renderBookingWorkspace(elements, state);
    return;
  }

  const transitionButton = event.target && event.target.closest ? event.target.closest("[data-blueprint-transition-id]") : null;

  if (transitionButton) {
    event.stopPropagation();
    const transitionId = transitionButton.getAttribute("data-blueprint-transition-id") || "";
    const transition = findSelectedBookingBlueprintTransition(transitionId);
    if (!transition || !state.selectedBookingId) {
      setError(elements, "This workflow action is no longer available. Refresh the booking and try again.");
      return;
    }

    transitionButton.disabled = true;
    setError(elements, "");

    try {
      await executeBlueprintTransition(transition, {});
    } catch (error) {
      transitionButton.disabled = false;
      setError(elements, error && error.message ? error.message : "The workflow action could not be executed.");
    }
    return;
  }

  const workspaceTabButton = event.target && event.target.closest ? event.target.closest("[data-workspace-tab]") : null;

  if (workspaceTabButton) {
    const tabName = workspaceTabButton.getAttribute("data-workspace-tab") || "";

    if (tabName) {
      switchTab(tabName);
    }

    return;
  }

  const workspaceLinkButton = event.target && event.target.closest ? event.target.closest("[data-workspace-link]") : null;

  if (workspaceLinkButton) {
    const linkKey = workspaceLinkButton.getAttribute("data-workspace-link") || "";

    if (linkKey) {
      openWorkspaceExternalLink(linkKey);
    }
  }
}

function openBlueprintTransitionDialog(transition, transitionName) {
  const fields = Array.isArray(transition.fields) ? transition.fields.filter(function (field) {
    return field && field.api_name && !field.read_only && !field.field_read_only;
  }) : [];
  const dialog = document.createElement("div");
  const processInfo = state.bookingBlueprint && state.bookingBlueprint.processInfo || {};
  const currentPicklist = processInfo.current_picklist && typeof processInfo.current_picklist === "object" ? processInfo.current_picklist : {};
  const previousState = currentPicklist.value || processInfo.field_value || "Current state";
  const nextState = transition.next_field_value || transitionName;
  const previousColor = normalizeBlueprintColor(currentPicklist.colour_code, "#0f766e");
  const nextColor = normalizeBlueprintColor(transition.color_code, "#2385ef");
  dialog.className = "booking-action-dialog blueprint-transition-dialog";
  dialog.innerHTML = [
    '<div class="booking-action-dialog-panel" role="dialog" aria-modal="true" aria-label="' + escapeHtml(transitionName) + '">',
    '<div class="blueprint-transition-dialog-heading"><span class="blueprint-transition-dialog-eyebrow">Workflow transition</span><h4>' + escapeHtml(transitionName) + "</h4></div>",
    '<div class="blueprint-transition-route" aria-label="Transition from ' + escapeHtml(previousState) + " to " + escapeHtml(nextState) + '">',
    '  <span class="blueprint-transition-state" style="--blueprint-state-color:' + previousColor + '">' + escapeHtml(previousState) + "</span>",
    '  <span class="blueprint-transition-arrow" aria-hidden="true">→</span>',
    '  <span class="blueprint-transition-state" style="--blueprint-state-color:' + nextColor + '">' + escapeHtml(nextState) + "</span>",
    "</div>",
    '<p class="blueprint-transition-confirmation">Are you sure you want to move this booking to the new state?</p>',
    '<form class="booking-form">',
    fields.length ? '<div class="booking-form-grid">' + fields.map(function (field) { return renderBlueprintTransitionField(field, transition.data || {}); }).join("") + "</div>" : "",
    '<div class="booking-action-dialog-footer booking-action-dialog-footer--split"><button class="button tertiary compact" type="button" data-close>Cancel</button><button class="button booking-action-button compact" type="submit">Execute</button></div>',
    "</form></div>"
  ].join("");

  document.body.appendChild(dialog);
  dialog.querySelector("[data-close]").addEventListener("click", function () { dialog.remove(); });
  dialog.addEventListener("click", function (event) {
    if (event.target === dialog) {
      dialog.remove();
    }
  });
  dialog.querySelector("form").addEventListener("submit", async function (submitEvent) {
    submitEvent.preventDefault();
    const data = collectBlueprintTransitionData(fields, dialog.querySelector("form"));
    const submitButton = dialog.querySelector('[type="submit"]');
    submitButton.disabled = true;
    try {
      await executeBlueprintTransition(transition, data);
      dialog.remove();
    } catch (error) {
      submitButton.disabled = false;
      setError(elements, error && error.message ? error.message : "The workflow action could not be executed.");
    }
  });
}

function normalizeBlueprintColor(color, fallback) {
  const candidate = String(color || "").trim();
  return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : fallback;
}

function renderBlueprintTransitionField(field, initialData) {
  const apiName = String(field.api_name || "");
  const label = field.field_label || field.display_label || apiName;
  const value = initialData[apiName] === undefined || initialData[apiName] === null ? "" : initialData[apiName];
  const required = field.mandatory || field.system_mandatory ? " required" : "";
  const dataType = String(field.data_type || "").toLowerCase();
  const options = Array.isArray(field.pick_list_values) ? field.pick_list_values : [];
  let control;
  if (options.length) {
    control = '<select name="' + escapeHtml(apiName) + '"' + required + '><option value="">Select…</option>' + options.map(function (option) {
      const optionValue = option.actual_value || option.display_value || option.value || "";
      return '<option value="' + escapeHtml(optionValue) + '"' + (String(optionValue) === String(value) ? " selected" : "") + ">" + escapeHtml(option.display_value || optionValue) + "</option>";
    }).join("") + "</select>";
  } else if (dataType === "boolean") {
    control = '<input name="' + escapeHtml(apiName) + '" type="checkbox"' + (value === true ? " checked" : "") + ">";
  } else if (dataType === "textarea") {
    control = '<textarea name="' + escapeHtml(apiName) + '" rows="3"' + required + ">" + escapeHtml(value) + "</textarea>";
  } else {
    const type = dataType === "date" ? "date" : (dataType === "integer" || dataType === "double" || dataType === "currency" ? "number" : "text");
    control = '<input name="' + escapeHtml(apiName) + '" type="' + type + '" value="' + escapeHtml(value) + '"' + required + ">";
  }
  return '<label class="field booking-form-field"><span>' + escapeHtml(label) + (required ? " <em>*</em>" : "") + "</span>" + control + "</label>";
}

function collectBlueprintTransitionData(fields, form) {
  const data = {};
  fields.forEach(function (field) {
    const input = form.elements[field.api_name];
    if (!input) return;
    data[field.api_name] = input.type === "checkbox" ? input.checked : input.value;
  });
  return data;
}

async function executeBlueprintTransition(transition, data) {
  const response = await crmExecuteFunction("blueprint_executetransition", {
    moduleApiName: MODULES.bookings,
    recordId: String(state.selectedBookingId),
    expectedCurrentState: String(state.bookingBlueprint && state.bookingBlueprint.processInfo && state.bookingBlueprint.processInfo.field_value || ""),
    transitionId: String(transition.id),
    transitionDataJson: JSON.stringify(data || {})
  });
  const payload = extractFunctionPayload(response);
  const errorDetails = getFunctionPayloadErrorDetails(payload);
  if (errorDetails || !payload || payload.success !== true) {
    throw buildFunctionPayloadError(errorDetails || { message: payload && payload.message || "Zoho CRM rejected the workflow action." });
  }
  state.bookingBlueprintClosingMenuOpen = false;
  setError(elements, "");
  setNotice(elements, payload.message || "Workflow action executed successfully.");
  await loadBookingWorkspace(state.selectedBookingId, { preserveSelection: true });
}

async function onSyncEzusClick() {
  if (!state.selectedBooking) {
    setError(elements, "Load a booking before syncing with Ezus.");
    return;
  }

  const booking = state.selectedBooking;
  const bookingId = booking.id;
  const ezusProjectRef = booking.Ezus_Project_ID || "";

  if (!ezusProjectRef) {
    setError(elements, "This booking does not have Ezus_Project_ID, so the sync cannot start.");
    return;
  }

  state.syncingEzus = true;
  setButtonsDisabled(elements, state, true);
  setError(elements, "");
  setNotice(elements, "Syncing booking with Ezus...", {
    loading: true
  });

  try {
    const response = await crmExecuteFunction("syncprojectfromezus", {
      bookingId: bookingId,
      args: JSON.stringify({
        sync: {
          syncActionUserEmail: state.currentUserEmail || ""
        }
      })
    });

    let message = "Ezus sync launched.";

    if (response && response.details && typeof response.details.output === "string" && response.details.output) {
      message = response.details.output;
    } else if (response && response.message) {
      message = response.message;
    }

    await loadBookingWorkspace(bookingId, {
      preserveNotice: true
    });
    setNotice(elements, message);
  } catch (error) {
    setError(elements, "Could not run the Ezus sync function from this widget.");
  } finally {
    state.syncingEzus = false;
    clearLoading(elements, state);
  }
}

async function onRunAdminEzusSync(syncType, label) {
  if (!state.selectedBooking) {
    setError(elements, "Load a booking before syncing with Ezus.");
    return;
  }

  if (!state.selectedBooking.Ezus_Project_ID) {
    setError(elements, "This booking does not have Ezus_Project_ID, so the sync cannot start.");
    return;
  }

  state.syncingEzus = true;
  setButtonsDisabled(elements, state, true);
  setError(elements, "");
  setNotice(elements, "Syncing " + label.toLowerCase() + " with Ezus...", { loading: true });

  try {
    const response = await crmExecuteFunction("sync_runprojectfromezus", {
      bookingId: state.selectedBooking.id,
      args: {
        sync: {
          syncActionUserEmail: state.currentUserEmail || ""
        }
      },
      syncType: syncType
    });
    const payload = extractFunctionPayload(response);
    const errorDetails = getFunctionPayloadErrorDetails(payload);

    if (errorDetails) {
      throw buildFunctionPayloadError(errorDetails);
    }

    await loadBookingWorkspace(state.selectedBooking.id, { preserveNotice: true });
    setNotice(elements, payload && payload.message || label + " synced with Ezus.");
  } catch (error) {
    setError(elements, error && error.message ? error.message : "Could not sync " + label.toLowerCase() + " with Ezus.");
  } finally {
    state.syncingEzus = false;
    clearLoading(elements, state);
  }
}

async function onSyncContactToEzus() {
  const booking = state.selectedBooking;
  const contact = booking && (booking.Contact_Name || booking.Primary_Contact);
  const contactId = contact && typeof contact === "object" ? contact.id : contact;

  if (!booking) {
    setError(elements, "Load a booking before syncing its contact with Ezus.");
    return;
  }

  if (!contactId) {
    setError(elements, "This booking does not have a contact to sync with Ezus.");
    return;
  }

  state.syncingEzus = true;
  setButtonsDisabled(elements, state, true);
  setError(elements, "");
  setNotice(elements, "Syncing contact with Ezus...", { loading: true });

  try {
    const response = await crmExecuteFunction("upsertcontactinezus", {
      contactId: String(contactId)
    });
    const payload = extractFunctionPayload(response);
    const errorDetails = getFunctionPayloadErrorDetails(payload);

    if (errorDetails) {
      throw buildFunctionPayloadError(errorDetails);
    }

    setNotice(elements, payload && payload.message || "Contact synced with Ezus.");
  } catch (error) {
    setError(elements, error && error.message ? error.message : "Could not sync the contact with Ezus.");
  } finally {
    state.syncingEzus = false;
    clearLoading(elements, state);
  }
}

async function onCreateAxusClick() {
  if (!state.selectedBooking) {
    setError(elements, "Load a booking before creating it in Axus.");
    return;
  }

  const bookingId = String(state.selectedBooking.id || state.selectedBookingId || "");

  if (!bookingId) {
    setError(elements, "The selected booking does not have a valid ID.");
    return;
  }

  showLoading(elements, state, "Creating AXUS itinerary...");

  try {
    const response = await crmExecuteFunction("sendfullbookingtoaxus", {
      bookingId: bookingId
    });
    const payload = extractFunctionPayload(response);
    const errorDetails = getFunctionPayloadErrorDetails(payload);

    if (errorDetails) {
      throw buildFunctionPayloadError(errorDetails);
    }

    await loadBookingWorkspace(bookingId, { preserveNotice: true, preserveSelection: true });
    setNotice(elements, payload && payload.message || "AXUS itinerary was created successfully.");
  } catch (error) {
    setError(elements, error && error.message ? error.message : "Could not create the AXUS itinerary.");
  } finally {
    clearLoading(elements, state);
  }
}

export async function init() {
  state.zohoInitDebug = {
    status: "starting",
    sdkDetected: Boolean(window.ZOHO && ZOHO.embeddedApp)
  };
  configureServicesController({
    reloadBookingWorkspace: loadBookingWorkspace
  });
  initializeServiceTableColumns();
  bindEvents();
  populateStatusOptions(elements);
  syncBulkPanels();
  hideSearchResults(elements);
  setButtonsDisabled(elements, state, true);
  renderBookingWorkspace(elements, state);
  renderBookingSummary(elements, state);
  renderServicesWorkspace();
  renderActiveTab(elements, state);
  renderBookingBrowserPanel();
  renderEmailsPanel(elements, state);
  renderTravelersWorkspace();

  if (!window.ZOHO || !ZOHO.embeddedApp) {
    state.zohoInitDebug = {
      status: "sdk-missing",
      sdkDetected: false
    };
    renderBookingBrowserPanel();
    setError(elements, "Zoho SDK was not detected.");
    return;
  }

  try {
    await ZOHO.embeddedApp.init();
    state.zohoInitDebug = {
      status: "embedded-app-init-ok",
      sdkDetected: true
    };
    renderBookingBrowserPanel();

    if (ZOHO.CRM && ZOHO.CRM.UI && ZOHO.CRM.UI.Resize) {
      try {
        await withTimeout(
          ZOHO.CRM.UI.Resize({
            width: "1500",
            height: "900"
          }),
          1500,
          "ZOHO.CRM.UI.Resize timed out"
        );
        state.zohoInitDebug = Object.assign({}, state.zohoInitDebug, {
          resize: "ok"
        });
      } catch (resizeError) {
        state.zohoInitDebug = Object.assign({}, state.zohoInitDebug, {
          resize: resizeError && resizeError.message ? resizeError.message : String(resizeError)
        });
      }
      renderBookingBrowserPanel();
    }

    await hydrateCurrentUser();
    await hydrateBookingBrowserOwners();
    await hydrateBookingStageOptions();
    await bootstrapBookingBrowserQueue();
    state.zohoInitDebug = Object.assign({}, state.zohoInitDebug, {
      status: "ready"
    });
    renderBookingBrowserPanel();
  } catch (error) {
    state.zohoInitDebug = {
      status: "init-error",
      sdkDetected: true,
      message: error && error.message ? error.message : String(error)
    };
    renderBookingBrowserPanel();
    setError(elements, "The widget could not initialize inside Zoho CRM.");
  }
}
