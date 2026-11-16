import { loadDefaultStepImages } from './document-default-images.js';
import { createDocumentImagesAPI } from './document-images-api.js';
import { initStudioSelects } from './studio-select.js';
import { openGenerationDialog } from './document-generation-dialog.js';
import { mountFieldDateFormats } from './document-output-dates.js';
import { generateDocumentInBatches } from './document-generation.js';
import { mountSectionRules, updateStudioOutlineStatus } from './document-rules-editor.js';
import { mountDocumentDateEditors } from './document-date-editor.js';
import { mountDocumentRichEditors } from './document-rich-editor.js';
import { openPublicationDialog, renderPublicLinkControls, publicationAvailability } from './document-publication.js';
import { mountDocumentsLibrary } from './documents-library-layout.js';
import { openDocumentSettings } from './document-settings.js';
import { saveStudioCRM, mergeCRMResponse, loadStudioCRM, lookupStudioBooking } from './document-crm-direct.js';
import { mountStudioWorkspace } from './studio-workspace.js';
import { confirmSectionChange } from './document-unsaved-changes.js';
import { applyDocumentCRM, collectCRMChanges, fieldEye } from './document-crm-fields.js';
import { renderDocumentsLibrary, documentShareLink, documentIcons } from './documents-list.js';
import { sectionPresentation, renderStudioOutlineTree, renderStudioEditor, renderStudioPreview, renderStudioPaper, replaceJourneyLine } from "./document-studio-layout.js";
import { openDocumentImport } from "./document-studio-import.js";
import { canManageDocuments, requestDocuments, validateDocumentWorkspaceResponse, groupDocumentBlocks, buildBlockEdit, DOCUMENTS_CONFIG } from "./documents-api.js";
import { escapeHtml } from "./utils.js";

const e = escapeHtml;

export function createBookingDocumentsController(elements, state, dependencies = {}) {
  initStudioSelects();
  const imagesAPI = dependencies.imagesAPI || createDocumentImagesAPI({crm: dependencies.crmAPI, prepareImage: dependencies.prepareDocumentImage});
  let crmSession={key:'',raw:new Map(),suppliers:new Map(),sourceBookingIds:new Set()};
  const sendRequest = dependencies.request || ((action, values) => requestDocuments(state, action, values));
  const request = async (action, values) => {
    const loadSequence = sequence;
    const wasEditorOpen = !!dialog;
    const bookingId = String(state.selectedBookingId || '');
    if(action==='lookup_booking')return lookupStudioBooking(state,values.additional_booking_reference,{api:dependencies.crmAPI,sourceBookingIds:crmSession.sourceBookingIds,isCurrent:()=>sequence===loadSequence&&String(state.selectedBookingId||'')===bookingId&&!!dialog});
    const {reuse_crm=false,...requestValues}=values;
    const response = validateDocumentWorkspaceResponse(action, requestValues,
      await sendRequest(action, ['get','save_block','save_settings'].includes(action) ? {...requestValues,crm_mode:'client'} : requestValues));
    const sessionKey=bookingId+':'+String(response.document?.id||values.document_id||'');
    const currentRequest=()=>sequence===loadSequence && String(state.selectedBookingId||'')===bookingId && (!wasEditorOpen || !!dialog);
    if(!currentRequest())return response;
    if(response.crm_load_required&&(crmSession.key!==sessionKey||(action==='get'&&!reuse_crm)))crmSession={key:sessionKey,raw:new Map(),suppliers:new Map(),sourceBookingIds:new Set()};
    if(response.sources)crmSession.sourceBookingIds=new Set(response.sources.map(source=>String(source.booking_id)));
    const loaded=await loadStudioCRM(state,response,{
      rawCache:crmSession.raw,supplierCache:crmSession.suppliers,
      api:dependencies.crmAPI,
      isCurrent:()=>sequence===loadSequence && String(state.selectedBookingId||'')===bookingId && (!wasEditorOpen || !!dialog),
      onProgress:(done,total)=>{
        const loading=dialog?.querySelector('.studio-opening span:last-child');
        if(loading)loading.textContent='Loading booking data ('+done+' / '+total+')...';
      }
    });
    if(action!=='get')return loaded;
    return loadDefaultStepImages(loaded,{api:imagesAPI,isCurrent:currentRequest,
      onProgress:()=>{const loading=dialog?.querySelector('.studio-opening span:last-child');if(loading)loading.textContent='Loading default step images...';},
      save:(edit,revision)=>request('save_block',{booking_id:bookingId,document_id:loaded.document.id,revision,edit})});
  };
  let sequence = 0;
  let dialog = null;
  let dirty = false;
  let settingsDirty = false;
  let busy = false;
  let removeUnload = null;
  let opener = null;
  let loadedBooking = "";
  let libraryDocuments = [];
  let libraryBooking = "";
  let cancelDeleteConfirmation = null;
  let cancelPublication = null;
  let chromeCleanup = null;
  let cancelSectionChange = null;
  let libraryCleanup = null;
  let libraryFocus = null;

  function close(force = false) {
    if (!dialog) return true;
    if (!force && busy) return false;
    if (!force && settingsDirty && !window.confirm('Discard unsaved document settings?')) return false;
    if (!force && dirty) {
      cancelSectionChange?.();
      cancelSectionChange=confirmSectionChange({studio:dialog,closing:true,sectionName:dialog.querySelector('.studio-properties-heading h2')?.textContent,
        crm:!!dialog.querySelector('[data-crm-field]') && dialog.querySelector('[data-save]')?.disabled===true,
        onDiscard:()=>{dirty=false;if(close())paintLibrary();}});
      return false;
    }
    cancelSectionChange?.(); cancelSectionChange = null;
    chromeCleanup?.(); chromeCleanup = null;
    dialog.close(); dialog.remove(); dialog = null; dirty = false; settingsDirty = false;
    crmSession={key:'',raw:new Map(),suppliers:new Map(),sourceBookingIds:new Set()};
    removeUnload?.(); removeUnload = null;
    if (opener?.isConnected) opener.focus();
    dependencies.onClose?.();
    return true;
  }

  function reset() {
    crmSession={key:'',raw:new Map(),suppliers:new Map(),sourceBookingIds:new Set()};
    libraryCleanup?.(); libraryCleanup=null;
    libraryFocus=null;
    cancelDeleteConfirmation?.();
    cancelPublication?.();
    sequence++; loadedBooking = ""; libraryBooking = ""; libraryDocuments = []; close(true); busy = false;
    elements.manageDocumentsPanel?.replaceChildren();
    if (elements.tabDocuments) elements.tabDocuments.disabled = !state.selectedBookingId;
  }
  function sync() {
    const allowed = canManageDocuments(state);
    if (elements.tabDocuments) {
      elements.tabDocuments.hidden = !allowed;
      elements.tabDocuments.disabled = !state.selectedBookingId || busy;
    }
    if (!allowed) {
      reset();
      if (elements.manageDocumentsPanel) { elements.manageDocumentsPanel.hidden = true; elements.manageDocumentsPanel.replaceChildren(); }
    }
  }
  function current(ticket, bookingId) { return ticket === sequence && String(state.selectedBookingId) === bookingId && canManageDocuments(state); }

  function paintLibrary(options = {}) {
    const panel = elements.manageDocumentsPanel;
    const previous=panel.querySelector('.documents-table-scroll');
    const position={top:previous?.scrollTop || 0,left:previous?.scrollLeft || 0,height:previous?.style.getPropertyValue('--documents-list-height')};
    const focused=panel.contains(document.activeElement)?document.activeElement:null;
    const focusKey=focused?.getAttribute('data-document') || focused?.getAttribute('data-doc-copy') || focused?.getAttribute('data-doc-delete');
    const focusAttribute=focused?.hasAttribute('data-document')?'data-document':focused?.hasAttribute('data-doc-copy')?'data-doc-copy':'data-doc-delete';
    const refreshFocused=focused?.hasAttribute('data-doc-refresh');
    if(focused)libraryFocus={focusKey,focusAttribute,refreshFocused};
    libraryCleanup?.(); libraryCleanup=null;
    panel.innerHTML = renderDocumentsLibrary(libraryDocuments, options);
    libraryCleanup=mountDocumentsLibrary(panel);
    const region=panel.querySelector('.documents-table-scroll');
    if(region){if(position.height)region.style.setProperty('--documents-list-height',position.height);region.scrollTop=position.top;region.scrollLeft=position.left;region.classList.toggle('is-scrolled-x',region.scrollLeft>0);}
    panel.querySelector('[data-doc-create]').onclick = event => create(event.currentTarget);
    const refresh = () => { if (busy) return; loadedBooking = ''; ensure(); };
    panel.querySelector('[data-doc-refresh]').onclick = refresh;
    panel.querySelector('[data-doc-retry]')?.addEventListener('click', refresh);
    panel.querySelectorAll('[data-document]').forEach(button => button.onclick = () => open(button.dataset.document, button));
    panel.querySelectorAll('[data-doc-delete]').forEach(button => button.onclick = () => removeDocument(libraryDocuments.find(doc => String(doc.id) === button.dataset.docDelete)));
    panel.querySelectorAll('[data-doc-copy]').forEach(button => button.onclick = async () => {
      if (button.disabled || busy) return;
      const doc = libraryDocuments.find(item => String(item.id) === button.dataset.docCopy);
      const url = doc && documentShareLink(doc);
      const feedback = panel.querySelector('.documents-feedback');
      if (!url) { feedback.textContent = 'A shareable link is no longer available. Refresh the list.'; return; }
      const ticket = sequence, bookingId = String(state.selectedBookingId);
      button.disabled = true; button.setAttribute('aria-busy', 'true');
      try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
        else {
          const field = document.createElement('textarea');
          field.value = url; field.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
          panel.append(field); field.select();
          try { if (!document.execCommand('copy')) throw new Error('Copy unavailable'); }
          finally { field.remove(); button.focus({preventScroll:true}); }
        }
        if (current(ticket, bookingId) && button.isConnected) {
          feedback.textContent = 'Link copied.';
          setTimeout(() => { if (feedback.isConnected && feedback.textContent === 'Link copied.') feedback.textContent = ''; }, 3000);
        }
      } catch (_) {
        if (current(ticket, bookingId) && button.isConnected) feedback.textContent = 'Could not copy the link. Check clipboard permissions and try again.';
      } finally {
        if (current(ticket, bookingId) && button.isConnected) { button.disabled = false; button.removeAttribute('aria-busy'); }
      }
    });
    if (options.loading) panel.querySelectorAll('button').forEach(button => button.disabled = true);
    if(!options.loading && libraryFocus){
      const {refreshFocused,focusKey,focusAttribute}=libraryFocus;
      const replacement=refreshFocused?panel.querySelector('[data-doc-refresh]'):[...panel.querySelectorAll('['+focusAttribute+']')].find(item=>item.getAttribute(focusAttribute)===focusKey);
      (replacement || region)?.focus({preventScroll:true});
      libraryFocus=null;
    }
  }

  async function ensure() {
    sync();
    const panel = elements.manageDocumentsPanel;
    if (!panel || !canManageDocuments(state) || !state.selectedBookingId) return;
    const bookingId = String(state.selectedBookingId);
    if (loadedBooking === bookingId && panel.childElementCount) return;
    if (libraryBooking !== bookingId) { libraryDocuments = []; libraryBooking = bookingId; }
    const ticket = ++sequence;
    paintLibrary({loading:true});
    try {
      const response = await request('list', { booking_id: bookingId });
      if (!current(ticket, bookingId)) return;
      libraryDocuments = response.documents || [];
      loadedBooking = bookingId;
      paintLibrary();
    } catch (error) {
      if (!current(ticket, bookingId)) return;
      paintLibrary({error: 'Documents are not available. ' + error.message});
    }
  }

  async function removeDocument(doc) {
    if (!doc || busy || cancelDeleteConfirmation || !canManageDocuments(state) || !state.selectedBookingId) return;
    const bookingId = String(state.selectedBookingId);
    const confirmationSequence = sequence;
    const confirmed = await new Promise(resolve => {
      const trigger = document.activeElement;
      const confirmation = document.createElement('dialog');
      confirmation.className = 'document-delete-dialog';
      confirmation.setAttribute('aria-labelledby', 'document-delete-title');
      confirmation.setAttribute('aria-describedby', 'document-delete-description');
      confirmation.innerHTML = '<h2 id="document-delete-title">Delete document?</h2><p class="document-delete-name">' + e(doc.title || 'Untitled document') + '</p><p id="document-delete-description">It will be removed from every linked booking, together with its saved sections and versions. Any public link will stop working. CRM bookings and shared library content will be kept. This cannot be undone.</p><div class="document-delete-actions"><button type="button" class="button tertiary" data-cancel-delete>Cancel</button><button type="button" class="button" data-confirm-delete>Delete document</button></div>';
      let settled = false;
      const finish = accepted => {
        if (settled) return;
        settled = true;
        confirmation.close(); confirmation.remove(); cancelDeleteConfirmation = null;
        if (trigger?.isConnected) trigger.focus({preventScroll:true});
        resolve(accepted);
      };
      cancelDeleteConfirmation = () => finish(false);
      confirmation.querySelector('[data-cancel-delete]').onclick = () => finish(false);
      confirmation.querySelector('[data-confirm-delete]').onclick = () => finish(true);
      confirmation.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
      document.body.append(confirmation); confirmation.showModal();
      confirmation.querySelector('[data-cancel-delete]').focus();
    });
    if (!confirmed || busy || !current(confirmationSequence, bookingId)) return;
    const ticket = ++sequence;
    const panel = elements.manageDocumentsPanel;
    const status = document.createElement('div');
    status.className = 'documents-delete-status'; status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.innerHTML = '<span class="mail-send-spinner" aria-hidden="true"></span><div><strong>Deleting document&hellip;</strong><span class="documents-delete-name">' + e(doc.title || 'Untitled document') + '</span></div>';
    panel.querySelector('.documents-delete-status')?.remove();
    panel.querySelector('.documents-library > .card-header').after(status);
    busy = true;
    panel.querySelectorAll('button').forEach(button => button.disabled = true);
    try {
      const deleted = await request('delete', { booking_id: bookingId, document_id: String(doc.id), revision: Number(doc.revision), confirm_delete: true });
      if (!current(ticket, bookingId)) return;
      if (deleted.deleted !== true) throw new Error('Deletion was not confirmed.');
      libraryDocuments = libraryDocuments.filter(item => String(item.id) !== String(doc.id));
      busy = false; loadedBooking = ''; await ensure();
      if(loadedBooking===bookingId && String(state.selectedBookingId)===bookingId){
        const feedback=panel.querySelector('.documents-feedback');
        if(feedback)feedback.textContent='Document deleted.';
      }
    } catch (error) {
      if (!current(ticket, bookingId)) return;
      status.setAttribute('role', 'alert');
      status.textContent = error.message + ' Refresh the list to check the result before trying again.';
    } finally {
      if (current(ticket, bookingId)) {
        busy = false;
        panel.querySelectorAll('button').forEach(button => button.disabled = false);
      }
    }
  }

  function create(button) {
    if (!canManageDocuments(state) || !state.selectedBookingId || !close()) return;
    opener = button;
    const bookingId = String(state.selectedBookingId);
    const ticket = ++sequence;
    dialog = document.createElement('dialog');
    dialog.className = 'document-create-dialog';
    dialog.setAttribute('aria-labelledby', 'document-create-title');
    dialog.innerHTML = '<form><span class="documents-eyebrow">Document Studio</span><h2 id="document-create-title">Create a document</h2><label class="studio-field document-name-field">Document name<input type="text" data-document-name required maxlength="255" autocomplete="off" placeholder="e.g. Barcelona Study Tour - Angela"></label><fieldset><legend>Document type</legend>' +
      [['FID','Final itinerary','Our current itinerary template, inspired by Ezus.'],['Proposal','Travel proposal','Not available yet.'],['Quote','Travel quote','Not available yet.']].map(([type,title,description],i) => '<label class="document-type-option"><input type="radio" name="document_type" value="' + type + '"' + (i === 0 ? ' checked' : ' disabled') + '><span><strong>' + type + ' · ' + title + '</strong><small>' + description + '</small></span></label>').join('') +
      '</fieldset><div class="document-create-status" role="status" aria-live="polite" aria-atomic="true"></div><div class="document-create-actions"><button type="button" class="button tertiary" data-cancel>Cancel</button><button type="submit" class="button primary">Create draft</button></div></form>';
    document.body.append(dialog); dialog.showModal();
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.querySelector('[data-cancel]').onclick = () => close();
    const unload = event => { if (busy) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', unload);
    removeUnload = () => window.removeEventListener('beforeunload', unload);
    const form = dialog.querySelector('form');
    form.querySelector('[data-document-name]').oninput = event => event.currentTarget.setCustomValidity('');
    form.onsubmit = async event => {
      event.preventDefault();
      if (busy || !current(ticket, bookingId)) return;
      const documentType = form.querySelector('input:checked')?.value;
      if (documentType !== 'FID') return;
      const nameInput = form.querySelector('[data-document-name]');
      const documentName = nameInput.value.trim();
      if (!documentName || documentName.length > 255) {
        nameInput.setCustomValidity('Enter a document name between 1 and 255 characters.');
        nameInput.reportValidity(); return;
      }
      const status = form.querySelector('[role="status"]');
      busy = true;
      form.querySelectorAll('input, button').forEach(input => input.disabled = true);
      status.dataset.state = 'creating';
      status.innerHTML = '<span class="document-create-spinner" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M13 3H5v18h14V9Z M13 3v6h6 M8 13h8 M8 17h5"/></svg></span><div class="document-create-progress-copy"><strong>Creating document</strong><span>' + e(documentName) + '</span></div>';
      try {
        const created = await request('create', { booking_id: bookingId, document_type: documentType, document_name: documentName });
        if (!current(ticket, bookingId) || !dialog) return;
        if (!/^\d+$/.test(String(created.document_id || ''))) throw new Error('The creation response did not include a document ID.');
        busy = false; close(); loadedBooking = '';
        await ensure();
        if (!current(ticket + 1, bookingId)) return;
        await open(String(created.document_id), elements.manageDocumentsPanel.querySelector('[data-doc-create]'));
      } catch (error) {
        if (!current(ticket, bookingId) || !dialog) return;
        status.dataset.state = 'error';
        status.textContent = error.message + ' Return to Documents and refresh before trying again; the draft may already have been created.';
        status.setAttribute('role', 'alert');
        const back = form.querySelector('[data-cancel]');
        back.disabled = false; back.textContent = 'Back to documents';
        loadedBooking = '';
      } finally {
        if (current(ticket, bookingId)) busy = false;
      }
    };
  }

  async function open(documentId, button) {
    if (!canManageDocuments(state) || !close()) return;
    opener = button;
    const bookingId = String(state.selectedBookingId);
    const ticket = ++sequence;
    dialog = document.createElement('dialog');
    dialog.className = 'document-studio';
    dialog.setAttribute('aria-label', 'Travel document editor');
    dialog.innerHTML = '<div class="documents-empty studio-opening" role="status"><span class="mail-send-spinner" aria-hidden="true"></span><span>Opening your document…</span></div>';
    document.body.append(dialog); dialog.showModal();
    dialog.addEventListener('cancel', event => { event.preventDefault(); if (close()) paintLibrary(); });
    const unload = event => { if (dirty || settingsDirty || busy) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', unload);
    removeUnload = () => window.removeEventListener('beforeunload', unload);
    try {
      let response = await request('get', { booking_id: bookingId, document_id: documentId });
      if (!current(ticket, bookingId) || !dialog) return;
      let groups = applyDocumentCRM(groupDocumentBlocks(response.blocks), response);
      let selected = 0;
      let importNotice = response.image_default_notice || '';
      const chromeState = {query:'',panel:'preview',zoom:null};
      let generationRequestKey = null;
      let generationRequestRevision = null;
      function render(pending=null) {
        if (!dialog || !current(ticket, bookingId)) return;
        cancelSectionChange?.(); cancelSectionChange = null;
        chromeCleanup?.(); chromeCleanup = null;
        // The sections are rebuilt below; retain the reader's position in the index.
        const scrollPositions = ['.studio-outline-tree', '.studio-layout', '.studio-canvas', '.studio-inspector-body'].map(selector => {
          const element = dialog.querySelector(selector);
          return { selector, top: element?.scrollTop || 0, left: element?.scrollLeft || 0, visible: !!element?.clientHeight };
        });
        const focusOutline = dialog.querySelector('.studio-outline')?.contains(document.activeElement);
        const doc = response.document;
        // Only confirmed server metadata enters the list; editor input never does.
        // Returning to Documents is local. A refresh remains an explicit read action.
        if(libraryBooking===bookingId) {
          libraryDocuments=libraryDocuments.map(item=>{
            if(String(item.id)!==String(doc.id))return item;
            const changed=item.revision!==doc.revision || item.status!==doc.status;
            return {...item,...doc,...(changed && !doc.updated_at?{updated_at:'',updated_by:''}:{}),...(doc.status!=='Published'?{version_key:''}:{})};
          });
        }
        const selectedGroup = groups[selected];
        // Retain the CRM draft's original version so a document save cannot bypass stale-write checks.
        const group = pending?.crmRecord ? {...selectedGroup,crmRecords:selectedGroup.crmRecords.map((record,index)=>index===pending.crmIndex?pending.crmRecord:record)} : selectedGroup;
        if (!group) throw new Error('This document has no editable sections.');
        const source = (response.sources || []).find(item => item.id === group.source_id);
        const presentation = sectionPresentation(group);
        dialog.innerHTML = '<header class="studio-header"><button type="button" class="studio-back" data-close>← Back to Documents</button><div class="studio-title"><span class="documents-eyebrow">Document Studio · ' + e(doc.type) + '</span><h1>' + e(doc.title) + '</h1></div><span class="document-status">' + e(doc.status) + '</span><a class="button tertiary" href="' + e(DOCUMENTS_CONFIG.preview + encodeURIComponent(documentId)) + '" target="_blank" rel="noopener noreferrer">Preview ↗</a><button type="button" class="button primary" data-save disabled>Save section</button></header>' +
          '<div class="studio-layout"><nav class="studio-outline" aria-label="Document sections"><div class="studio-outline-heading">Your document <span>' + groups.length + '</span></div>' + renderStudioOutlineTree(groups, selected) + '</nav>' +
          '<main class="studio-canvas"><div class="studio-save-status" role="status">All changes saved · revision ' + e(doc.revision) + '</div>' + (importNotice ? '<div class="studio-import-notice" role="status">' + e(importNotice) + '</div>' : '') + renderStudioPreview(groups, doc) + '</main>' +
          '<aside class="studio-inspector">' + renderStudioEditor(group, doc, groups) + '<span class="documents-eyebrow">Section settings</span><h2>' + e(presentation.label) + '</h2><p class="studio-hint">' + e(presentation.hint) + '</p><label class="studio-visibility"><input data-visible type="checkbox"' + (group.visible ? ' checked' : '') + '> Show in document</label><label hidden><input type="hidden" data-image value="' + e(group.image || '') + '"></label><div class="studio-origin"><span>Content source</span><strong>' + e(source?.label || group.origin.replace('_',' ')) + '</strong>' + (group.start ? '<p>' + e(group.start) + '</p>' : '') + '</div>' + (group.service_id ? '<p class="studio-hint">This service follows its parent activity. Hiding the activity also hides its services in the preview.</p>' : '') + (group.type === 'Shared_Content' ? '<p class="studio-hint">Hiding this heading hides the entire Workshop.</p>' : '') + (['Overview','Itinerary'].includes(group.type) ? '<p class="studio-hint">This section’s contents are generated from the itinerary. Edit the individual activities to change them.</p>' : '') + '</aside></div>';
        updateStudioOutlineStatus(dialog,response.crm_records||{});
        const title = dialog.querySelector('#studio-block-title');
        const body = dialog.querySelector('#studio-block-body');
        const visible = dialog.querySelector('[data-visible]');
        const image = dialog.querySelector('[data-image]');
        const save = dialog.querySelector('[data-save]');
        dialog.querySelector('.studio-inspector').append(save);
        const hiddenFields = new Set(group.hidden_fields || []);
        for(const item of pending||[])if(item.selector.startsWith('[data-field-eye=')){const button=dialog.querySelector(item.selector);if(button){if(item.value==='false')hiddenFields.add(button.dataset.fieldEye);else hiddenFields.delete(button.dataset.fieldEye);button.setAttribute('aria-pressed',item.value);button.innerHTML=fieldEye(item.value==='true');button.title=item.value==='true'?'Hide in document':'Show in document';button.setAttribute('aria-label',button.title+': '+button.closest('.studio-crm-field').querySelector('label').textContent);}}
        const fieldEyes = [...dialog.querySelectorAll('[data-field-eye]')];
        const status = dialog.querySelector('.studio-save-status');
        const editable = doc.status === 'Draft' || (doc.status === 'Published' && doc.render_mode === 'Versioned');
        const liveCRM = group.crmRecords?.length > 0;
        let presentationDirty = false;
        let crmDirty = null;
        let crmNeedsReload = pending?.crmNeedsReload || false;
        let inspectorError = '', saveOperation = '';
        const sectionRules=mountSectionRules(dialog.querySelector('.studio-inspector'),group,doc,response.crm_records||{},()=>{inspectorError='';presentationDirty=documentChangesPending();dirty=presentationDirty;save.disabled=!presentationDirty;enableCRMEditing();},{api:dependencies.crmAPI,supplierCache:crmSession.suppliers});
        const fieldDateFormats=mountFieldDateFormats(dialog,group,doc.settings,()=>{inspectorError='';presentationDirty=documentChangesPending();enableCRMEditing();status.textContent=presentationDirty?'Unsaved document changes':'No pending document changes';});
        function documentChangesPending() {
          return fieldDateFormats.dirty() || sectionRules.dirty() || visible.checked !== group.visible || image.value.trim() !== (group.image || '') ||
            (!liveCRM && (title.value !== (group.title || '') || body.value !== (group.body || ''))) ||
            JSON.stringify([...hiddenFields].sort()) !== JSON.stringify([...(group.hidden_fields || [])].sort());
        }

        const importActions = document.createElement('div');
        importActions.className = 'studio-import-actions';
        importActions.innerHTML = '<button type="button" class="button tertiary compact" data-add-booking>Add booking</button><button type="button" class="button tertiary compact" data-add-shared>Add shared content</button>';
        dialog.querySelector('.studio-header').append(importActions);
        importActions.querySelectorAll('button').forEach(button => {
          button.disabled = !editable;
          button.onclick = () => {
            if (busy || !current(ticket, bookingId)) return;
            if (dirty) { status.textContent = 'Save your changes to this section before adding content.'; return; }
            openDocumentImport({
              studio: dialog, kind: button.hasAttribute('data-add-booking') ? 'booking' : 'shared', request,
              context: { booking_id: bookingId, document_id: documentId, revision: doc.revision },
              isCurrent: () => current(ticket, bookingId) && !!dialog,
              setBusy: value => { busy = value; },
              onImported: async result => {
                const fresh = await request('get', { booking_id: bookingId, document_id: documentId, reuse_crm:true });
                if (!current(ticket, bookingId) || !dialog) return;
                const oldKeys = new Set(groups.map(item => item.key));
                response = fresh; groups = applyDocumentCRM(groupDocumentBlocks(fresh.blocks), fresh);
                const addedIndex = groups.findIndex(item => !oldKeys.has(item.key));
                if (addedIndex >= 0) selected = addedIndex;
                importNotice = 'Content added. Review the combined itinerary before sharing.';
                if (result.overlap_count) importNotice += ' Possible overlaps: ' + result.overlap_count + '.';
                if (result.overlaps?.length) importNotice += '\n' + result.overlaps.map(overlap => overlap.new_title + ' / ' + overlap.existing_title).join('\n');
                if (result.warnings?.length) importNotice += '\n' + result.warnings.map(warning => String(warning).replaceAll('_', ' ')).join('\n');
                loadedBooking = ''; busy = false; render();
              }
            });
          };
        });
        const journeyInputs = [...dialog.querySelectorAll('[data-journey-line]')];
        const contentInputs = [title, body, visible, image, ...journeyInputs];
        contentInputs.forEach(input => input.disabled = !editable);
        if (liveCRM) { title.disabled = true; body.disabled = true; }
        if (group.type === 'Cover') image.closest('label').hidden = true;
        if(pending)for(const item of pending){const input=dialog.querySelector(item.selector);if(input){input.value=item.value;if(item.dateError!==undefined)input.dataset.dateError=item.dateError;if(item.checked!==undefined)input.checked=item.checked;}}
        const capturePending = scope => {
          const selectors=scope==='crm'?'[data-crm-field],.studio-date-controls input,.studio-date-controls select':'[data-visible],[data-image],.studio-section-rules select,[data-field-date]';
          const container=scope==='crm'?crmSections[crmDirty]:dialog;
          const edits=[...container.querySelectorAll(selectors)].map(input=>({selector:input.dataset.fieldDate?'[data-field-date="'+input.dataset.fieldDate+'"][data-format-option="'+input.dataset.formatOption+'"]':input.id?'#'+input.id:input.matches('[data-visible]')?'[data-visible]':input.matches('[data-image]')?'[data-image]':'.studio-section-rules select[aria-label="'+input.getAttribute('aria-label')+'"]',value:input.value,...(input.dataset.dateError!==undefined?{dateError:input.dataset.dateError}:{}),...(input.type==='checkbox'?{checked:input.checked}:{})}));
          if(scope==='crm'){edits.crmRecord=structuredClone(group.crmRecords[crmDirty]);edits.crmIndex=crmDirty;edits.crmNeedsReload=crmNeedsReload;}
          return edits;
        };
        const syncRichEditors = mountDocumentRichEditors(dialog);
        const syncDateEditors = mountDocumentDateEditors(dialog,group.crmRecords || []);
        if(pending)for(const item of pending){const input=dialog.querySelector(item.selector);if(input?.closest('.studio-date-controls'))input.value=item.value;}
        const crmSections = [...dialog.querySelectorAll('[data-crm-record]')];
        const crmButtons = crmSections.map(section => section.querySelector('[data-crm-save]'));
        function enableCRMEditing() {
          let validation = '';
          crmSections.forEach((section,index) => {
            const locked = !editable || busy || crmNeedsReload || (crmDirty !== null && crmDirty !== index);
            section.querySelectorAll('[data-crm-field]').forEach(input => input.disabled = locked);
            let validChanges = false;
            try { validChanges = Object.keys(collectCRMChanges(section, group.crmRecords[index])).length > 0; } catch (error) { if (crmDirty === index) validation = error.message; }
            crmButtons[index].disabled = locked || crmDirty !== index || !validChanges;
          });
          syncRichEditors();
          syncDateEditors();
          sectionRules.sync(!editable || busy);
          fieldDateFormats.sync(!editable || busy);
          image.disabled = !editable || busy;
          const removeImage=dialog.querySelector('[data-remove-image]');if(removeImage)removeImage.disabled=image.disabled || !image.value;
          save.disabled = !editable || busy || !presentationDirty;
          dirty = presentationDirty || crmDirty !== null;
          const pendingDot=dialog.querySelector('.studio-outline [aria-current="true"] .studio-outline-pending');if(pendingDot)pendingDot.hidden=!dirty;
          visible.disabled = image.disabled || String(group.crmRecords?.[0]?.step_type||'').trim().toLowerCase()==='extra';
          const removeSection=dialog.querySelector('[data-remove-section]');if(removeSection)removeSection.disabled=visible.disabled || !visible.checked;
          fieldEyes.forEach(button => button.disabled = !editable || busy);
          chromeCleanup?.updateInspector?.({editable, busy, operation:saveOperation, crmDirty, presentationDirty, reload:crmNeedsReload, error:inspectorError, validation});
        }
        crmSections.forEach((section,index) => {
          const record = group.crmRecords[index];
          const crmStatus = section.querySelector('[data-crm-status]');
          section.querySelectorAll('[data-crm-field]').forEach(input => input.addEventListener('input', () => {
            let changed = true;
            try { changed = Object.keys(collectCRMChanges(section, record)).length > 0; } catch (_) {}
            inspectorError = ''; crmDirty = changed ? index : null; dirty = changed; save.disabled = true;
            status.textContent = changed ? 'Unsaved CRM changes' : 'No pending changes';
            crmStatus.textContent = changed ? 'Unsaved CRM changes. These changes affect every draft using this record.' : 'No pending CRM changes.';
            enableCRMEditing();
          }));
          crmButtons[index].onclick = async () => {
            if (busy || !current(ticket, bookingId)) return;
            const crmSave = crmButtons[index];
            try {
              const changes = collectCRMChanges(section, record);
              if (!Object.keys(changes).length) { crmDirty = null; dirty = false; crmStatus.textContent = 'No CRM changes to save.'; enableCRMEditing(); return; }
              inspectorError = ''; saveOperation = 'crm'; busy = true; enableCRMEditing(); crmStatus.textContent = ''; status.textContent = 'Saving to CRM...';
              crmSave.setAttribute('aria-busy', 'true');
              crmSave.setAttribute('aria-label', 'Saving to CRM');
              crmSave.innerHTML = '<span class="studio-button-spinner" aria-hidden="true"></span><span>Save to CRM</span>';
              const update = dependencies.saveCRM ? await dependencies.saveCRM(record, changes) : await saveStudioCRM(state, record, changes, {api:dependencies.crmAPI,supplierCache:crmSession.suppliers,records:response.crm_records,settings:response.document?.settings,blocks:response.blocks,isCurrent:()=>current(ticket,bookingId) && !!dialog});
              dependencies.onCRMUpdated?.(update);
              if (!current(ticket, bookingId) || !dialog) return;
              if(update.raw)crmSession.raw.set(record.module+':'+record.id,update.raw);else crmSession.raw.delete(record.module+':'+record.id);
              const saved = mergeCRMResponse(response, record.key, update.record);
              if (!current(ticket, bookingId) || !dialog) return;
              response = saved; groups = applyDocumentCRM(groupDocumentBlocks(saved.blocks), saved);
              dirty = false; busy = false; importNotice = ''; render(presentationDirty ? capturePending('document').concat(fieldEyes.map(button=>({selector:'[data-field-eye="'+button.dataset.fieldEye+'"]',value:button.getAttribute('aria-pressed')}))) : null);
            } catch (error) {
              if(error.crmMayHaveChanged) dependencies.onCRMUpdated?.({booking_id:record.booking_id,module:record.module});
              if (current(ticket, bookingId) && dialog) { inspectorError = error.message; crmNeedsReload = !!error.requiresReload; crmStatus.textContent = error.message + ' Your text is still here.'; status.textContent = error.crmMayHaveChanged ? 'Reload CRM to confirm the saved values.' : 'CRM save failed. Unsaved changes.'; }
            } finally {
              if (current(ticket, bookingId)) {
                busy = false;
                if (section.isConnected) {
                  saveOperation = ''; crmSave.removeAttribute('aria-busy');
                  crmSave.removeAttribute('aria-label');
                  crmSave.textContent = 'Save to CRM';
                  enableCRMEditing();
                }
              }
            }
          };
        });
        fieldEyes.forEach(button => button.onclick = () => {
          if (busy || !editable) return;
          const key = button.dataset.fieldEye;
          if (hiddenFields.has(key)) hiddenFields.delete(key); else hiddenFields.add(key);
          const included = !hiddenFields.has(key);
          button.setAttribute('aria-pressed', String(included)); button.innerHTML = fieldEye(included);
          button.title = included ? 'Hide in document' : 'Show in document'; button.setAttribute('aria-label',button.title + ': ' + button.closest('.studio-crm-field').querySelector('label').textContent);
          inspectorError = ''; presentationDirty = documentChangesPending(); dirty = presentationDirty; save.disabled = !presentationDirty; enableCRMEditing();
          status.textContent = presentationDirty ? 'Unsaved visibility changes. Save section to update the preview.' : 'No pending changes';
        });
        enableCRMEditing();
        if (response.crm_live) {
          const refreshCRM = document.createElement('button');
          refreshCRM.type = 'button'; refreshCRM.className = 'button tertiary compact'; refreshCRM.textContent = 'Reload CRM';
          importActions.append(refreshCRM);
          refreshCRM.onclick = async () => {
            if (busy || (dirty && !window.confirm('Discard unsaved changes and reload the latest CRM fields?'))) return;
            busy = true; refreshCRM.disabled = true; contentInputs.forEach(input => input.disabled = true); enableCRMEditing(); status.textContent = 'Loading current CRM data...';
            try {
              const fresh = await request('get', {booking_id:bookingId,document_id:documentId});
              if (!current(ticket, bookingId) || !dialog) return;
              response = fresh; groups = applyDocumentCRM(groupDocumentBlocks(fresh.blocks), fresh); dirty = false; busy = false; render();
            } catch(error) { if(current(ticket, bookingId) && dialog) status.textContent = error.message; }
            finally { if(current(ticket, bookingId)) { busy = false; refreshCRM.disabled = false; if(refreshCRM.isConnected) { contentInputs.forEach(input => input.disabled = !editable); if(liveCRM) {title.disabled = true; body.disabled = true;} enableCRMEditing(); } } }
          };
        }
        journeyInputs.forEach(input => input.addEventListener('input', () => {
          body.value = replaceJourneyLine(body.value, Number(input.dataset.journeyLine), input.value);
          body.dispatchEvent(new Event('input', { bubbles: true }));
        }));
        const refreshImagePreview = () => {
          if(liveCRM){if(image.value.trim())hiddenFields.delete(group.key+'|Image');else hiddenFields.add(group.key+'|Image');}
          const updated = {...group,image:image.value.trim()};
          const previewGroups = groups.map(item=>item.key===group.key?updated:item);
          for(const target of dialog.querySelectorAll('[data-preview-key]')) {
            if(target.dataset.previewKey!==group.key)continue;
            const template=document.createElement('template');template.innerHTML=renderStudioPaper(updated,doc,previewGroups,!!target.closest('.fid-entry-services'));
            const replacement=template.content.firstElementChild;
            if(target.tagName==='DETAILS')replacement.open=target.open;
            target.replaceWith(replacement);
          }
        };
        image.addEventListener('input',refreshImagePreview);
        if(image.value.trim()!==(group.image||''))refreshImagePreview();
        [title, body, visible, image].forEach(input => input.addEventListener('input', () => { inspectorError = ''; presentationDirty = documentChangesPending(); dirty = presentationDirty; save.disabled = !presentationDirty; enableCRMEditing(); status.textContent = presentationDirty ? 'Unsaved document changes' : 'No pending changes'; }));
        dialog.querySelector('[data-close]').onclick = () => { if (close()) paintLibrary(); };
        dialog.querySelectorAll('[data-section], [data-jump-key]').forEach(tab => tab.onclick = event => {
          tab.closest('.fid-mobile-menu')?.removeAttribute('open');
          event.preventDefault();
          if (busy || tab.getAttribute('aria-disabled')==='true') return;
          const nextSelected=tab.dataset.jumpKey ? groups.findIndex(item => item.key === tab.dataset.jumpKey) : Number(tab.dataset.section);
          if(nextSelected<0 || !groups[nextSelected] || (nextSelected===selected && dirty))return;
          const switchSection=()=>{
            if(!dialog || !current(ticket,bookingId) || busy)return;
            chromeState.panel = 'properties';
            dirty = false; selected = nextSelected; chromeState.navigationDay=tab.dataset.jumpDay;
            if (chromeState.query && !String(groups[selected]?.title || '').toLowerCase().includes(chromeState.query.toLowerCase())) chromeState.query = '';
            render();
            dialog.querySelector('.studio-outline-tree').revealSection();
            chromeCleanup.navigatePreview(groups[selected]?.key, tab.dataset.jumpDay);
            dialog.querySelector('.studio-inspector-body').scrollTop = 0;
            if (window.matchMedia('(max-width:950px)').matches) dialog.querySelector('.studio-properties-heading h2').focus({preventScroll:true});
          };
          if(!dirty){switchSection();return;}
          cancelSectionChange?.();
          cancelSectionChange=confirmSectionChange({studio:dialog,sectionName:group.title,crm:crmDirty!==null,onDiscard:switchSection});
        });
        save.onclick = async () => {
          if (busy || !current(ticket, bookingId)) return;
          try {
            const edit = liveCRM ? {key:group.key,title:'',body:'',image:image.value.trim(),visibility:visible.checked ? 'Included' : 'Hidden',presentation_only:true,hidden_fields:[...hiddenFields]} : buildBlockEdit(group, { title: title.value, body: body.value, image: image.value, visible: visible.checked });
            if(sectionRules.read())edit.rule_override=sectionRules.read();
            if(liveCRM)edit.date_formats=fieldDateFormats.read();
            inspectorError = ''; saveOperation = 'section'; busy = true; save.disabled = true; save.setAttribute('aria-busy', 'true'); save.innerHTML = '<span class="studio-button-spinner" aria-hidden="true"></span><span>Save section</span>'; status.textContent = 'Saving…';
            contentInputs.forEach(input => input.disabled = true); enableCRMEditing();
            const saved = await request('save_block', { booking_id: bookingId, document_id: documentId, revision: doc.revision, edit });
            if (!current(ticket, bookingId) || !dialog) return;
            response = saved; groups = applyDocumentCRM(groupDocumentBlocks(saved.blocks), saved); dirty = false; busy = false; render(crmDirty!==null ? capturePending('crm') : null);
          } catch (error) {
            if (dialog && current(ticket, bookingId)) {
              inspectorError = error.message; status.textContent = error.message + ' Your text is still here.';
              contentInputs.forEach(input => input.disabled = !editable);
              if (liveCRM) { title.disabled = true; body.disabled = true; }
              save.disabled = !editable;
            }
          } finally { if (current(ticket, bookingId)) { busy = false; if (save.isConnected) { saveOperation = ''; save.removeAttribute('aria-busy'); save.textContent = 'Save section'; enableCRMEditing(); } } }
        };
        chromeState.scrolls ||= {};
        for (const position of scrollPositions) if (position.visible) chromeState.scrolls[position.selector] = position.top;
        if(pending){
          presentationDirty=documentChangesPending();
          crmSections.forEach((section,index)=>{try{if(Object.keys(collectCRMChanges(section,group.crmRecords[index])).length)crmDirty=index;}catch(_){crmDirty=index;}});
          status.textContent=crmDirty!==null && presentationDirty?'Unsaved document and CRM changes':crmDirty!==null?'Unsaved CRM changes':presentationDirty?'Unsaved document changes':'All changes saved';
        }
        chromeCleanup = mountStudioWorkspace(dialog, group, doc, groups, chromeState, response, {imagesAPI});
        enableCRMEditing();
        if(doc.type==='FID') {
          const settingsButton=document.createElement('button');
          settingsButton.type='button';settingsButton.className='button tertiary compact studio-icon-button';settingsButton.dataset.documentSettings='';
          settingsButton.title='Document settings';settingsButton.setAttribute('aria-label','Document settings');settingsButton.disabled=!editable;
          settingsButton.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z"/><path d="m19.4 13.5 1.4 1.1-2 3.5-1.7-.7a7.7 7.7 0 0 1-2.1 1.2L14.7 20h-4l-.3-1.9a7.7 7.7 0 0 1-2.1-1.2l-1.7.7-2-3.5 1.4-1.1a7.8 7.8 0 0 1 0-2.4L4.6 9.5l2-3.5 1.7.7a7.7 7.7 0 0 1 2.1-1.2l.3-1.9h4l.3 1.9a7.7 7.7 0 0 1 2.1 1.2l1.7-.7 2 3.5-1.4 1.1a7.8 7.8 0 0 1 0 2.4Z"/></svg>';
          dialog.querySelector('.studio-header-actions').append(settingsButton);
          settingsButton.onclick=()=>{
            if(busy || !editable || !current(ticket,bookingId))return;
            if(dirty){status.textContent='Save or discard the pending section changes before opening settings.';return;}
            openDocumentSettings({studio:dialog,doc,records:response.crm_records||{},isCurrent:()=>current(ticket,bookingId) && !!dialog,setBusy:value=>{if(current(ticket,bookingId))busy=value;},
              onDirtyChange:value=>{if(current(ticket,bookingId))settingsDirty=value;},
              save:settings=>request('save_settings',{booking_id:bookingId,document_id:documentId,revision:doc.revision,settings}),
              onSaved:fresh=>{response=fresh;groups=applyDocumentCRM(groupDocumentBlocks(fresh.blocks),fresh);importNotice='Settings saved. Generate and review the document before publishing the changes.';loadedBooking='';render();}
            });
          };
        }
        const generatedPreview = dialog.querySelector('.studio-header a');
        generatedPreview.dataset.draftPreview = '';
        generatedPreview.className = 'button tertiary compact';
        generatedPreview.innerHTML = documentIcons.preview + '<span>Open draft preview</span>';
        if(response.generated_version_id) {
          generatedPreview.href = DOCUMENTS_CONFIG.preview + encodeURIComponent(documentId) + '&versionId=' + encodeURIComponent(response.generated_version_id);
          generatedPreview.title = 'Open generated document preview - version ' + response.generated_version_id;
          generatedPreview.setAttribute('aria-label', 'Open generated document preview');
        } else {
          generatedPreview.removeAttribute('href'); generatedPreview.setAttribute('aria-disabled','true');
          generatedPreview.tabIndex = 0;
          generatedPreview.title = 'Generate the document to enable its preview';
          generatedPreview.setAttribute('aria-label', 'Generate the document to enable its preview');
        }
        const generate = document.createElement('button');
        generate.type = 'button'; generate.className = 'button primary compact studio-generate'; generate.dataset.generate = '';
        generate.textContent = 'Generate document'; generate.disabled = !editable;
        const generationStatus = document.createElement('span'); generationStatus.className = 'studio-generation-status'; generationStatus.setAttribute('role','status');
        generationStatus.textContent = response.generated_version_id ? (response.generation_current ? 'Generated preview is up to date' : 'Document needs regeneration') : 'No generated preview yet';
        if(response.generated_version_id && response.generated_draft_revision)generationStatus.textContent += ' - revision ' + response.generated_draft_revision;
        const versions = document.createElement('div');
        versions.className = 'studio-document-versions';
        versions.setAttribute('role','group');versions.setAttribute('aria-label','Document versions');
        const draftControls = document.createElement('section');
        draftControls.className = 'studio-draft-controls';
        draftControls.setAttribute('aria-label','Draft preview');
        draftControls.innerHTML = '<strong>Draft preview</strong><span class="studio-version-help">Review before publishing</span>';
        draftControls.append(generate,generatedPreview,generationStatus);
        versions.append(draftControls);
        const publicationControls = document.createElement('div');
        publicationControls.className = 'studio-publication-controls';
        publicationControls.setAttribute('role','group');publicationControls.setAttribute('aria-label','Published document');
        publicationControls.innerHTML = '<strong>Published document</strong><span class="studio-version-help">' + (documentShareLink(doc) ? 'What your client can see' : 'No active public link') + '</span><button type="button" class="button primary compact" data-publish>' + (doc.status === 'Published' ? 'Publish update' : 'Publish') + '</button>' + (doc.status === 'Published' ? '<button type="button" class="button tertiary compact" data-unpublish>Unpublish</button>' : '') + renderPublicLinkControls(doc);
        versions.append(publicationControls);
        dialog.querySelector('.studio-zoom-toolbar').append(versions);
        const publishButton=publicationControls.querySelector('[data-publish]');
        const publication=publicationAvailability(response,editable);
        publishButton.disabled=!publication.enabled;
        publishButton.title=publication.reason;
        publicationControls.querySelector('[data-copy-published]')?.addEventListener('click',async event=>{
          const button=event.currentTarget;
          if(busy || button.disabled)return;
          const url=documentShareLink(doc);
          if(!url){status.textContent='The link has expired. Publish again with a new expiry date.';return;}
          button.disabled=true;button.setAttribute('aria-busy','true');
          try { await navigator.clipboard.writeText(url);status.textContent='Link copied.'; }
          catch (_) { status.textContent='Could not copy the link. Check clipboard permissions and try again.'; }
          finally {button.disabled=false;button.removeAttribute('aria-busy');}
        });
        const changePublication=async action=>{
          if(busy || !editable || !current(ticket,bookingId))return;
          if(dirty){status.textContent='Save or discard your pending changes before changing publication.';return;}
          if(action==='publish' && !publication.enabled){status.textContent=publication.reason;return;}
          const confirmation=openPublicationDialog({doc,versionId:response.generated_version_id || '',action,warning:publication.warning,execute:async values=>{
            if(!current(ticket,bookingId))throw new Error('The booking changed. Reopen the document.');
            busy=true;
            try {
              const result=await request(action,{booking_id:bookingId,document_id:documentId,revision:doc.revision,...values});
              if(!result.publication || (result.publication.id && String(result.publication.id)!==String(documentId)) ||
                (action==='publish' && String(result.publication.published_version_id)!==String(response.generated_version_id)) ||
                result.document_status!==(action==='publish'?'Published':'Draft'))throw new Error('Publication was not confirmed. Close and reload the document before retrying.');
              return result;
            } finally {if(current(ticket,bookingId))busy=false;}
          }});
          cancelPublication=confirmation.cancel;
          const result=await confirmation.promise;
          cancelPublication=null;
          if(!result || !current(ticket,bookingId) || !dialog)return;
          response={...response,document:{...doc,...result.publication,status:result.document_status}};
          importNotice=action==='publish'?'Document published. The public link now shows this saved version.':'Document unpublished. The public link is unavailable.';
          render();
          // Refresh the list without changing the editor ticket or reloading all CRM records.
          loadedBooking='';
          try {
            const list=await request('list',{booking_id:bookingId});
            if(current(ticket,bookingId)){libraryDocuments=list.documents || [];loadedBooking=bookingId;paintLibrary();}
          } catch (_) {if(current(ticket,bookingId))paintLibrary({error:'Publication changed, but the list could not be refreshed. Refresh documents.'});}
        };
        publishButton.onclick=()=>changePublication('publish');
        publicationControls.querySelector('[data-unpublish]')?.addEventListener('click',()=>changePublication('unpublish'));
        generate.onclick = async () => {
          if(busy || !editable || !current(ticket,bookingId))return;
          if(dirty) { status.textContent = 'Save or discard your pending changes before generating the document.'; return; }
          if(generationRequestRevision!==doc.revision){generationRequestKey=null;generationRequestRevision=doc.revision;}
          generationRequestKey ||= crypto.randomUUID();
          busy = true;
          dialog.querySelectorAll('button,input,textarea,select').forEach(control=>control.disabled=true);
          const generationStudio=dialog;
          const generationDialog=openGenerationDialog({studio:dialog,onClose:()=>{
            if(!current(ticket,bookingId)||!dialog)return;
            render();dialog.querySelector('[data-generate]')?.focus();
          }});
          let confirmedVersion='',failure='',refreshWarning='';
          const previousPreview=!!response.generated_version_id;
          try {
            const generated = await generateDocumentInBatches(request,{booking_id:bookingId,document_id:documentId,revision:doc.revision,request_key:generationRequestKey},{
              isCurrent:()=>current(ticket,bookingId)&&!!dialog,
              onProgress:message=>generationDialog.progress(message)
            });
            if(!current(ticket,bookingId)||!dialog)return;
            if(!generated.version_id)throw new Error('Generation was not confirmed. Reopen the document before trying again.');
            confirmedVersion=generated.version_id;
            response = {...response,generated_version_id:confirmedVersion,generation_current:false};
            generationRequestKey = null;
            generationDialog.progress('Refreshing Studio...');
            const fresh = await request('get',{booking_id:bookingId,document_id:documentId});
            if(!current(ticket,bookingId)||!dialog)return;
            const freshGroups=applyDocumentCRM(groupDocumentBlocks(fresh.blocks),fresh);
            response=fresh;groups=freshGroups;
            importNotice='';
          } catch(error) {
            if(confirmedVersion)refreshWarning='The document was generated, but Studio could not refresh: '+error.message+' Reopen Studio before publishing.';
            else failure=error.message || 'Generation could not be confirmed.';
          } finally {
            if(current(ticket,bookingId)&&dialog){
              busy=false;
              generationDialog.finish({error:failure,warning:refreshWarning,previousPreview,url:confirmedVersion?DOCUMENTS_CONFIG.preview+encodeURIComponent(documentId)+'&versionId='+encodeURIComponent(confirmedVersion):''});
            } else {
              generationDialog.dispose();
              if(dialog===generationStudio){close(true);busy=false;}
            }
          }
        };

        for (const position of scrollPositions) {
          const element = dialog.querySelector(position.selector);
          if (element.clientHeight) element.scrollTop = chromeState.scrolls[position.selector] || 0;
        }
        if (focusOutline && !window.matchMedia('(max-width:950px)').matches) dialog.querySelector('[data-section="' + selected + '"]')?.focus({preventScroll:true});
      }
      render();
    } catch (error) {
      if (!current(ticket, bookingId) || !dialog) return;
      dialog.innerHTML = '<div class="documents-empty" role="alert"><h2>Unable to open this document</h2><p>' + e(error.message) + '</p><div class="document-create-actions"><button type="button" class="button tertiary" data-open-back>Back to Documents</button><button type="button" class="button primary" data-open-retry>Retry</button></div></div>';
      dialog.querySelector('[data-open-back]').onclick = () => { if(close())paintLibrary(); };
      dialog.querySelector('[data-open-retry]').onclick = () => open(documentId, opener);
    }
  }
  return { ensure, sync, reset, open, hasPendingChanges: () => dirty || settingsDirty || busy };
}
