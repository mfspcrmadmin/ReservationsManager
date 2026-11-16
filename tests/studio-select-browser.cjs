const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve('app');
const fixture='<!doctype html><link rel="stylesheet" href="/styles/booking-documents.css"><link rel="stylesheet" href="/styles/interface-system.css">'+
 '<dialog class="document-studio"><form><label>Short<select id="short"><option value="a">Alpha</option><option value="b">Beta</option></select></label><button type="button" id="next">Next</button></form><div id="conditional" hidden><label>Many<select id="many"></select></label></div></dialog>'+
 '<script type="module">import {initStudioSelects} from "/js/studio-select.js";document.querySelector("dialog").showModal();let s=document.querySelector("#many");for(let i=0;i<25;i++)s.add(new Option("Supplier "+i,String(i)));window.events=[];document.querySelector("#short").addEventListener("change",e=>events.push(e.target.value));initStudioSelects();window.ready=true;</script>';
const server=http.createServer((req,res)=>{
 if(req.url==='/'){res.setHeader('Content-Type','text/html');return res.end(fixture);}
 const file=path.resolve(root,'.'+req.url.split('?')[0]);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.statusCode=404;return res.end();}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/css');res.end(fs.readFileSync(file));
});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage({viewport:{width:1100,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.ready);
 const short=page.locator('#short').locator('..').locator('.studio-select-trigger');
 await short.click();assert.equal(await page.locator('.studio-select-menu:popover-open .studio-select-search').isVisible(),false);
 await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
 assert.equal(await page.locator('#short').inputValue(),'b');assert.deepEqual(await page.evaluate(()=>events),['b']);
 await page.locator('#short').selectOption('a');await page.waitForFunction(()=>document.querySelector('.studio-select-value').textContent==='Alpha');
 await short.click();await page.keyboard.press('Escape');assert.equal(await page.locator('dialog[open]').count(),1);
 await short.click();await page.keyboard.press('Tab');assert.equal(await page.locator('#next').evaluate(n=>n===document.activeElement),true);
 await page.evaluate(()=>{const s=document.querySelector('#short');s.required=true;s.insertBefore(new Option('Choose',''),s.firstChild);s.value='';s.reportValidity();});
 assert.equal(await short.getAttribute('aria-invalid'),'true');assert.ok(await page.locator('.studio-select-error:visible').textContent());
 await short.click();await page.getByRole('option',{name:'Beta',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#short').validity.valid&&!document.querySelector('#short').previousElementSibling.hasAttribute('aria-invalid'));
 await short.click();
 await page.evaluate(()=>{const s=document.querySelector('#short');for(let i=0;i<10;i++)s.add(new Option('Added '+i,'added'+i));});
 await page.waitForFunction(()=>!document.querySelector('.studio-select-menu:popover-open input').hidden);
 await page.locator('.studio-select-menu:popover-open input').fill('Added 9');await page.getByRole('option',{name:'Added 9',exact:true}).click();assert.equal(await page.locator('#short').inputValue(),'added9');
 await page.evaluate(()=>document.querySelector('#conditional').hidden=false);
 const many=page.locator('#many').locator('..').locator('.studio-select-trigger');
 await many.click();const menu=page.locator('.studio-select-menu:popover-open');
 await menu.locator('input').fill('Supplier 24');assert.equal(await menu.locator('[role=option]').count(),1);
 await menu.getByRole('option',{name:'Supplier 24'}).click();assert.equal(await page.locator('#many').inputValue(),'24');
 await page.evaluate(()=>{const s=document.querySelector('#many');s.disabled=true;s.setAttribute('aria-busy','true')});
 await page.waitForFunction(()=>document.querySelector('#many').previousElementSibling.disabled);assert.equal(await many.getAttribute('aria-busy'),'true');
 await page.evaluate(()=>{const s=document.querySelector('#many');s.disabled=false;s.removeAttribute('aria-busy');s.multiple=true;});
 await many.click();await menu.locator('input').fill('Supplier 2');await menu.getByRole('option',{name:'Supplier 2',exact:true}).click();
 assert.deepEqual(await page.locator('#many').evaluate(n=>[...n.selectedOptions].map(o=>o.value)),['2','24']);
 await page.keyboard.press('Escape');
 await page.evaluate(()=>{const d=document.createElement('dialog');d.className='document-settings-dialog';d.innerHTML='<label>Nested<select id="nested"><option>One</option><option>Two</option></select></label>';document.querySelector('dialog').append(d);d.showModal();});
 const nested=page.locator('#nested').locator('..').locator('.studio-select-trigger');
 await nested.click();await page.getByRole('option',{name:'Two',exact:true}).click();assert.equal(await page.locator('#nested').inputValue(),'Two');
 await page.setViewportSize({width:390,height:650});await nested.click();
 const bounds=await page.locator('.studio-select-menu:popover-open').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=390&&bounds.y>=0&&bounds.y+bounds.height<=650);
 await page.screenshot({path:'_local/artifacts/studio-dropdown-mobile.png'});
 await page.evaluate(()=>document.querySelector('.document-settings-dialog').remove());
 await page.waitForFunction(()=>!document.querySelector('.studio-select-menu:popover-open'));
 assert.deepEqual(errors,[]);console.log('PASS Studio dropdowns: keyboard, search, events, dynamic values, multiple, loading, nested modals, mobile and cleanup.');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
