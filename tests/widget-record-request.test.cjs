const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(response) {
  const calls = [];
  const context = vm.createContext({ window: { ZOHO: { CRM: {
    FUNCTIONS: { execute: async (...args) => { calls.push(args); if (response instanceof Error) throw response; return response; } },
    CONNECTION: { invoke: () => assert.fail('A shared browser connection must never be used') }
  } } } });
  vm.runInContext(fs.readFileSync('app/js/widget-record-request.js', 'utf8').replace(/^export /gm, ''), context);
  return { context, calls };
}

test('the existing authenticated record endpoint receives bounded data without URLs or identity headers', async () => {
  const expected = { status: 'success', details: { statusCode: 200, statusMessage: { data: [{ id: '123' }] } } };
  const f = setup({ code: 'success', details: { output: JSON.stringify(expected) } });
  const result = await f.context.invokeWidgetRecordRequest('Card_Purchases', '123', {
    url: 'https://untrusted.example/', method: 'PUT', headers: { Authorization: 'must-not-be-forwarded', 'If-Unmodified-Since': 'version' },
    parameters: { data: [{ id: '123', Supporting_Documents: [{ File_Id__s: 'file' }] }] }, crmAPIRequest: 'must-not-be-forwarded'
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), expected);
  const [name, request] = f.calls[0];
  assert.equal(name, 'widget_recordlease');
  const args = JSON.parse(request.arguments);
  assert.deepEqual(Object.keys(args).sort(), ['action', 'requestBody']);
  assert.equal(args.action, 'record_request');
  assert.deepEqual(JSON.parse(args.requestBody), { module: 'Card_Purchases', recordId: '123', method: 'PUT', payload: { id: '123', Supporting_Documents: [{ File_Id__s: 'file' }] }, modifiedTime: 'version' });
});

test('read requests send only the target and requested projection', async () => {
  const f = setup({ details: { output: '{"status":"success"}' } });
  await f.context.invokeWidgetRecordRequest('Communications', '123', { method: 'GET', parameters: { fields: 'Email_Attachments,Communication_Status' } });
  const data = JSON.parse(JSON.parse(f.calls[0][1].arguments).requestBody);
  assert.deepEqual(data, { module: 'Communications', recordId: '123', method: 'GET', fields: 'Email_Attachments,Communication_Status' });
});

test('outer SDK rejection cannot be replaced by a nested success', async () => {
  const failure = { status: 'error', code: 'NO_PERMISSION', details: { output: '{"status":"success"}' } };
  const f = setup(failure);
  assert.equal(await f.context.invokeWidgetRecordRequest('Card_Purchases', '123', { method: 'GET' }), failure);
  assert.equal(f.calls.length, 1);
});

test('file writes identify the supported field required by the published gateway', async () => {
  for (const [module, field] of [['Prepayment_Requests', 'Proforma_Attached'], ['Communications', 'Email_Attachments']]) {
    const f = setup({ details: { output: '{"status":"success"}' } });
    const payload = { id: '123', [field]: [{ File_Id__s: 'uploaded-file' }] };
    await f.context.invokeWidgetRecordRequest(module, '123', { method: 'PUT', parameters: { data: [payload] } });
    const data = JSON.parse(JSON.parse(f.calls[0][1].arguments).requestBody);
    assert.equal(data.fields, field);
    assert.deepEqual(data.payload, payload);
    assert.equal(f.calls.length, 1);
  }
});

test('missing SDK, malformed output and lost responses never retry or use a connection fallback', async () => {
  for (const response of [new Error('Lost response'), { details: { output: 'not-json' } }]) {
    const f = setup(response);
    await assert.rejects(f.context.invokeWidgetRecordRequest('Card_Purchases', '123', { method: 'PUT', parameters: { data: [{ id: '123' }] } }));
    assert.equal(f.calls.length, 1);
  }
  const f = setup({});
  delete f.context.window.ZOHO.CRM.FUNCTIONS;
  await assert.rejects(f.context.invokeWidgetRecordRequest('Card_Purchases', '123', { method: 'GET' }), /authenticated record API/);
  assert.equal(f.calls.length, 0);
});
