const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const read = file => fs.readFileSync(require('node:path').join(__dirname, '../app/js', file), 'utf8');
function extract(source, name) {
  const tail = source.slice(source.search(new RegExp('^(?:export )?(?:async )?function ' + name + '\\(', 'm'))).replace(/^export /, '');
  return tail.slice(0, tail.indexOf('\n}') + 2);
}
function setup(result = { code: 'SUCCESS' }) {
  const service = { id: '123', Status_EZUS: 'Pre-Paid', Payment_Status: 'To be paid' };
  const state = { selectedService: service, services: [service], servicePaymentStatusOptions: [{ value: 'Fully paid', label: 'Fully paid' }] };
  const writes = [], errors = [];
  const context = vm.createContext({ state, elements: { fieldPaymentStatus: { value: 'Fully paid' } }, MODULES: { bookingServices: 'Booking_Services' },
    crmUpdateRecord: async (module, payload) => { writes.push(JSON.parse(JSON.stringify({ module, payload }))); return result; },
    showLoading() {}, clearLoading() {}, renderServicesWorkspace() {}, renderServicePaymentStatus() {}, setNotice() {}, setError: (_, message) => errors.push(message) });
  vm.runInContext('let paymentStatusOptionsRequest = null;\n' + ['onSelectedServicePaymentStatusChange', 'loadServicePaymentStatusOptions'].map(name => extract(read('services-controller.js'), name)).join('\n'), context);
  return { context, state, writes, errors };
}
test('payment status saves only Payment_Status without changing a legacy service status', async () => {
  const f = setup();
  await f.context.onSelectedServicePaymentStatusChange();
  assert.deepEqual(f.writes, [{ module: 'Booking_Services', payload: { id: '123', Payment_Status: 'Fully paid' } }]);
  assert.equal(f.state.selectedService.Status_EZUS, 'Pre-Paid');
  assert.equal(f.state.selectedService.Payment_Status, 'Fully paid');
});
test('rejected and unconfirmed saves keep the existing payment status', async () => {
  for (const response of [{ code: 'NO_PERMISSION', message: 'Denied' }, {}]) {
    const f = setup(response);
    await f.context.onSelectedServicePaymentStatusChange();
    assert.equal(f.state.selectedService.Payment_Status, 'To be paid');
    assert.equal(f.errors.length, 1);
  }
});
test('payment options use CRM actual values and display labels, excluding unused values', async () => {
  const f = setup();
  f.state.servicePaymentStatusOptions = [];
  f.context.crmGetFields = async module => {
    assert.equal(module, 'Booking_Services');
    return [{ api_name: 'Payment_Status', pick_list_values: [{ actual_value: 'Fully paid', display_value: 'Paid label' }, { actual_value: 'Old', type: 'unused' }] }];
  };
  await f.context.loadServicePaymentStatusOptions();
  assert.deepEqual(JSON.parse(JSON.stringify(f.state.servicePaymentStatusOptions)), [{ value: 'Fully paid', label: 'Paid label' }]);
});
test('both service status dropdowns exclude payment-only states', () => {
  const constants = vm.createContext({});
  vm.runInContext(read('constants.js').replace(/^export /gm, '') + '\nthis.options = STATUS_OPTIONS;', constants);
  for (const value of ['Pre-Paid', 'Partially Pre-Paid', 'Pre-Payment Requested']) assert.equal(constants.options.includes(value), false);
  const render = read('render.js');
  assert.match(extract(render, 'populateStatusOptions'), /STATUS_OPTIONS\.map/);
});


test('payment selection coalesces concurrent requests and ignores the saved value', async () => {
  const f = setup();
  let finish;
  f.context.crmUpdateRecord = async (_, payload) => { f.writes.push(payload); return new Promise(resolve => { finish = resolve; }); };
  const first = f.context.onSelectedServicePaymentStatusChange();
  await f.context.onSelectedServicePaymentStatusChange();
  assert.equal(f.writes.length, 1);
  assert.equal(f.state.servicePaymentStatusSaving, true);
  finish({ code: 'SUCCESS' }); await first;
  await f.context.onSelectedServicePaymentStatusChange();
  assert.equal(f.writes.length, 1);
  assert.equal(f.state.servicePaymentStatusSaving, false);
});

test('CRM empty option retains its exact value and remains clearable', async () => {
  const f = setup(); f.state.servicePaymentStatusOptions = [];
  f.context.crmGetFields = async () => [{ api_name: 'Payment_Status', pick_list_values: [{ actual_value: '', display_value: '-None-' }] }];
  await f.context.loadServicePaymentStatusOptions();
  assert.equal(f.state.servicePaymentStatusOptions[0].value, '');
  f.context.elements.fieldPaymentStatus.value = '';
  await f.context.onSelectedServicePaymentStatusChange();
  assert.equal(f.writes[0].payload.Payment_Status, '');
});

test('service Status restores the saved value on failure and rejects duplicate submissions', async () => {
  for (const result of [{ code: 'SUCCESS' }, { code: 'DENIED' }, {}]) {
    const service = { id: '123', Status_EZUS: 'Confirmed', Service_Notes: 'Original' };
    const state = { selectedService: service, serviceStatusDraftValue: 'Cancelled' };
    const select = { value: 'Cancelled', dataset: {} };
    let writes = 0, finish;
    const errors = [];
    const context = vm.createContext({ state, elements: { fieldStatusEzus: select, fieldServiceNotes: { value: 'Original' } }, MODULES: { bookingServices: 'Booking_Services' },
      crmUpdateRecord: async () => { writes++; return new Promise(resolve => { finish = resolve; }); },
      showLoading() {}, clearLoading() {}, renderServicesWorkspace() {}, playServiceStatusSavedFeedback() {}, applyStatusSelectAppearance() {}, setNotice() {}, setError: (_, message) => errors.push(message) });
    vm.runInContext(extract(read('services-controller.js'), 'onSaveService'), context);
    const first = context.onSaveService({ preventDefault() {} });
    await context.onSaveService({ preventDefault() {} });
    assert.equal(writes, 1);
    finish(result); await first;
    assert.equal(state.serviceStatusSaving, false);
    assert.equal(service.Status_EZUS, result.code === 'SUCCESS' ? 'Cancelled' : 'Confirmed');
    if (result.code !== 'SUCCESS') { assert.equal(select.value, 'Confirmed'); assert.equal(state.serviceStatusDraftValue, ''); assert.equal(errors.length, 1); }
  }
});
