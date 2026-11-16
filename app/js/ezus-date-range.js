const DAY = 86400000;
const parseDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? Date.parse(value + 'T00:00:00Z') : NaN;
const iso = value => new Date(value).toISOString().slice(0, 10);
export function ezusRangeDays(start, end) {
  return Math.round((parseDay(end) - parseDay(start)) / DAY) + 1;
}
export function isEzusDepartureAllowed(start, end) {
  const days = ezusRangeDays(start, end);
  return Number.isFinite(days) && days >= 1 && days <= 40;
}

export function initializeEzusDateRange(form) {
  const arrival = form.elements.Arrival_Date, departure = form.elements.Departure_Date;
  const section = arrival.closest('.ezus-trip-section');
  const host = document.createElement('div');
  host.className = 'ezus-date-range';
  host.innerHTML = '<button type="button" class="ezus-range-toggle" aria-expanded="false">Choose travel dates <span aria-hidden="true">▾</span></button><div class="ezus-range-panel" hidden><div class="ezus-range-selection"><button type="button" data-range-mode="arrival"><span>Arrival</span><strong></strong></button><span aria-hidden="true">→</span><button type="button" data-range-mode="departure"><span>Departure</span><strong></strong></button></div><div class="ezus-range-navigation"><button type="button" data-month="-1" aria-label="Previous month">‹</button><p data-range-instruction role="status" aria-live="polite"></p><button type="button" data-month="1" aria-label="Next month">›</button></div><div class="ezus-range-months"></div><p class="ezus-range-footnote">Choose arrival, then departure · Up to 40 days including both dates</p></div>';
  section.appendChild(host);
  const panel = host.querySelector('.ezus-range-panel'), toggle = host.querySelector('.ezus-range-toggle');
  const months = host.querySelector('.ezus-range-months');
  const now = new Date();
  const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  const monthTitle = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const dayTitle = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const shortDate = value => Number.isFinite(parseDay(value)) ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(parseDay(value)) : 'Select date';
  let mode = 'arrival', view = parseDay(today), focusDay = today;
  const monthStart = value => { const date = new Date(value); return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1); };
  const allowed = value => mode === 'arrival' || isEzusDepartureAllowed(arrival.value, value);
  function constraints() {
    departure.min = arrival.value || '';
    departure.max = Number.isFinite(parseDay(arrival.value)) ? iso(parseDay(arrival.value) + 39 * DAY) : '';
  }
  function highlight(end = departure.value) {
    for (const button of months.querySelectorAll('[data-day]')) {
      const value = button.dataset.day;
      button.classList.toggle('is-start', value === arrival.value);
      button.classList.toggle('is-end', value === end && isEzusDepartureAllowed(arrival.value, end));
      button.classList.toggle('is-between', value > arrival.value && value < end && isEzusDepartureAllowed(arrival.value, end));
      button.setAttribute('aria-pressed', String(value === arrival.value || value === departure.value));
    }
  }
  function render() {
    constraints();
    for (const button of host.querySelectorAll('[data-range-mode]')) {
      button.setAttribute('aria-pressed', String(button.dataset.rangeMode === mode));
      button.querySelector('strong').textContent = shortDate(button.dataset.rangeMode === 'arrival' ? arrival.value : departure.value);
    }
    host.querySelector('[data-range-instruction]').textContent = mode === 'arrival' ? 'Select arrival date' : isEzusDepartureAllowed(arrival.value, departure.value) ? ezusRangeDays(arrival.value, departure.value) + ' days selected' : 'Now select departure date';
    months.innerHTML = [0, 1].map(offset => {
      const date = new Date(view), first = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1);
      const firstDate = new Date(first), count = new Date(Date.UTC(firstDate.getUTCFullYear(), firstDate.getUTCMonth() + 1, 0)).getUTCDate();
      const empty = (firstDate.getUTCDay() + 6) % 7;
      let days = '<span aria-hidden="true"></span>'.repeat(empty);
      for (let day = 0; day < count; day++) {
        const value = iso(first + day * DAY);
        days += '<button type="button" data-day="' + value + '" tabindex="' + (value === focusDay ? '0' : '-1') + '" aria-label="' + dayTitle.format(first + day * DAY) + '"' + (value === today ? ' aria-current="date"' : '') + (allowed(value) ? '' : ' disabled') + '>' + (day + 1) + '</button>';
      }
      return '<section class="ezus-range-month" aria-label="' + monthTitle.format(first) + '"><h6>' + monthTitle.format(first) + '</h6><div class="ezus-range-weekdays" aria-hidden="true">' + ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(day => '<span>' + day + '</span>').join('') + '</div><div class="ezus-range-days">' + days + '</div></section>';
    }).join('');
    if (!months.querySelector('[tabindex="0"]:not(:disabled)')) months.querySelector('[data-day]:not(:disabled)')?.setAttribute('tabindex', '0');
    highlight();
  }
  function open(nextMode) {
    mode = nextMode === 'departure' && Number.isFinite(parseDay(arrival.value)) ? 'departure' : 'arrival';
    focusDay = (mode === 'departure' ? departure.value || arrival.value : arrival.value) || today;
    view = monthStart(Number.isFinite(parseDay(focusDay)) ? parseDay(focusDay) : parseDay(today));
    panel.hidden = false; toggle.setAttribute('aria-expanded', 'true'); render();
  }
  toggle.onclick = () => {
    if (panel.hidden) open('arrival');
    else { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); }
  };
  host.querySelectorAll('[data-range-mode]').forEach(button => { button.onclick = () => open(button.dataset.rangeMode); });
  host.querySelectorAll('[data-month]').forEach(button => { button.onclick = () => {
    const date = new Date(view); view = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + Number(button.dataset.month), 1); render();
  }; });
  months.onclick = event => {
    const button = event.target.closest('[data-day]');
    if (!button || button.disabled) return;
    const value = button.dataset.day;
    if (mode === 'arrival') { arrival.value = value; departure.value = ''; mode = 'departure'; }
    else departure.value = value;
    focusDay = value;
    for (const input of [arrival, departure]) {
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    render(); months.querySelector('[data-day="' + value + '"]')?.focus();
  };
  months.addEventListener('pointerover', event => {
    const button = event.target.closest('[data-day]');
    if (mode === 'departure' && button && !button.disabled) highlight(button.dataset.day);
  });
  months.addEventListener('pointerleave', () => highlight());
  months.addEventListener('keydown', event => {
    const button = event.target.closest('[data-day]');
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (!button || !delta) return;
    event.preventDefault();
    const next = iso(parseDay(button.dataset.day) + delta * DAY);
    if (!allowed(next)) return;
    focusDay = next;
    if (!months.querySelector('[data-day="' + next + '"]')) view = monthStart(parseDay(next));
    render(); months.querySelector('[data-day="' + next + '"]')?.focus();
  });
  host.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); event.stopPropagation(); panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); toggle.focus(); }
  });
  for (const [input, target] of [[arrival, 'arrival'], [departure, 'departure']]) {
    input.addEventListener('click', event => { event.preventDefault(); open(target); });
    input.addEventListener('input', () => { constraints(); if (!panel.hidden) render(); });
  }
  return () => { constraints(); if (!panel.hidden) render(); };
}
