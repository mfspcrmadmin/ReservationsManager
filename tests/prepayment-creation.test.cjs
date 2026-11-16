const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
function fixture() {
  const storage = new Map(), calls = [], checked = [];
  const context = vm.createContext({ window: { sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } } });
  vm.runInContext(fs.readFileSync(require.resolve('../app/js/prepayment-creation.js'), 'utf8').replace(/^export /gm, ''), context);
  const state = { currentUserId: 'user' };
  const plan = { bookingId: 'booking', supplierId: 'supplier', newRequest: true, requestId: '', requestPayload: { Amount: 100 }, documents: [{ File_Id__s: 'file' }], serviceIds: ['service'], payments: [{ payload: { Amount: 40 } }, { payload: { Amount: 60 } }] };
  const dependencies = {
    create: async (module, payload) => { calls.push({ module, payload }); return { details: { id: 'id-' + calls.length } }; },
    preflight: async () => {}, checkRequest: async () => {}, saveDocuments: async () => {}, linkServices: async () => {},
    validatePayment: async () => {}, checkPayment: async id => checked.push(id)
  };
  const operation = context.beginPrepaymentCreation(state, plan);
  return { context, state, plan, operation, dependencies, calls, checked, storage };
}
test('partial validation failure resumes the original request and only uncreated payments after reload', async () => {
  const f = fixture(); let blocked = true;
  f.dependencies.validatePayment = async payment => { if (blocked && payment.payload.Amount === 60) throw Error('cutoff'); };
  await assert.rejects(f.context.runPrepaymentCreation(f.state, f.operation, f.dependencies), /cutoff/);
  assert.equal(f.calls.length, 2);
  assert.match(f.context.prepaymentCreationSummary(f.operation), /Request: confirmed in CRM.*Documents: confirmed.*Prepayments: 1\/2 recorded, 1 verified/);
  const state = { currentUserId: 'user' };
  const recovered = f.context.pendingPrepaymentCreation(state, 'booking', 'supplier');
  assert.match(f.context.prepaymentCreationSummary(recovered), /1\/2 recorded, 1 verified/);
  assert.equal(recovered.busy, false);
  blocked = false;
  await f.context.runPrepaymentCreation(state, recovered, f.dependencies);
  assert.equal(f.calls.length, 3);
  assert.deepEqual(f.calls.map(x => x.module), ['Prepayment_Requests', 'Prepayments', 'Prepayments']);
  assert.equal(f.calls[2].payload.Prepayment_Request.id, 'id-1');
});
test('lost request or payment creation responses never repeat creation after reload', async () => {
  for (const failModule of ['Prepayment_Requests', 'Prepayments']) {
    const f = fixture(), create = f.dependencies.create;
    f.dependencies.create = async (module, payload) => { const result = await create(module, payload); if (module === failModule) throw Error('response lost'); return result; };
    await assert.rejects(f.context.runPrepaymentCreation(f.state, f.operation, f.dependencies), /response lost/);
    const count = f.calls.length, state = { currentUserId: 'user' };
    const recovered = f.context.pendingPrepaymentCreation(state, 'booking', 'supplier');
    assert.match(f.context.prepaymentCreationSummary(recovered), /Unconfirmed creations: 1.*will not be created again/);
    await assert.rejects(f.context.runPrepaymentCreation(state, recovered, f.dependencies), /could not be confirmed/);
    assert.equal(f.calls.length, count);
  }
});
test('missing returned ID blocks recreation and concurrent attempts are rejected', async () => {
  const f = fixture();
  f.dependencies.create = async () => ({});
  await assert.rejects(f.context.runPrepaymentCreation(f.state, f.operation, f.dependencies), /did not return/);
  await assert.rejects(f.context.runPrepaymentCreation(f.state, f.operation, f.dependencies), /could not be confirmed/);
  const g = fixture(); let release;
  g.dependencies.preflight = () => new Promise(resolve => { release = resolve; });
  const first = g.context.runPrepaymentCreation(g.state, g.operation, g.dependencies);
  await assert.rejects(g.context.runPrepaymentCreation(g.state, g.operation, g.dependencies), /already being saved/);
  release(); await first;
  assert.equal(g.calls.length, 3);
});
test('uncertain service association is journaled and cannot create a duplicate after reload', async () => {
  const f = fixture();
  f.dependencies.linkServices = (id, operation, create) => create('Prepayment_Request_Services', { Booking_Service: { id: 'service' }, Prepayment_Request: { id } });
  const original = f.dependencies.create;
  f.dependencies.create = async (module, payload) => { const result = await original(module, payload); if (module === 'Prepayment_Request_Services') throw Error('link response lost'); return result; };
  await assert.rejects(f.context.runPrepaymentCreation(f.state, f.operation, f.dependencies));
  const state = { currentUserId: 'user' };
  await assert.rejects(f.context.runPrepaymentCreation(state, f.context.pendingPrepaymentCreation(state, 'booking', 'supplier'), f.dependencies), /service link/);
  assert.equal(f.calls.length, 2);
});
test('document uncertainty survives reload and resumes verification before any payment creation', async () => {
  const f = fixture(); let first = true;
  f.dependencies.saveDocuments = async (id, documents, state, persist) => {
    if (first) { state.pending = { fileIds: ['file'] }; persist(); throw Error('lost attachment'); }
    assert.equal(state.pending.fileIds[0], 'file');
  };
  await assert.rejects(f.context.runPrepaymentCreation(f.state, f.operation, f.dependencies));
  const state = { currentUserId: 'user' }, recovered = f.context.pendingPrepaymentCreation(state, 'booking', 'supplier');
  first = false;
  await f.context.runPrepaymentCreation(state, recovered, f.dependencies);
  assert.equal(f.calls.filter(x => x.module === 'Prepayment_Requests').length, 1);
  assert.equal(f.calls.length, 3);
});
test('pending operations block replacement; completion clears the journal and storage failure prevents mutations', async () => {
  const f = fixture();
  assert.throws(() => f.context.beginPrepaymentCreation(f.state, f.plan), /Resume the pending/);
  await f.context.runPrepaymentCreation(f.state, f.operation, f.dependencies);
  const count = f.calls.length;
  await f.context.runPrepaymentCreation(f.state, f.operation, f.dependencies);
  assert.equal(f.calls.length, count);
  f.context.finishPrepaymentCreation(f.state, f.operation);
  assert.equal(f.context.pendingPrepaymentCreation(f.state, 'booking', 'supplier'), null);
  const g = fixture();
  g.context.window.sessionStorage.setItem = () => { throw Error('storage unavailable'); };
  await assert.rejects(g.context.runPrepaymentCreation(g.state, g.operation, g.dependencies), /recovery could not be saved/);
  assert.equal(g.calls.length, 0);
});

test('only a provably unsent plan can be discarded, including after reload', async () => {
  const f = fixture(), reloaded = { currentUserId: 'user' };
  const recovered = f.context.pendingPrepaymentCreation(reloaded, 'booking', 'supplier');
  assert.equal(f.context.prepaymentCreationDisposition(recovered), 'draft');
  f.context.discardUnsentPrepaymentCreation(reloaded, recovered);
  assert.equal(f.context.pendingPrepaymentCreation(reloaded, 'booking', 'supplier'), null);
  assert.equal(f.calls.length, 0);
  for (const change of [
    { slots: { request: { id: 'created' } } }, { slots: { request: { id: '' } } },
    { persistenceAttempted: true }, { busy: true }, { recoveryVersion: undefined }, { complete: true }
  ]) {
    const g = fixture(); Object.assign(g.operation, change);
    assert.throws(() => g.context.discardUnsentPrepaymentCreation(g.state, g.operation), /saved or its save is unconfirmed/);
    assert.ok(g.context.pendingPrepaymentCreation(g.state, 'booking', 'supplier'));
  }
});

test('an existing-request write attempt cannot be discarded even if no payments were created', async () => {
  const f = fixture();
  f.operation.newRequest = false; f.operation.requestId = 'existing';
  f.dependencies.checkRequest = async () => { throw Error('requester save response lost'); };
  await assert.rejects(f.context.runPrepaymentCreation(f.state, f.operation, f.dependencies));
  assert.equal(f.calls.length, 0);
  assert.equal(f.context.prepaymentCreationDisposition(f.operation), 'recorded');
  assert.throws(() => f.context.discardUnsentPrepaymentCreation(f.state, f.operation));
});
