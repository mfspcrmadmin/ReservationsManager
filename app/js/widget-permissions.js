const value = input => String(input && typeof input === "object" ? input.id || input.name || input.display_value || input.label || input.value || "" : input ?? "").trim();
export const normalizeWidgetProfile = input => value(input).replace(/\s+/g, " ").toLowerCase();

// Existing business privileges only: a profile name never implies native CRM
// access or permission to execute a Blueprint transition.
export const WIDGET_PROFILE_PERMISSIONS = Object.freeze(Object.fromEntries([
  "Standard", "Sales Standard", "Reservations Standard", "Sales-Res Standard",
  "Finance Standard", "Product Standard", "Administrator", "Finance Administrator", "Product Administrator"
].map(profile => [normalizeWidgetProfile(profile), Object.freeze({
  adminActions: profile === "Administrator",
  manageDocuments: profile === "Administrator",
  managePrepaymentRequester: ["Administrator", "Finance Administrator"].includes(profile),
  overridePrepaymentCutoff: ["Administrator", "Finance Administrator"].includes(profile),
  editableTagFields: Object.freeze(profile === "Administrator" ? ["Sales_Tags_JSON", "Reservations_Tags_JSON"] : profile === "Sales Standard" ? ["Sales_Tags_JSON"] : ["Reservations Standard", "Sales-Res Standard"].includes(profile) ? ["Reservations_Tags_JSON"] : [])
})])));

export function resolveWidgetRelationship(state, records = state.bookingTagRelationships || []) {
  const id = value(state.currentUserId), email = value(state.currentUserEmail).toLowerCase();
  if (!id || !email || !Array.isArray(records)) return null;
  const candidates = records.filter(row => value(row?.User_ID) === id || value(row?.Email).toLowerCase() === email);
  if (candidates.length !== 1) return null;
  const row = candidates[0];
  if (value(row.User_ID) !== id || value(row.Email).toLowerCase() !== email ||
      normalizeWidgetProfile(row.Status) !== "active" ||
      (row.Record_Status__s != null && normalizeWidgetProfile(row.Record_Status__s) !== "available") ||
      !WIDGET_PROFILE_PERMISSIONS[normalizeWidgetProfile(row.Profile)]) return null;
  return row;
}

export function getWidgetPermissions(state, records) {
  const relationship = resolveWidgetRelationship(state, records);
  return relationship ? WIDGET_PROFILE_PERMISSIONS[normalizeWidgetProfile(relationship.Profile)] : Object.freeze({
    adminActions: false, manageDocuments: false, managePrepaymentRequester: false, overridePrepaymentCutoff: false, editableTagFields: Object.freeze([])
  });
}
