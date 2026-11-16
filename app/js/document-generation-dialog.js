export function openGenerationDialog({studio,onClose}) {
  const modal=document.createElement('dialog');
  modal.className='document-create-dialog document-import-dialog document-generation-dialog';
  modal.setAttribute('aria-labelledby','document-generation-title');
  modal.setAttribute('aria-describedby','document-generation-message');
  modal.innerHTML='<h2 id="document-generation-title" tabindex="-1">Generating document</h2><div class="document-generation-progress" role="status" aria-live="polite" aria-atomic="true"><span id="document-generation-message">Starting generation</span><span data-generation-count></span></div><div class="document-generation-bar" role="progressbar" aria-label="Starting generation — current operation" data-indeterminate="true"><span></span></div><p class="studio-hint" data-generation-help>Keep this window open until generation finishes.</p><div class="document-create-actions" hidden><button type="button" class="button tertiary" data-generation-close disabled>Close</button><a class="button primary" data-generation-preview target="_blank" rel="noopener noreferrer" hidden>Open draft preview</a></div>';
  const bar=modal.querySelector('[role="progressbar"]');
  const count=modal.querySelector('[data-generation-count]');
  let finished=false;
  const close=()=>{if(!finished || !modal.isConnected)return;modal.close();modal.remove();onClose();};
  modal.addEventListener('cancel',event=>{event.preventDefault();event.stopPropagation();close();});
  modal.querySelector('[data-generation-close]').onclick=close;
  studio.append(modal);modal.showModal();modal.querySelector('h2').focus();
  return {
    dispose:()=>{if(modal.isConnected){modal.close();modal.remove();}},
    progress:update=>{
      if(!modal.isConnected || finished)return;
      const {label,phase,completed,total}=typeof update==='string'?{label:update.replace(/\.{3}$/, '')}:update;
      const measurable=Number.isFinite(total)&&total>0&&Number.isFinite(completed)&&completed>=0&&completed<=total;
      modal.querySelector('#document-generation-message').textContent=label;
      // Contact batches count suppliers whose contacts were loaded, not individual contacts.
      const contacts=phase==='contacts';
      count.textContent=measurable?completed+' / '+total+(contacts?' suppliers':''):
        contacts&&Number.isFinite(completed)&&completed>=0?completed+' '+(completed===1?'supplier':'suppliers')+' loaded':'';
      bar.setAttribute('aria-label',label+' — current operation');
      bar.dataset.indeterminate=String(!measurable);
      for(const attribute of ['aria-valuemin','aria-valuemax','aria-valuenow','aria-valuetext'])bar.removeAttribute(attribute);
      if(measurable){
        bar.setAttribute('aria-valuemin','0');bar.setAttribute('aria-valuemax',String(total));bar.setAttribute('aria-valuenow',String(completed));
        bar.setAttribute('aria-valuetext',completed+' of '+total+(contacts?' suppliers loaded':' for this operation'));
        bar.firstElementChild.style.width=(completed/total*100)+'%';
      }else bar.firstElementChild.style.removeProperty('width');
    },
    finish:({url,error,warning,previousPreview})=>{
      if(!modal.isConnected)return;
      finished=true;modal.dataset.result=error?'error':'success';
      bar.hidden=true;count.textContent='';
      modal.querySelector('h2').textContent=error?'Generation failed':'Document generated';
      modal.querySelector('#document-generation-message').textContent=error || 'Your document is ready to preview.';
      modal.querySelector('[data-generation-help]').textContent=error?(previousPreview?'Your previous generated preview is preserved.':'No new preview was confirmed.'):(warning || 'Review the preview before publishing. This does not publish the document.');
      const preview=modal.querySelector('[data-generation-preview]');
      if(url && !error){preview.href=url;preview.hidden=false;}
      modal.querySelector('.document-create-actions').hidden=false;
      modal.querySelector('[data-generation-close]').disabled=false;
      modal.querySelector('h2').focus();
    }
  };
}
