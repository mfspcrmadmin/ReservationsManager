export function buildBookingUrl(bookingId) {
  if (typeof bookingId !== "string" || !/^\d+$/.test(bookingId)) throw new Error("Invalid booking ID.");
  return "https://crm.zoho.eu/crm/org20093299576/tab/WebTab3?widgetparams=" + encodeURIComponent(JSON.stringify({ bookingId, view: "booking" }));
}

export async function copyBookingUrl(button, bookingId) {
  if (button.disabled) return;
  button.disabled = true;
  try {
    const url = buildBookingUrl(bookingId);
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url); copied = true; }
    } catch (_) { /* Embedded CRM may restrict the Clipboard API. */ }
    if (!copied) {
      const input = document.createElement("textarea");
      input.value = url;
      input.style.cssText = "position:fixed;left:-9999px;top:0";
      document.body.append(input);
      try { input.select(); copied = document.execCommand("copy"); } finally { input.remove(); }
    }
    button.textContent = copied ? "Copied" : "Copy failed. Try again";
  } catch (_) { button.textContent = "Copy failed. Try again"; }
  finally {
    button.disabled = false;
    if (button.isConnected) button.focus({ preventScroll: true });
    setTimeout(() => { button.textContent = "Copy Booking URL"; }, 2500);
  }
}
