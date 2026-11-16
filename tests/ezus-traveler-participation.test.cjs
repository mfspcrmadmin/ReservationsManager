const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('crm/syncTravellersFromEzusWithToken.dg', 'utf8');
const getter = fs.readFileSync('crm/getEZUSTravellersByProjectWithToken.dg', 'utf8');
const traveler = (extra = {}) => ({ id: 'ez-1', first_name: 'Alex', last_name: 'Morgan', lead: 'Y', ...extra });
const relation = (extra = {}) => ({ id: '101', PAX: { id: '201' }, Participation_Status: 'Active', Source_System: 'Ezus', Lead_Passenger: false, Source_Passenger_Reference: 'ez-1', ...extra });
function run(options = {}, sourceText = source) {
  const events = [];
  const context = vm.createContext({ options, events });
  vm.runInContext(`
    class DM {
      constructor(o={}){this.o=o} get(k){return this.o[k]??null} put(k,v){this.o[k]=v}
      keys(){return Object.keys(this.o)} containKey(k){return Object.hasOwn(this.o,k)}
      size(){return Object.keys(this.o).length} isEmpty(){return !this.size()}
      toString(){return JSON.stringify(this.o)} toJSON(){return this.o}
    }
    function wrap(v){return Array.isArray(v)?Array.from(v,wrap):v&&typeof v==='object'?new DM(Object.fromEntries(Object.entries(v).map(([k,x])=>[k,wrap(x)]))):v}
    function Map(){return new DM()} function List(){return []} function ifnull(a,b){return a==null?b:a}
    String.prototype.matches=function(p){return new RegExp(p).test(this)};
    String.prototype.toLong=function(){return this.toString()};
    String.prototype.toMap=function(){return wrap(JSON.parse(this))};
    String.prototype.length=function(){return this.toString().length};
    String.prototype.replaceAll=function(p,replacement){return this.replace(new RegExp(p,'g'),replacement)};
    Array.prototype.isEmpty=function(){return !this.length};Array.prototype.size=function(){return this.length};
    Array.prototype.add=function(v){this.push(v)};Array.prototype.get=function(i){return this[i]??null};
    Array.prototype.contains=function(v){return this.includes(v)};
    var bookingId=options.bookingId??'301',ezusProjectRef='project1',token='TOKEN_NEVER_LOG',skipDeletes=options.skipDeletes??false,projectReference='project1';
    function response(code,body){return wrap({responseCode:code,responseText:JSON.stringify(body)})}
    const zoho={crm:{
      getOrgVariable:(key)=>key,
      getRecordById:(module,id)=>{events.push({type:'read',module,id});return wrap(module==='Deals'?{id:'301',Ezus_Project_ID:options.projectMismatch?'other':'project1'}:{id,Name:'Morgan',Forename:'Alex',Lead_Pax:true,Email:'crm@example.com',Special_Requests:'global old'});},
      createRecord:(module,data)=>{events.push({type:'create',module,data:JSON.parse(data.toString())});return wrap(options.failRelation&&module==='PAX_X_Bookings'?{code:'INVALID_DATA',status:'error'}:{id:module==='PAX'?'201':'101'});},
      updateRecord:(module,id,data)=>{events.push({type:'update',module,id,data:JSON.parse(data.toString())});return wrap(options.failRelation&&module==='PAX_X_Bookings'?{code:'INVALID_DATA',status:'error'}:{id});}
    }};
    const standalone={
      getEZUSTravellersByProjectWithToken:(project,receivedToken)=>{events.push({type:'ezus',project,token:receivedToken});return wrap(options.fetchError?{error:'true',message:'Ezus failed'}:{error:false,result:options.travelers??[]});},
      checkIfTravellerExists:data=>{events.push({type:'match'});return wrap(options.matchExisting?{exists:true,record:{id:'201',Name:'Morgan',Forename:'Alex',Lead_Pax:true,Email:'crm@example.com',Special_Requests:'global old'}}:{exists:false});}
    };
    function readRelations(){events.push({type:'relationsRead'});return options.readError?response(403,{}):response(200,{data:options.relations??[],info:{more_records:options.moreRelations??false}})}
    function serviceGuard(){events.push({type:'serviceGuard'});return options.activeServiceAssignments?response(200,{data:[{id:'401'}]}):response(204,null)}
    function unlink(){events.push({type:'delete',module:'PAX_X_Bookings',id:relationId});return response(200,{data:[{code:'SUCCESS',status:'success',details:{id:relationId}}]})}
    function ezusFetch(){return response(options.httpCode??200,options.rawPayload??{travellers:[]})}
  `, context);
  let executable=sourceText.replace(/^string standalone[^\n]+\n/,'')
    .replace(/invokeurl\s*\[[\s\S]*?\];/g, block => sourceText===getter?'ezusFetch();':block.includes('type :DELETE')?'unlink();':block.includes('guardQuery')?'serviceGuard();':'readRelations();')
    .replace(/for each (\w+) in ([^\r\n]+)\r?\n/g,'for (const $1 of $2)\n')
    .replace(/sourceFields = (\{[^\n]+\});/,'sourceFields = wrap($1);')
    .replace(/\.length\(\)/g,'.length');
  const result = JSON.parse(JSON.stringify(vm.runInContext('(function()'+executable+')()',context)));
  return {result,events:JSON.parse(JSON.stringify(events))};
}
const writes=r=>r.events.filter(e=>['create','update','delete'].includes(e.type));
test('new passenger gets trip fields, source reference and lead',()=>{
  const r=run({travelers:[traveler()]});assert.equal(r.result.error,false,r.result.message);
  const link=r.events.find(e=>e.type==='create'&&e.module==='PAX_X_Bookings');
  assert.deepEqual(link.data,{Participation_Status:'Active',Source_System:'Ezus',Lead_Passenger:true,Source_Passenger_Reference:'ez-1',Bookings:'301',PAX:'201'});
  assert.equal(r.events.find(e=>e.type==='ezus').token,'TOKEN_NEVER_LOG');
});
test('existing relation receives explicit false and missing fields; global lead is not rewritten',()=>{
  const r=run({travelers:[traveler({lead:'N',email:''})],relations:[relation({Lead_Passenger:true,Participation_Status:null,Source_System:null})],matchExisting:true});
  assert.equal(r.result.error,false);
  const data=r.events.find(e=>e.type==='update'&&e.module==='PAX_X_Bookings').data;
  assert.equal(data.Lead_Passenger,false);assert.equal(data.Participation_Status,'Active');assert.equal(data.Source_System,'Ezus');
  assert.equal(r.events.some(e=>e.module==='PAX'&&e.type==='update'),false);
});
test('source reference wins over global matching and repeated sync causes no unnecessary writes',()=>{
  const r=run({travelers:[traveler({lead:'N'})],relations:[relation()]});
  assert.equal(r.result.error,false);assert.equal(r.events.some(e=>e.type==='match'),false);assert.deepEqual(writes(r),[]);
});
test('missing lead preserves trip lead, manual requests and blank profile fields',()=>{
  const r=run({travelers:[traveler({lead:null,'special-requests':'from Ezus',email:''})],relations:[relation({Lead_Passenger:true,Special_Requests:'manual'})]});
  assert.equal(r.result.error,false);assert.deepEqual(writes(r),[]);
});
test('empty trip requests are filled without overwriting global requests',()=>{
  const r=run({travelers:[traveler({lead:'N','special-requests':'new trip'})],relations:[relation()]});
  assert.equal(r.result.error,false);assert.deepEqual(writes(r).map(e=>e.data),[{Special_Requests:'new trip'}]);
});
test('removal only unlinks missing Ezus relations in this booking; PAX and manual relations survive',()=>{
  const r=run({travelers:[traveler({lead:'N'})],relations:[relation(),relation({id:'102',PAX:{id:'202'},Source_Passenger_Reference:'ez-2'}),relation({id:'103',PAX:{id:'203'},Source_System:'CRM',Source_Passenger_Reference:null})]});
  assert.equal(r.result.error,false);assert.deepEqual(writes(r),[{type:'delete',module:'PAX_X_Bookings',id:'102'}]);
  const keep=run({travelers:[traveler({lead:'N'})],relations:[relation(),relation({id:'102',PAX:{id:'202'},Source_Passenger_Reference:'ez-2'})],skipDeletes:true});
  assert.equal(keep.result.removedRelations,0);
});
test('empty response, failed fetch, bad reference and truncated reads never write',()=>{
  for(const options of [{travelers:[]},{fetchError:true},{projectMismatch:true},{readError:true},{moreRelations:true},{travelers:[traveler(),traveler()]},{travelers:[traveler({lead:'unknown'})]}]){
    const r=run({travelers:[traveler()],...options});assert.deepEqual(writes(r),[]);
    if(options.travelers?.length!==0)assert.equal(r.result.error,true);
  }
});
test('relation failure never triggers cleanup or reports success',()=>{
  const r=run({travelers:[traveler()],relations:[relation({id:'102',PAX:{id:'202'},Source_Passenger_Reference:'ez-2'})],failRelation:true});
  assert.equal(r.result.error,true);assert.equal(r.events.some(e=>e.type==='delete'),false);
});
test('two travellers resolving to one CRM person fail before the second overwrite',()=>{
  const r=run({travelers:[traveler(),traveler({id:'ez-2',first_name:'Jamie'})],matchExisting:true});
  assert.equal(r.result.error,true);assert.equal(r.events.filter(e=>e.module==='PAX'&&e.type==='update').length,0);assert.equal(r.events.some(e=>e.type==='delete'),false);
});
test('source reference conflicts and duplicate existing relations stop before writes',()=>{
  for(const relations of [[relation({Source_Passenger_Reference:'different'})],[relation(),relation({id:'102',Source_Passenger_Reference:null})]]){
    const r=run({travelers:[traveler()],relations,matchExisting:true});assert.equal(r.result.error,true);assert.deepEqual(writes(r),[]);
  }
});
test('active service assignments prevent a passenger Booking relation from being removed',()=>{
  const r=run({travelers:[traveler({lead:'N'})],relations:[relation(),relation({id:'102',PAX:{id:'202'},Source_Passenger_Reference:'ez-2'})],activeServiceAssignments:true});
  assert.equal(r.result.error,true);assert.equal(r.events.some(e=>e.type==='delete'),false);
});
test('Ezus reader rejects HTTP failures, error flags and missing collections, accepts explicit empty list',()=>{
  for(const options of [{httpCode:429},{rawPayload:{error:'true',travellers:[]}},{rawPayload:{message:'Limit exceeded'}}])assert.equal(run(options,getter).result.error,true);
  assert.equal(run({rawPayload:{travellers:[]}},getter).result.error,false);
});
