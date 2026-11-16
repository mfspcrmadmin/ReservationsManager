import { recordEditLocks } from "./record-edit-locks.js";
import { crmSearchRecord, crmCreateRecord, crmGetRecord, crmUpdateRecord, crmGetAllUsers } from "./api.js";
import { escapeHtml, formatDate } from "./utils.js";

export const TASK_STATUSES = ["Not Started", "Deferred", "In Progress", "Completed", "Waiting on someone else"];
export const TASK_PRIORITIES = ["High", "Highest", "Low", "Lowest", "Normal"];
const REFRESH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 0 0-15.5-6.2L3 8.5"/><path d="M3 3v5.5h5.5"/><path d="M3 12a9 9 0 0 0 15.5 6.2L21 15.5"/><path d="M21 21v-5.5h-5.5"/></svg>';
const PENCIL_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 3 5 5-12 12-6 1 1-6L16 3Zm-2 2 5 5"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
const EDIT_FIELDS = ["Subject", "Due_Date", "Priority", "Status", "Description"];
function taskTone(field, value) {
  const tones = field === "Priority"
    ? { Highest: "red", High: "orange", Normal: "blue", Low: "teal", Lowest: "grey" }
    : { "Not Started": "grey", Deferred: "purple", "In Progress": "blue", Completed: "green", "Waiting on someone else": "amber" };
  return "task-tone--" + (Object.prototype.hasOwnProperty.call(tones, value) ? tones[value] : "grey");
}

function taskValueBadge(field, value) {
  return '<span class="task-value-badge ' + taskTone(field, value) + '">' + escapeHtml(value || "-") + '</span>';
}

export function parseTaskReminder(value) {
  const alarm = typeof value === "string" ? value : value?.ALARM || "";
  if (!alarm) return { enabled: false, dateTime: "", action: "" };
  const action = /(?:^|;)ACTION=([^;]+)/.exec(alarm)?.[1] || "";
  const trigger = /(?:^|;)TRIGGER=(?:DATE-TIME:)?([^;]+)/.exec(alarm)?.[1] || "";
  const date = /^\d{4}-\d{2}-\d{2}T/.test(trigger) ? new Date(trigger) : null;
  const dateTime = date && Number.isFinite(date.getTime())
    ? [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-") + "T" + [date.getHours(), date.getMinutes()].map(part => String(part).padStart(2, "0")).join(":") : "";
  return { enabled: true, dateTime, action };
}

function taskReminderBadge(value) {
  const reminder = parseTaskReminder(value);
  if (!reminder.enabled) return '<span class="task-value-badge task-tone--grey">No reminder</span>';
  const method = reminder.action === "EMAIL" ? "Email" : reminder.action === "POPUP" ? "Pop-up" : "Reminder on";
  const when = reminder.dateTime ? formatDate(reminder.dateTime.slice(0, 10)) + " · " + reminder.dateTime.slice(11) : "Set in Zoho";
  return '<span class="task-value-badge task-tone--green">' + escapeHtml(method) + '</span><small class="task-reminder-date">' + escapeHtml(when) + '</small>';
}

function assertTaskBooking(task, bookingId, taskId) {
  if (!task || String(task.id) !== String(taskId) || String(task.What_Id?.id) !== String(bookingId) || (task.$se_module && task.$se_module !== "Deals")) {
    throw new Error("This task is no longer associated with this booking. Refresh the task list.");
  }
}

export function buildTaskChanges(bookingId, initial, fields) {
  const validated = buildTaskPayload(bookingId, { ...fields, Status: fields.Status || initial.Status, Reminder_Enabled: fields.Reminder_Edited ? fields.Reminder_Enabled : false });
  const changes = {};
  for (const field of EDIT_FIELDS) {
    const value = validated[field] ?? "";
    if (value !== (initial[field] ?? "")) changes[field] = value === "" && field === "Due_Date" ? null : value;
  }
  if (fields.Reminder_Edited) {
    const reminder = validated.Remind_At || null;
    if (JSON.stringify(reminder) !== JSON.stringify(initial.Remind_At || null)) changes.Remind_At = reminder;
  }
  return changes;
}

export async function updateBookingTask(bookingId, taskId, changes, initial, dependencies = {}) {
  const get = dependencies.get || crmGetRecord;
  const update = dependencies.update || crmUpdateRecord;
  const isCurrent = dependencies.isCurrent || (() => true);
  const fresh = await get("Tasks", taskId);
  if (!isCurrent()) throw new Error("The selected booking changed.");
  assertTaskBooking(fresh, bookingId, taskId);
  if (fresh.$editable === false || fresh.$locked_for_me) throw new Error("You cannot edit this task in CRM.");
  for (const field of Object.keys(changes)) {
    if (!EDIT_FIELDS.includes(field) && field !== "Remind_At") throw new Error("Unsupported task field.");
    if (initial && JSON.stringify(fresh[field] ?? "") !== JSON.stringify(initial[field] ?? "")) throw new Error("This task changed in another session. Reopen the editor to load its latest values.");
  }
  if (!Object.keys(changes).length || (!initial && fresh.Status === "Completed")) return;
  const result = await update("Tasks", { id: String(taskId), ...changes }, { expectedRecord: fresh });
  if (result?.code !== "SUCCESS" || result.status === "error") throw new Error(result?.message || "CRM did not confirm the task update.");
}

export function openTaskEditor(taskId, bookingId, onSaved, dependencies = {}) {
  const isNew = !taskId;
  const dialog = document.createElement("dialog");
  dialog.className = "communication-editor task-edit-dialog";
  dialog.setAttribute("aria-labelledby", "task-edit-title");
  const options = (field, values) => values.map(value => '<option class="' + taskTone(field, value) + '">' + escapeHtml(value) + '</option>').join("");
  dialog.innerHTML = '<form><div class="task-edit-heading"><div class="task-edit-title-context"><h2 id="task-edit-title">' + (isNew ? 'New task' : 'Edit task') + '</h2><p data-task-owner></p></div><button type="button" class="button tertiary compact icon-button" data-task-dismiss aria-label="Close dialog" title="Close">&times;</button></div>' +
    '<fieldset disabled><label class="field">Subject *<input name="Subject" required maxlength="255" placeholder="What needs to be done?"></label><div class="task-form-grid' + (isNew ? ' task-form-grid--new' : '') + '">' +
    '<label class="field">Due date<input type="date" name="Due_Date"></label><label class="field">Priority<select name="Priority">' + options("Priority", TASK_PRIORITIES) + '</select></label>' +
    (isNew ? '' : '<label class="field">Status<select name="Status">' + options("Status", TASK_STATUSES) + '</select></label>') + '</div>' +
    (isNew ? '<label class="field">Task owner<select name="Owner"><option value="">Me (current user)</option></select></label>' : '') +
    '<section class="task-reminder-section" aria-label="Reminder"><label class="task-reminder-toggle"><input type="checkbox" name="Reminder_Enabled" aria-controls="task-reminder-fields"><span>Remind at</span></label><div id="task-reminder-fields" class="task-reminder-fields" data-task-reminder hidden><label class="field">Date and time<input type="datetime-local" name="Reminder_DateTime" disabled></label><label class="field">Remind via<select name="Reminder_Action" disabled><option value="POPUP">Pop-up</option><option value="EMAIL">Email</option></select></label></div></section>' +
    '<label class="field">Description (optional)<textarea name="Description" rows="3" maxlength="32000" placeholder="Add any details needed to complete this task"></textarea></label></fieldset><p role="status" aria-live="polite">Loading task...</p>' +
    '<div class="communication-editor-actions"><button type="button" class="button tertiary" data-task-dismiss>Cancel</button><button type="submit" class="button primary" disabled>' + (isNew ? 'Create task' : 'Save') + '</button></div></form>';
  document.body.append(dialog);
  const form = dialog.querySelector("form");
  const fieldset = dialog.querySelector("fieldset");
  const save = dialog.querySelector('[type="submit"]');
  const status = dialog.querySelector('[role="status"]');
  const isCurrent = () => dialog.isConnected && (!dependencies.isCurrent || dependencies.isCurrent());
  let initial, busy = false, reminderEdited = false;
  const setBusy = value => {
    busy = value;
    fieldset.disabled = save.disabled = value;
    dialog.querySelectorAll('[data-task-dismiss]').forEach(button => { button.disabled = value; });
  };
  dialog.querySelectorAll('[data-task-dismiss]').forEach(button => { button.onclick = () => { if (!busy) dialog.close(); }; });
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  dialog.addEventListener("close", () => { if (!isNew) void recordEditLocks.release("Tasks", taskId).catch(() => {}); dialog.remove(); }, { once: true });
  dialog.addEventListener("change", event => {
    if (event.target.name?.startsWith("Reminder_")) reminderEdited = true;
    if (event.target.name === "Reminder_Enabled") {
      const enabled = event.target.checked;
      dialog.querySelector('[data-task-reminder]').hidden = !enabled;
      dialog.querySelector('[name="Reminder_DateTime"]').required = enabled;
      for (const name of ["Reminder_DateTime", "Reminder_Action"]) dialog.querySelector('[name="' + name + '"]').disabled = !enabled;
    }
    if (event.target.name === "Priority" || event.target.name === "Status") {
      event.target.className = "task-color-select " + taskTone(event.target.name, event.target.value);
    }
  });
  form.onsubmit = async event => {
    event.preventDefault();
    if (busy || !initial || !isCurrent()) return;
    try {
      if (!isNew) await recordEditLocks.check("Tasks", taskId);
      const fields = Object.fromEntries(new FormData(form));
      if (!isNew) {
        fields.Reminder_Edited = reminderEdited;
        fields.Reminder_Enabled = dialog.querySelector('[name="Reminder_Enabled"]').checked;
      }
      const changes = isNew ? buildTaskPayload(bookingId, fields) : buildTaskChanges(bookingId, initial, fields);
      setBusy(true);
      status.textContent = "Saving task...";
      if (isNew) await (dependencies.create || crmCreateRecord)("Tasks", changes);
      else await updateBookingTask(bookingId, taskId, changes, initial, { ...dependencies, isCurrent });
      dependencies.onChanged?.(bookingId);
      if (!isCurrent()) return;
      dialog.close();
      await onSaved(fields);
    } catch (error) {
      if (isCurrent()) status.textContent = error.message || "Could not save task.";
    } finally { if (dialog.isConnected) setBusy(false); }
  };
  dialog.showModal();
  (async () => {
    try {
      if (!isNew) await recordEditLocks.begin("Tasks", taskId);
      if (!isCurrent()) { if (!isNew) await recordEditLocks.release("Tasks", taskId); return; }
      const fresh = isNew
        ? { Subject: "", Due_Date: "", Priority: "Normal", Status: "Not Started", Description: "" }
        : await (dependencies.get || crmGetRecord)("Tasks", taskId);
      if (!isCurrent()) return;
      if (!isNew) assertTaskBooking(fresh, bookingId, taskId);
      if (fresh.$editable === false || fresh.$locked_for_me) throw new Error("You cannot edit this task in CRM.");
      for (const field of EDIT_FIELDS.filter(field => !isNew || field !== "Status")) {
        if (fresh[field] === undefined) throw new Error("Some task fields are unavailable. Check your CRM field permissions.");
        dialog.querySelector('[name="' + field + '"]').value = fresh[field] ?? "";
        if (field === "Priority" || field === "Status") {
          dialog.querySelector('[name="' + field + '"]').className = "task-color-select " + taskTone(field, fresh[field]);
        }
      }
      const reminder = parseTaskReminder(fresh.Remind_At);
      dialog.querySelector('[name="Reminder_Enabled"]').checked = reminder.enabled;
      dialog.querySelector('[data-task-reminder]').hidden = !reminder.enabled;
      dialog.querySelector('[name="Reminder_DateTime"]').value = reminder.dateTime;
      dialog.querySelector('[name="Reminder_Action"]').value = reminder.action || "POPUP";
      for (const name of ["Reminder_DateTime", "Reminder_Action"]) dialog.querySelector('[name="' + name + '"]').disabled = !reminder.enabled;
      initial = fresh;
      dialog.querySelector('[data-task-owner]').textContent = isNew
        ? "Related to: " + (dependencies.bookingName || bookingId)
        : "Owner: " + (fresh.Owner?.name || "-");
      status.textContent = "";
      setBusy(false);
      dialog.querySelector('[name="Subject"]').focus();
      if (isNew) {
        const owner = dialog.querySelector('[name="Owner"]');
        try {
          const users = await loadTaskOwners(dependencies.getUsers || crmGetAllUsers);
          if (!isCurrent()) return;
          const selected = owner.value || dependencies.currentUserId || "";
          owner.innerHTML = '<option value="">Me (current user)</option>' + users.map(user => '<option value="' + escapeHtml(user.id) + '">' + escapeHtml(user.full_name || user.name || user.email || user.id) + '</option>').join("");
          owner.value = users.some(user => String(user.id) === String(selected)) ? selected : "";
        } catch (error) { if (isCurrent()) status.textContent = "Could not load task owners. You can still assign the task to yourself. " + (error.message || ""); }
      }
    } catch (error) { if (isCurrent()) status.textContent = error.message || "Could not load task."; }
  })();
  return dialog;
}

export async function loadTaskOwners(getUsers = crmGetAllUsers) {
  const users = new Map();
  for (let page = 1; page <= 20; page++) {
    const batch = await getUsers("ActiveUsers", page, 200);
    batch.forEach(user => { if (user.id) users.set(String(user.id), user); });
    if (batch.length < 200) return [...users.values()].sort((a, b) => String(a.full_name || a.email || "").localeCompare(String(b.full_name || b.email || "")));
  }
  throw new Error("Too many users to display.");
}

export async function loadBookingTasks(bookingId, search = crmSearchRecord) {
  if (!/^\d+$/.test(String(bookingId))) throw new Error("Select a booking first.");
  const records = new Map();
  for (let page = 1; page <= 10; page++) {
    const batch = await search("Tasks", "(What_Id:equals:" + bookingId + ")", page, 200);
    batch.forEach(task => {
      if (String(task.What_Id?.id) === String(bookingId) && (!task.$se_module || task.$se_module === "Deals")) records.set(String(task.id), task);
    });
    if (batch.length < 200) return [...records.values()];
  }
  throw new Error("Too many tasks to display the complete list. Please review Tasks in CRM.");
}

export function buildTaskPayload(bookingId, fields) {
  if (!/^\d+$/.test(String(bookingId))) throw new Error("Select a booking first.");
  const subject = String(fields.Subject || "").trim();
  if (!subject || subject.length > 255) throw new Error("Enter a subject of up to 255 characters.");
  const taskStatus = fields.Status || "Not Started";
  if (!TASK_STATUSES.includes(taskStatus) || !TASK_PRIORITIES.includes(fields.Priority)) throw new Error("Select a valid status and priority.");
  const description = String(fields.Description || "");
  if (description.length > 32000) throw new Error("Description is too long.");
  const payload = { Subject: subject, Status: taskStatus, Priority: fields.Priority, Description: description, What_Id: { id: String(bookingId) }, $se_module: "Deals" };
  if (fields.Owner && typeof fields.Owner === "string") {
    if (!/^\d+$/.test(fields.Owner)) throw new Error("Select a valid task owner.");
    payload.Owner = { id: fields.Owner };
  }
  if (fields.Reminder_Enabled === "on" || fields.Reminder_Enabled === true) {
    const value = String(fields.Reminder_DateTime || "");
    const when = new Date(value);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || !Number.isFinite(when.getTime()) || when.getTime() <= Date.now()) throw new Error("Choose a future reminder date and time.");
    if (!["POPUP", "EMAIL"].includes(fields.Reminder_Action)) throw new Error("Select a valid reminder method.");
    // Zoho's ALARM parser expects seconds and an explicit numeric UTC offset.
    // Use UTC +00:00 to preserve the selected instant, including its DST offset.
    const trigger = when.toISOString().slice(0, 19) + "+00:00";
    payload.Remind_At = { ALARM: "FREQ=NONE;ACTION=" + fields.Reminder_Action + ";TRIGGER=DATE-TIME:" + trigger };
  }
  if (fields.Due_Date) {
    const date = String(fields.Due_Date);
    const parsed = new Date(date + "T00:00:00Z");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error("Enter a valid due date.");
    payload.Due_Date = date;
  }
  return payload;
}

function todayDate() {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

export function visibleBookingTasks(tasks, filter, today = todayDate()) {
  return tasks.filter(task => filter === "completed" ? task.Status === "Completed" : filter === "open" ? task.Status !== "Completed" : filter === "overdue" ? task.Status !== "Completed" && task.Due_Date && task.Due_Date < today : true)
    .sort((a, b) => Number(a.Status === "Completed") - Number(b.Status === "Completed") || String(a.Due_Date || "9999").localeCompare(String(b.Due_Date || "9999")) || String(a.Subject || "").localeCompare(String(b.Subject || "")));
}

export function taskRows(tasks, today = todayDate()) {
  return tasks.map(task => {
    const overdue = task.Status !== "Completed" && task.Due_Date && task.Due_Date < today;
    const locked = task.$editable === false || task.$locked_for_me;
    const dateLabel = taskDateLabel(task.Due_Date);
    const dateClass = task.Status === "Completed" || !dateLabel ? "task-date-tag--muted" : overdue ? "task-date-tag--overdue" : "";
    return '<tr><td><div class="task-subject-row">' +
      '<button type="button" class="button tertiary compact icon-button task-close-button" data-task-close="' + escapeHtml(task.id) + '" title="Mark completed" aria-label="Mark completed"' + (locked || task.Status === "Completed" ? ' disabled' : '') + '>' + CHECK_ICON + '</button>' +
      '<span class="task-date-tag ' + dateClass + '" title="' + escapeHtml(dateLabel ? formatDate(task.Due_Date) + (overdue ? ' · Overdue' : '') : 'No due date') + '">' + escapeHtml(dateLabel || 'No date') + '</span>' +
      '<div class="task-subject-content"><span class="task-subject">' + escapeHtml(task.Subject || "Untitled task") + '</span></div></div>' +
      '</td><td>' + (String(task.Description || "").length > 180
        ? '<details class="task-description"><summary>' + escapeHtml(String(task.Description).slice(0, 90)) + '… — Read more</summary><p>' + escapeHtml(task.Description) + '</p></details>'
        : '<div class="task-description">' + escapeHtml(task.Description || "-") + '</div>') + '</td>' +
      '<td>' + taskValueBadge("Priority", task.Priority) + '</td><td>' + taskReminderBadge(task.Remind_At) + '</td><td>' + escapeHtml(task.Owner?.name || "-") + '</td><td class="task-actions-cell"><button type="button" class="button tertiary compact task-edit-button" data-task-edit="' + escapeHtml(task.id) + '" aria-label="Edit task"' + (locked ? ' disabled' : '') + '>' + PENCIL_ICON + '<span>Edit task</span></button></td></tr>';
  }).join("");
}

export function taskDateLabel(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return "";
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const month = months[Number(match[2]) - 1];
  return month ? Number(match[3]) + " " + month + ", " + match[1].slice(-2) : "";
}

export function createBookingTasksController(elements, state, dependencies = {}) {
  const load = dependencies.load || loadBookingTasks;
  const panel = elements.manageTasksPanel;
  let editor = null;
  let version = 0;
  let data = { bookingId: "", rows: [], loaded: false, loading: false, error: "", filter: "open", saving: false };
  const find = selector => panel.querySelector(selector);
  function reset() {
    version++;
    if (editor) { editor.close(); editor = null; }
    data = { bookingId: "", rows: [], loaded: false, loading: false, error: "", filter: "open", saving: false };
    render();
  }
  function render() {
    if (!panel) return;
    const hasBooking = Boolean(state.selectedBookingId);
    const openCount = data.rows.filter(task => task.Status !== "Completed").length;
    const countKnown = hasBooking && data.loaded && !data.error;
    if (elements.tabTasks) {
      elements.tabTasks.innerHTML = 'Tasks <span class="tasks-tab-count' + (countKnown && openCount > 0 ? ' tasks-tab-count--open' : '') + '" aria-hidden="true">' + (countKnown ? openCount : hasBooking ? '–' : '0') + '</span>';
      elements.tabTasks.setAttribute("aria-label", "Tasks, " + (countKnown ? openCount + " open" : hasBooking ? "count unavailable" : "0 open"));
    }
    panel.innerHTML = '<section class="card booking-tasks-card"><div class="card-header"><h2 class="panel-mini-title">Booking tasks</h2><div class="tasks-actions">' +
      '<button type="button" class="button tertiary compact icon-button refresh-card-purchases-button' + (data.loading ? ' is-loading' : '') + '" data-task-refresh title="Refresh tasks" aria-label="Refresh tasks"' + (!hasBooking || data.loading || data.saving ? ' disabled' : '') + '>' + REFRESH_ICON + '</button>' +
      '<button type="button" class="button primary compact" data-task-new' + (!hasBooking || data.loading || data.saving ? ' disabled' : '') + '>New task</button></div></div>' +
      '<div class="tasks-toolbar">' + (hasBooking ? '<div class="tasks-filter-switch" role="group" aria-label="Show tasks">' + [["open", "Open"], ["completed", "Completed"], ["all", "All"]].map(([value, label]) => '<button type="button" data-task-filter="' + value + '" aria-pressed="' + (data.filter === value) + '"' + (data.saving ? ' disabled' : '') + '>' + label + '</button>').join("") + '</div>' : '') +
      '<p class="tasks-notice" role="status">' + escapeHtml(!hasBooking ? "Load a booking to see related tasks." : data.loading ? "Loading tasks..." : data.error || (data.loaded ? openCount + " open · " + (data.rows.length - openCount) + " completed" : "")) + '</p></div>' +
      (hasBooking ? '<div class="tasks-table-wrap"><table class="services-table"><thead><tr><th class="task-subject-heading"><span>Subject</span></th><th>Description</th><th>Priority</th><th>Reminder</th><th>Owner</th><th>Actions</th></tr></thead><tbody></tbody></table></div>' : '') + '</section>';
    if (hasBooking) {
      renderRows();
    }
  }
  function renderRows() {
    const body = find("tbody");
    if (!body) return;
    body.innerHTML = data.loading || data.error ? '' : taskRows(visibleBookingTasks(data.rows, data.filter)) || '<tr><td colspan="6" class="table-empty">No tasks in this view.</td></tr>';
  }
  async function ensure(force = false) {
    const bookingId = String(state.selectedBookingId || "");
    if (!bookingId) { reset(); return; }
    if (data.bookingId !== bookingId) reset();
    if (data.loading || data.saving || (data.loaded && !force)) return;
    const request = ++version;
    data.bookingId = bookingId;
    data.loading = true;
    data.error = "";
    render();
    try {
      const rows = await load(bookingId);
      if (request !== version || String(state.selectedBookingId) !== bookingId) return;
      data.rows = rows;
      data.loaded = true;
    } catch (error) {
      if (request !== version || String(state.selectedBookingId) !== bookingId) return;
      data.error = "Could not load tasks. " + (error.message || "Please try again.");
    } finally {
      if (request === version && String(state.selectedBookingId) === bookingId) { data.loading = false; render(); }
    }
  }
  if (panel) {
    panel.addEventListener("click", async event => {
      const button = event.target.closest("button");
      if (!button || button.disabled || data.saving) return;
      if (button.hasAttribute("data-task-filter")) {
        const filter = button.getAttribute("data-task-filter");
        if (!["open", "completed", "all"].includes(filter)) return;
        data.filter = filter;
        render();
        find('[data-task-filter="' + filter + '"]')?.focus();
        return;
      }
      if (button.hasAttribute("data-task-refresh")) { await ensure(true); return; }
      if (button.hasAttribute("data-task-new")) {
        if (!state.selectedBookingId || editor?.isConnected) return;
        const bookingId = String(state.selectedBookingId);
        const request = version;
        const isCurrent = () => request === version && bookingId === String(state.selectedBookingId);
        editor = (dependencies.openEditor || openTaskEditor)(null, bookingId, async fields => {
          if (!isCurrent()) return;
          data.filter = fields.Status === "Completed" ? "completed" : "open";
          await ensure(true);
        }, { ...dependencies, isCurrent, bookingName: state.selectedBooking?.Deal_Name, currentUserId: state.currentUserId });
        return;
      }
      const id = button.getAttribute("data-task-edit") || button.getAttribute("data-task-close");
      if (!id || !data.rows.some(task => String(task.id) === id)) return;
      const request = version;
      const bookingId = String(state.selectedBookingId);
      const isCurrent = () => request === version && bookingId === String(state.selectedBookingId);
      if (button.hasAttribute("data-task-edit")) {
        if (editor?.isConnected) return;
        editor = (dependencies.openEditor || openTaskEditor)(id, bookingId, async () => {
          if (isCurrent()) await ensure(true);
        }, { ...dependencies, isCurrent });
        return;
      }
      if (button.hasAttribute("data-task-close")) {
        const task = data.rows.find(task => String(task.id) === id);
        if (task.Status === "Completed" || task.$editable === false || task.$locked_for_me) return;
        data.saving = true;
        const controls = [...panel.querySelectorAll("button, input, select, textarea")].map(control => [control, control.disabled]);
        controls.forEach(([control]) => { control.disabled = true; });
        find('[role="status"]').textContent = "Closing task...";
        try {
          await updateBookingTask(bookingId, id, { Status: "Completed" }, null, { ...dependencies, isCurrent });
          dependencies.onChanged?.(bookingId);
          if (!isCurrent()) return;
          data.saving = false;
          await ensure(true);
        } catch (error) {
          if (isCurrent()) find('[role="status"]').textContent = error.message || "Could not close task.";
        } finally {
          if (isCurrent()) {
            data.saving = false;
            controls.forEach(([control, disabled]) => { control.disabled = disabled; });
          }
        }
        return;
      }
    });
  }
  return { ensure, reset, hasPendingChanges: () => Boolean(editor?.isConnected || data.saving) };
}
