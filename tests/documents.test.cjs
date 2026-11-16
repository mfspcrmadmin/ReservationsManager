const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../app/js/documents-api.js'), 'utf8');
function setup() { const c = vm.createContext({}); require('./helpers/widget-permissions.cjs').load(c); vm.runInContext(source.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''), c); return c; }
const admin = () => ({ currentUserId:'123', currentUserEmail:'admin@example.com', bookingTagRelationships:[{User_ID:'123',Email:'admin@example.com',Profile:'Administrator',Status:'Active'}] });

test('creation rejects missing, blank and oversized document names before sending', async () => {
  const c=setup();
  for(const document_name of [undefined,'','   ','x'.repeat(256)]) {
    await assert.rejects(c.requestDocuments(admin(),'create',{booking_id:'987',document_type:'FID',document_name},{invoke:()=>assert.fail('invalid name must not create a document')}),/document name/);
  }
});

test('deletion requires explicit confirmation and a known revision before calling CRM', async () => {
  const c = setup();
  const values = {booking_id:'987',document_id:'123456',revision:3,confirm_delete:true};
  for (const patch of [{confirm_delete:false},{revision:NaN},{revision:0},{document_id:''}]) {
    await assert.rejects(c.requestDocuments(admin(),'delete',{...values,...patch},{invoke:()=>assert.fail('invalid deletion must not reach CRM')}), /Refresh the list/);
  }
  let sent;
  await c.requestDocuments(admin(),'delete',values,{invoke:async(name,args)=>{
    sent=JSON.parse(JSON.parse(args.arguments).requestBody);
    return {status:'OK',deleted:true};
  }});
  assert.deepEqual(sent,{...values,action:'delete'});
  await assert.rejects(c.requestDocuments({},'delete',values,{invoke:()=>assert.fail('unauthorised deletion')}), /Administrators/);
});

test('creation sends the selected type and booking, rejecting unsupported types before the SDK', async () => {
  const c = setup();
  for (const document_type of ['FID', 'Proposal', 'Quote']) {
    let payload;
    const result = await c.requestDocuments(admin(), 'create', {booking_id:'987', document_type, document_name:'  My named document  '}, {
      invoke: async (name, args) => {
        payload = JSON.parse(JSON.parse(args.arguments).requestBody);
        return {status:'OK',document_id:'173309000005596968'};
      }
    });
    assert.deepEqual(payload,{booking_id:'987',document_type,document_name:'My named document',action:'create'});
    assert.equal(result.document_id,'173309000005596968');
  }
  for (const document_type of ['', 'Invoice', 'quote']) {
    await assert.rejects(c.requestDocuments(admin(), 'create', {booking_id:'987',document_type},{invoke:()=>assert.fail('invalid type must not reach SDK')}), /Choose FID/);
  }
});

test('document access requires one canonical relationship with exact Administrator profile', () => {
  const c = setup();
  assert.equal(c.canManageDocuments(admin()), true);
  for (const state of [ {}, { ...admin(), currentUserEmail:'other@example.com' }, { ...admin(), bookingTagRelationships:[{User_Alias:'Admin',Profile:'Administrator'}] }, { ...admin(), bookingTagRelationships:[...admin().bookingTagRelationships,...admin().bookingTagRelationships] }, { ...admin(), bookingTagRelationships:[{User_ID:'123',Email:'admin@example.com',Profile:'Sales Standard'}] }]) assert.equal(c.canManageDocuments(state), false);
  assert.equal(c.canManageDocuments({...admin(), currentUserIsAdministrator:false}),true);
});

test('inactive, mismatched and duplicate-ID administrators cannot call the document endpoint', async () => {
  const c = setup();
  for (const change of [
    s => { s.bookingTagRelationships[0].Status = 'Inactive'; },
    s => { s.bookingTagRelationships[0].User_ID = 'other'; },
    s => { s.bookingTagRelationships.push({ ...s.bookingTagRelationships[0], Email: 'other@example.com' }); }
  ]) {
    const state = admin(); change(state);
    await assert.rejects(c.requestDocuments(state, 'list', { booking_id: '987' }, { invoke: () => assert.fail('Denied relationship must not reach CRM') }), /Administrators/);
  }
});

test('gateway receives no browser authorization claims and errors are not treated as empty documents', async () => {
  const c = setup(); let call;
  const res = await c.requestDocuments(admin(),'list',{booking_id:'987'}, {invoke:async (...args) => {call=args; return {details:{output:JSON.stringify({status:'OK',documents:[]})}};}});
  assert.equal(res.status,'OK');
  assert.equal(call[0],'traveldocumentseditor');
  assert.deepEqual(JSON.parse(JSON.parse(call[1].arguments).requestBody),{booking_id:'987',action:'list'});
  await assert.rejects(c.requestDocuments({},'list',{booking_id:'987'},{invoke:()=>assert.fail('must not call')}),/Administrators/);
  await assert.rejects(c.requestDocuments(admin(),'list',{booking_id:'bad'},{invoke:()=>assert.fail('must not call')}),/booking/);
  await assert.rejects(c.requestDocuments(admin(),'list',{booking_id:'987'},{invoke:async()=>({details:{output:'{"status":"ERROR","message":"Denied"}'}})}),/Denied/);
  assert.throws(()=>c.unwrapDocumentResponse({code:'SUCCESS'}),/valid editor response/);
});

test('revoked client access discards an in-flight response', async () => {
  const c=setup(), state=admin(); let finish;
  const promise=c.requestDocuments(state,'get',{booking_id:'987'},{invoke:()=>new Promise(resolve=>finish=resolve)});
  state.bookingTagRelationships=[]; finish({status:'OK'});
  await assert.rejects(promise,/no longer/);
});

test('long text fragments join losslessly and partial or duplicated content is rejected', () => {
  const c=setup();
  const blocks=[{id:'1',key:'crm-step:123:part:0',order:10,title:'Title',body:'First\n',visibility:'Included'}, {id:'2',key:'crm-step:123:part:1',order:11,title:'',body:'Second',visibility:'Hidden'}];
  const groups=c.groupDocumentBlocks(blocks);
  assert.equal(groups.length,1); assert.equal(groups[0].body,'First\nSecond'); assert.equal(groups[0].title,'Title'); assert.equal(groups[0].visible,false);
  assert.throws(()=>c.groupDocumentBlocks([blocks[1]]),/missing/);
  assert.throws(()=>c.groupDocumentBlocks([blocks[0],blocks[0]]),/duplicated/);
  const edit=c.buildBlockEdit(groups[0],{title:'New',body:'<b>literal</b>',image:'',visible:true});
  assert.equal(edit.body,'<b>literal</b>'); assert.equal(edit.visibility,'Included');
  assert.throws(()=>c.buildBlockEdit(groups[0],{body:'x'.repeat(12001)}),/exceeds/);
  assert.throws(()=>c.buildBlockEdit(groups[0],{image:'javascript:alert(1)'}),/HTTPS/);
});

test('widget invocation sends no caller-supplied authorization context', async () => {
  const c = setup(); let argumentsSent;
  await c.requestDocuments(admin(), 'list', { booking_id: '987' }, { invoke: async (_, args) => {
    argumentsSent = JSON.parse(args.arguments);
    return { status: 'OK', documents: [] };
  }});
  assert.deepEqual(Object.keys(argumentsSent), ['requestBody']);
  assert.deepEqual(JSON.parse(argumentsSent.requestBody), { booking_id: '987', action: 'list' });
  assert.doesNotMatch(source, /CONNECTION.invoke|signingKey/);
});

test('document logs correlate SDK and server stages without recording document content or credentials', async () => {
  const c=setup(); const events=[];
  const logger=(event,details)=>events.push({event,...details});
  await assert.rejects(c.requestDocuments(admin(),'save_block',{
    booking_id:'987',document_id:'12345',revision:2,
    edit:{title:'PRIVATE TITLE',body:'PRIVATE DOCUMENT TEXT',image:'https://example.com/PRIVATE-IMAGE'}
  },{logger,invoke:async()=>({code:'success',details:{output:JSON.stringify({status:'ERROR',source:'Creator',stage:'REQUEST_SIGNATURE',payload:'SECRET PAYLOAD',signature:'PRIVATE KEY'})}})}),/Creator/);
  assert.deepEqual(events.map(e=>e.event),['request','sdk-response','response','error']);
  assert.equal(new Set(events.map(e=>e.request_id)).size,1);
  assert.equal(events[0].booking_id,'987');
  assert.equal(events[2].source,'Creator');
  assert.equal(events[2].stage,'REQUEST_SIGNATURE');
  assert.doesNotMatch(JSON.stringify(events),/PRIVATE|SECRET PAYLOAD|admin@example/);
  events.length=0;
  await assert.rejects(c.requestDocuments(admin(),'list',{booking_id:'987'},{logger,invoke:async()=>{throw {code:'FUNCTION_NOT_FOUND',responseText:'SECRET PAYLOAD'};}}));
  assert.equal(events.at(-1).phase,'CRM_SDK');
  assert.equal(events.at(-1).code,'FUNCTION_NOT_FOUND');
  assert.doesNotMatch(JSON.stringify(events),/SECRET PAYLOAD/);
});

test('workspace responses must match the requested document and confirm a new saved revision', () => {
  const c=setup(), values={document_id:'123',revision:4};
  const response={document:{id:'123',revision:5},blocks:[{key:'cover:part:0',order:1,body:'Cover',visibility:'Included'}]};
  assert.equal(c.validateDocumentWorkspaceResponse('save_block',values,response),response);
  for(const action of ['get','save_block','save_settings']) {
    assert.throws(()=>c.validateDocumentWorkspaceResponse(action,values,{document:{id:'999',revision:5},blocks:[]}),/does not match/);
    assert.throws(()=>c.validateDocumentWorkspaceResponse(action,values,{document:{id:'123',revision:5}}),/does not match/);
  }
  for(const action of ['save_block','save_settings']) assert.throws(()=>c.validateDocumentWorkspaceResponse(action,values,{document:{id:'123',revision:4},blocks:[]}),/not confirmed/);
  assert.throws(()=>c.validateDocumentWorkspaceResponse('list',{},{}),/could not be verified/);
  assert.throws(()=>c.validateDocumentWorkspaceResponse('save_settings',values,{document:{id:'123',revision:5},blocks:[]}),/no editable sections/);
  assert.deepEqual(c.validateDocumentWorkspaceResponse('list',{}, {documents:[]}),{documents:[]});
});
