const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('app/js/blueprint-native.js', 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export async function', 'async function');
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync('app/js/workflow-operation-api.js', 'utf8').replace(/^export /gm, ''), ctx);
vm.runInContext(source, ctx);
const args = { moduleApiName: 'Deals', recordId: '123', transitionId: '456', expectedCurrentState: 'Quotation', actionUserJSON: JSON.stringify({ id: '7', email: 'user@example.com', name: 'User' }), transitionDataJson: JSON.stringify({ Notes: 'Original note' }) };
function setup(name = 'Move to In Progress') {
  const writes = [], functions = [];
  const crm = { API: {
    getBluePrint: async () => ({ blueprint: { process_info: { field_value: 'Quotation' }, transitions: [{ id: '456', name }] } }),
    updateBluePrint: async config => { writes.push(config); return { status: 'success', code: 'SUCCESS' }; }
  }, FUNCTIONS: { execute: async (...call) => { functions.push(call); return { details: { output: '{"error":false}' } }; } } };
  return { crm, writes, functions };
}
test('native session submits once, preserves Notes, and Move to In Progress has no extra notification', async () => {
  const f = setup();
  assert.equal((await ctx.executeNativeBlueprint(args, f.crm)).success, true);
  assert.equal(f.writes.length, 1);
  assert.match(f.writes[0].BlueprintData.blueprint[0].data.Notes, /^Original note\n\nWidget action requested by: User/);
  assert.equal(f.functions.length, 0);
});
test('changed state or denied transition never writes', async () => {
  for (const bp of [{ process_info: { field_value: 'Other' }, transitions: [{ id: '456' }] }, { process_info: { field_value: 'Quotation' }, transitions: [] }]) {
    const f = setup(); f.crm.API.getBluePrint = async () => ({ blueprint: bp });
    assert.equal((await ctx.executeNativeBlueprint(args, f.crm)).success, false);
    assert.equal(f.writes.length, 0);
  }
});
test('lost native response does not retry through OAuth', async () => {
  const f = setup(); f.crm.API.updateBluePrint = async () => { throw Error('network'); };
  const result = await ctx.executeNativeBlueprint(args, f.crm);
  assert.equal(result.success, false); assert.equal(result.transition_outcome_unknown, true);
  assert.equal(f.functions.length, 0);
});
test('reservation follow-up failure preserves completed transition status', async () => {
  const f = setup('Assign Reservation');
  f.crm.FUNCTIONS.execute = async () => ({ details: { output: '{"error":true,"message":"Desk failed"}' } });
  const result = await ctx.executeNativeBlueprint(args, f.crm);
  assert.equal(result.success, false); assert.equal(result.transition_completed, true);
  assert.match(result.message, /Desk failed/); assert.equal(f.writes.length, 1);
});
test('partial transition never executes assignment follow-up', async () => {
  const f = setup('Assign Reservation');
  f.crm.API.updateBluePrint = async () => ({ status: 'success', message: 'transition saved partially' });
  assert.equal((await ctx.executeNativeBlueprint(args, f.crm)).success, true);
  assert.equal(f.functions.length, 0);
});
test('project creation prepares WorkDrive and Desk before the native transition', async () => {
  const f = setup('Create Ezus Project');
  const id = '616617000135728037';
  const order = [];
  f.crm.API.getBluePrint = async () => ({ blueprint: { process_info: { field_value: 'Quotation' }, transitions: [{ id, name: 'Create Ezus Project' }] } });
  f.crm.FUNCTIONS.execute = async (name, config) => {
    order.push(name); assert.equal(name, 'widget_recordlease');
    const envelope = JSON.parse(JSON.parse(config.arguments).requestBody); const request = JSON.parse(envelope.requestBody); assert.equal(request.bookingId, '123'); assert.equal(request.action, 'prepare_start');
    return { details: { output: JSON.stringify({ error: false, project_confirmed: true, workdrive_completed: true, desk_completed: true }) } };
  };
  f.crm.API.getRecord = async () => { order.push('read'); return { data: [{ Ezus_Project_ID: 'linked', Booking_Workdrive_Folder_ID: 'folder' }] }; };
  f.crm.API.updateBluePrint = async () => { order.push('transition'); return { status: 'success', code: 'SUCCESS' }; };
  assert.equal((await ctx.executeNativeBlueprint({ ...args, transitionId: id }, f.crm)).success, true);
  assert.deepEqual(order, ['widget_recordlease', 'read', 'transition']);
});
test('failed project follow-up never moves the Blueprint or repeats project creation', async () => {
  for (const result of [{ error: true, message: 'Desk rejected' }, { error: false, project_confirmed: true, workdrive_completed: false, desk_completed: true }]) {
    const f = setup(); const id = '616617000135728037'; let calls = 0;
    f.crm.API.getBluePrint = async () => ({ blueprint: { process_info: { field_value: 'Quotation' }, transitions: [{ id }] } });
    f.crm.FUNCTIONS.execute = async name => { calls++; assert.equal(name, 'widget_recordlease'); return { details: { output: JSON.stringify(result) } }; };
    assert.equal((await ctx.executeNativeBlueprint({ ...args, transitionId: id }, f.crm)).success, false);
    assert.equal(calls, 1); assert.equal(f.writes.length, 0);
  }
});
