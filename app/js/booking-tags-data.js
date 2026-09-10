export const TAG_CATALOG_FIELD = "Booking_Tag_Catalog_JSON";
export const BOOKING_TAGS_FIELD = "Booking_Tags_JSON";
export const TAG_JSON_LIMIT = 30000;

function objectJson(raw, empty) {
  if (raw === null || raw === undefined || raw === "") return empty;
  let value;
  try { value = typeof raw === "string" ? JSON.parse(raw) : raw; }
  catch (_) { throw new Error("The saved tags contain invalid JSON. Ask an administrator to repair the field."); }
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1) {
    throw new Error("The saved tags have an unsupported format. They have not been overwritten.");
  }
  return value;
}

export function parseTagCatalog(raw) {
  const value = objectJson(raw, { version: 1, tags: [] });
  const ids = new Set();
  if (!Array.isArray(value.tags) || value.tags.some(tag => {
    if (!tag || typeof tag.id !== "string" || !/^[\w-]{1,100}$/.test(tag.id) || ids.has(tag.id) ||
      typeof tag.name !== "string" || !tag.name.trim() || tag.name.length > 60 || !/^#[\da-f]{6}$/i.test(tag.color)) return true;
    ids.add(tag.id);
    return false;
  })) {
    throw new Error("The saved tag catalog is invalid. It has not been overwritten.");
  }
  return value;
}

export function parseBookingTags(raw) {
  const value = objectJson(raw, { version: 1, users: {} });
  if (!value.users || typeof value.users !== "object" || Array.isArray(value.users) ||
    Object.entries(value.users).some(([key, ids]) => !/^\d+$/.test(key) || !Array.isArray(ids) || ids.some(id => typeof id !== "string"))) {
    throw new Error("The saved booking tags are invalid. They have not been overwritten.");
  }
  return value;
}

export function mergeBookingTags(raw, userRelationshipId, ids) {
  if (!/^\d+$/.test(userRelationshipId)) throw new Error("Your User Relationships record could not be identified.");
  const value = parseBookingTags(raw);
  return { ...value, users: { ...value.users, [userRelationshipId]: [...new Set(ids)] } };
}

export function serializeTags(value) {
  const json = JSON.stringify(value);
  if (json.length > TAG_JSON_LIMIT) throw new Error("The tag field is full. Remove unused tags before saving.");
  return json;
}

export function validateTag(name, color, tags, editingId) {
  const normalized = String(name || "").trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 60) throw new Error("Enter a tag name between 1 and 60 characters.");
  if (!/^#[\da-f]{6}$/i.test(color)) throw new Error("Choose a valid tag color.");
  if (tags.some(tag => tag.id !== editingId && tag.name.trim().toLocaleLowerCase() === normalized.toLocaleLowerCase())) {
    throw new Error("You already have a tag with this name.");
  }
  return { name: normalized, color };
}
