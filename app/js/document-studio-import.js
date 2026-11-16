import { escapeHtml } from './utils.js';
import { documentIcons } from './documents-list.js';

// Nested modal: removed with its owning studio on booking change or access revocation.
export function openDocumentImport({ studio, kind, request, context, isCurrent, setBusy, onImported }) {
  const shared = kind === 'shared';
  const modal = document.createElement('dialog');
  modal.className = 'document-create-dialog document-import-dialog' + (shared ? ' document-shared-dialog' : '');
  modal.setAttribute('aria-label', shared ? 'Add shared content' : 'Add booking');
  modal.innerHTML = '<form><h2>' + (shared ? 'Add shared content' : 'Add another booking') + '</h2>' +
    (shared ? '<label class="studio-field">Shared content<span class="shared-select-wrap"><select data-shared disabled><option value="">Select shared content</option></select><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></span></label>' : '<label class="studio-field" for="studio-booking-reference">MFSP Reference</label><div class="studio-booking-search"><input id="studio-booking-reference" data-booking autocomplete="off" maxlength="80" placeholder="e.g. MFOF2609861"><button type="button" class="button tertiary studio-icon-button" data-find title="Find booking" aria-label="Find booking">' + documentIcons.search + '</button></div><p data-candidate></p>') +
    '<p role="status" data-status></p><div class="document-create-actions"><button type="button" class="button tertiary" data-cancel>Cancel</button><button type="submit" class="button primary" disabled>Add to document</button></div></form>';
  studio.append(modal); modal.showModal();
  const form = modal.querySelector('form');
  const status = modal.querySelector('[data-status]');
  const submit = modal.querySelector('[type="submit"]');
  let pending = false, candidate = null;
  const alive = () => modal.isConnected && isCurrent();
  const dismiss = () => { if (!pending) { modal.close(); modal.remove(); } };
  modal.querySelector('[data-cancel]').onclick = dismiss;
  modal.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
  function lock(value) {
    pending = value; setBusy(value);
    form.querySelectorAll('button,input,select').forEach(el => el.disabled = value);
    if (!value) submit.disabled = shared ? !modal.querySelector('[data-shared]').value : !candidate;
  }
  const input = modal.querySelector('[data-booking]');
  if (input) {
    input.oninput = () => { candidate = null; submit.disabled = true; modal.querySelector('[data-candidate]').textContent = ''; status.textContent = ''; };
    const find = modal.querySelector('[data-find]');
    find.onclick = async () => {
      if (pending || !alive()) return;
      const reference = input.value.trim().toUpperCase();
      if (!/^[A-Z0-9_-]{1,80}$/.test(reference)) { status.textContent = 'Enter a valid MFSP Reference.'; return; }
      candidate = null; lock(true); status.textContent = '';
      modal.querySelector('[data-candidate]').textContent = '';
      find.setAttribute('aria-busy','true');
      find.setAttribute('aria-label','Finding booking');
      find.innerHTML = '<span class="studio-button-spinner" aria-hidden="true"></span>';
      try {
        const response = await request('lookup_booking', { ...context, additional_booking_reference: reference });
        if (!alive()) return;
        candidate = response.booking;
        modal.querySelector('[data-candidate]').textContent = candidate.name + ' · ' + candidate.reference;
        status.textContent = '';
      } catch (error) { if (alive()) status.textContent = error.message; }
      finally { if (alive()) { find.removeAttribute('aria-busy'); find.setAttribute('aria-label','Find booking'); find.innerHTML = documentIcons.search; lock(false); } }
    };
  } else {
    const select = modal.querySelector('[data-shared]');
    select.onchange = () => { submit.disabled = !select.value; };
    lock(true);
    status.innerHTML = '<span class="studio-button-spinner" aria-hidden="true"></span><span>Loading library...</span>';
    select.setAttribute('aria-busy', 'true');
    request('shared_library', context).then(response => {
      if (!alive()) return;
      const entries = response.assigned ? [] : response.entries || [];
      select.innerHTML = '<option value="">Select shared content</option>' + entries.map(entry => '<option value="' + escapeHtml(entry.id) + '">' + escapeHtml(entry.name + ' · v' + entry.revision + ' · ' + entry.status) + '</option>').join('');
      status.textContent = response.assigned ? 'This document already has shared content.' : entries.length ? '' : 'No shared content available.';
    }).catch(error => { if (alive()) status.textContent = error.message; }).finally(() => { if (alive()) { select.removeAttribute('aria-busy'); lock(false); } });
  }
  form.onsubmit = async event => {
    event.preventDefault();
    if (pending || submit.disabled || !alive()) return;
    const values = shared ? { shared_content_id: modal.querySelector('[data-shared]').value } : { additional_booking_id: candidate.id };
    lock(true); status.textContent = '';
    submit.setAttribute('aria-busy', 'true');
    submit.setAttribute('aria-label', 'Adding to document');
    submit.innerHTML = '<span class="studio-button-spinner" aria-hidden="true"></span><span>Add to document</span>';
    try {
      const result = await request(shared ? 'add_shared' : 'add_booking', { ...context, ...values });
      if (!alive()) return;
      status.textContent = '';
      await onImported(result.import_result || {});
    } catch (error) {
      if (!alive()) return;
      status.textContent = error.message + ' Close and reopen the document to check the result before trying again.';
      status.setAttribute('role', 'alert');
      submit.removeAttribute('aria-busy'); submit.removeAttribute('aria-label'); submit.textContent = 'Add to document';
      // Do not offer an automatic retry: a lost response can follow a successful import.
      modal.querySelector('[data-cancel]').disabled = false;
      modal.querySelector('[data-cancel]').textContent = 'Close';
      pending = false;
    } finally { if (isCurrent()) setBusy(false); }
  };
}
