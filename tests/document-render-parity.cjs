// Local renderer/CSS contract check; does not execute Deluge or contact Zoho.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=process.env.TRAVEL_DOCUMENTS_ROOT || path.resolve(__dirname,'../_local/integrations/document-generator');
const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const context=vm.createContext({escapeHtml:e});
for(const file of ['document-presentation','document-service-rules','document-text-format','document-editorial','document-crm-fields','document-output-dates','document-category-config','document-category-layout','document-studio-layout'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/js/'+file+'.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''),context);
const activity={key:'crm-step:1',origin:'CRM',type:'Activity',step_id:'1',visible:true,title:'Granada to Madrid by train, with private transfers included.',start:'2026-07-14T14:00:00+02:00',crmRecords:[{fields:[],city:'Granada'}]};
const groups=[{key:'template:journey',type:'Journey_Info',title:'Journey Information',body:'',visible:true},{key:'template:overview',type:'Overview',title:'Overview',body:'',visible:true},{key:'template:program',type:'Itinerary',title:'Program',body:'',visible:true},{key:'template:practical',type:'Text',title:'Practical',body:'',visible:true},{key:'template:contacts',type:'Contacts',title:'Contacts',body:'',visible:true},activity];
const ezus=fs.readFileSync(path.join(root,'ezus/websites_templates/FID_WEB'),'utf8');
const menu=ezus.match(/<ul class="nav-menu"[^>]*>([\s\S]*?)<\/ul>/)[1];
const expectedNavigation=[...menu.matchAll(/<a[^>]*>([^<]+)<\/a>/g)].map(match=>match[1]);
const studio=context.renderStudioPreview(groups,{type:'FID'});
const renderer=fs.readFileSync(path.join(root,'creator/functions/renderPreparedDocumentDraft.deluge'),'utf8');
assert.ok(renderer.includes('ifnull(crmDisplayField.get("value"),"").toString().trim() != ""'),'generated details omit whitespace-only values');
assert.ok(renderer.includes('presentation.get("cover_note").htmlEncode() + "</p>" + sectionImageHtml'),'cover preserves its image');
assert.ok(renderer.indexOf('bodyHtml = bodyHtml + sectionImageHtml;')>renderer.indexOf('if(blockType == "Contacts") { sectionId'),'contact layout does not overwrite its image');
const previewLogic=fs.readFileSync(path.join(root,'creator/pages/Travel_Document_Preview.logic'),'utf8');
assert.ok(previewLogic.includes('ifnull(chunk.Body_Text,"") == ""'),'preview rejects empty version chunks, like the public reader');
for(const type of ['Cover','Contacts']){
 const group={key:'image-test',type,title:'Title',body:'',visible:true,image:'https://example.com/cover.png'};
 assert.ok(context.renderStudioPaper(group,{type:'FID'},[group]).includes('https://example.com/cover.png'));
}
const emptyActivity={...activity,crmRecords:[{fields:[{api_name:'Meeting_Details',label:'Empty label',value:' \n '},{api_name:'Guests',label:'Guests',value:'0'}]}]};
const emptyHtml=context.renderStudioPaper(emptyActivity,{type:'FID'},[emptyActivity]);
assert.ok(!emptyHtml.includes('Empty label'));
assert.ok(emptyHtml.includes('<dd>0</dd>'),'zero is content, not empty');
const publicProgram='<details class="mfsp-day" open><summary><span class="fid-day-number">Day 1</span><span class="fid-day-label"><span class="fid-day-date">Tuesday, July 14, 2026</span><span class="fid-day-destinations">Granada</span></span></summary><div class="mfsp-day-content"><article class="mfsp-step fid-entry fid-entry--step"><header class="fid-entry-heading"><div><span class="fid-entry-kind">Details</span><h4>'+activity.title+'</h4></div><span class="fid-entry-time"><small>START</small>14:00</span></header><div class="fid-entry-body"><div class="fid-entry-content"></div></div></article></div></details>';
// Simulate only the generated navigation expression, not the Deluge runtime.
function navigation(html, available) {
 return html.replace(/<%=if\((?:previewHtml|snapshotHtml)\.contains\("id='([^']+)'"\),"([^"]*)","([^"]*)"\)%>/g,(_,anchor,yes,no)=>available.includes(anchor)?yes:no);
}
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
const page=await browser.newPage({reducedMotion:'reduce'});await page.route('**/*',r=>r.request().url().includes('workdrive-public/download')?r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1417" height="709"></svg>'}):r.abort());
for(const width of [1280,390]){
 const results=[];
 for(const surface of ['Studio','Travel_Document_Preview','Travel_Document_Viewer_FID']){
  const snippet=surface==='Studio'?'':fs.readFileSync(path.join(root,'creator/pages/'+surface+'.snippet.html'),'utf8');
  const css=surface==='Studio'?fs.readFileSync(path.join(__dirname,'../app/styles/booking-documents.css'),'utf8'):snippet.match(/<style>([\s\S]*?)<\/style>/)[1];
  const rawHeader=surface==='Studio'?'':snippet.match(/<nav class="mfsp-nav"[\s\S]*?<\/nav>/)[0];
  const header=navigation(rawHeader,['mfsp-journey','mfsp-overview','mfsp-program','mfsp-practical','mfsp-contacts']);
  if(surface!=='Studio'){
   await page.setContent(navigation(rawHeader,['mfsp-program']));
   assert.equal(await page.locator('a[href="#mfsp-program"]').count(),2);
   assert.equal(await page.locator('a[aria-disabled="true"]').count(),7);
   assert.equal(await page.locator('a[aria-disabled="true"][href]').count(),0);
  }
  const html=surface==='Studio'?'<div class="document-studio">'+studio+'</div>':'<div class="mfsp-fid">'+header+publicProgram+'</div>';
  await page.setViewportSize({width,height:1000});await page.setContent(html);await page.addStyleTag({content:css.replace(/@import[^;]+;/g,'')+' body{margin:0} .document-studio{position:static;} *,*::before,*::after{transition:none!important;animation:none!important;}'});
  const data=await page.evaluate(()=>{
   const header=document.querySelector('.studio-preview-header,.mfsp-nav'),heading=document.querySelector('.fid-entry-heading'),time=heading.querySelector('.fid-entry-time'),title=heading.querySelector('h4');
   const r=heading.getBoundingClientRect(),t=time.getBoundingClientRect(),h=title.getBoundingClientRect();
   const day=getComputedStyle(document.querySelector('.fid-day-date'));
   return {dayFont:day.fontFamily,dayWeight:day.fontWeight,startRight:r.right-t.right,startTop:t.top-h.top,headerHeight:header.getBoundingClientRect().height,links:[...header.querySelectorAll('.fid-desktop-links > *')].map(el=>({text:el.textContent,font:getComputedStyle(el).font,left:el.getBoundingClientRect().left,width:el.getBoundingClientRect().width})),support:header.querySelector('.fid-nav-support').getBoundingClientRect().toJSON(),logoWidth:header.querySelector('img').getBoundingClientRect().width};
  });

  assert.ok(data.startRight>=0,surface+' Start stays inside heading '+data.startRight);if(width>700)assert.ok(Math.abs(data.startTop)<60,surface+' Start remains close to title');
  assert.deepEqual(data.links.map(link=>link.text),expectedNavigation,surface+' must use the Ezus menu');
  assert.ok(data.dayFont.includes('Playfair Display'));results.push(data);
  await page.locator('.fid-entry-heading h4').evaluate(node=>node.textContent='A very long private journey with several transfers and visits — '+ 'LongReference'.repeat(25));
  const overflow=await page.locator('.fid-entry-heading').evaluate(node=>node.scrollWidth-node.clientWidth);
  assert.ok(overflow<=2,surface+' long title overflows at '+width+'px: '+overflow);
 }
 for(const current of results.slice(1)){assert.equal(current.dayFont,results[0].dayFont);assert.equal(current.dayWeight,results[0].dayWeight);assert.equal(current.logoWidth,results[0].logoWidth);assert.ok(Math.abs(current.headerHeight-results[0].headerHeight)<2,'header height differs');assert.deepEqual(current.links.map(l=>l.text),results[0].links.map(l=>l.text));if(width>1000)for(let i=0;i<current.links.length;i++){assert.equal(current.links[i].font,results[0].links[i].font);assert.ok(Math.abs(current.links[i].left-results[0].links[i].left)<2,'navigation differs');}}
 console.log('PASS '+width+'px: Studio, private preview and published CSS/header/Start parity.');
}
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
