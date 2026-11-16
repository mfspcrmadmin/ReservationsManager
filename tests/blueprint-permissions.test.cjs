const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, '../app/js', name), 'utf8');
const permissions = read('blueprint-permissions.js').replace(/export /g, '');
const controller = read('booking-controller.js');
function extract(name) {
  const start = controller.indexOf('async function ' + name + '(') >= 0
    ? controller.indexOf('async function ' + name + '(') : controller.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name);
  const tail = controller.slice(start);
  return tail.slice(0, tail.search(/\r?\n}/) + (tail.includes('\r\n') ? 3 : 2));
}
const action = { id: '616617000135728065', name: 'FID Sent', fields: [], color_code: '#2385ef' };
const native = transitions => ({ blueprint: { process_info: { field_value: 'All Services Confirmed', current_picklist: { colour_code: '#0f766e' } }, transitions } });
function fixture(response = native([action])) {
  const reads = [], effects = [], renders = [];
  const state = { selectedBookingId: '616617000166482045', bookingWorkspaceRequestId: 1,
    currentUserId: 'user', currentUserEmail: 'user@example.com', currentUserName: 'Rep',
    bookingBlueprint: { processInfo: { field_value: 'All Services Confirmed' }, transitions: [action] } };
  const context = vm.createContext({ setTimeout, clearTimeout, state, elements: {}, MODULES: { bookings: 'Deals' },
    ZOHO: { CRM: { API: { getBluePrint: async config => {
      reads.push(config);
      return typeof response === 'function' ? response() : response;
    } } } },
    crmExecuteFunction: async () => { effects.push('execute'); return { success: true }; },
    saveEzusBookingDetails: async () => { effects.push('save'); return {}; },
    validateCreateInEzusAgency: async () => {}, isCreateEzusTransition: () => false,
    extractFunctionPayload: value => value, getBlueprintFailureDetails: () => [],
    renderBookingSummary: () => renders.push(state.bookingBlueprint),
    setBlueprintTransitionButtonsBusy() {}, setError() {},
    loadBookingWorkspace: async () => effects.push('refresh')
  });
  vm.runInContext(permissions + '\n' + ['loadBookingBlueprintForBooking', 'normalizeBookingBlueprintPayload', 'executeBlueprintTransition'].map(extract).join('\n'), context);
  return { context, state, reads, effects, renders,
    run: () => context.executeBlueprintTransition(action, {}, state.selectedBookingId, {}) };
}

test('each user receives only their native manual transitions; IDs remain strings', async () => {
  for (const authorized of [[action], []]) {
    const f = fixture(native([...authorized, { id: 'auto', type: 'automatic' }]));
    const result = await f.context.loadBookingBlueprintForBooking(f.state.selectedBookingId);
    assert.deepEqual(JSON.parse(JSON.stringify(f.reads)), [{ Entity: 'Deals', RecordID: '616617000166482045' }]);
    assert.deepEqual(Array.from(result.transitions, item => item.id), authorized.map(item => item.id));
    assert.equal(f.effects.length, 0);
  }
});

test('permission failures and malformed responses never fall back to the connection owner', async () => {
  for (const response of [{ code: 'NO_PERMISSION', message: 'Denied' }, null, {},
    { blueprint: { transitions: [] } }, native([null]), native([{ name: 'No ID' }]),
    () => { throw new Error('Offline'); }]) {
    const f = fixture(response);
    await assert.rejects(f.run());
    assert.deepEqual(f.effects, []);
    assert.equal(f.state.bookingBlueprint, null);
    assert.ok(f.state.bookingBlueprintError);
    assert.equal(f.state.bookingBlueprintExecuting, false);
    assert.equal(f.renders.length, 1);
  }
});

test('permission revocation and unmet criteria block all saves and execution', async () => {
  for (const transitions of [[], [{ ...action, criteria_matched: false }], [{ ...action, type: 'automatic' }]]) {
    const f = fixture(native(transitions));
    await assert.rejects(f.run(), /no longer available/);
    assert.deepEqual(f.effects, []);
    assert.equal(f.state.bookingBlueprint, null);
  }
});

test('native permissions are rechecked before every execution and before any save', async () => {
  const f = fixture();
  await f.run();
  await f.run();
  assert.equal(f.reads.length, 2);
  assert.deepEqual(f.effects, ['save', 'execute', 'refresh', 'save', 'execute', 'refresh']);
});

test('stage changes while the dialog is open block saves', async () => {
  const response = native([action]);
  response.blueprint.process_info.field_value = 'FID Sent';
  const f = fixture(response);
  await assert.rejects(f.run(), /stage changed/);
  assert.deepEqual(f.effects, []);
});

test('late permission checks cannot overwrite another booking or a newer workspace for the same booking', async () => {
  for (const switchBooking of [true, false]) {
    let finish;
    const f = fixture(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.run();
    const newer = { processInfo: { field_value: 'New workspace' }, transitions: [] };
    f.state.bookingWorkspaceRequestId++;
    if (switchBooking) f.state.selectedBookingId = 'other';
    f.state.bookingBlueprint = newer;
    finish(native([action]));
    await assert.rejects(pending, /selected booking changed/);
    assert.equal(f.state.bookingBlueprint, newer);
    assert.deepEqual(f.effects, []);
    assert.equal(f.renders.length, 0);
  }
});

test('a missing SDK and a timed out permission check fail closed', async () => {
  const f = fixture();
  await assert.rejects(f.context.loadUserBlueprint('Deals', '1', {}), /permissions/);
  await assert.rejects(f.context.loadUserBlueprint('Deals', '1', { getBluePrint: () => new Promise(() => {}) }, 5), /timed out/);
});

test('color enrichment preserves the native permissions and uses only matching IDs', () => {
  const f = fixture();
  const nativeAction = { id: action.id, name: 'Native name', criteria_matched: false, fields: [] };
  const result = f.context.applyBlueprintTransitionColors([nativeAction], [
    { id: action.id, color_code: '#ffda62', text_color_code: '#123456', name: 'Other name', criteria_matched: true, fields: [{ api_name: 'Extra' }] },
    { id: 'unauthorized', color_code: '#ff0000' }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), [{ ...nativeAction, color_code: '#ffda62', text_color_code: '#123456' }]);
});

test('stage color comes from the same Zoho state without replacing native state data', () => {
  const f = fixture();
  const process = { id: 'bp', field_value: 'On Tour', current_picklist: { value: 'On Tour' } };
  const metadata = { id: 'bp', field_value: 'On Tour', current_picklist: { value: 'Wrong label', colour_code: '#ffda62' } };
  const result = f.context.applyBlueprintStageColor(process, metadata);
  assert.equal(result.current_picklist.colour_code, '#ffda62');
  assert.equal(result.current_picklist.value, 'On Tour');
  assert.equal(f.context.applyBlueprintStageColor(process, { ...metadata, field_value: 'FID Sent' }), process);
  assert.equal(f.context.applyBlueprintStageColor(process, { ...metadata, id: 'other' }), process);
});

test('native color aliases are preserved and take precedence over metadata', async () => {
  const f = fixture(native([{ id: action.id, colour_code: '#25b52a', text_colour_code: '#ffffff' }]));
  const result = await f.context.loadBookingBlueprintForBooking(f.state.selectedBookingId);
  assert.equal(result.transitions[0].color_code, '#25b52a');
  assert.equal(result.transitions[0].text_color_code, '#ffffff');
  assert.equal(f.effects.length, 0);
});

test('loading enriches missing SDK colors but execution permission checks skip metadata', async () => {
  const f = fixture(native([{ id: action.id, name: action.name }]));
  f.context.withTimeout = promise => promise;
  f.context.ZOHO_SDK_TIMEOUT_MS = 4000;
  f.context.extractFunctionPayload = value => value;
  f.context.getFunctionPayloadErrorDetails = () => null;
  const calls = [];
  f.context.crmExecuteFunction = async name => {
    calls.push(name);
    return { success: true, transitions: [{ ...action, color_code: '#ffda62' }, { id: 'unauthorized' }] };
  };
  const result = await f.context.loadBookingBlueprintForBooking(f.state.selectedBookingId);
  assert.equal(result.transitions.length, 1);
  assert.equal(result.transitions[0].color_code, '#ffda62');
  assert.deepEqual(calls, ['blueprint_getbookingblueprint']);
  await f.context.loadBookingBlueprintForBooking(f.state.selectedBookingId, false);
  assert.equal(calls.length, 1);
  f.context.crmExecuteFunction = async () => { throw new Error('Offline'); };
  const withoutColors = await f.context.loadBookingBlueprintForBooking(f.state.selectedBookingId);
  assert.equal(withoutColors.transitions.length, 1);
});
