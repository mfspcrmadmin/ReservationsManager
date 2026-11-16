const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('app/js/automatic-notifications.js','utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
function setup() { const c=vm.createContext({}); vm.runInContext(source,c); return c; }
const row = (id, mode='Automatic', extra={}) => ({id:String(id),Booking:{id:'123'},Execution_Mode:mode,...extra});
test('booking-scoped pagination preserves legacy manual records and separates only Automatic',async()=>{
 const c=setup(), calls=[];
 const rows=await c.loadBookingCommunications('123',async(...args)=>{calls.push(args); return args[2]===1?Array.from({length:200},(_,i)=>row(i,i===0?'Automatic':undefined)):[row('last','Manual')];});
 assert.equal(rows.length,201); assert.equal(calls[0][1],'(Booking:equals:123)');
 const mails=[{communication_id:'0'},{communication_id:'last'}];
 assert.equal(c.excludeAutomaticMail(mails,rows).length,1);
 assert.equal(c.excludeAutomaticMail([{communication_id:'legacy'}],[row('legacy',null)]).length,1);
 assert.throws(()=>c.excludeAutomaticMail([{communication_id:'missing'}],rows),/access/);
});
test('foreign rows, failed pages, duplicate pages and limits do not return partial success',async()=>{
 const c=setup();
 await assert.rejects(c.loadBookingCommunications('123',async()=>[row(1,'Automatic',{Booking:{id:'456'}})]),/access/);
 await assert.rejects(c.loadBookingCommunications('123',async()=>{throw Error('denied');}),/denied/);
 await assert.rejects(c.loadBookingCommunications('123',async()=>Array.from({length:200},()=>row(1))),/Repeated/);
 await assert.rejects(c.loadBookingCommunications('123',async(_,__,page)=>Array.from({length:200},(_,i)=>row(page*200+i))),/limit/);
});
test('automatic list sorts by send date then creation date without changing send status',()=>{
 const c=setup(); const rows=c.automaticRows([row('a','Automatic',{Created_Time:'2026-11-01',Sent_At:'2026-11-11',Communication_Status:'Sent',Render_Status:'Failed'}),row('b','Automatic',{Created_Time:'2026-11-10'}),row('c','Manual')]);
 assert.deepEqual(Array.from(rows,r=>r.id),['a','b']); assert.equal(rows[0].Communication_Status,'Sent');
});
test('full native archive uses exact draft ID and never technical recipient fields',async()=>{
 const c=setup(), body='<p>'+ 'x'.repeat(36812)+'</p>';
 const record=row(1,'Automatic',{Render_Model_JSON:JSON.stringify({native_email_archive:{storage:'__email_drafts',draft_id:'right',html_characters:body.length}}),Recipient_To:'real@example.com'});
 const result=await c.readArchivedBody(record,'123',async()=>record,async()=>[{id:'wrong',content:'wrong'},{id:'right',content:body,to:'technical@example.com'}]);
 assert.equal(result.body,body); assert.equal(result.row.Recipient_To,'real@example.com');
 assert.equal(c.selectArchivedBody(record,[{id:'wrong',content:body}]),'');
 assert.throws(()=>c.selectArchivedBody(record,[{id:'right',content:'short'}]),/complete/);
 await assert.rejects(c.readArchivedBody(record,'123',async()=>row(1,'Automatic',{Booking:{id:'456'}}),async()=>assert.fail('No archive read for a foreign booking')),/access/);
});
test('published native archive reader unwraps CRM envelopes and rejects errors or truncated scans',async()=>{
 const c=setup(); const calls=[];
 const rows=await c.readDrafts('1',async(...args)=>{calls.push(args);return {code:'success',details:{output:JSON.stringify({error:false,data:[{id:'draft',content:'full body'}]})}};});
 assert.equal(rows[0].content,'full body');assert.equal(calls[0][0],'email_getmoduleemaildrafts');assert.equal(calls[0][1].module,'Communications');
 await assert.rejects(c.readDrafts('1',async()=>({error:true,data:[]})),/Could not read/);
 await assert.rejects(c.readDrafts('1',async()=>({error:false,data:Array(100).fill({id:'1'})})),/limit/);
});
test('recipient summaries remain compact and preserve all addresses in the detail source',()=>{
 const c=setup();
 const addresses=Array.from({length:45},(_,i)=>`person${i}@example.com`).join(',');
 assert.equal(c.recipientSummary(addresses),'person0@example.com +44 recipients');
 assert.equal(c.recipientAddresses(addresses).length,45);
 assert.equal(c.recipientSummary('Name <one@example.com>; two@example.com'),'one@example.com +1 recipient');
 assert.equal(c.recipientSummary(''),'Not specified');
 assert.equal(c.recipientAddresses('one@example.com,ONE@example.com').length,1);
});
test('automatic history is secondary to Emails and returning preserves the manual selection',()=>{
 const html=fs.readFileSync('app/widget.html','utf8');
 assert.ok(!/<button id="tab-automatic" class="page-tab"/.test(html));
 const entry=html.indexOf('id="tab-automatic"');
 assert.ok(entry>html.indexOf('id="manage-emails-panel"'));
 assert.ok(html.slice(entry,entry+220).includes('aria-controls="manage-automatic-panel"'));
 const controller=fs.readFileSync('app/js/booking-controller.js','utf8');
 assert.match(controller,/const returningFromAutomatic = state.activeTab === "automatic" && tabName === "emails"/);
 assert.match(controller,/if \(!returningFromAutomatic\) clearSelectedMailPreview\(\)/);
});
