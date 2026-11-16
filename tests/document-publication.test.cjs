const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const context=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/js/document-publication.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''),context);
const saved={document:{revision:4},generated_version_id:'9001',generated_draft_revision:4,generation_current:true};
test('reopening a generated unchanged document allows publication',()=>{
  assert.equal(context.publicationAvailability(saved,true).enabled,true);
  assert.equal(context.publicationAvailability(saved,true).warning,'');
});
test('CRM freshness mismatch warns without blocking publication of the saved version',()=>{
  const result=context.publicationAvailability({...saved,generation_current:false},true);
  assert.equal(result.enabled,true);
  assert.match(result.warning,/latest CRM changes/);
});
test('missing saved versions, newer section revisions and readonly documents remain blocked',()=>{
  assert.equal(context.publicationAvailability({...saved,generated_version_id:''},true).enabled,false);
  assert.equal(context.publicationAvailability({...saved,document:{revision:5}},true).enabled,false);
  assert.equal(context.publicationAvailability(saved,false).enabled,false);
});
