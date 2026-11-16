import { categoryLayout, renderCategoryFields } from './document-category-layout.js';
import { documentDateOptions, documentDateLabel, formatDocumentTemporal, formatDocumentTravelDates } from './document-output-dates.js';
import { renderSupplierContacts } from './document-service-rules.js';
import { formatDocumentText } from './document-text-format.js';
import { renderDocumentEditorial } from './document-editorial.js';
import { documentEmergencyContact } from './document-presentation.js';
import { escapeHtml } from "./utils.js";
import { fieldEye, renderCRMFields } from './document-crm-fields.js';

const e = escapeHtml;
const TYPES = {
  Cover: { label: "Cover", kind: "cover", icon: "▧", hint: "The opening page of your journey." },
  Journey_Info: { label: "Journey info", kind: "journey", icon: "▤", hint: "Dates, travellers and your booking reference." },
  Contacts: { label: "Contacts", kind: "contacts", icon: "☏", hint: "Your guests’ points of contact during the trip." },
  Overview: { label: "At a glance", kind: "overview", icon: "☷", hint: "A summary of the included activities, organised by day." },
  Itinerary: { label: "Itinerary", kind: "itinerary", icon: "☷", hint: "The day-by-day programme, built from your activities." },
  Activity: { label: "Activity", kind: "activity", icon: "◇", hint: "An experience in the day-by-day itinerary." },
  Shared_Content: { label: "Workshop", kind: "workshop", icon: "◎", hint: "The introduction to this document’s Workshop." },
  Session: { label: "Workshop session", kind: "session", icon: "◷", hint: "A session within the shared Workshop programme." },
  Image: { label: "Image", kind: "image", icon: "▧", hint: "An image and its accompanying text." },
  Closing: { label: "Closing", kind: "closing", icon: "✧", hint: "A final welcome from Made for Spain and Portugal." },
  Terms: { label: "Terms", kind: "text", icon: "≡", hint: "Conditions and practical details for your guests." }
};

export function sectionPresentation(group) {
  if (group.service_id) return { label: "Service details", kind: "service", icon: "↳", hint: "Details belonging to an itinerary activity." };
  if (group.type === "Text" && group.origin === "Shared_Content") return { label: "Workshop details", kind: "workshop-details", icon: "◎", hint: "Supporting information for the Workshop." };
  if(group.key === "template:practical") return {label:"Practical info",kind:"practical",icon:"\u2261",hint:"Useful information for the journey."};
  return TYPES[group.type] || { label: group.key === "template:practical" ? "Practical info" : "Text section", kind: "text", icon: "≡", hint: "Useful information for the journey." };
}

export function renderStudioOutline(item, index, selected, nested=false, parentExcluded=false) {
  const section = sectionPresentation(item);
  const paths=item.service_id?'<circle cx="12" cy="12" r="3"/>' :item.type==='Itinerary'?'<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>':item.origin==='CRM'?'<path d="m12 3 9 9-9 9-9-9Z"/><circle cx="12" cy="12" r="2"/>':'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>';
  const icon = '<svg viewBox="0 0 24 24" aria-hidden="true">'+paths+'</svg>';
  const date = nested ? (!item.service_id && item.showStart!==false ? /T(\d{2}:\d{2})/.exec(item.start||'')?.[1] || '' : '') : item.origin === 'CRM' || item.type === 'Session' ? String(item.start || '').slice(0,10) : '';
  const excluded=parentExcluded || item.crmActive===false;
  return '<button type="button" data-section="' + index + '" data-section-key="' + e(item.key) + '" class="studio-section'+(item.service_id?' studio-section--service':'') + (index === selected ? ' is-selected' : '') + (!item.visible || excluded ? ' is-hidden' : '') + '" aria-current="' + (index === selected ? 'true' : 'false') + '" title="' + e(item.title || section.label) + '"><span class="studio-section-icon">' + (!item.visible || excluded ? fieldEye(false) : icon) + '</span><span class="studio-section-copy"><span class="studio-section-title">' + e(item.title || section.label) + '</span><small>' + e(item.service_id ? '' : section.label) + (date ? ' &middot; ' + e(date) : '') + (!item.visible ? ' &middot; Hidden' : excluded ? ' &middot; Excluded' : '') + '</small></span></button>';
}

export function renderStudioOutlineTree(groups, selected) {
  const indexed=groups.map((item,index)=>({item,index}));
  const crm=indexed.filter(({item})=>item.origin==='CRM');
  const parents=new Map(crm.filter(({item})=>!item.service_id && item.step_id).map(entry=>[entry.item.step_id,entry]));
  const children=new Map();
  for(const entry of crm)if(entry.item.service_id && parents.has(entry.item.step_id)){
    const index=parents.get(entry.item.step_id).index;
    if(!children.has(index))children.set(index,[]);
    children.get(index).push(entry);
  }
  const top=crm.filter(({item})=>!item.service_id || !parents.has(item.step_id));
  const order=({item})=>(item.start||'9999')+'|'+(item.step_id||'')+'|'+(item.service_id?'1':'0')+'|'+item.key;
  top.sort((a,b)=>order(a).localeCompare(order(b)));
  const days=new Map();
  for(const entry of top){const day=/^\d{4}-\d{2}-\d{2}/.exec(entry.item.start||'')?.[0] || '';if(!days.has(day))days.set(day,[]);days.get(day).push(entry);}
  let dayNumber=0;
  const program=[...days.entries()].map(([day,entries])=>{
    const label=day && Number.isFinite(Date.parse(day))?new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(day+'T12:00:00Z')):'Dates to be confirmed';
    const heading=day?'Day '+(++dayNumber):'Unscheduled';
    return '<section class="studio-outline-day" data-outline-day="'+e(day)+'"><h3><button type="button" class="studio-day-jump" data-jump-day="'+e(day)+'" data-jump-key="'+e(entries[0].item.key)+'"><span>'+heading+'</span><time'+(day?' datetime="'+e(day)+'"':'')+'>'+e(label)+'</time></button></h3><ul class="studio-outline-steps">'+entries.map(({item,index})=>{
      const services=(children.get(index)||[]).sort((a,b)=>a.item.key.localeCompare(b.item.key));
      return '<li data-outline-step>'+renderStudioOutline(item,index,selected,true)+(services.length?'<ul class="studio-outline-services" aria-label="Services for '+e(item.title||'activity')+'">'+services.map(entry=>'<li>'+renderStudioOutline(entry.item,entry.index,selected,true,!item.visible||item.crmActive===false)+'</li>').join('')+'</ul>':'')+'</li>';
    }).join('')+'</ul></section>';
  }).join('');
  const itinerary=indexed.find(({item})=>item.type==='Itinerary' && item.origin!=='CRM');
  let inserted=false;
  return indexed.map(({item,index})=>{
    if(itinerary && index===itinerary.index)return '<section class="studio-outline-program" data-outline-program>'+renderStudioOutline(item,index,selected)+'<div class="studio-outline-days">'+program+'</div></section>';
    if(item.origin!=='CRM')return renderStudioOutline(item,index,selected);
    if(itinerary || inserted)return '';inserted=true;return program;
  }).join('');
}

export function journeyLines(body) {
  const lines = String(body || "").split("\n");
  const fields = [];
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].trim()) continue;
    const match = /^(Travel dates|Number of guests|Reference number):([ \t]*)(.*)$/.exec(lines[index].replace(/\r$/, ""));
    if (!match) return [];
    fields.push({ index, label: match[1], value: match[3] });
  }
  return fields;
}

export function replaceJourneyLine(body, index, value) {
  const lines = String(body).split("\n");
  if (!Number.isInteger(index) || !journeyLines(body).some(field => field.index === index) || /[\r\n]/.test(value)) throw new Error("Invalid journey detail.");
  const match = /^([^:]+:[ \t]*)(.*?)(\r?)$/.exec(lines[index]);
  lines[index] = match[1] + value + match[3];
  return lines.join("\n");
}

function schedule(group, doc) {
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(group.start || "");
  if (!match) return '<div class="studio-schedule"><span>Schedule</span><strong>To be confirmed</strong></div>';
  return '<div class="studio-schedule"><span>' + e(formatDocumentTemporal(match[1],'date',documentDateOptions(doc.settings))) + '</span>' + (match[2] ? '<strong><small>START</small>' + e(formatDocumentTemporal(group.start,'time',documentDateOptions(doc.settings,(group.crmRecords?.[0]?.key||group.key)+'|'+(group.service_id?'Service_Date_Time':'Start_Date_Time')))) + '</strong>' : '') + '</div>';
}

function itineraryPreview(groups,doc) {
  const hiddenSteps = new Set(groups.filter(g => g.origin === "CRM" && !g.service_id && (!g.visible || g.crmActive === false)).map(g => g.step_id).filter(Boolean));
  const activities = groups.filter(g => g.origin === "CRM" && g.visible && g.crmActive !== false && (!g.service_id || !g.step_id) && !hiddenSteps.has(g.step_id)).sort((a,b) => String(a.start || '9999').localeCompare(String(b.start || '9999')));
  const days = new Map();
  for (const activity of activities) {
    const day = /^\d{4}-\d{2}-\d{2}/.exec(activity.start || "")?.[0] || "Dates to be confirmed";
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(activity);
  }
  if (!days.size) return '<p class="studio-generated-empty">No included activities yet. Include an activity to show it here.</p>';
  return '<div class="studio-itinerary-summary">' + [...days.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([day, entries]) => '<section class="studio-itinerary-day"><h3>' + e(formatDocumentTemporal(day,'date',documentDateOptions(doc.settings))) + '</h3><div>' + entries.map(entry => '<button type="button" data-jump-key="' + e(entry.key) + '"><time>' + e(formatDocumentTemporal(entry.start,'time',documentDateOptions(doc.settings)) || '\u2014') + '</time><span>' + e(entry.title || "Activity") + '</span><span aria-hidden="true">↗</span></button>').join('') + '</div></section>').join('') + '</div>';
}

function fidOverview(groups,doc={}) {
  const parents=new Map(groups.filter(g=>g.origin==='CRM' && !g.service_id && g.step_id).map(g=>[g.step_id,g]));
  const included=groups.filter(g=>g.origin==='CRM' && g.visible && g.crmActive!==false && (!parents.has(g.step_id) || (parents.get(g.step_id).visible && parents.get(g.step_id).crmActive!==false)));
  const dayOf=g=>/^\d{4}-\d{2}-\d{2}/.exec((g.service_id?parents.get(g.step_id)?.start:undefined)||g.start||'')?.[0] || 'Dates to be confirmed';
  const dayKeys=[...new Set(included.map(dayOf))].sort();
  const activities=included.filter(g=>!g.service_id || !g.step_id).sort((a,b)=>String(a.start||'9999').localeCompare(String(b.start||'9999')));
  const hotels=activities.filter(g=>g.crmRecords?.[0]?.step_type==='accommodation' && g.title).map(g=>({group:g,start:dayOf(g),end:(g.crmRecords[0].end||'').slice(0,10)}));
  const rows=dayKeys.map((day,index)=>{
    const entries=activities.filter(g=>dayOf(g)===day && g.crmRecords?.[0]?.step_type!=='accommodation' && g.title);
    const stay=hotels.find(h=>h.end?h.start<=day && day<h.end:h.start===day);
    if(!entries.length && !stay)return '';
    const cities=[...new Set(included.filter(g=>dayOf(g)===day).map(g=>g.crmRecords?.[0]?.city).filter(Boolean))];
    const date=/^\d{4}-\d{2}-\d{2}$/.test(day)?formatDocumentTemporal(day,'date',documentDateOptions(doc.settings)):day;
    const target=entries[0] || stay.group;
    return '<a class="overview-text-item overview-link" href="#" data-jump-key="'+e(target.key)+'"><div class="overview-text-head"><span class="overview-text-day">Day '+(index+1)+'</span><span class="overview-text-sep" aria-hidden="true">&bull;</span><span class="overview-text-date">'+e(date)+'</span>'+(cities.length?'<span class="overview-text-sep" aria-hidden="true">&bull;</span><span class="overview-text-city">'+e(cities.join(' / '))+'</span>':'')+'</div><div class="overview-text-acts">'+entries.map(g=>'<div class="overview-act-line">'+e(g.title)+'</div>').join('')+(stay?'<div class="overview-stay-slot"><div class="overview-stay-line overview-stay-line--stay"><span class="overview-stay-label">STAY AT</span><span class="overview-stay-hotel">'+e(stay.group.title)+'</span></div></div>':'')+'</div></a>';
  }).join('');
  return rows?'<div class="fid-overview overview-text-list">'+rows+'</div>':'<p class="studio-generated-empty">No included activities yet. Include an activity to show it here.</p>';
}

export function renderStudioEditor(group, doc, groups) {
  const presentation = sectionPresentation(group);
  const live = group.crmRecords?.length > 0;
  const fields = group.type === "Journey_Info" && !live ? journeyLines(group.body) : [];
  const generated = ["Overview", "Itinerary"].includes(group.type);
  const contacts = doc.type === "FID" && group.type === "Contacts";
  const title = '<label class="studio-sr-only" for="studio-block-title">Section title</label><input id="studio-block-title" class="studio-edit-title" maxlength="255" value="' + e(group.title || '') + '" placeholder="Section title">';
  const body = '<label class="studio-field studio-body-label" for="studio-block-body">Section text</label><textarea id="studio-block-body" class="studio-edit-body"' + (fields.length || live || contacts || (doc.type==='FID' && group.type==='Overview') ? ' hidden' : '') + ' maxlength="' + Math.max(group.parts.length * 6000,live ? group.body.length : 0) + '" placeholder="' + (generated ? 'Section introduction' : 'Add the details for your guests…') + '">' + e(group.body) + '</textarea>';
  let extra = '';
  if (fields.length) extra = '<div class="studio-journey-fields">' + fields.map(field => '<label><span>' + e(documentDateLabel(field.label)) + '</span><input data-journey-line="' + field.index + '" value="' + e(field.value) + '" aria-label="' + e(documentDateLabel(field.label)) + '"></label>').join('') + '</div>';
  if (generated) extra = '<p class="studio-generated-note">Generated from the included activities.</p>';
  if (contacts) extra = '<p class="studio-generated-note">Uses the Ezus contact layout and the primary booking?s 24h Rep. View the representative in Document settings.</p>';
  if (live) extra = renderCRMFields(group.crmRecords);
  if (live && group.snapshotBody && group.snapshotBody !== group.body) extra += '<details class="studio-crm-snapshot"><summary>Previous saved document text</summary><p>This text is kept for reference. This draft now displays current CRM values.</p><pre>' + e(group.snapshotBody) + '</pre></details>';
  const timed = ["activity", "session", "service"].includes(presentation.kind);
  const cover = presentation.kind === "cover";
  const provisional = doc.type === "Proposal" || doc.type === "Quote";
  const label = '<span class="studio-paper-label">' + e(presentation.label) + '</span>';
  return '<div class="studio-section-editor"><label class="studio-field">Section title</label>' + title + body + extra + '</div>';
}

function displayFieldValue(field,doc,group) {
  const options=documentDateOptions(doc.settings,(field.recordKey||group?.crmRecords?.[0]?.key||group?.key)+'|'+field.api_name);
  return field.label==='Travel dates'?displayTravelDates(field.value,doc,group):formatDocumentTemporal(field.value,field.type||'auto',options);
}

function displayTravelDates(value,doc,group) {
  return String(value||'').split(' - ').map((part,index)=>{
    let name=index===0?'Arrival_Date':'Departure_Date';
    const find=name=>group?.crmRecords?.find(record=>record.fields.some(field=>field.api_name===name && field.included!==false && field.value===part));
    let record=find(name);if(!record && index===0){name='Departure_Date';record=find(name);}
    return formatDocumentTemporal(part,'date',documentDateOptions(doc.settings,record?.key+'|'+name));
  }).join(' - ');
}
function displayFields(group) {
  return (group.crmRecords || []).flatMap(record => record.fields.map(field=>({...field,recordKey:record.key}))).filter(field => field.included !== false && String(field.value ?? '').trim());
}

// The viewer renders every journey line, including branding and editorial text.
// Keep the stricter journeyLines parser only for the legacy inline editor.
function journeyPreviewLines(body) {
  return String(body || '').split('\n').map(line => {
    const separator = line.indexOf(':');
    return separator < 0 ? {text:line.replace(/\r$/, '')} : {label:line.slice(0,separator),value:line.slice(separator+1).trim()};
  });
}

// Use the CRM activity type, never product names, to choose the hotel layout.
function isHotelRoom(group, groups) {
  return !!group.service_id && groups.some(parent => parent.origin === 'CRM' && !parent.service_id && parent.step_id === group.step_id && parent.crmRecords?.[0]?.step_type === 'accommodation');
}

function renderHotelRoom(group, doc) {
  const fields = displayFields(group);
  const cells = fields.filter(field => !['Product_Description','Hotel_Check_In','Hotel_Check_Out','Service_Date_Time'].includes(field.api_name)).map(field => '<div class="fid-room-field"><dt class="fid-room-label">'+e(documentDateLabel(field.label))+'</dt><dd class="fid-room-value">'+formatDocumentText(displayFieldValue(field,doc,group))+'</dd></div>').join('');

  const title = fields.find(field => field.api_name === 'Product_Description')?.value || '';
  const meta = cells;
  return (title||meta?'<div class="fid-room-card">'+(title?'<div class="fid-room-summary"><div class="fid-room-title">'+formatDocumentText(title)+'</div></div>':'')+'<div class="fid-room-body">'+(meta?'<dl class="fid-room-meta">'+meta+'</dl>':'')+'</div></div>':'');
}

function renderHotelStay(group, groups, doc) {
  const stays=[];let hasRoomDates=false;
  const add=(source,inApi,outApi)=>{
    const fields=source.crmRecords?.[0]?.fields||[];
    const date=api=>fields.find(f=>f.api_name===api && f.included!==false);
    const checkin=date(inApi),checkout=date(outApi);
    if(checkin?.value || checkout?.value)stays.push({source,checkin,checkout});
  };
  for(const room of groups.filter(g=>g.service_id && g.step_id===group.step_id && g.visible && g.crmActive!==false)) {
    if((room.crmRecords?.[0]?.fields||[]).some(f=>['Hotel_Check_In','Hotel_Check_Out'].includes(f.api_name) && f.value)) {hasRoomDates=true;add(room,'Hotel_Check_In','Hotel_Check_Out');}
  }
  if(!hasRoomDates)add(group,'Start_Date_Time','End_Date_Time');
  const seen=new Set();
  const html=stays.map(({source,checkin,checkout})=>{
    const key=(checkin?.value||'')+'|'+(checkout?.value||'');if(seen.has(key))return '';seen.add(key);
    const card=(label,text)=>'<div class="fid-stay-card"><dt class="fid-stay-label">'+label+'</dt><dd class="fid-stay-value">'+e(text)+'</dd></div>';
    const date=field=>formatDocumentTemporal(field.value,'date',documentDateOptions(doc.settings,(source.crmRecords?.[0]?.key||source.key)+'|'+field.api_name));
    let cells=(checkin?.value?card('Check-in',date(checkin)):'')+(checkout?.value?card('Check-out',date(checkout)):'');
    const nights=(Date.parse(String(checkout?.value||'').slice(0,10)+'T00:00:00Z')-Date.parse(String(checkin?.value||'').slice(0,10)+'T00:00:00Z'))/86400000;
    if(Number.isInteger(nights) && nights>0)cells+=card('Nights',String(nights));
    return '<dl class="fid-hotel-stay">'+cells+'</dl>';
  }).join('');
  return html?'<div class="fid-hotel-stays">'+html+'</div>':'';
}

function previewContent(group, groups, doc) {
  if (group.type === 'Journey_Info' && doc.type !== 'FID') return '<dl class="studio-journey-details">' + journeyLines(group.body).map(field => '<div><dt>' + e(documentDateLabel(field.label)) + '</dt><dd>' + formatDocumentText(displayFieldValue(field,doc,group)) + '</dd></div>').join('') + '</dl>';
  if (group.type === 'Journey_Info') return '<div class="studio-journey-details">' + journeyPreviewLines(group.body).map(field => field.label !== undefined ? '<p><span class="studio-journey-label">'+e(documentDateLabel(field.label))+'</span><span>'+formatDocumentText(displayFieldValue(field,doc,group))+'</span></p>' : '<p>'+e(field.text)+'</p>').join('') + '</div>';
  if (group.crmRecords?.length) {
    const fields=displayFields(group);
    const description=fields.find(field=>['Long_Description','Product_Description'].includes(field.api_name))?.value || '';
    const details=(!group.service_id && group.crmRecords[0]?.supplier ? '<div><dt>Supplier</dt><dd>' + e(group.crmRecords[0].supplier) + '</dd></div>' : '') + fields.filter(field => !['Short_Description','Long_Description','Product_Description','Start_Date_Time','Service_Date_Time',...(doc.type==='FID' && group.crmRecords[0]?.step_type==='accommodation'?['End_Date_Time']:[])].includes(field.api_name)).map(field => '<div><dt>' + e(documentDateLabel(field.label)) + '</dt><dd>' + formatDocumentText(displayFieldValue(field,doc,group)) + '</dd></div>').join('');
    return '<div class="studio-preview-copy">'+formatDocumentText(description)+'</div>'+(details?'<dl class="studio-detail-grid">'+details+'</dl>':'');
  }
  return '<div class="studio-preview-copy'+(['Overview','Itinerary'].includes(group.type)?' studio-section-intro':'')+'">' + formatDocumentText(group.body || '') + '</div>';
}

function renderProgram(groups, doc) {
  const parents=new Map(groups.filter(item=>item.origin==='CRM' && !item.service_id).map(item=>[item.step_id,item]));
  const dayGroups=new Map();
  const items=groups.filter(item=>item.origin==='CRM' && item.visible && item.crmActive!==false && (!item.step_id || !parents.has(item.step_id) || (parents.get(item.step_id).visible && parents.get(item.step_id).crmActive!==false)));
  const start=item=>item.service_id && parents.has(item.step_id)?parents.get(item.step_id).start:item.start;
  const order=item=>(start(item)||'9999')+'|'+(item.step_id||'')+'|'+(item.service_id?'1':'0')+'|'+item.key;
  items.sort((a,b)=>order(a).localeCompare(order(b)));
  for(const item of items){const day=/^\d{4}-\d{2}-\d{2}/.exec(start(item)||'')?.[0] || 'Dates to be confirmed';if(!dayGroups.has(day))dayGroups.set(day,[]);dayGroups.get(day).push(item);}
  return [...dayGroups.entries()].map(([day,items],index)=>{
    let heading=e(formatDocumentTemporal(day,'date',documentDateOptions(doc.settings)));
    if(doc.type==='FID') {
      const date=/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) ? new Intl.DateTimeFormat('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(day+'T12:00:00Z')) : day;
      const cities=[...new Set(items.map(item=>item.crmRecords?.[0]?.city).filter(Boolean))];
      heading='<span class="fid-day-number">Day '+(index+1)+'</span><span class="fid-day-label"><span class="fid-day-date">'+e(date)+'</span>'+(cities.length?'<span class="fid-day-destinations">'+e(cities.join(' / '))+'</span>':'')+'</span>';
    }
    return '<details class="studio-program-day" data-preview-day="'+e(day==='Dates to be confirmed'?'':day)+'" open><summary>'+heading+'</summary><div class="studio-program-day-content">'+items.filter(item=>!item.service_id || !parents.has(item.step_id)).map(item=>renderStudioPaper(item,doc,groups)).join('')+'</div></details>';
  }).join('');
}

export function renderStudioPaper(group, doc, groups, nested=false) {
  const excluded=g=>g?.crmRecords?.[0]?.step_type==='extra' || ['agent commission','agent comission'].includes(String(g?.crmRecords?.[0]?.step_category||'').toLowerCase());
  const ancestor=group.service_id?groups.find(g=>!g.service_id&&g.step_id===group.step_id):null;
  if(excluded(group)||excluded(ancestor)||ancestor&&(ancestor.visible===false||ancestor.crmActive===false))return '';
  const kind = sectionPresentation(group).kind;
  const titleField = group.crmRecords?.[0]?.fields.find(field => ['Short_Description','Product_Description'].includes(field.api_name));
  const showTitle = titleField?.included !== false;
  const dates = journeyPreviewLines(groups.find(item => item.key === 'template:journey')?.body).find(field => field.label === 'Travel dates')?.value;
  const cover = group.type === 'Cover';
  const fid = doc.type === 'FID';
  let content = previewContent(group, groups, doc);
  if(fid && group.key === "template:practical") content=renderDocumentEditorial("practical",group.body);
  if(fid && group.type === "Closing") content=renderDocumentEditorial("closing",group.body);
  if(fid && group.type==='Contacts')content=(doc.presentation?.emergency_contact || documentEmergencyContact()).html;
  if(cover && fid && doc.presentation?.cover_note)content += '<p class="studio-cover-note">'+e(doc.presentation.cover_note)+'</p>';
  if (group.type === 'Overview') content = fid ? fidOverview(groups,doc) : content+itineraryPreview(groups,doc);
  if (group.type === 'Itinerary') {
    const hiddenParents = new Set(groups.filter(item => item.origin === 'CRM' && !item.service_id && (!item.visible || item.crmActive === false)).map(item => item.step_id));
    const items = groups.filter(item => item.origin === 'CRM' && item.visible && item.crmActive !== false && (!item.step_id || !hiddenParents.has(item.step_id))).sort((a,b) => String(a.start || '9999').localeCompare(String(b.start || '9999')));
    content += fid ? renderProgram(groups,doc) : items.map(item => renderStudioPaper(item, doc, groups)).join('');
  }
  if(fid && group.origin==='CRM') {
    const record=group.crmRecords?.[0];
    const parent=group.service_id?groups.find(g=>g.origin==='CRM'&&!g.service_id&&g.step_id===group.step_id):group;
    const parentRecord=parent?.crmRecords?.[0]||record||{};
    const layout=categoryLayout(parentRecord.step_category,parentRecord.step_type);
    const accommodation=layout.family==='accommodation'&&!group.service_id;
    const room=!!group.service_id&&layout.family==='accommodation';
    const children=!group.service_id?groups.filter(g=>g.service_id&&g.step_id===group.step_id&&g.visible&&g.crmActive!==false):[];
    const fields=displayFields(group);
    const description=fields.find(f=>['Long_Description','Product_Description'].includes(f.api_name))?.value||'';
    const excludedFields=['Short_Description','Long_Description','Product_Description','Start_Date_Time','Service_Date_Time',...(!group.service_id?['Arrival_Departure',...(layout.family==='restaurant'?['Table_Reservation_Time']:[])]:[]),...(accommodation?['End_Date_Time']:[])];
    const image=/^https:\/\//i.test(group.image||'')?'<figure class="fid-entry-media"><img src="'+e(group.image)+'" alt="" loading="lazy"></figure>':'';
    const descriptionHtml=description&&(!group.service_id||description!==group.title)?'<div class="fid-entry-description">'+formatDocumentText(description)+'</div>':'';
    const intro=descriptionHtml||image?'<div class="fid-entry-intro'+(image?' fid-entry-intro--illustrated'+(description.length<200?' fid-entry-intro--compact':''):'')+'">'+descriptionHtml+image+'</div>':'';
    if(record)content=intro+renderCategoryFields(fields,layout,f=>displayFieldValue(f,doc,group),excludedFields,'before');
    if(room)content=(image?'<div class="fid-entry-intro">'+image+'</div>':'')+renderHotelRoom(group,doc);
    if(children.length)content+='<div class="fid-entry-services">'+children.map(child=>renderStudioPaper(child,doc,groups,true)).join('')+'</div>';
    if(record&&!room)content+=renderCategoryFields(fields,layout,f=>displayFieldValue(f,doc,group),excludedFields,'after');
    if(!nested)content+=renderSupplierContacts({contact_cards:[...(record?.contact_cards||[]),...children.flatMap(child=>(child.crmRecords?.[0]?.contact_cards||[]).map(c=>({...c,item_label:c.item_label||child.title})))]});
    const body=content?'<div class="fid-entry-body"><div class="fid-entry-content">'+content+'</div></div>':'';
    const family=' data-layout="'+layout.family+'"';
    const key=' data-preview-key="'+e(group.key)+'"';
    if(group.service_id){
      const label=room?'Room details':record?.transfer_label||'Service details';
      return '<section class="studio-paper studio-paper--service fid-entry fid-entry--service'+(room?' fid-hotel-rooms':'')+'"'+family+key+'><header class="fid-entry-heading"><span>'+e(label)+(room?'':': '+(showTitle?e(group.title||''):''))+'</span></header>'+body+'</section>';
    }
    const reservation=fields.find(f=>f.api_name==='Table_Reservation_Time');
    const stay=accommodation?renderHotelStay(group,groups,doc):layout.family==='restaurant'&&reservation?'<span class="fid-entry-time"><small>Table reservation</small>'+formatDocumentText(displayFieldValue(reservation,doc,group))+'</span>':'';
    const time=['experience','general'].includes(layout.family)&&group.showStart!==false&&group.start?formatDocumentTemporal(group.start,'time',documentDateOptions(doc.settings,(record?.key||group.key)+'|Start_Date_Time')):'';
    return '<article class="studio-paper studio-paper--activity fid-entry fid-entry--step"'+family+key+'><header class="fid-entry-heading"><div><span class="fid-entry-kind">'+e(layout.label)+(fields.find(f=>f.api_name==='Arrival_Departure')?' · '+e(fields.find(f=>f.api_name==='Arrival_Departure').value):'')+(accommodation&&['Hotel NBTM','Hotel not booked MfS&P'].includes(parentRecord.step_category)?' · Not booked by MfS&P':'')+'</span>'+(showTitle?'<h4>'+e(group.title||'')+'</h4>':'')+'</div>'+stay+(time?'<span class="fid-entry-time"><small>START</small>'+e(time)+'</span>':'')+'</header>'+body+'</article>';
  }
  const scheduleHtml = ['activity','service','session'].includes(kind) && group.start && group.showStart !== false ? schedule(group,doc) : '';
  return '<article class="studio-paper studio-paper--' + kind + (fid ? '' : ' studio-paper--basic') + '" data-preview-key="' + e(group.key) + '">' +
    (cover && fid ? '<iframe class="studio-cover-video" src="https://player.vimeo.com/video/1055156991?autoplay=1&amp;loop=1&amp;muted=1&amp;autopause=0" title="Welcome to Iberia" allow="autoplay" tabindex="-1"></iframe>' : '') +
    '<div class="studio-paper-content">' + scheduleHtml + (showTitle ? '<h2 class="studio-preview-title">' + e(group.title || '') + (cover && fid ? ' Iberian Story' : '') + '</h2>' : '') +
    '<div class="studio-preview-fields">' + content + '</div>' + (cover && dates ? '<div class="studio-cover-dates"><strong>Travel dates</strong><span>' + e(displayTravelDates(dates,doc,groups.find(item=>item.key==='template:journey'))) + '</span></div>' : '') +
    (/^https:\/\//i.test(group.image || '') ? '<img class="studio-preview-image" src="' + e(group.image) + '" alt="" loading="lazy">' : '') + '</div></article>';
}

export function renderStudioPreview(groups, doc) {
  const sharedHeader = groups.find(group => group.type === 'Shared_Content' && group.origin === 'Shared_Content');
  const visible = groups.filter(group => group.visible && group.origin !== 'CRM' && !(group.origin === 'Shared_Content' && sharedHeader && !sharedHeader.visible));
  let navigation = visible.filter(group => ['Journey_Info','Overview','Itinerary','Contacts'].includes(group.type) || (doc.type==='FID' && group.key==='template:practical'));
  // Fixed Ezus navigation; editable section titles must never become menu labels.
  const fidNavigation=[
    ['Journey_Info','template:journey','mfsp-journey','Welcome to Iberia'],
    ['Overview','template:overview','mfsp-overview','Itinerary at Glance'],
    ['Itinerary','template:program','mfsp-program','Detailed Itinerary'],
    ['Text','template:practical','mfsp-practical','Things to keep in mind'],
    ['Contacts','template:contacts','mfsp-contacts','Support']
  ];
  if(doc.type==='FID')navigation=fidNavigation.map(([type,key,anchor,label])=>{
    const section=visible.find(g=>g.key===key)||visible.find(g=>type!=='Text' && g.type===type);
    return {type,key:section?.key||key,anchor,label,available:!!section};
  });
  const navButton=group=>{
    if(doc.type!=='FID')return '<button type="button" data-jump-key="'+e(group.key)+'">'+e(group.title || sectionPresentation(group).label)+'</button>';
    const support=group.type==='Contacts';
    return '<a class="'+(support?'fid-nav-support':'fid-nav-link')+'" '+(group.available?'href="#'+group.anchor+'"':'aria-disabled="true" tabindex="0" title="This section is not included in this document"')+' data-jump-key="'+e(group.key)+'"'+(support?' aria-label="Support"':'')+'>'+(support?'<span aria-hidden="true">&#9742;&#xfe0e;</span><span class="fid-support-label">Support</span>':e(group.label))+'</a>';
  };
  const links=navigation.filter(group=>doc.type!=='FID' || group.type!=='Contacts').map(navButton).join('');
  const support=doc.type==='FID'?navigation.filter(group=>group.type==='Contacts').map(navButton).join(''):'';
  const mobile=doc.type==='FID'?'<details class="fid-mobile-menu"><summary aria-label="Navigation menu"><span></span><span></span><span></span></summary><nav aria-label="Mobile document navigation" class="fid-mobile-links">'+links+'</nav></details>':'';
  return '<div class="studio-document-preview" data-document-type="'+e(doc.type)+'"><header class="studio-preview-header"><img src="https://files-accl.zohopublic.eu/public/workdrive-public/download/4otv9b0d04881ab8945a694b220012e232602?x-cli-msg=null" width="1417" height="709" alt="Made for Spain and Portugal">'+'<nav class="mfsp-preview-links fid-desktop-links" aria-label="Document preview">'+links+'</nav>'+support+mobile+'</header>'+(doc.type==='FID' && doc.presentation?.partner_logo?'<div class="studio-partner-brand"><img src="'+e(doc.presentation.partner_logo)+'" alt="Partner logo"></div>':'')  + visible.map(group => renderStudioPaper(group,doc,groups)).join('') + '<footer class="studio-paper-footer">Made for Spain and Portugal</footer></div>';
}
