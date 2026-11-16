import { groupDocumentBlocks } from './documents-api.js';
import { imageSuppliers } from './document-images-api.js';

// Save defaults through the normal revision-checked draft path, never in published snapshots.
export async function loadDefaultStepImages(response,{api,save,isCurrent=()=>true,onProgress=()=>{},verify=verifyDefaultImage}) {
  if(response.document?.type!=='FID'||!(response.document?.status==='Draft'||(response.document?.status==='Published'&&response.document?.render_mode==='Versioned')))return response;
  const libraries=new Map(),warnings=[];
  let current=response;
  for(const group of groupDocumentBlocks(response.blocks)){
    const record=response.crm_records?.[group.key];
    if(group.origin!=='CRM'||group.service_id||!group.step_id||group.image||!group.visible||record?.active===false||record?.document_visible===false||!record||String(record.step_type).toLowerCase()==='extra'||['agent commission','agent comission'].includes(String(record.step_category).toLowerCase())||(group.hidden_fields||[]).includes(group.key+'|Image'))continue;
    if(!isCurrent())return current;
    onProgress(group.title||'step');
    const suppliers=imageSuppliers(group,response.crm_records).filter(s=>Object.values(response.crm_records).some(r=>r.module==='Booking_Services'&&String(r.step_id)===String(group.step_id)&&r.supplier_id===s.id&&r.active!==false));
    let candidates=[];
    try{
      for(const supplier of suppliers){
        if(!isCurrent())return current;
        if(!libraries.has(supplier.id))libraries.set(supplier.id,api.load(supplier));
        const library=await libraries.get(supplier.id);
        candidates.push(...library.files.filter(f=>f.cover).map(file=>({supplier,file})));
      }
      if(candidates.length!==1){if(candidates.length>1)warnings.push('Multiple step covers for '+group.title+'. Choose an image in Image.');continue;}
      if(!isCurrent())return current;
      const {supplier,file}=candidates[0];
      const image=api.appliedURL?.(file)||await api.select(supplier,file);
      if(!isCurrent())return current;
      await verify(image);
      if(!isCurrent())return current;
      const hidden=[...new Set([...(group.hidden_fields||[]),...(record.fields||[]).filter(f=>f.included===false).map(f=>group.key+'|'+f.api_name)])];
      current=await save({key:group.key,title:'',body:'',image,visibility:'Included',presentation_only:true,hidden_fields:hidden},current.document.revision);
    }catch(error){
      warnings.push('Default image for '+(group.title||'step')+': '+error.message);
      // A failed write may have reached the server. Stop; do not retry with a stale revision.
      break;
    }
  }
  return {...current,image_default_notice:warnings.join(' ')};
}

function verifyDefaultImage(url) {
  return new Promise((resolve,reject)=>{
    const image=new Image();image.referrerPolicy='no-referrer';
    const finish=error=>{clearTimeout(timer);image.onload=null;image.onerror=null;error?reject(error):resolve();};
    const timer=setTimeout(()=>finish(new Error('Image verification timed out.')),15000);
    image.onload=()=>finish();image.onerror=()=>finish(new Error('The supplier cover could not be displayed.'));image.src=url;
  });
}
