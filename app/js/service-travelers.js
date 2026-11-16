import { crmExecuteFunction } from "./api.js";
import { state } from "./state.js";
import { escapeHtml } from "./utils.js";

function payload(response) {
  let value = response?.details?.output ?? response;
  if (typeof value === "string") value = JSON.parse(value);
  if (!value || value.error === true || value.error === "true") throw new Error(value?.message || "Could not load service travelers.");
  return value;
}
export async function requestServiceTravelers(serviceId, changes = "", version = "", commit = false) {
  return payload(await crmExecuteFunction("servicepax_manage", { serviceId, changesJson: changes, expectedVersion: version, commit }));
}
export function initServiceTravelers() {
  document.getElementById("service-action-travelers")?.addEventListener("click", event => {
    if (state.selectedService?.id && state.selectedBookingId) openServiceTravelers(state.selectedService, state.selectedBookingId, event.currentTarget);
  });
}
export function openServiceTravelers(service, bookingId, trigger) {
  const dialog = document.createElement("dialog");
  dialog.className = "service-travelers-dialog";
  dialog.setAttribute("aria-labelledby", "service-travelers-title");
  dialog.innerHTML = `<header><div><h2 id="service-travelers-title">Service travelers</h2><p>${escapeHtml(service.Product_Description || service.Name || "Selected service")}</p></div><button type="button" data-close aria-label="Close service travelers" title="Close">×</button></header>
    <p data-message role="status" aria-live="polite">Loading travelers…</p><div data-list></div><section data-review hidden><h3>Review changes</h3><div data-plan></div></section>
    <footer><button type="button" data-reload class="button tertiary">Reload</button><button type="button" data-preview class="button secondary" disabled>Review changes</button><button type="button" data-save class="button primary" disabled>Save assignments</button></footer>`;
  document.body.append(dialog);
  const find = selector => dialog.querySelector(selector);
  const message = find("[data-message]"), list = find("[data-list]"), preview = find("[data-preview]"), save = find("[data-save]"), reload = find("[data-reload]");
  let model, reviewed = "", dirty = false, busy = false, mustReload = false, generation = 0;
  const current = () => dialog.open && String(state.selectedBookingId) === String(bookingId) && String(state.selectedService?.id) === String(service.id);
  function controls() {
    preview.disabled = busy || mustReload || !model;
    save.disabled = busy || mustReload || !reviewed;
    reload.disabled = busy;
    list.querySelectorAll("input,select,textarea").forEach(node => {
      const selected = node.closest("[data-pax]")?.querySelector("[data-selected]")?.checked;
      node.disabled = busy || mustReload || (!node.matches("[data-selected]") && !selected);
    });
  }
  function invalidate() { reviewed = ""; dirty = true; find("[data-review]").hidden = true; controls(); }
  function close() {
    if (busy) return;
    if (dirty && !window.confirm(mustReload ? "Save status needs checking. Close without reloading assignments?" : "Discard unsaved traveler assignment changes?")) return;
    dialog.close();
  }
  function desired() {
    const passengers = [...list.querySelectorAll("[data-pax]")].filter(row => row.querySelector("[data-selected]").checked).map(row => ({ paxId: row.dataset.pax,
      roomType: row.querySelector("[data-room]").value, roomGroup: row.querySelector("[data-group]").value, notes: row.querySelector("[data-notes]").value }));
    return JSON.stringify({ passengers });
  }
  async function load() {
    if (busy) return;
    if (dirty && !window.confirm("Reload and discard unsaved changes?")) return;
    const request = ++generation;
    busy = true; reviewed = ""; controls(); message.textContent = "Loading travelers…";
    try {
      const result = await requestServiceTravelers(String(service.id));
      if (request !== generation || !current()) { if (dialog.open) dialog.close(); return; }
      if (String(result.bookingId) !== String(bookingId)) throw new Error("This service belongs to a different booking. Reopen the service.");
      model = result; dirty = false; mustReload = false;
      const active = (model.assignments || []).filter(a => a.Assignment_Status !== "Cancelled");
      message.textContent = `${active.length} traveler${active.length === 1 ? "" : "s"} assigned. Select the travelers who participate in this service.`;
      list.innerHTML = (model.participants || []).map(person => {
        const assignment = (model.assignments || []).find(a => String(a.pax_id) === String(person.id));
        const selected = assignment && assignment.Assignment_Status !== "Cancelled";
        const room = assignment?.Room_Type || "";
        const types = ["", ...model.roomTypes];
        if (room && !types.includes(room)) types.push(room);
        const name = [person.Forename, person.Name].filter(Boolean).join(" ") || "Unnamed traveler";
        return `<article data-pax="${escapeHtml(person.id)}"><label class="service-traveler-select"><input type="checkbox" data-selected ${selected ? "checked" : ""}><strong>${escapeHtml(name)}</strong>${person.Lead_Passenger ? '<span class="service-traveler-lead">Lead traveler</span>' : ""}</label>
          <details><summary>Room and passenger notes</summary><div class="service-traveler-fields"><label>Room type<select data-room aria-label="Room type for ${escapeHtml(name)}">${types.map(type => `<option value="${escapeHtml(type)}" ${type === room ? "selected" : ""}>${escapeHtml(type || "Not specified")}</option>`).join("")}</select></label><label>Room group<input data-group maxlength="100" value="${escapeHtml(assignment?.Room_Group || "")}" placeholder="For example, Room 1"></label><label>Service notes<textarea data-notes maxlength="32000" rows="3">${escapeHtml(assignment?.Service_Notes || "")}</textarea></label></div></details></article>`;
      }).join("") || '<p class="empty-state">No active booking participants are available.</p>';
      find("[data-review]").hidden = true;
    } catch (error) { if (dialog.open) { message.textContent = error.message || "Could not load travelers."; mustReload = true; } }
    finally { busy = false; controls(); }
  }
  preview.addEventListener("click", async () => {
    if (busy || !current()) return;
    const changes = desired(); busy = true; reviewed = ""; controls();
    try {
      const result = await requestServiceTravelers(String(service.id), changes, model.version);
      if (!current()) { dialog.close(); return; }
      if (result.version !== model.version) throw new Error("Assignments changed. Reload and review again.");
      const names = new Map(model.participants.map(p => [String(p.id), [p.Forename, p.Name].filter(Boolean).join(" ")]));
      find("[data-plan]").innerHTML = (result.plan || []).map(item => `<article><strong>${escapeHtml(item.action)} · ${escapeHtml(names.get(String(item.paxId)) || item.paxId)}</strong><dl>${Object.entries(item.changes).filter(([key]) => !["Booking", "Booking_Service", "PAX", "Assignment_Key", "Assignment_Source"].includes(key)).map(([key, value]) => `<div><dt>${escapeHtml(({ Assignment_Status: "Participation", Room_Type: "Room type", Room_Group: "Room group", Service_Notes: "Notes" })[key] || key)}</dt><dd>${escapeHtml(item.before?.[key] ?? "Empty")} → ${escapeHtml(value ?? "Empty")}</dd></div>`).join("")}</dl></article>`).join("") || "No changes to save.";
      find("[data-review]").hidden = false;
      reviewed = result.changeCount ? changes : "";
      if (!result.changeCount) dirty = false;
      message.textContent = result.changeCount ? `${result.changeCount} change${result.changeCount === 1 ? "" : "s"} ready for your review.` : "Assignments already match your selection.";
    } catch (error) { message.textContent = error.message; }
    finally { busy = false; controls(); }
  });
  save.addEventListener("click", async () => {
    if (busy || !reviewed || !current()) return;
    const changes = reviewed; busy = true; controls();
    let acknowledged = false;
    try {
      const result = await requestServiceTravelers(String(service.id), changes, model.version, true);
      if (!result.committed) throw new Error("CRM did not confirm assignment saving. Reload to check.");
      acknowledged = true;
      dirty = false; reviewed = "";
      if (!current()) { dialog.close(); return; }
      const fresh = await requestServiceTravelers(String(service.id));
      if (!current()) { dialog.close(); return; }
      if (String(fresh.bookingId) !== String(bookingId)) throw new Error("Saved, but the refreshed booking could not be verified.");
      const wanted = JSON.parse(changes).passengers;
      const active = (fresh.assignments || []).filter(a => a.Assignment_Status !== "Cancelled");
      const ids = rows => rows.map(r => String(r.paxId ?? r.pax_id)).sort().join(",");
      if (ids(active) !== ids(wanted) || wanted.some(p => {
        const saved = active.find(a => String(a.pax_id) === String(p.paxId));
        return !saved || String(saved.Room_Type || "").toUpperCase() !== p.roomType.trim().toUpperCase() || String(saved.Room_Group || "") !== p.roomGroup.trim() || String(saved.Service_Notes || "") !== p.notes;
      })) throw new Error("CRM accepted the save, but reloaded assignments differ. Review the current records.");
      // A successful reload is required before another change can be reviewed.
      mustReload = true; message.textContent = "Assignments saved and reloaded. Select Reload to edit again.";
      find("[data-review]").hidden = true;
    } catch (error) { reviewed = ""; mustReload = true; message.textContent = `${acknowledged ? "CRM accepted the changes, but reload verification failed. " : "Save was not confirmed. "}${error.message || "Check the current assignments."} Reload before making further changes.`; }
    finally { busy = false; controls(); }
  });
  list.addEventListener("input", invalidate); list.addEventListener("change", invalidate);
  reload.addEventListener("click", () => void load());
  find("[data-close]").addEventListener("click", close);
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  dialog.addEventListener("close", () => { generation++; dialog.remove(); if (trigger?.isConnected) trigger.focus({ preventScroll: true }); }, { once: true });
  dialog.showModal(); find("[data-close]").focus(); void load();
  return dialog;
}
