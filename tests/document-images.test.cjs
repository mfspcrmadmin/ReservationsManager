const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const context=vm.createContext({Map,URL,setTimeout,clearTimeout,window:{},documentImagesConfig:{connection:''}});
vm.runInContext(fs.readFileSync('app/js/document-images-api.js','utf8').replace(/^import .*;\r?\n/,'').replace(/export /g,''),context);
const {createDocumentImagesAPI:make,imageSuppliers}=context;
const row=(id,name,folder=false)=>({id,attributes:{name,is_folder:folder}});
function fixture(){
 const calls=[];let fail=false;
 const contents={root:[row('images','IMAGES',true)],images:[row('general','General',true)],general:[row('photo','garden.jpg'),row('cover','step-cover.webp'),row('other','notes.txt')]};
 const api=make({config:{prepareFunction:'preparedocumentimage'},crm:{getRecord:async()=>({data:[{id:'123',Workdrive_ID:'root'}]})},invokeFunction:async(name,request)=>{const data=JSON.parse(JSON.parse(request.arguments).requestBody);calls.push(data);assert.equal(name,'preparedocumentimage');assert.equal(data.supplier_id,'123');assert.equal(data.operation,'list');if(fail)throw Error('denied');return {details:{output:JSON.stringify({status:'OK',data:contents[data.folder_id]})}}}});
 return {api,calls,contents,setFail:value=>fail=value};
}
test('resolves vendor library case-insensitively, puts cover first, filters formats',async()=>{const {api,calls}=fixture();const result=await api.load({id:'123'});assert.equal(result.status,'ready');assert.equal(result.files[0].name,'step-cover.webp');assert.equal(result.files.length,2);assert.equal(calls.length,3)});
test('coalesces requests but retries after failures',async()=>{const f=fixture();f.setFail(true);await assert.rejects(f.api.load({id:'123'}));f.setFail(false);const a=f.api.load({id:'123'}),b=f.api.load({id:'123'});assert.equal(a,b);await a;assert.equal(f.calls.length,4)});
test('does not choose an arbitrary duplicate Images folder',async()=>{const f=fixture();f.contents.root.push(row('second','images',true));await assert.rejects(f.api.load({id:'123'}),/More than one/)});
test('does not fall back to private WorkDrive URLs when publication is unavailable',async()=>{const api=make({config:{}});await assert.rejects(api.select({id:'123'},{id:'photo'}),/publishing is not configured/)});
test('groups services by supplier within the selected step only',()=>{const records={a:{module:'Booking_Services',id:'1',step_id:'9',supplier_id:'123',supplier:'Hotel'},b:{module:'Booking_Services',id:'2',step_id:'9',supplier_id:'123'},c:{module:'Booking_Services',id:'3',step_id:'8',supplier_id:'999'}};assert.equal(imageSuppliers({step_id:'9'},records).length,1);assert.equal(imageSuppliers({service_id:'3'},records)[0].id,'999');assert.equal(imageSuppliers({},records).length,0)});

test('calls authenticated CRM preparation with only the image payload',async()=>{
 let captured;
 context.window.ZOHO = {CRM: {FUNCTIONS: {}}};
 context.window.ZOHO.CRM.FUNCTIONS.execute = async (name, request) => {
   captured = {name,request};
   return {details:{output:JSON.stringify({status:'OK',url:'https://example.com/copied.jpg'})}};
 };
 const api=make({config:{prepareFunction:'preparedocumentimage'}});
 assert.equal(await api.select({id:'123'},{id:'photo',modified:1234}),'https://example.com/copied.jpg');
 assert.equal(captured.name,'preparedocumentimage');
 const args=JSON.parse(captured.request.arguments);assert.equal(args.crmAPIRequest,undefined);
 assert.deepEqual(JSON.parse(args.requestBody),{supplier_id:'123',file_id:'photo',modified:1234});
});
test('surfaces server failure and malformed preparation responses',async()=>{
 const api=make({config:{prepareFunction:'preparedocumentimage'}});
 context.window.ZOHO.CRM.FUNCTIONS.execute=async()=>({details:{output:JSON.stringify({status:'ERROR',message:'Permission denied'})}});
 await assert.rejects(api.select({id:'123'},{id:'photo'}),/Permission denied/);
 context.window.ZOHO.CRM.FUNCTIONS.execute=async()=>({code:'INVALID_DATA'});
 await assert.rejects(api.select({id:'123'},{id:'photo'}),/REST OAuth/);
});
test('coalesces image preparation and rejects long URLs',async()=>{
 let resolve,calls=0;const api=make({prepareImage:()=>{calls++;return new Promise(r=>resolve=r)}});
 const a=api.select({id:'123'},{id:'photo',modified:1}),b=api.select({id:'123'},{id:'photo',modified:1});
 assert.equal(calls,1);resolve({url:'https://example.com/image.jpg'});assert.equal(await a,await b);
 const invalid=make({prepareImage:async()=>({url:'https://example.com/'+ 'a'.repeat(255)})});
 await assert.rejects(invalid.select({id:'123'},{id:'photo'}),/valid document URL/);
});

test('retains the WorkDrive operation and code instead of assuming permissions',async()=>{
 context.window.ZOHO.CRM.FUNCTIONS.execute=async()=>({details:{output:JSON.stringify({status:'ERROR',message:'WorkDrive returned an incomplete response.',stage:'UPLOAD',workdrive_code:'F6003'})}});
 const api=make({config:{prepareFunction:'preparedocumentimage'}});
 await assert.rejects(api.select({id:'123'},{id:'photo'}),error=>error.stage==='UPLOAD' && error.code==='F6003' && !error.message.includes('permissions'));
});
test('recognizes an applied image across section mounts without preparing again',async()=>{
 let calls=0;const api=make({prepareImage:async()=>{calls++;return {url:'https://example.com/copy.jpg'}}});
 const file={id:'photo',modified:42};await api.select({id:'123'},file);
 assert.equal(api.appliedURL(file),'https://example.com/copy.jpg');assert.equal(calls,1);
 assert.equal(api.appliedURL({...file,modified:43}),undefined);
});
