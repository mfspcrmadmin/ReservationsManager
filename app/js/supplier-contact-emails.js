import { crmGetRecord, crmSearchRecord } from "./api.js";
import { escapeHtml } from "./utils.js";

async function searchAll(module, criteria) {
  const records = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await crmSearchRecord(module, criteria, page, 200);
    records.push(...batch);
    if (batch.length < 200) return records;
  }
  throw new Error("Too many related records to load all contacts. Please narrow the communication's services.");
}

export function mergeContactEmails(existing, added) {
  const seen = new Set();
  return [...existing, ...added].filter(email => {
    const key = String(email).trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function loadSupplierContactEmails(communicationId) {
  if (!communicationId) throw new Error("Select a communication first.");
  const communication = await crmGetRecord("Communications", communicationId);
  const bookingId = String(communication?.Booking?.id || "");
  if (String(communication?.id || "") !== String(communicationId) || !bookingId) throw new Error("Could not verify the Communication booking before loading supplier contacts.");
  const escapedId = String(communicationId).replace(/[\\(),:]/g, character => "\\" + character);
  const links = await searchAll("Communication_Services", "(Communication:equals:" + escapedId + ")");
  if (links.some(link => String(link.Communication?.id || "") !== String(communicationId) || !link.Booking_Service?.id)) throw new Error("Could not verify a Communication service relationship.");
  const services = new Set(links.map(link => link.Booking_Service?.id).filter(Boolean).map(String));
  const suppliers = new Map();
  for (const id of services) {
    const service = await crmGetRecord("Booking_Services", id);
    if (!service || String(service.id) !== id || String(service.Booking?.id || "") !== bookingId) throw new Error("Could not verify a service for this Communication booking.");
    if (service.Supplier?.id) suppliers.set(String(service.Supplier.id), service.Supplier.name || "Supplier");
  }
  const addresses = new Map();
  for (const [id, supplierName] of suppliers) {
    const contacts = await searchAll("Contacts", "(Vendor_Name:equals:" + id.replace(/[\\(),:]/g, character => "\\" + character) + ")");
    for (const contact of contacts) {
      for (const value of [contact.Email, contact.Email_2]) {
        const email = String(value || "").trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
        const key = email.toLowerCase();
        if (!addresses.has(key)) addresses.set(key, { email, name: contact.Full_Name || [contact.First_Name, contact.Last_Name].filter(Boolean).join(" ") || "Contact", supplier: supplierName });
      }
    }
  }
  return Array.from(addresses.values()).sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
}

export function openSupplierContactEmails({ communicationId, existing = [], isCurrent, onApply }) {
  if (document.querySelector(".supplier-contact-emails-dialog")) return;
  const previousFocus = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.className = "supplier-contact-emails-dialog";
  dialog.setAttribute("aria-labelledby", "supplier-contact-emails-title");
  dialog.innerHTML = '<header><div><span class="supplier-picker-eyebrow">EMAIL RECIPIENTS</span><h3 id="supplier-contact-emails-title">Supplier contacts</h3><p>Choose who receives this email.</p></div><button type="button" class="supplier-picker-close" data-close aria-label="Close">&#215;</button></header><section class="supplier-picker-selection" aria-label="Selected recipients"><div class="supplier-picker-section-heading"><h4>To <span data-selected-count></span></h4><span>Click &times; to remove</span></div><div data-selected-emails></div></section><section class="supplier-picker-contacts"><label class="supplier-picker-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input type="search" data-search placeholder="Search name, email or supplier" aria-label="Search supplier contacts"></label><div class="supplier-picker-section-heading"><h4>Available contacts</h4><span data-contact-count></span></div><p data-status role="status">Loading contacts&hellip;</p><div data-contact-list></div></section><p data-error role="alert" hidden></p><footer><span data-summary aria-live="polite"></span><div><button type="button" class="supplier-picker-cancel" data-close>Cancel</button><button type="button" class="supplier-picker-apply" data-apply>Apply recipients</button></div></footer>';
  document.body.appendChild(dialog);
  const status = dialog.querySelector("[data-status]"), list = dialog.querySelector("[data-contact-list]"), error = dialog.querySelector("[data-error]"), search = dialog.querySelector("[data-search]");
  const selected = new Map(mergeContactEmails([], existing).map(email => [email.trim().toLowerCase(), email.trim()]));
  let contacts = [];
  function render() {
    dialog.querySelector("[data-selected-count]").textContent = String(selected.size);
    dialog.querySelector("[data-summary]").textContent = selected.size + (selected.size === 1 ? " recipient selected" : " recipients selected");
    const chips = dialog.querySelector("[data-selected-emails]");
    chips.innerHTML = selected.size ? Array.from(selected, ([key, email]) => '<span class="supplier-recipient-chip"><span>' + escapeHtml(email) + '</span><button type="button" data-remove-email="' + escapeHtml(key) + '" aria-label="Remove ' + escapeHtml(email) + '">&#215;</button></span>').join("") : '<p class="supplier-picker-empty">No recipients selected. Add contacts below.</p>';
    chips.querySelectorAll("[data-remove-email]").forEach(button => { button.onclick = () => { selected.delete(button.dataset.removeEmail); render(); dialog.querySelector("[data-search]").focus(); }; });
    const query = String(search.value || "").trim().toLowerCase();
    const filtered = contacts.filter(contact => [contact.name, contact.email, contact.supplier].join(" ").toLowerCase().includes(query));
    dialog.querySelector("[data-contact-count]").textContent = filtered.length + (filtered.length === 1 ? " contact" : " contacts");
    list.innerHTML = filtered.map(contact => {
      const key = contact.email.toLowerCase(), added = selected.has(key);
      const initials = contact.name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();
      return '<article class="supplier-contact-card' + (added ? ' is-selected' : '') + '"><span class="supplier-contact-avatar" aria-hidden="true">' + escapeHtml(initials) + '</span><div class="supplier-contact-details"><strong>' + escapeHtml(contact.name) + '</strong><span class="supplier-contact-address">' + escapeHtml(contact.email) + '</span><small>' + escapeHtml(contact.supplier) + '</small></div><button type="button" class="supplier-contact-toggle" data-toggle-email="' + escapeHtml(key) + '" aria-pressed="' + added + '" aria-label="' + (added ? 'Remove ' : 'Add ') + escapeHtml(contact.email) + '">' + (added ? '&#10003; Added' : '+ Add') + '</button></article>';
    }).join("");
    if (contacts.length && !filtered.length) list.innerHTML = '<p class="supplier-picker-empty">No contacts match your search.</p>';
    list.querySelectorAll("[data-toggle-email]").forEach(button => { button.onclick = () => {
      const key = button.dataset.toggleEmail;
      if (selected.has(key)) selected.delete(key);
      else selected.set(key, contacts.find(contact => contact.email.toLowerCase() === key).email);
      render();
      list.querySelectorAll("[data-toggle-email]").forEach(next => { if (next.dataset.toggleEmail === key) next.focus(); });
    }; });
  }
  search.addEventListener("input", render);
  dialog.querySelectorAll("[data-close]").forEach(button => { button.onclick = () => dialog.close(); });
  dialog.addEventListener("close", () => { dialog.remove(); previousFocus?.focus(); });
  dialog.querySelector("[data-apply]").onclick = () => {
    try {
      if (!isCurrent()) throw new Error("The selected communication changed. Close this dialog and try again.");
      onApply(Array.from(selected.values()));
      dialog.close();
    } catch (cause) { error.textContent = cause.message || "Could not update the selected addresses."; error.hidden = false; }
  };
  render();
  dialog.showModal();
  loadSupplierContactEmails(communicationId).then(addresses => {
    if (!dialog.isConnected) return;
    if (!isCurrent()) throw new Error("The selected communication changed. Close this dialog and try again.");
    contacts = addresses;
    status.textContent = addresses.length ? "" : "No contacts with an email address were found for this communication's suppliers.";
    status.hidden = Boolean(addresses.length);
    render();
  }).catch(cause => {
    if (!dialog.isConnected) return;
    status.hidden = true;
    error.textContent = cause.message || "Could not load supplier contacts.";
    error.hidden = false;
  });
}
