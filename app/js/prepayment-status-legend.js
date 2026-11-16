// Keep the legend outside scrolling tables; native popovers also escape stacking contexts.
export function initializePrepaymentStatusLegend(container, paidStatuses) {
  if (!container || container.dataset.statusLegendBound) return;
  container.dataset.statusLegendBound = "true";
  let active = null;
  let serial = 0;

  function close(restoreFocus = false) {
    if (!active) return;
    const { button, panel, cleanup } = active;
    active = null;
    cleanup();
    button.setAttribute("aria-expanded", "false");
    button.removeAttribute("aria-controls");
    panel.remove();
    if (restoreFocus && button.isConnected) button.focus({ preventScroll: true });
  }

  container.addEventListener("click", event => {
    const button = event.target.closest("[data-prepayment-status-help]");
    if (!button || !container.contains(button)) return;
    if (active?.button === button) { close(true); return; }
    close();
    const panel = document.createElement("div");
    panel.className = "prepayment-status-popover";
    panel.id = "prepayment-status-legend-" + (++serial);
    panel.setAttribute("popover", "manual");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-labelledby", panel.id + "-title");
    panel.tabIndex = -1;
    const title = document.createElement("h3");
    title.id = panel.id + "-title";
    title.textContent = "Payment status";
    panel.appendChild(title);
    for (const [label, statuses] of [["Paid", paidStatuses], ["To pay", ["Pending invoice", "Pending payment record", "All other statuses"]]]) {
      const section = document.createElement("section");
      const heading = document.createElement("h4");
      heading.textContent = label;
      section.appendChild(heading);
      const list = document.createElement("ul");
      for (const status of statuses) {
        const item = document.createElement("li");
        item.textContent = status;
        list.appendChild(item);
      }
      section.appendChild(list);
      if (label === "Paid") {
        const explanation = document.createElement("p");
        explanation.className = "prepayment-status-explanation";
        explanation.textContent = "This group includes credit and already-paid discard statuses. It does not necessarily mean a new payment or transfer was recorded.";
        section.appendChild(explanation);
      }
      panel.appendChild(section);
    }
    document.body.appendChild(panel);
    if (panel.showPopover) panel.showPopover();
    const anchor = button.getBoundingClientRect();
    const bounds = panel.getBoundingClientRect();
    const gutter = 8, offset = 8;
    const below = window.innerHeight - anchor.bottom - offset - gutter;
    const above = anchor.top - offset - gutter;
    const top = below >= bounds.height || below >= above ? anchor.bottom + offset : anchor.top - bounds.height - offset;
    panel.style.left = Math.max(gutter, Math.min(anchor.left, window.innerWidth - bounds.width - gutter)) + "px";
    panel.style.top = Math.max(gutter, Math.min(top, window.innerHeight - bounds.height - gutter)) + "px";
    button.setAttribute("aria-expanded", "true");
    button.setAttribute("aria-controls", panel.id);

    const outside = e => { if (!panel.contains(e.target) && !button.contains(e.target)) close(); };
    const keydown = e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); } };
    // Scrolling inside the legend is safe; other scrolling can move or hide the anchor.
    const scroll = e => { if (!panel.contains(e.target)) close(panel.contains(document.activeElement)); };
    const resize = () => close(panel.contains(document.activeElement));
    const focus = e => { if (!panel.contains(e.target) && !button.contains(e.target)) close(); };
    const observer = new MutationObserver(() => { if (!button.isConnected) close(); });
    observer.observe(container, { childList: true, subtree: true });
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("scroll", scroll, true);
    document.addEventListener("focusin", focus);
    window.addEventListener("resize", resize);
    active = { button, panel, cleanup() {
      observer.disconnect();
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("scroll", scroll, true);
      document.removeEventListener("focusin", focus);
      window.removeEventListener("resize", resize);
    } };
    if (event.detail === 0) panel.focus({ preventScroll: true });
  });
}
