import { crmGetRecord, crmSearchRecord, crmExecuteFunction } from "./api.js";
import { escapeHtml } from "./utils.js";

export const AUTOMATIC_STATUSES = ["Queued", "Sending", "Sent", "Failed", "Unknown", "Skipped"];
export function assertCommunicationBooking(row, bookingId) {
  if (!row || String(row.Booking?.id || "") !== String(bookingId)) throw new Error("Communication access could not be verified for this booking.");
}
export async function loadBookingCommunications(bookingId, search = crmSearchRecord, automaticOnly = false) {
  if (!/^\d+$/.test(String(bookingId))) throw new Error("Load a booking first.");
  const rows = [], seen = new Set();
  for (let page = 1; page <= 10; page++) {
    const criteria = automaticOnly ? `((Booking:equals:${bookingId})and(Execution_Mode:equals:Automatic))` : `(Booking:equals:${bookingId})`;
    const batch = await search("Communications", criteria, page, 200);
    for (const row of batch) {
      assertCommunicationBooking(row, bookingId);
      if (!Object.prototype.hasOwnProperty.call(row, "Execution_Mode")) throw new Error("Execution mode is unavailable. Check Communications field access.");
      if (seen.has(String(row.id))) throw new Error("Repeated communications results. Please refresh.");
      seen.add(String(row.id)); rows.push(row);
    }
    if (batch.length < 200) return rows;
  }
  throw new Error("The communications result limit was reached. No complete list was confirmed.");
}
export function excludeAutomaticMail(records, communications) {
  const byId = new Map(communications.map(row => [String(row.id), row]));
  return records.filter(row => {
    const communication = byId.get(String(row.communication_id));
    if (!communication) throw new Error("Communication access could not be verified. Refresh Emails.");
    return communication.Execution_Mode !== "Automatic";
  });
}
export function notificationDate(row) { return row.Sent_At || row.Created_Time || ""; }
export function automaticRows(rows) {
  return rows.filter(row => row.Execution_Mode === "Automatic").sort((a, b) => (Date.parse(notificationDate(b)) || 0) - (Date.parse(notificationDate(a)) || 0) || String(b.id).localeCompare(String(a.id)));
}
export function archiveInfo(row) {
  try { return (typeof row.Render_Model_JSON === "string" ? JSON.parse(row.Render_Model_JSON) : row.Render_Model_JSON)?.native_email_archive || {}; } catch (_) { return {}; }
}
export function selectArchivedBody(row, drafts) {
  const archive = archiveInfo(row);
  if (archive.storage && archive.storage !== "__email_drafts") return "";
  const draft = archive.draft_id ? drafts.find(item => String(item.id) === String(archive.draft_id)) : drafts.length === 1 ? drafts[0] : null;
  if (!draft) return "";
  const body = typeof draft?.content === "string" ? draft.content : "";
  if (archive.html_characters && body.length !== Number(archive.html_characters)) throw new Error("The archived email content could not be verified as complete.");
  return body;
}
export async function readArchivedBody(row, bookingId, get = crmGetRecord, read = readDrafts) {
  const fresh = await get("Communications", row.id);
  assertCommunicationBooking(fresh, bookingId);
  if (String(fresh.id) !== String(row.id)) throw new Error("The requested communication could not be verified.");
  if (fresh.Execution_Mode !== "Automatic") throw new Error("This communication is no longer an automatic notification.");
  return { row: fresh, body: selectArchivedBody(fresh, await read(fresh.id)) };
}
export async function readDrafts(id, execute = crmExecuteFunction) {
  // Reuse the published v8 native-draft reader, after the CRM access and
  // booking checks in readArchivedBody. This function only reads drafts.
  let result = await execute("email_getmoduleemaildrafts", { module: "Communications", recordId: String(id) });
  for (let depth = 0; depth < 8; depth++) {
    if (typeof result === "string") { result = JSON.parse(result); continue; }
    if (!result || result.error || result.success === false || String(result.status).toLowerCase() === "error" || (result.code && result.code !== "success" && result.code !== "SUCCESS")) break;
    if (Array.isArray(result.data)) {
      // The published reader stops after ten pages of ten drafts.
      if (result.data.length >= 100) throw new Error("The email archive result limit was reached.");
      return result.data;
    }
    if (result.details?.output !== undefined) { result = result.details.output; continue; }
    break;
  }
  throw new Error("Could not read the archived email content. Check CRM access and try again.");
}
export function isolatedEmailDocument(body) {
  // Opaque sandbox origin; no scripts, forms, navigation, frames or network requests.
  const template = document.createElement("template");
  template.innerHTML = body;
  template.content.querySelectorAll("script,meta,base,iframe,frame,frameset,object,embed,form,link,svg,math").forEach(node => node.remove());
  template.content.querySelectorAll("*").forEach(node => {
    for (const attribute of Array.from(node.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || ["href", "srcdoc", "action", "formaction", "target", "ping", "srcset", "background"].includes(name) || (name === "src" && !(node.tagName === "IMG" && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(attribute.value)))) node.removeAttribute(attribute.name);
    }
  });
  body = template.innerHTML;
  return '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; img-src data:; base-uri &#39;none&#39;; form-action &#39;none&#39;"><style>html{overflow-wrap:anywhere}body{margin:12px}img{max-width:100%}</style></head><body>' + body + '</body></html>';
}
function dateLabel(row) {
  const date = new Date(notificationDate(row));
  return Number.isFinite(date.getTime()) ? date.toLocaleString("en-GB") : "Date unavailable";
}
function title(row) { return row.Rendered_Subject || row.Communication_Purpose || "Automatic notification"; }
function badge(row) {
  const status = AUTOMATIC_STATUSES.includes(row.Communication_Status) ? row.Communication_Status : "Unknown";
  return `<span class="automatic-status automatic-status--${status.toLowerCase()}"><span aria-hidden="true">${status === "Sent" ? "✓" : status === "Failed" ? "!" : "●"}</span> ${escapeHtml(status)}</span>`;
}
export function recipientAddresses(value) {
  const text = String(value || "");
  const addresses = text.match(/[A-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Z0-9.-]+/gi) || text.split(/[,;\n]+/);
  return Array.from(new Map(addresses.map(address => [address.trim().toLowerCase(), address.trim()])).values()).filter(Boolean);
}
export function recipientSummary(value) {
  const addresses = recipientAddresses(value);
  return addresses.length ? addresses[0] + (addresses.length > 1 ? ` +${addresses.length - 1} recipient${addresses.length === 2 ? "" : "s"}` : "") : "Not specified";
}
function recipientDetail(value) {
  const addresses = recipientAddresses(value);
  const chips = addresses.map(address => `<span class="automatic-address">${escapeHtml(address)}</span>`);
  return chips.length > 1 ? `<span class="automatic-address">${escapeHtml(addresses[0])}</span><details class="automatic-addresses"><summary>Show all ${addresses.length} recipients</summary><div class="automatic-address-list">${chips.join("")}</div></details>` : chips[0] || "Not specified";
}
function notificationDetail(row, body, archiveError) {
  return `<div class="automatic-envelope"><dl>${[["From", row.Sender_Email], ["To", row.Recipient_To], ["CC", row.Recipient_CC], ["BCC", row.Recipient_BCC]].filter(([label, value]) => value || ["From", "To"].includes(label)).map(([label, value]) => `<dt>${label}</dt><dd>${recipientDetail(value)}</dd>`).join("")}</dl>${row.Communication_Status === "Sent" ? '<p class="automatic-send-note">CRM accepted the send request. Delivery to each recipient is not confirmed.</p>' : ""}${row.Delivery_Error ? `<p class="automatic-error" role="note">Send error: ${escapeHtml(row.Delivery_Error)}</p>` : ""}</div><div class="automatic-email-content"><h3>Email content</h3>${body ? '<iframe title="Archived email content" sandbox="" referrerpolicy="no-referrer"></iframe>' : '<p class="automatic-content-empty">Email content is not available</p>'}${archiveError ? `<p class="automatic-error">${escapeHtml(archiveError)}</p>` : ""}</div><details class="automatic-diagnostics"><summary>Diagnostic details</summary><dl>${[["Source function", row.Source_Function], ["Trigger reason", row.Trigger_Reason], ["Render status", row.Render_Status], ["Render error", row.Render_Error], ["Template ID", row.Native_Template_ID], ["Provider message ID", row.Provider_Message_ID], ["Communication ID", row.id], ["Archive storage", archiveInfo(row).storage]].filter(([,value]) => value).map(([label,value]) => `<dt>${label}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl></details>`;
}
export function createAutomaticNotificationsController(elements, state, options = {}) {
  const panel = elements.manageAutomaticPanel;
  let generation = 0, loadedBooking = "", loading = false, rows = [], selected = "";
  if (!panel) return { reset() {}, async ensure() {} };
  panel.innerHTML = '<div class="automatic-toolbar"><div><button type="button" class="button tertiary compact automatic-back" data-automatic-back><span aria-hidden="true">&larr;</span> Back to Emails</button><h2 tabindex="-1">Automatic notifications</h2><p>Read-only history of automated booking emails.</p></div><button type="button" class="button tertiary icon-button" data-automatic-refresh aria-label="Refresh automatic notifications" title="Refresh automatic notifications">&#8635;</button></div><div class="automatic-list-status" data-automatic-status role="status" aria-live="polite"></div><div data-automatic-list></div>';
  const message = panel.querySelector('[data-automatic-status]'), list = panel.querySelector('[data-automatic-list]'), refresh = panel.querySelector('[data-automatic-refresh]');
  panel.querySelector('[data-automatic-back]').addEventListener("click", () => options.onBack?.());
  function reset() { generation++; loadedBooking = ""; rows = []; selected = ""; loading = false; list.replaceChildren(); message.textContent = ""; refresh.disabled = false; }
  async function ensure(force = false) {
    const booking = String(state.selectedBookingId || "");
    if (!booking || !state.selectedBooking) { reset(); message.textContent = "Load a booking to view automatic notifications."; return; }
    if (!force && (loadedBooking === booking || loading)) return;
    const token = ++generation; loading = true; refresh.disabled = true; list.replaceChildren(); message.textContent = "Loading automatic notifications...";
    try {
      const result = automaticRows(await loadBookingCommunications(booking, crmSearchRecord, true));
      if (token !== generation || booking !== String(state.selectedBookingId)) return;
      rows = result; loadedBooking = booking;
      list.innerHTML = rows.map(row => `<details class="automatic-notification" data-notification="${escapeHtml(row.id)}"><summary><span class="automatic-chevron" aria-hidden="true">&#8250;</span><div class="automatic-row-content"><div class="automatic-row-heading"><strong>${escapeHtml(title(row))}</strong>${badge(row)}</div><div class="automatic-row-meta"><span>${escapeHtml(row.Communication_Purpose || "Automatic notification")}</span><time>${row.Sent_At ? "Sent" : "Created"} ${escapeHtml(dateLabel(row))}</time><span class="automatic-recipients">To: ${escapeHtml(recipientSummary(row.Recipient_To))}</span></div></div><span class="automatic-view-label">View email</span></summary><div data-notification-detail></div></details>`).join("");
      message.textContent = rows.length ? `${rows.length} automatic notification${rows.length === 1 ? "" : "s"}` : "No automatic notifications for this booking.";
      // A single result opens directly: email content is the purpose of this view.
      list.querySelectorAll('details[data-notification]').forEach(detail => { if (detail.dataset.notification === selected || rows.length === 1) detail.open = true; });
    } catch (_) { if (token === generation) message.textContent = "Could not load automatic notifications. Check CRM access and refresh."; }
    finally { if (token === generation) { loading = false; refresh.disabled = false; } }
  }
  refresh.addEventListener("click", () => { void ensure(true); });
  list.addEventListener("toggle", async event => {
    const detail = event.target;
    if (!detail.matches('details[data-notification]') || !detail.open || detail.dataset.loaded) return;
    detail.dataset.loaded = "true"; selected = detail.dataset.notification;
    const row = rows.find(item => String(item.id) === selected), booking = String(state.selectedBookingId), token = generation;
    const content = detail.querySelector('[data-notification-detail]');
    content.innerHTML = '<p class="automatic-content-loading" role="status">Loading email content...</p>';
    let fresh = row, body = "", archiveError = "";
    try { const result = await readArchivedBody(row, booking); fresh = result.row; body = result.body; }
    catch (error) { archiveError = error.message === "The archived email content could not be verified as complete." ? error.message : "The email archive could not be read or verified. Close and reopen this notification to try again."; delete detail.dataset.loaded; }
    if (token !== generation || booking !== String(state.selectedBookingId)) return;
    content.innerHTML = notificationDetail(fresh, body, archiveError);
    if (body) content.querySelector('iframe').srcdoc = isolatedEmailDocument(body);
  }, true);
  return { reset, ensure };
}
