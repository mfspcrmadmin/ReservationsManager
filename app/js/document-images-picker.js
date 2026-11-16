import { imageSuppliers } from './document-images-api.js';
import { documentIcons } from './documents-list.js';

export function mountDocumentImagesPicker(container,input,{group,records,api}) {
  const suppliers=imageSuppliers(group,records),cards=new Map();
  let disposed=false,selection=0,loadSequence=0,loading=false,processing='';
  const node=document.createElement('section');node.className='studio-image-library';
  node.innerHTML='<div class="studio-image-current"><header><h4>Current image</h4></header><div class="studio-image-preview" data-image-preview></div></div><section class="studio-image-gallery"><header><h4>Supplier gallery</h4></header><div class="studio-image-notice" role="status" hidden><span></span><button type="button" class="button tertiary compact">Retry</button></div><div class="studio-image-suppliers"></div></section>';
  container.append(node);
  const preview=node.querySelector('[data-image-preview]'),notice=node.querySelector('.studio-image-notice'),retry=notice.querySelector('button'),results=node.querySelector('.studio-image-suppliers');
  const icon=(name,label)=>{const b=document.createElement('button');b.type='button';b.className='studio-icon-button';b.innerHTML=documentIcons[name];b.title=label;b.setAttribute('aria-label',label);return b;};
  const remove=icon('trash','Remove image from document');remove.dataset.removeImage='';node.querySelector('.studio-image-current header').append(remove);
  const refresh=icon('refresh','Refresh images');node.querySelector('.studio-image-gallery header').append(refresh);
  const message=(text,error=false,action=null)=>{notice.hidden=!text;notice.dataset.error=String(error);notice.querySelector('span').textContent=text;retry.hidden=!action;retry.onclick=action;};
  const sync=()=>{
    remove.disabled=input.disabled||!input.value;refresh.disabled=input.disabled||loading;retry.disabled=input.disabled;
    for(const [key,card] of cards){
      const applied=!!input.value&&(card.url===input.value||api.appliedURL?.(card.file)===input.value);
      card.button.disabled=input.disabled;card.button.setAttribute('aria-pressed',String(applied));card.button.setAttribute('aria-busy',String(key===processing));
      card.label.textContent=key===processing?'Preparing...':applied?'\u2713 Applied':card.file.cover?'Step cover':'';card.button.classList.toggle('is-applied',applied);
    }
  };
  const showCurrent=()=>{
    preview.replaceChildren();preview.dataset.empty=String(!input.value);
    if(!input.value)preview.textContent='No image';else if(!/^https:\/\//i.test(input.value))preview.textContent='Current image unavailable';else{const img=document.createElement('img');img.alt='Current document image';img.referrerPolicy='no-referrer';img.onerror=()=>{if(!disposed&&img.isConnected)preview.textContent='Current image unavailable';};img.src=input.value;preview.append(img);}sync();
  };
  const onInput=()=>{selection++;processing='';showCurrent();};input.addEventListener('input',onInput);
  remove.onclick=()=>{if(input.disabled)return;message('');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));};
  const observer=new MutationObserver(()=>{if(input.disabled){selection++;processing='';}sync();});observer.observe(input,{attributes:true,attributeFilter:['disabled']});showCurrent();
  async function choose(supplier,file,key){
    if(disposed||input.disabled||processing===key)return;
    const ticket=++selection;processing=key;sync();message('Preparing image...');
    const active=()=>!disposed&&ticket===selection&&input.isConnected&&!input.disabled;
    try{
      const url=await api.select(supplier,file);if(!active())return;
      await new Promise((resolve,reject)=>{
        const img=new Image();img.referrerPolicy='no-referrer';
        const finish=error=>{clearTimeout(timer);img.onload=null;img.onerror=null;error?reject(error):resolve();};
        const timer=setTimeout(()=>{finish(new Error('Image verification timed out.'));img.src='';},15000);
        img.onload=()=>finish();img.onerror=()=>finish(new Error('The prepared image could not be displayed.'));img.src=url;
      });
      if(!active())return;
      cards.get(key).url=url;input.value=url;input.dispatchEvent(new Event('input',{bubbles:true}));message('');
    }catch(error){if(active())message(error.message||'Could not prepare image.',true,()=>choose(supplier,file,key));}
    finally{if(ticket===selection){processing='';sync();}}
  }
  async function load(){
    const ticket=++loadSequence;loading=true;results.replaceChildren();cards.clear();message('');sync();
    if(!suppliers.length){results.textContent='No supplier linked to this section.';loading=false;sync();return;}
    for(const supplier of suppliers){
      const section=document.createElement('section'),heading=document.createElement('header'),title=document.createElement('div'),name=document.createElement('strong'),path=document.createElement('small');name.textContent=supplier.name;name.hidden=suppliers.length===1&&supplier.name.trim().toLowerCase()===String(group.title||'').trim().toLowerCase();path.textContent='Images / General';title.append(name,path);heading.append(title);
      const state=document.createElement('p');state.className='studio-image-empty';state.textContent='Loading images...';state.setAttribute('role','status');section.append(heading,state);results.append(section);
      try{
        const data=await api.load(supplier);if(disposed||ticket!==loadSequence)return;
        const texts={'no-folder':'No WorkDrive folder configured.','no-images':'Images folder not found.','no-general':'General folder not found.',empty:'No images in this folder.',ready:''};state.textContent=texts[data.status]||'';state.hidden=!state.textContent;
        if(data.folderUrl){const open=document.createElement('a');open.className='studio-icon-button';open.href=data.folderUrl;open.target='_blank';open.rel='noopener noreferrer';open.innerHTML=documentIcons.open;open.title='Open supplier folder';open.setAttribute('aria-label','Open supplier folder');heading.append(open);}
        const grid=document.createElement('div');grid.className='studio-image-grid';section.append(grid);
        for(const file of data.files){
          const key=supplier.id+':'+file.id,button=document.createElement('button');button.type='button';button.dataset.imageChoice=file.id;
          const thumb=document.createElement('div');thumb.className='studio-image-thumb';thumb.textContent='No preview';
          if(/^https:\/\//.test(file.thumbnail)){const img=document.createElement('img');img.src=file.thumbnail;img.alt='';img.loading='lazy';img.referrerPolicy='no-referrer';img.onerror=()=>{img.remove();thumb.textContent='Preview unavailable';};thumb.replaceChildren(img);}
          const filename=document.createElement('span');filename.className='studio-image-filename';filename.textContent=file.name;filename.title=file.name;
          const label=document.createElement('small');button.append(thumb,filename,label);button.setAttribute('aria-label','Use '+file.name);cards.set(key,{button,file,label,url:api.appliedURL?.(file)||''});button.onclick=()=>choose(supplier,file,key);grid.append(button);
        }
      }catch(error){if(disposed||ticket!==loadSequence)return;state.hidden=false;state.textContent='Images could not be loaded.';message(error.message,true,load);}
    }
    if(disposed||ticket!==loadSequence)return;loading=false;sync();
  }
  refresh.onclick=()=>{if(!input.disabled&&!loading){selection++;processing='';load();}};
  load();
  return ()=>{disposed=true;selection++;loadSequence++;observer.disconnect();input.removeEventListener('input',onInput);};
}
