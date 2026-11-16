import { crmGetRecord, crmSearchRecord, crmUpdateRecord, crmExecuteFunction } from "./api.js";
import { getLookupName } from "./utils.js";
import { initializeEzusDateRange } from "./ezus-date-range.js";

export const EZUS_BOOKING_FIELDS = ["Deal_Name", "Account_Name", "Contact_Name", "Arrival_Date", "Departure_Date", "Travellers_Number", "referencePrefix"];

export function validateEzusBookingDetails(values) {
  const invalid = (field, message) => Object.assign(new Error(message), { field });
  const data = {
    referencePrefix: String(values.referencePrefix || "MFSP").trim().toUpperCase(),
    Deal_Name: String(values.Deal_Name || "").trim(),
    Account_Name: { id: String(values.Account_Name?.id || "").trim() },
    Contact_Name: { id: String(values.Contact_Name?.id || "").trim() },
    Arrival_Date: values.Arrival_Date || null,
    Departure_Date: values.Departure_Date || null,
    Travellers_Number: values.Travellers_Number === "" || values.Travellers_Number == null ? null : Number(values.Travellers_Number)
  };
  if (!["MFSP", "MFOF", "MFAD"].includes(data.referencePrefix)) throw invalid("referencePrefix", "Select a valid reference prefix: MFSP, MFOF or MFAD.");
  if (!data.Deal_Name) throw invalid("Deal_Name", "Enter the booking name.");
  if (data.Deal_Name.length > 120) throw invalid("Deal_Name", "Booking name must be 120 characters or fewer.");
  if (!data.Account_Name.id) throw invalid("Account_Name", "Select a client from the search results.");
  if (!data.Contact_Name.id) throw invalid("Contact_Name", "Select a contact from the search results.");
  for (const key of ["Arrival_Date", "Departure_Date"]) {
    const value = data[key];
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
      throw invalid(key, "Enter a valid " + (key === "Arrival_Date" ? "arrival" : "departure") + " date.");
    }
  }
  if (data.Arrival_Date && data.Departure_Date && data.Departure_Date < data.Arrival_Date) throw invalid("Departure_Date", "Departure date cannot be before arrival date.");
  const tripDays = (Date.parse(data.Departure_Date) - Date.parse(data.Arrival_Date)) / 86400000 + 1;
  if (tripDays > 40) throw invalid("Departure_Date", "Ezus creation supports up to 40 days, including arrival and departure. For a longer trip, arrange creation directly in Ezus.");
  if (data.Travellers_Number !== null && (!Number.isInteger(data.Travellers_Number) || data.Travellers_Number < 0 || data.Travellers_Number > 999999999)) {
    throw invalid("Travellers_Number", "Travelers number must be a whole number between 0 and 999999999.");
  }
  return data;
}

export async function saveEzusBookingDetails(bookingId, values, assertCurrent) {
  const data = validateEzusBookingDetails(values);
  assertCurrent();
  const [client, contact] = await Promise.all([
    crmGetRecord("Accounts", data.Account_Name.id),
    crmGetRecord("Contacts", data.Contact_Name.id)
  ]);
  assertCurrent();
  if (!client || String(client.id) !== data.Account_Name.id) throw new Error("The selected client is unavailable. Select a client again.");
  if (!contact || String(contact.id) !== data.Contact_Name.id) throw new Error("The selected contact is unavailable. Select a contact again.");
  if (String(contact.Account_Name?.id || "") !== data.Account_Name.id) throw new Error("The contact must belong to the selected client. Select a matching contact or change the client.");
  const { referencePrefix, ...bookingFields } = data;
  const result = await crmUpdateRecord("Deals", { id: bookingId, ...bookingFields });
  if (String(result?.code || "").toUpperCase() !== "SUCCESS" || result?.status === "error") {
    throw new Error(result?.message || "CRM did not confirm the booking update. The transition has not been executed.");
  }
  assertCurrent();
  return data;
}

export function openCreateEzusDialog({ bookingId, isCurrent, onContinue, extraFields = "", collectExtra = () => ({}) }) {
  if (document.querySelector(".blueprint-transition-dialog")) return;
  const previousFocus = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.className = "create-ezus-dialog blueprint-transition-dialog";
  dialog.setAttribute("aria-labelledby", "create-ezus-title");
  dialog.innerHTML = '<div class="booking-action-dialog-panel"><header class="ezus-dialog-header"><div><h4 id="create-ezus-title">Create Ezus project</h4><p data-intro>Review the booking details before continuing.</p></div><button type="button" class="booking-action-dialog-dismiss" data-dialog-dismiss aria-label="Close dialog">&times;</button></header><form class="booking-form" novalidate><div class="ezus-dialog-body"><p data-loading role="status">Loading booking details…</p><fieldset disabled><div class="ezus-booking-row">' +
    '<label class="field booking-form-field"><span>Reference prefix *</span><select name="referencePrefix" required><option value="MFSP">MFSP</option><option value="MFOF">MFOF</option><option value="MFAD">MFAD</option></select></label>' +
    '<label class="field booking-form-field"><span>Booking name *</span><input name="Deal_Name" required maxlength="120"></label>' +
    '</div><div class="ezus-people-row">' +
    ['Client', 'Contact'].map((label, index) => {
      const key = index ? 'Contact_Name' : 'Account_Name';
      const id = 'ezus-' + label.toLowerCase();
      return '<div class="field booking-form-field ezus-lookup"><label for="' + id + '">' + label + ' *</label><div class="ezus-lookup-value"><input id="' + id + '" name="' + key + '" readonly placeholder="No ' + label.toLowerCase() + ' selected"><button type="button" class="ezus-lookup-toggle" data-lookup-toggle="' + key + '" aria-label="Search ' + label.toLowerCase() + '" title="Search ' + label.toLowerCase() + '" aria-expanded="false" aria-controls="' + id + '-panel"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg></button></div><div id="' + id + '-panel" data-lookup-panel="' + key + '" class="ezus-lookup-panel" hidden><label class="ezus-lookup-search-label" for="' + id + '-search">Search ' + label.toLowerCase() + ' by name</label><div class="ezus-lookup-search"><input id="' + id + '-search" data-lookup-query="' + key + '" type="search" autocomplete="off" placeholder="At least 2 characters" aria-describedby="' + id + '-help"><button type="button" class="button tertiary compact" data-lookup-search="' + key + '" disabled>Search</button></div><small id="' + id + '-help">Select a CRM record from the results.</small><div data-results="' + key + '" class="ezus-lookup-results" aria-live="polite" hidden></div></div></div>';
    }).join('') +
    '</div><section class="ezus-trip-section" aria-labelledby="ezus-trip-title"><div class="ezus-trip-heading"><h5 id="ezus-trip-title">Trip details</h5><span>Dates required · Up to 40 days</span></div><div class="ezus-trip-row"><label class="field booking-form-field"><span>Arrival date *</span><input name="Arrival_Date" type="date" required></label><label class="field booking-form-field"><span>Departure date *</span><input name="Departure_Date" type="date" required></label><label class="field booking-form-field"><span>Travelers number</span><input name="Travellers_Number" type="number" min="0" max="999999999" step="1"></label></div></section>' + (extraFields ? '<div class="booking-form-grid ezus-extra-fields">' + extraFields + '</div>' : '') +
    '<p class="ezus-required-note">* Required fields</p></fieldset><div class="ezus-creation-result" data-result role="status" aria-live="polite" hidden><span class="ezus-creation-spinner" data-spinner aria-hidden="true" hidden></span><strong data-result-title></strong><p data-result-message></p></div><div class="blueprint-transition-error" role="alert" aria-atomic="true"><span class="blueprint-transition-error-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 3v1"/></svg></span><div class="blueprint-transition-error-content"><strong data-error-title>Could not create the project</strong><p data-error hidden></p><div class="ezus-contact-recovery" data-contact-recovery hidden><button type="button" class="button tertiary compact" data-sync-contact>Sync contact with Ezus</button><span class="ezus-creation-spinner" data-sync-spinner aria-hidden="true" hidden></span><p data-sync-status role="status" aria-live="polite" hidden></p></div></div></div></div><footer class="booking-action-dialog-footer"><button type="button" class="button tertiary compact" data-close>Cancel</button><button type="submit" class="button booking-action-button compact" disabled>Create project</button><a class="button booking-action-button compact" data-open-ezus target="_blank" rel="noopener noreferrer" hidden>Open in Ezus ↗</a></footer></form></div>';
  document.body.appendChild(dialog);
  const form = dialog.querySelector("form"), fieldset = dialog.querySelector("fieldset"), submit = dialog.querySelector('[type="submit"]'), close = dialog.querySelector("[data-close]"), error = dialog.querySelector("[data-error]");
  const refreshDateRange = initializeEzusDateRange(form);
  const selected = { Account_Name: null, Contact_Name: null };
  let busy = false;
  const syncButton = dialog.querySelector("[data-sync-contact]");
  const syncStatus = dialog.querySelector("[data-sync-status]");
  const syncSpinner = dialog.querySelector("[data-sync-spinner]");
  const recovery = dialog.querySelector("[data-contact-recovery]");
  syncButton.onclick = async () => {
    if (busy || syncButton.disabled) return;
    busy = true;
    syncButton.disabled = close.disabled = true;
    dialog.querySelector("[data-dialog-dismiss]").disabled = true;
    syncSpinner.hidden = false;
    syncStatus.hidden = true;
    syncStatus.removeAttribute("data-state");
    error.hidden = true;
    dialog.querySelector("[data-error-title]").textContent = "Synchronizing contact";
    syncStatus.textContent = "";
    dialog.setAttribute("aria-busy", "true");
    try {
      assertCurrent();
      await syncEzusBookingContact(bookingId, selected.Contact_Name.id, assertCurrent);
      assertCurrent();
      error.hidden = true;
      dialog.querySelector("[data-error-title]").textContent = "Contact synchronized";
      syncStatus.textContent = "Contact synchronized successfully. You can now create the project.";
      syncStatus.setAttribute("data-state", "success");
      syncStatus.hidden = false;
      syncButton.hidden = true;
      submit.hidden = submit.disabled = false;
      submit.textContent = "Create project";
      submit.focus();
    } catch (cause) {
      error.hidden = true;
      dialog.querySelector("[data-error-title]").textContent = "Could not synchronize the contact";
      syncStatus.textContent = cause.message || "Could not confirm contact synchronization. Check the contact before retrying.";
      syncStatus.setAttribute("data-state", "error");
      syncStatus.hidden = false;
      syncButton.focus();
    } finally {
      busy = false;
      syncSpinner.hidden = true;
      close.disabled = false;
      dialog.querySelector("[data-dialog-dismiss]").disabled = false;
      dialog.setAttribute("aria-busy", "false");
    }
  };
  const searches = { Account_Name: 0, Contact_Name: 0 };
  const fail = message => { error.textContent = message; error.hidden = false; };
  const fieldErrors = {};
  for (const key of EZUS_BOOKING_FIELDS) {
    const control = form.elements[key];
    const message = document.createElement("small");
    message.id = "ezus-error-" + key;
    message.className = "ezus-field-error";
    message.hidden = true;
    control.closest(".field").appendChild(message);
    control.setAttribute("aria-describedby", message.id);
    fieldErrors[key] = message;
    control.addEventListener("input", () => clearFieldError(key));
    control.addEventListener("invalid", event => {
      event.preventDefault();
      showFieldError(key, control.validationMessage);
    });
  }
  function clearFieldError(key) {
    fieldErrors[key].hidden = true;
    form.elements[key].removeAttribute("aria-invalid");
  }
  function showFieldError(key, message) {
    fieldErrors[key].textContent = message;
    fieldErrors[key].hidden = false;
    form.elements[key].setAttribute("aria-invalid", "true");
  }
  function showResult(kind, message, booking) {
    const pending = kind === "pending";
    const success = kind === "success";
    const projectId = String(booking?.Ezus_Project_API || booking?.Ezus_Project_Api || booking?.Ezus_Project_ID || "").trim();
    const hasProject = projectId && !["-", "null", "undefined"].includes(projectId.toLowerCase());
    fieldset.hidden = true;
    dialog.querySelector("[data-intro]").hidden = true;
    dialog.querySelector("[data-loading]").hidden = true;
    dialog.querySelector("[data-result]").hidden = kind === "error";
    dialog.querySelector("[data-result]").setAttribute("data-state", kind);
    dialog.querySelector("[data-spinner]").hidden = !pending;
    dialog.querySelector("[data-result-title]").textContent = pending ? "Creating Ezus project…" : success ? (hasProject ? "Successfully created" : "Transition completed") : "Could not create the project";
    dialog.querySelector("[data-result-message]").textContent = pending ? "Please wait while the project is created." : success ? (hasProject ? "Your project is ready to open in Ezus." : "The project link is not available yet. Refresh the booking to check Quick Access.") : "";
    dialog.setAttribute("aria-busy", pending ? "true" : "false");
    submit.hidden = true;
    close.disabled = pending;
    close.textContent = "Close";
    dialog.querySelector("[data-dialog-dismiss]").disabled = pending;
    const open = dialog.querySelector("[data-open-ezus]");
    open.hidden = !success;
    open.setAttribute("aria-disabled", hasProject ? "false" : "true");
    if (success && hasProject) open.setAttribute("href", "https://pro.ezus.io/project?id=" + encodeURIComponent(projectId));
    else open.removeAttribute("href");
    if (kind === "error") {
      dialog.querySelector("[data-error-title]").textContent = "Could not create the project";
      fail(message);
    }
    if (!pending) close.focus();
  }
  const assertCurrent = () => { if (!isCurrent()) throw new Error("The selected booking changed. Close this dialog and reopen the transition."); };
  function cleanup() {
    dialog.remove();
    previousFocus?.focus();
  }
  close.onclick = () => { if (!busy) dialog.close(); };
  dialog.querySelector("[data-dialog-dismiss]").onclick = close.onclick;
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  dialog.addEventListener("close", cleanup);
  function resetContact() {
    searches.Contact_Name++;
    selected.Contact_Name = null;
    form.elements.Contact_Name.value = "";
    form.elements.Contact_Name.title = "";
    dialog.querySelector('[data-lookup-query="Contact_Name"]').value = "";
    dialog.querySelector('[data-lookup-search="Contact_Name"]').disabled = true;
    dialog.querySelector('[data-results="Contact_Name"]').hidden = true;
  }
  function bindLookup(key) {
    const input = form.elements[key], results = dialog.querySelector('[data-results="' + key + '"]');
    const queryInput = dialog.querySelector('[data-lookup-query="' + key + '"]');
    const searchButton = dialog.querySelector('[data-lookup-search="' + key + '"]');
    const toggle = dialog.querySelector('[data-lookup-toggle="' + key + '"]');
    const panel = dialog.querySelector('[data-lookup-panel="' + key + '"]');
    function setSearchOpen(open) {
      panel.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      if (open) queryInput.focus();
      else {
        searches[key]++;
        results.hidden = true;
        searchButton.disabled = queryInput.value.trim().length < 2;
        searchButton.textContent = "Search";
        toggle.focus();
      }
    }
    toggle.onclick = () => { if (!busy && !fieldset.disabled) setSearchOpen(panel.hidden); };
    queryInput.addEventListener("input", () => {
      searches[key]++;
      results.hidden = true;
      searchButton.disabled = queryInput.value.trim().length < 2;
      searchButton.textContent = "Search";
    });
    async function search() {
      if (busy || fieldset.disabled) return;
      const query = queryInput.value.trim();
      const request = ++searches[key];
      results.hidden = false;
      if (query.length < 2) { results.textContent = "Type at least 2 characters."; return; }
      if (key === "Contact_Name" && !selected.Account_Name?.id) { results.textContent = "Select a client first."; return; }
      results.textContent = "Searching?";
      searchButton.disabled = true;
      searchButton.textContent = "Searching?";
      try {
        assertCurrent();
        const escaped = query.replace(/[\\(),:]/g, character => "\\" + character);
        const criteria = key === "Account_Name" ? '(Account_Name:starts_with:' + escaped + ')' : '((Account_Name:equals:' + selected.Account_Name.id + ')and(Full_Name:starts_with:' + escaped + '))';
        const records = await crmSearchRecord(key === "Account_Name" ? "Accounts" : "Contacts", criteria, 1, 50);
        if (!dialog.isConnected || searches[key] !== request) return;
        results.innerHTML = "";
        records.forEach(record => {
          if (!record.id) return;
          const button = document.createElement("button");
          button.type = "button";
          const name = key === "Account_Name" ? record.Account_Name : record.Full_Name || [record.First_Name, record.Last_Name].filter(Boolean).join(" ");
          button.textContent = name + (key === "Contact_Name" && record.Email ? " ? " + record.Email : "");
          button.onclick = () => {
            if (busy || searches[key] !== request) return;
            if (key === "Account_Name" && selected[key]?.id !== String(record.id)) resetContact();
            selected[key] = { id: String(record.id), name };
            input.value = name;
            input.title = name;
            clearFieldError(key);
            queryInput.value = "";
            searchButton.disabled = true;
            searches[key]++;
            results.hidden = true;
            setSearchOpen(false);
          };
          results.appendChild(button);
        });
        if (!results.children.length) results.textContent = "No matches found.";
      } catch (cause) {
        if (dialog.isConnected && searches[key] === request) results.textContent = cause.message || "Search failed. Try again.";
      } finally {
        if (dialog.isConnected && searches[key] === request) {
          searchButton.disabled = queryInput.value.trim().length < 2;
          searchButton.textContent = "Search";
        }
      }
    }
    searchButton.onclick = search;
    queryInput.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); if (!searchButton.disabled) search(); }
    });
  }
  bindLookup("Account_Name");
  bindLookup("Contact_Name");
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy || submit.disabled) return;
    for (const key of EZUS_BOOKING_FIELDS) clearFieldError(key);
    error.hidden = true;
    recovery.hidden = true;
    if (!form.reportValidity()) {
      form.querySelector(":invalid")?.focus();
      return;
    }
    try {
      assertCurrent();
      const values = validateEzusBookingDetails({
        Deal_Name: form.elements.Deal_Name.value, ...selected,
        referencePrefix: form.elements.referencePrefix.value,
        Arrival_Date: form.elements.Arrival_Date.value, Departure_Date: form.elements.Departure_Date.value,
        Travellers_Number: form.elements.Travellers_Number.value
      });
      const extra = collectExtra(form);
      busy = true;
      fieldset.disabled = submit.disabled = close.disabled = true;
      showResult("pending");
      const result = await onContinue(values, extra);
      if (!result || result.partial) throw new Error(result?.partial ? "The transition was saved partially. Complete its remaining requirements before the project can be created." : "Could not confirm project creation. Refresh the booking to check its status.");
      const finalReference = String(result.booking?.MFSP_Reference || "");
      if (!finalReference.startsWith(values.referencePrefix) || finalReference.length <= 4) throw new Error("The requested reference has not been confirmed in CRM yet. Refresh the booking to check the creation result before trying again.");
      showResult("success", "", result.booking);
    } catch (cause) {
      const message = cause.message || "Could not continue. Check the booking details and try again.";
      if (busy) {
        showResult("error", message);
        if (cause.stage === "validate_ezus_contact" || /not marked as synchronized with Ezus/i.test(message)) {
          recovery.hidden = false;
          syncButton.hidden = syncButton.disabled = false;
          syncStatus.hidden = true;
          syncButton.focus();
        }
      }
      else if (cause.field && fieldErrors[cause.field]) {
        showFieldError(cause.field, message);
        form.elements[cause.field].focus();
      } else fail(message);
    }
    finally {
      busy = false;
      if (!fieldset.hidden) fieldset.disabled = submit.disabled = false;
      close.disabled = false;
    }
  });
  dialog.showModal();
  crmGetRecord("Deals", bookingId).then(booking => {
    if (!dialog.isConnected) return;
    assertCurrent();
    if (!booking || String(booking.id) !== bookingId) throw new Error("Could not load this booking. Close the dialog and try again.");
    for (const key of ["Account_Name", "Contact_Name"]) {
      selected[key] = booking[key]?.id ? { id: String(booking[key].id), name: getLookupName(booking[key]) } : null;
      form.elements[key].value = selected[key]?.name || "";
      form.elements[key].title = selected[key]?.name || "";
    }
    for (const key of ["Deal_Name", "Arrival_Date", "Departure_Date", "Travellers_Number"]) form.elements[key].value = booking[key] ?? "";
    refreshDateRange();
    form.elements.referencePrefix.value = ["MFSP", "MFOF", "MFAD"].find(prefix => String(booking.MFSP_Reference || "").startsWith(prefix)) || "MFSP";
    fieldset.disabled = submit.disabled = false;
    form.elements.Deal_Name.focus();
  }).catch(cause => { if (dialog.isConnected) showResult("error", cause.message || "Could not load booking details."); })
    .finally(() => { dialog.querySelector("[data-loading]").hidden = true; });
}

export async function syncEzusBookingContact(bookingId, contactId, assertCurrent) {
  assertCurrent();
  let result = await crmExecuteFunction("widget_recordlease", {
    action: "widget_operation",
    requestBody: JSON.stringify({ operation: "ezus_syncbookingcontact", bookingId, contactId })
  });
  for (let depth = 0; depth < 8; depth++) {
    if (typeof result === "string") {
      try { result = JSON.parse(result); } catch (_) { throw new Error("Could not read the synchronization result. Check the contact before retrying."); }
    }
    if (!result || typeof result !== "object") break;
    if (result.error === true || result.success === false || result.status === "error" || (result.code && result.code !== "success" && result.code !== "SUCCESS")) throw new Error(result.message || "Contact synchronization failed.");
    if (result.error === false) break;
    result = result.details?.output ?? result.details?.response ?? result.data ?? result;
  }
  if (result?.error !== false) throw new Error("Could not confirm contact synchronization. Check the contact before retrying.");
  assertCurrent();
  const contact = await crmGetRecord("Contacts", contactId);
  assertCurrent();
  if (String(contact?.id) !== String(contactId) || contact.In_Ezus !== true) throw new Error("Ezus returned success, but CRM has not confirmed the contact as synchronized. Check the contact before retrying.");
  return contact;
}
