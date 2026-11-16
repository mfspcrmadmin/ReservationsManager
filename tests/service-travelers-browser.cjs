const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/angela/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
    await page.setContent('<button id="trigger">Assign travelers</button>');
    await page.addStyleTag({content:fs.readFileSync('app/styles/service-travelers.css','utf8')});
    await page.addScriptTag({content:`
      const state={selectedBookingId:'301',selectedService:{id:'501',Name:'Test service'}};
      const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      window.calls=[];window.commits=0;window.model={error:false,bookingId:'301',serviceId:'501',version:'v1',roomTypes:['SINGLE','DOUBLE'],assignments:[],participants:[{id:'201',Name:'Morgan',Forename:'Alex',Lead_Passenger:true},{id:'202',Name:'Morgan',Forename:'Jamie',Lead_Passenger:false}]};
      async function crmExecuteFunction(name,args){window.calls.push({name,args});
        if(args.commit){window.commits++;const passengers=JSON.parse(args.changesJson).passengers;window.model.assignments=passengers.map((p,i)=>({id:String(401+i),pax_id:p.paxId,Room_Type:p.roomType.toUpperCase(),Room_Group:p.roomGroup.trim(),Service_Notes:p.notes,Assignment_Status:'Active'}));window.model.version='v2';return{details:{output:JSON.stringify({error:false,committed:true})}};}
        if(args.changesJson)return{details:{output:JSON.stringify({...window.model,changeCount:1,plan:[{paxId:'201',before:{},changes:{Assignment_Status:'Active'},action:'Assign'}]})}};
        return{details:{output:JSON.stringify(window.model)}};}
    `});
    await page.addScriptTag({content:fs.readFileSync('app/js/service-travelers.js','utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')});
    await page.evaluate(()=>{document.getElementById('trigger').onclick=()=>openServiceTravelers(state.selectedService,'301',document.getElementById('trigger'));});
    await page.click('#trigger');await page.waitForSelector('[data-pax]');
    assert.equal(await page.locator('[data-selected]:checked').count(),0);
    assert.equal(await page.locator('[data-save]').isDisabled(),true);
    await page.locator('[data-selected]').first().check();
    await page.locator('[data-preview]').click();await page.waitForFunction(()=>!document.querySelector('[data-save]').disabled);
    assert.match(await page.locator('[data-plan]').innerText(),/Assign.*Alex Morgan/);
    await page.evaluate(()=>{const b=document.querySelector('[data-save]');b.click();b.click();});
    await page.waitForFunction(()=>document.querySelector('[data-message]').textContent.includes('saved and reloaded'));
    assert.equal(await page.evaluate(()=>window.commits),1);
    assert.equal(await page.locator('[data-save]').isDisabled(),true);
    await page.locator('[data-reload]').click();await page.waitForFunction(()=>!document.querySelector('[data-preview]').disabled);
    assert.equal(await page.locator('[data-selected]:checked').count(),1);
    assert.equal(await page.locator('dialog').evaluate(e=>e.scrollWidth<=e.clientWidth),true);
    await page.keyboard.press('Escape');await page.waitForSelector('dialog',{state:'detached'});assert.equal(await page.locator('dialog').count(),0);assert.equal(await page.evaluate(()=>document.activeElement.id),'trigger');
    assert.deepEqual(errors,[]);console.log('Service traveler dialog: preview, explicit save, double-submit, reload verification, mobile and focus passed.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
