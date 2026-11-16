import { escapeHtml as e } from './utils.js';
import { documentShareLink, documentIcons } from './documents-list.js';

export function newDocumentToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2,'0')).join('');
}

export function publicationAvailability(response, editable) {
  if (!editable) return {enabled:false,reason:'This document cannot be published.'};
  if (!response.generated_version_id) return {enabled:false,reason:'Generate the document once to create a version you can review and publish.'};
  const revision = response.generated_draft_revision;
  if (revision != null && Number(revision) > 0 && Number(revision) !== Number(response.document.revision)) {
    return {enabled:false,reason:'Document sections changed since generation. Generate and review the document again.'};
  }
  return {enabled:true,reason:'Publish the saved generated version',warning:response.generation_current ? '' : 'The saved version may not include the latest CRM changes. Publish this saved version, or cancel and generate again to include current data.'};
}

export function openPublicationDialog({doc,versionId,action,warning='',execute}) {
  const publish = action === 'publish';
  const trigger = document.activeElement;
  const modal = document.createElement('dialog');
  modal.className = 'document-publication-dialog';
  modal.setAttribute('aria-labelledby','document-publication-title');
  modal.innerHTML = '<h2 id="document-publication-title">' + (publish ? 'Publish document?' : 'Unpublish document?') + '</h2><p class="document-publication-name">'+e(doc.title || 'Untitled document')+'</p>' +
    (publish ? '<p>The public link will show the generated version you reviewed. Later edits stay private until you generate and publish again.</p><p class="document-publication-version">Saved version: '+e(versionId)+'</p><label>Link valid until<input type="date" data-publication-expiry value="'+e(doc.valid_until || '')+'"></label><small>Leave empty for no expiry. The selected day is included (Europe/Madrid).</small>' : '<p>The public link will stop working. Your document and saved versions will be kept.</p>') +
    (publish && warning ? '<p class="document-publication-warning">'+e(warning)+'</p>' : '') +
    '<p role="alert" data-publication-error></p><div class="document-publication-actions"><button type="button" class="button tertiary" data-publication-cancel>Cancel</button><button type="button" class="button primary" data-publication-confirm>'+ (publish?'Publish':'Unpublish')+'</button></div>';
  let pending=false,settled=false,resolve;
  const promise=new Promise(done=>resolve=done);
  const finish=result=>{if(settled)return;settled=true;modal.close();modal.remove();if(trigger?.isConnected)trigger.focus({preventScroll:true});resolve(result);};
  const cancel=()=>{if(!pending)finish(null);};
  modal.querySelector('[data-publication-cancel]').onclick=cancel;
  modal.addEventListener('cancel',event=>{event.preventDefault();cancel();});
  modal.querySelector('[data-publication-confirm]').onclick=async()=>{
    if(pending)return;
    const input=modal.querySelector('input');
    if(input && !input.reportValidity())return;
    pending=true;
    const button=modal.querySelector('[data-publication-confirm]');
    modal.querySelectorAll('button,input').forEach(control=>control.disabled=true);
    button.setAttribute('aria-busy','true');button.innerHTML='<span class="studio-button-spinner" aria-hidden="true"></span>'+ (publish?'Publishing':'Unpublishing');
    modal.querySelector('[data-publication-error]').textContent='';
    try {
      const result=await execute({confirmed:true,version_id:versionId,valid_until:input?.value || '',published_version_id:doc.published_version_id || '',...(publish?{access_token:newDocumentToken()}:{})});
      finish(result);
    } catch(error) {
      if(!settled)modal.querySelector('[data-publication-error]').textContent=error.message;
    } finally {
      pending=false;
      if(!settled){modal.querySelectorAll('button,input').forEach(control=>control.disabled=false);button.removeAttribute('aria-busy');button.textContent=publish?'Publish':'Unpublish';}
    }
  };
  document.body.append(modal);modal.showModal();modal.querySelector('[data-publication-cancel]').focus();
  return {promise,cancel:()=>finish(null)};
}

export function renderPublicLinkControls(doc) {
  const url=documentShareLink(doc);
  if(!url)return '';
  return '<a class="button tertiary compact" href="'+e(url)+'" target="_blank" rel="noopener noreferrer" title="Open published document" aria-label="Open published document">'+documentIcons.globe+'<span>Open published document</span></a><button type="button" class="button tertiary compact icon-button documents-icon" data-copy-published title="Copy public link" aria-label="Copy public link">'+documentIcons.copy+'</button>';
}
