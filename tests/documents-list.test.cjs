const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../app/js/documents-list.js'),'utf8');
const e=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const c=vm.createContext({e,URL});
vm.runInContext(source.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''),c);

test('loading shows a spinner and never implies an empty document list',()=>{
 const html=c.renderDocumentsLibrary([],{loading:true});
 assert.match(html,/documents-list-loading/);
 assert.match(html,/mail-send-spinner/);
 assert.match(html,/aria-busy="true"/);
 assert.doesNotMatch(html,/No travel documents yet|documents-count/);
 assert.match(c.renderDocumentsLibrary([]),/No travel documents yet/);
 assert.doesNotMatch(c.renderDocumentsLibrary([]),/mail-send-spinner/);
});

test('document dates use Madrid DST and never fill in missing or unzoned dates',()=>{
  assert.match(c.formatDocumentDate('2026-09-24T08:42:00Z'),/^24 Sept? 2026 · 10:42$/);
  assert.match(c.formatDocumentDate('2026-01-24T08:42:00Z'),/^24 Jan 2026 · 09:42$/);
  for(const value of [null,'','bad','2026-09-24 10:42:00']) assert.equal(c.formatDocumentDate(value),'—');
});
test('sorting uses modification then creation, preserving missing dates and original input',()=>{
  const docs=[{id:'1'},{id:'2',created_at:'2026-09-24T08:00:00Z'},{id:'3',created_at:'2026-01-01T00:00:00Z',updated_at:'2026-09-25T08:00:00Z'},{id:'4',updated_at:'bad',created_at:'2026-09-23T08:00:00Z'}];
  assert.equal(c.sortDocuments(docs).map(d=>d.id).join(','),'3,2,4,1');
  assert.equal(docs.map(d=>d.id).join(','),'1,2,3,4');
});
test('technical version keys are labelled in details and never displayed as version numbers',()=>{
  const doc={id:'1',title:'<img src=x onerror=bad>',type:'FID',status:'Draft',revision:99};
  const plain=c.renderDocumentsLibrary([doc]);
  assert.ok(!plain.includes('scope="col">Version'));
  assert.ok(plain.includes('&lt;img src=x onerror=bad&gt;'));
  const versioned=c.renderDocumentsLibrary([{...doc,version_key:'published-v2'}, {...doc,id:'2'}]);
  assert.ok(!versioned.includes('scope="col">Version'));
  assert.ok(versioned.includes('published-v2'));
  assert.ok(versioned.includes('Published version identifier: published-v2'));
  assert.match(versioned,/<thead><tr><th scope="col" class="documents-actions-heading">Actions<\/th><th scope="col">Document/);
  assert.ok(versioned.includes('Edit document:'));
});
test('copy is offered only for a confirmed, published, unexpired HTTPS share URL',()=>{
  const doc={id:'1',title:'Document',status:'Published',shareable:true,share_url:'https://example.com/shared?t=abc'};
  assert.equal(c.documentShareLink(doc),doc.share_url);
  for(const patch of [{status:'Draft'},{shareable:false},{share_url:'javascript:alert(1)'},{share_url:'https://user:pass@example.com/'},{share_expires_at:'2000-01-01T00:00:00Z'},{share_expires_at:'bad'}]){
    assert.equal(c.documentShareLink({...doc,...patch}),'');
    assert.ok(!c.renderDocumentsLibrary([{...doc,...patch}]).includes('data-doc-copy='));
  }
  assert.ok(c.renderDocumentsLibrary([doc]).includes('data-doc-copy='));
});
