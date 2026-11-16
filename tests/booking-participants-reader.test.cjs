const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('crm/crm_getBookingParticipants.dg','utf8');
const participant = (id, extra={}) => ({id:String(id),pax_id:'201',booking_id:'301',Name:'Morgan',Forename:'Alex',Lead_Passenger:false,Participation_Status:'Active',Special_Requests:'',Booking_Notes:'',...extra});
function run(options={}) {
  const reads=[];
  const ctx=vm.createContext({options,reads});
  vm.runInContext(`
    class DM {constructor(o={}){this.o=o}get(k){return this.o[k]??null}put(k,v){this.o[k]=v}keys(){return Object.keys(this.o)}toString(){return JSON.stringify(this.o)}toJSON(){return this.o}}
    function Map(){return new DM()}function List(){return []}function ifnull(a,b){return a==null?b:a}
    function wrap(v){return Array.isArray(v)?Array.from(v,wrap):v&&typeof v==='object'?new DM(Object.fromEntries(Object.entries(v).map(([k,x])=>[k,wrap(x)]))):v}
    String.prototype.toMap=function(){return wrap(JSON.parse(this))};String.prototype.toList=function(s){return this.split(s)};
    String.prototype.matches=function(p){return new RegExp(p).test(this)};String.prototype.toLong=function(){return BigInt(this)};
    String.prototype.equalsIgnoreCase=function(v){return this.toLowerCase()===v.toLowerCase()};
    Array.prototype.add=function(v){this.push(v)};Array.prototype.size=function(){return this.length};Array.prototype.isEmpty=function(){return !this.length};Array.prototype.contains=function(v){return this.includes(v)};
    var bookingId=options.bookingId??'301';let index=0;
    function read(query){reads.push(query.toString());const rows=options.pages?.[index]??[];const more=options.alwaysMore||index<(options.pages?.length??0)-1;index++;
      return wrap({responseCode:options.readError?403:rows.length?200:204,responseText:JSON.stringify({data:rows,info:{more_records:!!more}})});}
  `,ctx);
  const executable=source.replace(/^string standalone[^\n]+\n/,'')
    .replace(/invokeurl\s*\[[\s\S]*?\];/,'read(query);')
    .replace(/for each (\w+) in ([^\r\n]+)\r?\n/g,'for (const $1 of $2)\n')
    .replace(/profileFields = (\{[^\n]+\});/,'profileFields = wrap($1);');
  return {result:JSON.parse(vm.runInContext('(function()'+executable+')()',ctx)),reads};
}
test('trip values override globals, false and empty are preserved, person and relation IDs remain distinct',()=>{
  const r=run({pages:[[participant('101',{Lead_Pax:true,Special_Requests:'',Booking_Notes:'',New_Age:0,Age:42})]]});
  assert.equal(r.result.error,false);const p=r.result.result[0];
  assert.equal(p.id,'201');assert.equal(p.PAX_Booking_ID,'101');assert.equal(p.Booking_ID,'301');assert.equal(p.Lead_Pax,false);assert.equal(p.Lead_Passenger,false);
  assert.equal(p.Special_Requests,'');assert.equal(p.Booking_Notes,'');assert.equal(p.Age,0);assert.equal(p.New_Age,0);
});
test('same person in different bookings returns independent trip values',()=>{
  const a=run({pages:[[participant('101',{Lead_Passenger:true,Special_Requests:'trip A'})]]}).result.result[0];
  const b=run({bookingId:'302',pages:[[participant('102',{booking_id:'302',Lead_Passenger:false,Special_Requests:'trip B'})]]}).result.result[0];
  assert.equal(a.id,b.id);assert.notEqual(a.PAX_Booking_ID,b.PAX_Booking_ID);assert.equal(a.Lead_Pax,true);assert.equal(b.Lead_Pax,false);assert.equal(b.Special_Requests,'trip B');
});
test('all pages are read, cancelled participation is excluded and lead comes first',()=>{
  const r=run({pages:[[participant('101')],[participant('102',{pax_id:'202',Lead_Passenger:true}),participant('103',{pax_id:'203',Participation_Status:'Cancelled'})]]});
  assert.equal(r.result.error,false);assert.equal(r.reads.length,2);assert.equal(r.result.excluded_cancelled,1);assert.equal(r.result.result[0].id,'202');assert.equal(r.result.count,2);
});
test('duplicate, foreign, missing references, failed reads and incomplete pagination return no partial list',()=>{
  const variants=[{pages:[[participant('101'),participant('102')]]},{pages:[[participant('101',{booking_id:'999'})]]},{pages:[[participant('101',{pax_id:null})]]},{readError:true},{pages:Array.from({length:10},(_,i)=>[participant(String(i+101),{pax_id:String(i+201)})]),alwaysMore:true}];
  for(const options of variants){const r=run(options);assert.equal(r.result.error,true);assert.deepEqual(r.result.result,[]);assert.deepEqual(r.result.travelers,[]);}
});
test('query cursor rejects metacharacters and empty bookings are a successful empty list',()=>{
  assert.equal(run({bookingId:"301' or id>0"}).result.error,true);const empty=run({pages:[]});assert.equal(empty.result.error,false);assert.equal(empty.result.count,0);
  assert.doesNotMatch(source,/type\s*:\s*(PUT|DELETE)|\.createRecord\(|\.updateRecord\(/);
});
test('template models retain relation IDs and no longer deduplicate people by display name/email',()=>{
  const booking=fs.readFileSync('crm/participants/templ_buildbookingmodel.dg','utf8');
  assert.match(booking,/travelerKey = ifnull\(traveler.get\("participation_id"\)/);assert.doesNotMatch(booking,/travelerKey = .*full_name/);
  for(const file of ['templ_buildsuppliermodel','templ_buildreconfirmationmodel','drafts_rec_buildsuppliermodel','drafts_new_createdraftsforselection']){
    const model=fs.readFileSync('crm/participants/'+file+'.dg','utf8');assert.match(model,/traveler.put\("participation_id",pax.get\("PAX_Booking_ID"\)\)/);assert.match(model,/traveler.put\("booking_notes"/);
    assert.doesNotMatch(model,/searchRecords\("PAX_X_Bookings"/);
  }
});
test('Communications keeps two same-name/email participants while collapsing repeated occurrences of one relation',()=>{
  const code=fs.readFileSync('crm/participants/templ_buildbookingmodel.dg','utf8').replace(/\r\n/g,'\n');
  const start=code.indexOf('travelerKey = ifnull(traveler.get("participation_id")');
  const end=code.indexOf('\n\t\t\t}\n\t\t\tfor each  stepGroup',start);
  assert.ok(start>=0&&end>start);
  const body=code.slice(start,end);
  const output=[],keys=new Set();
  const context=vm.createContext({rows:[{participation_id:'101',full_name:'Alex Morgan',email:'same@example.com'},{participation_id:'102',full_name:'Alex Morgan',email:'same@example.com'},{participation_id:'101',full_name:'Alex Morgan',email:'same@example.com'}],
    ifnull:(a,b)=>a==null?b:a,travelerKeys:{containKey:key=>keys.has(key),put:key=>keys.add(key)},travelers:{add:value=>output.push(value)}});
  vm.runInContext('for (const row of rows) { traveler={get:key=>row[key]};'+body+'}',context);
  assert.equal(output.length,2);assert.deepEqual([...keys],['101','102']);
});
