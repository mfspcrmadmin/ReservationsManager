const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('crm/settlements_deleteService.dg','utf8');
function run(options={}){
  const events=[];const context=vm.createContext({options,events});
  vm.runInContext(`class DM{constructor(o={}){this.o=o}get(k){return this.o[k]??null}put(k,v){this.o[k]=v}toString(){return JSON.stringify(this.o)}toJSON(){return this.o}}
    function wrap(v){return Array.isArray(v)?Array.from(v,wrap):v&&typeof v==='object'?new DM(Object.fromEntries(Object.entries(v).map(([k,x])=>[k,wrap(x)]))):v}function Map(){return new DM()}function ifnull(a,b){return a==null?b:a}function isnull(v){return v==null}
    String.prototype.matches=function(p){return new RegExp('^'+p+'$').test(this)};String.prototype.toMap=function(){return wrap(JSON.parse(this))};Array.prototype.isEmpty=function(){return !this.length};Array.prototype.size=function(){return this.length};Array.prototype.get=function(i){return this[i]};
    var serviceId='501';
    function guard(){return wrap({responseCode:options.error?403:options.assignments?200:204,responseText:JSON.stringify({data:[{id:'401'}]})})}
    function remove(){events.push('delete');return wrap({data:[{code:'SUCCESS',status:'success',details:{id:options.wrongId?'999':'501'}}]})}
  `,context);
  const code=source.replace(/^string standalone[^\n]+\n/,'').replace(/invokeurl\s*\[[\s\S]*?\];/g,b=>b.includes('type :POST')?'guard();':'remove();');
  return{result:JSON.parse(JSON.stringify(vm.runInContext('(function()'+code+')()',context))),events};
}
test('assigned services and failed guard reads cannot be deleted',()=>{
  for(const options of [{assignments:true},{error:true}]){const r=run(options);assert.equal(r.result.error,true);assert.deepEqual(r.events,[]);}
});
test('unassigned service deletion is permitted only with matching confirmation ID',()=>{
  assert.equal(run().result.error,false);assert.equal(run({wrongId:true}).result.error,true);
});
