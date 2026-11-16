const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const source=fs.readFileSync('crm/servicePax_manage.dg','utf8');
const assignment=(extra={})=>({id:'401',booking_id:'301',pax_id:'201',Assignment_Status:null,Room_Type:'Double',Modified_Time:'2026-10-29T10:00:00Z',...extra});
const desired=(rows)=>JSON.stringify({passengers:rows});
function run(options={}){
  const events=[];
  const ctx=vm.createContext({options,events,hash:s=>crypto.createHash('sha256').update(s).digest('hex')});
  vm.runInContext(`
    class DM{constructor(o={}){this.o=o}get(k){return this.o[k]??null}put(k,v){this.o[k]=v}keys(){return Object.keys(this.o)}containKey(k){return Object.hasOwn(this.o,k)}isEmpty(){return !Object.keys(this.o).length}toString(){return JSON.stringify(this.o)}toJSON(){return this.o}}
    function wrap(v){return Array.isArray(v)?Array.from(v,wrap):v&&typeof v==='object'?new DM(Object.fromEntries(Object.entries(v).map(([k,x])=>[k,wrap(x)]))):v}
    function Map(){return new DM()}function List(){return []}function ifnull(a,b){return a==null?b:a}
    String.prototype.toMap=function(){return wrap(JSON.parse(this))};String.prototype.toList=function(s){return this.split(s)};String.prototype.matches=function(p){return new RegExp(p).test(this)};String.prototype.toLong=function(){return this.toString()};
    Array.prototype.add=function(v){this.push(v)};Array.prototype.size=function(){return this.length};Array.prototype.isEmpty=function(){return !this.length};Array.prototype.contains=function(v){return this.includes(v)};
    const fixture=options;
    var serviceId='501',changesJson=options.changes??'',expectedVersion=options.version??'',commit=options.commit??false;
    function response(code,data){return wrap({responseCode:code,responseText:JSON.stringify(data)})}
    function legacyRead(){return options.legacy?response(200,{data:[{id:'999'}]}):response(204,{})}
    function assignmentsRead(){return response(200,{data:options.assignments??[],info:{more_records:options.more??false}})}
    const standalone={crm_getBookingParticipants:()=>JSON.stringify({error:options.participantError??false,result:[{id:'201',Booking_ID:'301',PAX_Booking_ID:'101'},{id:'202',Booking_ID:'301',PAX_Booking_ID:'102'}]})};
    const zoho={encryption:{sha256:hash},crm:{getRecordById:()=>wrap({id:'501',Booking:{id:'301'},Modified_Time:'service-v1'}),
      createRecord:(module,changes,opts)=>{events.push({module,type:'create',data:JSON.parse(changes.toString()),opts:JSON.parse(opts.toString())});return wrap(fixture.failWrite?{status:'error'}:{id:'402'});},
      updateRecord:(module,id,changes,opts)=>{events.push({module,type:'update',id,data:JSON.parse(changes.toString()),opts:JSON.parse(opts.toString())});return wrap(fixture.failWrite?{status:'error'}:{id});}}};
  `,ctx);
  const executable=source.replace(/^string standalone[^\n]+\n/,'').replace(/invokeurl\s*\[[\s\S]*?\];/g,b=>b.includes('legacyQuery')?'legacyRead();':'assignmentsRead();')
    .replace(/for each (\w+) in ([^\r\n]+)\r?\n/g,'for (const $1 of $2)\n').replace(/\.length\(\)/g,'.length')
    .replace(/item.put\("changes",(\{[^\n]+\})\);/,'item.put("changes",wrap($1));');
  const result=JSON.parse(vm.runInContext('(function()'+executable+')()',ctx));
  return{result,events:JSON.parse(JSON.stringify(events))};
}
function withVersion(options){return {...options,version:run(options).result.version};}
test('load and preview are read only; an unassigned service does not select all passengers',()=>{
  const load=run();assert.equal(load.result.error,false);assert.deepEqual(load.result.assignments,[]);assert.deepEqual(load.events,[]);
  const preview=run(withVersion({changes:desired([{paxId:'201',roomType:'DOUBLE',roomGroup:'Room 1',notes:'internal'}])}));
  assert.equal(preview.result.error,false);assert.equal(preview.result.plan[0].action,'Assign');assert.deepEqual(preview.events,[]);
});
test('commit validates Booking membership, uses canonical module and fills unique pair key',()=>{
  const options={changes:desired([{paxId:'201',roomType:'TWIN',roomGroup:'A',notes:'note'}]),commit:true};
  const r=run(withVersion(options));assert.equal(r.result.error,false);assert.equal(r.result.committed,true);
  assert.equal(r.events.length,1);assert.equal(r.events[0].module,'PAX_Booking_Services');assert.equal(r.events[0].data.Assignment_Key,'501:201');assert.equal(r.events[0].data.Booking,'301');assert.deepEqual(r.events[0].opts.trigger,[]);
  for(const passengers of [[{paxId:'999'}],[{paxId:'201'},{paxId:'201'}]]){const bad=run(withVersion({changes:desired(passengers),commit:true}));assert.equal(bad.result.error,true);assert.deepEqual(bad.events,[]);}
});
test('unassigning is a status update that preserves historical room and notes',()=>{
  const r=run(withVersion({assignments:[assignment({Service_Notes:'keep',Room_Group:'original'})],changes:desired([]),commit:true}));
  assert.equal(r.result.error,false);assert.deepEqual(r.events[0].data,{Assignment_Status:'Cancelled'});assert.doesNotMatch(source,/type\s*:\s*DELETE|\.deleteRecord/);
});
test('stale version, legacy links, foreign booking, duplicates and incomplete reads block writes',()=>{
  for(const extra of [{version:'stale'},{legacy:true},{participantError:true},{assignments:[assignment({booking_id:'999'})]},{assignments:[assignment(),assignment({id:'402'})]},{more:true}]){
    let options=withVersion({assignments:[],changes:desired([{paxId:'201'}]),commit:true,...extra});if(extra.version)options.version=extra.version;
    const r=run(options);assert.equal(r.result.error,true);assert.deepEqual(r.events,[]);
  }
});
test('already matching rows are idempotent; a rejected write is never committed',()=>{
  const current=assignment({Room_Type:null,Room_Group:'',Service_Notes:'',Assignment_Status:'Active',Assignment_Source:'CRM',Assignment_Key:'501:201'});
  const r=run(withVersion({assignments:[current],changes:desired([{paxId:'201'}]),commit:true}));assert.equal(r.result.error,false);assert.equal(r.result.confirmed,0);assert.deepEqual(r.events,[]);
  const failed=run(withVersion({changes:desired([{paxId:'201'}]),commit:true,failWrite:true}));assert.equal(failed.result.error,true);assert.equal(failed.result.committed,false);assert.equal(failed.result.writeStarted,true);
});
test('room values and lengths are validated before writes',()=>{
  for(const item of [{paxId:'201',roomType:'INVALID'},{paxId:'201',roomGroup:'x'.repeat(101)},{paxId:'201',notes:'x'.repeat(32001)}]){
    const r=run(withVersion({changes:desired([item]),commit:true}));assert.equal(r.result.error,true);assert.deepEqual(r.events,[]);
  }
});
test('version also covers actual assignment values when CRM timestamps are equal',()=>{
  const first=run({assignments:[assignment({Service_Notes:'one'})]}).result.version;
  const second=run({assignments:[assignment({Service_Notes:'two'})]}).result.version;
  assert.notEqual(first,second);
});
