import { categoryLayouts } from './document-category-config.js';
import { escapeHtml as e } from './utils.js';
import { formatDocumentText } from './document-text-format.js';
import { documentDateLabel } from './document-output-dates.js';

export function categoryLayout(category='',type='') {
  const key=String(category).trim().toLowerCase();
  const family=String(type).toLowerCase()==='accommodation'?'accommodation':Object.keys(categoryLayouts).find(name=>categoryLayouts[name].categories.some(c=>c.toLowerCase()===key))||'general';
  return {family,...categoryLayouts[family]};
}

// Only visible, nonempty values reach the document. Unknown fields remain in Details.
export function renderCategoryFields(fields,layout,format,excluded=[],phase='all') {
  const late=new Set(['Special_Notes','Important_Notes','Cancellation_Policy']);
  const remaining=new Map(fields.filter(f=>f.included!==false && String(f.value??'').trim() && !excluded.includes(f.api_name) && (phase==='all'||(phase==='after')===late.has(f.api_name))).map(f=>[f.api_name,f]));
  const nature=field=>/Reference|Locator|Booking_Name|Supplier_Conf/.test(field.api_name)?'reference':/Time|Duration/.test(field.api_name)?'time':/Included|Amenities|Menu/.test(field.api_name)?'included':/Description|Notes|Policy|Meeting_Details/.test(field.api_name)?'narrative':'metadata';
  const cell=(field,label)=>'<div class="fid-field'+(String(field.value).length>90||String(field.value).includes('\n')?' fid-field--wide':'')+'" data-nature="'+nature(field)+'"><dt>'+e(label||documentDateLabel(field.label))+'</dt><dd>'+formatDocumentText(format(field))+'</dd></div>';
  const section=(kind,label,names)=>{
    const selected=names.map(name=>remaining.get(name)).filter(Boolean);selected.forEach(f=>remaining.delete(f.api_name));
    return selected.length?'<section class="fid-field-section fid-field-section--'+kind+'">'+(selected.length>1?'<h5>'+e(label)+'</h5>':'')+'<dl class="fid-fields">'+selected.map(f=>cell(f)).join('')+'</dl></section>':'';
  };
  let html='';
  const routes=[['Flight','Flight_Number','Departure_Airport','Flight_Departure_Time','Arrival_Airport','Flight_Arrival_Time'],['Train','Train_Number','Departure_Station','Train_Departure_Time','Arrival_Station','Train_Arrival_Time'],['Sailing','Ship_Name','Departure_Port','Ship_Departure_Time','Arrival_Port','Ship_Arrival_Time'],['Transfer','','PickUp_Point','Car_PickUp_Time','DropOff_Point',''],['Departure city transfer','','Departure_City_PickUp_Point','Departure_City_Car_PickUp_Time','Departure_City_DropOff_Point',''],['Arrival city transfer','','Arrival_City_PickUp_Point','Arrival_City_Car_PickUp_Time','Arrival_City_DropOff_Point','']];
  for(const [label,number,from,departure,to,arrival] of routes){
    // Missing endpoints and times never reserve space or imply a connection.
    if(!remaining.has(from)&&!remaining.has(to))continue;
    const both=remaining.has(from)&&remaining.has(to);
    const endpoint=(place,time,heading)=>!remaining.has(place)?'':'<div class="fid-route-end"><span class="fid-route-label">'+heading+'</span>'+[remaining.get(time),remaining.get(place)].filter(Boolean).map(f=>{remaining.delete(f.api_name);return '<div class="fid-route-value '+(f.api_name===time?'fid-route-time':'fid-route-place')+'">'+formatDocumentText(format(f))+'</div>';}).join('')+'</div>';
    const auxiliary=label==='Transfer'?['Meeting_Details','Vehicle_Type']:label==='Departure city transfer'?['Departure_City_Vehicle_Type']:label==='Arrival city transfer'?['Arrival_City_Vehicle_Type']:[];
    const instructions=auxiliary.includes('Meeting_Details')?remaining.get('Meeting_Details'):null;
    if(instructions)remaining.delete('Meeting_Details');
    const meta=auxiliary.filter(name=>name!=='Meeting_Details').map(name=>remaining.get(name)).filter(Boolean);meta.forEach(f=>remaining.delete(f.api_name));
    const n=remaining.get(number);if(n)remaining.delete(number);
    html+='<section class="fid-field-section fid-route"><h5>'+e(label)+(n?' · '+e(format(n)):'')+'</h5>'+(instructions?'<dl class="fid-fields fid-route-instructions">'+cell(instructions)+'</dl>':'')+'<div class="fid-route-points">'+endpoint(from,departure,label.includes('ransfer')?'Pick-up':'Departure')+(both?'<span class="fid-route-arrow" aria-hidden="true">→</span>':'')+endpoint(to,arrival,label.includes('ransfer')?'Drop-off':'Arrival')+'</div>'+(meta.length?'<dl class="fid-fields fid-route-meta">'+meta.map(f=>cell(f)).join('')+'</dl>':'')+'</section>';
  }
  html+=section('logistics','Meeting & transfer',['Meeting_Details','PickUp_Point','Car_PickUp_Time','DropOff_Point','Vehicle_Type']);
  html+=section('logistics','Departure city transfer',['Departure_City_PickUp_Point','Departure_City_Car_PickUp_Time','Departure_City_DropOff_Point','Departure_City_Vehicle_Type']);
  html+=section('logistics','Arrival city transfer',['Arrival_City_PickUp_Point','Arrival_City_Car_PickUp_Time','Arrival_City_DropOff_Point','Arrival_City_Vehicle_Type']);
  html+=section('participants','Participation',['Duration','Passengers','Travellers_Number']);
  html+=layout.sections.map(([kind,label,names])=>section(kind,label,names)).join('');
  return html+section('details','Details',[...remaining.keys()]);
}
