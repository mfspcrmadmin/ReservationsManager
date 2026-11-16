// Progressive enhancement: the native select remains the integration's value source.
const controls = new WeakMap();
function tone(value) {
  const text = String(value).toLowerCase().replace(/-/g, ' ');
  if (/refund/.test(text)) return '#806291';
  if (/fully paid|confirmed/.test(text)) return '#43805b';
  if (/prepayment requested|pre payment requested|on request/.test(text)) return '#527e9a';
  if (/paid|optional/.test(text)) return '#a97822';
  if (/cancel|alert|blocked/.test(text)) return '#b35b58';
  return '#87918c';
}
function caption(option) { return !option || !option.value || option.text === '-None-' ? 'Not set' : option.text; }

export function syncServiceStatusDropdown(select, settings = {}) {
  if (!select?.ownerDocument || (!settings.enhance && !['field-status-ezus', 'field-payment-status'].includes(select.id))) return;
  if (controls.has(select)) { const control = controls.get(select); control.sync(); return control; }
  const doc = select.ownerDocument;
  const events = new AbortController();
  if (!select.id) select.id = 'prepayment-' + select.name;
  const trigger = doc.createElement('button');
  // Keep native UI as a fallback on browsers without the top-layer API.
  const menu = doc.createElement('div');
  if (!menu.showPopover) return;
  trigger.type = 'button';
  trigger.className = 'service-state-trigger';
  trigger.id = select.id + '-trigger';
  trigger.setAttribute('role', 'combobox');
  trigger.setAttribute('aria-label', settings.label || select.getAttribute('aria-label') || 'Status');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  menu.id = select.id + '-options';
  menu.className = 'service-state-menu' + (settings.multiline ? ' service-state-menu--multiline' : '');
  menu.setAttribute('popover', 'manual');
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', trigger.getAttribute('aria-label'));
  trigger.setAttribute('aria-controls', menu.id);
  select.after(trigger, menu);
  select.hidden = true;
  doc.querySelector('label[for="' + select.id + '"]')?.setAttribute('for', trigger.id);
  let opened = false, active = 0, searchText = '', lastTyped = 0;
  const options = () => Array.from(select.options);
  const close = () => {
    if (opened) menu.hidePopover();
    opened = false;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-activedescendant');
  };
  const position = () => {
    if (!opened) return;
    const rect = trigger.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
    const width = viewport?.width || window.innerWidth, height = viewport?.height || window.innerHeight;
    if (!trigger.getClientRects().length || rect.bottom < top || rect.top > top + height) { close(); return; }
    const below = Math.max(0, top + height - rect.bottom - 12), above = Math.max(0, rect.top - top - 12);
    const up = below < Math.min(300, options().length * 36 + 10) && above > below;
    menu.style.width = Math.min(rect.width, width - 16) + 'px';
    menu.style.maxHeight = Math.min(300, up ? above : below) + 'px';
    menu.style.left = Math.max(left + 8, Math.min(rect.left, left + width - menu.offsetWidth - 8)) + 'px';
    menu.style.top = Math.max(top + 8, up ? rect.top - menu.offsetHeight - 4 : rect.bottom + 4) + 'px';
  };
  const highlight = () => {
    Array.from(menu.children).forEach((item, index) => item.classList.toggle('is-active', index === active));
    const item = menu.children[active];
    if (item) { trigger.setAttribute('aria-activedescendant', item.id); item.scrollIntoView({ block: 'nearest' }); }
  };
  const sync = () => {
    trigger.disabled = select.matches(':disabled');
    trigger.setAttribute('aria-busy', select.dataset.saving === 'true' ? 'true' : 'false');
    trigger.title = select.title || caption(select.selectedOptions[0]);
    trigger.replaceChildren();
    const dot = doc.createElement('span'); dot.className = 'service-state-dot'; dot.style.backgroundColor = tone(select.value); dot.setAttribute('aria-hidden', 'true');
    const label = doc.createElement('span'); label.className = 'service-state-label'; label.textContent = caption(select.selectedOptions[0]);
    const arrow = doc.createElement('span'); arrow.className = 'service-state-chevron'; arrow.setAttribute('aria-hidden', 'true');
    trigger.append(...(settings.plain ? [label, arrow] : [dot, label, arrow]));
    if (trigger.disabled) close();
  };
  const open = () => {
    if (select.matches(':disabled') || opened) return;
    menu.replaceChildren();
    options().forEach((option, index) => {
      const row = doc.createElement('div'); row.className = 'service-state-option'; row.id = menu.id + '-' + index;
      row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(option.selected)); row.setAttribute('aria-disabled', String(option.disabled));
      const dot = doc.createElement('span'); dot.className = 'service-state-dot'; dot.style.backgroundColor = tone(option.value); dot.setAttribute('aria-hidden', 'true');
      const label = doc.createElement('span'); label.className = 'service-state-label'; label.textContent = caption(option); row.title = caption(option);
      const check = doc.createElement('span'); check.className = 'service-state-check'; check.textContent = '✓'; check.setAttribute('aria-hidden', 'true');
      row.append(...(settings.plain ? [label, check] : [dot, label, check])); row.addEventListener('click', () => choose(index)); menu.append(row);
    });
    opened = true; active = Math.max(0, select.selectedIndex); menu.showPopover();
    trigger.setAttribute('aria-expanded', 'true'); position(); highlight();
  };
  const choose = index => {
    const option = options()[index];
    if (select.matches(':disabled') || !option || option.disabled) return;
    close(); trigger.focus();
    if (select.value === option.value) return;
    select.value = option.value; sync();
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  trigger.addEventListener('click', () => opened ? close() : open());
  trigger.addEventListener('keydown', event => {
    if (event.key === 'Escape' && opened) { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === 'Tab') { close(); return; }
    if (['Enter', ' '].includes(event.key)) { event.preventDefault(); opened ? choose(active) : open(); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (!opened) { open(); return; }
      const enabled = options().map((o, i) => o.disabled ? -1 : i).filter(i => i >= 0);
      const index = enabled.indexOf(active);
      active = event.key === 'Home' ? enabled[0] : event.key === 'End' ? enabled.at(-1) : enabled[(index + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length];
      highlight();
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); open();
      searchText = Date.now() - lastTyped > 700 ? event.key : searchText + event.key;
      lastTyped = Date.now();
      const match = options().findIndex(option => !option.disabled && caption(option).toLowerCase().startsWith(searchText.toLowerCase()));
      if (match >= 0) { active = match; highlight(); }
    }
  });
  menu.addEventListener('pointerdown', event => event.preventDefault());
  trigger.addEventListener('blur', close);
  doc.addEventListener('pointerdown', event => { if (!menu.contains(event.target) && !trigger.contains(event.target)) close(); }, { signal: events.signal });
  doc.addEventListener('scroll', event => { if (!menu.contains(event.target)) position(); }, { capture: true, signal: events.signal });
  window.addEventListener('resize', position, { signal: events.signal });
  window.visualViewport?.addEventListener('resize', position, { signal: events.signal });
  select.addEventListener('change', sync);
  const observer = new MutationObserver(() => { close(); sync(); });
  observer.observe(select, { attributes: true, childList: true, subtree: true });
  const fieldset = select.closest('fieldset');
  if (fieldset) observer.observe(fieldset, { attributes: true, attributeFilter: ['disabled'] });
  const control = { sync, open() { trigger.focus(); open(); }, destroy() { close(); observer.disconnect(); events.abort(); trigger.remove(); menu.remove(); select.hidden = false; controls.delete(select); } };
  controls.set(select, control); sync();
  return control;
}
