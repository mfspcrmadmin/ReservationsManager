const bulkStatusKey = (userId, bookingId) => "bookingsManager.bulkStatus:" + JSON.stringify([String(userId || ""), String(bookingId)]);

export async function runBulkServiceStatus({ userId, bookingId, serviceIds, target, read, update, isCurrent, storage }) {
  const key = bulkStatusKey(userId, bookingId);
  let operation;
  try { const raw = storage.getItem(key); operation = raw ? JSON.parse(raw) : null; }
  catch (_) { throw new Error("Bulk status recovery could not be read. Check CRM before trying again."); }
  if (operation && (operation.bookingId !== bookingId || !Array.isArray(operation.rows) || !operation.target || operation.rows.some(row => !row || typeof row.id !== "string" || !row.id || !["pending", "confirmed", "failed", "uncertain"].includes(row.status)))) throw new Error("Bulk status recovery needs review in CRM.");
  if (operation && operation.target !== target) {
    if (operation.rows.some(row => row.status === "uncertain")) throw new Error("A previous status update is unconfirmed. Select " + operation.target + " to check its pending services before changing the target status.");
    operation = null;
  }
  operation ||= { bookingId, target, rows: [] };
  for (const id of serviceIds.map(String)) if (!operation.rows.some(row => row.id === id)) operation.rows.push({ id, status: "pending", message: "" });
  const save = () => {
    try { storage.setItem(key, JSON.stringify(operation)); }
    catch (_) { throw new Error("Bulk status recovery could not be saved. No further writes were started. Check CRM before continuing."); }
  };
  save();
  const selected = new Set(serviceIds.map(String));
  for (const row of operation.rows) {
    if (!isCurrent()) break;
    if (row.status === "confirmed") continue;
    if (!selected.has(row.id)) continue;
    let record;
    try {
      record = await read(row.id);
      if (!isCurrent()) break;
      if (String(record?.id || "") !== row.id || String(record.Booking?.id || "") !== bookingId) throw new Error("The service could not be verified for this booking.");
      if (!Object.prototype.hasOwnProperty.call(record, "Status_EZUS")) throw new Error("The service status is unavailable. Check field access before continuing.");
    } catch (error) {
      // Failed verification cannot resolve a previous uncertain write.
      if (row.status !== "uncertain") row.status = "failed";
      row.message = error.message;
      save();
      continue;
    }
    if (record.Status_EZUS === target) {
      row.status = "confirmed";
      row.message = "Target status verified in CRM; no write repeated.";
      save();
      continue;
    }
    if (row.status === "uncertain") {
      row.message = "Previous save remains unconfirmed. Check CRM; this write will not be repeated.";
      save();
      continue;
    }
    if (row.originalStatus !== undefined && row.originalStatus !== record.Status_EZUS) {
      row.status = "failed";
      row.message = "The service status changed since this operation began. Review CRM before continuing.";
      save();
      continue;
    }
    row.originalStatus = record.Status_EZUS;
    row.status = "uncertain";
    row.message = "Save started; confirmation pending.";
    save(); // Journal BEFORE the write, including across a widget reload.
    try {
      const result = await update(row.id, target);
      if (String(result?.code || "").toUpperCase() !== "SUCCESS" || (result.status != null && String(result.status).toLowerCase() !== "success") || String(result.details?.id || result.id || "") !== row.id) throw new Error("CRM did not confirm this service update.");
      row.status = "confirmed";
      row.message = "Status update confirmed by CRM.";
    } catch (error) {
      row.status = error.resultUncertain === false ? "failed" : "uncertain";
      row.message = error.message || "CRM did not confirm this service update.";
    }
    save();
  }
  operation.complete = operation.rows.every(row => row.status === "confirmed");
  if (operation.complete) {
    try { storage.removeItem(key); } catch (_) { /* Keeping confirmed recovery cannot repeat writes. */ }
  }
  return operation;
}

export function bulkServiceStatusSummary(operation) {
  const count = status => operation.rows.filter(row => row.status === status).length;
  return "Services: " + count("confirmed") + " confirmed, " + count("failed") + " failed, " + count("uncertain") + " unconfirmed, " + count("pending") + " not attempted.";
}
