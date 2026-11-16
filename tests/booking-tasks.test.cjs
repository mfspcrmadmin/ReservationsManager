const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const source = fs.readFileSync(path.join(__dirname, "../app/js/booking-tasks.js"), "utf8");
function setup(extra = {}) {
  const context = vm.createContext({ recordEditLocks: require("./helpers/record-edit-locks.cjs"),
    escapeHtml: value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
    formatDate: value => value || "-", crmCreateRecord: async () => {}, crmSearchRecord: async () => [],
    crmGetAllUsers: async () => [], crmGetRecord: async () => null, crmUpdateRecord: async () => ({}),
    ...extra
  });
  vm.runInContext(source.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, ""), context);
  return context;
}
const bookingId = "616617000135728065";
const task = { id: "1", What_Id: { id: bookingId }, Subject: "Check hotel", Status: "Not Started", Priority: "Normal" };

test("loads every page, deduplicates tasks and excludes unrelated records", async () => {
  const c = setup();
  const calls = [];
  const rows = await c.loadBookingTasks(bookingId, async (...args) => {
    calls.push(args);
    return args[2] === 1 ? Array.from({ length: 200 }, (_, i) => ({ ...task, id: String(i) })) : [task, { ...task, id: "completed", Status: "Completed" }, { ...task, id: "foreign", What_Id: { id: "other" } }, { ...task, id: "contact", $se_module: "Contacts" }];
  });
  assert.equal(rows.length, 201);
  assert.deepEqual(calls[0], ["Tasks", `(What_Id:equals:${bookingId})`, 1, 200]);
  assert.equal(calls[1][2], 2);
  assert.equal(rows.at(-1).Status, "Completed");
});

test("read errors and result limits never become an empty or partial success", async () => {
  const c = setup();
  await assert.rejects(c.loadBookingTasks(bookingId, async () => { throw new Error("Permission denied"); }), /Permission denied/);
  await assert.rejects(c.loadBookingTasks(bookingId, async () => Array(200).fill(task)), /Too many/);
  await assert.rejects(c.loadBookingTasks("bad:criteria"), /Select a booking/);
  assert.equal((await c.loadBookingTasks(bookingId)).length, 0);
});

test("creation always associates the exact booking and validates CRM fields", () => {
  const c = setup();
  const fields = { Subject: "  Confirm hotel  ", Status: "Not Started", Priority: "Normal", Due_Date: "2026-09-22" };
  const payload = c.buildTaskPayload(bookingId, fields);
  assert.equal(payload.What_Id.id, bookingId);
  assert.equal(payload.$se_module, "Deals");
  assert.equal(payload.Subject, "Confirm hotel");
  for (const invalid of [{ Subject: " " }, { Subject: "x".repeat(256) }, { Status: "Unknown" }, { Priority: "Urgent" }, { Due_Date: "2026-02-30" }, { Description: "x".repeat(32001) }]) {
    assert.throws(() => c.buildTaskPayload(bookingId, { ...fields, ...invalid }));
  }
  assert.equal("Due_Date" in c.buildTaskPayload(bookingId, { ...fields, Due_Date: "" }), false);
});

test("filters keep completed tasks out of overdue and order dated open tasks first", () => {
  const c = setup();
  const tasks = [
    { ...task, id: "undated" }, { ...task, id: "closed", Status: "Completed", Due_Date: "2026-01-01" },
    { ...task, id: "today", Due_Date: "2026-09-22" }, { ...task, id: "late", Due_Date: "2026-09-21" }
  ];
  const ids = filter => Array.from(c.visibleBookingTasks(tasks, filter, "2026-09-22"), task => task.id);
  assert.deepEqual(ids("overdue"), ["late"]);
  assert.deepEqual(ids("open"), ["late", "today", "undated"]);
  assert.deepEqual(ids("completed"), ["closed"]);
  assert.deepEqual(ids("all"), ["late", "today", "undated", "closed"]);
  assert.equal(tasks[0].id, "undated");
});

test("task content and descriptions are escaped, including attributes", () => {
  const html = setup().taskRows([{ ...task, id: '1" onclick="evil', Subject: '<script>evil</script>', Description: '<img src=x onerror=evil>', Owner: { name: '<b>Owner</b>' }, Due_Date: "2026-01-01" }], "2026-09-22");
  assert.doesNotMatch(html, /<script>|<img|<b>/);
  assert.match(html, /&quot; onclick=&quot;evil/);
  assert.match(html, /Overdue/);
});

function panelFixture() {
  const nodes = new Map();
  const listeners = {};
  return {
    innerHTML: "", listeners,
    addEventListener: (type, listener) => { listeners[type] = listener; },
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, { innerHTML: "", textContent: "", value: "", hidden: true, focus() {}, reset() {} });
      return nodes.get(selector);
    },
    querySelectorAll() { return [...nodes.values()]; }
  };
}

test("a slow previous booking response cannot replace tasks of the next booking", async () => {
  const c = setup();
  const panel = panelFixture();
  const state = { selectedBookingId: bookingId, selectedBooking: { Deal_Name: "First" } };
  const pending = {};
  const controller = c.createBookingTasksController({ manageTasksPanel: panel }, state, { load: id => new Promise(resolve => { pending[id] = resolve; }) });
  const first = controller.ensure();
  state.selectedBookingId = "2";
  controller.reset();
  const next = controller.ensure();
  pending["2"]([{ ...task, Subject: "Second booking" }]);
  await next;
  pending[bookingId]([{ ...task, Subject: "Old booking" }]);
  await first;
  assert.match(panel.querySelector("tbody").innerHTML, /Second booking/);
  assert.doesNotMatch(panel.querySelector("tbody").innerHTML, /Old booking/);
  state.selectedBookingId = "";
  controller.reset();
  assert.match(panel.innerHTML, /Load a booking/);
});

test("failed task loading shows an error and supports retry", async () => {
  const panel = panelFixture();
  let count = 0;
  const controller = setup().createBookingTasksController({ manageTasksPanel: panel }, { selectedBookingId: bookingId }, {
    load: async () => { if (++count === 1) throw new Error("Permission denied"); return [task]; }
  });
  await controller.ensure();
  assert.match(panel.innerHTML, /Could not load tasks. Permission denied/);
  assert.equal(panel.querySelector("tbody").innerHTML, "");
  await controller.ensure(true);
  assert.match(panel.querySelector("tbody").innerHTML, /Check hotel/);
});

test("duplicate submits are blocked and switching bookings during creation cannot refresh the new booking", async () => {
  const fields = { Subject: "New", Status: "Not Started", Priority: "Normal" };
  const modal = editorFixture();
  const c = setup({ document: modal.document, FormData: function () { return Object.entries(fields); } });
  const panel = panelFixture();
  const state = { selectedBookingId: bookingId };
  let resolveCreate, writes = [], loads = [];
  const controller = c.createBookingTasksController({ manageTasksPanel: panel }, state, {
    load: async id => { loads.push(id); return []; },
    create: async (entity, payload) => { writes.push({ entity, payload }); await new Promise(resolve => { resolveCreate = resolve; }); }
  });
  await controller.ensure();
  await clickTask(panel, "data-task-new");
  const event = { preventDefault() {}, target: {} };
  const saving = modal.dialog.querySelector("form").onsubmit(event);
  await modal.dialog.querySelector("form").onsubmit(event);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].payload.What_Id.id, bookingId);
  state.selectedBookingId = "2";
  controller.reset();
  assert.equal(modal.dialog.isConnected, false);
  await controller.ensure();
  resolveCreate();
  await saving;
  assert.deepEqual(loads, [bookingId, "2"]);
});

test("CRM write failures retain the form and allow retry", async () => {
  const panel = panelFixture();
  const modal = editorFixture();
  const c = setup({ document: modal.document, FormData: function () { return Object.entries({ Subject: "New", Status: "Not Started", Priority: "Normal" }); } });
  let writes = 0, loads = 0;
  const controller = c.createBookingTasksController({ manageTasksPanel: panel }, { selectedBookingId: bookingId }, {
    load: async () => { loads++; return []; },
    create: async () => { if (++writes === 1) throw new Error("CRM rejected task"); }
  });
  await controller.ensure();
  await clickTask(panel, "data-task-new");
  assert.doesNotMatch(panel.innerHTML, /<form/);
  assert.equal(modal.dialog.open, true);
  assert.equal(modal.dialog.querySelector('[name="Priority"]').value, "Normal");
  assert.doesNotMatch(modal.dialog.innerHTML, /name="Status"/);
  const event = { preventDefault() {}, target: {} };
  await modal.dialog.querySelector("form").onsubmit(event);
  assert.match(modal.dialog.querySelector('[role="status"]').textContent, /CRM rejected task/);
  assert.equal(modal.dialog.isConnected, true);
  assert.equal(loads, 1);
  await modal.dialog.querySelector("form").onsubmit(event);
  assert.equal(writes, 2);
  assert.equal(loads, 2);
  assert.equal(modal.dialog.isConnected, false);
});

test("row shows close and date before subject and Edit task in the final Actions column", async () => {
  const c = setup();
  const html = c.taskRows([task]);
  assert.ok(html.indexOf("data-task-close") < html.indexOf("data-task-edit"));
  assert.ok(html.indexOf('class="task-subject"') < html.indexOf("data-task-edit"));
  assert.match(html, /aria-label="Edit task"/);
  assert.doesNotMatch(html, /data-task-open|<a\b/);
  assert.match(html, /<span class="task-subject">Check hotel<\/span>/);
  assert.equal((html.match(/<td/g) || []).length, 6);
  assert.match(html, /<td class="task-actions-cell">.*<span>Edit task<\/span><\/button><\/td><\/tr>$/);
  assert.match(c.taskRows([{ ...task, Status: "Completed" }]), /data-task-close[^>]+disabled/);
  const panel = panelFixture();
  await c.createBookingTasksController({ manageTasksPanel: panel }, { selectedBookingId: bookingId }).ensure();
  assert.match(panel.innerHTML, /<th>Owner<\/th><th>Actions/);
  assert.match(panel.innerHTML, /refresh-card-purchases-button/);
  assert.match(panel.innerHTML, /aria-label="Refresh tasks"[^>]*><svg/);
});

test("edits send changed fields only, clear due dates with null and preserve booking/owner", async () => {
  const c = setup();
  const initial = { ...task, Due_Date: "2026-09-22", Description: "Keep", Owner: { id: "42" } };
  const changes = c.buildTaskChanges(bookingId, initial, { ...initial, Due_Date: "", Subject: "Updated" });
  assert.deepEqual(JSON.parse(JSON.stringify(changes)), { Subject: "Updated", Due_Date: null });
  let payload;
  await c.updateBookingTask(bookingId, task.id, changes, initial, {
    get: async () => initial,
    update: async (entity, data) => { assert.equal(entity, "Tasks"); payload = data; return { code: "SUCCESS" }; }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), { id: "1", Subject: "Updated", Due_Date: null });
});

test("close checks current association and permissions, and rejects failed or unconfirmed writes", async () => {
  const c = setup();
  let calls = 0;
  const update = async () => { calls++; return { code: "SUCCESS" }; };
  for (const fresh of [null, { ...task, What_Id: { id: "other" } }, { ...task, $editable: false }, { ...task, $locked_for_me: true }]) {
    await assert.rejects(c.updateBookingTask(bookingId, task.id, { Status: "Completed" }, null, { get: async () => fresh, update }));
  }
  await c.updateBookingTask(bookingId, task.id, { Status: "Completed" }, null, { get: async () => ({ ...task, Status: "Completed" }), update });
  assert.equal(calls, 0);
  for (const result of [{}, { code: "INVALID_DATA", message: "Blueprint restriction" }, { code: "SUCCESS", status: "error" }]) {
    await assert.rejects(c.updateBookingTask(bookingId, task.id, { Status: "Completed" }, null, { get: async () => task, update: async () => result }));
  }
});

test("edits reject conflicting changes and booking switches before writing", async () => {
  const c = setup();
  let calls = 0;
  const update = async () => { calls++; };
  await assert.rejects(c.updateBookingTask(bookingId, task.id, { Subject: "Updated" }, task, {
    get: async () => ({ ...task, Subject: "Someone else's edit" }), update
  }), /another session/);
  await assert.rejects(c.updateBookingTask(bookingId, task.id, { Status: "Completed" }, null, {
    get: async () => task, update, isCurrent: () => false
  }), /booking changed/);
  assert.equal(calls, 0);
});

function clickTask(panel, attribute, value = task.id) {
  const button = { disabled: false, hasAttribute: name => name === attribute, getAttribute: name => name === attribute ? value : null };
  return panel.listeners.click({ target: { closest: () => button } });
}

test("date tags use calendar dates without timezone shifts", () => {
  const c = setup();
  assert.equal(c.taskDateLabel("2026-10-12"), "12 OCT, 26");
  assert.equal(c.taskDateLabel("2026-01-01"), "1 JAN, 26");
  assert.equal(c.taskDateLabel(null), "");
  const html = c.taskRows([{ ...task, Due_Date: "2026-10-12" }], "2026-09-22");
  assert.match(html, /12 OCT, 26/);
  assert.ok(html.indexOf("task-date-tag") < html.indexOf('class="task-subject"'));
});

test("tab count reflects all open tasks, turns grey at zero, and clears on booking changes", async () => {
  const panel = panelFixture();
  const tab = { innerHTML: "", setAttribute() {} };
  const state = { selectedBookingId: bookingId };
  let rows = [task, { ...task, id: "2", Status: "Completed" }];
  const controller = setup().createBookingTasksController({ manageTasksPanel: panel, tabTasks: tab }, state, { load: async () => rows });
  await controller.ensure();
  assert.match(tab.innerHTML, /tasks-tab-count--open/);
  assert.match(tab.innerHTML, />1<\/span>/);
  await clickTask(panel, "data-task-filter", "completed");
  assert.match(panel.innerHTML, /data-task-filter="completed" aria-pressed="true"/);
  assert.doesNotMatch(panel.innerHTML, /<select|data-task-filter="overdue"/);
  assert.match(tab.innerHTML, />1<\/span>/);
  rows = [{ ...task, Status: "Completed" }];
  await controller.ensure(true);
  assert.doesNotMatch(tab.innerHTML, /tasks-tab-count--open/);
  assert.match(tab.innerHTML, />0<\/span>/);
  state.selectedBookingId = "";
  controller.reset();
  assert.match(tab.innerHTML, />0<\/span>/);
});

test("close submits only Completed once, refreshes after success and keeps rows on error", async () => {
  const panel = panelFixture();
  let finish, calls = 0, loads = 0;
  const c = setup();
  const controller = c.createBookingTasksController({ manageTasksPanel: panel }, { selectedBookingId: bookingId }, {
    load: async () => { loads++; return [task]; }, get: async () => task,
    update: async (_, payload) => { calls++; assert.deepEqual(JSON.parse(JSON.stringify(payload)), { id: "1", Status: "Completed" }); return new Promise(resolve => { finish = resolve; }); }
  });
  await controller.ensure();
  const closing = clickTask(panel, "data-task-close");
  await clickTask(panel, "data-task-close");
  assert.equal(calls, 1);
  finish({ code: "INVALID_DATA", message: "Cannot close" });
  await closing;
  assert.equal(loads, 1);
  assert.match(panel.querySelector('[role="status"]').textContent, /Cannot close/);
  assert.match(panel.querySelector("tbody").innerHTML, /Check hotel/);
  const retry = clickTask(panel, "data-task-close");
  await new Promise(resolve => setImmediate(resolve));
  finish({ code: "SUCCESS" });
  await retry;
  assert.equal(loads, 2);
});

test("switching bookings during close does not refresh the new booking", async () => {
  const panel = panelFixture(), state = { selectedBookingId: bookingId };
  let finish;
  const loads = [];
  const controller = setup().createBookingTasksController({ manageTasksPanel: panel }, state, {
    load: async id => { loads.push(id); return [task]; }, get: async () => task,
    update: async () => new Promise(resolve => { finish = resolve; })
  });
  await controller.ensure();
  const closing = clickTask(panel, "data-task-close");
  await new Promise(resolve => setImmediate(resolve));
  state.selectedBookingId = "2";
  controller.reset();
  await controller.ensure();
  finish({ code: "SUCCESS" });
  await closing;
  assert.deepEqual(loads, [bookingId, "2"]);
});

function editorFixture() {
  const dialog = panelFixture();
  dialog.setAttribute = () => {};
  dialog.showModal = () => { dialog.open = true; };
  dialog.remove = () => { dialog.isConnected = false; };
  dialog.close = () => { dialog.open = false; dialog.listeners.close(); };
  const dismiss = [{ disabled: false }, { disabled: false }];
  dialog.querySelectorAll = () => dismiss;
  const document = { createElement: () => dialog, body: { append: () => { dialog.isConnected = true; } } };
  const FormData = function () { return ["Subject", "Due_Date", "Priority", "Status", "Description"].map(field => [field, dialog.querySelector('[name="' + field + '"]').value]); };
  return { dialog, document, FormData, dismiss };
}

test("popup loads fresh fields, retains edits on failure, then saves and closes after retry", async () => {
  const f = editorFixture();
  const c = setup({ document: f.document, FormData: f.FormData });
  const fresh = { ...task, Due_Date: "2026-09-22", Description: "Current" };
  let writes = 0, saved = 0;
  c.openTaskEditor(task.id, bookingId, async () => { saved++; }, {
    get: async () => fresh,
    update: async () => ++writes === 1 ? { code: "INVALID_DATA", message: "Rejected" } : { code: "SUCCESS" }
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.dialog.open, true);
  assert.equal(f.dialog.querySelector('[name="Subject"]').value, task.Subject);
  f.dialog.querySelector('[name="Subject"]').value = "Changed";
  await f.dialog.querySelector("form").onsubmit({ preventDefault() {} });
  assert.equal(saved, 0);
  assert.equal(f.dialog.isConnected, true);
  assert.match(f.dialog.querySelector('[role="status"]').textContent, /Rejected/);
  assert.equal(f.dialog.querySelector('[name="Subject"]').value, "Changed");
  await f.dialog.querySelector("form").onsubmit({ preventDefault() {} });
  assert.equal(saved, 1);
  assert.equal(f.dialog.isConnected, false);
});

test("pencil opens a widget popup and reset closes it without navigating to CRM", async () => {
  const panel = panelFixture();
  let closed = 0, opened = 0;
  const controller = setup().createBookingTasksController({ manageTasksPanel: panel }, { selectedBookingId: bookingId }, {
    load: async () => [task],
    openEditor: (id, booking) => { opened++; assert.equal(id, task.id); assert.equal(booking, bookingId); return { isConnected: true, close() { closed++; } }; }
  });
  await controller.ensure();
  await clickTask(panel, "data-task-edit");
  await clickTask(panel, "data-task-edit");
  assert.equal(opened, 1);
  assert.equal(controller.hasPendingChanges(), true);
  controller.reset();
  assert.equal(controller.hasPendingChanges(), false);
  assert.equal(closed, 1);
});

test("closing a task protects navigation and notifies the queue only after confirmed success", async () => {
  const panel = panelFixture(), changes = [];
  let finish;
  const controller = setup().createBookingTasksController({ manageTasksPanel: panel }, { selectedBookingId: bookingId }, {
    load: async () => [task], get: async () => task,
    update: () => new Promise(resolve => { finish = resolve; }),
    onChanged: id => changes.push(id)
  });
  await controller.ensure();
  const closing = clickTask(panel, "data-task-close");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(controller.hasPendingChanges(), true);
  assert.deepEqual(changes, []);
  finish({ code: "SUCCESS" });
  await closing;
  assert.equal(controller.hasPendingChanges(), false);
  assert.deepEqual(changes, [bookingId]);
});

test("creating and editing notify the queue after saving but not after failed writes", async () => {
  for (const isNew of [true, false]) {
    const f = editorFixture(), changes = [];
    let fail = true;
    const c = setup({ document: f.document, FormData: function () { return Object.entries({ Subject: "Changed", Priority: "Normal", Status: "Not Started", Description: "" }); } });
    c.openTaskEditor(isNew ? null : task.id, bookingId, async () => {}, {
      get: async () => ({ ...task, Due_Date: "", Description: "" }),
      create: async () => { if (fail) throw new Error("Rejected"); },
      update: async () => ({ code: fail ? "INVALID_DATA" : "SUCCESS" }),
      onChanged: id => changes.push(id)
    });
    await new Promise(resolve => setImmediate(resolve));
    await f.dialog.querySelector("form").onsubmit({ preventDefault() {} });
    assert.deepEqual(changes, []);
    fail = false;
    await f.dialog.querySelector("form").onsubmit({ preventDefault() {} });
    assert.deepEqual(changes, [bookingId]);
  }
});


test("new task supports owners and optional native reminders", () => {
  const c = setup();
  const fields = { Subject: "Call supplier", Status: "Not Started", Priority: "Normal", Owner: "616617000135728065", Reminder_Enabled: "on", Reminder_DateTime: "2099-12-20T10:30", Reminder_Action: "EMAIL" };
  const payload = c.buildTaskPayload(bookingId, fields);
  assert.equal(payload.Owner.id, fields.Owner);
  assert.equal(payload.Remind_At.ALARM, "FREQ=NONE;ACTION=EMAIL;TRIGGER=DATE-TIME:" + new Date(fields.Reminder_DateTime).toISOString().slice(0, 19) + "+00:00");
  assert.match(c.buildTaskPayload(bookingId, { ...fields, Reminder_Action: "POPUP" }).Remind_At.ALARM, /ACTION=POPUP/);
  assert.equal(c.buildTaskPayload(bookingId, { ...fields, Reminder_Enabled: false }).Remind_At, undefined);
  for (const invalid of [{ Owner: "invalid" }, { Reminder_DateTime: "" }, { Reminder_DateTime: "2020-01-01T12:00" }, { Reminder_Action: "invalid" }]) {
    assert.throws(() => c.buildTaskPayload(bookingId, { ...fields, ...invalid }));
  }
});

test("task owner choices paginate active CRM users and keep exact IDs", async () => {
  const c = setup();
  const calls = [];
  const users = await c.loadTaskOwners(async (type, page) => {
    calls.push([type, page]);
    return page === 1 ? Array.from({ length: 200 }, (_, i) => ({ id: String(i), full_name: "User " + i })) : [{ id: bookingId, full_name: "Angela" }];
  });
  assert.equal(users.length, 201);
  assert.equal(users[0].id, bookingId);
  assert.deepEqual(calls, [["ActiveUsers", 1], ["ActiveUsers", 2]]);
});

test("new task editor toggles reminder fields and populates the current owner", async () => {
  const f = editorFixture();
  const c = setup({ document: f.document, FormData: f.FormData });
  c.openTaskEditor(null, bookingId, async () => {}, { currentUserId: "42", getUsers: async () => [{ id: "42", full_name: "Angela" }, { id: "43", full_name: "Other owner" }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(f.dialog.innerHTML, /name="Owner"/);
  assert.equal(f.dialog.querySelector('[name="Owner"]').value, "42");
  assert.match(f.dialog.querySelector('[name="Owner"]').innerHTML, /Other owner/);
  for (const enabled of [true, false]) {
    f.dialog.listeners.change({ target: { name: "Reminder_Enabled", checked: enabled } });
    assert.equal(f.dialog.querySelector('[data-task-reminder]').hidden, !enabled);
    assert.equal(f.dialog.querySelector('[name="Reminder_DateTime"]').required, enabled);
    assert.equal(f.dialog.querySelector('[name="Reminder_Action"]').disabled, !enabled);
  }
});


test("new tasks default status internally and table replaces status with native reminders", () => {
  const c = setup();
  assert.equal(c.buildTaskPayload(bookingId, { Subject: "New", Priority: "Normal" }).Status, "Not Started");
  const html = c.taskRows([{ ...task, Remind_At: { ALARM: "FREQ=NONE;ACTION=EMAIL;TRIGGER=DATE-TIME:2099-12-20T10:30:00Z" } }, { ...task, id: "2", Remind_At: null }]);
  assert.match(html, /Email/);
  assert.match(html, /2099-12-20/);
  assert.match(html, /No reminder/);
  assert.doesNotMatch(html, /Not Started/);
});

test("edit preserves untouched reminders, adds or removes them and detects concurrent changes", async () => {
  const c = setup();
  const oldReminder = { ALARM: "FREQ=NONE;ACTION=POPUP;TRIGGER=DATE-TIME:2000-01-01T10:30:00Z" };
  const initial = { ...task, Description: "", Due_Date: "", Remind_At: oldReminder };
  const fields = { ...initial, Subject: "Updated" };
  assert.deepEqual(JSON.parse(JSON.stringify(c.buildTaskChanges(bookingId, initial, fields))), { Subject: "Updated" });
  const removed = c.buildTaskChanges(bookingId, initial, { ...fields, Subject: initial.Subject, Reminder_Edited: true, Reminder_Enabled: false });
  assert.deepEqual(JSON.parse(JSON.stringify(removed)), { Remind_At: null });
  const added = c.buildTaskChanges(bookingId, initial, { ...fields, Subject: initial.Subject, Reminder_Edited: true, Reminder_Enabled: true, Reminder_DateTime: "2099-12-20T10:30", Reminder_Action: "EMAIL" });
  assert.match(added.Remind_At.ALARM, /ACTION=EMAIL/);
  let payload;
  await c.updateBookingTask(bookingId, task.id, removed, initial, { get: async () => ({ ...initial, Remind_At: { ...oldReminder } }), update: async (_, value) => { payload = value; return { code: "SUCCESS" }; } });
  assert.equal(payload.Remind_At, null);
  await assert.rejects(c.updateBookingTask(bookingId, task.id, removed, initial, { get: async () => ({ ...initial, Remind_At: added.Remind_At }) }), /another session/);
});

test("edit popup loads the native reminder and saves its removal", async () => {
  const f = editorFixture();
  const c = setup({ document: f.document, FormData: f.FormData });
  const fresh = { ...task, Due_Date: "", Description: "", Remind_At: { ALARM: "ACTION=EMAIL;TRIGGER=DATE-TIME:2099-12-20T10:30:00Z" } };
  let payload;
  c.openTaskEditor(task.id, bookingId, async () => {}, { get: async () => fresh, update: async (_, value) => { payload = value; return { code: "SUCCESS" }; } });
  await new Promise(resolve => setImmediate(resolve));
  const checkbox = f.dialog.querySelector('[name="Reminder_Enabled"]');
  assert.equal(checkbox.checked, true);
  assert.equal(f.dialog.querySelector('[name="Reminder_Action"]').value, "EMAIL");
  assert.equal(f.dialog.querySelector('[name="Reminder_DateTime"]').value, c.parseTaskReminder(fresh.Remind_At).dateTime);
  checkbox.checked = false;
  f.dialog.listeners.change({ target: { name: "Reminder_Enabled", checked: false } });
  await f.dialog.querySelector('form').onsubmit({ preventDefault() {} });
  assert.equal(payload.Remind_At, null);
  assert.equal(payload.Status, undefined);
});


test("native reminder writes use seconds and a numeric offset without changing the selected time", async () => {
  const c = setup();
  for (const dateTime of ["2099-01-15T00:30", "2099-07-15T00:30"]) {
    for (const action of ["EMAIL", "POPUP"]) {
      const fields = { Subject: "Reminder", Priority: "Normal", Reminder_Enabled: true, Reminder_DateTime: dateTime, Reminder_Action: action };
      const payload = c.buildTaskPayload(bookingId, fields);
      const alarm = payload.Remind_At.ALARM;
      assert.match(alarm, /^FREQ=NONE;ACTION=(EMAIL|POPUP);TRIGGER=DATE-TIME:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
      const trigger = alarm.split("TRIGGER=DATE-TIME:")[1];
      assert.equal(Date.parse(trigger), new Date(dateTime).getTime());
      assert.equal(c.parseTaskReminder(payload.Remind_At).dateTime, dateTime);
      const initial = { ...task, Description: "", Due_Date: "", Remind_At: null };
      const changes = c.buildTaskChanges(bookingId, initial, { ...fields, Reminder_Edited: true });
      let written;
      await c.updateBookingTask(bookingId, task.id, changes, initial, {
        get: async () => initial,
        update: async (_, data) => { written = data; return { code: "SUCCESS" }; }
      });
      assert.equal(written.Remind_At.ALARM, alarm);
    }
  }
});
