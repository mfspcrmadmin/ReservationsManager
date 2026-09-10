const headBindings = new WeakMap();

export function createColumnResizer(storageKey, defaultWidths, firstFixedWidth = 62) {
const STORAGE_KEY = storageKey;
const MIN_WIDTH = 80;
const MAX_WIDTH = 1000;
const DEFAULT_WIDTHS = defaultWidths;
let widths = null;

function readWidths() {
  if (widths) return widths;
  widths = {};
  if (!STORAGE_KEY) return widths;
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    if (stored && typeof stored === "object" && !Array.isArray(stored)) {
      Object.keys(stored).forEach(function (key) {
        if (typeof stored[key] === "number" && Number.isFinite(stored[key])) {
          widths[key] = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, stored[key]));
        }
      });
    }
  } catch (_) { /* Resizing still works when browser storage is unavailable. */ }
  return widths;
}

function saveWidths() {
  if (!STORAGE_KEY) return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(widths)); } catch (_) { /* Keep the session preference. */ }
}

function resetServiceColumnWidths() {
  widths = {};
  saveWidths();
}

function defaultWidth(key) {
  return DEFAULT_WIDTHS[key] || 180;
}

function applyWidths(head) {
  const table = head.closest("table");
  let total = 0;
  Array.from(table.querySelector("colgroup").children).forEach(function (col) {
    const key = col.dataset.serviceWidth;
    const width = key ? readWidths()[key] || defaultWidth(key) : Number(col.dataset.fixedWidth);
    col.style.width = width + "px";
    total += width;
  });
  table.style.width = total + "px";
  head.querySelectorAll("[data-service-resize]").forEach(function (handle) {
    handle.setAttribute("aria-valuenow", String(readWidths()[handle.dataset.serviceResize] || defaultWidth(handle.dataset.serviceResize)));
  });
}

function configureServiceColumnWidths(head) {
  const table = head.closest("table");
  table.classList.add("services-table--resizable");
  const group = document.createElement("colgroup");
  Array.from(head.children).forEach(function (cell, index) {
    const col = document.createElement("col");
    const key = cell.dataset.serviceColumnKey;
    if (key) {
      col.dataset.serviceWidth = key;
      const handle = document.createElement("span");
      handle.className = "service-column-resize-handle";
      handle.dataset.serviceResize = key;
      handle.tabIndex = 0;
      handle.setAttribute("role", "separator");
      handle.setAttribute("aria-orientation", "vertical");
      handle.setAttribute("aria-label", "Resize " + cell.textContent + " column");
      handle.setAttribute("aria-valuemin", String(MIN_WIDTH));
      handle.setAttribute("aria-valuemax", String(MAX_WIDTH));
      handle.title = "Drag to resize. Double-click to reset. Use arrow keys to adjust.";
      cell.appendChild(handle);
    } else {
      col.dataset.fixedWidth = index === 0 ? String(firstFixedWidth) : "42";
    }
    group.appendChild(col);
  });
  const previous = table.querySelector("colgroup");
  if (previous) previous.replaceWith(group);
  else table.prepend(group);
  applyWidths(head);
  const previousBinding = headBindings.get(head);
  if (previousBinding && previousBinding.owner === configureServiceColumnWidths) return;
  if (previousBinding) previousBinding.controller.abort();
  const controller = new AbortController();
  headBindings.set(head, { owner: configureServiceColumnWidths, controller });
  function listen(type, handler) { head.addEventListener(type, handler, { signal: controller.signal }); }

  let drag = null;
  function changeWidth(key, width) {
    readWidths()[key] = Math.round(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width)));
    applyWidths(head);
  }
  function finish(cancelled) {
    if (!drag) return;
    const current = drag;
    drag = null;
    if (cancelled) changeWidth(current.key, current.width);
    else saveWidths();
    document.body.classList.remove("is-resizing-service-column");
    if (current.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
  }
  listen("pointerdown", function (event) {
    const handle = event.target.closest("[data-service-resize]");
    if (!handle || event.button !== 0) return;
    event.preventDefault();
    handle.focus({ preventScroll: true });
    const key = handle.dataset.serviceResize;
    drag = { key, handle, x: event.clientX, width: readWidths()[key] || defaultWidth(key), pointerId: event.pointerId };
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add("is-resizing-service-column");
  });
  listen("pointermove", function (event) {
    if (drag && drag.pointerId === event.pointerId) changeWidth(drag.key, drag.width + event.clientX - drag.x);
  });
  listen("pointerup", function () { finish(false); });
  listen("pointercancel", function () { finish(true); });
  listen("lostpointercapture", function () { finish(true); });
  listen("dblclick", function (event) {
    const handle = event.target.closest("[data-service-resize]");
    if (!handle) return;
    changeWidth(handle.dataset.serviceResize, defaultWidth(handle.dataset.serviceResize));
    saveWidths();
  });
  listen("keydown", function (event) {
    if (event.key === "Escape" && drag) { event.preventDefault(); event.stopPropagation(); finish(true); return; }
    const handle = event.target.closest("[data-service-resize]");
    if (!handle || !["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
    event.preventDefault();
    const key = handle.dataset.serviceResize;
    const current = readWidths()[key] || defaultWidth(key);
    const step = event.shiftKey ? 50 : 10;
    changeWidth(key, event.key === "Home" ? defaultWidth(key) : current + (event.key === "ArrowRight" ? step : -step));
    saveWidths();
  });
}
return { configure: configureServiceColumnWidths, reset: resetServiceColumnWidths };
}

const serviceResizer = createColumnResizer("reservationsManager.serviceColumnWidths", {
  name: 100, date: 152, serviceDateTime: 216, status: 210, serviceName: 320, supplier: 200, paxNumber: 112, step: 260, serviceNotes: 260
});
export const configureServiceColumnWidths = serviceResizer.configure;
export const resetServiceColumnWidths = serviceResizer.reset;
