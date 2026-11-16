const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage({viewport:{width:450,height:850}});
  await page.route('https://**/*',r=>r.abort());
  await page.setContent('<style>'+fs.readFileSync(path.join(__dirname,'../app/styles/booking-documents.css'),'utf8')+'</style><div class="document-studio"><aside class="studio-inspector"><div class="studio-section-editor"></div><div id="fields"></div></aside></div>');
  await page.addScriptTag({content:'const e=v=>String(v??"").replace(/[&<>"\x27]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","\\\"":"&quot;","\x27":"&#39;"}[ch]));'});
  for(const name of ['document-service-rules','document-crm-direct','document-crm-fields','document-rules-editor']){
   await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../app/js/'+name+'.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')});
  }
  await page.evaluate(()=>{
   window.fid={module:'Booking_Steps',id:'1',booking_id:'2',key:'crm-step:1',step_id:'1',fid_contact:{mode:'Automatic',status:'Not found',source:'Step Contact'},fields:[
    {api_name:'FID_Contact_Name',label:'FID Contact Name',type:'text',max_length:255,contact_setting:true,value:''},
    {api_name:'FID_Contact_Phone',label:'FID Contact Phone',type:'text',max_length:255,contact_setting:true,value:''},
    {api_name:'FID_Contact_Mode',label:'FID Contact Mode',type:'picklist',options:['Automatic','Manual'],max_length:120,contact_setting:true,value:'Automatic'},
    {api_name:'FID_Contact_Status',label:'FID Contact Status',type:'picklist',options:['Pending','Resolved','Not found','Needs selection'],max_length:120,contact_setting:true,value:'Not found'},
    {api_name:'FID_Contact_Source',label:'FID Contact Source',type:'picklist',options:['Document Default','Step Contact','Service Contacts','None'],max_length:120,contact_setting:true,value:'Step Contact'}
   ]};
   document.querySelector('#fields').innerHTML=renderCRMFields([fid]);
   mountSectionRules(document.querySelector('aside'),{key:fid.key,origin:'CRM',crmRecords:[fid]},{settings:{}},{[fid.key]:fid},()=>{});
  });
  assert.equal(await page.getByLabel('FID Contact Source',{exact:true}).inputValue(),'Step Contact');
  assert.equal(await page.getByLabel('FID Contact Status',{exact:true}).inputValue(),'Not found');
  assert.equal(await page.locator('[data-field-eye]').count(),0);
  assert.equal(await page.getByRole('button',{name:'Load supplier contacts',exact:true}).count(),0);
  await page.getByLabel('FID Contact Name',{exact:true}).fill('Angela Manual');
  await page.getByLabel('FID Contact Phone',{exact:true}).fill('+34 123');
  const update=await page.evaluate(()=>prepareCRMUpdate(fid,collectCRMChanges(document.querySelector('.studio-crm-record'),fid)));
  assert.equal(update.FID_Contact_Mode,'Manual');assert.equal(update.FID_Contact_Status,'Resolved');
  await page.getByLabel('FID Contact Name',{exact:true}).fill('');
  await page.getByLabel('FID Contact Phone',{exact:true}).fill('');
  await page.getByLabel('FID Contact Status',{exact:true}).selectOption('Pending');
  const retry=await page.evaluate(()=>prepareCRMUpdate(fid,collectCRMChanges(document.querySelector('.studio-crm-record'),fid)));
  assert.equal(retry.FID_Contact_Name,null);assert.equal(retry.FID_Contact_Phone,null);
  console.log('Shared FID contact CRM controls: browser checks passed');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
