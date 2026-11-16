import { openWorkdriveFolderDialog } from "./workdrive-folder-dialog.js";
import { createAutomaticNotificationsController, loadBookingCommunications, excludeAutomaticMail } from "./automatic-notifications.js";
import { resolveWidgetRelationship, getWidgetPermissions } from "./widget-permissions.js";
import { createWorkflowRecovery } from "./workflow-recovery.js";
import { copyOverviewEmail } from "./booking-overview.js";
import { recordEditLocks } from "./record-edit-locks.js";
import { copyBookingUrl } from "./booking-url.js";
import { loadUserBlueprint, assertUserBlueprintTransition, applyBlueprintTransitionColors, applyBlueprintStageColor } from "./blueprint-permissions.js";
import { openCardPurchaseManagement, openCardPurchaseDeletion } from "./card-purchase-management.js";
import { createBookingTasksController } from "./booking-tasks.js";
import { confirmRegeneration } from "./interface-system.js";
import { invalidateQueueTasks } from "./booking-queue-tasks.js";
import { createBookingDocumentsController } from "./booking-documents.js";
import { canManageDocuments } from "./documents-api.js";
import { openBookingCommunicationEditor } from "./booking-communication.js";
import { createReviewNotesNavigation, parsePrepaymentTarget, parseBookingTarget } from "./review-notes-navigation.js";
import { crmExecuteFunction, crmGetAllRecords, crmGetFields, crmGetRecord, crmSearchRecord, crmUpdateRecord } from "./api.js";
import { startDraftLoading, stopDraftLoading } from "./draft-loading.js";
import { validateCreateInEzusAgency, isCreateEzusTransition } from "./blueprint-contact-agency.js";
import { loadBookingWithEzusProject, confirmCreatedEzusProject } from "./ezus-project-refresh.js";
import { beginEzusSync, endEzusSync, assertEzusSyncConfirmed, assertEzusSyncEditsSaved } from "./ezus-sync-guard.js";
import { openSupplierContactEmails, mergeContactEmails } from "./supplier-contact-emails.js";
import { openCreateEzusDialog, saveEzusBookingDetails, EZUS_BOOKING_FIELDS } from "./create-ezus-dialog.js";
import { initializeBookingTags } from "./booking-tags.js";
import { sendDraftBatch } from "./draft-batch.js";
import { createDeskTicketLoader } from "./booking-queue-desk.js";
import { openCommunicationAttachments } from "./communication-attachments.js";
import { initServiceTextSize, loadServiceTextSizeForUser } from "./service-text-size.js";
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
  onCreatePaymentRequestClick,
  onOpenBookingReportDialog,
  onRecordCardPurchase,
  onCardPurchaseTransactionTypeChange,
  onCardPurchaseOriginalPurchaseChange,
  onCardPurchaseSupportingDocumentsChange,
  onCardPurchaseSupportingDocumentsDrop,
  onSubmitCardPurchaseForm
} from "./dialogs-controller.js";
import {
  ensureBookingTravelersLoaded,
  renderTravelersWorkspace,
  resetTravelersState
} from "./travelers-controller.js";
import {
  previewCardPurchaseFile,
  initializeCardPurchaseColumns,
  refreshCardPurchases,
  renderPaymentsWorkspace,
  setPaymentTab
} from "./payments-controller.js";
import {
  applyServiceFilter,
  closeBulkActionMenus,
  closeServiceDetails,
  configureServicesController,
  createSelectionSnapshot,
  initializeServiceTableColumns,
  onApplyBulkStatus,
  onCreateDraftForSelection,
  onRecordRenfePrepayment,
  onResetServiceColumns,
  onSaveService,
  onSelectedServiceStatusChange,
  onSelectedServicePaymentStatusChange,
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
  renderSelectedMailContent,
  renderSearchResults,
  renderSelectionPanel,
  setButtonsDisabled,
  setError,
  setNotice,
  showLoading
} from "./render.js";
import { state } from "./state.js";
import { initializePrepayments, openPrepaymentDetails } from "./prepayments-controller.js";
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
const automaticNotifications = createAutomaticNotificationsController(elements, state, {
  onBack: () => { void switchTab("emails").then(() => { if (state.activeTab === "emails") elements.tabAutomatic?.focus(); }); }
});
const bookingTasks = createBookingTasksController(elements, state, {
  onChanged: bookingId => {
    invalidateQueueTasks(bookingId);
    if (state.queueTaskCounts) delete state.queueTaskCounts[bookingId];
    renderBookingBrowserPanel();
  }
});
const studioChangedBookings = new Set();
let studioRefreshSequence = 0;
const bookingDocuments = createBookingDocumentsController(elements, state, {
  onCRMUpdated: update => {
    studioRefreshSequence++;
    studioChangedBookings.add(String(update.booking_id));
    if (update.raw && update.module === 'Deals') {
      const index = state.bookings.findIndex(item => String(item.id) === String(update.raw.id));
      if (index >= 0) state.bookings[index] = update.raw;
      cacheBookingLookup(state, update.raw);
    }
    if (String(state.selectedBookingId) !== String(update.booking_id) || !update.raw) return;
    const selection = createSelectionSnapshot();
    if (update.module === 'Deals') state.selectedBooking = update.raw;
    if (update.module === 'Booking_Steps') state.steps = state.steps.map(item => String(item.id) === String(update.raw.id) ? update.raw : item);
    if (update.module === 'Booking_Services') state.services = state.services.map(item => String(item.id) === String(update.raw.id) ? update.raw : item);
    indexSteps(state, state.steps);
    restoreSelectionSnapshot(selection);
    applyServiceFilter();
    renderBookingSummary(elements, state);
    renderBookingBrowserPanel();
  },
  onClose: () => { refreshWorkspaceAfterStudio(); }
});

async function refreshWorkspaceAfterStudio() {
  const bookingId = String(state.selectedBookingId || '');
  if (!studioChangedBookings.has(bookingId)) return;
  const requestId = state.bookingWorkspaceRequestId;
  const refreshId = ++studioRefreshSequence;
  const isCurrent = () => String(state.selectedBookingId) === bookingId && state.bookingWorkspaceRequestId === requestId && studioRefreshSequence === refreshId;
  try {
    const [booking, services, steps] = await Promise.all([crmGetRecord(MODULES.bookings, bookingId), loadBookingServicesForBooking(bookingId), loadBookingStepsForBooking(bookingId)]);
    if (!isCurrent()) return;
    if (!booking || String(booking.id) !== bookingId) throw new Error('Booking data could not be loaded.');
    const selection = createSelectionSnapshot();
    state.selectedBooking = booking;
    state.services = services.sort((a,b) => String(a.Service_Date || '').localeCompare(String(b.Service_Date || '')) || String(a.Name || '').localeCompare(String(b.Name || '')));
    state.steps = steps.sort((a,b) => String(a.Start_Date_Time || '').localeCompare(String(b.Start_Date_Time || '')) || String(a.Name || '').localeCompare(String(b.Name || '')));
    indexSteps(state, steps); restoreSelectionSnapshot(selection); applyServiceFilter();
    cacheBookingLookup(state, booking);
    const index = state.bookings.findIndex(item => String(item.id) === bookingId);
    if (index >= 0) state.bookings[index] = booking;
    renderBookingWorkspace(elements, state); renderBookingSummary(elements, state); renderBookingBrowserPanel();
    studioChangedBookings.delete(bookingId);
  } catch (error) {
    if (isCurrent()) setError(elements, 'CRM may be updated, but the workspace could not refresh. Refresh the booking before continuing. ' + error.message);
  }
}
const operationRecovery = createWorkflowRecovery({
  host: elements.operationRecovery,
  getContext: () => ({ bookingId: String(state.selectedBookingId || ""), workspaceId: state.bookingWorkspaceRequestId }),
  execute: args => crmExecuteFunction("widget_workflowrecovery", args),
  beforeResume: bookingId => {
    if (!canLeaveBookingWorkspace()) throw new Error("Save or cancel your pending changes before resuming this operation.");
    assertEzusSyncEditsSaved(state, elements, bookingId, bookingDocuments);
  },
  refresh: bookingId => String(state.selectedBookingId) === bookingId
    ? loadBookingWorkspace(bookingId, { preserveSelection: true, protectPendingEdits: true, throwOnError: true, refreshTravelers: true }) : false,
  report: (message, isError) => isError ? setError(elements, message) : setNotice(elements, message)
});
const AXUS_ITINERARY_SYNC_ATTEMPTS = 20;
const AXUS_ITINERARY_SYNC_INTERVAL_MS = 1500;

function bindEvents() {
  initializePrepayments(elements, state, function () {
    state.activePaymentTab = "prepayments";
    switchTab("payments");
  });
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
  elements.axusItineraryDialogBackdrop.addEventListener("click", onCloseAxusItineraryDialog);
  elements.axusItineraryDialogClose.addEventListener("click", onCloseAxusItineraryDialog);
  elements.axusItineraryDialogOpen.addEventListener("click", onOpenCreatedAxusItinerary);
  elements.actionItineraryOpen.addEventListener("click", onOpenItineraryLink);
  elements.actionItineraryEdit.addEventListener("click", onEditItineraryLink);
  elements.actionItineraryForm.addEventListener("submit", onSaveItineraryLink);
  elements.syncEzus.addEventListener("click", onSyncEzusClick);
  elements.copyBookingUrl?.addEventListener("click", () => {
    if (getWidgetPermissions(state).adminActions && state.selectedBookingId) {
      copyBookingUrl(elements.copyBookingUrl, String(state.selectedBookingId));
    }
  });
  elements.syncProjectInfo.addEventListener("click", function () {
    onRunAdminEzusSync("project", "Project information");
  });
  elements.syncTravelers.addEventListener("click", function () {
    onRunAdminEzusSync("travelers", "Travelers");
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
  if (elements.tabBooking) {
    elements.tabBooking.addEventListener("click", function () {
      setSummaryView("basic");
      switchTab("booking");
    });
  }
  elements.tabServices.addEventListener("click", function () {
    switchTab("services");
  });
  elements.toggleWorkspaceFocus.addEventListener("click", toggleWorkspaceFocusMode);
  if (elements.tabAutomatic) elements.tabAutomatic.addEventListener("click", () => { void switchTab("automatic"); });
  elements.tabEmails.addEventListener("click", function () {
    switchTab("emails");
  });
  if (elements.tabTasks) elements.tabTasks.addEventListener("click", function () { switchTab("tasks"); });
  if (elements.tabDocuments) elements.tabDocuments.addEventListener("click", function () { switchTab("documents"); });
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
  if (elements.paymentTabRefunds) {
    elements.paymentTabRefunds.addEventListener("click", function () {
      setPaymentTab(elements, state, "refunds");
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
    initializeCardPurchaseColumns(elements);
    elements.cardPurchasesBody.addEventListener("click", function (event) {
      const remove = event.target.closest("[data-card-purchase-delete]");
      if (remove) {
        if (remove.disabled) return;
        openCardPurchaseDeletion(elements, state, remove.dataset.cardPurchaseDelete, () => refreshCardPurchases(elements, state))
          .catch(error => setError(elements, error.message || "Could not open the card transaction."));
        return;
      }
      const edit = event.target.closest("[data-card-purchase-edit]");
      if (edit) {
        if (edit.disabled) return;
        edit.disabled = true;
        edit.ariaBusy = "true";
        openCardPurchaseManagement(elements, state, edit.dataset.cardPurchaseEdit, () => refreshCardPurchases(elements, state))
          .catch(error => setError(elements, error.message || "Could not open the card transaction."))
          .finally(() => { edit.disabled = false; edit.ariaBusy = "false"; });
        return;
      }
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
  elements.summaryContent.addEventListener("click", event => {
    const copyEmail = event.target.closest("[data-overview-copy-email]");
    if (copyEmail) { void copyOverviewEmail(copyEmail); return; }
    const toggle = event.target.closest("[data-communication-switch]");
    if (toggle) {
      state.communicationNotesView = toggle.dataset.communicationSwitch;
      renderBookingSummary(elements, state);
      elements.summaryContent.querySelector('[data-communication-switch="' + state.communicationNotesView + '"]').focus();
      return;
    }
    const button = event.target.closest("[data-communication-edit]");
    if (button && state.selectedBooking) openBookingCommunicationEditor(state, button.dataset.communicationEdit, () => renderBookingSummary(elements, state));
  });
  elements.summaryViewBasic.addEventListener("click", function () {
    setSummaryView("basic");
  });
  elements.summaryViewFinancial.addEventListener("click", function () {
    setSummaryView("financial");
  });
  if (elements.summaryViewCommunication) {
    elements.summaryViewCommunication.addEventListener("click", function () {
      switchTab("communication");
    });
  }
  if (elements.summaryViewTravelers) {
    elements.summaryViewTravelers.addEventListener("click", function () {
      setSummaryView("travelers");
    });
  }
  elements.summaryBlueprintPanel.addEventListener("click", onWorkspaceActionClick);
  elements.summaryDashboard.addEventListener("click", onWorkspaceActionClick);
  elements.bookingBrowserSearchBy.addEventListener("change", onBookingBrowserSearchByChange);
  elements.bookingBrowserOwner.addEventListener("change", onBookingBrowserOwnerChange);
  elements.bookingBrowserStagesToggle.addEventListener("click", onBookingBrowserStagesToggleClick);
  elements.bookingBrowserStagesMenu.addEventListener("change", onBookingBrowserStagesChange);
  if (elements.bookingBrowserLoad) {
    elements.bookingBrowserLoad.addEventListener("click", onBookingBrowserLoadClick);
  }
  if (elements.bookingBrowserRefresh) {
    elements.bookingBrowserRefresh.addEventListener("click", function () {
      if (state.bookingBrowserLoading) return;
      if (state.bookingBrowserFiltersApplied) {
        void onBookingBrowserLoadClick({ refresh: true });
      } else {
        void bootstrapBookings({ preserveLayout: true });
      }
    });
  }
  if (elements.bookingBrowserSizeToggle) {
    elements.bookingBrowserSizeToggle.addEventListener("click", onBookingBrowserSizeToggleClick);
  }
  elements.bookingBrowserPanel.addEventListener("booking-queue-close", function () {
    if (state.bookingBrowserWide) onBookingBrowserSizeToggleClick();
  });
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
  elements.activeMailList.addEventListener("change", onDraftSelectionChange);
  elements.mailSendSelected.addEventListener("click", onSendSelectedDraftsClick);
  elements.mailDeleteSelected.addEventListener("click", onDeleteSelectedDraftsClick);
  elements.mailSelectAllDrafts.addEventListener("change", onSelectAllDraftsChange);
  elements.mailSendDraft.addEventListener("click", onSendDraftClick);
  elements.mailResend.addEventListener("click", onResendClick);
  elements.mailResendEdit.addEventListener("click", onResendEditClick);
  elements.mailForward.addEventListener("click", openForwardDialog);
  elements.mailForwardForm.addEventListener("submit", onForwardSubmit);
  elements.mailForwardCancel.addEventListener("click", closeForwardDialog);
  elements.mailForwardCancelTop.addEventListener("click", closeForwardDialog);
  elements.mailEditDraft.addEventListener("click", onEditCommunicationClick);
  elements.mailEditFromButton.addEventListener("click", function () { openInlineCommunicationEditor("from"); });
  elements.mailEditToButton.addEventListener("click", function () { openInlineCommunicationEditor("to"); });
  elements.mailToContactsButton.addEventListener("click", onSelectSupplierRecipientEmails);
  elements.mailEditCcButton.addEventListener("click", function () { openInlineCommunicationEditor("cc"); });
  elements.mailEditSubjectButton.addEventListener("click", function () { openInlineCommunicationEditor("subject"); });
  elements.mailEditContentButton.addEventListener("click", openCommunicationContentEditor);
  elements.mailAttachmentsButton.addEventListener("click", function () {
    if (state.draftSending || state.draftEditorSaving || state.outlookConfirmOpen) return;
    openCommunicationAttachments(getSelectedCommunicationRecord(), elements.mailAttachmentsButton);
  });
  elements.mailServicesIncluded.addEventListener("click", onMailServicesIncludedClick);
  elements.mailContentEditContextToggle.addEventListener("click", toggleCommunicationContentContext);
  elements.mailContentEditContext.addEventListener("click", onCommunicationContextCopy);
  elements.mailContentEditContext.addEventListener("change", onCommunicationContextChange);
  elements.mailContentEditCancel.addEventListener("click", closeCommunicationContentEditor);
  elements.mailContentEditCancelTop.addEventListener("click", closeCommunicationContentEditor);
  elements.mailContentEditSave.addEventListener("click", saveCommunicationContentEditor);
  elements.mailInlineFromCancel.addEventListener("click", closeInlineCommunicationEditor);
  elements.mailInlineToCancel.addEventListener("click", closeInlineCommunicationEditor);
  elements.mailInlineCcCancel.addEventListener("click", closeInlineCommunicationEditor);
  elements.mailInlineSubjectCancel.addEventListener("click", closeInlineCommunicationEditor);
  elements.mailInlineFromSave.addEventListener("click", saveInlineCommunicationEditor);
  elements.mailInlineToSave.addEventListener("click", saveInlineCommunicationEditor);
  elements.mailInlineCcSave.addEventListener("click", saveInlineCommunicationEditor);
  elements.mailInlineSubjectSave.addEventListener("click", saveInlineCommunicationEditor);
  elements.mailInlineSubjectInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      event.preventDefault();
      saveInlineCommunicationEditor();
    }
  });
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
  elements.mailRecoverCrm?.addEventListener("click", () => recoverCommunicationCrmUpdates(false));
  elements.mailSendRecoverCrm?.addEventListener("click", () => recoverCommunicationCrmUpdates(true));
  elements.createDraftModalClose.addEventListener("click", closeCreateDraftModal);
  elements.createDraftModalEmails.addEventListener("click", function () {
    closeCreateDraftModal();
    state.activeMailTab = "drafts";
    switchTab("emails");
  });
  elements.mailFilterDraft.addEventListener("click", function () { state.emailStatusFilter = "Draft"; clearSelectedMailPreview(); renderEmailsPanel(elements, state); });
  elements.mailFilterSent.addEventListener("click", function () { state.emailStatusFilter = "Sent"; clearSelectedMailPreview(); renderEmailsPanel(elements, state); });
  elements.mailRegenerateDraft.addEventListener("click", onRegenerateDraftClick);
  elements.mailDeleteDraft.addEventListener("click", onDeleteDraftClick);
  elements.draftDeleteConfirmCancel.addEventListener("click", closeDraftDeleteConfirmation);
  elements.draftDeleteConfirmSubmit.addEventListener("click", onConfirmDraftDelete);
  elements.servicesHeadRow.addEventListener("change", onServicesHeadRowChange);
  elements.serviceFilterStatusToggle.addEventListener("click", function (event) {
    onServiceFilterToggleClick("status", event);
  });
  elements.serviceFilterStatusMenu.addEventListener("change", function (event) {
    onServiceMultiFilterChange("status", elements.serviceFilterStatusMenu, event);
  });
  elements.serviceFilterSupplier.addEventListener("change", onServiceSupplierFilterChange);
  elements.hideNonOperationalServices.addEventListener("change", onHideNonOperationalServicesChange);
  elements.serviceFilterCategoryToggle.addEventListener("click", function (event) {
    onServiceFilterToggleClick("category", event);
  });
  elements.serviceFilterCategoryMenu.addEventListener("change", function (event) {
    onServiceMultiFilterChange("category", elements.serviceFilterCategoryMenu, event);
  });
  elements.serviceFilterSubcategoryToggle.addEventListener("click", function (event) {
    onServiceFilterToggleClick("subcategory", event);
  });
  elements.serviceFilterSubcategoryMenu.addEventListener("change", function (event) {
    onServiceMultiFilterChange("subcategory", elements.serviceFilterSubcategoryMenu, event);
  });
  elements.serviceFilterSubdestinationToggle.addEventListener("click", function (event) {
    onServiceFilterToggleClick("subdestination", event);
  });
  elements.serviceFilterSubdestinationMenu.addEventListener("change", function (event) {
    onServiceMultiFilterChange("subdestination", elements.serviceFilterSubdestinationMenu, event);
  });
  elements.serviceFilterDateToggle.addEventListener("click", function (event) {
    onServiceFilterToggleClick("serviceDate", event);
  });
  elements.serviceFilterDateMenu.addEventListener("change", function (event) {
    onServiceMultiFilterChange("serviceDate", elements.serviceFilterDateMenu, event);
  });
  elements.applyBulkStatus.addEventListener("click", onApplyBulkStatus);
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
  elements.fieldPaymentStatus.addEventListener("change", onSelectedServicePaymentStatusChange);
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
  elements.refreshServices?.addEventListener("click", onRefreshServicesClick);
  elements.viewFlat.addEventListener("click", function () {
    setServiceView("flat");
  });
  elements.viewGrouped.addEventListener("click", function () {
    setServiceView("grouped");
  });
  elements.servicesHeadRow.addEventListener("click", function (event) {
    if (event.target.closest("[data-toggle-service-columns]")) {
      onToggleServiceColumnsPanel();
    }
  });
  elements.serviceColumnsBackdrop.addEventListener("click", onToggleServiceColumnsPanel);
  elements.resetServiceColumns.addEventListener("click", onResetServiceColumns);
  elements.serviceColumnsList.addEventListener("change", onServiceColumnsListChange);
  elements.serviceColumnsList.addEventListener("dragstart", onServiceColumnsListDragStart);
  elements.serviceColumnsList.addEventListener("dragover", onServiceColumnsListDragOver);
  elements.serviceColumnsList.addEventListener("drop", onServiceColumnsListDrop);
  elements.serviceColumnsList.addEventListener("dragend", onServiceColumnsListDragEnd);
  document.addEventListener("keydown", onDocumentKeydown);
  document.addEventListener("click", event => {
    const link = event.target.closest("[data-accounting-prepayment]");
    if (!link) return;
    event.preventDefault();
    link.closest("dialog")?.close();
    void openAccountingPrepayment(link.dataset.accountingBooking, link.dataset.accountingPrepayment)
      .catch(error => setError(elements, error.message || "Could not open the prepayment."));
  });
  elements.serviceForm.addEventListener("submit", onSaveService);
}

function openExternalWindow(url, errorMessage) {
  try {
    // noopener can return null even when the tab opens successfully.
    window.open(url, "_blank", "noopener,noreferrer");
  } catch (error) {
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

function getAxusItineraryId(booking, payload) {
  const fieldNames = [
    "Axus_ID",
    "Axus Itinerary ID",
    "Axus_Itinerary_ID",
    "AXUS_Itinerary_ID",
    "Axus_Itinerary_Id",
    "AXUS Itinerary ID"
  ];
  const sources = [payload && payload.axusResponse ? { Axus_ID: payload.axusResponse.itineraryKey } : null, payload, booking];

  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
    const source = sources[sourceIndex] || {};
    for (let fieldIndex = 0; fieldIndex < fieldNames.length; fieldIndex += 1) {
      const value = source[fieldNames[fieldIndex]];
      if ((typeof value === "string" || typeof value === "number") && !/^(?:null|undefined|-)?$/i.test(String(value).trim())) {
        return String(value).trim();
      }
    }

    const matchingFieldName = Object.keys(source).find(function (fieldName) {
      return ["axusitineraryid", "axusid"].includes(String(fieldName).replace(/[^a-z0-9]/gi, "").toLowerCase());
    });
    if (matchingFieldName && ["string", "number"].includes(typeof source[matchingFieldName]) && !/^(?:null|undefined|-)?$/i.test(String(source[matchingFieldName]).trim())) {
      return String(source[matchingFieldName]).trim();
    }
  }

  return "";
}

function getCreatedAxusItineraryUrl() {
  const itineraryId = getAxusItineraryId(state.selectedBooking, state.axusCreationPayload);
  return itineraryId ? "https://axustravelapp.com/admin/itinerary/" + encodeURIComponent(itineraryId) : getItineraryLinkValue(state.selectedBooking);
}

function wait(milliseconds) {
  return new Promise(function (resolve) {
    window.setTimeout(resolve, milliseconds);
  });
}

async function waitForAxusItineraryLink(bookingId, payload) {
  const returnedId = getAxusItineraryId(null, payload);
  if (returnedId) {
    return returnedId;
  }

  elements.axusItineraryDialogTitle.textContent = "Preparing itinerary";
  elements.axusItineraryDialogMessage.textContent = "AXUS is generating the itinerary linkâ€¦";

  for (let attempt = 0; attempt < AXUS_ITINERARY_SYNC_ATTEMPTS; attempt += 1) {
    await wait(AXUS_ITINERARY_SYNC_INTERVAL_MS);

    try {
      const refreshedBooking = await crmGetRecord(MODULES.bookings, bookingId);
      const itineraryId = getAxusItineraryId(refreshedBooking, null);
      if (itineraryId) {
        return itineraryId;
      }
    } catch (error) {
      // Keep waiting: the AXUS workflow may still be updating the booking record.
    }
  }

  return "";
}

async function saveCreatedAxusItineraryLink(bookingId, payload) {
  const itineraryId = await waitForAxusItineraryLink(bookingId, payload);
  if (!itineraryId) {
    throw new Error("The AXUS itinerary ID was not returned or found in the booking. Axus_Link could not be saved.");
  }
  const itineraryUrl = "https://axustravelapp.com/admin/itinerary/" + encodeURIComponent(itineraryId);
  try {
    const result = await crmUpdateRecord(MODULES.bookings, { id: bookingId, Axus_Link: itineraryUrl });
    const errorDetails = getFunctionPayloadErrorDetails(result);
    if (errorDetails) throw buildFunctionPayloadError(errorDetails);
    if (!result || String(result.code || "").toLowerCase() !== "success") {
      throw new Error("CRM did not confirm the link update.");
    }
  } catch (error) {
    throw new Error("The AXUS itinerary was created, but Axus_Link could not be saved. " + (error.message || ""));
  }
  if (String(state.selectedBookingId) === bookingId) {
    state.axusCreationPayload = { ...payload, Axus_ID: itineraryId };
  }
  return itineraryUrl;
}

function showAxusItineraryDialog() {
  elements.axusItineraryDialog.hidden = false;
  elements.axusItinerarySpinner.hidden = false;
  elements.axusItineraryDialogEyebrow.textContent = "AXUS itinerary";
  elements.axusItineraryDialogTitle.textContent = "Creating itinerary";
  elements.axusItineraryDialogMessage.textContent = "Creating the AXUS itineraryâ€¦";
  elements.axusItineraryDialogActions.hidden = true;
}

function showAxusItinerarySuccess() {
  const itineraryUrl = getCreatedAxusItineraryUrl();
  elements.axusItinerarySpinner.hidden = true;
  elements.axusItineraryDialogEyebrow.textContent = "Ready";
  elements.axusItineraryDialogTitle.textContent = "Itinerary created successfully";
  elements.axusItineraryDialogMessage.textContent = "The AXUS itinerary is ready.";
  elements.axusItineraryDialogOpen.hidden = false;
  elements.axusItineraryDialogOpen.disabled = !itineraryUrl;
  elements.axusItineraryDialogActions.hidden = false;
}

function showAxusItineraryError(message) {
  elements.axusItineraryDialog.hidden = false;
  elements.axusItinerarySpinner.hidden = true;
  elements.axusItineraryDialogEyebrow.textContent = "AXUS itinerary";
  elements.axusItineraryDialogTitle.textContent = "Could not create the itinerary";
  elements.axusItineraryDialogMessage.textContent = message;
  elements.axusItineraryDialogOpen.hidden = true;
  elements.axusItineraryDialogActions.hidden = false;
}

function onCloseAxusItineraryDialog() {
  if (state.creatingAxusItinerary) {
    return;
  }
  elements.axusItineraryDialog.hidden = true;
}

function onOpenCreatedAxusItinerary() {
  const itineraryUrl = getCreatedAxusItineraryUrl();
  if (!itineraryUrl) {
    showAxusItineraryError("The AXUS itinerary link is not available yet.");
    return;
  }
  openExternalWindow(itineraryUrl, "The AXUS itinerary could not be opened. Please allow pop-ups for this page.");
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

  const booking = state.selectedBooking;
  const bookingId = String(state.selectedBookingId);
  const workspaceRequestId = state.bookingWorkspaceRequestId;
  const isCurrent = () => state.selectedBooking === booking && String(state.selectedBookingId) === bookingId && state.bookingWorkspaceRequestId === workspaceRequestId;
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
  if (saveButton.disabled) return;
  saveButton.disabled = true;
  setError(elements, "");

  try {
    await crmUpdateRecord(MODULES.bookings, {
      id: bookingId,
      Axus_Link: itineraryLink
    }, { expectedRecord: booking });
    if (!isCurrent()) return;
    booking.Axus_Link = itineraryLink;
    elements.actionItineraryForm.hidden = true;
    elements.actionItineraryLink.classList.remove("is-editing");
    elements.actionItineraryEdit.textContent = "Edit";
    renderBookingWorkspace(elements, state);
    setNotice(elements, "");
  } catch (error) {
    if (isCurrent()) setError(elements, error && error.message ? error.message : "The itinerary link could not be saved.");
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
  if (linkKey === "prepayments") {
    state.activePaymentTab = "prepayments";
    switchTab("payments");
    return;
  }
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
  if (state.recordEditingLocksActive) void recordEditLocks.releaseAll();
  state.recordEditingLocksActive = false;
  state.serviceEditLeaseId = "";
  state.bookingSearchRequestId = (state.bookingSearchRequestId || 0) + 1;
  state.bookingWorkspaceRequestId = (state.bookingWorkspaceRequestId || 0) + 1;
  state.activeTab = "services";
  state.activePaymentTab = "travelers";
  state.summaryView = "basic";
  state.serviceDetailTab = "basic";
  state.activeMailTab = "drafts";
  state.collapsedStepIds = {};
  state.cardPurchaseSupportingDocuments = [];
  state.bookingWorkspaceLoadingLabel = "";
  onCloseBookingReportDialog();
  onCloseCardPurchaseDialog();
  resetTravelersState();
  state.cardPurchases = [];
  state.cardPurchasesLoading = false;
  state.cardPurchasesLoaded = false;
  state.cardPurchasesLoadedBookingId = "";
  state.cardPurchasesError = "";
  state.selectedBookingId = "";
  elements.operationRecovery?.dispatchEvent(new CustomEvent("booking-recovery-reset"));
  state.prepaymentsData = null;
  state.selectedBooking = null;
  automaticNotifications.reset();
  bookingTasks.reset();
  bookingDocuments.reset();
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

function canLeaveBookingWorkspace() {
  if (!state.selectedBookingId) return true;
  try {
    if (bookingTasks.hasPendingChanges?.()) throw new Error("Task edits are pending.");
    assertEzusSyncEditsSaved(state, elements, state.selectedBookingId, bookingDocuments);
    return true;
  } catch (_) {
    if (state.selectedBooking) elements.bookingSearch.value = buildBookingLabel(state.selectedBooking);
    setError(elements, "Save or cancel your pending changes before changing, reloading or closing this booking.");
    return false;
  }
}

function setSummaryView(viewName) {
  state.summaryView = viewName;
  renderBookingSummary(elements, state);

  if (viewName === "travelers") {
    ensureBookingTravelersLoaded();
  }


}

function onBookingBrowserOwnerChange() {
  state.bookingBrowserPendingOwnerId = elements.bookingBrowserOwner.value || "";
  renderBookingBrowserPanel();
}

function onBookingBrowserSearchByChange() {
  state.bookingBrowserSearchField = elements.bookingBrowserSearchBy.value || "booking_owner";
  state.bookingBrowserFiltersApplied = false;
  renderBookingBrowserPanel();
}

function onBookingBrowserSizeToggleClick() {
  state.bookingBrowserWide = !state.bookingBrowserWide;
  renderBookingWorkspace(elements, state);
  renderBookingBrowserPanel();
}

function onBookingBrowserCollapseToggleClick() {
  if (state.bookingBrowserWide && !state.bookingBrowserCollapsed) {
    onBookingBrowserSizeToggleClick();
    return;
  }
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

async function onBookingBrowserLoadClick(options) {
  const refreshing = Boolean(options && options.refresh);
  if (state.bookingBrowserLoading) return;
  state.bookingBrowserError = "";
  if (!refreshing) {
    state.bookingBrowserOwnerId = String(state.bookingBrowserPendingOwnerId || "").trim();
    state.bookingBrowserStages = mergeUniqueTextValues(state.bookingBrowserPendingStages || []);
    state.bookingBrowserFiltersApplied = Boolean(state.bookingBrowserOwnerId && state.bookingBrowserStages.length);
  }
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
      state.bookingBrowserStages,
      state.bookingBrowserSearchField
    );
    const hydratedRecords = await hydrateBookingRecordsIfNeeded(records);
    const normalizedRecords = hydratedRecords.map(normalizeBookingCandidate);

    state.bookingBrowserRawDebugSamples = hydratedRecords
      .slice(0, 5)
      .map(summarizeRawBookingDebugRecord);
    state.bookings = normalizedRecords;
    indexBookings(state, normalizedRecords);
    syncBookingBrowserOwnerFilter(normalizedRecords);
    if (!refreshing && !(options && options.preserveLayout)) {
      state.bookingBrowserCollapsed = false;
      state.bookingBrowserWide = true;
    }
    renderBookingBrowserPanel();

    state.initialized = true;
    renderBookingWorkspace(elements, state);
  } catch (error) {
    state.bookingBrowserError = [error.code, error.message || "Could not load bookings for the selected owner and stages."].filter(Boolean).join(": ");
    setError(elements, state.bookingBrowserError);
  } finally {
    state.initialized = true;
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
    return;
  }

  if (event.key === "Escape" && state.workspaceFocusMode) {
    toggleWorkspaceFocusMode();
  }
}

function toggleWorkspaceFocusMode() {
  if (!state.selectedBooking) {
    return;
  }

  state.workspaceFocusMode = !state.workspaceFocusMode;
  elements.bookingMainShell.classList.toggle("is-workspace-focus", state.workspaceFocusMode);
  elements.toggleWorkspaceFocus.setAttribute("aria-pressed", String(state.workspaceFocusMode));
  elements.toggleWorkspaceFocus.setAttribute("title", state.workspaceFocusMode ? "Exit focus workspace" : "Focus workspace");
  elements.toggleWorkspaceFocus.setAttribute("aria-label", state.workspaceFocusMode ? "Exit focus workspace" : "Focus workspace");
}

function onMailServicesIncludedClick(event) {
  const summary = event.target && event.target.closest ? event.target.closest(".mail-services-summary") : null;
  const panel = elements.mailServicesIncluded;

  if (!summary || !panel) {
    return;
  }

  event.preventDefault();
  if (panel._closeTimer) {
    window.clearTimeout(panel._closeTimer);
    panel._closeTimer = null;
  }

  if (!panel.open) {
    panel.classList.remove("is-closing");
    panel.open = true;
    return;
  }

  panel.classList.add("is-closing");
  panel._closeTimer = window.setTimeout(function () {
    panel.open = false;
    panel.classList.remove("is-closing");
    panel._closeTimer = null;
  }, 180);
}

async function onActiveMailListClick(event) {
  if (event.target.closest("[data-draft-select]")) return;
  if (state.draftEditorSaving || state.communicationContentEditorOpen) return;
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
  state.pendingDraftBatchDeletion = null;
  elements.draftDeleteConfirmTitle.textContent = "Delete this draft?";
  elements.draftDeleteConfirmDescription.textContent = "This permanently deletes the communication draft and its associated services. This action cannot be undone.";
  elements.draftDeleteConfirmSubmit.textContent = "Delete draft";
  state.draftDeleteConfirmOpen = true;
  elements.draftDeleteConfirmModal.hidden = false;
  renderEmailsPanel(elements, state);
}

async function onRegenerateDraftClick() {
  if (state.activeMailTab !== "drafts" || !state.selectedBookingId || !state.selectedDraftRecordId || state.draftEditorSaving) {
    return;
  }

  const selectedRecord = getSelectedCommunicationRecord();
  const communicationId = String(selectedRecord && selectedRecord.communication_id || "").trim();
  if (!communicationId) {
    setError(elements, "The selected draft is not linked to a Communication.");
    return;
  }

  const previousDraftId = state.selectedDraftRecordId;
  const previousBookingId = state.selectedBookingId;
  if (!await confirmRegeneration()) return;
  if (state.selectedBookingId !== previousBookingId || state.selectedDraftRecordId !== previousDraftId || state.draftEditorSaving) return;
  state.draftEditorSaving = true;
  setError(elements, "");
  setNotice(elements, "");
  showSendModal("Regenerating draft...", false, true);
  renderSelectedMailContent(elements, state);

  try {
    const response = await crmExecuteFunction("comm_regeneratedraftforcommunication", {
      communicationId: communicationId
    });
    const payload = extractFunctionPayload(response);
    const errorDetails = getFunctionPayloadErrorDetails(payload);
    if (errorDetails) {
      throw buildFunctionPayloadError(errorDetails);
    }

    delete state.mailContentByKey[getMailCacheKey("drafts", previousDraftId)];
    state.draftEditorOpen = false;
    state.draftEditorFields = null;
    state.draftEditorMode = "visual";
    await ensureBookingEmailsLoaded(true, { contentOnly: true });

    const regeneratedRecord = state.emailDrafts.find(function (record) {
      return String(record && record.communication_id || "") === communicationId;
    });
    if (regeneratedRecord) {
      const regeneratedDraftId = String(regeneratedRecord.draft_id || regeneratedRecord.id || "").trim();
      if (regeneratedDraftId) {
        state.selectedDraftRecordId = regeneratedDraftId;
        state.mailContentByKey[getMailCacheKey("drafts", regeneratedDraftId)] = Object.assign({}, regeneratedRecord);
      }
    }

    showSendModal(getFunctionSuccessMessage(payload) || "Draft regenerated successfully.", false);
    setTimeout(closeSendModal, 900);
  } catch (error) {
    showSendModal(error.message || "Could not regenerate the selected draft.", true);
  } finally {
    state.draftEditorSaving = false;
    renderSelectedMailContent(elements, state);
  }
}

function closeDraftDeleteConfirmation() {
  state.pendingDraftBatchDeletion = null;
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
  const batch = state.pendingDraftBatchDeletion;
  closeDraftDeleteConfirmation();
  if (batch) await deleteDraftBatch(batch);
  else await deleteSelectedDraft("Communication deleted successfully.");
}

function onDeleteSelectedDraftsClick() {
  if (!state.selectedBookingId || state.draftEditorSaving || state.draftBatchSending || state.draftEditorOpen || state.communicationContentEditorOpen || state.emailStatusFilter === "Sent") return;
  const ids = Object.keys(state.selectedDraftIds || {});
  if (!ids.length) return;
  const drafts = ids.map(id => {
    const record = findMailRecordById(state.emailDrafts, "drafts", id);
    return { draftId: id, communicationId: String(record?.communication_id || ""), status: String(record?.communication_status || "Draft").toLowerCase() };
  });
  if (drafts.some(draft => !draft.communicationId || draft.status !== "draft")) {
    setError(elements, "Select only unsent drafts linked to a Communication. Refresh the list and try again.");
    return;
  }
  state.pendingDraftBatchDeletion = { bookingId: String(state.selectedBookingId), drafts };
  state.draftDeleteConfirmOpen = true;
  elements.draftDeleteConfirmTitle.textContent = "Delete " + ids.length + (ids.length === 1 ? " selected draft?" : " selected drafts?");
  elements.draftDeleteConfirmDescription.textContent = "This permanently deletes the selected communications, their drafts and their associated communication-service links. This action cannot be undone.";
  elements.draftDeleteConfirmSubmit.textContent = "Delete " + ids.length + (ids.length === 1 ? " draft" : " drafts");
  elements.draftDeleteConfirmModal.hidden = false;
  elements.draftDeleteConfirmCancel.focus();
  renderEmailsPanel(elements, state);
}

async function deleteDraftBatch(batch) {
  if (String(state.selectedBookingId) !== batch.bookingId || state.draftEditorSaving || state.draftBatchSending) return;
  // Validate the captured selection again; confirmation never expands its scope.
  if (batch.drafts.some(draft => {
    const record = findMailRecordById(state.emailDrafts, "drafts", draft.draftId);
    return !record || String(record.communication_id || "") !== draft.communicationId || String(record.communication_status || "Draft").toLowerCase() !== "draft";
  })) {
    setError(elements, "The selected drafts changed. Refresh the list and select them again.");
    return;
  }
  state.draftEditorSaving = true;
  state.draftBatchSending = true;
  renderEmailsPanel(elements, state);
  setError(elements, "");
  const deleted = new Set();
  let deletedCount = 0;
  try {
    for (const draft of batch.drafts) {
      if (String(state.selectedBookingId) !== batch.bookingId) throw new Error("Booking changed. Remaining drafts were not deleted.");
      showSendModal("Deleting draft " + (deletedCount + 1) + " of " + batch.drafts.length + "â€¦", false);
      if (!deleted.has(draft.communicationId)) {
        const response = await crmExecuteFunction("comm_deletecommunication", { communicationId: draft.communicationId });
        const payload = extractFunctionPayload(response);
        if (!payload || (typeof payload === "object" && Object.keys(payload).length === 0)) throw new Error("CRM did not confirm the deletion.");
        const errorDetails = getFunctionPayloadErrorDetails(payload);
        if (errorDetails) throw buildFunctionPayloadError(errorDetails);
        deleted.add(draft.communicationId);
      }
      deletedCount++;
      if (String(state.selectedBookingId) !== batch.bookingId) continue;
      const relatedIds = state.emailDrafts.filter(record => String(record.communication_id || "") === draft.communicationId).map((record, index) => getMailRecordId(record, index, "drafts"));
      relatedIds.forEach(id => {
        removeMailRecordFromCollection(state.emailDrafts, "drafts", id);
        delete state.selectedDraftIds[id];
        delete state.mailContentByKey[getMailCacheKey("drafts", id)];
        if (state.selectedDraftRecordId === id) state.selectedDraftRecordId = "";
      });
    }
    showSendModal(deletedCount + " drafts deleted.", false);
    elements.mailSendSpinner.hidden = true;
    elements.mailSendModalClose.hidden = false;
  } catch (error) {
    showSendModal(deletedCount + " of " + batch.drafts.length + " drafts deleted. " + (error.message || "Deletion failed.") + " Remaining drafts are still selected.", true);
  } finally {
    state.draftEditorSaving = false;
    state.draftBatchSending = false;
    renderEmailsPanel(elements, state);
  }
}







async function onRefreshBookingMailsClick() {
  if (!state.selectedBookingId || state.emailsLoading || state.draftEditorSaving) {
    return;
  }

  clearSelectedMailPreview();
  await ensureBookingEmailsLoaded(true);
  renderEmailsPanel(elements, state);
}



async function bootstrapBookings(options) {
  state.bookingBrowserError = "";
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
    if (!options || !options.preserveLayout) {
      state.bookingBrowserCollapsed = false;
      state.bookingBrowserWide = true;
    }
    renderBookingBrowserPanel();

    setNotice(elements, "");

    state.initialized = true;
    renderBookingWorkspace(elements, state);
  } catch (error) {
    state.bookingBrowserError = [error.code, error.message || "Could not load bookings from Zoho CRM."].filter(Boolean).join(": ");
    setError(elements, state.bookingBrowserError);
  } finally {
    state.initialized = true;
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
    await onBookingBrowserLoadClick({ preserveLayout: true });
    return;
  }

  await bootstrapBookings({ preserveLayout: true });
}

async function loadBookingsForBrowserFilters(ownerId, stages, searchField) {
  const normalizedOwnerId = String(ownerId || "").trim();
  const normalizedStages = mergeUniqueTextValues(stages || []);

  if (!normalizedOwnerId || !normalizedStages.length) {
    return [];
  }

  const ownerFieldApiName = resolveBookingSearchCriteriaField(
    searchField,
    state.bookingModuleFieldApiNames
  );
  const stageFieldApiName = resolveBookingStageCriteriaField(
    state.bookingModuleFieldApiNames,
    state.bookingStageFieldApiName
  );
  const escapedOwnerId = escapeCriteriaValue(normalizedOwnerId);
  const combinedResults = [];
  state.bookingBrowserQueryDebug = { ownerField: ownerFieldApiName, ownerId: normalizedOwnerId, stageField: stageFieldApiName, stages: normalizedStages.slice(), received: 0 };

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
      state.bookingBrowserQueryDebug.received = combinedResults.length;

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
  if (!Array.isArray(records)) throw new Error("CRM did not return a valid booking list.");
  if (!records.length) {
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
  const hasSyncFields = records.every(function (booking) {
    return Object.prototype.hasOwnProperty.call(booking, "Ezus_Project_ID") ||
      Object.prototype.hasOwnProperty.call(booking, "Last_Ezus_Sync_At") ||
      Object.prototype.hasOwnProperty.call(booking, "Last_EZUS_Sync_At");
  });
  if (hasOwnerValues && hasStageValues && hasSyncFields) {
    return records;
  }

  const detailedRecords = await Promise.all(records.map(async function (record) {
    if (!record || !record.id) {
      throw new Error("CRM returned a booking without a valid ID. The search result could not be confirmed.");
    }

    try {
      const fresh = await crmGetRecord(MODULES.bookings, record.id);
      if (String(fresh?.id || "") !== String(record.id)) throw new Error("CRM did not confirm the booking details.");
      return fresh;
    } catch (error) {
      const failure = new Error("Could not load all booking details. " + (error.message || "Check access and try again."));
      failure.code = error.code;
      failure.cause = error;
      throw failure;
    }
  }));

  return detailedRecords;
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
  const currentUserEmail = normalizeComparableText(state.currentUserEmail || "");
  const currentUserId = String(state.currentUserId || "");
  const currentUserName = normalizeComparableText(state.currentUserName || "");

  if (!currentUserId && !currentUserName && !currentUserEmail) {
    return "";
  }

  for (var index = 0; index < (ownerOptions || []).length; index += 1) {
    var ownerOption = ownerOptions[index];

    if (!ownerOption || !ownerOption.value) {
      continue;
    }

    // User_Relationships.Email is the canonical match for the logged-in user.
    if (currentUserEmail && normalizeComparableText(ownerOption.email || "") === currentUserEmail) {
      return ownerOption.value;
    }

    if (currentUserId && String(ownerOption.value) === currentUserId) {
      return ownerOption.value;
    }

    if (currentUserName && normalizeComparableText(ownerOption.label || "") === currentUserName) {
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
        "Status",
        "User_Alias",
        "User_ID",
        "Email",
        "Profile",
        "Booking_Tag_Catalog_JSON",
        "Role",
        "Sales_Rep",
        "Reservations_Rep",
        "Accounting_Rep",
        "Guest_Relations_Rep",
        "Hour_Rep"
      ].join(",")
    );
    const ownerOptions = buildOwnerOptionsFromUserRelationships(relationshipRecords);

    if (typeof console !== "undefined" && typeof console.info === "function") {
      console.info("[Reservations Manager] owner load", {
        relationshipRecords: relationshipRecords.length,
        ownerOptions: ownerOptions.length
      });
    }

    state.bookingBrowserOwnerOptions = ownerOptions;
    state.bookingTagRelationships = relationshipRecords;
    const currentUserRelationship = findCurrentUserRelationshipRecord(relationshipRecords);
    state.currentUserRelationshipRecordId = currentUserRelationship ? String(currentUserRelationship.id) : "";
    state.currentUserRelationshipUserId = currentUserRelationship ? String(currentUserRelationship.User_ID) : "";
    state.currentUserIsAdministrator = getWidgetPermissions(state).adminActions;
    state.currentUserRelationshipProfile = currentUserRelationship ? getUserRelationshipProfile(currentUserRelationship) : "";
    bookingDocuments.sync();
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
          Status: record.Status || "",
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
    state.currentUserRelationshipProfile = "";
    state.bookingTagRelationships = [];
    bookingDocuments.sync();
    state.bookingBrowserOwnerDebug = {
      source: "User_Relationships",
      error: error && error.message ? error.message : String(error)
    };
    renderBookingBrowserPanel();
    renderBookingWorkspace(elements, state);
  }
}

async function sendCommunicationOnce(args) {
  const deliveryCheck = "Delivery could not be confirmed. Check your mailbox (including any CC copy) and this Communication in CRM before sending again. No automatic retry will be made.";
  const bookingId = String(state.selectedBookingId || "");
  const workspaceRequestId = state.bookingWorkspaceRequestId;
  state.communicationSendAttempts ||= {};
  const key = String(args.communicationId);
  const reviewedRecord = (state.emailDrafts || []).find(record => String(record.communication_id) === key);
  if (reviewedRecord?.service_links_valid === false || reviewedRecord?.send_blocked) throw new Error("This Communication has service links that need review in CRM. Other valid drafts can still be used.");
  if (state.communicationEditRecoveries?.[key]) throw new Error("Email content was saved, but service links still need confirmation. Open Edit and recover the service links before sending.");
  if (state.communicationSendAttempts[key]) {
    throw new Error(state.communicationSendAttempts[key] === "sent"
      ? "This email was already sent. Do not resend it."
      : deliveryCheck);
  }
  state.communicationSendAttempts[key] = "pending";
  let payload;
  try {
    payload = extractFunctionPayload(await crmExecuteFunction("comm_sendcommunicationdraft", args));
  } catch (_) {
    throw new Error(deliveryCheck);
  }
  const details = getFunctionPayloadErrorDetails(payload);
  if (payload?.delivery_status !== "sent" && (details || payload?.success !== true || payload?.delivery_status === "unknown")) {
    // Only a server-confirmed pre-send rejection is safe to retry.
    if (payload?.success === false && payload?.delivery_status === "not_sent") delete state.communicationSendAttempts[key];
    throw new Error(state.communicationSendAttempts[key]
      ? deliveryCheck
      : (details?.message || payload?.message || "The email was not sent. Review the Communication before retrying."));
  }
  state.communicationSendAttempts[key] = "sent";
  state.communicationCrmRecovery ||= {};
  if (payload.reconciliation_required === true) {
    if (payload.recovery_available === true) state.communicationCrmRecovery[key] = bookingId;
    payload.warning = payload.warning || "Email sent; CRM update pending. Do not resend.";
  } else if (payload.reconciliation_required === false) {
    delete state.communicationCrmRecovery[key];
  }
  try {
    await refreshCommunicationServices(bookingId, workspaceRequestId, payload.updated_booking_service_ids);
  } catch (error) {
    payload.warning = [payload.warning, "Email sent. Do not resend. Could not refresh services: " + (error.message || "Please refresh the services list.")].filter(Boolean).join(" ");
  }
  return payload;
}

async function refreshCommunicationServices(bookingId, workspaceRequestId, updatedServiceIds) {
  const isCurrent = () => String(state.selectedBookingId || "") === bookingId && state.bookingWorkspaceRequestId === workspaceRequestId;
  if (!bookingId || !isCurrent()) return;
  const services = await loadBookingServicesForBooking(bookingId);
  if (!isCurrent()) return;
  // CRM search indexing can lag behind the writes confirmed by the send function.
  const confirmedIds = new Set(Array.isArray(updatedServiceIds) ? updatedServiceIds.map(String) : []);
  services.forEach(service => { if (confirmedIds.has(String(service.id))) service.Status_EZUS = "On Request"; });
  state.services = services.sort((a, b) => String(a.Service_Date || "").localeCompare(String(b.Service_Date || "")) || String(a.Name || "").localeCompare(String(b.Name || "")));
  state.selectedService = services.find(service => String(service.id) === String(state.selectedServiceId)) || null;
  applyServiceFilter();
  renderSelectionPanel(elements, state);
  renderBookingSummary(elements, state);
}

async function onSendDraftClick() {
  if (
    state.activeMailTab !== "drafts" ||
    !state.selectedBookingId ||
    !state.selectedDraftRecordId ||
    state.draftEditorSaving || state.draftBatchSending || state.draftSending || state.communicationCrmRecoveryBusy ||
    state.draftEditorOpen || state.communicationContentEditorOpen
  ) {
    return;
  }

  const draftId = state.selectedDraftRecordId;
  const bookingId = String(state.selectedBookingId);
  const isCurrent = () => String(state.selectedBookingId) === bookingId;
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
  showSendModal("Sending emailâ€¦", false);
  setError(elements, "");
  setNotice(elements, "");
  renderEmailsPanel(elements, state);

  try {
    // The draft only stores rendered HTML. Communication remains the source
    // of truth for To, CC and the sender selected by the user.
    const payload = await sendCommunicationOnce({
      communicationId: communicationId,
      draftId: draftId,
      fromEmail: fromEmail,
      actingUserEmail: fromEmail
    });
    selectedCommunication.communication_status = "Sent";
    if (!isCurrent()) return;

    // Communication drafts are retained. Reload so the viewer keeps showing
    // the latest stored draft instead of treating a sent email as deleted.
    delete state.mailContentByKey[cacheKey];
    try {
      await ensureBookingEmailsLoaded(true);
    } catch (error) {
      throw new Error((payload.warning ? payload.warning + " " : "") + (error.message || "Could not refresh communications."));
    }
    if (!isCurrent()) return;
    state.selectedDraftRecordId = "";
    state.draftEditorOpen = false;
    state.draftEditorFields = null;
    state.draftEditorMode = "visual";
    state.outlookConfirmOpen = false;
    state.draftDeleteConfirmOpen = false;
    elements.draftDeleteConfirmModal.hidden = true;
    if (!isCurrent()) return;
    showSendModal(payload.warning || "Email sent successfully.", Boolean(payload.warning));
    if (!payload.warning) setTimeout(closeSendModal, 900);
  } catch (error) {
    if (!isCurrent()) return;
    setNotice(elements, "");
    showSendModal((state.communicationSendAttempts?.[communicationId] === "sent" ? "Email sent, but refreshing the workspace failed. Do not resend. " : "") +
      (error.message || "Could not send the selected draft."), true);
  } finally {
    state.draftSending = false;
    state.draftEditorSaving = false;
    renderEmailsPanel(elements, state);
  }
}

function onDraftSelectionChange(event) {
  const checkbox = event.target.closest("[data-draft-select]");
  if (!checkbox || state.draftEditorSaving || state.draftBatchSending) return;
  state.selectedDraftIds ||= {};
  if (checkbox.checked) state.selectedDraftIds[checkbox.dataset.draftSelect] = true;
  else delete state.selectedDraftIds[checkbox.dataset.draftSelect];
  renderEmailsPanel(elements, state);
}

function onSelectAllDraftsChange(event) {
  if (state.draftEditorSaving || state.draftBatchSending) return;
  state.selectedDraftIds = {};
  if (event.target.checked) elements.activeMailList.querySelectorAll("[data-draft-select]").forEach(checkbox => { state.selectedDraftIds[checkbox.dataset.draftSelect] = true; });
  renderEmailsPanel(elements, state);
}

async function onSendSelectedDraftsClick() {
  if (!state.selectedBookingId || state.communicationCrmRecoveryBusy || state.draftEditorSaving || state.draftBatchSending || state.draftEditorOpen || state.communicationContentEditorOpen || state.emailStatusFilter === "Sent") return;
  const bookingId = String(state.selectedBookingId);
  const ids = Object.keys(state.selectedDraftIds || {});
  if (!ids.length) return;
  const drafts = [];
  const sendWarnings = [];
  for (const draftId of ids) {
    const record = findMailRecordById(state.emailDrafts, "drafts", draftId);
    const communicationId = String(record?.communication_id || "").trim();
    const fromEmail = String(record && (record.from || record.Sender_Email) || "").trim();
    if (!record || String(record.communication_status || "Draft").toLowerCase() !== "draft" || !communicationId || !fromEmail) {
      setError(elements, "Every selected draft must be unsent and have a Communication and Sender Email. Refresh or edit the draft before sending.");
      return;
    }
    drafts.push({ draftId, communicationId, fromEmail, record });
  }
  state.draftBatchSending = true;
  state.draftEditorSaving = true;
  state.draftSending = true;
  setError(elements, "");
  setNotice(elements, "");
  renderEmailsPanel(elements, state);
  try {
    const result = await sendDraftBatch(drafts, {
      isCurrent: () => String(state.selectedBookingId) === bookingId,
      onProgress: (index, total) => showSendModal("Sending draft " + index + " of " + total + "â€¦", false),
      send: async draft => {
        const sent = await sendCommunicationOnce({
          communicationId: draft.communicationId, draftId: draft.draftId,
          fromEmail: draft.fromEmail, actingUserEmail: draft.fromEmail
        });
        if (sent.warning) sendWarnings.push(sent.warning);
      },
      onSent: draft => {
        draft.record.communication_status = "Sent";
        if (String(state.selectedBookingId) !== bookingId) return;
        delete state.selectedDraftIds[draft.draftId];
        delete state.mailContentByKey[getMailCacheKey("drafts", draft.draftId)];
      }
    });
    const summary = result.sentIds.length + " of " + drafts.length + " drafts confirmed sent." +
      (sendWarnings.length ? " " + sendWarnings.join(" ") : "");
    if (result.error) {
      showSendModal(summary + " Sending stopped: " + (result.error.message || "Could not confirm the send.") + " Check the failed draft before retrying. Remaining drafts are still selected.", true);
    } else {
      showSendModal(summary, sendWarnings.length > 0);
      elements.mailSendSpinner.hidden = true;
      elements.mailSendModalClose.hidden = false;
      if (String(state.selectedBookingId) === bookingId) {
        try { await ensureBookingEmailsLoaded(true); }
        catch (error) { showSendModal(summary + " Could not refresh the list: " + error.message, true); }
      }
    }
  } finally {
    state.draftBatchSending = false;
    state.draftEditorSaving = false;
    state.draftSending = false;
    renderEmailsPanel(elements, state);
  }
}

function showSendModal(message, isError, draftLoading = false) {
  stopDraftLoading(elements.mailSendModal);
  elements.mailSendModal.hidden = false;
  elements.mailSendSpinner.hidden = Boolean(isError);
  elements.mailSendModalMessage.textContent = message;
  elements.mailSendModalMessage.classList.toggle("is-error", Boolean(isError));
  elements.mailSendModalClose.hidden = !isError;
  if (elements.mailSendRecoverCrm) {
    elements.mailSendRecoverCrm.hidden = !isError || !Object.values(state.communicationCrmRecovery || {}).includes(String(state.selectedBookingId));
  }
  if (draftLoading && !isError) startDraftLoading(elements.mailSendModal, elements.mailSendSpinner);
}

function closeSendModal() {
  stopDraftLoading(elements.mailSendModal);
  elements.mailSendModal.hidden = true;
}

async function recoverCommunicationCrmUpdates(fromModal = false) {
  if (state.communicationCrmRecoveryBusy || state.draftSending || state.draftEditorSaving || state.draftEditorOpen || state.communicationContentEditorOpen) return;
  const bookingId = String(state.selectedBookingId || "");
  const workspaceRequestId = state.bookingWorkspaceRequestId;
  const record = fromModal ? null : getSelectedCommunicationRecord();
  const ids = fromModal
    ? Object.keys(state.communicationCrmRecovery || {}).filter(id => state.communicationCrmRecovery[id] === bookingId)
    : [String(record?.communication_id || "")].filter(Boolean);
  if (!bookingId || !ids.length) return;
  const isCurrent = () => String(state.selectedBookingId) === bookingId && state.bookingWorkspaceRequestId === workspaceRequestId;
  state.communicationCrmRecoveryBusy = true;
  [elements.mailRecoverCrm, elements.mailSendRecoverCrm].forEach(button => { if (button) button.disabled = true; });
  showSendModal("Updating CRM only. No email will be sent.", false);
  let pending = false;
  try {
    for (const communicationId of ids) {
      if (!isCurrent()) return;
      const payload = extractFunctionPayload(await crmExecuteFunction("comm_reconcilecommunicationdelivery", { communicationId }));
      if (payload?.delivery_status !== "sent" || payload?.success !== true) throw new Error(payload?.message || "CRM recovery could not be confirmed. No email was sent by this action.");
      state.communicationSendAttempts ||= {};
      state.communicationSendAttempts[communicationId] = "sent";
      state.communicationCrmRecovery ||= {};
      if (payload.reconciliation_required === true) {
        state.communicationCrmRecovery[communicationId] = bookingId;
        pending = true;
      } else if (payload.reconciliation_required === false) {
        delete state.communicationCrmRecovery[communicationId];
      } else throw new Error("CRM recovery returned an incomplete result. Refresh before continuing.");
      await refreshCommunicationServices(bookingId, workspaceRequestId, payload.updated_booking_service_ids);
    }
    if (!isCurrent()) return;
    await ensureBookingEmailsLoaded(true);
    if (isCurrent()) showSendModal(pending ? "Email sent; some CRM updates are still pending. Services changed since sending require review in CRM. Do not resend." : "CRM updates completed. No email was sent again.", true);
  } catch (error) {
    if (isCurrent()) showSendModal("CRM recovery could not be completed. No email was sent by this action. " + (error.message || "Refresh and try again."), true);
  } finally {
    state.communicationCrmRecoveryBusy = false;
    [elements.mailRecoverCrm, elements.mailSendRecoverCrm].forEach(button => { if (button) button.disabled = false; });
  }
}

async function onResendClick() {
  await createFollowUpDraft("Resend", "", "", "", true);
}

async function onResendEditClick() {
  await createFollowUpDraft("Resend", "", "", "", false);
}

function openForwardDialog() {
  const record = getSelectedCommunicationRecord();
  if (!record || String(record.communication_status || "").toLowerCase() !== "sent" || state.draftEditorSaving) return;
  elements.mailForwardTo.value = "";
  elements.mailForwardCc.value = "";
  elements.mailForwardNote.value = "";
  elements.mailForwardModal.hidden = false;
  elements.mailForwardTo.focus();
}

function closeForwardDialog() {
  if (!state.draftEditorSaving) elements.mailForwardModal.hidden = true;
}

async function onForwardSubmit(event) {
  event.preventDefault();
  await createFollowUpDraft(
    "Forward",
    String(elements.mailForwardTo.value || "").trim(),
    String(elements.mailForwardCc.value || "").trim(),
    String(elements.mailForwardNote.value || "").trim(),
    true
  );
}

async function createFollowUpDraft(action, recipientTo, recipientCc, forwardNote, sendImmediately) {
  const record = getSelectedCommunicationRecord();
  const communicationId = String(record && record.communication_id || "").trim();
  if (!communicationId || String(record && record.communication_status || "").toLowerCase() !== "sent" || state.draftEditorSaving) return;
  const bookingId = String(state.selectedBookingId);
  const isCurrent = () => String(state.selectedBookingId) === bookingId;

  state.draftEditorSaving = true;
  elements.mailForwardModal.hidden = true;
  showSendModal(
    action === "Forward"
      ? "Forwarding email..."
      : sendImmediately
        ? "Resending email..."
        : "Creating resend draft...",
    false,
    !sendImmediately
  );
  setError(elements, "");
  renderEmailsPanel(elements, state);
  let followUpCreated = false;

  try {
    const response = await crmExecuteFunction("comm_createfollowupdraft", {
      sourceCommunicationId: communicationId,
      deliveryAction: action,
      recipientTo: recipientTo,
      recipientCc: recipientCc,
      forwardNote: forwardNote
    });
    const payload = extractFunctionPayload(response);
    const errorDetails = getFunctionPayloadErrorDetails(payload);
    if (errorDetails) throw buildFunctionPayloadError(errorDetails);

    const newDraftId = String(payload && payload.draft_id || "").trim();
    const newCommunicationId = String(payload && payload.communication_id || "").trim();
    if (!newDraftId) throw new Error("CRM created the follow-up Communication without a draft.");
    followUpCreated = true;
    if (!isCurrent()) return;
    state.emailStatusFilter = "Draft";
    state.selectedDraftRecordId = newDraftId;
    state.draftEditorOpen = false;
    state.draftEditorFields = null;
    state.communicationInlineEdit = "";

    if (sendImmediately) {
      const fromEmail = String(record && (record.from || record.Sender_Email) || "").trim();
      if (!newCommunicationId || !fromEmail) {
        throw new Error("The resend draft was created, but it has no Communication or sender to send from.");
      }
      const sendPayload = await sendCommunicationOnce({
        communicationId: newCommunicationId,
        draftId: newDraftId,
        fromEmail: fromEmail,
        actingUserEmail: fromEmail
      });
      if (!isCurrent()) return;
      state.emailStatusFilter = "Sent";
      if (sendPayload.warning) {
        showSendModal(sendPayload.warning, true);
        return;
      }
    }

    await ensureBookingEmailsLoaded(true);
    if (!isCurrent()) return;
    showSendModal(
      sendImmediately
        ? action === "Forward"
          ? "Email forwarded successfully."
          : "Email resent successfully."
        : "Resend draft created.",
      false
    );
    setTimeout(closeSendModal, 900);
  } catch (error) {
    if (!isCurrent()) return;
    if (followUpCreated) {
      state.emailStatusFilter = "Draft";
      try {
        await ensureBookingEmailsLoaded(true);
      } catch (reloadError) {
      }
    }
    showSendModal(error.message || "Could not create the follow-up draft.", true);
  } finally {
    state.draftEditorSaving = false;
    renderEmailsPanel(elements, state);
  }
}

function closeCreateDraftModal() {
  stopDraftLoading(elements.createDraftModal);
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

function onSelectSupplierRecipientEmails() {
  const record = getSelectedCommunicationRecord();
  if (!record?.communication_id || elements.mailToContactsButton.disabled || state.draftEditorSaving || state.draftSending) return;
  const bookingId = String(state.selectedBookingId), draftId = String(state.selectedDraftRecordId), communicationId = String(record.communication_id);
  const isCurrent = () => String(state.selectedBookingId) === bookingId && String(state.selectedDraftRecordId) === draftId && String(getSelectedCommunicationRecord()?.communication_id) === communicationId && !state.draftEditorSaving && !state.draftSending;
  const recipients = () => state.communicationInlineEdit === "to" ? state.communicationInlineEmails.to || [] : splitCommunicationEmails(getCommunicationEditorFields(getSelectedCommunicationRecord()).email_to);
  openSupplierContactEmails({
    communicationId,
    existing: recipients(),
    isCurrent,
    onApply: emails => {
      if (!isCurrent()) throw new Error("The selected communication changed. Reopen the contact selector.");
      state.communicationInlineEmails.to = mergeContactEmails([], emails);
      state.communicationInlineEdit = "to";
      renderEmailsPanel(elements, state);
      elements.mailInlineToSave.focus();
    }
  });
}

async function openInlineCommunicationEditor(field) {
  const record = getSelectedCommunicationRecord();
  if (!record || state.draftEditorSaving) return;
  try { await recordEditLocks.begin("Communications", record.communication_id); state.recordEditingLocksActive = true; }
  catch (error) { setError(elements, error.message); return; }
  state.communicationInlineEdit = field;
  if (field === "to" || field === "cc") {
    state.communicationInlineEmails[field] = splitCommunicationEmails(getCommunicationEditorFields(record)["email_" + field]);
  }
  renderEmailsPanel(elements, state);
}

function closeInlineCommunicationEditor() {
  const id = getSelectedCommunicationRecord()?.communication_id;
  if (id) void recordEditLocks.release("Communications", id).catch(() => {});
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
  else if (field === "subject") fields.email_subject = String(elements.mailInlineSubjectInput.value || "").trim();
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
    const value = field === "from" ? fields.email_from : field === "subject" ? fields.email_subject : fields["email_" + field];
    record[field] = value;
    const listRecord = findMailRecordById(state.emailDrafts, "drafts", state.selectedDraftRecordId);
    if (listRecord) listRecord[field] = value;
    const cacheKey = getMailCacheKey("drafts", state.selectedDraftRecordId);
    if (state.mailContentByKey[cacheKey]) state.mailContentByKey[cacheKey][field] = value;
    await recordEditLocks.release("Communications", record.communication_id).catch(() => {});
    state.communicationInlineEdit = "";
    const valueElement = field === "from" ? elements.mailViewerFrom : field === "to" ? elements.mailViewerTo : field === "cc" ? elements.mailViewerCc : elements.mailViewerSubject;
    const editorElement = field === "from" ? elements.mailInlineFrom : field === "to" ? elements.mailInlineTo : field === "cc" ? elements.mailInlineCc : elements.mailInlineSubject;
    const buttonElement = field === "from" ? elements.mailEditFromButton : field === "to" ? elements.mailEditToButton : field === "cc" ? elements.mailEditCcButton : elements.mailEditSubjectButton;
    valueElement.textContent = value || "-";
    valueElement.hidden = false;
    if (field === "subject") elements.mailViewerSubjectBlock.hidden = false;
    editorElement.hidden = true;
    buttonElement.hidden = false;
    setNotice(elements, "");
  } catch (error) { setError(elements, error.message || "Could not update the communication."); }
  finally {
    state.draftEditorSaving = false;
    renderEmailsPanel(elements, state);
  }
}

async function openCommunicationContentEditor() {
  const record = getSelectedCommunicationRecord();
  if (!record || state.draftEditorSaving) return;
  try { await recordEditLocks.begin("Communications", record.communication_id); state.recordEditingLocksActive = true; }
  catch (error) { setError(elements, error.message); return; }
  elements.mailContentEditError.hidden = true;
  elements.mailContentEditVisual.innerHTML = getCommunicationEditorFields(record).email_content || "<p></p>";
  state.communicationContentContextOpen = true;
  state.communicationContentContext = { view: "booking", loading: true, error: "", data: null };
  renderCommunicationContentContext(record);
  state.communicationContentEditorOpen = true;
  elements.mailContentEditModal.hidden = false;
  elements.mailContentEditVisual.focus();
  loadCommunicationContentContext(record);
}

function closeCommunicationContentEditor() {
  if (state.draftEditorSaving) return;
  const id = getSelectedCommunicationRecord()?.communication_id;
  if (id) void recordEditLocks.release("Communications", id).catch(() => {});
  state.communicationContentEditorOpen = false;
  elements.mailContentEditModal.hidden = true;
}

function toggleCommunicationContentContext() {
  if (!state.communicationContentEditorOpen) return;
  state.communicationContentContextOpen = !state.communicationContentContextOpen;
  if (state.communicationContentContextOpen && !state.communicationContentContext) {
    state.communicationContentContext = { view: "booking", loading: true, error: "", data: null };
    loadCommunicationContentContext(getSelectedCommunicationRecord());
  }
  renderCommunicationContentContext(getSelectedCommunicationRecord());
}

function onCommunicationContextCopy(event) {
  const button = event.target.closest("[data-copy-service-context]");
  if (!button) return;
  const label = button.dataset.copyLabel || "";
  const value = button.dataset.copyValue || "";
  copyCommunicationContextField(label, value, button).catch(function (error) {
    console.error("Unable to copy service context field:", error);
    setError(elements, "Could not copy the service field.");
  });
}

function onCommunicationContextChange(event) {
  if (event.target.id !== "mail-content-edit-context-view" || !state.communicationContentContext) return;
  state.communicationContentContext.view = event.target.value || "booking";
  renderCommunicationContentContext(getSelectedCommunicationRecord());
}

function renderCommunicationContentContext(record) {
  const panel = elements.mailContentEditContext;
  const toggle = elements.mailContentEditContextToggle;
  if (!panel || !toggle) return;

  const isOpen = Boolean(state.communicationContentContextOpen);
  panel.hidden = !isOpen;
  toggle.textContent = isOpen ? "Hide Context" : "Open Context";
  toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
  if (!isOpen) return;

  const context = state.communicationContentContext || {};
  const view = context.view || "booking";
  const select = '<label class="mail-context-view"><span>Context</span><select id="mail-content-edit-context-view"><option value="booking"' + (view === "booking" ? " selected" : "") + '>Booking</option><option value="services"' + (view === "services" ? " selected" : "") + '>Services</option><option value="travelers"' + (view === "travelers" ? " selected" : "") + '>Travelers</option><option value="supplier"' + (view === "supplier" ? " selected" : "") + '>Supplier</option></select></label>';
  if (context.loading) {
    panel.innerHTML = '<div class="mail-context-header"><span>Email template</span><strong>Context</strong>' + select + '</div><p class="mail-context-empty">Loading CRM informationâ€¦</p>';
    return;
  }
  if (context.error) {
    panel.innerHTML = '<div class="mail-context-header"><span>Email template</span><strong>Context</strong>' + select + '</div><p class="mail-context-empty">' + escapeHtml(context.error) + '</p>';
    return;
  }

  const data = context.data || {};
  let content = "";
  if (view === "services") content = renderCommunicationContextServices(data.services || []);
  else if (view === "travelers") content = renderCommunicationContextTravelers(data.travelers || []);
  else if (view === "supplier") content = renderCommunicationContextSupplier(data.supplier || {});
  else content = renderCommunicationContextBooking(data.booking || {});
  panel.innerHTML = '<div class="mail-context-header"><span>Email template</span><strong>Context</strong><p>Copy any field and paste it into the email.</p>' + select + '</div>' + content;
}

async function loadCommunicationContentContext(record) {
  try {
    try { await ensureBookingTravelersLoaded(); } catch (error) { console.warn("Unable to load email-context travelers:", error); }
    const services = getCommunicationContextServices(record);
    const supplierId = getCommunicationContextSupplierId(services);
    let supplier = {};
    if (supplierId) {
      try { supplier = await crmGetRecord("Vendors", supplierId); } catch (error) { console.warn("Unable to load email-context supplier:", error); }
    }
    if (!state.communicationContentEditorOpen) return;
    state.communicationContentContext = Object.assign({}, state.communicationContentContext, {
      loading: false,
      data: { booking: state.selectedBooking || {}, services: services, travelers: state.travelers || [], supplier: supplier || {} }
    });
  } catch (error) {
    if (!state.communicationContentEditorOpen) return;
    state.communicationContentContext = Object.assign({}, state.communicationContentContext, { loading: false, error: error && error.message ? error.message : "Could not load the email context." });
  }
  renderCommunicationContentContext(getSelectedCommunicationRecord());
}

function renderCommunicationContextBooking(booking) {
  return renderCommunicationContextCard(getCommunicationContextValue(booking, ["Deal_Name", "Name", "Booking_Name"]) || "Booking", [
    communicationContextField("MFSP reference", getCommunicationContextValue(booking, ["MFSP_Reference", "Booking_Reference"])),
    communicationContextField("Arrival", getCommunicationContextValue(booking, ["Arrival_Date", "Check_In", "Arrival"])),
    communicationContextField("Departure", getCommunicationContextValue(booking, ["Departure_Date", "Check_Out", "Departure"])),
    communicationContextField("Status", getCommunicationContextValue(booking, ["Status", "Booking_Status"])),
    communicationContextField("Travelers Number", getCommunicationContextValue(booking, ["Travellers_Number"])),
    communicationContextField("PAX Info", getCommunicationContextValue(booking, ["PAX_INFO_celebrations_special_requests_or_intere"])),
    communicationContextField("Luggage", getCommunicationContextValue(booking, ["Luggage"]))
  ]);
}

function renderCommunicationContextServices(services) {
  if (!services.length) return '<p class="mail-context-empty">This email has no associated services.</p>';
  return services.map(function (service, index) {
    const step = getCommunicationContextStep(service);
    const stepValue = function (keys) { return getCommunicationContextValue(step, keys); };
    const content = [
      communicationContextSection("General", [communicationContextField("Information", [stepValue(["Name", "Step_Name"]), stepValue(["Step_Type"]), stepValue(["Step_Category"])].filter(Boolean).join(" Â· ")), communicationContextField("Short Description", stepValue(["Short_Description"])), communicationContextField("Long Description", stepValue(["Long_Description"])), communicationContextField("Travelers Number", stepValue(["Travellers_Number"])), communicationContextField("Start Date/Time", stepValue(["Start_Date_Time", "Start_Date"])), communicationContextField("End Date/Time", stepValue(["End_Date_Time", "End_Date"])), communicationContextField("Duration", stepValue(["Duration"])), communicationContextField("Confirmation Reference", stepValue(["Confirmation_Reference"])), communicationContextField("Sample Step", stepValue(["Sample_Step"]))]),
      communicationContextSection("Transport", ["Arrival_Departure", "Flight_Number", "Flight_Departure_Time", "Flight_Arrival_Time", "Departure_Airport", "Arrival_Airport", "Train_Number", "Train_Departure_Time", "Train_Arrival_Time", "Departure_Station", "Arrival_Station", "Ship_Name", "Ship_Departure_Time", "Ship_Arrival_Time", "Departure_Port", "Arrival_Port", "Vehicle_Type", "Departure_City_Vehicle_Type", "Arrival_City_Vehicle_Type", "FARE", "Record_Locator"].map(function (key) { return communicationContextField(formatCommunicationContextLabel(key), stepValue([key])); })),
      communicationContextSection("Pick-up / Drop-off", ["Car_PickUp_Time", "PickUp_Point", "DropOff_Point", "Departure_City_PickUp_Point", "Arrival_City_PickUp_Point", "Departure_City_DropOff_Point", "Arrival_City_DropOff_Point", "Departure_City_Car_PickUp_Time", "Arrival_City_Car_PickUp_Time"].map(function (key) { return communicationContextField(formatCommunicationContextLabel(key), stepValue([key])); })),
      communicationContextSection("Service details", ["Included", "Passengers", "Cancellation_Policy", "Clothing", "Amenities", "Menu", "Meeting_Details", "Table_Reservation_Time"].map(function (key) { return communicationContextField(formatCommunicationContextLabel(key), stepValue([key])); })),
      communicationContextSection("Notes", [communicationContextField("Special Notes", stepValue(["Special_Notes"])), communicationContextField("Important Notes", stepValue(["Important_Notes"]))])
    ].join("");
    const basic = [communicationContextField("Date", getCommunicationContextValue(service, ["Service_Date", "service_date", "Date"])), communicationContextField("Travelers Number", getCommunicationContextValue(service, ["PAX_Number", "Pax_Number", "Travellers_Number"])), communicationContextField("Booking", getCommunicationContextValue(service, ["Booking"]))].join("");
    return '<details class="mail-context-service"' + (index === 0 ? " open" : "") + '><summary>' + escapeHtml(getCommunicationContextValue(service, ["Product_Description", "Name"]) || "Service " + (index + 1)) + '</summary><div class="mail-context-fields">' + basic + content + '</div></details>';
  }).join("");
}

function renderCommunicationContextTravelers(travelers) {
  if (!travelers.length) return '<p class="mail-context-empty">No travelers are associated with this booking.</p>';
  return travelers.map(function (traveler, index) {
    const name = [getCommunicationContextValue(traveler, ["Forename", "First_Name"]), getCommunicationContextValue(traveler, ["Name", "Last_Name"])].filter(Boolean).join(" ") || getCommunicationContextValue(traveler, ["Full_Name"]) || "Traveler " + (index + 1);
    return renderCommunicationContextCard(name, [communicationContextField("Email", getCommunicationContextValue(traveler, ["Email", "Pax_Email"])), communicationContextField("Phone", getCommunicationContextValue(traveler, ["Pax_Phone", "Phone", "Mobile"])), communicationContextField("Age", getCommunicationContextValue(traveler, ["New_Age"])), communicationContextField("Nationality", getCommunicationContextValue(traveler, ["Nationality"])), communicationContextField("Passport Number", getCommunicationContextValue(traveler, ["Passport_Number"])), communicationContextField("Allergies and Dietary Restrictions", getCommunicationContextValue(traveler, ["Allergies_Dietary_Restrictions"])), communicationContextField("Mobility Needs", getCommunicationContextValue(traveler, ["Mobility_Needs"])), communicationContextField("Size and Weight", getCommunicationContextValue(traveler, ["Size_Weight"])), communicationContextField("Special Requests", getCommunicationContextValue(traveler, ["Special_Requests"])), communicationContextField("Booking notes", getCommunicationContextValue(traveler, ["Booking_Notes"])), communicationContextField("Traveller Motivation", getCommunicationContextValue(traveler, ["Traveller_Motivation"]))]);
  }).join("");
}

function renderCommunicationContextSupplier(supplier) {
  return renderCommunicationContextCard(getCommunicationContextValue(supplier, ["Name", "Vendor_Name"]) || "Supplier", [communicationContextField("Email", getCommunicationContextValue(supplier, ["Email", "Email_Address"])), communicationContextField("Phone", getCommunicationContextValue(supplier, ["Phone", "Mobile"])), communicationContextField("Supplier Notes", getCommunicationContextValue(supplier, ["Supplier_Notes", "Notes"])), communicationContextField("Groups Info", getCommunicationContextValue(supplier, ["Groups_Info", "Group_Info"])), communicationContextField("Restrictions", getCommunicationContextValue(supplier, ["Restrictions"])), communicationContextField("Reduce Mobility Info", getCommunicationContextValue(supplier, ["Reduced_Mobility_Info", "Reduce_Mobility_Info", "Reduce_Mobility"])), communicationContextField("Amenities", getCommunicationContextValue(supplier, ["Amenities"])), communicationContextField("Other Amenities", getCommunicationContextValue(supplier, ["Other_Amenities"])), communicationContextField("Room Category", getCommunicationContextValue(supplier, ["Room_Category"])), communicationContextField("Commission Amount", getCommunicationContextValue(supplier, ["Commission_Amount"])), communicationContextField("Commission Notes", getCommunicationContextValue(supplier, ["Commission_Notes"])), communicationContextField("Commission Payment Terms", getCommunicationContextValue(supplier, ["Commission_Payment_Terms"])), communicationContextField("Commission Status", getCommunicationContextValue(supplier, ["Commission_Status"])), communicationContextField("Cancellation Policy", getCommunicationContextValue(supplier, ["Cancellation_Policy"]))]);
}

function renderCommunicationContextCard(title, fields) { const content = fields.filter(Boolean).join(""); return '<section class="mail-context-card"><h4>' + escapeHtml(title) + '</h4><div class="mail-context-fields">' + (content || '<p class="mail-context-empty">No information available.</p>') + '</div></section>'; }
function communicationContextSection(title, fields) { const content = fields.filter(Boolean).join(""); return content ? '<section class="mail-context-section"><h5>' + escapeHtml(title) + '</h5><div class="mail-context-fields">' + content + '</div></section>' : ""; }
function communicationContextField(label, value) { return value ? renderCommunicationContextField({ label: label, value: value }) : ""; }
function getCommunicationContextStep(service) { const stepLookup = service && service.Step; const stepId = String(stepLookup && (stepLookup.id || stepLookup.ID) || ""); return (state.steps || []).find(function (step) { return String(step.id || step.ID || "") === stepId; }) || stepLookup || {}; }
function getCommunicationContextSupplierId(services) { const service = services[0] || {}; const supplier = service.Supplier || service.Vendor || {}; return String(supplier && (supplier.id || supplier.ID) || ""); }

function getCommunicationContextServices(record) {
  const linkedServices = recordServices(record);
  if (!linkedServices.length) {
    const linkedIds = Array.isArray(record && record.service_ids) ? record.service_ids.map(String) : [];
    return (state.services || []).filter(function (service) {
      return linkedIds.indexOf(String(service && (service.id || service.ID) || "")) !== -1;
    });
  }
  return linkedServices.map(function (linkedService) {
    const linkedId = String(linkedService && (linkedService.id || linkedService.ID) || "");
    const fullService = (state.services || []).find(function (service) { return String(service.id || service.ID || "") === linkedId; });
    return Object.assign({}, linkedService || {}, fullService || {});
  }).filter(function (service) { return Object.keys(service).length; });
}

function getCommunicationContextValue(service, keys) {
  for (let index = 0; index < keys.length; index += 1) {
    const value = service && service[keys[index]];
    if (value === null || value === undefined || value === "") continue;
    if (typeof value === "object") return String(value.name || value.display_value || value.full_name || value.email || "").trim();
    return String(value).trim();
  }
  return "";
}

function getCommunicationContextFields(service) {
  const excluded = { id: true, ID: true, Created_Time: true, Modified_Time: true, Owner: true, Created_By: true, Modified_By: true, $currency_symbol: true, $process_flow: true, $approval: true, $editable: true, $permissions: true };
  return Object.keys(service || {}).filter(function (key) {
    if (excluded[key] || key.charAt(0) === "$") return false;
    const value = getCommunicationContextValue(service, [key]);
    return Boolean(value) && value !== "[object Object]";
  }).map(function (key) {
    return { label: formatCommunicationContextLabel(key), value: getCommunicationContextValue(service, [key]) };
  });
}

function formatCommunicationContextLabel(key) {
  return String(key || "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function renderCommunicationContextField(field) {
  const label = escapeHtml(field.label);
  const value = escapeHtml(field.value);
  return '<div class="mail-context-field"><span>' + label + '</span><strong>' + value + '</strong><button class="mail-context-copy" type="button" data-copy-service-context data-copy-label="' + label + '" data-copy-value="' + value + '" title="Copy ' + label + '" aria-label="Copy ' + label + '"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path></svg></button></div>';
}

async function copyCommunicationContextField(label, value, button) {
  const plainText = label + ": " + value;
  const html = "<strong>" + escapeHtml(label) + ":</strong> " + escapeHtml(value);
  if (navigator.clipboard && navigator.clipboard.write && typeof ClipboardItem !== "undefined") {
    await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([plainText], { type: "text/plain" }), "text/html": new Blob([html], { type: "text/html" }) })]);
  } else if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(plainText);
  } else {
    throw new Error("Clipboard access is not available.");
  }
  button.classList.add("is-copied");
  button.title = "Copied";
  window.setTimeout(function () { button.classList.remove("is-copied"); button.title = "Copy " + label; }, 1800);
}

async function saveCommunicationContentEditor() {
  const record = getSelectedCommunicationRecord();
  if (!record || !record.communication_id || state.draftEditorSaving) return;
  const fields = getCommunicationEditorFields(record);
  const bookingId = state.selectedBookingId;
  const draftId = String(record.draft_id || record.id);
  const cacheKey = getMailCacheKey("drafts", draftId);
  fields.email_content = elements.mailContentEditVisual.innerHTML;
  state.draftEditorSaving = true;
  elements.mailContentEditSave.disabled = true;
  elements.mailContentEditSave.textContent = "Savingâ€¦";
  elements.mailContentEditSave.ariaBusy = "true";
  elements.mailContentEditError.hidden = true;
  elements.mailContentEditVisual.contentEditable = "false";
  setError(elements, "");
  setNotice(elements, "");
  try {
    const response = await crmExecuteFunction("comm_updatecommunicationdraft", {
      communicationId: record.communication_id, draftId: record.draft_id || record.id,
      email_to: fields.email_to, email_from: fields.email_from, email_cc: fields.email_cc,
      email_subject: fields.email_subject, email_content: fields.email_content
    });
    const payload = extractFunctionPayload(response);
    const error = getFunctionPayloadErrorDetails(payload);
    if (error) throw buildFunctionPayloadError(error);
    if (!payload || payload.success !== true) {
      throw new Error("CRM did not confirm the draft update. Your changes remain in the editor.");
    }
    // Read persisted content independently: a function success flag is not proof
    // that CRM accepted the native draft update.
    const savedRecords = await loadBookingMailRecordsFromFunction(bookingId, "drafts");
    const savedRecord = savedRecords.find(function (candidate) {
      return String(candidate.communication_id) === String(record.communication_id)
        && String(candidate.draft_id || candidate.id) === draftId;
    });
    if (!savedRecord || normalizeSavedEmailContent(savedRecord.content) !== normalizeSavedEmailContent(fields.email_content)) {
      throw new Error("CRM did not return the updated email content. Your changes remain in the editor; saving could not be verified.");
    }
    if (state.selectedBookingId !== bookingId) return;
    const listRecord = findMailRecordById(state.emailDrafts, "drafts", draftId);
    if (listRecord) Object.assign(listRecord, savedRecord);
    state.mailContentByKey[cacheKey] = Object.assign({}, savedRecord);
    await recordEditLocks.release("Communications", record.communication_id).catch(() => {});
    state.communicationContentEditorOpen = false;
    elements.mailContentEditModal.hidden = true;
    renderEmailsPanel(elements, state);
    setNotice(elements, "");
  } catch (error) {
    const message = error.message || "Could not update the email content.";
    elements.mailContentEditError.textContent = message;
    elements.mailContentEditError.hidden = false;
  } finally {
    state.draftEditorSaving = false;
    elements.mailContentEditSave.disabled = false;
    elements.mailContentEditSave.textContent = "Save changes";
    elements.mailContentEditSave.ariaBusy = "false";
    elements.mailContentEditVisual.contentEditable = "true";
    renderEmailsPanel(elements, state);
  }
}

function normalizeSavedEmailContent(value) {
  // Parse HTML consistently to tolerate entity/attribute serialization changes,
  // without discarding text or meaningful whitespace.
  const template = document.createElement("template");
  template.innerHTML = String(value == null ? "" : value).replace(/\r\n?/g, "\n");
  return template.innerHTML;
}

async function onEditCommunicationClick() {
  if (!state.selectedDraftRecordId || state.draftEditorSaving) return;
  const record = getSelectedCommunicationRecord();
  const bookingId = state.selectedBookingId;
  try {
    await recordEditLocks.begin("Communications", record.communication_id);
    state.recordEditingLocksActive = true;
    if (state.selectedBookingId !== bookingId || getSelectedCommunicationRecord()?.communication_id !== record.communication_id) {
      await recordEditLocks.release("Communications", record.communication_id);
      return;
    }
  } catch (error) { setError(elements, error.message); return; }
  const recovery = state.communicationEditRecoveries?.[record?.communication_id];
  state.draftEditorFields = recovery ? { ...recovery.fields } : getCommunicationEditorFields(record);
  state.draftEditorMode = "visual";
  state.draftEditorServiceIds = recovery ? recovery.serviceIds.slice() : (recordServices(record)).map(function (service) { return String(service.id); });
  state.draftEditorOpen = true;
  renderEmailsPanel(elements, state);
}

function onCancelCommunicationEdit() {
  if (state.draftEditorSaving) return;
  const recordId = getSelectedCommunicationRecord()?.communication_id;
  if (recordId) void recordEditLocks.release("Communications", recordId).catch(() => {});
  const recovery = state.communicationEditRecoveries?.[getSelectedCommunicationRecord()?.communication_id];
  if (recovery) {
    recovery.serviceIds = state.draftEditorServiceIds.slice();
    setNotice(elements, "Email content was saved. Pending service links have been kept in this widget. Open Edit to recover them before sending.");
  }
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
  if (state.draftEditorSaving) return;
  const serviceId = String(elements.mailEditServiceSearch.value || "").split(" | ")[0].trim();
  if ((state.services || []).some(function (service) { return String(service.id) === serviceId; }) && state.draftEditorServiceIds.indexOf(serviceId) === -1) {
    state.draftEditorServiceIds.push(serviceId);
  }
  elements.mailEditServiceSearch.value = "";
  renderEmailsPanel(elements, state);
}

function onCommunicationServiceRemove(event) {
  if (state.draftEditorSaving) return;
  const button = event.target.closest("[data-remove-communication-service]");
  if (!button) return;
  state.draftEditorServiceIds = state.draftEditorServiceIds.filter(function (id) { return id !== button.dataset.removeCommunicationService; });
  renderEmailsPanel(elements, state);
}

function syncCommunicationEditorFields() {
  if (!state.draftEditorOpen) return;
  if (state.communicationEditRecoveries?.[getSelectedCommunicationRecord()?.communication_id]) return;
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
  const serviceIds = state.draftEditorServiceIds.slice();
  const bookingId = String(state.selectedBookingId || "");
  const workspaceRequestId = state.bookingWorkspaceRequestId;
  const isCurrent = () => String(state.selectedBookingId || "") === bookingId && state.bookingWorkspaceRequestId === workspaceRequestId && getSelectedCommunicationRecord()?.communication_id === record.communication_id;
  syncCommunicationEditorFields();
  const fields = { ...(state.draftEditorFields || {}) };
  state.communicationEditRecoveries ||= {};
  let recovery = state.communicationEditRecoveries[record.communication_id];
  let contentConfirmed = Boolean(recovery);
  let servicesConfirmed = false;
  state.draftEditorSaving = true;
  setError(elements, "");
  renderEmailsPanel(elements, state);
  try {
    if (recovery && (recovery.bookingId !== bookingId || recovery.draftId !== String(record.draft_id || record.id || ""))) throw new Error("The saved draft identity changed. Review the Communication in CRM before continuing.");
    if (!recovery) {
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
      if (!payload || payload.success !== true) throw new Error("The email save could not be confirmed. Check the Communication in CRM before trying again.");
      recovery = { bookingId, draftId: String(record.draft_id || record.id || ""), fields: { ...fields }, serviceIds: serviceIds.slice() };
      state.communicationEditRecoveries[record.communication_id] = recovery;
      contentConfirmed = true;
    }
    recovery.serviceIds = serviceIds.slice();
    if (!isCurrent()) throw new Error("The selected communication changed. Reopen the original communication to review its saved content and services.");
    const servicesResponse = await crmExecuteFunction("comm_updatecommunicationservices", {
      communicationId: record.communication_id,
      serviceIds: serviceIds.join("|||")
    });
    const servicesPayload = extractFunctionPayload(servicesResponse);
    const servicesError = getFunctionPayloadErrorDetails(servicesPayload);
    if (servicesError) throw buildFunctionPayloadError(servicesError);
    if (!servicesPayload || servicesPayload.success !== true || !Array.isArray(servicesPayload.service_ids) ||
        servicesPayload.service_ids.length !== serviceIds.length || serviceIds.some(id => !servicesPayload.service_ids.map(String).includes(String(id)))) {
      throw new Error("CRM did not confirm the requested service relationships. Review the Communication before trying again.");
    }
    if (!isCurrent()) return;
    servicesConfirmed = true;
    delete state.communicationEditRecoveries[record.communication_id];
    await recordEditLocks.release("Communications", record.communication_id).catch(() => {});
    state.draftEditorOpen = false;
    state.draftEditorFields = null;
    state.draftEditorServiceIds = [];
    await ensureBookingEmailsLoaded(true);
    setNotice(elements, "");
  } catch (error) {
    if (isCurrent()) setError(elements, (servicesConfirmed ? "Email content and service links were saved, but refreshing failed. Refresh the email list; do not repeat the save. " : contentConfirmed ? "Email content saved; service links are not confirmed. Your selection has been kept. Retry service links without saving the email again. " : "") + (error.message || "Could not update the communication."));
  } finally {
    state.draftEditorSaving = false;
    renderEmailsPanel(elements, state);
  }
}

function resolveCurrentUserRelationshipUserId(records) {
  const match = findCurrentUserRelationshipRecord(records);
  const matchedUser = extractUserRelationshipUser(match);
  return String(matchedUser && matchedUser.value || match && match.User_ID || state.currentUserId || "").trim();
}

function findCurrentUserRelationshipRecord(records) {
  return resolveWidgetRelationship(state, records);
}

function isCurrentUserAdministrator(records) {
  return getWidgetPermissions(state, records).adminActions;
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

function buildOwnerOptionsFromUserRelationships(records) {
  const usersById = {};

  (records || []).forEach(function (record) {
    const userData = extractUserRelationshipUser(record);

    if (!userData || !isIncludedUserRelationshipOwner(record) || usersById[userData.value]) {
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

  const role = getUserRelationshipText(record.Role);
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

  const userId = getUserRelationshipId(record.User_ID);
  const userEmail = getUserRelationshipText(record.Email) || String(
    getUserLookupValue(userLookup, ["email", "user_email"]) || ""
  ).trim();
  const userLabel = getUserRelationshipText(record.User_Alias);

  if (!userId || !userLabel) {
    return null;
  }

  return {
    value: userId,
    label: userLabel,
    email: userEmail,
    alias: userLabel,
    role: role
  };
}

function isIncludedUserRelationshipOwner(record) {
  const normalizedStatus = normalizeComparableText(getUserRelationshipText(record && record.Status));
  const normalizedRole = normalizeComparableText(getUserRelationshipText(record && record.Role));
  const hasAllowedRole = Boolean(
    normalizedRole &&
    normalizedRole !== "n/a" &&
    normalizedRole !== "-none-"
  );

  return normalizedStatus === "active" && hasAllowedRole;
}

function getUserRelationshipId(value) {
  if (value && typeof value === "object") {
    return String(value.id || value.user_id || value.zuid || value.value || "").trim();
  }

  return String(value || "").trim();
}

function getUserRelationshipText(value) {
  if (value && typeof value === "object") {
    return String(
      value.name || value.full_name || value.display_value || value.actual_value ||
      value.label || value.email || value.user_email || value.value || ""
    ).trim();
  }

  return String(value || "").trim();
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

function registerZohoEmbeddedAppListeners(onPageLoad) {
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
      if (onPageLoad) void onPageLoad(data);
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
    "Sales_Tags_JSON",
    "Reservations_Tags_JSON",
    "Desk_Ticket_ID",
    "Desk_Ticket_Id",
    "DeskTicketID",
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
    onSyncBooking: onBookingBrowserSync,
    onLoadDeskTicket: loadDeskTicket,
    onBookingSelected: async function (booking) {
      if (state.bookingBrowserWide) onBookingBrowserSizeToggleClick();
      cacheBookingLookup(state, booking);
      elements.bookingSearch.value = buildBookingLabel(booking);
      hideSearchResults(elements);
      await loadBookingWorkspace(booking.id);
    }
  });
}

async function onBookingBrowserSync(booking) {
  const bookingId = String(booking && booking.id || "").trim();
  const ezusProjectRef = String(booking && booking.Ezus_Project_ID || "").trim();
  const syncingBookingIds = state.syncingEzusBookingIds || (state.syncingEzusBookingIds = {});
  if (!bookingId || !ezusProjectRef || syncingBookingIds[bookingId]) {
    if (!ezusProjectRef) setError(elements, "This booking does not have Ezus_Project_ID, so the sync cannot start.");
    return;
  }

  try {
    if (!beginEzusSync(state, elements, bookingId, bookingDocuments)) return;
  } catch (error) { setError(elements, error.message); return; }
  setError(elements, "");
  renderBookingBrowserPanel();

  try {
    const response = await crmExecuteFunction("syncprojectfromezus", {
      bookingId: bookingId,
      args: JSON.stringify({ sync: { syncActionUserEmail: state.currentUserEmail || "" } })
    });
    const payload = extractFunctionPayload(response);
    const errorDetails = getFunctionPayloadErrorDetails(payload);
    if (errorDetails) throw buildFunctionPayloadError(errorDetails);

    assertEzusSyncConfirmed(payload);
    const refreshedBooking = await crmGetRecord(MODULES.bookings, bookingId);
    if (refreshedBooking) {
      const index = state.bookings.findIndex(function (entry) { return String(entry.id) === bookingId; });
      if (index !== -1) state.bookings[index] = refreshedBooking;
      cacheBookingLookup(state, refreshedBooking);
    }
    await refreshSelectedBookingAfterSync(bookingId);
    setNotice(elements, payload && payload.message || "Ezus sync launched.");
  } catch (error) {
    setError(elements, error && error.message ? error.message : "Could not run the Ezus sync function from this widget.");
  } finally {
    endEzusSync(state, bookingId);
    if (String(state.selectedBookingId) === String(bookingId)) elements.operationRecovery?.dispatchEvent(new CustomEvent("booking-recovery-refresh"));
    renderBookingBrowserPanel();
  }
}

function resolveBookingSearchCriteriaField(searchField, availableFieldApiNames) {
  const fieldsBySearchType = {
    booking_owner: ["Owner", "Booking_Owner", "BookingOwner", "Record_Owner", "Assigned_To", "Owner_Id", "SMOWNERID"],
    sales_rep: ["Sales_Rep", "Sales_Representative", "Salesperson"],
    reservations_rep: ["Reservations_Rep", "Reservation_Rep", "Reservations_Representative"],
    accounting_rep: ["Accounting_Rep", "Accounting_Representative"],
    guest_relations_rep: ["Guest_Relations_Rep", "Guest_Relations_Representative"],
    hour_rep: ["Hour_Rep", "Rep_24h", "24h_Rep", "TwentyFourHour_Rep", "TwentyFour_Hour_Rep"]
  };

  if (searchField === "booking_owner" || !fieldsBySearchType[searchField]) {
    return resolveBookingOwnerCriteriaField(availableFieldApiNames);
  }

  return resolveBookingCriteriaField(fieldsBySearchType[searchField], availableFieldApiNames);
}

async function switchTab(tabName) {
  if (tabName === "documents" && !canManageDocuments(state)) return;
  const returningFromAutomatic = state.activeTab === "automatic" && tabName === "emails";
  state.activeTab = tabName;
  renderActiveTab(elements, state);
  if (tabName === "automatic") {
    elements.manageAutomaticPanel?.querySelector("h2")?.focus();
    await automaticNotifications.ensure();
  }
  if (tabName === "tasks") await bookingTasks.ensure();
  if (tabName === "documents") await bookingDocuments.ensure();

  if (tabName === "communication" || tabName === "booking") {
    renderBookingSummary(elements, state);
  }

  if (tabName === "emails") {
    if (!returningFromAutomatic) clearSelectedMailPreview();
    await ensureBookingEmailsLoaded();
    renderEmailsPanel(elements, state);
  }

  if (tabName === "travelers") {
    await ensureBookingTravelersLoaded();
    renderTravelersWorkspace();
  }

  if (tabName === "payments") {
    renderPaymentsWorkspace(elements, state);
    if (["cardPurchases", "prepayments"].includes(state.activePaymentTab)) {
      await setPaymentTab(elements, state, state.activePaymentTab);
    }
  }

  renderBookingWorkspace(elements, state);
}

async function ensureBookingEmailsLoaded(forceReload, options) {
  const settings = options || {};
  const contentOnly = Boolean(settings.contentOnly);
  if (!state.selectedBookingId) {
    if (!contentOnly) renderEmailsPanel(elements, state);
    return;
  }

  if (state.draftEmailsLoaded && !forceReload) {
    if (!contentOnly) renderEmailsPanel(elements, state);
    return;
  }

  const bookingId = state.selectedBookingId;
  const workspaceRequestId = state.bookingWorkspaceRequestId;
  const requestId = state.bookingEmailsRequestId = (state.bookingEmailsRequestId || 0) + 1;
  const isCurrent = () => state.selectedBookingId === bookingId &&
    state.bookingWorkspaceRequestId === workspaceRequestId && state.bookingEmailsRequestId === requestId;
  state.emailsLoading = true;
  state.draftEmailsError = "";
  if (!contentOnly) renderEmailsPanel(elements, state);

  try {
    const drafts = await loadBookingMailRecordsFromFunction(bookingId, "drafts");
    if (!isCurrent()) return;
    state.emailDrafts = drafts;
    state.draftEmailsLoaded = true;
  } catch (error) {
    if (!isCurrent()) return;
    state.emailDrafts = [];
    state.draftEmailsError = buildEmailLoadErrorMessage(error, "Draft emails");
    state.draftEmailsLoaded = false;
  } finally {
    if (isCurrent()) {
      state.emailsLoading = false;
      if (!contentOnly) renderEmailsPanel(elements, state);
    }
  }
}

async function loadBookingBlueprintForBooking(bookingId, loadColors = true) {
  const blueprint = normalizeBookingBlueprintPayload(await loadUserBlueprint(MODULES.bookings, bookingId));
  if (loadColors && (!blueprint.processInfo.current_picklist?.colour_code || blueprint.transitions.some(item => !item.color_code))) {
    try {
      // The native SDK can omit colors returned by the v8 function. Read only
      // appearance from that response, matched to already-authorized IDs.
      const payload = extractFunctionPayload(await withTimeout(crmExecuteFunction("blueprint_getbookingblueprint", {
        bookingId, moduleApiName: MODULES.bookings
      }), ZOHO_SDK_TIMEOUT_MS, "Workflow colors could not be loaded."));
      if (!getFunctionPayloadErrorDetails(payload)) {
        const metadata = normalizeBookingBlueprintPayload(payload);
        blueprint.transitions = applyBlueprintTransitionColors(blueprint.transitions, metadata.transitions);
        blueprint.processInfo = applyBlueprintStageColor(blueprint.processInfo, metadata.processInfo);
      }
    } catch (_) { /* Optional appearance must not block native workflow permissions. */ }
  }
  return blueprint;
}

const loadDeskTicket = createDeskTicketLoader(async function (ticketId) {
  const response = await withTimeout(crmExecuteFunction("desk_getticketlatestinteraction", { ticketId }), ZOHO_SDK_TIMEOUT_MS, "Desk interaction request timed out");
  const payload = extractFunctionPayload(response);
  const errorDetails = getFunctionPayloadErrorDetails(payload);
  if (errorDetails) throw buildFunctionPayloadError(errorDetails);
  return normalizeDeskTicketPayload(payload);
});

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
    var ticket = await loadDeskTicket(ticketId);

    if (bookingId !== state.selectedBookingId) {
      return;
    }

    state.deskTicket = ticket;
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

  const communications = await loadBookingCommunications(bookingId);
  return excludeAutomaticMail(extractMailRecordsFromPayload(payload, mode), communications);
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
  // Draft API errors are returned per item, even when the function itself ran
  // successfully. Inspect these envelopes before accepting the outer status.
  const draftResponses = [payload, payload.api_response, payload.data];
  for (const draftResponse of draftResponses) {
    if (draftResponse && Array.isArray(draftResponse.__email_drafts)) {
      for (const draftResult of draftResponse.__email_drafts) {
        const draftError = getFunctionPayloadErrorDetails(draftResult);
        if (draftError) return draftError;
      }
    }
  }
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
  setNotice(elements, "");
  showSendModal("Deleting draft...", false);
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
    showSendModal(getFunctionSuccessMessage(payload) || successMessage || "Draft deleted successfully.", false);
    setTimeout(closeSendModal, 900);
  } catch (error) {
    showSendModal(error.message || "Could not delete the selected draft.", true);
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
    console.log("[BookingsManager:draft-editor]", step);
    return;
  }

  console.log("[BookingsManager:draft-editor]", step, details);
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
  const requestId = state.bookingSearchRequestId = (state.bookingSearchRequestId || 0) + 1;
  const rawInput = elements.bookingSearch.value.trim();
  let booking = getBookingFromSearch();

  if (!booking) {
    let matches;
    try {
      matches = await searchBookingByInput(rawInput);
    } catch (error) {
      if (state.bookingSearchRequestId === requestId && elements.bookingSearch.value.trim() === rawInput) {
        hideSearchResults(elements);
        setError(elements, error.message || "Booking search failed. Please try again.");
      }
      return;
    }
    if (state.bookingSearchRequestId !== requestId || elements.bookingSearch.value.trim() !== rawInput) return;

    if (matches.length > 1) {
      setNotice(elements, "More than one booking matches that search. Choose the correct one below.");
      renderSearchResults({
        elements: elements,
        records: matches,
        onBookingSelected: async function (match) {
          if (state.bookingSearchRequestId !== requestId) return;
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
  if (!canLeaveBookingWorkspace()) return;
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

async function onRefreshServicesClick() {
  const bookingId = state.selectedBookingId;
  if (!bookingId || state.servicesRefreshing || elements.loadBooking?.disabled) return;
  const requestId = state.bookingWorkspaceRequestId;
  const isCurrent = () => state.selectedBookingId === bookingId && state.bookingWorkspaceRequestId === requestId;
  state.servicesRefreshing = true;
  elements.refreshServices.disabled = true;
  elements.refreshServices.classList.add("is-loading");
  elements.refreshServices.setAttribute("aria-busy", "true");
  try {
    const [services, steps] = await Promise.all([
      loadBookingServicesForBooking(bookingId), loadBookingStepsForBooking(bookingId)
    ]);
    if (!isCurrent()) return;
    const selection = createSelectionSnapshot();
    state.services = services.sort((a, b) => String(a.Service_Date || "").localeCompare(String(b.Service_Date || "")) || String(a.Name || "").localeCompare(String(b.Name || "")));
    state.steps = steps.sort((a, b) => String(a.Start_Date_Time || "").localeCompare(String(b.Start_Date_Time || "")) || String(a.Name || "").localeCompare(String(b.Name || "")));
    indexSteps(state, state.steps);
    state.selectedService = null;
    state.selectedServiceId = "";
    state.selectedStep = null;
    state.selectedStepId = "";
    restoreSelectionSnapshot(selection);
    applyServiceFilter();
    renderBookingSummary(elements, state);
  } catch (error) {
    if (isCurrent()) setError(elements, "Could not refresh services. " + (error.message || "Please try again."));
  } finally {
    state.servicesRefreshing = false;
    elements.refreshServices.classList.remove("is-loading");
    elements.refreshServices.setAttribute("aria-busy", "false");
    elements.refreshServices.disabled = !state.selectedBookingId || Boolean(elements.loadBooking?.disabled);
  }
}

async function loadBookingWorkspace(bookingId, options) {
  const settings = options || {};
  const changingBooking = String(state.selectedBookingId || "") !== String(bookingId);
  if (!canLeaveBookingWorkspace()) return false;
  state.bookingSearchRequestId = (state.bookingSearchRequestId || 0) + 1;
  const selectionSnapshot = settings.preserveSelection && !changingBooking ? createSelectionSnapshot() : null;
  if (changingBooking) {
    const booking = (state.bookingIndex || {})[bookingId];
    clearActiveBookingWorkspace();
    renderActiveTab(elements, state);
    renderPaymentsWorkspace(elements, state);
    renderEmailsPanel(elements, state);
    renderTravelersWorkspace();
    state.bookingWorkspaceLoadingLabel = booking ? buildBookingLabel(booking) : String(bookingId);
    renderBookingWorkspace(elements, state);
    renderBookingSummary(elements, state);
    renderSelectionPanel(elements, state);
    clearSelectedMailPreview();
    renderBookingBrowserPanel();
  }
  const requestId = state.bookingWorkspaceRequestId = (state.bookingWorkspaceRequestId || 0) + 1;
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
    const bookingRecord = settings.waitForEzusProject
      ? await loadBookingWithEzusProject(bookingId, () => state.bookingWorkspaceRequestId === requestId, undefined, settings.ezusReferencePrefix)
      : await crmGetRecord(MODULES.bookings, bookingId);
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

    const blueprintResult = await bookingBlueprintPromise;
    if (state.bookingWorkspaceRequestId !== requestId) return;
    if (settings.protectPendingEdits) assertEzusSyncEditsSaved(state, elements, bookingId, bookingDocuments);
    state.selectedBookingId = bookingId;
    automaticNotifications.reset();
  bookingTasks.reset();
    bookingDocuments.reset();
    bookingDocuments.sync();
    state.prepaymentsData = null;
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
    if (!settings.preserveTravelers) resetTravelersState();
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
    elements.operationRecovery?.dispatchEvent(new CustomEvent("booking-recovery-refresh"));
    applyServiceFilter();
    renderSelectionPanel(elements, state);
    renderEmailsPanel(elements, state);
    renderTravelersWorkspace();
    renderBookingBrowserPanel();
    renderPaymentsWorkspace(elements, state);

    if (settings.refreshTravelers || state.summaryView === "travelers" || state.activeTab === "travelers") {
      await ensureBookingTravelersLoaded(Boolean(settings.refreshTravelers));
      if (settings.throwOnError && state.bookingWorkspaceRequestId === requestId && state.travelersError) {
        throw new Error(state.travelersError);
      }
    }

    if (state.bookingWorkspaceRequestId !== requestId) return;
    elements.bookingSearch.value = buildBookingLabel(bookingRecord);
    if (!settings.preserveNotice) {
      setNotice(elements, "");
    }

    if (state.activeTab === "automatic") await automaticNotifications.ensure();
    if (state.activeTab === "emails") {
      await ensureBookingEmailsLoaded();
    }

    if (state.activeTab === "documents") await bookingDocuments.ensure();

    if (state.bookingWorkspaceRequestId === requestId) {
      const tasksLoaded = bookingTasks.ensure();
      if (state.activeTab === "tasks") await tasksLoaded;
    }

  } catch (error) {
    if (state.bookingWorkspaceRequestId !== requestId) return;
    state.bookingBlueprint = null;
    state.bookingBlueprintLoading = false;
    state.bookingBlueprintError = "";
    setError(elements, "Could not load the selected booking or its booking services.");
    if (settings.throwOnError) throw error;
  } finally {
    if (state.bookingWorkspaceRequestId === requestId) {
      state.bookingWorkspaceLoadingLabel = "";
      renderBookingWorkspace(elements, state);
      clearLoading(elements, state);
    }
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
    if (transitionButton.disabled || state.bookingBlueprintExecuting) return;
    const transitionId = transitionButton.getAttribute("data-blueprint-transition-id") || "";
    const transition = findSelectedBookingBlueprintTransition(transitionId);
    if (!transition || !state.selectedBookingId) {
      setError(elements, "This workflow action is no longer available. Refresh the booking and try again.");
      return;
    }

    transitionButton.disabled = true;
    setError(elements, "");

    try {
      if (/^(?:New\s+Booking\s+Won|Auto[\s-]*Assign(?:\s+Booking\s+Won)?)$/i.test(String(transition.name || transition.next_field_value || "").trim())) {
        await validateBookingWorkdriveForTransition(transition, String(state.selectedBookingId));
      }
      if (isCreateEzusTransition(transition)) {
        const bookingId = String(state.selectedBookingId);
        const extraFields = getBlueprintTransitionFields({ ...transition, fields: (transition.fields || []).filter(field => field && !EZUS_BOOKING_FIELDS.includes(field.api_name)) });
        openCreateEzusDialog({
          bookingId,
          isCurrent: () => String(state.selectedBookingId) === bookingId,
          extraFields: extraFields.map(field => renderBlueprintTransitionField(field, { ...state.selectedBooking, ...transition.data })).join(""),
          collectExtra: form => collectBlueprintTransitionData(extraFields, form),
          onContinue: (bookingData, data) => executeBlueprintTransition(transition, data, bookingId, bookingData)
        });
        return;
      }
      const requiresConfirmation = [transition.name, transition.next_field_value].some(value =>
        /^(?:(?:mark(?:ed)?\s+(?:as\s+)?)?dead|cancelled(?:\s+(?:with|w)\s+charges)?)$/i.test(String(value || "").trim())
      );
      if (getBlueprintTransitionFields(transition).length || requiresConfirmation) {
        openBlueprintTransitionDialog(transition, transition.name || transition.next_field_value || "Workflow action");
        return;
      }
      await executeBlueprintTransition(transition, {});
    } catch (error) {
      if (error?.stage === "missing_workdrive_folder") {
        const bookingId = String(state.selectedBookingId);
        openWorkdriveFolderDialog({ bookingId, isCurrent: () => String(state.selectedBookingId) === bookingId });
      } else {
        setError(elements, error && error.message ? error.message : "The workflow action could not be executed.");
      }
    } finally {
      transitionButton.disabled = false;
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
  const fields = getBlueprintTransitionFields(transition);
  const reservationAssignment = fields.some(field => field.reservationAssignment);
  const commissionTransition = /^(?:New|Auto[\s-]*Assign)\s+Booking\s+Won$/i.test(String(transition.name || transition.next_field_value || "").trim());
  const bookingId = String(state.selectedBookingId);
  if (document.querySelector(".blueprint-transition-dialog")) return;
  const dialog = document.createElement("div");
  const processInfo = state.bookingBlueprint && state.bookingBlueprint.processInfo || {};
  const currentPicklist = processInfo.current_picklist && typeof processInfo.current_picklist === "object" ? processInfo.current_picklist : {};
  const previousState = currentPicklist.value || processInfo.field_value || "Current state";
  const nextState = transition.next_field_value || transitionName;
  const previousColor = normalizeBlueprintColor(currentPicklist.colour_code, "#0f766e");
  const nextColor = normalizeBlueprintColor(transition.color_code, "#2385ef");
  dialog.className = "booking-action-dialog blueprint-transition-dialog" + (commissionTransition ? " create-ezus-dialog" : "") + (reservationAssignment ? " reservation-assignment-dialog" : "");
  const initialData = commissionTransition ? { ...state.selectedBooking, ...transition.data } : transition.data || {};
  const renderFields = list => list.map(field => renderBlueprintTransitionField(field, initialData)).join("");
  const fieldsHtml = commissionTransition
    ? '<div class="ezus-details-columns"><section class="ezus-details-column ezus-details-column--required"><h5>Required details</h5>' + renderFields(fields.filter(field => field.mandatory || field.system_mandatory)) + '</section><section class="ezus-details-column"><h5>Optional details</h5>' + renderFields(fields.filter(field => !field.mandatory && !field.system_mandatory)) + '</section></div>'
    : '<div class="booking-form-grid">' + renderFields(fields) + '</div>';
  dialog.innerHTML = [
    '<div class="booking-action-dialog-panel" role="dialog" aria-modal="true" aria-label="' + escapeHtml(transitionName) + '">',
    '<div class="blueprint-transition-dialog-heading">' + (reservationAssignment ? "" : '<span class="blueprint-transition-dialog-eyebrow">Workflow transition</span>') + '<h4>' + escapeHtml(transitionName) + '</h4>' + (reservationAssignment ? '<button type="button" class="reservation-assignment-close" data-dismiss data-dialog-dismiss aria-label="Close">&times;</button>' : "") + '</div>',
    '<div class="blueprint-transition-route" aria-label="Transition from ' + escapeHtml(previousState) + " to " + escapeHtml(nextState) + '">',
    '  <span class="blueprint-transition-state" style="--blueprint-state-color:' + previousColor + '">' + escapeHtml(previousState) + "</span>",
    '  <span class="blueprint-transition-arrow" aria-hidden="true">â†’</span>',
    '  <span class="blueprint-transition-state" style="--blueprint-state-color:' + nextColor + '">' + escapeHtml(nextState) + "</span>",
    "</div>",
    reservationAssignment ? '<p class="save-behavior-hint">Assign &amp; continue saves the selected representative and moves this booking to <strong>' + escapeHtml(nextState) + '</strong>.</p>' : '<p class="blueprint-transition-confirmation">Are you sure you want to move this booking to <strong>' + escapeHtml(nextState) + '</strong>?</p>',
    commissionTransition ? '<p>Antes de pasar este viaje a Reservas, se sincronizarÃ¡ automÃ¡ticamente el proyecto con Ezus, por lo que es probable que CRM se quede cargando unos segundos.</p>' : "",
    '<form class="booking-form">',
    fields.length ? fieldsHtml : "",
    '<div class="blueprint-transition-error" role="alert" aria-atomic="true"><span class="blueprint-transition-error-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 3v1"/></svg></span><div class="blueprint-transition-error-content"><strong>Could not complete the transition</strong><p data-error hidden></p></div></div>',
    '<div class="booking-action-dialog-footer booking-action-dialog-footer--split"><button class="button tertiary compact" type="button" data-close>Cancel</button><button class="button booking-action-button compact" type="submit"' + (reservationAssignment ? ' disabled' : '') + '>' + (reservationAssignment ? 'Assign &amp; continue' : 'Execute') + '</button></div>',
    "</form></div>"
  ].join("");

  document.body.appendChild(dialog);
  const reservationField = fields.find(field => field.reservationAssignment);
  if (reservationField) populateBlueprintReservationUsers(dialog, reservationField);
  let busy = false;
  const previousFocus = document.activeElement;
  const close = () => { if (!busy) { dialog.reservationSelector?.destroy(); dialog.remove(); previousFocus?.focus(); } };
  dialog.querySelector("[data-close]").addEventListener("click", close);
  dialog.querySelector("[data-dismiss]")?.addEventListener("click", event => { event.stopPropagation(); close(); });
  dialog.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
  dialog.addEventListener("click", function (event) {
    if (event.target === dialog) {
      close();
    }
  });
  dialog.querySelector("form").addEventListener("submit", async function (submitEvent) {
    submitEvent.preventDefault();
    const submitButton = dialog.querySelector('[type="submit"]');
    if (submitButton.disabled || !dialog.querySelector("form").reportValidity()) return;
    const errorMessage = dialog.querySelector("[data-error]");
    errorMessage.hidden = true;
    busy = true;
    submitButton.disabled = true;
    dialog.querySelector("[data-close]").disabled = true;
    if (reservationAssignment) {
      submitButton.textContent = "Assigningâ€¦";
      submitButton.setAttribute("aria-busy", "true");
      dialog.querySelector("[data-dismiss]").disabled = true;
      dialog.querySelector('[name="Reservation_Rep"]').disabled = true;
      dialog.querySelector("[data-reservation-search]").disabled = true;
      dialog.reservationSelector?.setBusy(true);
    }
    try {
      const data = collectBlueprintTransitionData(fields, dialog.querySelector("form"));
      const result = await executeBlueprintTransition(transition, data, bookingId);
      if (result?.partial) throw new Error("The transition was saved partially. Complete its remaining requirements before continuing.");
      busy = false;
      close();
    } catch (error) {
      busy = false;
      if (error.transitionCompleted) {
        close();
        setError(elements, error.message);
        return;
      }
      submitButton.disabled = false;
      dialog.querySelector("[data-close]").disabled = false;
      if (reservationAssignment) {
        submitButton.textContent = "Assign & continue";
        submitButton.removeAttribute("aria-busy");
        dialog.querySelector("[data-dismiss]").disabled = false;
        dialog.querySelector('[name="Reservation_Rep"]').disabled = false;
        dialog.querySelector("[data-reservation-search]").disabled = false;
        dialog.reservationSelector?.setBusy(false);
        submitButton.disabled = !dialog.querySelector('[name="Reservation_Rep"]').value;
      }
      errorMessage.textContent = error && error.message ? error.message : "The workflow action could not be executed.";
      errorMessage.hidden = false;
      setError(elements, error && error.message ? error.message : "The workflow action could not be executed.");
    }
  });
  (dialog.querySelector("input, select, textarea") || dialog.querySelector("[data-close]"))?.focus();
}

function normalizeBlueprintColor(color, fallback) {
  const candidate = String(color || "").trim();
  return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : fallback;
}

function initializeReservationSelector(dialog, options) {
  const trigger = dialog.querySelector('.reservation-selector');
  const panel = dialog.querySelector('.reservation-selector-panel');
  const search = panel.querySelector('input');
  const list = panel.querySelector('[role="listbox"]');
  const value = dialog.querySelector('[name="Reservation_Rep"]');
  const caption = trigger.querySelector('#reservation-rep-value');
  const submit = dialog.querySelector('[type="submit"]');
  const events = new AbortController();
  const listen = (node, type, callback, capture = false) => node.addEventListener(type, callback, { signal: events.signal, capture });
  const normalize = text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  let opened = false, visible = options, active = 0;
  const highlight = () => {
    const items = [...list.children];
    items.forEach((item, index) => item.classList.toggle('is-active', index === active));
    if (items[active]) {
      search.setAttribute('aria-activedescendant', items[active].id);
      items[active].scrollIntoView({ block: 'nearest' });
    } else search.removeAttribute('aria-activedescendant');
  };
  const render = () => {
    visible = options.filter(option => normalize(option.label).includes(normalize(search.value)));
    active = Math.max(0, visible.findIndex(option => option.value === value.value));
    list.innerHTML = visible.map((option, index) => '<div class="reservation-selector-option" role="option" id="reservation-option-' + index + '" data-index="' + index + '" aria-selected="' + (option.value === value.value) + '"><span>' + escapeHtml(option.label) + '</span><span class="reservation-selector-check" aria-hidden="true">âœ“</span></div>').join('');
    panel.querySelector('[data-no-results]').hidden = visible.length > 0;
    highlight();
  };
  const position = () => {
    if (!opened) return;
    const rect = trigger.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const up = below < 240 && above > below;
    const height = Math.min(300, up ? above : below);
    panel.style.width = rect.width + 'px';
    panel.style.maxHeight = Math.max(80, height) + 'px';
    panel.style.left = rect.left + 'px';
    panel.style.top = (up ? rect.top - panel.getBoundingClientRect().height - 6 : rect.bottom + 6) + 'px';
  };
  const close = (focus = true) => {
    if (!opened) return;
    opened = false;
    panel.hidePopover();
    trigger.setAttribute('aria-expanded', 'false');
    if (focus) trigger.focus();
  };
  const open = () => {
    if (trigger.disabled || opened) return;
    opened = true;
    search.value = '';
    panel.showPopover();
    trigger.setAttribute('aria-expanded', 'true');
    render();
    position();
    search.focus();
  };
  const choose = index => {
    if (!visible[index]) return;
    value.value = visible[index].value;
    caption.textContent = visible[index].label;
    submit.disabled = false;
    close();
  };
  listen(trigger, 'click', () => opened ? close() : open());
  listen(trigger, 'keydown', event => {
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); open(); }
  });
  listen(search, 'input', () => { render(); position(); });
  listen(panel, 'keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === 'Tab') close(false);
    if (event.key === 'Enter') { event.preventDefault(); choose(active); }
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      active = visible.length ? (active + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length : 0;
      highlight();
    }
  });
  // Keep the search focused until the option's click has been processed.
  // Otherwise focusout hides the popover before the click reaches the option.
  listen(list, 'pointerdown', event => {
    if (event.target.closest('[data-index]')) event.preventDefault();
  });
  listen(list, 'click', event => {
    const option = event.target.closest('[data-index]');
    if (option) choose(Number(option.dataset.index));
  });
  listen(document, 'pointerdown', event => { if (!panel.contains(event.target) && !trigger.contains(event.target)) close(false); });
  listen(dialog, 'focusout', event => { if (opened && !panel.contains(event.relatedTarget) && !trigger.contains(event.relatedTarget)) close(false); });
  listen(window, 'resize', position);
  listen(document, 'scroll', event => { if (!panel.contains(event.target)) position(); }, true);
  caption.textContent = 'Select reservation representativeâ€¦';
  trigger.disabled = false;
  trigger.focus();
  return { destroy() { close(false); events.abort(); }, setBusy(busy) { close(false); trigger.disabled = busy; } };
}

async function populateBlueprintReservationUsers(dialog, field) {
  const select = dialog.querySelector('[name="Reservation_Rep"]');
  const submit = dialog.querySelector('[type="submit"]');
  select.disabled = true;
  submit.disabled = true;
  try {
    const records = await loadAllUserRelationshipRecords("User_ID,User_Alias,Email,Role,Status");
    const options = buildOwnerOptionsFromUserRelationships(records.filter(record =>
      /^(?:reservations? rep|sales-reservations rep)$/i.test(getUserRelationshipText(record.Role))));
    if (!options.length) throw new Error("No active reservations representatives are available. Check User Relationships and reopen this action.");
    if (!dialog.isConnected) return;
    field.pick_list_values = options.map(option => ({ actual_value: option.value, display_value: option.label }));
    dialog.reservationSelector = initializeReservationSelector(dialog, options);
    select.disabled = false;
  } catch (error) {
    if (!dialog.isConnected) return;
    const message = dialog.querySelector("[data-error]");
    message.textContent = error.message || "Could not load reservations representatives. Reopen this action to retry.";
    message.hidden = false;
  }
}

function renderBlueprintTransitionField(field, initialData) {
  const apiName = String(field.api_name || "");
  const label = field.field_label || field.display_label || apiName;
  const value = initialData[apiName] === undefined || initialData[apiName] === null ? "" : initialData[apiName];
  const required = field.mandatory || field.system_mandatory ? " required" : "";
  const dataType = String(field.data_type || "").toLowerCase();
  const options = Array.isArray(field.pick_list_values) ? field.pick_list_values : [];
  let control;
  if (field.reservationAssignment) {
    return '<div class="reservation-assignment-field field booking-form-field"><span id="reservation-rep-label">Reservation representative <em>*</em></span><input type="hidden" name="' + escapeHtml(apiName) + '"><button type="button" class="reservation-selector" role="combobox" aria-labelledby="reservation-rep-label reservation-rep-value" aria-required="true" aria-haspopup="listbox" aria-controls="reservation-rep-options" aria-expanded="false" disabled><span id="reservation-rep-value">Loading reservations representativesâ€¦</span><svg class="reservation-selector-chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6"/></svg></button><div class="reservation-selector-panel" popover="manual"><input type="search" data-reservation-search role="combobox" aria-label="Search representatives" aria-controls="reservation-rep-options" aria-expanded="true" aria-autocomplete="list" placeholder="Search by name" autocomplete="off"><div id="reservation-rep-options" role="listbox" aria-label="Reservation representatives"></div><p data-no-results role="status" hidden>No results found</p></div></div>';
  } else if (options.length) {
    control = '<select name="' + escapeHtml(apiName) + '"' + required + '><option value="">Selectâ€¦</option>' + options.map(function (option) {
      const optionValue = option.actual_value || option.display_value || option.value || "";
      return '<option value="' + escapeHtml(optionValue) + '"' + (String(optionValue) === String(value) ? " selected" : "") + ">" + escapeHtml(option.display_value || optionValue) + "</option>";
    }).join("") + "</select>";
  } else if (dataType === "boolean") {
    control = '<input name="' + escapeHtml(apiName) + '" type="checkbox"' + (value === true ? " checked" : "") + ">";
  } else if (dataType === "textarea") {
    control = '<textarea name="' + escapeHtml(apiName) + '" rows="3"' + required + ">" + escapeHtml(value) + "</textarea>";
  } else {
    const type = dataType === "date" ? "date" : (dataType === "integer" || dataType === "double" || dataType === "currency" ? "number" : "text");
    control = '<input name="' + escapeHtml(apiName) + '" type="' + type + '" value="' + escapeHtml(value) + '"' + (type === "number" ? ' step="' + (dataType === "integer" ? "1" : "any") + '"' : "") + required + ">";
  }
  return '<label class="field booking-form-field"><span>' + escapeHtml(label) + (required ? " <em>*</em>" : "") + "</span>" + control + "</label>";
}

function collectBlueprintTransitionData(fields, form) {
  const data = {};
  fields.forEach(function (field) {
    const input = form.elements[field.api_name];
    if (!input) return;
    if (input.type === "checkbox") {
      data[field.api_name] = input.checked;
    } else if (input.value !== "") {
      const numeric = ["integer", "double", "currency"].includes(field.data_type);
      const value = numeric ? Number(input.value) : input.value;
      if (numeric && (!Number.isFinite(value) || (field.data_type === "integer" && !Number.isInteger(value)))) {
        throw new Error("Enter a valid number for " + (field.field_label || field.api_name) + ".");
      }
      if (field.reservationAssignment) {
        if (!(field.pick_list_values || []).some(option => String(option.actual_value) === String(value))) {
          throw new Error("Select an available reservation representative.");
        }
        data[field.api_name] = { id: String(value) };
      } else {
        data[field.api_name] = value;
      }
    } else if (field.mandatory || field.system_mandatory) {
      throw new Error("Complete " + (field.field_label || field.api_name) + " before executing this transition.");
    }
  });
  return data;
}

async function validateBookingWorkdriveForTransition(transition, bookingId) {
  const booking = await crmGetRecord(MODULES.bookings, bookingId);
  if (String(state.selectedBookingId) !== bookingId) {
    throw new Error("The selected booking changed. Reopen the workflow action on the correct booking.");
  }
  const folderId = getBookingLinkFieldValue(booking, [
    "Booking Workdrive Folder ID", "Booking_Workdrive_Folder_ID", "Booking_WorkDrive_Folder_ID",
    "BookingWorkdriveFolderID", "Workdrive_Folder_ID"
  ]);
  if (!folderId) {
    throw Object.assign(new Error("This booking should have a WorkDrive folder before the trip is passed to Reservations. Create the folder and fill in the booking's WorkDrive ID before continuing."), { stage: "missing_workdrive_folder" });
  }
  return booking;
}

async function executeBlueprintTransition(transition, data, expectedBookingId, bookingData) {
  const bookingId = String(state.selectedBookingId);
  const workspaceRequestId = state.bookingWorkspaceRequestId;
  if (!state.selectedBookingId || (expectedBookingId && bookingId !== expectedBookingId)) {
    throw new Error("The selected booking changed. Reopen the workflow action on the booking you want to update.");
  }
  if (state.bookingBlueprintExecuting) throw new Error("A workflow action is already running. Wait for it to finish.");
  if (!transition || !transition.id || transition.criteria_matched === false) {
    throw new Error("This workflow action is no longer available. Refresh the booking and try again.");
  }
  const actionUser = {
    id: String(state.currentUserId || "").trim(),
    email: String(state.currentUserEmail || "").trim(),
    name: String(state.currentUserName || "").trim()
  };
  if (!actionUser.id || !actionUser.email || !actionUser.name) {
    throw new Error("Could not identify the current user. Reload the widget before executing this action.");
  }
  state.bookingBlueprintExecuting = true;
  setBlueprintTransitionButtonsBusy(true);
  try {
    // Recheck the user's native permissions before saving fields or creating an
    // Ezus project. A dialog can remain open after permissions/stage change.
    try {
      state.bookingBlueprint = await assertUserBlueprintTransition({
        transition,
        expectedState: String(state.bookingBlueprint?.processInfo?.field_value || ""),
        readBlueprint: () => loadBookingBlueprintForBooking(bookingId, false),
        isCurrent: () => String(state.selectedBookingId) === bookingId && state.bookingWorkspaceRequestId === workspaceRequestId
      });
      state.bookingBlueprintError = "";
    } catch (error) {
      if (String(state.selectedBookingId) === bookingId && state.bookingWorkspaceRequestId === workspaceRequestId) {
        state.bookingBlueprint = null;
        state.bookingBlueprintError = error.message || "Could not check your workflow permissions. Reload the booking.";
        renderBookingSummary(elements, state);
      }
      throw error;
    }
    const workdriveBooking = /^(?:New\s+Booking\s+Won|Auto[\s-]*Assign(?:\s+Booking\s+Won)?)$/i.test(String(transition.name || transition.next_field_value || "").trim())
      ? await validateBookingWorkdriveForTransition(transition, bookingId) : null;
    let ezusBookingDetails;
    if (/^Assign\s+Reservation$/i.test(String(transition.name || "").trim()) && !String(data?.Reservation_Rep?.id || "").trim()) {
      throw new Error("Select a Reservation Rep before executing this transition.");
    }
    if (bookingData) {
      ezusBookingDetails = await saveEzusBookingDetails(bookingId, bookingData, () => {
        if (String(state.selectedBookingId) !== bookingId) throw new Error("The selected booking changed. Reopen the transition on the correct booking.");
      });
      const { referencePrefix: _referencePrefix, ...savedData } = ezusBookingDetails;
      data = { ...data };
      (transition.fields || []).forEach(field => {
        if (field && Object.prototype.hasOwnProperty.call(savedData, field.api_name)) data[field.api_name] = savedData[field.api_name];
      });
    }
    if (/^Auto[\s-]*Assign(?:\s+Booking\s+Won)?$/i.test(String(transition.name || "").trim())) {
      // Read the current Sales Rep; do not use stale dialog data or the logged-in user.
      const booking = workdriveBooking || await crmGetRecord(MODULES.bookings, bookingId);
      const salesRepId = String(booking?.Sales_Rep?.id || "").trim();
      if (!salesRepId) throw new Error("Auto Assign requires a Sales Rep on the booking.");
      data = { ...data, Reservation_Rep: { id: salesRepId } };
    }
    await validateCreateInEzusAgency(transition, bookingId);
    if (String(state.selectedBookingId) !== bookingId) {
      throw new Error("The selected booking changed. Please try the action again on the booking you want to update.");
    }
    if (bookingData && isCreateEzusTransition(transition)) {
      const creationResponse = await crmExecuteFunction("createprojectinezuswithprefix", {
        bookingId,
        referencePrefix: ezusBookingDetails.referencePrefix,
        // Send the validated calendar values, not CRM's user-dependent date representation.
        arrivalDateIso: ezusBookingDetails.Arrival_Date,
        departureDateIso: ezusBookingDetails.Departure_Date
      });
      const creation = extractFunctionPayload(creationResponse);
      if (!creation || creation.error !== false) {
        throw Object.assign(new Error(creation?.message || "Could not confirm Ezus project creation. Check the linked project before retrying."), { stage: creation?.stage });
      }
      if (String(state.selectedBookingId) !== bookingId) return;
      const workspaceRequest = state.bookingWorkspaceRequestId;
      const createdBooking = await confirmCreatedEzusProject(bookingId, () => String(state.selectedBookingId) === bookingId && state.bookingWorkspaceRequestId === workspaceRequest, String(bookingData.referencePrefix || "MFSP").trim().toUpperCase());
      if (!createdBooking) return;
      state.selectedBooking = createdBooking;
    }
    if (/^Assign\s+Reservation$/i.test(String(transition.name || "").trim())) {
      const reservationRep = { id: String(data.Reservation_Rep.id).trim() };
      let saved;
      try {
        saved = await crmUpdateRecord(MODULES.bookings, { id: bookingId, Reservation_Rep: reservationRep });
      } catch (error) {
        throw new Error("Could not save Reservation Rep. The transition was not executed. " + (error?.message || ""));
      }
      if (String(saved?.code || "").toUpperCase() !== "SUCCESS" || String(saved?.status || "").toLowerCase() === "error") {
        throw new Error("Could not save Reservation Rep. The transition was not executed. " + (saved?.message || "CRM did not confirm the update."));
      }
      if (String(state.selectedBookingId) !== bookingId) {
        throw new Error("Reservation Rep was saved on the original booking, but the selected booking changed. The transition was not executed.");
      }
      if (state.selectedBooking) state.selectedBooking.Reservation_Rep = reservationRep;
    }
    const context = {
      recordId: bookingId,
      transitionId: String(transition.id),
      transitionName: transition.name || transition.next_field_value || "Workflow action",
      currentState: String(state.bookingBlueprint && state.bookingBlueprint.processInfo && state.bookingBlueprint.processInfo.field_value || ""),
      submittedFields: Object.keys(data || {}),
      transitionFields: (Array.isArray(transition.fields) ? transition.fields : []).filter(Boolean).map(field => ({
        apiName: field.api_name || "",
        label: field.field_label || field.display_label || "",
        type: field.data_type || "",
        mandatory: Boolean(field.mandatory || field.system_mandatory)
      }))
    };
    let response;
    try {
      response = await crmExecuteFunction("blueprint_executetransition", {
        moduleApiName: MODULES.bookings,
        recordId: bookingId,
        expectedCurrentState: context.currentState,
        transitionId: String(transition.id),
        transitionDataJson: JSON.stringify(data || {}),
        actionUserJSON: JSON.stringify(actionUser)
      });
    } catch (cause) {
      throw buildBlueprintTransitionError(cause, context);
    }
    const payload = extractFunctionPayload(response);
    if ((payload?.transition_completed === true || payload?.transition_outcome_unknown === true) && payload.success !== true) {
      const error = buildBlueprintTransitionError(payload, context);
      error.transitionCompleted = payload.transition_completed === true;
      error.transitionOutcomeUnknown = payload.transition_outcome_unknown === true;
      error.message += error.transitionOutcomeUnknown
        ? " The outcome is unknown. Check CRM history before any retry."
        : " The transition has already completed. Do not repeat it; only the failed follow-up needs recovery.";
      if (String(state.selectedBookingId) === bookingId) {
        // Retire the old action even if the refresh fails or pending edits block it.
        state.bookingBlueprint = null;
        try {
          const refreshed = await loadBookingWorkspace(bookingId, { preserveSelection: true, throwOnError: true });
          if (refreshed === false) error.message += " Save or cancel pending edits, then reload the booking.";
        } catch (_) {
          error.message += " The booking could not be refreshed. Reload it to see its current state.";
        }
      }
      throw error;
    }
    if (!payload || payload.success !== true || getBlueprintFailureDetails(payload).length || getBlueprintFailureDetails(response).length) {
      throw buildBlueprintTransitionError(payload || response, context);
    }
    if (String(state.selectedBookingId) !== bookingId) return;
    state.bookingBlueprintClosingMenuOpen = false;
    setError(elements, "");
    const partial = /transition saved partially/i.test(String(payload.result && payload.result.message || ""));
    await loadBookingWorkspace(bookingId, { preserveSelection: true, waitForEzusProject: !partial && isCreateEzusTransition(transition), ezusReferencePrefix: bookingData?.referencePrefix });
    if (String(state.selectedBookingId) !== bookingId) return;
    if (partial) {
      setNotice(elements, "The transition was saved partially. Complete its remaining requirements before it can finish.");
    }
    return { partial, booking: state.selectedBooking };
  } finally {
    state.bookingBlueprintExecuting = false;
    setBlueprintTransitionButtonsBusy(false);
    if (String(state.selectedBookingId) === String(bookingId)) elements.operationRecovery?.dispatchEvent(new CustomEvent("booking-recovery-refresh"));
  }
}

function setBlueprintTransitionButtonsBusy(busy) {
  if (busy && !setBlueprintTransitionButtonsBusy.loadingDialog) {
    const dialog = document.createElement("dialog");
    dialog.className = "blueprint-loading-dialog";
    dialog.setAttribute("aria-label", "Updating booking status");
    dialog.setAttribute("aria-describedby", "blueprint-loading-message");
    dialog.setAttribute("aria-busy", "true");
    dialog.innerHTML = '<div class="mail-send-spinner" aria-hidden="true"></div><p id="blueprint-loading-message" role="status">Updating booking status… Please wait.</p>';
    dialog.addEventListener("cancel", event => event.preventDefault());
    document.body.appendChild(dialog);
    dialog.showModal();
    setBlueprintTransitionButtonsBusy.loadingDialog = dialog;
  } else if (!busy && setBlueprintTransitionButtonsBusy.loadingDialog) {
    const dialog = setBlueprintTransitionButtonsBusy.loadingDialog;
    dialog.close();
    dialog.remove();
    setBlueprintTransitionButtonsBusy.loadingDialog = null;
  }
  const panel = elements.summaryBlueprintPanel;
  if (!panel || !panel.querySelectorAll) return;
  panel.querySelectorAll("[data-blueprint-transition-id]").forEach(function (button) {
    const id = button.getAttribute("data-blueprint-transition-id");
    const transitions = state.bookingBlueprint && state.bookingBlueprint.transitions || [];
    const transition = transitions.find(item => item && String(item.id) === id);
    button.disabled = busy || !transition || transition.criteria_matched === false;
  });
}

function getBlueprintTransitionFields(transition) {
  const fields = (Array.isArray(transition.fields) ? transition.fields : [])
    .filter(field => field && !field.read_only && !field.field_read_only)
    // Auto Assign supplies this user lookup automatically when submitting.
    .filter(field => !(field.api_name === "Reservation_Rep" &&
      /^Auto[\s-]*Assign(?:\s+Booking\s+Won)?$/i.test(String(transition.name || "").trim())));
  if (/^(?:New|Auto[\s-]*Assign)\s+Booking\s+Won$/i.test(String(transition.name || transition.next_field_value || "").trim())) {
    [
      { api_name: "Final_Commission", field_label: "Agent Commission Amount", data_type: "currency", mandatory: true },
      { api_name: "Agent_Commission_Details", field_label: "Agent Commission Details", data_type: "textarea", mandatory: false }
    ].forEach(definition => {
      const index = fields.findIndex(field => field.api_name === definition.api_name || (field.field_label || field.display_label) === definition.field_label);
      const existing = index >= 0 ? fields[index] : null;
      const field = { ...existing, ...definition, api_name: definition.api_name === "Final_Commission" ? definition.api_name : existing?.api_name || definition.api_name, system_mandatory: false };
      if (index >= 0) fields[index] = field;
      else fields.push(field);
    });
  }
  if (/^Assign\s+Reservation$/i.test(String(transition.name || "").trim())) {
    const definition = { api_name: "Reservation_Rep", field_label: "Reservation Rep", data_type: "userlookup", mandatory: true, reservationAssignment: true };
    const index = fields.findIndex(field => field.api_name === definition.api_name);
    if (index >= 0) fields[index] = { ...fields[index], ...definition };
    else fields.push(definition);
  }
  const supported = ["text", "textarea", "email", "phone", "website", "date", "integer", "double", "currency", "boolean", "picklist"];
  const unsupported = fields.filter(field => !field.api_name || (!field.reservationAssignment && !supported.includes(field.data_type)));
  if (unsupported.length) {
    throw new Error("Complete this transition in the booking's CRM record. The widget cannot edit: " +
      unsupported.map(field => field.field_label || field.display_label || field.api_name || field.data_type || "additional requirements").join(", ") + ".");
  }
  return fields;
}

function getBlueprintFailureDetails(value, depth = 0) {
  if (!value || depth > 10) return [];
  if (typeof value === "string") {
    try { return getBlueprintFailureDetails(JSON.parse(value), depth + 1); } catch (_) { return []; }
  }
  if (Array.isArray(value)) return value.flatMap(item => getBlueprintFailureDetails(item, depth + 1));
  if (typeof value !== "object") return [];
  // Successful CRM leaf responses may contain data/diagnostics with a `code`
  // property; those are not new API errors. Function wrappers use `success`.
  if (String(value.status || "").toLowerCase() === "success") return [];
  const code = String(value.code || "");
  const isFailure = value.success === false || value.error === true || value.status === "error" || (code && code.toLowerCase() !== "success");
  // Only follow response envelopes, never booking/transition field values.
  const envelopes = ["result", "blueprint", "data", "api_response", "response", "responseJSON", "body", "output"];
  if (!isFailure) envelopes.push("details");
  const nested = envelopes
    .flatMap(key => getBlueprintFailureDetails(value[key], depth + 1));
  if (nested.length) return nested;
  if (!isFailure) return [];
  const details = value.details && typeof value.details === "object" ? value.details : {};
  return [{
    code,
    message: String(value.message || ""),
    field: String(details.api_name || value.api_name || ""),
    path: String(details.json_path || ""),
    expectedType: String(details.expected_data_type || ""),
    // Preserve CRM's diagnostics even when it uses an unfamiliar details shape.
    // Do not include the submitted booking data or the full function response.
    crmDetails: details
  }];
}

function buildBlueprintTransitionError(payload, context) {
  const failures = getBlueprintFailureDetails(payload);
  if (!failures.length) {
    failures.push({ code: "", message: payload && payload.message || (typeof payload === "string" ? payload : "Zoho returned no usable error details. Check the booking's current state before trying again.") });
  }
  const reasons = failures.map(function (failure) {
    return [failure.message || "Blueprint transition failed.",
      failure.code ? "Code: " + failure.code + "." : "",
      failure.field ? "Field: " + failure.field + "." : "",
      failure.path ? "Path: " + failure.path + "." : "",
      failure.expectedType ? "Expected type: " + failure.expectedType + "." : ""
    ].filter(Boolean).join(" ");
  });
  const error = new Error(context.transitionName + ": " + [...new Set(reasons)].join(" "));
  error.code = failures[0].code;
  error.details = failures;
  const diagnostic = {
    ...context,
    stage: payload && payload.stage || context.stage || "execute transition",
    failures
  };
  // A text snapshot survives copying the console without expanding objects.
  console.error("[Reservations Manager][Blueprint] Transition failed", diagnostic, JSON.stringify(diagnostic, null, 2));
  return error;
}

async function refreshSelectedBookingAfterSync(bookingId, preserveSelection = true, syncType = "full") {
  if (String(state.selectedBookingId || "") !== String(bookingId)) return;
  assertEzusSyncEditsSaved(state, elements, bookingId, bookingDocuments);
  const scope = String(syncType).replace(/travellers/g, "travelers");
  const refreshServices = scope === "full" || scope.includes("services");
  const refreshTravelers = scope === "full" || scope.includes("travelers");
  if (refreshServices) {
    await loadBookingWorkspace(bookingId, {
      preserveNotice: true, preserveSelection, refreshTravelers,
      preserveTravelers: !refreshTravelers, throwOnError: true, protectPendingEdits: true
    });
  } else {
    const requestId = state.bookingWorkspaceRequestId;
    const booking = await crmGetRecord(MODULES.bookings, bookingId);
    if (String(state.selectedBookingId || "") !== String(bookingId) || state.bookingWorkspaceRequestId !== requestId) return;
    assertEzusSyncEditsSaved(state, elements, bookingId, bookingDocuments);
    if (!booking) throw new Error("Could not refresh booking information after the sync.");
    state.selectedBooking = booking;
    renderBookingWorkspace(elements, state);
    renderBookingSummary(elements, state);
    if (refreshTravelers) {
      await ensureBookingTravelersLoaded(true);
      if (String(state.selectedBookingId || "") !== String(bookingId) || state.bookingWorkspaceRequestId !== requestId) return;
      if (state.travelersError) throw new Error(state.travelersError);
    }
  }
  if (String(state.selectedBookingId || "") !== String(bookingId) || !state.selectedBooking) return;
  const index = state.bookings.findIndex(entry => String(entry.id) === String(bookingId));
  if (index !== -1) state.bookings[index] = state.selectedBooking;
  cacheBookingLookup(state, state.selectedBooking);
  renderBookingBrowserPanel();
}

async function onSyncEzusClick(options) {
  const fromCreateDraft = Boolean(options && options.fromCreateDraft);
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

  try {
    if (!beginEzusSync(state, elements, bookingId, bookingDocuments)) return;
  } catch (error) { setError(elements, error.message); return; }
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

    const payload = extractFunctionPayload(response);
    const errorDetails = getFunctionPayloadErrorDetails(response) || getFunctionPayloadErrorDetails(payload);
    if (errorDetails) throw buildFunctionPayloadError(errorDetails);
    assertEzusSyncConfirmed(payload);

    await refreshSelectedBookingAfterSync(bookingId, !fromCreateDraft);
    // This flow finishes by closing the loading dialog in finally, with no
    // success message. The workspace reload has already cleared selection.
    if (fromCreateDraft) return;
    setNotice(elements, "Booking synchronized successfully. You can now create your drafts.");
  } catch (error) {
    setError(elements, "Could not finish synchronizing and refreshing this booking. " + (error && error.message || "Please try again."));
  } finally {
    endEzusSync(state, bookingId);
    if (String(state.selectedBookingId) === String(bookingId)) elements.operationRecovery?.dispatchEvent(new CustomEvent("booking-recovery-refresh"));
    clearLoading(elements, state);
  }
}

async function onRunAdminEzusSync(syncType, label) {
  if (!getWidgetPermissions(state).adminActions) {
    setError(elements, "This action requires the Administrator profile in User Relationships.");
    return;
  }
  if (!state.selectedBooking) {
    setError(elements, "Load a booking before syncing with Ezus.");
    return;
  }

  if (!state.selectedBooking.Ezus_Project_ID) {
    setError(elements, "This booking does not have Ezus_Project_ID, so the sync cannot start.");
    return;
  }

  const bookingId = state.selectedBooking.id;
  try {
    if (!beginEzusSync(state, elements, bookingId, bookingDocuments)) return;
  } catch (error) { setError(elements, error.message); return; }
  setButtonsDisabled(elements, state, true);
  setError(elements, "");
  setNotice(elements, "Syncing " + label.toLowerCase() + " with Ezus...", { loading: true });

  try {
    const response = await crmExecuteFunction("sync_runprojectfromezus", {
      bookingId: bookingId,
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

    assertEzusSyncConfirmed(payload);
    await refreshSelectedBookingAfterSync(bookingId, true, syncType);
    setNotice(elements, payload && payload.message || label + " synced with Ezus.");
  } catch (error) {
    setError(elements, error && error.message ? error.message : "Could not sync " + label.toLowerCase() + " with Ezus.");
  } finally {
    endEzusSync(state, bookingId);
    if (String(state.selectedBookingId) === String(bookingId)) elements.operationRecovery?.dispatchEvent(new CustomEvent("booking-recovery-refresh"));
    clearLoading(elements, state);
  }
}

async function onSyncContactToEzus() {
  if (!getWidgetPermissions(state).adminActions) {
    setError(elements, "This action requires the Administrator profile in User Relationships.");
    return;
  }
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

  try {
    if (!beginEzusSync(state, elements, booking.id, bookingDocuments)) return;
  } catch (error) { setError(elements, error.message); return; }
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

    assertEzusSyncConfirmed(payload);
    await refreshSelectedBookingAfterSync(booking.id, true, "contact");
    setNotice(elements, payload && payload.message || "Contact synced with Ezus.");
  } catch (error) {
    setError(elements, error && error.message ? error.message : "Could not sync the contact with Ezus.");
  } finally {
    endEzusSync(state, booking.id);
    if (String(state.selectedBookingId) === String(booking.id)) elements.operationRecovery?.dispatchEvent(new CustomEvent("booking-recovery-refresh"));
    clearLoading(elements, state);
  }
}

async function onCreateAxusClick() {
  if (state.creatingAxusItinerary) return;
  if (!state.selectedBooking) {
    showAxusItineraryError("Load a booking before creating it in Axus.");
    return;
  }

  const bookingId = String(state.selectedBooking.id || state.selectedBookingId || "");

  if (!bookingId) {
    showAxusItineraryError("The selected booking does not have a valid ID.");
    return;
  }

  state.axusCreationPayload = null;
  state.creatingAxusItinerary = true;
  showAxusItineraryDialog();
  setError(elements, "");
  setNotice(elements, "");
  setButtonsDisabled(elements, state, true);

  try {
    const response = await crmExecuteFunction("sendfullbookingtoaxus", {
      bookingId: bookingId
    });
    const payload = extractFunctionPayload(response);
    const errorDetails = getFunctionPayloadErrorDetails(payload);

    if (errorDetails) {
      throw buildFunctionPayloadError(errorDetails);
    }

    state.axusCreationPayload = payload;
    await saveCreatedAxusItineraryLink(bookingId, payload);
    if (String(state.selectedBookingId) === bookingId) {
      await loadBookingWorkspace(bookingId, { preserveNotice: true, preserveSelection: true });
      showAxusItinerarySuccess();
    }
  } catch (error) {
    const message = error && error.message ? error.message : "Could not create the AXUS itinerary.";
    showAxusItineraryError(message);
  } finally {
    state.creatingAxusItinerary = false;
    clearLoading(elements, state);
  }
}

async function openAccountingPrepayment(bookingId, prepaymentId) {
  if (String(state.selectedBookingId) !== String(bookingId) && await loadBookingWorkspace(String(bookingId)) === false) return false;
  if (String(state.selectedBooking?.id || "") !== String(bookingId)) throw new Error("The booking in this prepayment link could not be opened.");
  state.activePaymentTab = "prepayments";
  await switchTab("payments");
  if (String(state.selectedBookingId) !== String(bookingId)) return;
  await openPrepaymentDetails(elements, state, prepaymentId);
}

export async function init() {
  initServiceTextSize();
  state.zohoInitDebug = {
    status: "starting",
    sdkDetected: Boolean(window.ZOHO && ZOHO.embeddedApp)
  };
  configureServicesController({
    reloadBookingWorkspace: loadBookingWorkspace,
    syncBooking: function () { return onSyncEzusClick({ fromCreateDraft: true }); }
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
    const reviewNotesNavigation = createReviewNotesNavigation({
      getContextKey: () => state.bookingWorkspaceRequestId + ":" + state.activeTab,
      open: async function (bookingId) {
        if (await loadBookingWorkspace(bookingId) === false) return false;
        if (String(state.selectedBooking?.id || '') !== bookingId) throw new Error('The booking in this Review Notes link could not be opened. Check your access and try again.');
        await switchTab('communication');
        await openBookingCommunicationEditor(state, 'Review_Notes', () => renderBookingSummary(elements, state));
      },
      onError: error => setError(elements, error.message || 'The Review Notes link could not be opened.')
    });
    const bookingNavigation = createReviewNotesNavigation({
      getContextKey: () => state.bookingWorkspaceRequestId + ":" + state.activeTab,
      parseTarget: parseBookingTarget,
      open: async function (bookingId) {
        if (await loadBookingWorkspace(bookingId) === false) return false;
        if (String(state.selectedBooking?.id || '') !== bookingId) throw new Error('The booking in this link could not be opened. Check your access and try again.');
        await switchTab('booking');
      },
      onError: error => setError(elements, error.message || 'The booking link could not be opened.')
    });
    const prepaymentNavigation = createReviewNotesNavigation({
      getContextKey: () => state.bookingWorkspaceRequestId + ":" + state.activeTab,
      parseTarget: parsePrepaymentTarget,
      open: (bookingId, target) => openAccountingPrepayment(bookingId, target.prepaymentId),
      onError: error => setError(elements, error.message || "The prepayment link could not be opened.")
    });
    registerZohoEmbeddedAppListeners(data => {
      bookingNavigation.receive(data);
      reviewNotesNavigation.receive(data);
      prepaymentNavigation.receive(data);
    });
    await ZOHO.embeddedApp.init();
    state.zohoInitDebug = {
      status: "embedded-app-init-ok",
      sdkDetected: true
    };
    renderBookingBrowserPanel();

    // This workspace runs in a CRM web tab; the host controls its viewport.
    // Avoid requesting a fixed popup size through the host panel's resize API.
    state.zohoInitDebug.resize = "managed-by-host";

    await hydrateCurrentUser();
    await hydrateBookingBrowserOwners();
    loadServiceTextSizeForUser(state);
    // Tags are optional: a slow or unavailable catalog must never block Queue.
    initializeBookingTags().catch(function (error) {
      console.warn("[Reservations Manager] Booking tags unavailable:", error && error.message || error);
    });
    await hydrateBookingStageOptions();
    await bootstrapBookingBrowserQueue();
    await bookingNavigation.start();
    await reviewNotesNavigation.start();
    await prepaymentNavigation.start();
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
    console.error("[Reservations Manager] Widget initialization failed", state.zohoInitDebug);
  }
}
