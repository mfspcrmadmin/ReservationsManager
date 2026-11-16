const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const UUID = '12345678-1234-1234-1234-123456789abc';
function setup(handler) {
  const calls = [];
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync('app/js/client-consortia-api.js', 'utf8').replace(/^export /gm, ''), context);
  const api = context.createClientConsortiaApi({ requestId: () => UUID, execute: async (name, args) => {
    const outer = JSON.parse(args.arguments), route = JSON.parse(outer.requestBody), request = JSON.parse(route.requestBody);
    calls.push({ name, outer, route, request });
    return { code: 'success', details: { output: JSON.stringify(await handler(request, calls.length)) } };
  } });
  return { api, calls, context };
}
const preview = { success: true, error: false, saved: false, client_id: '91', review_token: 'review-v1', candidate: { Period_Status: 'Current Confirmed' } };
const complete = { success: true, error: false, saved: true, phase: 'complete', client_id: '91', request_id: UUID, operation_id: '901' };
test('preview and apply use only the authenticated gateway and require explicit confirmation', async () => {
  const f = setup(r => r.action === 'preview' ? preview : complete);
  const result = await f.api.preview('91', { action: 'add', consortiaId: '22', reason: 'Confirmed by agency', actor: 'forged', url: 'forged' });
  await assert.rejects(f.api.apply(result), /explicitly confirm/);
  await assert.rejects(f.api.apply({ ...result }, { confirmed: true }), /Preview/);
  result.review_token = 'forged'; result.candidate.Period_Status = 'Historical';
  await f.api.apply(result, { confirmed: true });
  const call = f.calls[1];
  assert.equal(call.name, 'widget_recordlease'); assert.equal(call.outer.action, 'widget_operation');
  assert.equal(call.route.operation, 'client_consortia_manage'); assert.equal(call.request.reviewToken, 'review-v1');
  assert.equal(call.request.change.actor, undefined); assert.equal(call.request.change.url, undefined);
  assert.equal(call.request.crmAPIRequest, undefined); assert.equal(f.api.pending('91'), null);
  await assert.rejects(f.api.apply(result, { confirmed: true }), /Preview/);
  assert.equal(f.calls.length, 2);
});
test('lost mutation response retains its request ID and blocks replay until status confirms completion', async () => {
  const f = setup(r => { if (r.action === 'preview') return preview; if (r.action === 'status') return { ...complete, operation_version: 'v2' }; throw new Error('Lost response'); });
  const review = await f.api.preview('91', { action: 'add', consortiaId: '22', reason: 'Test' });
  let operation;
  await assert.rejects(f.api.apply(review, { confirmed: true }), e => { operation = e.operation; return e.uncertain === true; });
  assert.equal(operation.requestId, UUID);
  await assert.rejects(f.api.synchronize('91'), /unresolved/); assert.equal(f.calls.length, 2);
  await f.api.status(operation); assert.equal(f.calls.length, 3); assert.equal(f.api.pending('91'), null);
});
test('explicit pre-write rejection permits a new preview, while partial results remain blocked', async () => {
  for (const uncertain of [false, true]) {
    const f = setup(() => ({ success: false, error: true, saved: false, uncertain, message: 'Validation or checkpoint failure' }));
    await assert.rejects(f.api.synchronize('91'), e => e.uncertain === uncertain);
    assert.equal(Boolean(f.api.pending('91')), uncertain); assert.equal(f.calls.length, 1);
  }
});
test('mismatched operation identities and contradictory success never unlock a pending change', async () => {
  for (const response of [{ ...complete, client_id: '92' }, { ...complete, request_id: 'other' }, { ...complete, error: true }, { ...complete, code: 'ERROR' }, { ...complete, status: 'error' }, { ...complete, operation_id: null }]) {
    const f = setup(() => response);
    await assert.rejects(f.api.synchronize('91'), e => e.uncertain === true);
    assert.ok(f.api.pending('91')); assert.equal(f.calls.length, 1);
  }
});
test('concurrent mutations for one client are rejected without a second CRM call', async () => {
  let resolve;
  const f = setup(() => new Promise(r => { resolve = r; }));
  const first = f.api.synchronize('91');
  await assert.rejects(f.api.synchronize('91'), /in progress/);
  resolve(complete); await first; assert.equal(f.calls.length, 1);
});
test('reconciliation requires a matching fresh status and sends its exact version', async () => {
  const f = setup(() => complete);
  await assert.rejects(f.api.reconcile({ clientId: '91', requestId: UUID }, { client_id: '92', request_id: UUID, operation_version: 'v1' }), /current status/);
  await f.api.reconcile({ clientId: '91', requestId: UUID }, { client_id: '91', request_id: UUID, operation_version: 'v2' });
  assert.equal(f.calls[0].request.expectedOperationVersion, 'v2'); assert.equal(f.calls[0].request.action, 'reconcile');
});
test('reserved authentication context and numeric IDs are rejected locally', async () => {
  const f = setup(() => preview);
  await assert.rejects(f.api.preview('91', { action: 'add', crmAPIRequest: '{}' }), /authenticated identity/);
  await assert.rejects(f.api.read(91), /ID string/); assert.equal(f.calls.length, 0);
});
test('outer SDK rejection is not replaced by a nested success', async () => {
  const context = setup(() => complete).context;
  const api = context.createClientConsortiaApi({ requestId: () => UUID, execute: async () => ({ code: 'ERROR', details: { output: JSON.stringify(complete) } }) });
  await assert.rejects(api.synchronize('91'), e => e.uncertain === true);
});
