import { escapeHtml, getLookupName } from "./utils.js";

function value(booking, keys) {
  for (const key of keys) {
    const raw = booking[key];
    const text = raw && typeof raw === "object" ? getLookupName(raw) : String(raw ?? "").trim();
    if (text && text !== "-") return text;
  }
  return "";
}

function missing(label = "Not provided") {
  return '<span class="overview-missing">' + label + '</span>';
}

function chips(booking, keys, tone = "") {
  const raw = keys.map(key => booking[key]).find(item => item !== null && item !== undefined && item !== "" && (!Array.isArray(item) || item.length));
  const items = (Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,;]/) : [raw])
    .map(item => item && typeof item === "object" ? getLookupName(item) : String(item ?? "").trim()).filter(item => item && item !== "-");
  return items.length ? '<div class="overview-chips">' + [...new Set(items)].map(item => '<span class="overview-chip ' + tone + '">' + escapeHtml(item) + '</span>').join("") + '</div>' : missing();
}

function dateValue(raw) {
  const day = String(raw || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return missing();
  const date = new Date(day + "T00:00:00Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) return missing();
  const formatted = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
  return '<strong><time datetime="' + day + '">' + escapeHtml(formatted) + '</time></strong>';
}

function person(booking, role, keys, owner = false) {
  const name = value(booking, keys);
  const words = name.split(/\s+/).filter(Boolean);
  const initials = words.length ? (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase() : "–";
  return '<li class="overview-person' + (owner ? ' overview-person--owner' : '') + '"><span class="overview-avatar' + (!name ? ' overview-avatar--empty' : '') + '" aria-hidden="true">' + escapeHtml(initials) + '</span><div><span class="overview-person-role">' + role + '</span>' + (name ? '<strong>' + escapeHtml(name) + '</strong>' : missing("Not assigned")) + '</div></li>';
}

export function renderBookingOverview(booking, duration) {
  const travelers = value(booking, ["Travellers_Number", "Travelers_Number", "Number_of_Travelers"]);
  const client = value(booking, ["Client_Name", "Account_Name", "Agency"]);
  const contact = value(booking, ["Contact_Name", "Primary_Contact"]);
  const email = value(booking, ["Agent_Email", "Travel_Agent_Email"]);
  const emailLink = email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const copyIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/></svg>';
  return '<div class="booking-overview">' +
    '<div class="overview-column"><section class="overview-section overview-trip"><h2>Trip overview</h2>' +
    '<div class="overview-trip-facts"><div class="overview-date-range"><div><span class="overview-label">Arrival</span>' + dateValue(booking.Arrival_Date) + '</div><span class="overview-date-arrow" aria-hidden="true">→</span><div><span class="overview-label">Departure</span>' + dateValue(booking.Departure_Date) + '</div></div>' +
    '<div class="overview-trip-numbers"><div><span class="overview-label">Duration</span>' + (duration && duration !== "-" ? '<strong>' + escapeHtml(duration) + '</strong>' : missing()) + '</div><div><span class="overview-label">Travelers</span>' + (travelers ? '<strong>' + escapeHtml(travelers) + '</strong>' : missing()) + '</div></div></div></section>' +
    '<section class="overview-section"><h2>Trip profile</h2><dl class="overview-profile">' +
    '<div><dt>Countries visited</dt><dd>' + chips(booking, ["Countries_Visited"], "overview-chip--country") + '</dd></div>' +
    '<div><dt>Traveler type</dt><dd>' + chips(booking, ["Traveler_Type", "Traveller_Type", "Travellers_Type"]) + '</dd></div>' +
    '<div><dt>Trip type</dt><dd>' + chips(booking, ["Trip_Type"]) + '</dd></div>' +
    '<div><dt>Department</dt><dd>' + chips(booking, ["Department"]) + '</dd></div></dl></section></div>' +
    '<div class="overview-column"><section class="overview-section overview-client"><h2>Client &amp; contact</h2><div class="overview-client-identity"><span class="overview-label">Client / agency</span>' + (client ? '<strong class="overview-client-name">' + escapeHtml(client) + '</strong>' : missing()) + chips(booking, ["Client_Type"], "overview-chip--client") + '</div>' +
    '<div class="overview-contact"><span class="overview-label">Contact</span>' + (contact ? '<strong>' + escapeHtml(contact) + '</strong>' : missing()) + '<div class="overview-email">' +
    (email ? (emailLink ? '<a href="mailto:' + escapeHtml(encodeURIComponent(email)) + '">' + escapeHtml(email) + '</a>' : '<span>' + escapeHtml(email) + '</span>') + '<button type="button" class="overview-copy-email" data-overview-copy-email="' + escapeHtml(email) + '" aria-label="Copy email" title="Copy email">' + copyIcon + '</button><span class="overview-copy-status" role="status"></span>' : missing("Email not provided")) + '</div></div></section>' +
    '<section class="overview-section"><h2>Assigned team</h2><ul class="overview-team">' +
    person(booking, "Booking owner", ["Owner"], true) +
    person(booking, "Sales", ["Sales_Rep", "Sales_Representative", "Salesperson"]) +
    person(booking, "Reservations", ["Reservation_Rep", "Reservations_Rep", "Reservations_Representative"]) +
    person(booking, "Accounting", ["Accounting_Rep", "Accounting_Representative"]) +
    person(booking, "Guest relations", ["Guest_Relations_Rep", "Guest_Relations_Representative"]) +
    person(booking, "24h", ["Hour_Rep", "Rep_24h", "24h_Rep", "TwentyFourHour_Rep", "TwentyFour_Hour_Rep"]) +
    '</ul></section></div></div>';
}

export async function copyOverviewEmail(button) {
  const email = button.dataset.overviewCopyEmail;
  const status = button.parentElement.querySelector('[role="status"]');
  button.disabled = true;
  try {
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(email); copied = true; }
    } catch (_) { /* Embedded CRM may restrict the Clipboard API. */ }
    if (!copied) {
      const input = document.createElement("textarea");
      input.value = email; input.style.cssText = "position:fixed;left:-9999px;top:0";
      document.body.append(input);
      try { input.select(); copied = document.execCommand("copy"); } finally { input.remove(); }
    }
    status.textContent = copied ? "Copied" : "Select the email to copy it.";
  } catch (_) { status.textContent = "Select the email to copy it."; }
  finally { button.disabled = false; if (button.isConnected) button.focus(); }
}
