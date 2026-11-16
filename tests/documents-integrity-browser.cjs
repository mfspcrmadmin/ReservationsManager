const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve('app');
// Reuse the comprehensive isolated fixture. No Zoho connection or real writes.
const source=fs.readFileSync('tests/documents-browser.cjs','utf8');
let fixture=source.match(/const fixture = String.raw`([\s\S]*?)`;\s*const server/)[1];
fixture=fixture.replace('request:async(action,values)=>{','request:async(action,values)=>{if(window.overrideRequest){const result=await window.overrideRequest(action,values);if(result!==undefined)return result;}');
fixture=fixture.replace('</head>','<link rel="stylesheet" href="/styles/interface-system.css"></head>');
const server=http.createServer((req,res)=>{if(req.url==='/'){res.setHeader('Content-Type','text/html');return res.end(fixture)}const file=path.resolve(root,'.'+req.url.split('?')[0]);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.statusCode=404;return res.end()}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.png')?'image/png':'text/css');res.end(fs.readFileSync(file));});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,channel:'msedge'});try{
const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.ready);
await page.evaluate(()=>window.overrideRequest=(action)=>action==='get'?{document:{id:'999',revision:1},blocks:[]}:undefined);
await page.locator('[data-document]').click();await page.locator('[data-open-retry]').waitFor();assert.match(await page.locator('.document-studio').innerText(),/does not match/);
await page.evaluate(()=>window.overrideRequest=null);await page.locator('[data-open-retry]').click();
// The global tooltip layer and Studio must not both describe the same outline item.
const outlineItem=page.locator('[data-section="2"]');
await outlineItem.waitFor();
const outlineTitle=await outlineItem.getAttribute('title');
const visibleTooltips=page.locator('.studio-tooltip:visible, .app-floating-tooltip:visible, .documents-library-tooltip:visible');
await outlineItem.hover();
assert.equal(await visibleTooltips.count(),1);
assert.equal(await visibleTooltips.innerText(),outlineTitle);
await page.mouse.move(0,0);
assert.equal(await visibleTooltips.count(),0);
// Previously enhanced controls may still carry the global attribute.
await outlineItem.evaluate((node,title)=>node.setAttribute('data-tooltip',title),outlineTitle);
await outlineItem.hover();
assert.equal(await visibleTooltips.count(),1);
await page.mouse.move(0,0);
await outlineItem.focus();
assert.equal(await visibleTooltips.count(),1);
assert.equal(await visibleTooltips.innerText(),outlineTitle);
await outlineItem.evaluate(node=>node.blur());
assert.equal(await visibleTooltips.count(),0);
await page.locator('[data-document-settings]').click();
await page.locator('[name=proposal_type]').selectOption('Private_Clients');assert.equal(await page.evaluate(()=>controller.hasPendingChanges()),true);
page.once('dialog',d=>d.dismiss());await page.locator('.document-settings-dialog [data-cancel]').click();assert.equal(await page.locator('.document-settings-dialog').count(),1);
await page.evaluate(()=>window.failSettings=true);await page.locator('.document-settings-dialog [type=submit]').click();await page.locator('.document-settings-dialog [role=alert]').waitFor();assert.equal(await page.locator('[name=proposal_type]').inputValue(),'Private_Clients');
await page.evaluate(()=>window.failSettings=false);await page.locator('.document-settings-dialog [type=submit]').click();await page.locator('.document-settings-dialog').waitFor({state:'detached'});assert.equal(await page.evaluate(()=>controller.hasPendingChanges()),false);
await page.locator('[data-section="2"]').click();await page.locator('#studio-block-body').fill('Text retained on an unconfirmed save');await page.evaluate(()=>window.overrideRequest=action=>action==='save_block'?structuredClone(fixtureDoc):undefined);await page.locator('[data-save]').click();await page.waitForFunction(()=>document.querySelector('.studio-save-status').textContent.includes('not confirmed'));assert.equal(await page.locator('#studio-block-body').inputValue(),'Text retained on an unconfirmed save');assert.equal(await page.evaluate(()=>controller.hasPendingChanges()),true);
await page.evaluate(()=>window.overrideRequest=null);await page.locator('[data-save]').click();await page.waitForFunction(()=>!controller.hasPendingChanges());
// A failed generation retry shares a key only while the draft revision is unchanged.
await page.evaluate(()=>window.failGenerate=true);await page.locator('[data-generate]').click();await page.locator('[data-generation-close]').click();await page.locator('[data-generate]').click();await page.locator('[data-generation-close]').click();
const keys=await page.evaluate(()=>calls.filter(c=>c.action==='generate').map(c=>c.values.request_key));assert.equal(keys.at(-1),keys.at(-2));
await page.locator('#studio-block-body').fill('New revision after failed generation');await page.locator('[data-save]').click();await page.waitForFunction(()=>!controller.hasPendingChanges());await page.locator('[data-generate]').click();await page.locator('[data-generation-close]').click();assert.notEqual(await page.evaluate(()=>calls.filter(c=>c.action==='generate').at(-1).values.request_key),keys.at(-1));
await page.evaluate(()=>window.failGenerate=false);await page.locator('[data-generate]').click();await page.locator('[data-generation-close]').click();
await page.evaluate(()=>window.overrideRequest=action=>action==='publish'?{document_status:'Published',publication:{id:'123456',published_version_id:'wrong-version'}}:undefined);
await page.locator('[data-publish]').click();await page.locator('[data-publication-confirm]').click();await page.waitForFunction(()=>document.querySelector('[data-publication-error]').textContent.includes('not confirmed'));
assert.equal(await page.evaluate(()=>fixtureDoc.document.status),'Draft');await page.locator('[data-publication-cancel]').click();await page.evaluate(()=>window.overrideRequest=null);
// A response from a disposed editor must not unlock a save in a newer editor.
await page.evaluate(()=>{window.overrideRequest=async action=>{if(action==='save_block'){const result=structuredClone(fixtureDoc);result.document.revision++;return new Promise(resolve=>window.finishOld=()=>resolve(result));}};});
await page.locator('#studio-block-body').fill('Old editor change');await page.locator('[data-save]').click();await page.waitForFunction(()=>window.finishOld);
await page.evaluate(async()=>{controller.reset();await controller.ensure();await controller.open('123456');window.newSaveCalls=0;window.overrideRequest=async action=>{if(action==='save_block'){window.newSaveCalls++;const result=structuredClone(fixtureDoc);result.document.revision++;return new Promise(resolve=>window.finishNew=()=>resolve(result));}};});
await page.locator('[data-section="2"]').click();await page.locator('#studio-block-body').fill('New editor change');await page.locator('[data-save]').click();await page.waitForFunction(()=>window.finishNew);await page.evaluate(()=>window.finishOld());
await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(await page.evaluate(()=>controller.hasPendingChanges()),true);assert.equal(await page.locator('[data-save]').isDisabled(),true);assert.equal(await page.locator('#studio-block-body').inputValue(),'New editor change');await page.evaluate(()=>{document.querySelector('[data-save]').onclick();});assert.equal(await page.evaluate(()=>window.newSaveCalls),1,'stale completion cannot release the newer operation lock');
await page.evaluate(()=>window.finishNew());await page.waitForFunction(()=>!controller.hasPendingChanges());await page.evaluate(async()=>{controller.reset();window.overrideRequest=null;await controller.ensure();});await page.locator('[data-doc-create]').click();await page.locator('[data-document-name]').fill('A long document title for a private journey across Spain and Portugal');await page.screenshot({path:'_local/artifacts/documents-create-consolidated.png'});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'_local/artifacts/documents-create-consolidated-narrow.png'});assert.ok(await page.locator('.document-create-dialog').evaluate(n=>n.scrollWidth<=n.clientWidth));assert.deepEqual(errors,[]);
console.log('Documents integrity passed: wrong identity, retry, settings discard guard and recovery, unconfirmed saves, revision-scoped generation retries, and stale save isolation.');
}finally{await browser.close();server.close()}})().catch(e=>{console.error(e);server.close();process.exitCode=1});
