const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const server=http.createServer((req,res)=>{const target=path.resolve('app','.'+req.url);if(!target.startsWith(path.resolve('app')+path.sep)){res.end();return;}try{res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':req.url.endsWith('.css')?'text/css':'image/png');res.end(fs.readFileSync(target));}catch{res.statusCode=404;res.end()}});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage({viewport:{width:1200,height:720}});
  await page.route('https://fixture.example/**',route=>route.fulfill({contentType:'image/png',body:fs.readFileSync('app/assets/MFSP_logo_red.png')}));
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.setContent('<link rel="stylesheet" href="/styles/booking-documents.css"><style>body{margin:0}.document-studio{height:100vh;width:360px}.studio-inspector{display:grid!important;height:100%;box-sizing:border-box}.studio-image-library [hidden]{display:none!important}</style><div class="document-studio"><aside class="studio-inspector studio-inspector--fixed-actions"><header class="studio-properties-heading">Hotel - Document</header><div class="studio-inspector-body"><div style="height:200px">Fields</div><div id="host"></div><input type="hidden" id="image" value="https://fixture.example/original.png"><div id="last">Source details</div></div><footer class="studio-inspector-savebar">Save section</footer></aside></div>');
  await page.evaluate(async()=>{
   const {mountDocumentImagesPicker}=await import('/js/document-images-picker.js');
   window.pending={};window.calls=[];
   window.dispose=mountDocumentImagesPicker(document.querySelector('#host'),document.querySelector('#image'),{group:{step_id:'9'},records:{a:{module:'Booking_Services',id:'1',step_id:'9',supplier_id:'123',supplier:'Hotel'}},api:{load:async()=>({status:'ready',folderUrl:'https://workdrive.zoho.eu/folder/mock',files:Array.from({length:20},(_,i)=>({id:String(i),name:i===0?'step-cover.jpg':'Long photo name '+i+'.jpg',cover:i===0,thumbnail:'https://fixture.example/'+i+'.png'}))}),select:async(supplier,file)=>{calls.push(file.id);return new Promise((resolve,reject)=>pending[file.id]={resolve,reject})}}});
  });
  await page.locator('[data-image-choice="0"]').click();await page.locator('[data-image-choice="0"]').click();
  assert.equal(await page.evaluate(()=>calls.length),1);
  await page.locator('[data-image-choice="1"]').click();
  await page.evaluate(()=>pending['1'].resolve('https://fixture.example/selected.png'));
  await page.waitForFunction(()=>document.querySelector('#image').value.endsWith('selected.png'));
  await page.evaluate(()=>pending['0'].resolve('https://fixture.example/old-response.png'));
  assert.equal(await page.locator('#image').inputValue(),'https://fixture.example/selected.png');
  assert.equal(await page.locator('[data-image-choice="1"]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-image-choice="2"]').click();await page.evaluate(()=>pending['2'].reject(Error('Upload failed (UPLOAD: R008)')));
  await page.locator('.studio-image-notice[data-error=true]').waitFor();assert.equal(await page.locator('#image').inputValue(),'https://fixture.example/selected.png');
  await page.getByRole('button',{name:'Retry',exact:true}).click();await page.evaluate(()=>pending['2'].resolve('https://fixture.example/retry.png'));
  await page.waitForFunction(()=>document.querySelector('#image').value.endsWith('retry.png'));
  assert.equal(await page.locator('.studio-image-notice').isVisible(),false);
  for(const height of [720,480]){
   await page.setViewportSize({width:1200,height});
   await page.locator('.studio-inspector-body').evaluate(el=>el.scrollTop=0);
   await page.mouse.move(150,300);await page.mouse.wheel(0,12000);
   await page.waitForFunction(()=>{const el=document.querySelector('.studio-inspector-body');return Math.abs(el.scrollTop+el.clientHeight-el.scrollHeight)<3;});
   const geometry=await page.evaluate(()=>({last:document.querySelector('#last').getBoundingClientRect().bottom,footer:document.querySelector('footer').getBoundingClientRect().top,overflow:getComputedStyle(document.querySelector('.studio-image-suppliers')).overflow}));
   assert.ok(geometry.last<=geometry.footer);assert.equal(geometry.overflow,'visible');
  }
  await page.screenshot({path:'_local/artifacts/document-images-inspector.png'});
  await page.getByRole('button',{name:'Remove image from document'}).click();assert.equal(await page.locator('#image').inputValue(),'');
  await page.locator('[data-image-choice="3"]').click();await page.evaluate(()=>{dispose();document.querySelector('#image').value='https://fixture.example/new-step.png';pending['3'].resolve('https://fixture.example/stale.png')});
  assert.equal(await page.locator('#image').inputValue(),'https://fixture.example/new-step.png');
  console.log('PASS image gallery: automatic load, current image, latest selection wins, duplicate click, failure/retry, applied state, removal, stale section and wheel to footer at 720/480px.');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close()});
