// Common chrome behavior; business actions remain in their existing controllers.
const visible = element => element && !element.closest("[hidden]") && element.getClientRects().length > 0;
const focusable = root => [...root.querySelectorAll('button, a[href], input, select, textarea, summary, [tabindex]')]
  .filter(element => visible(element) && !element.disabled && element.tabIndex >= 0);
const setAttribute = (element, name, value) => {
  if (element.getAttribute(name) !== String(value)) element.setAttribute(name, String(value));
};

export function confirmRegeneration() {
  return new Promise(resolve => {
    const previous = document.activeElement;
    const dialog = document.createElement("dialog");
    dialog.className = "communication-editor";
    dialog.setAttribute("aria-labelledby", "regenerate-confirm-title");
    dialog.innerHTML = '<h2 id="regenerate-confirm-title">Regenerate this draft?</h2><p>The draft will be rebuilt from its communication and current booking data. Manual changes to the existing draft may be replaced. No email is sent by this action.</p><div class="communication-editor-actions"><button type="button" data-cancel class="button tertiary">Keep draft</button><button type="button" data-confirm class="button primary">Regenerate draft</button></div>';
    let confirmed = false;
    dialog.querySelector("[data-cancel]").onclick = () => dialog.close();
    dialog.querySelector("[data-confirm]").onclick = () => { confirmed = true; dialog.close(); };
    dialog.addEventListener("close", () => { dialog.remove(); if (previous?.isConnected) previous.focus(); resolve(confirmed); }, { once: true });
    document.body.append(dialog);
    dialog.showModal();
    dialog.querySelector("[data-cancel]").focus();
  });
}

export function enhanceLookup(select) {
  if (!("showPopover" in HTMLElement.prototype) || select.dataset.lookupReady) return;
  select.dataset.lookupReady = "true";
  const label = select.getAttribute("aria-label") || select.labels?.[0]?.querySelector("span")?.textContent ||
    (select.name === "Owner" ? "Task owner" : "Supplier");
  const trigger = document.createElement("button");
  trigger.type = "button"; trigger.className = "lookup-trigger";
  const menu = document.createElement("div");
  menu.className = "lookup-menu"; menu.setAttribute("popover", "auto");
  menu.setAttribute("role", "dialog"); menu.setAttribute("aria-label", label);
  menu.id = "lookup-" + (select.id || select.name) + "-" + Math.random().toString(36).slice(2, 8);
  trigger.setAttribute("aria-haspopup", "dialog"); trigger.setAttribute("aria-controls", menu.id);
  menu.innerHTML = '<input type="search" placeholder="Search options…" aria-label="Search options" autocomplete="off"><div class="lookup-options" role="listbox"></div><p class="save-behavior-hint" role="status"></p>';
  const search = menu.querySelector("input"), list = menu.querySelector(".lookup-options"), status = menu.querySelector("[role=status]");
  list.setAttribute("aria-label", label);
  select.after(trigger); (select.closest("dialog, .booking-action-dialog") || document.body).append(menu);
  select.hidden = true;
  const position = () => {
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 260), innerWidth - 16);
    menu.style.width = width + "px";
    menu.style.left = Math.max(8, Math.min(rect.left, innerWidth - width - 8)) + "px";
    const below = innerHeight - rect.bottom - 12, above = rect.top - 12;
    const up = below < 280 && above > below;
    menu.style.maxHeight = Math.max(80, Math.min(360, up ? above : below)) + "px";
    menu.style.overflowY = "auto";
    menu.style.top = Math.max(8, up ? rect.top - menu.offsetHeight - 4 : rect.bottom + 4) + "px";
  };
  const close = (restore = false) => {
    if (menu.matches(":popover-open")) menu.hidePopover();
    if (restore) trigger.focus();
  };
  const sync = () => {
    trigger.textContent = select.selectedOptions[0]?.textContent || "Choose " + label.toLowerCase();
    trigger.title = trigger.textContent;
    trigger.setAttribute("aria-label", label + ": " + trigger.textContent);
    trigger.disabled = select.matches(":disabled");
    if (trigger.disabled) close();
  };
  const render = () => {
    list.replaceChildren();
    const normalize = text => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const query = normalize(search.value.trim());
    for (const option of select.options) {
      if (option.disabled || option.parentElement.disabled || !normalize(option.textContent).includes(query)) continue;
      const row = document.createElement("button");
      row.type = "button"; row.className = "lookup-option"; row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(option.selected));
      row.textContent = option.textContent + (option.selected ? " ✓" : "");
      row.onclick = () => {
        select.value = option.value; sync(); close(true);
        select.dispatchEvent(new Event("change", { bubbles: true }));
      };
      list.append(row);
    }
    status.textContent = list.children.length ? "" : "No matching options.";
    position();
  };
  trigger.onclick = () => {
    if (menu.matches(":popover-open")) { close(); return; }
    search.value = ""; menu.showPopover(); render(); search.focus();
  };
  trigger.onkeydown = event => { if (event.key === "ArrowDown") { event.preventDefault(); trigger.click(); } };
  search.oninput = render;
  menu.addEventListener("toggle", () => trigger.setAttribute("aria-expanded", String(menu.matches(":popover-open"))));
  menu.addEventListener("keydown", event => {
    const rows = [...list.children], index = rows.indexOf(document.activeElement);
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === "Tab") {
      // Place focus at the trigger before the browser performs its normal Tab move.
      close(true);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = index < 0 ? (event.key === "ArrowDown" ? 0 : rows.length - 1) :
        (index + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
      rows[next]?.focus();
    } else if (event.key === "Enter" && document.activeElement === search) {
      event.preventDefault(); rows[0]?.click();
    }
  });
  select.addEventListener("change", sync);
  select.addEventListener("invalid", event => { event.preventDefault(); trigger.focus(); trigger.click(); status.textContent = "Choose a value before continuing."; });
  const observer = new MutationObserver(() => { sync(); if (menu.matches(":popover-open")) render(); });
  const resize = () => { if (menu.matches(":popover-open")) position(); };
  const scroll = event => { if (menu.matches(":popover-open") && !menu.contains(event.target)) position(); };
  observer.observe(select, { attributes: true, childList: true, subtree: true });
  const fieldset = select.closest("fieldset");
  if (fieldset) observer.observe(fieldset, { attributes: true, attributeFilter: ["disabled"] });
  const lifecycle = new MutationObserver(() => {
    if (!select.isConnected) { close(); menu.remove(); observer.disconnect(); lifecycle.disconnect(); window.removeEventListener("resize", resize); document.removeEventListener("scroll", scroll, true); }
  });
  lifecycle.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("resize", resize);
  document.addEventListener("scroll", scroll, true);
  sync(); trigger.setAttribute("aria-expanded", "false");
}

export function initInterfaceSystem() {
  const groups = [
    [".page-tabs", {"tab-booking":"manage-booking-panel","tab-services":"manage-services-panel","tab-documents":"manage-documents-panel","tab-emails":"manage-emails-panel","tab-tasks":"manage-tasks-panel","tab-payments":"manage-payments-panel","tab-reports":"manage-reports-panel","summary-view-communication":"manage-booking-panel"}],
    [".summary-mode-switch--details", {"summary-view-basic":"summary-content","summary-view-financial":"summary-content","summary-view-travelers":"summary-travelers-view"}],
    [".service-detail-tabs", {"service-detail-tab-basic":"service-detail-content","service-detail-tab-financial":"service-detail-content","service-detail-tab-step":"service-detail-content"}],
    [".mail-status-switch", {"mail-filter-draft":"active-mail-list","mail-filter-sent":"active-mail-list"}],
    [".payments-tabs, .payments-subtabs", {"payment-tab-travelers":"payment-travelers-panel","payment-tab-refunds":"payment-refunds-panel","payment-tab-prepayments":"payment-prepayments-panel","payment-tab-card-purchases":"payment-card-purchases-panel","payment-tab-renfe":"payment-renfe-panel"}]
  ];
  const filterControls = new WeakMap();
  const modalOpeners = new Map();
  const enhanceFilter = menu => {
    if (!("showPopover" in HTMLElement.prototype)) return;
    let control = filterControls.get(menu);
    if (!control) {
      const trigger = menu.parentElement.querySelector("button");
      if (!trigger) return;
      menu.setAttribute("popover", "manual");
      menu.setAttribute("role", "dialog");
      menu.setAttribute("aria-label", trigger.closest(".field")?.querySelector("span")?.textContent || "Filter options");
      trigger.setAttribute("aria-haspopup", "dialog");
      trigger.setAttribute("aria-controls", menu.id);
      const close = restore => {
        if (!menu.hidden) trigger.click();
        if (menu.matches(":popover-open")) menu.hidePopover();
        const search = menu.querySelector("[data-filter-search]");
        if (search) {
          search.value = "";
          menu.querySelectorAll(".service-multi-filter-option").forEach(option => { option.hidden = false; });
        }
        if (restore) trigger.focus();
      };
      control = { trigger, close };
      filterControls.set(menu, control);
      menu.addEventListener("keydown", event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
        else if (event.key === "Tab") close(true);
        else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          if (event.target.type === "search" && ["Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const inputs = [...menu.querySelectorAll("input")].filter(input => visible(input) && !input.disabled);
          const index = inputs.indexOf(document.activeElement);
          const next = event.key === "Home" ? 0 : event.key === "End" ? inputs.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + inputs.length) % inputs.length;
          inputs[next]?.focus();
        }
      });
    }
    const options = [...menu.querySelectorAll(".service-multi-filter-option")];
    let search = menu.querySelector("[data-filter-search]");
    if (options.length > 8 && !search) {
      search = document.createElement("input");
      search.type = "search"; search.dataset.filterSearch = "true";
      search.placeholder = "Search options…"; search.setAttribute("aria-label", "Search filter options");
      menu.prepend(search);
      search.addEventListener("input", () => {
        const normalize = value => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        const query = normalize(search.value.trim());
        menu.querySelectorAll(".service-multi-filter-option").forEach(option => {
          option.hidden = !normalize(option.textContent).includes(query);
        });
      });
    }
    if (menu.hidden) {
      if (menu.matches(":popover-open")) menu.hidePopover();
      if (search?.value) { search.value = ""; options.forEach(option => { option.hidden = false; }); }
      return;
    }
    const opened = menu.matches(":popover-open");
    if (!opened) menu.showPopover();
    const rect = control.trigger.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 260), innerWidth - 16);
    menu.style.width = width + "px";
    const below = innerHeight - rect.bottom - 12, above = rect.top - 12, up = below < 260 && above > below;
    menu.style.maxHeight = Math.max(70, Math.min(360, up ? above : below)) + "px";
    menu.style.left = Math.max(8, Math.min(rect.left, innerWidth - width - 8)) + "px";
    menu.style.top = Math.max(8, up ? rect.top - menu.offsetHeight - 4 : rect.bottom + 4) + "px";
    if (!opened) menu.querySelector("input")?.focus();
  };
  const syncTabs = (group, panels) => {
    setAttribute(group, "role", "tablist");
    if (!group.hasAttribute("aria-label")) group.setAttribute("aria-label", "Views");
    const buttons = [...group.querySelectorAll(":scope > button")];
    for (const button of buttons) {
      const selected = button.classList.contains("active") || button.classList.contains("is-active");
      setAttribute(button, "role", "tab"); setAttribute(button, "aria-selected", selected);
      setAttribute(button, "tabindex", selected ? "0" : "-1");
      const panel = document.getElementById(panels[button.id]);
      if (panel) {
        setAttribute(button, "aria-controls", panel.id); setAttribute(panel, "role", "tabpanel");
        if (selected) setAttribute(panel, "aria-labelledby", button.id);
      }
    }
    if (group.dataset.keyboardTabs) return;
    group.dataset.keyboardTabs = "true";
    group.addEventListener("keydown", event => {
      if (!["ArrowLeft","ArrowRight","Home","End"].includes(event.key)) return;
      const tabs = [...group.querySelectorAll(":scope > button")].filter(tab => visible(tab) && !tab.disabled);
      const index = tabs.indexOf(document.activeElement);
      if (index < 0 || !tabs.length) return;
      event.preventDefault();
      const next = event.key === "Home" ? tabs[0] : event.key === "End" ? tabs.at(-1) :
        tabs[(index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
      next.focus(); next.click();
    });
  };
  const sync = () => {
    groups.forEach(([selector, panels]) => document.querySelectorAll(selector).forEach(group => syncTabs(group, panels)));
    document.querySelectorAll('#service-filter-supplier, .task-edit-dialog select[name="Owner"]').forEach(enhanceLookup);
    document.querySelectorAll(".service-multi-filter-menu").forEach(enhanceFilter);
    const draftArrow = document.querySelector("#bulk-drafts-toggle span[aria-hidden]");
    if (draftArrow && draftArrow.textContent !== "▾") draftArrow.textContent = "▾";
    const refreshMail = document.getElementById("refresh-booking-mails");
    if (refreshMail && !refreshMail.querySelector("svg")) refreshMail.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 0 0-15.5-6.2L3 8.5M3 3v5.5h5.5M3 12a9 9 0 0 0 15.5 6.2L21 15.5M21 21v-5.5h-5.5"/></svg>';
    document.querySelectorAll("tr[data-service-id], tr[data-browser-booking-id], tr[data-booking-id]").forEach(row => {
      setAttribute(row, "tabindex", "0");
      setAttribute(row, "aria-current", row.classList.contains("active") || row.classList.contains("active-row") ? "true" : "false");
      if (row.dataset.keyboardRow) return;
      row.dataset.keyboardRow = "true";
      row.addEventListener("keydown", event => {
        if (event.target === row && ["Enter", " "].includes(event.key)) { event.preventDefault(); row.click(); }
      });
    });
    for (const id of ["bulk-status-toggle", "bulk-drafts-toggle", "bulk-request-prepayment"]) {
      const button = document.getElementById(id);
      if (button) setAttribute(button, "data-tooltip", button.disabled ? "Select services using the checkboxes to enable this action." : "Applies to the checked services, not just the open service.");
    }
    const filters = document.querySelector(".services-filter-row");
    if (filters) {
      let summary = document.getElementById("service-filter-summary");
      if (!summary) { summary = document.createElement("p"); summary.id = "service-filter-summary"; summary.className = "filter-summary"; summary.setAttribute("aria-live","polite"); filters.after(summary); }
      const parts = [...filters.querySelectorAll(".service-multi-filter")].flatMap(group => {
        const selected = [...group.querySelectorAll("[data-service-filter-option]:checked")].map(input => input.value);
        const all = group.querySelectorAll("[data-service-filter-option]").length;
        return selected.length && selected.length !== all ? [group.closest(".field").querySelector("span").textContent + ": " + (selected.length > 2 ? selected.length + " selected" : selected.join(", "))] : [];
      });
      const supplier = document.getElementById("service-filter-supplier");
      if (supplier?.value) parts.push("Supplier: " + supplier.selectedOptions[0]?.textContent);
      const operationalStatus = document.getElementById("service-operational-status");
      if (operationalStatus) {
        const statusText = document.getElementById("hide-non-operational-services")?.checked ? "Operational services only" : "All services visible";
        if (operationalStatus.textContent !== statusText) operationalStatus.textContent = statusText;
      }
      const text = parts.join(" · ");
      if (summary.textContent !== text) summary.textContent = text;
    }
    document.querySelectorAll('a[target="_blank"]').forEach(link => {
      if (!link.dataset.externalHint) {
        link.dataset.externalHint = "true";
        const name = link.getAttribute("aria-label") || link.textContent.trim() || "Open link";
        link.setAttribute("aria-label", name + " (opens in a new tab)");
        if (!link.title) link.title = "Opens in a new tab";
      }
    });
    document.querySelectorAll('button[title], a[title]').forEach(control => {
      // Documents owns its tooltips, including positioning inside the modal.
      if (control.closest(".document-studio, .documents-library")) return;
      if (!control.hasAttribute("data-tooltip")) control.setAttribute("data-tooltip", control.title);
    });
    document.querySelectorAll("input[readonly],textarea[readonly]").forEach(control => {
      if (!control.title) control.title = "Read only";
    });
    document.querySelectorAll(".prepayment-reference-name").forEach(reference => {
      if (reference.dataset.copyReady) return;
      reference.dataset.copyReady = "true";
      const button = document.createElement("button"); button.type = "button"; button.className = "button tertiary compact";
      button.textContent = "Copy reference"; button.setAttribute("aria-label", "Copy prepayment reference");
      button.onclick = async () => {
        try { await navigator.clipboard.writeText(reference.textContent.trim()); button.textContent = "Copied"; }
        catch (_) { button.textContent = "Select reference to copy"; }
      };
      reference.after(button);
    });
    // Native dialogs handle their own modal focus. Supply the same boundary for legacy overlays.
    document.querySelectorAll(".booking-action-dialog, .columns-panel").forEach(dialog => {
      if (!visible(dialog) || dialog.tagName === "DIALOG") return;
      if (!modalOpeners.has(dialog)) {
        modalOpeners.set(dialog, document.activeElement);
        if (!dialog.contains(document.activeElement) && !document.querySelector("dialog:modal")) focusable(dialog)[0]?.focus();
      }
      const accessibleDialog = dialog.querySelector('[role="dialog"]') || dialog;
      setAttribute(accessibleDialog, "role", "dialog"); setAttribute(accessibleDialog, "aria-modal", "true");
      const heading = dialog.querySelector("h2,h3,h4");
      if (heading && !accessibleDialog.hasAttribute("aria-labelledby")) {
        if (!heading.id) heading.id = "dialog-heading-" + Math.random().toString(36).slice(2,8);
        accessibleDialog.setAttribute("aria-labelledby", heading.id);
      }
    });
    for (const [dialog, opener] of modalOpeners) {
      if (!dialog.isConnected || !visible(dialog)) {
        modalOpeners.delete(dialog);
        if (opener?.isConnected && (!document.activeElement || document.activeElement === document.body || dialog.contains(document.activeElement))) opener.focus();
      }
    }
  };
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true; requestAnimationFrame(() => { scheduled = false; sync(); });
  };
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden", "disabled", "readonly"] });
  document.addEventListener("change", schedule);
  document.addEventListener("pointerdown", event => {
    document.querySelectorAll(".service-multi-filter-menu:not([hidden])").forEach(menu => {
      const control = filterControls.get(menu);
      if (control && !menu.contains(event.target) && !control.trigger.contains(event.target)) control.close(false);
    });
  });
  window.addEventListener("resize", schedule);
  document.addEventListener("scroll", () => document.querySelectorAll(".service-multi-filter-menu:not([hidden])").forEach(enhanceFilter), true);
  document.addEventListener("focusin", event => {
    if (document.querySelector("dialog:modal") || document.querySelector(":popover-open")) return;
    const dialog = [...modalOpeners.keys()].filter(visible).at(-1);
    if (dialog && !dialog.contains(event.target)) focusable(dialog)[0]?.focus();
  });
  document.addEventListener("keydown", event => {
    if (event.defaultPrevented || document.querySelector("dialog:modal") || document.querySelector(":popover-open")) return;
    const dialog = [...document.querySelectorAll(".booking-action-dialog, .columns-panel")].filter(visible).at(-1);
    if (!dialog) return;
    const controls = focusable(dialog);
    if (event.key === "Tab") {
      if (!controls.length) { event.preventDefault(); return; }
      const first = controls[0], last = controls.at(-1);
      if (!dialog.contains(document.activeElement) || (!event.shiftKey && document.activeElement === last)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    }
    if (event.key === "Escape") {
      const close = dialog.querySelector("[data-close], [id$='-dialog-close'], [data-dialog-dismiss]");
      if (close && !close.disabled) { event.preventDefault(); close.click(); }
    }
  });
  sync();
}
