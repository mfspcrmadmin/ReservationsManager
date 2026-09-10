const MIN_SIZE = 10;
const MAX_SIZE = 20;
const DEFAULT_SIZE = 12;
let storageKey = "";
let size = DEFAULT_SIZE;
let controls;
let table;

function applySize(value) {
  size = typeof value === "number" && Number.isFinite(value)
    ? Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(value))) : DEFAULT_SIZE;
  table.style.setProperty("--service-text-size", size + "px");
  controls.querySelector("output").textContent = size + " px";
  controls.querySelector('[data-text-size="decrease"]').disabled = size <= MIN_SIZE;
  controls.querySelector('[data-text-size="increase"]').disabled = size >= MAX_SIZE;
  controls.querySelector('[data-text-size="reset"]').disabled = size === DEFAULT_SIZE;
}

export function initServiceTextSize() {
  if (controls) return;
  controls = document.getElementById("service-text-size-controls");
  table = document.getElementById("services-body").closest("table");
  applySize(DEFAULT_SIZE);
  controls.addEventListener("click", function (event) {
    const button = event.target.closest("[data-text-size]");
    if (!button || button.disabled) return;
    const action = button.dataset.textSize;
    applySize(action === "reset" ? DEFAULT_SIZE : size + (action === "increase" ? 1 : -1));
    if (storageKey) {
      try { window.localStorage.setItem(storageKey, JSON.stringify(size)); } catch (_) { /* Keep the session preference. */ }
    }
  });
}

export function loadServiceTextSizeForUser(state) {
  const identity = state.currentUserId ? "id:" + state.currentUserId
    : state.currentUserEmail ? "email:" + state.currentUserEmail.trim().toLowerCase() : "";
  const nextKey = identity ? "reservationsManager.serviceTextSize." + identity : "";
  if (nextKey === storageKey) return;
  storageKey = nextKey;
  let stored = DEFAULT_SIZE;
  if (storageKey) {
    try { stored = JSON.parse(window.localStorage.getItem(storageKey)); } catch (_) { /* Use the default if storage is unavailable. */ }
  }
  applySize(stored);
}
