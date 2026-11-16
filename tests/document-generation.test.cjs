const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const context=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/js/document-generation.js'),'utf8').replace(/^export /gm,''),context);
const run=context.generateDocumentInBatches;
const values={document_id:'12',revision:4,request_key:'same-key-every-time'};
test('continues each phase with one request key and only accepts a completed version',async()=>{
 const responses=[{pending:true,phase:'records',completed:2,total:3},{pending:true,phase:'records',completed:3,total:3},{pending:true,phase:'contacts',completed:1,total:0},{pending:true,phase:'saving',completed:48000,total:70000},{version_id:'99'}];
 const calls=[],progress=[];
 const result=await run(async(action,payload)=>{calls.push({action,payload});return responses.shift();},values,{isCurrent:()=>true,onProgress:m=>progress.push(m)});
 assert.equal(result.version_id,'99');assert.equal(calls.length,5);assert.equal(progress.length,4);
 assert.ok(calls.every(c=>c.action==='generate'&&c.payload===values));
 assert.equal(progress[0].label,'Loading booking data');assert.equal(progress[0].completed,2);assert.equal(progress[0].total,3);
 assert.equal(progress[2].phase,'contacts');assert.equal(progress[2].total,0);
 assert.equal(progress[3].label,'Saving generated preview');assert.equal(progress[3].completed,48000);assert.equal(progress[3].total,70000);
});
test('stops on failure without automatically repeating a possibly running request',async()=>{
 let calls=0;await assert.rejects(run(async()=>{calls++;throw new Error('timeout');},values,{isCurrent:()=>true,onProgress:()=>{}}),/timeout/);assert.equal(calls,1);
});
test('discards in-flight progress after switching booking or revoking access',async()=>{
 let active=true,calls=0;
 const result=await run(async()=>{calls++;active=false;return {pending:true,phase:'records',completed:2,total:9};},values,{isCurrent:()=>active,onProgress:()=>assert.fail('stale progress')});
 assert.equal(result,null);assert.equal(calls,1);
});
test('rejects stalled, malformed and unfinished responses',async()=>{
 for(const response of [{},{pending:true,phase:'unknown',completed:1,total:2},{pending:true,phase:'saving',completed:'1',total:2},{pending:true,phase:'records',completed:1,total:2}]){
 let calls=0;await assert.rejects(run(async()=>{calls++;return response;},values,{isCurrent:()=>true,onProgress:()=>{}}),/incomplete|progress/);assert.ok(calls<=4);
 }
});

// Cleanup is a server phase: repeated zero counters on different versions are real progress.
test('cleanup advances across empty versions and then continues generation with the same key',async()=>{
 const responses=[
  {pending:true,phase:'cleanup',completed:0,total:70,progress_key:'old-a:70'},
  {pending:true,phase:'cleanup',completed:0,total:20,progress_key:'old-a:20'},
  {pending:true,phase:'cleanup',completed:0,total:0,progress_key:'old-a:0'},
  ...['b','c','d','e'].map(id=>({pending:true,phase:'cleanup',completed:0,total:0,progress_key:'old-'+id+':0'})),
  {pending:true,phase:'records',completed:1,total:1},
  {version_id:'new-ready'}
 ];
 const progress=[];let calls=0;
 const result=await run(async(action,payload)=>{assert.equal(action,'generate');assert.equal(payload,values);calls++;return responses.shift();},values,{isCurrent:()=>true,onProgress:p=>progress.push(p)});
 assert.equal(result.version_id,'new-ready');assert.equal(calls,9);
 assert.equal(progress[0].label,'Cleaning incomplete generations');
});

test('cleanup stalls and server cleanup failures stop without retrying deletion requests',async()=>{
 let calls=0;
 await assert.rejects(run(async()=>{calls++;return {pending:true,phase:'cleanup',completed:0,total:20,progress_key:'old:20'};},values,{isCurrent:()=>true,onProgress:()=>{}}),/progress/);
 assert.equal(calls,4);
 calls=0;
 await assert.rejects(run(async()=>{calls++;throw new Error('cleanup failed');},values,{isCurrent:()=>true,onProgress:()=>{}}),/cleanup failed/);
 assert.equal(calls,1);
});

test('Creator cleanup scopes deletion to incomplete versions and removes parent only after all children',()=>{
 const dir=path.join(__dirname,'../_local/integrations/document-generator/creator/functions');
 const source=fs.readFileSync(path.join(dir,'cleanupDocumentGenerations.deluge'),'utf8');
 const generate=fs.readFileSync(path.join(dir,'generateTravelDocument.deluge'),'utf8');
 assert.match(source,/ID != protectedVersion/);
 assert.match(source,/Version_Key != currentVersionKey && Modified_Time < cutoff/);
 assert.match(source,/Build_Status == "Building" && Version_Key != currentVersionKey && Modified_Time >= cutoff/);
 assert.match(source,/latestDocument\.Published_Version_ID/);
 assert.match(source,/sort by ID range from 0 to 49/);
 assert.match(source,/delete from Travel_Document_Block\[ID == fragmentId && Travel_Document == targetId && Document_Version == obsoleteId\]/);
 assert.match(source,/if\(remainingCount == 0\)[\s\S]*delete from Travel_Document_Version\[ID == obsoleteId && Travel_Document == targetId && Build_Status == "Failed"\]/);
 assert.ok(source.indexOf('delete from Travel_Document_Block')<source.indexOf('delete from Travel_Document_Version'));
 assert.ok(generate.indexOf('thisapp.cleanupDocumentGenerations')<generate.indexOf('insert into Travel_Document_Version'));
 assert.match(generate,/version\.CRM_Fingerprint = "Building:"/);
 assert.match(generate,/version\.CRM_Fingerprint = built.get\("crm_fingerprint"\)/);
});

test('shared contact writes count as progress even when replacing existing CRM cache entries',async()=>{
 const responses=[...['1','2','3','4','5'].map(key=>({pending:true,phase:'contacts',completed:20,total:0,progress_key:'fid-saved:crm-service:'+key})),{version_id:'done'}];
 const result=await run(async()=>responses.shift(),values,{isCurrent:()=>true,onProgress:()=>{}});
 assert.equal(result.version_id,'done');
});
