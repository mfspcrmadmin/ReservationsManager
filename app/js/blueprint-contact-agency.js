import { crmGetRecord } from "./api.js";

function lookupId(value) {
  return String(value && typeof value === "object" ? value.id || "" : value || "").trim();
}

export async function validateCreateInEzusAgency(transition, bookingId) {
  const name = String(transition && (transition.name || transition.next_field_value) || "").trim();
  if (!/^create\s+in\s+ezus$/i.test(name)) return;

  // Read current associations: the booking may have been edited outside the widget.
  let booking;
  try { booking = await crmGetRecord("Deals", bookingId); }
  catch (_) { throw new Error("We couldn't check this booking's agency and contact. Please try again. The booking has not been created in Ezus."); }
  if (!booking || String(booking.id) !== String(bookingId)) {
    throw new Error("We couldn't load this booking to check its agency and contact. Refresh the booking and try again.");
  }
  const agencyId = lookupId(booking.Account_Name);
  const contactId = lookupId(booking.Contact_Name);
  if (!agencyId || !contactId) {
    throw new Error("Before creating this booking in Ezus, select both an agency and a contact on the booking. The contact must belong to that same agency. Save the changes and try Create in Ezus again.");
  }

  let contact;
  try { contact = await crmGetRecord("Contacts", contactId); }
  catch (_) { throw new Error("We couldn't check which agency the booking's contact belongs to. Please try again. The booking has not been created in Ezus."); }
  if (!contact || String(contact.id) !== contactId || !Object.prototype.hasOwnProperty.call(contact, "Account_Name")) {
    throw new Error("We couldn't verify the contact's agency. Check that you can access the contact and its agency, then try Create in Ezus again.");
  }
  const contactAgencyId = lookupId(contact.Account_Name);
  if (contactAgencyId === agencyId) return;

  const contactName = contact.Full_Name || booking.Contact_Name.name || "The selected contact";
  const bookingAgency = booking.Account_Name.name || "the booking's agency";
  const contactAgency = contact.Account_Name && contact.Account_Name.name || "a different agency";
  const explanation = contactAgencyId
    ? contactName + " belongs to “" + contactAgency + "”, but this booking is associated with “" + bookingAgency + "”."
    : contactName + " is not associated with any agency, but this booking is associated with “" + bookingAgency + "”.";
  const options = contactAgencyId
    ? "1. Change the booking's agency to the agency the contact belongs to.\n2. Move the contact to the agency associated with this booking."
    : "Associate the contact with the booking's agency. If the booking's agency is incorrect, first change it to the correct agency and associate the contact with that same agency.";
  throw new Error("This booking cannot be created in Ezus because its contact and agency do not match.\n\n" + explanation +
    "\n\nTo continue:\n" + options + "\n\nSave your changes, then try Create in Ezus again.");
}
