const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function setup(storage=new Map()) {
  const context=vm.createContext({state:{serviceTableColumns:[]},elements:{serviceColumnsList:{querySelectorAll:()=>[]}},window:{localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)}}});
  const clean=source=>source.replace(/^import[\s\S]*?from\s+["'][^"']+["'];/gm,'').replace(/^export /gm,'');
  vm.runInContext(clean(fs.readFileSync('app/js/constants.js','utf8'))+'\n'+clean(fs.readFileSync('app/js/services-controller.js','utf8')),context);
  context.renderServicesWorkspace=()=>{};
  context.initializeServiceTableColumns();
  return context;
}
const keys=context=>Array.from(context.state.serviceTableColumns,column=>column.key);
function row(key){return {getAttribute:()=>key,closest(){return this},classList:{add(){}},getBoundingClientRect:()=>({top:0}),offsetHeight:40};}
test('dragged column order survives a fresh initialization and view switches',()=>{
  const storage=new Map(), first=setup(storage);
  first.onServiceColumnsListDragStart({target:row('purchase')});
  first.onServiceColumnsListDrop({target:row('serviceName'),clientY:0,preventDefault(){}});
  first.onServiceColumnsListDragEnd();
  assert.equal(keys(first)[0],'purchase');
  const chosen=keys(first);
  first.setServiceView('grouped');first.setServiceView('flat');
  assert.deepEqual(keys(first),chosen);
  const reloaded=setup(storage);
  assert.deepEqual(keys(reloaded),chosen);
});
test('visibility edits retain the chosen order after reload',()=>{
  const storage=new Map(), first=setup(storage);
  first.onServiceColumnsListDragStart({target:row('supplier')});
  first.onServiceColumnsListDrop({target:row('serviceName'),clientY:0,preventDefault(){}});
  first.onServiceColumnsListChange({target:{getAttribute:()=> 'date',checked:false}});
  const reloaded=setup(storage);
  assert.deepEqual(keys(reloaded),keys(first));
  assert.equal(reloaded.state.serviceTableColumns.find(column=>column.key==='date').visible,false);
});
