const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

function harness(response) {
  const calls = [];
  const context = vm.createContext({ recordEditLocks: require("./helpers/record-edit-locks.cjs"), MODULES: { cardPurchases: 'Card_Purchases' },
    invokeWidgetRecordRequest: async (...args) => { calls.push(args); return response; } });
  vm.runInContext(fs.readFileSync(require.resolve('../app/js/card-purchase-api.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''), context);
  return { calls, request: context.requestCardPurchaseV8 };
}

test('file updates use v8, an object body, workflow and concurrency header', async () => {
  const h = harness({ code: 'SUCCESS', details: { statusCode: 200, statusMessage: JSON.stringify({ data: [{ code: 'SUCCESS' }] }) } });
  const payload = { id: '10', Supporting_Documents: [{ File_Id__s: 'upload' }, { id: 'link', _delete: null }] };
  await h.request('10', payload, '2026-10-16T12:00:00+02:00');
  const [module, id, request] = h.calls[0];
  assert.equal(module, 'Card_Purchases');
  assert.equal(id, '10');
  assert.equal(request.url, 'https://www.zohoapis.eu/crm/v8/Card_Purchases/10');
  assert.equal(request.method, 'PUT');
  assert.equal(request.param_type, 2);
  assert.equal(request.headers['If-Unmodified-Since'], '2026-10-16T12:00:00+02:00');
  assert.equal(request.parameters.data[0], payload);
  assert.equal(request.parameters.trigger[0], 'workflow');
});

test('v8 reads require the requested record and reject nested failures', async () => {
  const h = harness({ details: { statusMessage: { data: [{ id: '10', Supporting_Documents: [] }] } } });
  assert.equal((await h.request('10')).id, '10');
  assert.equal(h.calls[0][2].method, 'GET');
  for (const response of [
    { code: 'NO_PERMISSION' },
    { code: 'SUCCESS', details: { statusCode: 403, statusMessage: { code: 'OAUTH_SCOPE_MISMATCH' } } },
    { data: [{ status: 'error', code: 'INVALID_DATA' }] },
    { data: [{ id: '99' }] }, {},
  ]) await assert.rejects(harness(response).request('10'));
});

test('only explicit CRM rejections mark an attachment write safe to correct and retry', async () => {
  await assert.rejects(harness({ data: [{ status: 'error', code: 'NO_PERMISSION' }] }).request('10', {}), error => error.definitiveRejection === true);
  await assert.rejects(harness({}).request('10', {}), error => error.definitiveRejection === false);
});
