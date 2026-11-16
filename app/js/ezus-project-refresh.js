import { crmGetRecord } from "./api.js";

// Project creation may update CRM shortly after the Blueprint finishes.
export async function loadBookingWithEzusProject(bookingId, isCurrent, pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)), expectedPrefix = "") {
  let booking = await crmGetRecord("Deals", bookingId);
  for (let attempt = 0; attempt < 10; attempt++) {
    const projectId = String(booking?.Ezus_Project_ID || "").trim();
    const prefix = String(expectedPrefix || "").trim();
    const number = String(booking?.MFSP_Reference || "");
    const referenceReady = !prefix || (number.startsWith(prefix) && number.length > prefix.length);
    if (!isCurrent() || (projectId && !["-", "null", "undefined"].includes(projectId.toLowerCase()) && referenceReady)) return booking;
    await pause(1500);
    if (!isCurrent()) return booking;
    try {
      const updated = await crmGetRecord("Deals", bookingId);
      if (updated && String(updated.id) === String(bookingId)) booking = updated;
    } catch (_) { /* Keep the last successful read if a retry fails. */ }
  }
  return booking;
}

export async function confirmCreatedEzusProject(bookingId, isCurrent, expectedPrefix = "") {
  const booking = await loadBookingWithEzusProject(bookingId, isCurrent, undefined, expectedPrefix);
  if (!isCurrent()) return null;
  const projectId = String(booking?.Ezus_Project_ID || "").trim();
  if (String(booking?.id) !== String(bookingId) || !projectId || ["-", "null", "undefined"].includes(projectId.toLowerCase())) {
    throw new Error("Ezus project creation was acknowledged, but CRM has not confirmed Ezus_Project_ID yet. The workflow has not been executed. Refresh the booking and check the existing project before retrying creation.");
  }
  const reference = String(booking.MFSP_Reference || "");
  if (expectedPrefix && (!reference.startsWith(expectedPrefix) || reference.length <= expectedPrefix.length)) {
    throw new Error("The Ezus project is linked, but CRM has not confirmed the requested " + expectedPrefix + " reference. The workflow has not been executed. Check the existing project before retrying.");
  }
  return booking;
}
