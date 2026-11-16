const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('crm/paxBooking_migrateParticipation.dg', 'utf8');
const row = (id, extra = {}) => ({ id: String(id), pax_id: '21', booking_id: '31', legacy_lead: false,
  ezus_project_id: null, Lead_Passenger: false, Participation_Status: null, Source_System: null, ...extra });
function run(options = {}) {
  const writes = [], reads = [];
  const context = vm.createContext({ options, writes, reads });
  vm.runInContext(`
    class DM {
      constructor(o={}) {this.o=o} put(k,v){this.o[k]=v} get(k){return this.o[k]??null}
      size(){return Object.keys(this.o).length} isEmpty(){return this.size()===0}
      toString(){return JSON.stringify(this.o)} toJSON(){return this.o}
    }
    function wrap(v){return Array.isArray(v)?v.map(wrap):v&&typeof v==='object'?new DM(Object.fromEntries(Object.entries(v).map(([k,x])=>[k,wrap(x)]))):v}
    function Map(){return new DM()} function List(){return []} function ifnull(x,y){return x==null?y:x}
    String.prototype.toMap=function(){return wrap(JSON.parse(this))};
    String.prototype.toLong=function(){return BigInt(this)};
    String.prototype.matches=function(pattern){return new RegExp(pattern).test(this)};
    Array.prototype.add=function(v){this.push(v)}; Array.prototype.get=function(i){return this[i]??null};
    Array.prototype.size=function(){return this.length}; Array.prototype.isEmpty=function(){return !this.length};
    Array.prototype.contains=function(v){return this.includes(v)};
    var dryRun=Object.hasOwn(options,'dryRun')?options.dryRun:true, afterId=options.afterId??'0', throughId=options.throughId??'', batchSize=options.batchSize??2000;
    function response(code,body){return wrap({responseCode:code,responseText:JSON.stringify(body)})}
    function upper(){reads.push('upper');return response(200,{data:[{id:options.upperId??'999999999999999999'}]})}
    function fields(){reads.push('fields');return response(200,{fields:[{api_name:'Lead_Passenger',data_type:'boolean'},
      {api_name:'Participation_Status',pick_list_values:[{actual_value:'Active'}]},
      {api_name:'Source_System',pick_list_values:(options.missingTP?['Ezus']:['Ezus','TP']).map(actual_value=>({actual_value}))}]})}
    function read(query){reads.push(JSON.parse(query.toString()));if(options.readError)return response(403,{code:'NO_PERMISSION'});
      return options.empty?response(204,null):response(200,{data:options.rows??[],info:{more_records:options.more??false}})}
    function write(body){const value=JSON.parse(body.toString());writes.push(value);
      if(options.writeThrows)throw Error('Network interrupted');
      const data=value.data.map(r=>r.id===options.failId?{code:'RECORD_LOCKED',status:'error',details:{id:r.id}}:
        {code:'SUCCESS',status:'success',details:{id:options.wrongResponseId??r.id}});
      return response(options.failId?207:200,{data:options.truncated?data.slice(0,-1):data});}
  `, context);
  let index = 0;
  const calls = ['upper()', 'fields()', 'read(query)', 'write(writeBody)'];
  const executable = source.replace(/^string standalone[^\n]+\n/, '')
    .replace(/invokeurl\s*\[[\s\S]*?\];/g, () => calls[index++] + ';')
    .replace(/for each (\w+) in ([^\r\n]+)\r?\n/g, 'for (const $1 of $2)\n');
  assert.equal(index, 4);
  const result = JSON.parse(vm.runInContext('(function()' + executable + ')()', context));
  return { result, writes: JSON.parse(JSON.stringify(writes)), reads };
}
test('dry run previews rules including TP, whitespace and shared PAX lead in all bookings', () => {
  const r=run({rows:[row('1',{legacy_lead:true,ezus_project_id:'EZ1'}),row('2',{legacy_lead:true,booking_id:'32'}),row('3',{ezus_project_id:'  '})],more:true});
  assert.equal(r.result.success,true);assert.equal(r.result.wouldUpdate,3);assert.equal(r.result.ezus,1);assert.equal(r.result.tp,2);
  assert.equal(r.result.leadTrue,2);assert.equal(r.result.nextCursor,'3');assert.equal(r.result.done,false);assert.deepEqual(r.writes,[]);
  assert.equal(r.result.sample[0].changes.Lead_Passenger,true);assert.equal(r.result.sample[1].changes.Lead_Passenger,true);
});
test('exactly three migration fields may change; updates use batches of 100 and explicit empty triggers', () => {
  const r=run({dryRun:false,rows:Array.from({length:205},(_,i)=>row(String(i+1),{legacy_lead:i%2===0}))});
  assert.equal(r.result.success,true);assert.equal(r.result.updated,205);assert.deepEqual(r.writes.map(b=>b.data.length),[100,100,5]);
  for(const body of r.writes){assert.deepEqual(body.trigger,[]);assert.deepEqual(body.skip_feature_execution,[{name:'cadences'}]);
    for(const record of body.data)for(const key of Object.keys(record))assert.ok(['id','Lead_Passenger','Participation_Status','Source_System'].includes(key));}
});
test('already migrated values cause no writes; false also replaces an incorrect true', () => {
  const same=row('1',{Participation_Status:'Active',Source_System:'TP'});
  const r=run({dryRun:false,rows:[same]});assert.equal(r.result.updated,0);assert.equal(r.result.unchanged,1);assert.deepEqual(r.writes,[]);
  const changed=run({dryRun:false,rows:[row('1',{Lead_Passenger:true,Participation_Status:'Active',Source_System:'TP'})]});
  assert.deepEqual(changed.writes[0].data[0],{id:'1',Lead_Passenger:false});
});
test('partial success stops subsequent batches and retains original cursor', () => {
  const r=run({dryRun:false,afterId:'10',rows:Array.from({length:205},(_,i)=>row(String(i+11))),failId:'12'});
  assert.equal(r.result.success,false);assert.equal(r.result.updated,99);assert.equal(r.result.nextCursor,'10');assert.equal(r.result.retrySameBatch,true);assert.equal(r.writes.length,1);
});
test('missing source lookup or inaccessible lead blocks the whole read batch before any writes', () => {
  for(const extra of [{pax_id:null},{booking_id:null},{legacy_lead:null}]){
    const r=run({dryRun:false,rows:[row('1'),row('2',extra)]});assert.equal(r.result.success,false);assert.deepEqual(r.writes,[]);assert.equal(r.result.nextCursor,'0');}
});
test('invalid inputs and missing picklist values cannot write', () => {
  for(const extra of [{dryRun:null},{afterId:"0' or id>0"},{throughId:'bad'},{batchSize:0},{batchSize:2001},{missingTP:true}]){
    const r=run({dryRun:false,rows:[row('1')],...extra});assert.equal(r.result.success,false);assert.deepEqual(r.writes,[]);}
});
test('18-digit IDs stay exact and the fixed upper bound is reused', () => {
  const r=run({afterId:'616617000000000001',throughId:'616617000000000005',rows:[row('616617000000000002')]});
  assert.equal(r.result.success,true);assert.equal(r.result.nextCursor,'616617000000000002');assert.equal(r.result.throughId,'616617000000000005');
  assert.equal(r.reads.includes('upper'),false);assert.match(r.reads.find(x=>x.select_query).select_query,/616617000000000001/);
});
test('read errors, invalid order, out-of-bound IDs and unconfirmed writes retain cursor', () => {
  for(const extra of [{readError:true},{rows:[row('2'),row('1')]},{throughId:'1',rows:[row('2')]},{truncated:true},{wrongResponseId:'999'},{writeThrows:true}]){
    const r=run({dryRun:false,rows:[row('1')],...extra});assert.equal(r.result.success,false);assert.equal(r.result.nextCursor,'0');assert.equal(r.result.done,false);}
});
test('204 ends traversal and sample never exceeds 20 rows', () => {
  const empty=run({dryRun:false,empty:true});assert.equal(empty.result.success,true);assert.equal(empty.result.done,true);assert.deepEqual(empty.writes,[]);
  const r=run({rows:Array.from({length:40},(_,i)=>row(String(i+1)))});assert.equal(r.result.sample.length,20);assert.equal(r.result.sampleOmitted,20);
});
