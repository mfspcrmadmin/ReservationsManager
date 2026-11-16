const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

function setup() {
  const fixture = { files: [], calls: [], uploads: 0 };
  const context = vm.createContext({ recordEditLocks: require("./helpers/record-edit-locks.cjs"),
    MODULES: { prepaymentRequests: 'Prepayment_Requests' },
    setTimeout: callback => callback(),
    crmGetRecord: () => assert.fail('Document reads must use v8'),
    crmUpdateRecord: () => assert.fail('Document writes must use v8'),
    window: { ZOHO: { CRM: {
      API: { uploadFile: async request => {
        fixture.uploads++;
        fixture.file = request.FILE.file;
        return { data: [{ code: 'SUCCESS', details: { id: 'uploaded-id' } }] };
      } },
    } } },
      invokeWidgetRecordRequest: async (module, recordId, request) => {
        fixture.calls.push(structuredClone(request));
        assert.equal(module, 'Prepayment_Requests');
        assert.equal(recordId, 'request1');
        assert.equal(request.url, 'https://www.zohoapis.eu/crm/v8/Prepayment_Requests/request1');
        if (request.method === 'PUT') {
          assert.equal(request.param_type, 2);
          const changes = request.parameters.data[0].Proforma_Attached;
          assert.equal(changes[0].File_Id__s, 'uploaded-id');
          assert.equal(Object.hasOwn(changes[0], 'file'), false, 'Local metadata must not reach CRM');
          if (fixture.reject) return { code: 'SUCCESS', details: { statusCode: 403,
            statusMessage: JSON.stringify({ code: 'NO_PERMISSION', message: 'Cannot update this field' }) } };
          if (!fixture.ignoreWrite) fixture.files.push({
            id: 'new-link', File_Id__s: 'different-stored-id',
            File_Name__s: fixture.file.name, Size__s: String(fixture.file.size)
          });
          if (fixture.loseResponse) { fixture.loseResponse = false; throw Error('Lost response'); }
          return { code: 'SUCCESS', details: { statusCode: 200,
            statusMessage: JSON.stringify({ data: [{ code: 'SUCCESS' }] }) } };
        }
        assert.equal(request.parameters.fields, 'Proforma_Attached');
        return { code: 'SUCCESS', details: { statusCode: 200,
          statusMessage: JSON.stringify({ data: [{ id: 'request1', Proforma_Attached: fixture.files }] }) } };
      }
  });
  vm.runInContext(fs.readFileSync(require.resolve('../app/js/communication-attachments-api.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''), context);
  const controller = fs.readFileSync(require.resolve('../app/js/prepayments-controller.js'), 'utf8');
  vm.runInContext(controller.slice(controller.indexOf('export async function uploadFile(')).replace(/^export /gm, ''), context);
  return { fixture, context };
}

test('AENA document metadata survives upload and confirms a rotated v8 file ID', async () => {
  const { fixture, context } = setup();
  const documents = await context.uploadFile({ name: 'Datos Bancarios AENA.pdf', size: 238847, type: 'application/pdf' });
  const result = await context.savePrepaymentProforma('request1', documents);
  assert.equal(result[0].id, 'new-link');
  assert.deepEqual(fixture.calls.map(call => call.method), ['GET', 'PUT', 'GET']);
  assert.equal(fixture.uploads, 1);
});

test('lost v8 write response is reconciled without a second upload or write', async () => {
  const { fixture, context } = setup();
  fixture.loseResponse = true;
  const documents = await context.uploadFile({ name: 'document.pdf', size: 238847 });
  await assert.rejects(context.savePrepaymentProforma('request1', documents), /Lost response/);
  assert.equal((await context.savePrepaymentProforma('request1', documents)).length, 1);
  assert.equal(fixture.uploads, 1);
  assert.equal(fixture.calls.filter(call => call.method === 'PUT').length, 1);
});

test('an existing same-name same-size attachment cannot confirm an ignored write', async () => {
  const { fixture, context } = setup();
  fixture.ignoreWrite = true;
  fixture.files = [{ id: 'old-link', File_Name__s: 'document.pdf', Size__s: '238847' }];
  const documents = await context.uploadFile({ name: 'document.pdf', size: 238847 });
  await assert.rejects(context.savePrepaymentProforma('request1', documents), /did not confirm/);
  await assert.rejects(context.savePrepaymentProforma('request1', documents), /previous document save/);
  assert.equal(fixture.calls.filter(call => call.method === 'PUT').length, 1);
});

test('v8 permission rejection retains uploaded file for retry after access is corrected', async () => {
  const { fixture, context } = setup();
  fixture.reject = true;
  const documents = await context.uploadFile({ name: 'document.pdf', size: 238847 });
  await assert.rejects(context.savePrepaymentProforma('request1', documents), /NO_PERMISSION/);
  assert.equal(documents.saveState.pending, undefined);
  fixture.reject = false;
  assert.equal((await context.savePrepaymentProforma('request1', documents)).length, 1);
  assert.equal(fixture.uploads, 1);
});
