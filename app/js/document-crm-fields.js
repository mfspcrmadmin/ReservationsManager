import { escapeHtml as e } from './utils.js';

export function applyDocumentCRM(groups, response) {
  if (!response.crm_live || response.document?.type !== 'FID' || !(response.document?.status === 'Draft' || (response.document?.status === 'Published' && response.document?.render_mode === 'Versioned'))) return groups;
  const records = response.crm_records || {};
  return groups.map(group => {
    if (group.key === 'template:journey') {
      const linked = (response.sources || []).map(source => records['booking:' + source.booking_id]);
      if (!linked.length || linked.some(record => !record)) throw new Error('Current booking data is incomplete. Reload the document before editing.');
      return {...group, snapshotBody:group.body, body:response.journey_body || '', crmRecords:linked};
    }
    const record = records[group.key];
    if (group.origin === 'CRM' && !record) throw new Error('Current activity data is incomplete. Reload the document before editing.');
    if (!record) return group;
    return {...group,...(String(record.step_type||'').trim().toLowerCase()==='extra'?{visible:false}:{}),hidden_fields:[...new Set([...(group.hidden_fields||[]),...(record.fields||[]).filter(field=>field.included===false).map(field=>(record.key||group.key)+'|'+field.api_name)])],snapshotBody:group.body,title:record.title,body:record.body,start:record.start,step_id:record.step_id ?? group.step_id,crmActive:record.active!==false && record.document_visible!==false,showStart:record.show_start !== false,crmRecords:[record]};
  });
}

export function fieldEye(included) {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>' + (included ? '' : '<path d="m3 3 18 18"/>') + '</svg>';
}

function fieldGroup(field) {
  if(field.contact_setting)return 'FID contact';
  if(field.contact_setting)return 'FID contact';
  if(['date','datetime'].includes(field.type))return 'Dates & times';
  if(/meeting|pickup|pick_up|drop|flight|transport|driver|location/i.test(field.api_name))return 'Meeting & transport';
  if(/guest|pax|reference|travell|booking/i.test(field.api_name))return 'Journey details';
  return 'Content';
}
function renderTransferDirection(record) {
  if(record.module!=='Booking_Services'||!record.transfer_label)return '';
  const source=record.transfer_direction_source;
  const explanation=source==='field'?'Source: CRM field Transfer Direction.':source==='item_notes'?'Source: Item Notes begins with '+(record.transfer_direction==='Arrival'?':arr':':dep')+'. Transfer Direction is empty.':source==='none'?'Transfer Direction is empty and Item Notes has no arrival/departure marker.':'Source details unavailable. Reload CRM to check Transfer Direction and Item Notes.';
  return '<div class="studio-transfer-direction"><strong>Transfer direction</strong><span>'+e(record.transfer_label)+'</span><p>'+e(explanation)+'</p><p>Read-only here. Updated from Ezus during service synchronization.</p></div>';
}
export function renderCRMFields(records) {
  return '<div class="studio-crm-notice">Save to CRM updates the booking and every draft that uses it.</div>' + records.map((record,index) =>
    '<section class="studio-crm-record" data-crm-record="' + index + '"><header><strong>' + e(record.label || record.module) + '</strong><small>' + e(record.module) + ' · ' + e(record.id) + '</small></header>' +
    (String(record.step_type||'').trim().toLowerCase()==='extra' ? '<p class="studio-crm-notice">Extra steps and their services are excluded from the itinerary and Itinerary at a glance.</p>' : record.active === false ? '<p class="studio-crm-notice">This record is excluded from the FID: it is non-operational, inactive, optional or cancelled in CRM.</p>' : '') +
    renderTransferDirection(record) + '<div class="studio-crm-fields">' + record.fields.slice().sort((a,b)=>['Content','Journey details','Dates & times','Meeting & transport','FID contact'].indexOf(fieldGroup(a))-['Content','Journey details','Dates & times','Meeting & transport','FID contact'].indexOf(fieldGroup(b))).map((field,fieldIndex,fields) => {
      const reference = field.api_name === 'MFSP_Reference';
      const id = 'crm-' + index + '-' + field.api_name;
      const attributes = ' id="' + e(id) + '" data-crm-field="' + e(field.api_name) + '" maxlength="' + Number(field.max_length) + '"';
      return (fieldIndex===0 || fieldGroup(fields[fieldIndex-1])!==fieldGroup(field)?'<h3 class="studio-group-label studio-crm-group-label">'+fieldGroup(field)+'</h3>':'') + '<div class="studio-crm-field' + (['textarea','datetime'].includes(field.type) ? ' studio-crm-field--wide' : '') + '">' + (reference ? '<details class="studio-reference-detail"><summary title="Edit CRM reference">Reference: '+e(field.value || 'Not set')+'</summary>' : '') + '<div class="studio-crm-field-heading"><label for="' + e(id) + '">' + e(String(field.label||'').replace(/\s*\(?with timezone\)?/gi,'')) + '</label>' + (field.contact_setting ? '' : '<button type="button" class="studio-field-eye" data-field-eye="' + e(record.key + '|' + field.api_name) + '" aria-pressed="' + (field.included !== false) + '" aria-label="' + (field.included === false ? 'Show in document: ' : 'Hide in document: ') + e(String(field.label||'').replace(/\s*\(?with timezone\)?/gi,'')) + '" title="' + (field.included === false ? 'Show in document' : 'Hide in document') + '">' + fieldEye(field.included !== false) + '</button>') + '</div>' +
        (field.type === 'picklist' ? '<select'+attributes+'><option value="">Default</option>'+(field.options||[]).map(option=>'<option value="'+e(option)+'"'+(option===field.value?' selected':'')+'>'+e(option)+'</option>').join('')+'</select>' : field.type === 'textarea' ? '<textarea' + attributes + ' rows="4">' + e(field.value) + '</textarea>' : '<input' + attributes + ' type="' + (field.type === 'date' ? 'date' : 'text') + '"' + (field.type === 'integer' ? ' inputmode="numeric"' : '') + (field.type === 'datetime' ? ' placeholder="2026-07-14T09:00:00+02:00"' : '') + ' value="' + e(field.value) + '">') + (reference ? '</details>' : '') + '</div>';
    }).join('') + '</div><div class="studio-crm-toolbar"><button type="button" class="button primary compact" data-crm-save disabled>Save to CRM</button><span data-crm-status role="status"></span></div></section>'
  ).join('');
}

export function collectCRMChanges(section, record) {
  const changes = {};
  for (const field of record.fields) {
    const input = [...section.querySelectorAll('[data-crm-field]')].find(el => el.dataset.crmField === field.api_name);
    if(input.dataset.dateError) throw new Error(field.label+": "+input.dataset.dateError);
    const value = input.value;
    if(field.type==='picklist' && value && !(field.options||[]).includes(value))throw new Error('Choose a valid '+field.label+'.');
    if(field.type==='picklist' && value && !(field.options||[]).includes(value))throw new Error('Choose a valid '+field.label+'.');
    if (value === String(field.value ?? '')) continue;
    if (value.length > field.max_length) throw new Error(field.label + ' is too long.');
    if (value && field.type === 'integer' && !/^\d{1,9}$/.test(value)) throw new Error(field.label + ' must be a non-negative whole number.');
    if (value && field.type === 'datetime' && (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value)))) throw new Error(field.label + ' needs an ISO date and time with timezone.');
    changes[field.api_name] = value;
  }
  return changes;
}
