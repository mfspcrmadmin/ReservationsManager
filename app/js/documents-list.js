import { escapeHtml as e } from './utils.js';

// Same inline SVG convention and refresh glyph as the workspace task toolbar.
const svg = paths => '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + paths + '</svg>';
export const documentIcons = {
  preview: svg('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
  globe: svg('<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>'),
  documentSave: svg('<path d="M13 3H5v18h14V9Z M13 3v6h6 m-11 6 3 3 5-6"/>'),
  database: svg('<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>'),
  search: svg('<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>'),
  close: svg('<path d="m6 6 12 12M6 18 18 6"/>'),
  chevron: svg('<path d="m9 5 7 7-7 7"/>'),
  monitor: svg('<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M12 17v4M7 21h10"/>'),
  phone: svg('<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10 18h4"/>'),
  edit: svg('<path d="m16 3 5 5-12 12-6 1 1-6Z M13 6l5 5"/>'),
  add: svg('<path d="M12 5v14M5 12h14"/>'),
  refresh: svg('<path d="M21 12a9 9 0 0 0-15.5-6.2L3 8.5"/><path d="M3 3v5.5h5.5"/><path d="M3 12a9 9 0 0 0 15.5 6.2L21 15.5"/><path d="M21 21v-5.5h-5.5"/>'),
  open: svg('<path d="M14 3h7v7M21 3l-11 11M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>'),
  trash: svg('<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>')
};
export const DOCUMENTS_TIME_ZONE = 'Europe/Madrid';
export function documentTimestamp(value) {
  // Never interpret a timezone-less server string using the browser's local zone.
  if (typeof value !== 'string' || !/T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}
export function formatDocumentDate(value) {
  const timestamp = documentTimestamp(value);
  if (timestamp === null) return '—';
  const parts = new Intl.DateTimeFormat('en-GB', {timeZone:DOCUMENTS_TIME_ZONE,day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(timestamp);
  const part = type => parts.find(item => item.type === type)?.value || '';
  return part('day') + ' ' + part('month') + ' ' + part('year') + ' · ' + part('hour') + ':' + part('minute');
}
export function sortDocuments(documents) {
  const timestamp = doc => documentTimestamp(doc.updated_at) ?? documentTimestamp(doc.created_at) ?? -Infinity;
  return [...documents].sort((a,b) => {
    const left=timestamp(a), right=timestamp(b);
    return left === right ? String(a.id).localeCompare(String(b.id)) : right > left ? 1 : -1;
  });
}
export function documentShareLink(doc, now = Date.now()) {
  if (doc.status !== 'Published' || doc.shareable !== true || !doc.share_url) return '';
  if (doc.share_expires_at) {
    const expiry = documentTimestamp(doc.share_expires_at);
    if (expiry === null || expiry <= now) return '';
  }
  try {
    const url = new URL(doc.share_url);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch (_) { return ''; }
}
function button(icon, label, attribute, extra = '') {
  return '<button type="button" class="button tertiary compact icon-button documents-icon ' + extra + '" ' + attribute + ' title="' + e(label) + '" aria-label="' + e(label) + '">' + documentIcons[icon] + '</button>';
}
function dateCell(value, author, label) {
  const display = formatDocumentDate(value);
  const tooltip = [display === '—' ? label + ' date unavailable' : display + ' (' + DOCUMENTS_TIME_ZONE + ')', author ? label + ' by ' + author : ''].filter(Boolean).join(' · ');
  return '<td data-label="' + label + '" class="documents-date" title="' + e(tooltip) + '">' + (display === '—' ? '—' : '<time datetime="' + e(value) + '">' + e(display) + '</time>') + '</td>';
}
export function renderDocumentsLibrary(documents, {loading=false,error=''} = {}) {
  const sorted = sortDocuments(documents);
  // Version_Key is documentId + request UUID, not a human version number.
  const rows = sorted.map(doc => {
    const name = doc.title || 'Untitled document';
    const status = ['Draft','Published','Disabled'].includes(doc.status) ? doc.status.toLowerCase() : 'unknown';
    const technical = doc.version_key ? '\nPublished version identifier: ' + doc.version_key : '';
    return '<tr data-document-row="' + e(doc.id) + '"><td class="documents-row-actions"><div class="documents-action-group">' + button('edit','Edit document: ' + name,'data-document="' + e(doc.id) + '"','documents-edit') +
      (documentShareLink(doc) ? '<a class="button tertiary compact icon-button documents-icon" href="' + e(documentShareLink(doc)) + '" target="_blank" rel="noopener noreferrer" title="Open published document: ' + e(name) + '" aria-label="Open published document: ' + e(name) + '">' + documentIcons.open + '</a>' + button('copy','Copy link: ' + name,'data-doc-copy="' + e(doc.id) + '"') : '') +
      button('trash','Delete document: ' + name,'data-doc-delete="' + e(doc.id) + '"','documents-delete') + '</div></td>' +
      '<td class="documents-name"><div class="documents-name-content"><strong tabindex="0" title="' + e(name + technical) + '">' + e(name) + '</strong>' + (doc.type ? '<span class="badge subtle documents-type">' + e(doc.type) + '</span>' : '') + '</div></td>' +
      '<td data-label="Status"><span class="documents-status documents-status--' + status + '">' + e(doc.status || '—') + '</span></td>' +
      dateCell(doc.created_at,doc.created_by,'Created') + dateCell(doc.updated_at,doc.updated_by,'Updated') + '</tr>';
  }).join('');
  return '<section class="card documents-library" aria-busy="' + loading + '"><header class="card-header"><div class="documents-heading"><h2 class="panel-mini-title">Documents</h2>' + (loading ? '' : '<span class="badge subtle documents-count" aria-label="' + sorted.length + ' documents">' + sorted.length + '</span>') + '</div><div class="documents-library-actions">' +
    '<button type="button" class="button primary compact documents-create" data-doc-create aria-label="Create document">' + documentIcons.add + '<span>Create document</span></button>' + button('refresh','Refresh documents','data-doc-refresh') +
    '</div></header><p class="documents-feedback" role="status" aria-live="polite"></p>' +
    (error ? '<div class="documents-list-state" role="alert">' + e(error) + '<button class="button tertiary compact" type="button" data-doc-retry>Try again</button></div>' : loading ? '<div class="documents-list-state documents-list-loading" role="status"><span class="mail-send-spinner" aria-hidden="true"></span><span>Loading travel documents…</span></div>' : !sorted.length ? '<div class="documents-list-state documents-empty"><strong>No travel documents yet</strong><p>Create a document using this booking’s itinerary.</p></div>' : '') +
    (rows ? '<div class="documents-table-scroll" role="region" aria-label="Travel documents list" tabindex="0"><table class="documents-table"><caption class="studio-sr-only">Travel documents, most recently updated first</caption><thead><tr><th scope="col" class="documents-actions-heading">Actions</th><th scope="col">Document</th>' + '<th scope="col">Status</th><th scope="col">Created</th><th scope="col">Updated</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '') + '</section>';
}
