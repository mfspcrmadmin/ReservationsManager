const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const e=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const c=vm.createContext({e});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/js/document-crm-fields.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''),c);
test('FID working copies project CRM without mutating snapshots; legacy published documents stay readonly',()=>{
 const groups=[{key:'crm-step:1',origin:'CRM',title:'Saved title',body:'Saved body',visible:true},{key:'template:journey',body:'Saved dates'}];
 const record={title:'Current title',body:'Current body',active:false,start:'2026-07-14T09:00:00+02:00'};
 const response={crm_live:true,document:{type:'FID',status:'Draft'},sources:[{booking_id:'987'}],crm_records:{'crm-step:1':record,'booking:987':{id:'987'}},journey_body:'Current dates'};
 const live=c.applyDocumentCRM(groups,response);
 assert.equal(live[0].title,'Current title');assert.equal(live[0].crmActive,false);assert.equal(live[1].body,'Current dates');
 assert.equal(groups[0].title,'Saved title');
 const published={...response,document:{type:'FID',status:'Published',render_mode:'Versioned',published_version_id:'9001'}};
 assert.equal(c.applyDocumentCRM(groups,published)[0].title,'Current title');
 assert.equal(published.document.published_version_id,'9001');
 assert.equal(groups[0].title,'Saved title');
 for(const document of [{type:'FID',status:'Published'},{type:'Proposal',status:'Draft'}]) assert.equal(c.applyDocumentCRM(groups,{...response,document}),groups);
 assert.throws(()=>c.applyDocumentCRM(groups,{...response,crm_records:{}}),/incomplete/);
});
test('field updates contain only changed configured fields and preserve timezone offsets',()=>{
 const record={fields:[{api_name:'Short_Description',label:'Title',type:'text',max_length:255,value:'Same'},{api_name:'Start_Date_Time',label:'Start',type:'datetime',max_length:120,value:''}]};
 const inputs=[{dataset:{crmField:'Short_Description'},value:'Same'},{dataset:{crmField:'Start_Date_Time'},value:'2026-07-14T09:00:00+02:00'}];
 const section={querySelectorAll:()=>inputs};
 assert.equal(JSON.stringify(c.collectCRMChanges(section,record)),JSON.stringify({Start_Date_Time:'2026-07-14T09:00:00+02:00'}));
 inputs[1].value='2026-07-14T09:00';assert.throws(()=>c.collectCRMChanges(section,record),/timezone/);
 inputs[1].value='';inputs[0].value='x'.repeat(256);assert.throws(()=>c.collectCRMChanges(section,record),/too long/);
});
test('CRM field HTML escapes values and names and announces effects beyond this document',()=>{
 const html=c.renderCRMFields([{id:'1',module:'Booking_Steps',label:'<unsafe>',fields:[{api_name:'Long_Description',label:'Description',type:'textarea',max_length:32000,value:'</textarea><script>bad</script>'}]}]);
 assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;unsafe&gt;'));assert.ok(html.includes('every draft'));assert.ok(html.includes('Save to CRM'));
});
