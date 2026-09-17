let activeOverlay = null;

export function updateBookingQueueOverlay(panel, expanded) {
  if (!panel) return;
  if (!expanded) {
    if (!activeOverlay) return;
    const { dialog, placeholder, previousOverflow, returnFocus } = activeOverlay;
    activeOverlay = null;
    placeholder.replaceWith(panel);
    dialog.close();
    dialog.remove();
    document.body.style.overflow = previousOverflow;
    if (returnFocus && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
    return;
  }
  if (activeOverlay) return;

  const placeholder = document.createElement("div");
  placeholder.className = "booking-queue-placeholder";
  placeholder.setAttribute("aria-hidden", "true");
  placeholder.style.height = panel.getBoundingClientRect().height + "px";
  panel.before(placeholder);
  const dialog = document.createElement("dialog");
  dialog.className = "booking-queue-overlay";
  dialog.setAttribute("aria-label", "Booking Queue");
  activeOverlay = { dialog, placeholder, previousOverflow: document.body.style.overflow, returnFocus: document.activeElement };
  dialog.appendChild(panel);
  document.body.appendChild(dialog);
  document.body.style.overflow = "hidden";

  function requestClose() {
    panel.dispatchEvent(new CustomEvent("booking-queue-close"));
  }
  dialog.addEventListener("cancel", function (event) {
    event.preventDefault();
    requestClose();
  });
  dialog.addEventListener("keydown", function (event) {
    if (event.key === "Escape") event.stopPropagation();
  });
  dialog.addEventListener("click", function (event) {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) requestClose();
  });
  dialog.showModal();
  const closeButton = panel.querySelector("#booking-browser-size-toggle");
  if (closeButton) closeButton.focus({ preventScroll: true });
}
