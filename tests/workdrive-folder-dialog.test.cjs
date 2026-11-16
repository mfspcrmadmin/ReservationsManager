const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('app/js/workdrive-folder-dialog.js', 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
function setup(output, booking) {
  const calls = [];
  const context = vm.createContext({
    recordEditLocks: { write: async (module, id, work) => { calls.push(['lock', module, id]); return work(); } },
    crmExecuteFunction: async (name, args) => { calls.push([name, JSON.parse(args.requestBody)]); return { details: { output: JSON.stringify(output) } }; },
    crmGetRecord: async () => booking
  });
  vm.runInContext(source, context);
  return { context, calls };
}
test('folder creation uses the bounded gateway and confirms the saved folder', async () => {
  const booking = { id: '123', Booking_Workdrive_Folder_ID: 'folder' };
  const f = setup({ error: false, booking_folder_id: 'folder' }, booking);
  assert.equal(await f.context.createBookingFolder('123', () => {}), booking);
  assert.equal(f.calls[0][1], 'Deals');
  assert.equal(f.calls[1][1].operation, 'booking_createworkdrivefolder');
  assert.equal(f.calls[1][1].bookingId, '123');
});
test('provider errors and missing or mismatching acknowledgements block success', async () => {
  for (const [output, booking, expected] of [
    [{ error: true, message: 'Agency has no Workdrive Folder ID' }, {}, /Agency has no/],
    [{}, {}, /not confirmed/],
    [{ error: false, booking_folder_id: 'folder' }, { id: '123', Booking_Workdrive_Folder_ID: 'other' }, /could not be confirmed/]
  ]) {
    const f = setup(output, booking);
    await assert.rejects(f.context.createBookingFolder('123', () => {}), expected);
    assert.equal(f.calls.filter(c => c[0] === 'widget_recordlease').length, 1);
  }
});
test('changed booking blocks creation before a write', async () => {
  const f = setup({}, {});
  await assert.rejects(f.context.createBookingFolder('123', () => { throw new Error('Booking changed'); }), /Booking changed/);
  assert.equal(f.calls.length, 1);
});
