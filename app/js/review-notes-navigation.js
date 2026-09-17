// CRM WebTab passes custom URL state to the PageLoad event.
export function parseReviewNotesTarget(data) {
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch (_) { throw new Error('The Review Notes link is invalid.'); }
  }
  if (data?.widgetparams !== undefined) return parseReviewNotesTarget(data.widgetparams);
  if (!data || data.view !== 'review-notes') return null;
  if (typeof data.bookingId !== 'string' || !/^\d+$/.test(data.bookingId)) throw new Error('The Review Notes link has an invalid booking ID.');
  return { bookingId: data.bookingId };
}

export function createReviewNotesNavigation({ open, onError }) {
  let ready = false, pending = null, running = false, lastId = '';
  async function drain() {
    if (!ready || running) return;
    running = true;
    try {
      while (pending) {
        const target = pending;
        pending = null;
        if (target.bookingId === lastId) continue;
        try {
          await open(target.bookingId);
          lastId = target.bookingId;
        } catch (error) { onError(error); }
      }
    } finally { running = false; }
  }
  return {
    receive(data) {
      try {
        const target = parseReviewNotesTarget(data);
        if (target) pending = target;
      } catch (error) { onError(error); }
      return drain();
    },
    start() { ready = true; return drain(); }
  };
}
