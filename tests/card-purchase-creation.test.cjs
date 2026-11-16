const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
function setup() {
  const storage = new Map(), writes = [], creations = [];
  const record = { id: '30', Booking: { id: '10' }, Boking_Service: { id: '20' }, Modified_Time: 'v1', Accounting_Status: 'Pending invoice', Supporting_Documents: [] };
  const c = vm.createContext({ window: { sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } } });
  vm.runInContext(fs.readFileSync(require.resolve('../app/js/card-purchase-creation.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''), c);
  const options = { payload: { Amount: 100 }, documents: [{ File_Id__s: 'upload1', file: { name: 'invoice.pdf', size: 123 } }], wait: async () => {},
    create: async payload => { creations.push(payload); return { details: { id: '30' } }; },
    request: async (id, payload) => {
      if (payload) { writes.push(payload); record.Supporting_Documents = [{ id: 'link1', File_Id__s: 'upload1' }]; return { code: 'SUCCESS' }; }
      return structuredClone(record);
    }
  };
  return { c, state: { currentUserId: 'user' }, record, storage, writes, creations, options };
}
test('lost attachment response is verified without recreating or repeating the write', async () => {
  const f = setup(), original = f.options.request;
  f.options.request = async (id, payload) => { const result = await original(id, payload); if (payload) throw Error('response lost'); return result; };
  assert.equal(await f.c.completeCardPurchaseCreation(f.state, '10', '20', f.options), '30');
  assert.equal(f.creations.length, 1); assert.equal(f.writes.length, 1);
  assert.match(f.c.cardPurchaseCreationSummary(f.c.pendingCardPurchaseCreation(f.state, '10', '20')), /ID 30.*Documents: confirmed/);
});

test('partial card results distinguish unknown creation, pending documents and unknown attachment saves', () => {
  const f = setup();
  assert.match(f.c.cardPurchaseCreationSummary({ phase: 'creating' }), /creation unconfirmed.*Check CRM/);
  assert.match(f.c.cardPurchaseCreationSummary({ phase: 'created', recordId: '30' }), /ID 30.*confirmation pending/);
  assert.match(f.c.cardPurchaseCreationSummary({ phase: 'attaching', recordId: '30' }), /save unconfirmed; retry checks the existing save/);
});
test('stale attachment readbacks survive reload and retry only verifies the same record', async () => {
  const f = setup();
  f.options.request = async (id, payload) => { if (payload) { f.writes.push(payload); throw Error('network'); } return structuredClone(f.record); };
  await assert.rejects(f.c.completeCardPurchaseCreation(f.state, '10', '20', f.options), /Retry verifies/);
  const freshState = { currentUserId: 'user' };
  await assert.rejects(f.c.completeCardPurchaseCreation(freshState, '10', '20', f.options), /retry only verifies/);
  assert.equal(f.creations.length, 1); assert.equal(f.writes.length, 1);
  f.record.Supporting_Documents = [{ File_Id__s: 'upload1' }];
  await f.c.completeCardPurchaseCreation(freshState, '10', '20', f.options);
  assert.equal(f.creations.length, 1); assert.equal(f.writes.length, 1);
});
test('failed read after creation resumes attachment saving on the existing ID', async () => {
  const f = setup(), original = f.options.request;
  f.options.request = async () => { throw Error('read unavailable'); };
  await assert.rejects(f.c.completeCardPurchaseCreation(f.state, '10', '20', f.options));
  f.options.request = original;
  await f.c.completeCardPurchaseCreation({ currentUserId: 'user' }, '10', '20', f.options);
  assert.equal(f.creations.length, 1); assert.equal(f.writes.length, 1);
});
test('lost create response and missing record ID block another creation across reload', async () => {
  for (const response of [null, new Error('response lost')]) {
    const f = setup();
    f.options.create = async () => { f.creations.push('create'); if (response instanceof Error) throw response; return response; };
    await assert.rejects(f.c.completeCardPurchaseCreation(f.state, '10', '20', f.options));
    await assert.rejects(f.c.completeCardPurchaseCreation({ currentUserId: 'user' }, '10', '20', f.options), /previous transaction creation could not be confirmed/);
    assert.equal(f.creations.length, 1); assert.equal(f.writes.length, 0);
  }
});
test('only an explicit attachment rejection allows another write on the existing record', async () => {
  const f = setup(), original = f.options.request;
  f.options.request = async (id, payload) => { if (payload) throw Object.assign(Error('permission'), { definitiveRejection: true }); return structuredClone(f.record); };
  await assert.rejects(f.c.completeCardPurchaseCreation(f.state, '10', '20', f.options), /permission/);
  f.options.request = original;
  await f.c.completeCardPurchaseCreation(f.state, '10', '20', f.options);
  assert.equal(f.creations.length, 1); assert.equal(f.writes.length, 1);
});
test('foreign records, processed transactions and unavailable storage block writes', async () => {
  for (const change of [{ Booking: { id: 'other' } }, { Accounting_Status: 'Purchase recorded' }, { Vendor_Payment: { id: 'paid' } }]) {
    const f = setup(); Object.assign(f.record, change);
    await assert.rejects(f.c.completeCardPurchaseCreation(f.state, '10', '20', f.options));
    assert.equal(f.writes.length, 0);
  }
  const f = setup(); f.c.window.sessionStorage.setItem = () => { throw Error('disabled'); };
  await assert.rejects(f.c.completeCardPurchaseCreation(f.state, '10', '20', f.options), /Recovery information/);
  assert.equal(f.creations.length, 0);
});
test('verification requires every requested document; unrelated files cannot confirm saving', () => {
  const f = setup();
  assert.equal(f.c.cardCreationDocumentsMatch([{ File_Id__s: 'unrelated' }], f.options.documents), false);
  assert.equal(f.c.cardCreationDocumentsMatch([], f.options.documents), false);
  assert.equal(f.c.cardCreationDocumentsMatch([{ File_Name__s: 'invoice.pdf', Size__s: 123 }], f.options.documents), true);
  assert.equal(f.c.cardCreationDocumentsMatch([{ File_Name__s: 'invoice.pdf', Size__s: 456 }], f.options.documents), false);
});
