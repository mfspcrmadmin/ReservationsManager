export function assertEzusSyncEditsSaved(state, elements, bookingId, documents) {
  if (String(state.selectedBookingId) !== String(bookingId)) return;
  const service = state.selectedService;
  const notesChanged = service && elements.fieldServiceNotes &&
    elements.fieldServiceNotes.value !== String(service.Service_Notes || "");
  const statusChanged = service && state.serviceStatusDraftValue &&
    state.serviceStatusDraftValue !== service.Status_EZUS;
  if (notesChanged || statusChanged || state.serviceStatusSaving || state.draftEditorOpen ||
    state.communicationContentEditorOpen || state.communicationInlineEdit || state.draftEditorSaving ||
    state.draftSending || documents?.hasPendingChanges?.()) {
    throw new Error("Save or cancel your pending changes before synchronizing or reloading this booking.");
  }
}

export function beginEzusSync(state, elements, bookingId, documents) {
  const key = String(bookingId);
  state.syncingEzusBookingIds ||= {};
  if (state.syncingEzusBookingIds[key]) return false;
  assertEzusSyncEditsSaved(state, elements, bookingId, documents);
  state.syncingEzusBookingIds[key] = true;
  state.syncingEzus = true;
  return true;
}

export function endEzusSync(state, bookingId) {
  delete state.syncingEzusBookingIds?.[String(bookingId)];
  state.syncingEzus = Object.keys(state.syncingEzusBookingIds || {}).length > 0;
}

export function assertEzusSyncConfirmed(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
    (payload.success !== true && payload.error !== false) || payload.success === false ||
    payload.error === true || payload.error === "true" || payload.status === "error" ||
    payload.partial === true || payload.dry_run === true || payload.operation_pending === true || payload.completed === false ||
    ["stepSyncErrors", "serviceSyncErrors", "inactiveStepDeleteJobErrors"].some(key => payload[key]?.length)) {
    throw new Error(payload?.message || "CRM did not confirm that synchronization completed. Check the booking before retrying.");
  }
}
