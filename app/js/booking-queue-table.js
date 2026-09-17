import { createColumnResizer } from "./service-column-resizing.js";

export const QUEUE_COLUMNS = [
  { key: "booking", label: "Booking", width: 240 },
  { key: "mfsp", label: "MFSP", width: 112 },
  { key: "arrival", label: "Arrival date", width: 140 },
  { key: "departure", label: "Departure date", width: 140 },
  { key: "stage", label: "Stage", width: 180 },
  { key: "travelers", label: "Travelers", width: 100 },
  { key: "agency", label: "Agency", width: 200 },
  { key: "contact", label: "Primary contact", width: 200 },
  { key: "sales", label: "Sales price", width: 130 },
  { key: "sync", label: "SYNC", width: 240 },
  { key: "desk", label: "Desk", width: 320 }
];
const compactKeys = ["booking", "mfsp", "arrival", "stage"];
const preferences = new Map();

export function sanitizeQueueColumns(stored, wide) {
  const result = [];
  (Array.isArray(stored) ? stored : []).forEach(function (entry) {
    if (!entry || !QUEUE_COLUMNS.some(column => column.key === entry.key) || result.some(column => column.key === entry.key)) return;
    result.push({ key: entry.key, visible: typeof entry.visible === "boolean" ? entry.visible : wide || compactKeys.includes(entry.key) });
  });
  QUEUE_COLUMNS.forEach(function (column) {
    if (!result.some(entry => entry.key === column.key)) {
      const entry = { key: column.key, visible: wide || compactKeys.includes(column.key) };
      const syncIndex = result.findIndex(existing => existing.key === "sync");
      if (column.key === "desk" && syncIndex >= 0) result.splice(syncIndex + 1, 0, entry);
      else result.push(entry);
    }
  });
  if (!result.some(column => column.visible)) result[0].visible = true;
  return result;
}

function read(key) {
  try { return key ? JSON.parse(window.localStorage.getItem(key)) : null; } catch (_) { return null; }
}

export function getQueueTablePreferences(state) {
  const identity = state.currentUserId ? "id:" + state.currentUserId : state.currentUserEmail ? "email:" + state.currentUserEmail.trim().toLowerCase() : "";
  const key = identity ? "bookingsManager.bookingQueue." + identity : "";
  if (!preferences.has(key)) {
    const stored = read(key) || {};
    preferences.set(key, {
      key,
      compact: sanitizeQueueColumns(stored.compact, false),
      wide: sanitizeQueueColumns(stored.wide, true),
      textSize: typeof stored.textSize === "number" && Number.isFinite(stored.textSize) ? Math.max(10, Math.min(20, Math.round(stored.textSize))) : 12,
      resizer: createColumnResizer(key ? key + ".widths" : "", Object.fromEntries(QUEUE_COLUMNS.map(column => [column.key, column.width])), 42)
    });
  }
  return preferences.get(key);
}

function save(pref) {
  if (!pref.key) return;
  try { window.localStorage.setItem(pref.key, JSON.stringify({ compact: pref.compact, wide: pref.wide, textSize: pref.textSize })); } catch (_) { /* Keep session settings. */ }
}

export function getQueueVisibleColumns(pref, wide) {
  return pref[wide ? "wide" : "compact"].filter(column => column.visible).map(column => QUEUE_COLUMNS.find(definition => definition.key === column.key));
}

export function queueColumnButton() {
  return '<th class="queue-columns-control"><button class="service-columns-button" type="button" data-queue-columns aria-label="Configure visible columns" title="Configure visible columns"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z"/><path d="m19.4 13.5 1.4 1.1-2 3.5-1.7-.7a7.7 7.7 0 0 1-2.1 1.2L14.7 20h-4l-.3-1.9a7.7 7.7 0 0 1-2.1-1.2l-1.7.7-2-3.5 1.4-1.1a7.8 7.8 0 0 1 0-2.4L4.6 9.5l2-3.5 1.7.7a7.7 7.7 0 0 1 2.1-1.2l.3-1.9h4l.3 1.9a7.7 7.7 0 0 1 2.1 1.2l1.7-.7 2 3.5-1.4 1.1a7.8 7.8 0 0 1 0 2.4Z"/></svg></button></th>';
}

export function configureQueueTable(elements, pref, wide, rerender) {
  const head = elements.bookingBrowserHead;
  const table = head.closest("table");
  pref.resizer.configure(head);
  table.style.setProperty("--queue-text-size", pref.textSize + "px");
  head.querySelector("[data-queue-columns]").onclick = () => openColumns(pref, wide, rerender, head);
  const controls = document.getElementById("queue-text-size-controls");
  controls.querySelector("output").textContent = pref.textSize + " px";
  controls.querySelector('[data-queue-text="decrease"]').disabled = pref.textSize === 10;
  controls.querySelector('[data-queue-text="increase"]').disabled = pref.textSize === 20;
  controls.querySelector('[data-queue-text="reset"]').disabled = pref.textSize === 12;
  controls.onclick = function (event) {
    const button = event.target.closest("[data-queue-text]");
    if (!button || button.disabled) return;
    pref.textSize = button.dataset.queueText === "reset" ? 12 : Math.max(10, Math.min(20, pref.textSize + (button.dataset.queueText === "increase" ? 1 : -1)));
    save(pref);
    table.style.setProperty("--queue-text-size", pref.textSize + "px");
    controls.querySelector("output").textContent = pref.textSize + " px";
    controls.querySelector('[data-queue-text="decrease"]').disabled = pref.textSize === 10;
    controls.querySelector('[data-queue-text="increase"]').disabled = pref.textSize === 20;
    controls.querySelector('[data-queue-text="reset"]').disabled = pref.textSize === 12;
  };
}

function openColumns(pref, wide, rerender, head) {
  if (document.getElementById("queue-columns-dialog")) return;
  const mode = wide ? "wide" : "compact";
  const dialog = document.createElement("dialog");
  dialog.id = "queue-columns-dialog";
  dialog.className = "queue-columns-dialog";
  dialog.setAttribute("aria-labelledby", "queue-columns-title");
  dialog.innerHTML = '<div class="columns-panel-header"><div class="columns-panel-title-row"><h3 id="queue-columns-title">Visible columns</h3><button class="button tertiary compact" type="button" data-queue-reset>Reset</button></div><button class="button tertiary compact" type="button" data-queue-close aria-label="Close dialog">Close</button></div><div class="columns-list"></div>';
  const list = dialog.querySelector(".columns-list");
  function renderList() {
    const count = pref[mode].filter(column => column.visible).length;
    list.innerHTML = pref[mode].map(function (column, index) {
      const label = QUEUE_COLUMNS.find(definition => definition.key === column.key).label;
      return '<div class="column-editor-row' + (column.visible ? '' : ' is-muted') + '" draggable="true" data-key="' + column.key + '"><span class="column-drag-handle" aria-hidden="true">&#8942;&#8942;</span><label class="column-editor-toggle"><input type="checkbox" class="table-checkbox" data-visible="' + column.key + '"' + (column.visible ? ' checked' : '') + (column.visible && count === 1 ? ' disabled' : '') + '><span>' + label + '</span></label><div class="column-editor-actions"><button class="button tertiary compact" type="button" data-move="-1" aria-label="Move ' + label + ' up"' + (index === 0 ? ' disabled' : '') + '>↑</button><button class="button tertiary compact" type="button" data-move="1" aria-label="Move ' + label + ' down"' + (index === pref[mode].length - 1 ? ' disabled' : '') + '>↓</button></div></div>';
    }).join("");
  }
  function update() { save(pref); rerender(); renderList(); }
  function move(key, targetKey, after) {
    const columns = pref[mode];
    const index = columns.findIndex(column => column.key === key);
    if (index < 0 || key === targetKey || !columns.some(column => column.key === targetKey)) return;
    const moved = columns.splice(index, 1)[0];
    columns.splice(columns.findIndex(column => column.key === targetKey) + (after ? 1 : 0), 0, moved);
    update();
  }
  list.onchange = function (event) {
    const column = pref[mode].find(entry => entry.key === event.target.dataset.visible);
    if (!column) return;
    if (!event.target.checked && pref[mode].filter(entry => entry.visible).length === 1) { event.target.checked = true; return; }
    column.visible = event.target.checked;
    update();
  };
  list.onclick = function (event) {
    const button = event.target.closest("[data-move]");
    if (!button || button.disabled) return;
    const key = button.closest("[data-key]").dataset.key;
    const index = pref[mode].findIndex(column => column.key === key);
    const direction = Number(button.dataset.move);
    move(key, pref[mode][index + direction].key, direction > 0);
    list.querySelector('[data-key="' + key + '"] [data-move="' + direction + '"]:not(:disabled)')?.focus();
  };
  let dragged = "";
  list.ondragstart = function (event) {
    const row = event.target.closest("[data-key]");
    if (!row) return;
    dragged = row.dataset.key;
    event.dataTransfer.setData("text/plain", dragged);
    event.dataTransfer.effectAllowed = "move";
    row.classList.add("is-dragging");
  };
  function clearDrag() { list.querySelectorAll(".column-editor-row").forEach(row => row.classList.remove("is-dragging", "is-drag-over-before", "is-drag-over-after")); }
  list.ondragover = function (event) {
    const row = event.target.closest("[data-key]");
    if (!dragged || !row || row.dataset.key === dragged) return;
    event.preventDefault();
    clearDrag();
    row.classList.add(event.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2 ? "is-drag-over-after" : "is-drag-over-before");
  };
  list.ondrop = function (event) {
    event.preventDefault();
    const row = event.target.closest("[data-key]");
    if (row && dragged) move(dragged, row.dataset.key, event.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2);
    dragged = "";
    clearDrag();
  };
  list.ondragend = function () { dragged = ""; clearDrag(); };
  dialog.querySelector("[data-queue-reset]").onclick = function () { pref[mode] = sanitizeQueueColumns(null, wide); pref.resizer.reset(); update(); };
  dialog.querySelector("[data-queue-close]").onclick = () => dialog.close();
  dialog.addEventListener("click", event => { if (event.target === dialog && (event.clientX < dialog.getBoundingClientRect().left || event.clientX > dialog.getBoundingClientRect().right || event.clientY < dialog.getBoundingClientRect().top || event.clientY > dialog.getBoundingClientRect().bottom)) dialog.close(); });
  dialog.addEventListener("close", function () { dialog.remove(); head.querySelector("[data-queue-columns]")?.focus(); });
  renderList();
  document.body.appendChild(dialog);
  dialog.showModal();
}
