const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../app/js/record-edit-locks.js'), 'utf8').replace(/^export /gm, '');
function server() {
  const rows = new Map(), calls = [];
  let sequence = 0, now = 0;
  const execute = async args => {
    calls.push(args);
    const key = args.moduleApiName + ':' + args.recordId;
    let row = rows.get(key);
    if (args.action === 'acquire') {
      if (row && row.until <= now) { rows.delete(key); row = null; }
      if (!row) { row = { id: String(++sequence), token: args.leaseToken, until: now + 100 }; rows.set(key, row); }
      if (row.token !== args.leaseToken) return { success: false, locked: true, message: 'Another session is editing this record' };
      return { success: true, lease_id: row.id, lease_until: row.until };
    }
    if (!row || row.id !== args.leaseId || row.token !== args.leaseToken) return { success: false, message: 'Lease does not belong to this session' };
    if (args.action === 'release') { rows.delete(key); return { success: true }; }
    return row.until > now ? { success: true, lease_id: row.id } : { success: false, message: 'Lease expired. Reopen the editor' };
  };
  const client = () => {
    const context = vm.createContext({}); vm.runInContext(source, context);
    return context.createRecordEditLocks({ execute, token: () => 'token-' + (++sequence) });
  };
  return { rows, calls, execute, client, expire: () => { now += 101; } };
}
test('two sessions cannot edit one record, but different records remain independent', async () => {
  const s = server(), first = s.client(), second = s.client();
  await first.begin('Booking_Services', '1');
  await assert.rejects(second.begin('Booking_Services', '1'), /Another session/);
  await second.begin('Booking_Services', '2');
  assert.equal(s.rows.size, 2);
  await first.release('Booking_Services', '1');
  await second.begin('Booking_Services', '1');
});
test('expired owners cannot save or release the replacement owner lock', async () => {
  const s = server(), old = s.client(), next = s.client();
  await old.begin('Deals', '1'); s.expire(); await next.begin('Deals', '1');
  let writes = 0;
  await assert.rejects(old.write('Deals', '1', () => writes++), /does not belong/);
  await assert.rejects(old.release('Deals', '1'), /does not belong/);
  assert.equal(writes, 0);
  await next.check('Deals', '1');
});
test('unknown lock acquisition reuses its nonce before any business save', async () => {
  const s = server(), context = vm.createContext({}); vm.runInContext(source, context);
  let lose = true, tokens = 0, writes = 0;
  const locks = context.createRecordEditLocks({ token: () => 'token-' + (++tokens), execute: async args => { const result = await s.execute(args); if (args.action === 'acquire' && lose) { lose = false; throw new Error('Response lost'); } return result; } });
  await assert.rejects(locks.write('Deals', '1', () => writes++), /Response lost/);
  assert.equal(writes, 0);
  await locks.write('Deals', '1', () => writes++);
  assert.equal(tokens, 1);
  assert.equal(writes, 1);
  assert.equal(s.rows.size, 0);
});
test('expired and malformed lock checks block saves, without changing business data', async () => {
  const s = server(), locks = s.client();
  await locks.begin('Tasks', '1'); s.expire();
  await assert.rejects(locks.write('Tasks', '1', () => assert.fail('Expired lock cannot save')), /expired/);
  const c = vm.createContext({}); vm.runInContext(source, c);
  const malformed = c.createRecordEditLocks({ token: () => 'token', execute: async () => ({ success: true }) });
  await assert.rejects(malformed.write('Tasks', '1', () => assert.fail('Unconfirmed lock cannot save')), /could not be confirmed/);
});
test('closing while acquire is in flight releases the late lock', async () => {
  const s = server(), c = vm.createContext({}); vm.runInContext(source, c);
  let resolve;
  const locks = c.createRecordEditLocks({ token: () => 'token', execute: async args => { const result = await s.execute(args); return args.action === 'acquire' ? new Promise(done => { resolve = () => done(result); }) : result; } });
  const pending = locks.begin('Tasks', '1');
  await new Promise(done => setImmediate(done));
  await locks.release('Tasks', '1'); resolve();
  await assert.rejects(pending, /editor closed/);
  assert.equal(s.rows.size, 0);
});
test('duplicate saves and closing during a save cannot release the active lock', async () => {
  const s = server(), locks = s.client(); let finish;
  await locks.begin('Deals', '1');
  const pending = locks.write('Deals', '1', () => new Promise(resolve => { finish = resolve; }));
  await new Promise(done => setImmediate(done));
  await assert.rejects(locks.write('Deals', '1', () => {}), /already being saved/);
  await assert.rejects(locks.release('Deals', '1'), /save to finish/);
  finish(); await pending;
  await locks.release('Deals', '1');
  assert.equal(s.rows.size, 0);
});
test('multiple-record editors release earlier acquisitions when a related record is locked', async () => {
  const s = server(), first = s.client(), second = s.client();
  await first.begin('Prepayment_Requests', '1');
  await assert.rejects(second.beginMany([['Prepayments', '2'], ['Prepayment_Requests', '1']]), /Another session/);
  assert.equal(s.rows.size, 1);
});
