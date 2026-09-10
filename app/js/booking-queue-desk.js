// Share ticket requests across queue rows and Booking Status. Limit concurrent
// calls and cache completed responses briefly, without caching failed requests.
export function createDeskTicketLoader(fetchTicket) {
  const cache = new Map();
  const queue = [];
  let active = 0;
  function pump() {
    while (active < 3 && queue.length) {
      const task = queue.shift();
      active += 1;
      Promise.resolve().then(() => fetchTicket(task.id)).then(ticket => {
        task.entry.expires = Date.now() + 5 * 60 * 1000;
        task.resolve(ticket);
      }, error => {
        cache.delete(task.id);
        task.reject(error);
      }).finally(() => { active -= 1; pump(); });
    }
  }
  return function (ticketId) {
    const id = String(ticketId);
    const current = cache.get(id);
    if (current && current.expires > Date.now()) return current.promise;
    const entry = { expires: Infinity };
    entry.promise = new Promise((resolve, reject) => queue.push({ id, entry, resolve, reject }));
    cache.set(id, entry);
    pump();
    return entry.promise;
  };
}

const observers = new WeakMap();
export function observeQueueDeskCells(body, loadTicket, formatTicket) {
  const previous = observers.get(body);
  if (previous) previous.disconnect();
  if (!loadTicket) return;
  const cells = body.querySelectorAll("[data-queue-desk-ticket]");
  if (!cells.length) return;
  function load(cell) {
    const ticketId = cell.dataset.queueDeskTicket;
    Promise.resolve().then(() => loadTicket(ticketId)).then(ticket => {
      if (!cell.isConnected) return;
      cell.textContent = formatTicket(ticket);
      cell.title = cell.textContent;
    }).catch(() => {
      if (cell.isConnected) cell.textContent = "Interaction unavailable";
    });
  }
  if (typeof IntersectionObserver === "undefined") { cells.forEach(load); return; }
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      observer.unobserve(entry.target);
      load(entry.target);
    });
  }, { root: body.closest(".booking-browser-results-scroll"), rootMargin: "100px" });
  observers.set(body, observer);
  cells.forEach(cell => observer.observe(cell));
}
