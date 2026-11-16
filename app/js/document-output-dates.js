// Presentation only: never construct a Date from an offset timestamp or mutate CRM values.
export const outputDateFormats=['dd MMM yy','dd MMM yyyy','dd MMMM yyyy','dd/MM/yyyy','MM/dd/yyyy','yyyy-MM-dd'];
export const outputTimeFormats=['h:mm a','h:mm:ss a'];
export function documentDateOptions(settings={},fieldKey='') {
  const o={...(settings.rules?.date_display || {}),...(settings.rules?.field_dates?.[fieldKey] || {})};
  return {date:outputDateFormats.includes(o.date)?o.date:outputDateFormats[0],time:['HH:mm:ss','h:mm:ss a'].includes(o.time)?'h:mm:ss a':'h:mm a',datetime:['date_time','date','time'].includes(o.datetime)?o.datetime:'date_time',timezone:o.timezone==='shown'?'shown':'hidden'};
}
export function documentDateLabel(label) {return String(label||'').replace(/\s*\(?with timezone\)?/gi,'').trim();}
export function formatDocumentTemporal(value,kind='auto',options={}) {
  let raw=String(value??'');
  if(/^([01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(raw)){raw='2000-01-01T'+(raw.indexOf(':')===1?'0':'')+raw;kind='time';}
  const o=documentDateOptions({rules:{date_display:options}});
  const match=/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?)?$/.exec(raw);
  if(!match)return raw;
  const [,year,month,day,hour,minute,second,zone]=match;
  const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const maxDays=[31,Number(year)%4===0 && (Number(year)%100!==0 || Number(year)%400===0)?29:28,31,30,31,30,31,31,30,31,30,31];
  if(Number(month)<1 || Number(month)>12 || Number(day)<1 || Number(day)>maxDays[Number(month)-1] || (hour!==undefined && (Number(hour)>23 || Number(minute)>59 || Number(second||0)>59)))return raw;
  const tokens={yyyy:year,yy:year.slice(2),MMMM:months[Number(month)-1],MMM:months[Number(month)-1].slice(0,3),MM:month,dd:day};
  const date=o.date.replace(/yyyy|MMMM|MMM|yy|MM|dd/g,key=>tokens[key]);
  if(hour===undefined || kind==='date')return date;
  const time=(Number(hour)%12||12)+':'+minute+(o.time==='h:mm:ss a'?':'+(second||'00'):'')+(Number(hour)<12?' AM':' PM');
  const mode=kind==='time'?'time':o.datetime;
  return (mode==='date'?date:mode==='time'?time:date+' '+time)+(mode!=='date' && o.timezone==='shown' && zone?' (UTC'+(zone==='Z'?'+00:00':zone)+')':'');
}
export function formatDocumentTravelDates(value,options={}) {
  return String(value||'').split(' - ').map(part=>formatDocumentTemporal(part,'date',options)).join(' - ');
}

export function mountFieldDateFormats(container,group,settings,onChange) {
  const entries=[];
  for(const [index,record] of (group.crmRecords||[]).entries())for(const field of record.fields){
    if(!['date','datetime'].includes(field.type) && !/date|time/i.test(field.api_name))continue;
    const source=container.querySelector('#crm-'+index+'-'+field.api_name);if(!source)continue;
    const key=record.key+'|'+field.api_name,saved=settings?.rules?.field_dates?.[key]||{};
    const details=document.createElement('details');details.className='studio-output-field-format';
    const summary=document.createElement('summary');summary.textContent='Format in document';details.append(summary);
    const controls={};
    const definitions=[['date','Date format',outputDateFormats],['time','Time format',outputTimeFormats],['datetime','Display',[['date_time','Date and time'],['date','Date only'],['time','Time only']]],['timezone','Time zone',[['hidden','Hidden'],['shown','Show UTC offset']]]];
    for(const [name,label,choices] of definitions){
      if(field.type==='date' && name!=='date')continue;
      const wrap=document.createElement('label');wrap.append(label);const select=document.createElement('select');select.dataset.fieldDate=key;select.dataset.formatOption=name;select.setAttribute('aria-label',documentDateLabel(field.label)+' '+label.toLowerCase());
      const inherit=document.createElement('option');inherit.value='';const resolved=documentDateOptions(settings)[name];const resolvedLabel=choices.map(choice=>Array.isArray(choice)?choice:[choice,choice]).find(([value])=>value===resolved)?.[1]||resolved;inherit.textContent='Default ('+resolvedLabel+')';select.append(inherit);
      for(const choice of choices){const [value,text]=Array.isArray(choice)?choice:[choice,choice];const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}select.value=name==='time'&&saved.time?documentDateOptions({rules:{date_display:saved}}).time:saved[name]||'';controls[name]=select;wrap.append(select);details.append(wrap);
    }
    const example=document.createElement('p');example.className='studio-inspector-help';details.append(example);
    const read=()=>Object.fromEntries(Object.entries(controls).filter(([,input])=>input.value).map(([name,input])=>[name,input.value]));
    const refresh=()=>{const options={...documentDateOptions(settings),...read()};example.textContent='Save section. Example: '+formatDocumentTemporal(source.value || (field.type==='date'?'2026-07-14':'2026-07-14T16:30:00+02:00'),field.type,options);};
    details.addEventListener('change',()=>{refresh();onChange();});source.addEventListener('input',refresh);
    source.closest('.studio-crm-field').append(details);refresh();entries.push({key,read,refresh,controls,initial:JSON.stringify(read())});
  }
  return {read:()=>Object.fromEntries(entries.filter(entry=>Object.keys(entry.read()).length).map(entry=>[entry.key,entry.read()])),dirty:()=>entries.some(entry=>JSON.stringify(entry.read())!==entry.initial),sync:locked=>{for(const entry of entries){entry.refresh();for(const input of Object.values(entry.controls))input.disabled=locked;}}};
}
