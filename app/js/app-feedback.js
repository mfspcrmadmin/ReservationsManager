export function clearFeedback(kind) {
  const dialog = document.getElementById("app-feedback-dialog");
  if (dialog && dialog.open && (!kind || dialog.dataset.kind === kind)) dialog.close();
}

export function formatFeedbackMessage(message, kind) {
  // Function output may arrive as an object or as JSON nested inside a string.
  for (let depth = 0; depth < 5; depth++) {
    if (message && typeof message === "object") {
      message = message.message || message.details && message.details.output;
      continue;
    }
    if (typeof message !== "string" || !message.trim()) break;
    const text = message.trim();
    if (/^[\[{\"]/.test(text)) {
      try { message = JSON.parse(text); continue; }
      catch (_) { break; }
    }
    return text;
  }
  return kind === "error"
    ? "The action couldn't be completed. Please try again or contact your administrator."
    : "No additional information is available.";
}

export function showFeedback(message, kind = "info") {
  const previousFocus = document.activeElement;
  let dialog = document.getElementById("app-feedback-dialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "app-feedback-dialog";
    dialog.className = "app-feedback-dialog";
    dialog.tabIndex = -1;
    dialog.setAttribute("aria-labelledby", "app-feedback-title");
    dialog.setAttribute("aria-describedby", "app-feedback-message");
    dialog.innerHTML = '<div class="mail-send-spinner" data-feedback-spinner hidden></div>' +
      '<h3 id="app-feedback-title"></h3><p id="app-feedback-message" aria-live="polite"></p>' +
      '<button type="button" class="button tertiary compact" data-feedback-close>Close</button>';
    dialog.querySelector("[data-feedback-close]").onclick = () => dialog.close();
    dialog.addEventListener("cancel", event => { if (dialog.dataset.kind === "loading") event.preventDefault(); });
    document.body.appendChild(dialog);
  }
  const loading = kind === "loading";
  const wasLoading = dialog.dataset.kind === "loading";
  if (dialog.open && wasLoading !== loading) dialog.close();
  // Keep notices visible and dismissible when an editor is in the top layer.
  const modal = [...(document.querySelectorAll?.("dialog:modal") || [])].filter(node => node !== dialog).at(-1) ||
    [...(document.querySelectorAll?.(".booking-action-dialog, .columns-panel") || [])]
      .filter(node => !node.closest("[hidden]") && node.getClientRects().length).at(-1);
  const host = !loading && modal ? modal : document.body;
  if (dialog.parentElement && dialog.parentElement !== host) {
    if (dialog.open) dialog.close();
    host.appendChild(dialog);
  }
  dialog.className = loading ? "app-feedback-dialog" : "app-feedback-dialog interface-feedback";
  dialog.dataset.kind = kind;
  dialog.setAttribute("role", loading ? "dialog" : kind === "error" ? "alert" : "status");
  dialog.querySelector("h3").textContent = loading ? "Please wait" : kind === "error" ? "Error occurred" : "Information";
  dialog.querySelector("p").textContent = formatFeedbackMessage(message, kind);
  dialog.querySelector("[data-feedback-spinner]").hidden = !loading;
  const close = dialog.querySelector("[data-feedback-close]");
  close.hidden = loading;
  close.textContent = loading ? "Close" : "×";
  close.setAttribute("aria-label", "Dismiss notification");
  if (!dialog.open) {
    if (loading) dialog.showModal();
    else dialog.show();
  }
  if (loading) dialog.focus();
  else if (previousFocus?.isConnected && !dialog.contains(previousFocus)) previousFocus.focus({ preventScroll: true });
}
