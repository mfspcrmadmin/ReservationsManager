// The existing selects and stage checkboxes remain the filtering contract.
export function initQueueDropdowns(root = document) {
  if (!("showPopover" in HTMLElement.prototype)) return;
  const panel = root.querySelector("#booking-browser-panel");
  if (!panel || panel.dataset.dropdownsReady) return;
  panel.dataset.dropdownsReady = "true";
  let active = null;
  const normalize = value => String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const position = control => {
    if (!control.opened) return;
    const rect = control.trigger.getBoundingClientRect();
    if (!rect.width || !rect.height) { control.close(false); return; }
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
    const width = viewport?.width || innerWidth, height = viewport?.height || innerHeight;
    const below = top + height - rect.bottom - 12, above = rect.top - top - 12;
    const up = below < 280 && above > below;
    control.menu.style.width = Math.min(Math.max(rect.width, 250), width - 16) + "px";
    control.menu.style.maxHeight = Math.max(60, Math.min(360, up ? above : below)) + "px";
    control.menu.style.left = Math.max(left + 8, Math.min(rect.left, left + width - control.menu.offsetWidth - 8)) + "px";
    control.menu.style.top = Math.max(top + 8, up ? rect.top - control.menu.offsetHeight - 4 : rect.bottom + 4) + "px";
  };
  const show = control => {
    if (active && active !== control) active.close(false);
    active = control;
    control.opened = true;
    if (control.menu.hidden) control.menu.hidden = false;
    if (control.menu.showPopover && !control.menu.matches(":popover-open")) control.menu.showPopover();
    control.trigger.setAttribute("aria-expanded", "true");
    position(control);
  };
  const hide = (control, focus = true) => {
    if (control.menu.matches(":popover-open")) control.menu.hidePopover();
    control.opened = false;
    if (!control.menu.hidden) control.menu.hidden = true;
    control.trigger.setAttribute("aria-expanded", "false");
    if (active === control) active = null;
    if (focus && !control.trigger.disabled) control.trigger.focus({ preventScroll: true });
  };
  const makeMenu = (menu, trigger) => {
    menu.classList.add("queue-dropdown-menu");
    menu.setAttribute("popover", "manual");
    trigger.classList.add("queue-dropdown-trigger");
    trigger.setAttribute("aria-controls", menu.id);
    trigger.setAttribute("aria-expanded", "false");
  };
  for (const [id, label, searchable] of [
    ["booking-browser-search-by", "Search by", false],
    ["booking-browser-owner", "Owner", true]
  ]) {
    const select = panel.querySelector("#" + id);
    if (!select) continue;
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.id = id + "-trigger";
    trigger.setAttribute("aria-haspopup", searchable ? "dialog" : "listbox");
    const menu = document.createElement("div");
    menu.id = id + "-menu";
    menu.hidden = true;
    menu.setAttribute("role", searchable ? "dialog" : "listbox");
    menu.setAttribute("aria-label", label);
    makeMenu(menu, trigger);
    // Keep the popup outside the wrapping label to avoid implicit label clicks.
    select.after(trigger);
    panel.append(menu);
    select.hidden = true;
    let search, clear;
    if (searchable) {
      const header = document.createElement("div");
      header.className = "queue-dropdown-search";
      header.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg>';
      search = document.createElement("input");
      search.type = "text";
      search.placeholder = "Search users\u2026";
      search.setAttribute("aria-label", "Search users");
      search.autocomplete = "off";
      search.setAttribute("role", "combobox");
      search.setAttribute("aria-autocomplete", "list");
      search.setAttribute("aria-expanded", "true");
      clear = document.createElement("button");
      clear.type = "button";
      clear.textContent = "\u00d7";
      clear.setAttribute("aria-label", "Clear user search");
      clear.onclick = () => { search.value = ""; render(); search.focus(); };
      header.append(search, clear);
      menu.append(header);
    }
    const list = document.createElement("div");
    list.className = "queue-dropdown-list";
    list.id = id + "-list";
    if (searchable) { list.setAttribute("role", "listbox"); list.setAttribute("aria-label", "Users"); search.setAttribute("aria-controls", list.id); }
    menu.append(list);
    let rows = [], highlighted = -1;
    const control = { trigger, menu, opened: false, close: focus => hide(control, focus) };
    const highlight = index => {
      highlighted = index;
      rows.forEach((row, i) => row.classList.toggle("is-highlighted", i === index));
      const input = search || menu;
      if (rows[index]) {
        input.setAttribute("aria-activedescendant", rows[index].id);
        rows[index].scrollIntoView({ block: "nearest" });
      } else input.removeAttribute("aria-activedescendant");
    };
    const choose = option => {
      select.value = option.value;
      control.close();
      select.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const render = () => {
      const query = normalize(search?.value || "");
      list.replaceChildren();
      rows = [];
      for (const child of select.children) {
        const grouped = child.tagName === "OPTGROUP";
        const options = (grouped ? Array.from(child.children) : [child]).filter(option =>
          !option.disabled && !child.disabled && (!searchable || option.value) && normalize(option.textContent).includes(query));
        if (!options.length) continue;
        let container = list;
        if (grouped) {
          container = document.createElement("div");
          container.setAttribute("role", "group");
          container.setAttribute("aria-label", child.label);
          const heading = document.createElement("div");
          heading.className = "queue-dropdown-group";
          heading.textContent = child.label;
          heading.setAttribute("aria-hidden", "true");
          container.append(heading);
          list.append(container);
        }
        for (const option of options) {
          const row = document.createElement("div");
          row.className = "queue-dropdown-option";
          row.id = id + "-option-" + rows.length;
          row.setAttribute("role", "option");
          row.setAttribute("aria-selected", String(option.selected));
          const text = document.createElement("span");
          text.textContent = option.textContent;
          const check = document.createElement("span");
          check.className = "queue-dropdown-check";
          check.textContent = "\u2713";
          check.setAttribute("aria-hidden", "true");
          row.append(text, check);
          row.onclick = () => choose(option);
          container.append(row);
          rows.push(row);
        }
      }
      if (!rows.length) {
        const empty = document.createElement("div");
        empty.className = "queue-dropdown-empty";
        empty.setAttribute("role", "status");
        empty.textContent = "No users found";
        list.append(empty);
      }
      if (clear) clear.hidden = !search.value;
      highlight(-1);
      position(control);
    };
    const sync = () => {
      trigger.disabled = select.disabled;
      trigger.textContent = select.selectedOptions[0]?.textContent || "Select owner";
      trigger.title = trigger.textContent;
      trigger.setAttribute("aria-label", (select.closest("label")?.querySelector("span")?.textContent || label) + ": " + trigger.textContent);
      if (trigger.disabled && control.opened) control.close(false);
      else if (control.opened) render();
    };
    const open = () => {
      if (trigger.disabled) return;
      if (search) search.value = "";
      render(); show(control);
      if (search) search.focus();
      else {
        menu.tabIndex = -1; menu.focus();
        highlight(Math.max(0, rows.findIndex(row => row.getAttribute("aria-selected") === "true")));
      }
    };
    trigger.onclick = () => control.opened ? control.close() : open();
    trigger.addEventListener("keydown", event => {
      if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); open(); }
    });
    if (search) search.addEventListener("input", render);
    let typeahead = "", typedAt = 0;
    menu.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); control.close(); }
      else if (event.key === "Tab") { control.close(); }
      else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && (event.key.startsWith("Arrow") || !searchable)) {
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 :
          highlighted < 0 ? (event.key === "ArrowDown" ? 0 : rows.length - 1) :
          (highlighted + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
        highlight(next);
      } else if (event.key === "Enter" || (!searchable && event.key === " ")) {
        if (event.target === clear) return;
        event.preventDefault(); rows[highlighted]?.click();
      } else if (!searchable && event.key.length === 1) {
        typeahead = Date.now() - typedAt > 700 ? event.key : typeahead + event.key;
        typedAt = Date.now();
        highlight(rows.findIndex(row => normalize(row.textContent).startsWith(normalize(typeahead))));
      }
    });
    new MutationObserver(sync).observe(select, { childList: true, subtree: true, attributes: true });
    select.addEventListener("change", sync);
    sync();
  }

  const trigger = panel.querySelector("#booking-browser-stages-toggle");
  const menu = panel.querySelector("#booking-browser-stages-menu");
  if (trigger && menu) {
    makeMenu(menu, trigger);
    trigger.setAttribute("aria-haspopup", "dialog");
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-label", "Stages");
    const control = { trigger, menu, opened: false, close(focus = true) {
      if (!menu.hidden) trigger.click();
      hide(control, focus);
    } };
    let focusValue = null, scroll = 0;
    menu.addEventListener("change", event => {
      focusValue = event.target.hasAttribute("data-stage-filter-toggle-all") ? "__all" : event.target.value;
      scroll = menu.scrollTop;
    }, true);
    const sync = () => {
      const all = menu.querySelector("[data-stage-filter-toggle-all]");
      const inputs = Array.from(menu.querySelectorAll("[data-stage-filter]"));
      const count = inputs.filter(input => input.checked).length;
      if (all) {
        all.indeterminate = count > 0 && count < inputs.length;
        all.checked = inputs.length > 0 && count === inputs.length;
        all.nextElementSibling.textContent = all.checked ? "Deselect all" : "Select all";
      }
      if (inputs.length) trigger.textContent = !count ? "No stages selected" : count === inputs.length ? "All stages" :
        count === 1 ? inputs.find(input => input.checked).value : count + " stages selected";
      if (menu.hidden || trigger.disabled) {
        if (control.opened) hide(control, false);
        return;
      }
      const wasOpen = control.opened;
      show(control);
      const target = focusValue === "__all" ? all : inputs.find(input => input.value === focusValue);
      if (focusValue !== null && target) { target.focus({ preventScroll: true }); menu.scrollTop = scroll; }
      else if (!wasOpen) (all || inputs[0])?.focus({ preventScroll: true });
      focusValue = null;
    };
    new MutationObserver(sync).observe(menu, { childList: true, attributes: true, attributeFilter: ["hidden"] });
    trigger.addEventListener("keydown", event => {
      if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); if (menu.hidden) trigger.click(); }
    });
    menu.addEventListener("keydown", event => {
      if (event.key === "Tab") {
        control.close();
      } else if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); control.close();
      } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const inputs = Array.from(menu.querySelectorAll("input"));
        const index = inputs.indexOf(document.activeElement);
        inputs[event.key === "Home" ? 0 : event.key === "End" ? inputs.length - 1 :
          (index + (event.key === "ArrowDown" ? 1 : -1) + inputs.length) % inputs.length]?.focus();
      } else if (event.key === "Enter") { event.preventDefault(); document.activeElement.click(); }
    });
    sync();
  }
  document.addEventListener("pointerdown", event => {
    if (active && !active.menu.contains(event.target) && !active.trigger.contains(event.target)) active.close(false);
  }, true);
  window.addEventListener("resize", () => { if (active) position(active); });
  document.addEventListener("scroll", () => { if (active) position(active); }, true);
}
