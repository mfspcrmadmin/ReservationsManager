const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function setup() {
  const ctx = vm.createContext({ escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;') });
  for (const file of ['workflow-operation-api', 'workflow-recovery']) vm.runInContext(fs.readFileSync('app/js/' + file + '.js', 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''), ctx);
  return ctx;
}
function mock(responses) {
  const calls = [];
  const crm = { FUNCTIONS: { execute: async (name, config) => {
    calls.push([name, JSON.parse(config.arguments)]);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return { code: 'SUCCESS', details: { output: JSON.stringify(next) } };
  } } };
  return { calls, crm };
}
const pending = { error: true, partial: true, operation_pending: true, checkpoint_confirmed: true, operation_id: '99', booking_id: '123' };
function request(call) { return JSON.parse(JSON.parse(call[1].requestBody).requestBody); }
test('confirmed phases resume the same journal without replaying the start request', async () => {
  const f = mock([pending, pending, { error: false }]);
  await setup().executeWorkflowOperation(f.crm, { action: 'prepare_start', bookingId: '123', is_administrator: true, actor: 'forged', url: 'evil' });
  assert.deepEqual(f.calls.map(call => request(call).action), ['prepare_start', 'resume', 'resume']);
  assert.deepEqual(request(f.calls[0]), { action: 'prepare_start', bookingId: '123' });
  assert.equal(request(f.calls[1]).operationId, '99');
});
test('unknown, lost, malformed, or mismatched results never trigger another request', async () => {
  for (const result of [new Error('network'), { error: true, message: 'Unknown' }, { ...pending, checkpoint_confirmed: false },
    { ...pending, booking_id: '999' }, { ...pending, operation_id: 'bad' }, { ...pending, code: 'DENIED' }, {}, 'invalid json']) {
    const f = mock([result, { error: false }]);
    await assert.rejects(setup().executeWorkflowOperation(f.crm, { action: 'resume', bookingId: '123', operationId: '99' }));
    assert.equal(f.calls.length, 1);
  }
});
test('outer rejection cannot authorize a nested continuation', async () => {
  let calls = 0;
  const crm = { FUNCTIONS: { execute: async () => { calls++; return { code: 'DENIED', details: { output: JSON.stringify(pending) } }; } } };
  await assert.rejects(setup().executeWorkflowOperation(crm, { action: 'resume', bookingId: '123' }));
  assert.equal(calls, 1);
});
test('journal identity remains fixed and a lost continuation stops immediately', async () => {
  for (const second of [{ ...pending, operation_id: '100' }, new Error('lost')]) {
    const f = mock([pending, second, { error: false }]);
    await assert.rejects(setup().executeWorkflowOperation(f.crm, { action: 'resume', bookingId: '123', operationId: '99' }));
    assert.equal(f.calls.length, 2);
  }
});
test('sync entry preserves Map versus String contracts and continues through recovery', async () => {
  for (const name of ['syncprojectfromezus', 'sync_runprojectfromezus']) {
    const f = mock([pending, { error: false }]);
    await setup().executeRecoverableFunction(f.crm, name, { bookingId: '123', syncType: 'services', args: { options: { skipDeletes: true } } });
    const args = f.calls[0][1].args;
    assert.equal(typeof args, name === 'sync_runprojectfromezus' ? 'object' : 'string');
    const options = typeof args === 'string' ? JSON.parse(args) : args;
    assert.equal(options.execution_mode, 'step'); assert.equal(options.options.skipDeletes, true);
    assert.equal(f.calls[1][0], 'widget_recordlease'); assert.equal(request(f.calls[1]).action, 'resume');
  }
});
test('late status cannot replace another workspace and errors stay distinct from an empty list', async () => {
  const ctx = setup(); let resolve, state = { bookingId: '123', workspaceId: 1 };
  const host = { innerHTML: '', addEventListener() {} };
  const api = ctx.createWorkflowRecovery({ host, getContext: () => state, execute: () => new Promise(r => resolve = r) });
  const task = api.load(); state = { bookingId: '456', workspaceId: 2 };
  resolve({ error: false, operations: [{ operation_id: '99', kind: 'evil' }] }); await task;
  assert.doesNotMatch(host.innerHTML, /evil/);
  const failed = ctx.createWorkflowRecovery({ host, getContext: () => state, execute: async () => { throw Error('Status unavailable'); } });
  await failed.load(); assert.match(host.innerHTML, /Status unavailable/); assert.doesNotMatch(host.innerHTML, /No pending/);
});
test('resume preflight is serialized, protects edits, and review never resumes automatically', async () => {
  const ctx = setup(); const calls = []; let release;
  const options = { host: { addEventListener() {} }, getContext: () => ({ bookingId: '123', workspaceId: 1 }),
    execute: async args => { const r = JSON.parse(args.requestBody); calls.push(r.action); return { error: false, operations: [] }; },
    beforeResume: () => new Promise(r => release = r) };
  const api = ctx.createWorkflowRecovery(options);
  const first = api.perform('resume', '99'); await api.perform('resume', '99'); assert.equal(calls.length, 0);
  release(); await first; assert.deepEqual(calls, ['resume', 'status']);
  calls.length = 0; await api.perform('review', '99', { reviewed: true, decision: 'retry' });
  assert.deepEqual(calls, ['review', 'status']);
  const blocked = ctx.createWorkflowRecovery({ ...options, beforeResume: async () => { throw Error('Unsaved edits'); } });
  calls.length = 0; await assert.rejects(blocked.perform('resume', '99'), /Unsaved/); assert.deepEqual(calls, ['status']);
});
test('refresh failure preserves confirmed completion in the message', async () => {
  const api = setup().createWorkflowRecovery({ host: { addEventListener() {} }, getContext: () => ({ bookingId: '123' }),
    execute: async () => ({ error: false, operations: [] }), refresh: async () => { throw Error('offline'); } });
  await assert.rejects(api.perform('resume', '99'), /operation completed.*could not be refreshed/);
});
test('markup escapes server text, orders phases, and respects server review permissions', () => {
  const html = setup().workflowRecoveryMarkup({ operations: [{ operation_id: '99', kind: 'project_preparation', initiator: '<script>',
    can_close: false, can_resume: false, phases: [{ phase: 'desk', state: 'Started', can_review: false }, { phase: 'project', state: 'Completed' }] }] });
  assert.match(html, /&lt;script>/); assert.doesNotMatch(html, /Review result|data-recovery-action="resume"|data-recovery-action="stop"/);
  assert.ok(html.indexOf('Confirm project') < html.indexOf('WorkDrive folder')); assert.ok(html.indexOf('WorkDrive folder') < html.indexOf('Desk ticket'));
  assert.match(html, /Not started/);
});
test('native assignment transition executes once while confirmed follow-up phases continue', async () => {
  const ctx = setup();
  vm.runInContext(fs.readFileSync('app/js/blueprint-native.js', 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''), ctx);
  const f = mock([pending, { error: false }]); let puts = 0;
  f.crm.API = { getBluePrint: async () => ({ blueprint: { process_info: { field_value: 'Quotation' }, transitions: [{ id: '456', name: 'Assign Reservation' }] } }),
    updateBluePrint: async () => { puts++; return { code: 'SUCCESS', status: 'success' }; } };
  const result = await ctx.executeNativeBlueprint({ moduleApiName: 'Deals', recordId: '123', transitionId: '456', expectedCurrentState: 'Quotation', actionUserJSON: JSON.stringify({ id: '7', email: 'user@example.com', name: 'User' }) }, f.crm);
  assert.equal(result.success, true); assert.equal(puts, 1); assert.deepEqual(f.calls.map(call => request(call).action), ['assignment_start', 'resume']);
});
test('spinner remains visible while closing, checking status, reviewing or resuming', () => {
  const ctx = setup();
  for (const pendingAction of ['stop', 'review', 'resume']) {
    const html = ctx.workflowRecoveryMarkup({ busy: true, pendingAction });
    assert.match(html, /workflow-recovery-spinner/); assert.match(html, /role="status"/);
    assert.match(html, /disabled/);
  }
  const html = ctx.workflowRecoveryMarkup({ loading: true, operations: [{ operation_id: '99', kind: 'sync_full', phases: [] }] });
  assert.match(html, /Checking status/); assert.match(html, /#99/);
});
test('final confirmation for another journal is rejected', async () => {
  const f = mock([{ success: true, operation_id: '100', stopped: true }]);
  await assert.rejects(setup().executeWorkflowOperation(f.crm, { action: 'stop', bookingId: '123', operationId: '99' }), /different recovery/);
  assert.equal(f.calls.length, 1);
});
test('close dialog keeps its exact target across reordered status, shows spinner and leaves the other recovery visible', async () => {
  const ctx = setup(), handlers = {}, calls = [], controls = [{ disabled: false }];
  let resolveStop, stopComplete = false;
  const submit = { disabled: false, innerHTML: '', textContent: '' }, feedback = {}, cancel = {};
  const form = { elements: { reviewed: { checked: true } }, setAttribute() {}, reportValidity: () => true,
    querySelector: () => submit, querySelectorAll: () => controls };
  const dialog = { innerHTML: '', className: '', setAttribute() {}, addEventListener(name, fn) { handlers['dialog-' + name] = fn; },
    querySelector(selector) {
      if (selector === 'form') return form;
      if (selector === '[data-feedback]') return feedback;
      if (selector === '[data-cancel]') return cancel;
      if (selector === 'select') return null;
      return { focus() {} };
    }, showModal() {}, close() { handlers['dialog-close'](); }, remove() {} };
  ctx.document = { activeElement: null, createElement: () => dialog, body: { appendChild() {} } };
  const host = { innerHTML: '', addEventListener(name, fn) { handlers[name] = fn; }, querySelectorAll: () => [], querySelector: () => null };
  const rows = ['99', '100'].map(operation_id => ({ operation_id, kind: 'sync_full', can_close: true, phases: [] }));
  const api = ctx.createWorkflowRecovery({ host, getContext: () => ({ bookingId: '123', workspaceId: 1 }),
    execute: async args => {
      const request = JSON.parse(args.requestBody); calls.push(request);
      if (request.action === 'stop') return new Promise(resolve => { resolveStop = resolve; });
      return { success: true, operations: stopComplete ? [rows[1]] : [...rows].reverse() };
    } });
  await api.load();
  handlers.click({ target: { closest: () => ({ disabled: false, dataset: { recoveryAction: 'stop', operationId: '99' } }) } });
  assert.match(dialog.innerHTML, /Recovery #99/); assert.match(dialog.innerHTML, /Booking #123/);
  await api.load();
  const task = form.onsubmit({ preventDefault() {} });
  assert.match(submit.innerHTML, /workflow-recovery-spinner.*Closing recovery/);
  assert.equal(submit.disabled, true); assert.equal(controls[0].disabled, true);
  assert.equal(calls.find(call => call.action === 'stop').operationId, '99');
  stopComplete = true; resolveStop({ success: true, operation_id: '99', stopped: true }); await task;
  assert.match(host.innerHTML, /#100/); assert.doesNotMatch(host.innerHTML, /#99/);
  assert.equal(calls.filter(call => call.action === 'stop').length, 1);
});
test('compact recovery highlights the uncertain step, folds the complete plan and separates close', () => {
  const html = setup().workflowRecoveryMarkup({ operations: [{ operation_id: '99', kind: 'sync_full', can_review: true, can_close: true, needs_review: true,
    phases: [{ phase: 'project', state: 'Completed' }, { phase: 'travelers', state: 'Uncertain', can_review: true }] }] });
  assert.match(html, /Review needed/);
  assert.match(html, /Travelers: check the result before continuing/);
  assert.match(html, /Review travelers/);
  assert.match(html, /Check travelers in CRM and Ezus/);
  assert.doesNotMatch(html, /mailboxes|in CRM, Ezus, Desk/);
  assert.match(html, /<details class="workflow-recovery-steps"[^>]*><summary>View all steps/);
  assert.match(html, /1 confirmed &middot; 3 not started/);
  assert.ok(html.indexOf('Review travelers') < html.indexOf('View all steps'));
  assert.ok(html.indexOf('workflow-recovery-footer') > html.indexOf('</details>'));
  assert.match(html, /Existing changes are kept/);
});
test('notification review directs the check to mailboxes and running work does not suggest retry', () => {
  const ctx = setup();
  const email = ctx.workflowRecoveryMarkup({ operations: [{ operation_id: '99', kind: 'reservation_notice', needs_review: true,
    phases: [{ phase: 'reservation', state: 'Uncertain', can_review: true }] }] });
  assert.match(email, /recipients' mailboxes/);
  const running = ctx.workflowRecoveryMarkup({ operations: [{ operation_id: '100', kind: 'sync_full', may_be_running: true, needs_review: true,
    phases: [{ phase: 'travelers', state: 'Started', can_review: false }] }] });
  assert.match(running, /May still be running/); assert.match(running, /Wait for the current step/);
  assert.doesNotMatch(running, /data-recovery-action="review"|allowing a retry/);
});
test('resume remains the primary permitted action when remaining steps are safe', () => {
  const html = setup().workflowRecoveryMarkup({ operations: [{ operation_id: '99', kind: 'sync_full', can_resume: true, can_close: false,
    phases: [{ phase: 'project', state: 'Completed' }] }] });
  assert.match(html, /Ready to resume/); assert.match(html, /Confirmed steps will be skipped/);
  assert.match(html, /data-recovery-action="resume"/); assert.doesNotMatch(html, /data-recovery-action="stop"/);
});
