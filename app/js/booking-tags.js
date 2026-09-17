import { crmGetRecord } from "./api.js";
import { MODULES } from "./constants.js";
import { state } from "./state.js";
import { escapeHtml } from "./utils.js";
import { TAG_CATALOG_FIELD, BOOKING_TAGS_FIELD, parseTagCatalog, parseBookingTags, mergeBookingTags, serializeTags, validateTag } from "./booking-tags-data.js";

let catalog = { version: 1, tags: [] };
let catalogError = "";
let initialized = false;
let activeDialog = null;
const defaultTags = [
  ["AGENT", "#93c5fd"],
  ["FLAMENCO", "#f9a8d4"],
  ["HEIGHT/WEIGHT", "#a5b4fc"],
  ["MEET AND GREET", "#86efac"],
  ["MENUS", "#fde68a"],
  ["PARQUE GÜELL", "#6ee7b7"],
  ["RESTAURANTES", "#fdba74"],
  ["SHOREX", "#67e8f9"],
  ["STUDYTOUR", "#d8b4fe"],
  ["TICKETS", "#bef264"],
  ["TOROS", "#fca5a5"],
  ["VIP", "#c4b5fd"]
];
const TAG_READ_TIMEOUT_MS = 5000;

async function readTagRecord(entity, id) {
  let timer;
  try {
    return await Promise.race([
      crmGetRecord(entity, id),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Tags could not be loaded in time. Close the editor and try again.")), TAG_READ_TIMEOUT_MS);
      })
    ]);
  } finally { clearTimeout(timer); }
}

function ownerId() { return String(state.currentUserRelationshipRecordId || ""); }
function bookingRecord(id) {
  return state.selectedBooking && String(state.selectedBooking.id) === String(id) ? state.selectedBooking : state.bookings.find(record => String(record.id) === String(id));
}
function textColor(hex) {
  const rgb = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 > .179 ? "#111827" : "#ffffff";
}
function chip(tag) {
  return '<span class="booking-tag-chip" style="background:' + tag.color + ';color:' + textColor(tag.color) + '">' + escapeHtml(tag.name) + '</span>';
}
export function renderBookingTags(booking, compact) {
  if (!booking || !booking.id) return "";
  let tags = [];
  let invalid = false;
  try {
    const ids = parseBookingTags(booking[BOOKING_TAGS_FIELD]).users[ownerId()] || [];
    tags = catalog.tags.filter(tag => ids.includes(tag.id));
  } catch (_) { invalid = true; }
  return '<span class="booking-tags-slot" data-booking-tags-slot="' + escapeHtml(booking.id) + '" data-tags-compact="' + Boolean(compact) + '">' +
    '<button class="booking-tags-trigger" type="button" data-booking-tags="' + escapeHtml(booking.id) + '" title="Manage my tags" aria-label="Manage my tags for ' + escapeHtml(booking.Deal_Name || "this booking") + '">' +
    tags.map(chip).join("") +
    '<span class="booking-tags-add">' + (invalid ? "Tags !" : "+ Tags") + '</span></button>' +
    (compact ? '<button class="booking-tags-more" type="button" data-booking-tags-more hidden aria-label="Show all tags">+0</button>' : '') + '</span>';
}

function fitBookingTags(slot) {
  if (!slot.isConnected || !slot.clientWidth) return;
  const chips = [...slot.querySelectorAll(".booking-tag-chip")];
  const more = slot.querySelector("[data-booking-tags-more]");
  const add = slot.querySelector(".booking-tags-add");
  chips.forEach(chip => { chip.hidden = false; });
  more.hidden = true;
  const widths = chips.map(chip => chip.getBoundingClientRect().width);
  const addWidth = add.getBoundingClientRect().width;
  const totalWidth = widths.reduce((sum, width) => sum + width + 4, addWidth);
  if (totalWidth <= slot.clientWidth) return;
  more.hidden = false;
  more.textContent = "+" + chips.length;
  const available = slot.clientWidth - more.getBoundingClientRect().width - 4;
  let used = addWidth;
  let visible = 0;
  for (const width of widths) {
    if (used + width + 4 > available) break;
    used += width + 4;
    visible++;
  }
  chips.forEach((chip, index) => { chip.hidden = index >= visible; });
  more.textContent = "+" + (chips.length - visible);
  more.setAttribute("aria-label", "Show all " + chips.length + " tags");
}

function observeBookingTags() {
  const table = document.getElementById("booking-queue-table");
  if (!table) return;
  const observed = new Set();
  const resize = new ResizeObserver(entries => entries.forEach(entry => fitBookingTags(entry.target)));
  const sync = () => {
    for (const slot of observed) {
      if (!table.contains(slot)) { resize.unobserve(slot); observed.delete(slot); }
    }
    table.querySelectorAll('[data-tags-compact="true"]').forEach(slot => {
      if (!observed.has(slot)) { observed.add(slot); resize.observe(slot); fitBookingTags(slot); }
    });
  };
  new MutationObserver(records => {
    if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 && (node.matches("[data-booking-tags-slot]") || node.querySelector("[data-booking-tags-slot]"))))) sync();
  }).observe(table, { childList: true, subtree: true });
  sync();
  if (document.fonts) document.fonts.ready.then(() => observed.forEach(fitBookingTags));
}

function showAllBookingTags(slot) {
  if (activeDialog) return;
  const dialog = document.createElement("dialog");
  activeDialog = dialog;
  dialog.className = "booking-tags-dialog booking-tags-preview";
  dialog.setAttribute("aria-labelledby", "booking-tags-preview-title");
  const booking = bookingRecord(slot.dataset.bookingTagsSlot);
  const chips = [...slot.querySelectorAll(".booking-tag-chip")].map(chip => {
    const copy = chip.cloneNode(true);
    copy.hidden = false;
    return copy.outerHTML;
  }).join("");
  dialog.innerHTML = '<header><div><h3 id="booking-tags-preview-title">My booking tags</h3><p>' + escapeHtml(booking?.Deal_Name || "Booking") + '</p></div><button type="button" class="icon-button" data-tags-close aria-label="Close">×</button></header><div class="booking-tags-preview-list">' + chips + '</div>';
  dialog.querySelector("[data-tags-close]").onclick = () => dialog.close();
  dialog.addEventListener("keydown", event => { if (event.key === "Escape") event.stopPropagation(); });
  dialog.addEventListener("close", () => { dialog.remove(); activeDialog = null; });
  document.body.appendChild(dialog);
  dialog.showModal();
}
function refreshTags() {
  document.querySelectorAll("[data-booking-tags-slot]").forEach(slot => {
    const record = bookingRecord(slot.dataset.bookingTagsSlot);
    if (record) slot.outerHTML = renderBookingTags(record, slot.dataset.tagsCompact === "true");
  });
}
function requireField(record, field) {
  if (!record || !Object.prototype.hasOwnProperty.call(record, field)) throw new Error("The field " + field + " is unavailable. Check that it exists and that your profile can read and edit it.");
}
async function loadCatalog() {
  if (!ownerId()) throw new Error("Your User Relationships record could not be identified by user ID or email.");
  const record = await readTagRecord(MODULES.userRelationships, ownerId());
  requireField(record, TAG_CATALOG_FIELD);
  catalog = parseTagCatalog(record[TAG_CATALOG_FIELD]);
  catalogError = "";
  return record;
}

// Read immediately before merging and verify the returned field after saving.
// The embedded SDK offers no conditional-update header; see docs/booking-tags.md.
async function writeJson(entity, record, field, value) {
  const json = serializeTags(value);
  const response = await ZOHO.CRM.API.updateRecord({ Entity: entity, APIData: { id: record.id, [field]: json }, Trigger: [] });
  const result = response && response.data && response.data[0];
  if (!result || result.code !== "SUCCESS") throw new Error(result && result.message || "CRM did not confirm the tag update.");
  const saved = await readTagRecord(entity, record.id);
  requireField(saved, field);
  const parse = field === TAG_CATALOG_FIELD ? parseTagCatalog : parseBookingTags;
  if (serializeTags(parse(saved[field])) !== serializeTags(value)) throw new Error("The saved tags changed or could not be verified. Reopen the editor before trying again.");
  return saved;
}

export async function initializeBookingTags() {
  if (!initialized) {
    initialized = true;
    observeBookingTags();
    document.addEventListener("click", function (event) {
      const more = event.target.closest("[data-booking-tags-more]");
      if (more) {
        event.preventDefault();
        event.stopPropagation();
        showAllBookingTags(more.closest("[data-booking-tags-slot]"));
        return;
      }
      const button = event.target.closest("[data-booking-tags]");
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      openTagEditor(button.dataset.bookingTags);
    }, true);
  }
  try { await loadCatalog(); } catch (error) { catalogError = error.message; }
  refreshTags();
}

async function openTagEditor(bookingId) {
  if (activeDialog) return;
  const record = bookingRecord(bookingId);
  if (!record) return;
  const dialog = document.createElement("dialog");
  activeDialog = dialog;
  dialog.className = "booking-tags-dialog";
  dialog.setAttribute("aria-labelledby", "booking-tags-title");
  dialog.innerHTML = '<header><div><h3 id="booking-tags-title">My booking tags</h3><p>' + escapeHtml(record.Deal_Name || "Booking") + '</p></div><button type="button" class="icon-button" data-tags-close aria-label="Close">×</button></header>' +
    '<p class="booking-tags-feedback" role="status">Loading tags…</p><div class="booking-tags-editor-body"></div>';
  document.body.appendChild(dialog);
  dialog.showModal();
  let busy = false;
  let selected = new Set();
  let initial = [];
  let deletingId = "";
  let freshBooking;
  const feedback = dialog.querySelector(".booking-tags-feedback");
  const body = dialog.querySelector(".booking-tags-editor-body");
  const close = () => { if (!busy) dialog.close(); };
  dialog.querySelector("[data-tags-close]").onclick = close;
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  dialog.addEventListener("keydown", event => { if (event.key === "Escape") event.stopPropagation(); });
  dialog.addEventListener("close", () => { dialog.remove(); activeDialog = null; refreshTags(); });

  function draw() {
    body.innerHTML = '<p class="booking-tags-help">Select tags for this booking. Names and colors are shared across your own bookings.</p>' +
      '<div class="booking-tags-list">' + catalog.tags.map(tag => '<div class="booking-tag-editor-row" data-tag-row="' + escapeHtml(tag.id) + '">' +
        '<input type="checkbox" data-tag-select="' + escapeHtml(tag.id) + '" aria-label="Assign ' + escapeHtml(tag.name) + '"' + (selected.has(tag.id) ? ' checked' : '') + '>' +
        '<input type="text" data-tag-name maxlength="60" value="' + escapeHtml(tag.name) + '" aria-label="Tag name">' +
        '<input type="color" data-tag-color value="' + tag.color + '" aria-label="Tag color">' +
        '<button type="button" class="button tertiary compact" data-tag-save="' + tag.id + '">Save</button>' +
        '<button type="button" class="button tertiary compact" data-tag-delete="' + tag.id + '">' + (deletingId === tag.id ? "Confirm delete" : "Delete") + '</button></div>').join("") +
      (catalog.tags.length ? '' : '<p>No tags yet. Create one or add the suggested tags.</p>') + '</div>' +
      '<form class="booking-tag-create"><input name="name" type="text" maxlength="60" placeholder="New tag name" aria-label="New tag name" required><input name="color" type="color" value="#93c5fd" aria-label="New tag color"><button class="button tertiary compact" type="submit">Create tag</button></form>' +
      '<button type="button" class="button tertiary compact" data-tags-defaults>Add suggested tags</button>' +
      '<footer><button type="button" class="button tertiary" data-tags-close-bottom>Close</button><button type="button" class="button success" data-tags-apply>Apply to booking</button></footer>';
    body.querySelector("[data-tags-close-bottom]").onclick = close;
  }
  async function run(action, message) {
    if (busy) return;
    busy = true;
    dialog.setAttribute("aria-busy", "true");
    dialog.querySelectorAll("input, button").forEach(control => { control.disabled = true; });
    feedback.textContent = "Saving…";
    try { await action(); feedback.textContent = message; }
    catch (error) { feedback.textContent = error.message || "Could not save tags."; }
    finally {
      busy = false;
      dialog.removeAttribute("aria-busy");
      dialog.querySelectorAll("input, button").forEach(control => { control.disabled = false; });
      refreshTags();
    }
  }
  async function changeCatalog(transform) {
    const current = await loadCatalog();
    const next = { ...catalog, tags: transform(catalog.tags) };
    const saved = await writeJson(MODULES.userRelationships, current, TAG_CATALOG_FIELD, next);
    catalog = parseTagCatalog(saved[TAG_CATALOG_FIELD]);
    selected = new Set([...selected].filter(id => catalog.tags.some(tag => tag.id === id)));
    deletingId = "";
    draw();
  }
  body.addEventListener("change", event => {
    const id = event.target.dataset.tagSelect;
    if (id) { if (event.target.checked) selected.add(id); else selected.delete(id); }
  });
  body.addEventListener("submit", event => {
    event.preventDefault();
    const name = body.querySelector('[name="name"]').value;
    const color = body.querySelector('[name="color"]').value;
    run(() => changeCatalog(tags => [...tags, { id: crypto.randomUUID(), ...validateTag(name, color, tags) }]), "Tag created. Select it and apply it to the booking.");
  });
  body.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button || busy) return;
    const id = button.dataset.tagSave || button.dataset.tagDelete;
    if (button.hasAttribute("data-tag-save")) {
      const row = button.closest("[data-tag-row]");
      const name = row.querySelector("[data-tag-name]").value;
      const color = row.querySelector("[data-tag-color]").value;
      run(() => changeCatalog(tags => {
        if (!tags.some(tag => tag.id === id)) throw new Error("This tag was deleted in another session. Reopen the editor.");
        const values = validateTag(name, color, tags, id);
        return tags.map(tag => tag.id === id ? { ...tag, ...values } : tag);
      }), "Tag updated across your bookings.");
    } else if (button.hasAttribute("data-tag-delete")) {
      if (deletingId !== id) {
        deletingId = id;
        button.textContent = "Confirm delete";
        feedback.textContent = "Delete this tag from your catalog? It will disappear from all your bookings.";
        return;
      }
      run(() => changeCatalog(tags => tags.filter(tag => tag.id !== id)), "Tag deleted from your catalog and hidden from your bookings.");
    } else if (button.hasAttribute("data-tags-defaults")) {
      run(() => changeCatalog(tags => [...tags, ...defaultTags.filter(([name]) => !tags.some(tag => tag.name.toLowerCase() === name.toLowerCase())).map(([name, color]) => ({ id: crypto.randomUUID(), name, color }))]), "Suggested tags added to your catalog.");
    } else if (button.hasAttribute("data-tags-apply")) {
      run(async () => {
        await loadCatalog();
        const latest = await readTagRecord(MODULES.bookings, bookingId);
        requireField(latest, BOOKING_TAGS_FIELD);
        const currentIds = parseBookingTags(latest[BOOKING_TAGS_FIELD]).users[ownerId()] || [];
        const added = [...selected].filter(id => !initial.includes(id));
        const removed = initial.filter(id => !selected.has(id));
        const merged = [...new Set([...currentIds.filter(id => !removed.includes(id)), ...added])].filter(id => catalog.tags.some(tag => tag.id === id));
        const value = mergeBookingTags(latest[BOOKING_TAGS_FIELD], ownerId(), merged);
        freshBooking = await writeJson(MODULES.bookings, latest, BOOKING_TAGS_FIELD, value);
        [state.selectedBooking, ...state.bookings, ...Object.values(state.bookingIndex || {})].forEach(item => {
          if (item && String(item.id) === String(bookingId)) item[BOOKING_TAGS_FIELD] = freshBooking[BOOKING_TAGS_FIELD];
        });
        initial = merged;
        selected = new Set(merged);
        draw();
      }, "Booking tags saved.");
    }
  });
  try {
    await loadCatalog();
    freshBooking = await readTagRecord(MODULES.bookings, bookingId);
    requireField(freshBooking, BOOKING_TAGS_FIELD);
    initial = parseBookingTags(freshBooking[BOOKING_TAGS_FIELD]).users[ownerId()] || [];
    selected = new Set(initial.filter(id => catalog.tags.some(tag => tag.id === id)));
    feedback.textContent = "";
    draw();
  } catch (error) { feedback.textContent = error.message || catalogError; }
  finally { busy = false; }
}
