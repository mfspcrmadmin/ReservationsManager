import { crmExecuteFunction, crmGetRecord } from "./api.js";
import { recordEditLocks } from "./record-edit-locks.js";

export async function createBookingFolder(bookingId, assertCurrent) {
  return recordEditLocks.write("Deals", bookingId, async () => {
    assertCurrent();
    let result = await crmExecuteFunction("widget_recordlease", {
      action: "widget_operation",
      requestBody: JSON.stringify({ operation: "booking_createworkdrivefolder", bookingId })
    });
    for (let depth = 0; depth < 8; depth++) {
      if (typeof result === "string") {
        try { result = JSON.parse(result); }
        catch (_) { throw new Error("Could not read the result. Check WorkDrive and the booking before trying again."); }
      }
      if (!result || typeof result !== "object") break;
      if (result.error === true || result.success === false || result.status === "error" || (result.code && !["SUCCESS", "success"].includes(result.code))) throw new Error(result.message || "Could not create the WorkDrive folder.");
      if (result.error === false) break;
      result = result.details?.output ?? result.details?.response ?? result.data ?? result;
    }
    if (result?.error !== false || !result.booking_folder_id) throw new Error("Folder creation was not confirmed. Check WorkDrive and the booking before trying again.");
    assertCurrent();
    const booking = await crmGetRecord("Deals", bookingId);
    assertCurrent();
    if (String(booking?.id) !== bookingId || booking.Booking_Workdrive_Folder_ID !== result.booking_folder_id) throw new Error("The folder exists, but its ID could not be confirmed on the booking. Check CRM before continuing.");
    return booking;
  });
}

export function openWorkdriveFolderDialog({ bookingId, isCurrent }) {
  if (document.querySelector(".workdrive-folder-dialog")) return;
  const previousFocus = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.className = "create-ezus-dialog blueprint-transition-dialog workdrive-folder-dialog";
  dialog.setAttribute("aria-labelledby", "workdrive-folder-title");
  dialog.innerHTML = '<div class="booking-action-dialog-panel"><header class="ezus-dialog-header"><h4 id="workdrive-folder-title">Booking WorkDrive folder</h4><button type="button" class="booking-action-dialog-dismiss" data-dismiss aria-label="Close dialog">&times;</button></header><div class="ezus-dialog-body"><section class="workdrive-folder-notice" data-notice data-state="error"><strong data-title>WorkDrive folder required</strong><span class="ezus-creation-spinner" data-spinner aria-hidden="true" hidden></span><p data-message role="status" aria-live="polite">This booking needs a WorkDrive folder before it can be passed to Reservations. Create it here to save its ID on the booking.</p></section></div><footer class="booking-action-dialog-footer"><button type="button" class="button tertiary compact" data-close>Close</button><button type="button" class="button booking-action-button compact" data-create>Create WorkDrive folder</button></footer></div>';
  document.body.appendChild(dialog);
  const create = dialog.querySelector("[data-create]");
  const close = dialog.querySelector("[data-close]");
  const dismiss = dialog.querySelector("[data-dismiss]");
  const spinner = dialog.querySelector("[data-spinner]");
  const message = dialog.querySelector("[data-message]");
  const title = dialog.querySelector("[data-title]");
  let busy = false;
  close.onclick = dismiss.onclick = () => { if (!busy) dialog.close(); };
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  dialog.addEventListener("close", () => { dialog.remove(); previousFocus?.focus(); });
  create.onclick = async () => {
    if (busy || create.disabled) return;
    const assertCurrent = () => { if (!isCurrent()) throw new Error("The selected booking changed. Close this dialog and reopen the action."); };
    busy = true;
    create.disabled = close.disabled = dismiss.disabled = true;
    spinner.hidden = false;
    message.hidden = true;
    title.textContent = "Creating WorkDrive folder…";
    dialog.setAttribute("aria-busy", "true");
    dialog.querySelector("[data-notice]").setAttribute("data-state", "pending");
    try {
      await createBookingFolder(bookingId, assertCurrent);
      title.textContent = "WorkDrive folder ready";
      message.textContent = "The WorkDrive folder is saved on the booking. Close this window and select the Reservations action again to continue.";
      dialog.querySelector("[data-notice]").setAttribute("data-state", "success");
      create.hidden = true;
    } catch (error) {
      title.textContent = "Could not create the WorkDrive folder";
      message.textContent = error.message || "Check WorkDrive and the booking before trying again.";
      dialog.querySelector("[data-notice]").setAttribute("data-state", "error");
    } finally {
      busy = false;
      message.hidden = false;
      spinner.hidden = true;
      close.disabled = dismiss.disabled = false;
      dialog.setAttribute("aria-busy", "false");
      close.focus();
    }
  };
  dialog.showModal();
  create.focus();
}
