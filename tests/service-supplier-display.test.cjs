const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const read = name => fs.readFileSync(require('node:path').join(__dirname, '../app/js', name), 'utf8');
const context = vm.createContext({ Intl });
vm.runInContext(read('utils.js').replace(/^export /gm, '') + '\n' + read('table-sorting.js').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''), context);

test('supplier display requires a linked record and never falls back to text', () => {
  for (const Supplier of [undefined, null, {}, { name: 'Unlinked name' }, { id: ' ', name: 'Unlinked name' }, 'Text only']) {
    assert.equal(context.getServiceSupplierName({ Supplier, Supplier_Name: 'Golf supplier' }), 'No supplier linked');
  }
  assert.equal(context.getServiceSupplierName({ Supplier: { id: '123', name: 'Linked provider' }, Supplier_Name: 'Stale name' }), 'Linked provider');
  assert.equal(context.getServiceSupplierName({ Supplier: { id: '123' }, Supplier_Name: 'Stale name' }), 'Linked supplier');
});

test('supplier sorting uses the same linked name as the visible service', () => {
  const service = { Supplier: { id: '123', name: 'Linked provider' }, Supplier_Name: 'Stale name' };
  assert.equal(context.serviceSortValue(service, 'supplier', {}), 'Linked provider');
  assert.equal(context.serviceSortValue({ Supplier_Name: 'Golf supplier' }, 'supplier', {}), 'No supplier linked');
});
