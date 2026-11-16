const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function harness() {
  const ctx = vm.createContext({ setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync(require.resolve('../app/js/payment-settlement.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''), ctx);
  let linked = false, calls = 0, waits = 0;
  const deps = {
    read: async module => module === 'Booking_Services' ? { id: '3', Booking: {id:'1'}, Supplier:{id:'2'}, Supplier_Settlement: linked ? {id:'4'} : null } : { id:'4', Booking:{id:'1'}, Supplier:{id:'2'}, Settlement_Type:'Supplier Services' },
    execute: async (name, args) => { calls++; assert.equal(name, 'recalculatesuppliersettlementsforbooking'); assert.equal(args.bookingId, 'recover:1'); linked = true; return {details:{output:'{"error":false}'}}; },
    waiting: () => { waits++; }, pause: async () => {}
  };
  return { deps, run: () => ctx.resolvePaymentSettlement('1','2',[{id:'3'}],deps), link: () => {linked=true;}, counts: () => [calls,waits] };
}
test('fresh CRM association skips recovery and missing association recovers then verifies', async () => {
  const h = harness(); h.link(); assert.equal(await h.run(), '4'); assert.deepEqual(h.counts(),[0,0]);
  const missing = harness(); assert.equal(await missing.run(),'4'); assert.deepEqual(missing.counts(),[1,1]);
});
test('running job waits and rechecks, without treating it as success', async () => {
  const h = harness(), execute = h.deps.execute; let calls=0;
  h.deps.execute = async (...args) => ++calls === 1 ? {details:{output:{error:true,message:'A settlement recalculation is already running for this booking. Retry later.'}}} : execute(...args);
  assert.equal(await h.run(),'4'); assert.equal(calls,2);
});
test('CRM failure and unconfirmed success both block payment', async () => {
  for (const output of [{error:true,message:'Calculation failed'}, {error:false}, null]) {
    const h=harness(); h.deps.execute=async()=>({details:{output}});
    await assert.rejects(h.run(), /Calculation failed|siguen sin settlement|no ha confirmado/);
  }
});

test('a lookup created by a running calculation does not allow payment before completion', async () => {
  const h = harness(); let calls = 0, pauses = 0;
  h.deps.execute = async () => {
    calls++;
    h.link();
    return {details:{output: calls === 1
      ? {error:true,message:'A settlement recalculation is already running'}
      : {error:false}}};
  };
  h.deps.pause = async () => { pauses++; };
  assert.equal(await h.run(), '4');
  assert.equal(calls, 2);
  assert.equal(pauses, 1);
});

test('failed queue reconciliation blocks payment even if the settlement now exists', async () => {
  const h = harness();
  h.deps.execute = async () => {
    h.link();
    return {details:{output:{error:true,calculation_completed:true,message:'Jobs could not be closed'}}};
  };
  await assert.rejects(h.run(), /Jobs could not be closed/);
});
test('wrong booking or supplier blocks even when a lookup is present', async () => {
  const h=harness(); h.link(); const read=h.deps.read;
  h.deps.read=async module=>({...await read(module),Supplier:{id:'wrong'}});
  await assert.rejects(h.run(), /verificar/); assert.deepEqual(h.counts(),[0,0]);
});
test('unresponsive CRM times out instead of leaving the spinner indefinitely', async () => {
  const h=harness(); h.deps.timeoutMs=10; h.deps.read=()=>new Promise(()=>{});
  await assert.rejects(h.run(), /a tiempo/);
});

test('popup closes on success and retains safely rendered errors with no spinner', async () => {
  for (const fail of [false, true]) {
    const nodes = Object.fromEntries(['h3','.booking-browser-sync-spinner','[role=status]','[data-message]','button'].map(key=>[key,{hidden:false,setAttribute(){},focus(){},addEventListener(){}}]));
    const dialog={isConnected:false,addEventListener(){},querySelector:key=>nodes[key],showModal(){this.shown=true;},remove(){this.isConnected=false;this.removed=true;}};
    const ctx=vm.createContext({document:{createElement:()=>dialog,body:{appendChild(node){node.isConnected=true;}}},setTimeout,clearTimeout});
    vm.runInContext(fs.readFileSync(require.resolve('../app/js/payment-settlement.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''),ctx);
    ctx.resolvePaymentSettlement=async (booking,supplier,services,deps)=>{deps.waiting();if(fail)throw Error('<CRM error>');return '4';};
    if(fail){
      await assert.rejects(ctx.requirePaymentSettlement('1','2',[]), /CRM error/);
      assert.equal(dialog.isConnected,true);assert.equal(nodes['[data-message]'].textContent,'<CRM error>');
      assert.equal(nodes['.booking-browser-sync-spinner'].hidden,true);assert.equal(nodes.button.hidden,false);
    } else {assert.equal(await ctx.requirePaymentSettlement('1','2',[]),'4');assert.equal(dialog.removed,true);}
    assert.equal(dialog.shown,true);
  }
});
