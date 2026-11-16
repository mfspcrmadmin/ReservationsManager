import { loadBookingTasks, visibleBookingTasks, taskDateLabel } from "./booking-tasks.js";
import { escapeHtml } from "./utils.js";

const pending = new Map();
const queue = [];
let active = 0;
export function invalidateQueueTasks(bookingId) {
  pending.delete(String(bookingId));
}
export function loadQueueTasks(bookingId) {
  const id = String(bookingId);
  if (pending.has(id)) return pending.get(id);
  const promise = new Promise((resolve, reject) => queue.push({ id, resolve, reject }));
  queue[queue.length - 1].promise = promise;
  pending.set(id, promise);
  pump();
  return promise;
}
function pump() {
  while (active < 3 && queue.length) {
    const job = queue.shift();
    const promise = job.promise;
    active++;
    loadBookingTasks(job.id).then(job.resolve, job.reject).finally(() => {
      if (pending.get(job.id) === promise) pending.delete(job.id);
      active--;
      pump();
    });
  }
}

export function queueTaskSummary(tasks) {
  const open = visibleBookingTasks(tasks, "open");
  const now = new Date();
  const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
  if (!open.length) return '<span class="queue-task-count">0 open</span>';
  const row = task => {
    const label = taskDateLabel(task.Due_Date);
    const tone = !label ? ' task-date-tag--muted' : task.Due_Date < today ? ' task-date-tag--overdue' : '';
    return '<span class="queue-task-row"><span class="task-date-tag' + tone + '" title="' + escapeHtml(task.Due_Date || 'No due date') + '">' + escapeHtml(label || 'No date') + '</span><span class="queue-task-name" title="' + escapeHtml(task.Subject || 'Untitled task') + '">' + escapeHtml(task.Subject || 'Untitled task') + '</span></span>';
  };
  return '<span class="queue-task-list">' + open.slice(0, 2).map(row).join('') + '</span>' +
    (open.length > 2 ? '<button type="button" class="queue-tasks-more" aria-expanded="false" aria-label="Show ' + (open.length - 2) + ' more open tasks">+' + (open.length - 2) + '</button><template data-queue-tasks-preview><span class="queue-task-list">' + open.slice(2).map(row).join('') + '</span></template>' : '');
}

// Mount the preview outside the scrolling table so cell overflow cannot clip it.
export function bindQueueTaskPreview(cell) {
  const button = cell.querySelector('.queue-tasks-more');
  if (!button) return () => {};
  let popup = null, timer;
  function close() {
    clearTimeout(timer);
    popup?.remove();
    popup = null;
    button.setAttribute('aria-expanded', 'false');
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', close);
    document.removeEventListener('keydown', onKey);
  }
  function onKey(event) { if (event.key === 'Escape') { event.stopPropagation(); close(); } }
  function onScroll(event) { if (!popup?.contains(event.target)) close(); }
  function leave() { timer = setTimeout(close, 150); }
  function show() {
    clearTimeout(timer);
    if (popup || !cell.isConnected) return;
    popup = document.createElement('div');
    popup.className = 'queue-tasks-preview';
    popup.setAttribute('role', 'region');
    popup.setAttribute('aria-label', 'More open tasks');
    popup.innerHTML = cell.querySelector('[data-queue-tasks-preview]').innerHTML;
    document.body.appendChild(popup);
    const anchor = button.getBoundingClientRect();
    const box = popup.getBoundingClientRect();
    popup.style.left = Math.max(8, Math.min(anchor.left, window.innerWidth - box.width - 8)) + 'px';
    popup.style.top = Math.max(8, Math.min(anchor.bottom + 6, window.innerHeight - box.height - 8)) + 'px';
    popup.addEventListener('mouseenter', () => clearTimeout(timer));
    popup.addEventListener('mouseleave', leave);
    popup.addEventListener('click', event => event.stopPropagation());
    button.setAttribute('aria-expanded', 'true');
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onKey);
  }
  button.addEventListener('mouseenter', show);
  button.addEventListener('mouseleave', leave);
  button.addEventListener('focus', show);
  button.addEventListener('blur', close);
  button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); show(); });
  return close;
}

const observers = new WeakMap();
const previews = new WeakMap();
export function observeQueueTaskCells(body, state, load = loadQueueTasks) {
  observers.get(body)?.disconnect();
  previews.get(body)?.forEach(close => close());
  const cleanups = [];
  previews.set(body, cleanups);
  if (!state) return;
  const cells = body.querySelectorAll("[data-queue-tasks]");
  function show(cell) {
    const id = cell.dataset.queueTasks;
    Promise.resolve().then(() => load(id)).then(tasks => {
      if (!cell.isConnected) return;
      state.queueTaskCounts ||= {};
      state.queueTaskCounts[id] = tasks.filter(task => task.Status !== "Completed").length;
      cell.innerHTML = queueTaskSummary(tasks);
      cleanups.push(bindQueueTaskPreview(cell));
    }).catch(() => {
      if (cell.isConnected) { cell.textContent = "Tasks unavailable"; if (state.queueTaskCounts) delete state.queueTaskCounts[id]; }
    });
  }
  if (typeof IntersectionObserver === "undefined") { cells.forEach(show); return; }
  const rows = new Map();
  cells.forEach(cell => rows.set(cell.closest("tr"), cell));
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) { observer.unobserve(entry.target); show(rows.get(entry.target)); }
  }), { root: body.closest(".booking-browser-results-scroll"), rootMargin: "100px" });
  observers.set(body, observer);
  rows.forEach((cell, row) => observer.observe(row));
}
