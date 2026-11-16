const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");
const source = fs.readFileSync(require("node:path").join(__dirname, "../app/js/booking-queue-tasks.js"), "utf8");
function setup(extra = {}) {
  const context = vm.createContext({
    escapeHtml: value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"),
    ...extra
  });
  const taskSource = fs.readFileSync(require("node:path").join(__dirname, "../app/js/booking-tasks.js"), "utf8");
  vm.runInContext(taskSource.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, ""), context);
  Object.assign(context, extra);
  vm.runInContext(source.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, ""), context);
  return context;
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test("a task write invalidates an old queue read without losing the new pending request", async () => {
  const jobs = [];
  const c = setup({ loadBookingTasks: id => new Promise(resolve => jobs.push({ id, resolve })) });
  const old = c.loadQueueTasks("1");
  c.invalidateQueueTasks("1");
  const fresh = c.loadQueueTasks("1");
  assert.notEqual(old, fresh);
  jobs[0].resolve([]);
  await old; await tick();
  assert.equal(c.loadQueueTasks("1"), fresh);
  jobs[1].resolve([]);
  await fresh;
});

test("queue shows task dates and names, excludes completed tasks and escapes titles", () => {
  const c = setup();
  const html = c.queueTaskSummary([{ Subject: '<script>"', Due_Date: "2000-01-01", Owner: { name: "Owner" } }, { Subject: "Done", Status: "Completed", Due_Date: "2000-01-01" }]);
  assert.match(html, /1 JAN, 00/);
  assert.match(html, /task-date-tag--overdue/);
  assert.match(html, /&lt;script>&quot;/);
  assert.doesNotMatch(html, /Done|<script>/);
  assert.match(c.queueTaskSummary([]), /0 open/);
});

test("queue task loading limits concurrency, shares pending reads and retries failures", async () => {
  const jobs = [];
  const c = setup({ loadBookingTasks: id => new Promise((resolve, reject) => jobs.push({ id, resolve, reject })) });
  const first = c.loadQueueTasks("1");
  assert.equal(c.loadQueueTasks("1"), first);
  const all = [first, c.loadQueueTasks("2"), c.loadQueueTasks("3"), c.loadQueueTasks("4")];
  const result = Promise.allSettled(all);
  assert.equal(jobs.length, 3);
  jobs[0].reject(new Error("Denied"));
  await tick();
  assert.equal(jobs.length, 4);
  jobs.slice(1).forEach(job => job.resolve([]));
  await result;
  await tick();
  const retry = c.loadQueueTasks("1");
  assert.equal(jobs.length, 5);
  jobs[4].resolve([]);
  await retry;
});

test("queue cells distinguish failures from zero and ignore removed rows", async () => {
  const c = setup();
  const state = {};
  const cells = ["1", "2", "3"].map(id => ({ dataset: { queueTasks: id }, isConnected: id !== "3", querySelector: () => null }));
  c.observeQueueTaskCells({ querySelectorAll: () => cells }, state, async id => {
    if (id === "2") throw new Error("Denied");
    return [];
  });
  await tick();
  assert.match(cells[0].innerHTML, /0 open/);
  assert.equal(state.queueTaskCounts["1"], 0);
  assert.equal(cells[1].textContent, "Tasks unavailable");
  assert.equal(state.queueTaskCounts["2"], undefined);
  assert.equal(cells[2].innerHTML, undefined);
});


test("queue shows two earliest open tasks and puts only the remainder in the preview", () => {
  const c = setup();
  const tasks = [
    { Subject: "Undated" },
    { Subject: "Second", Due_Date: "2099-10-13" },
    { Subject: "Done", Status: "Completed", Due_Date: "2000-01-01" },
    { Subject: "Third", Due_Date: "2099-10-14" },
    { Subject: "First", Due_Date: "2099-10-12" }
  ];
  const html = c.queueTaskSummary(tasks);
  const [visible, preview] = html.split('<template');
  assert.equal((visible.match(/class="queue-task-row"/g) || []).length, 2);
  assert.ok(visible.indexOf('First') < visible.indexOf('Second'));
  assert.match(visible, /12 OCT, 99/);
  assert.match(visible, />\+2<\/button>/);
  assert.doesNotMatch(visible, /Third|Undated|Done/);
  assert.match(preview, /Third/);
  assert.match(preview, /Undated/);
  assert.match(preview, /task-date-tag--muted/);
  assert.doesNotMatch(preview, /First|Second|Done/);
  assert.doesNotMatch(c.queueTaskSummary(tasks.slice(0, 2)), /queue-tasks-more|<template/);
});

test("more tasks preview opens on hover and focus outside the cell and closes cleanly", () => {
  const listeners = {};
  const button = { addEventListener: (name, fn) => { listeners[name] = fn; }, setAttribute(name, value) { this[name] = value; }, getBoundingClientRect: () => ({ left: 950, bottom: 790 }) };
  let popup;
  const document = {
    body: { appendChild: node => { popup = node; } },
    createElement: () => ({ style: {}, setAttribute() {}, addEventListener() {}, getBoundingClientRect: () => ({ width: 400, height: 200 }), remove() { this.removed = true; } }),
    addEventListener() {}, removeEventListener() {}
  };
  const window = { innerWidth: 1000, innerHeight: 800, addEventListener() {}, removeEventListener() {} };
  const c = setup({ document, window, clearTimeout, setTimeout });
  const cell = { isConnected: true, querySelector: selector => selector === '.queue-tasks-more' ? button : { innerHTML: '<span>Third task</span>' } };
  const close = c.bindQueueTaskPreview(cell);
  listeners.mouseenter();
  assert.equal(popup.innerHTML, '<span>Third task</span>');
  assert.equal(button['aria-expanded'], 'true');
  assert.equal(popup.style.left, '592px');
  assert.equal(popup.style.top, '592px');
  let stopped = false;
  listeners.click({ preventDefault() {}, stopPropagation() { stopped = true; } });
  assert.equal(stopped, true, 'click must not select the booking');
  close();
  assert.equal(popup.removed, true);
  assert.equal(button['aria-expanded'], 'false');
  listeners.focus();
  assert.equal(button['aria-expanded'], 'true');
  listeners.blur();
  assert.equal(button['aria-expanded'], 'false');
});
