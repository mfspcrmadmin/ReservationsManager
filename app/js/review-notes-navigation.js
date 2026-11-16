// CRM WebTab passes custom URL state to the PageLoad event.
export function parseBookingTarget(data) {
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch (_) { throw new Error('The booking link is invalid.'); }
  }
  if (data?.widgetparams !== undefined) return parseBookingTarget(data.widgetparams);
  if (!data || data.view !== 'booking') return null;
  if (typeof data.bookingId !== 'string' || !/^\d+$/.test(data.bookingId)) throw new Error('The booking link has an invalid booking ID.');
  return { bookingId: data.bookingId };
}

export function parseReviewNotesTarget(data) {
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch (_) { throw new Error('The Review Notes link is invalid.'); }
  }
  if (data?.widgetparams !== undefined) return parseReviewNotesTarget(data.widgetparams);
  if (!data || data.view !== 'review-notes') return null;
  if (typeof data.bookingId !== 'string' || !/^\d+$/.test(data.bookingId)) throw new Error('The Review Notes link has an invalid booking ID.');
  return { bookingId: data.bookingId };
}

export function parsePrepaymentTarget(data) {
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch (_) { throw new Error('The prepayment link is invalid.'); }
  }
  if (data?.widgetparams !== undefined) return parsePrepaymentTarget(data.widgetparams);
  if (!data || data.view !== 'prepayment') return null;
  if (typeof data.bookingId !== 'string' || !/^\d+$/.test(data.bookingId) || typeof data.prepaymentId !== 'string' || !/^\d+$/.test(data.prepaymentId)) throw new Error('The prepayment link has an invalid booking or prepayment ID.');
  return { bookingId: data.bookingId, prepaymentId: data.prepaymentId };
}

export function createReviewNotesNavigation({ open, onError, parseTarget = parseReviewNotesTarget, getContextKey = () => '' }) {
  let ready = false, pending = null, running = false, lastId = '', lastContext;
  async function drain() {
    if (!ready || running) return;
    running = true;
    try {
      while (pending) {
        const target = pending;
        pending = null;
        const key = target.bookingId + ':' + (target.prepaymentId || '');
        if (key === lastId && getContextKey() === lastContext) continue;
        try {
          if (await open(target.bookingId, target) === false) continue;
          lastId = key;
          lastContext = getContextKey();
        } catch (error) { onError(error); }
      }
    } finally { running = false; }
  }
  return {
    receive(data) {
      try {
        const target = parseTarget(data);
        if (target) pending = target;
      } catch (error) { onError(error); }
      return drain();
    },
    start() { ready = true; return drain(); }
  };
}
