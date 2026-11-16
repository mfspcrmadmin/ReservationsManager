const dateFormats=['dd MMM yy','dd MMM yyyy','dd/MM/yyyy','MM/dd/yyyy','yyyy-MM-dd'];
const preferenceKey='documents.dateFormat';
export function formatWidgetDate(date,format='dd MMM yy') {
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(date||'');if(!match)return '';
  const [,year,month,day]=match;
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const tokens={yyyy:year,yy:year.slice(2),MMM:months[Number(month)-1],MM:month,dd:day};
  return (dateFormats.includes(format)?format:dateFormats[0]).replace(/yyyy|MMM|yy|MM|dd/g,key=>tokens[key]);
}
export function mountDocumentDateEditors(container,records=[]) {
  const sources=[...container.querySelectorAll('[data-crm-field]')].map(source=>({source,field:records.flatMap(r=>r.fields).find(f=>f.api_name===source.dataset.crmField)})).filter(({field})=>['date','datetime'].includes(field?.type));
  if(!sources.length)return ()=>{};
  let format='dd MMM yy';try{const saved=localStorage.getItem(preferenceKey);if(dateFormats.includes(saved))format=saved;}catch(_){}
  const setting=document.createElement('label');setting.className='studio-date-format';setting.append('Date display format');
  const select=document.createElement('select');select.setAttribute('aria-label','Date display format');for(const value of dateFormats){const option=document.createElement('option');option.value=value;option.textContent=value+' ('+formatWidgetDate('2026-07-13',value)+')';select.append(option);}select.value=format;setting.append(select);
  const details=document.createElement('details');details.className='studio-date-preferences';const summary=document.createElement('summary');summary.textContent='Date formatting';details.append(summary,setting);
  const hint=document.createElement('small');hint.textContent='Browser preference for calendar tooltips only. Choose the document output format in Document settings.';setting.append(hint);sources[0].source.closest('.studio-crm-fields').before(details);
  const editors=[];
  for(const {source,field} of sources){
    const datetime=field.type==='datetime';
    const parts=/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}:\d{2})(Z|[+-]\d{2}:\d{2}))?$/.exec(source.value);
    const wrap=document.createElement('div');wrap.className='studio-date-editor';
    const output=document.createElement('output');output.className='studio-date-display studio-sr-only';output.setAttribute('aria-live','polite');
    const controls=document.createElement('div');controls.className='studio-date-controls';
    const add=(label,control)=>{const l=document.createElement('label');l.append(label,control);controls.append(l);control.setAttribute('aria-label',(field.label||'Date').replace(/\s*(?:\(with timezone\)|with timezone)/i,'')+' '+label);return control;};
    const date=add('Date',document.createElement('input'));date.type='date';date.value=parts?.[1]||'';
    let time,zone;
    if(datetime){
      time=add('Time',document.createElement('input'));time.id=source.id+'-time';time.type='time';time.step='1';time.value=parts?.[2]||'';
      zone=add('Time zone',document.createElement('select'));
      zone.id=source.id+'-zone';
      const empty=document.createElement('option');empty.value='';empty.textContent='Choose time zone';zone.append(empty);
      const zones=new Set(['Z']);for(let minutes=-720;minutes<=840;minutes+=15){const absolute=Math.abs(minutes);zones.add((minutes<0?'-':'+')+String(Math.floor(absolute/60)).padStart(2,'0')+':'+String(absolute%60).padStart(2,'0'));}if(parts?.[3])zones.add(parts[3]);
      for(const value of zones){const option=document.createElement('option');option.value=value;option.textContent=value==='Z'?'UTC':'UTC'+value;zone.append(option);}zone.value=parts?.[3]||'';
    }
    const display=()=>{output.textContent=date.value?formatWidgetDate(date.value,format)+(datetime && time.value?' ? '+(time.value.length===8?time.value.replace(/:00$/,''):time.value):'')+(datetime && zone.value?' (UTC'+(zone.value==='Z'?'':zone.value)+')':''):'No date';date.title=output.textContent;};
    const update=()=>{
      let error=date.validity.badInput || time?.validity.badInput?'Enter a complete, valid date and time.':'';
      if(datetime && (date.value||time.value) && (!date.value||!time.value||!zone.value))error='Choose a date, time and time zone.';
      source.dataset.dateError=error;
      source.value=date.value?(datetime?date.value+'T'+(time.value.length===5?time.value+':00':time.value)+(zone.value||''):date.value):'';
      display();source.dispatchEvent(new Event('input',{bubbles:true}));
    };
    for(const control of [date,time,zone].filter(Boolean))control.addEventListener('input',update);
    source.hidden=true;source.type='hidden';
    const originalLabel=container.querySelector('label[for="'+source.id+'"]');if(originalLabel)originalLabel.textContent=originalLabel.textContent.replace(/\s*(?:\(with timezone\)|with timezone)/i,'');
    date.id=source.id+'-calendar';if(originalLabel)originalLabel.htmlFor=date.id;
    const clear=document.createElement('button');clear.type='button';clear.className='button tertiary compact';clear.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg>';clear.title='Clear date';clear.setAttribute('aria-label','Clear date');clear.onclick=()=>{date.value='';if(time)time.value='';update();};controls.append(clear);
    wrap.append(output,controls);source.after(wrap);display();editors.push({source,controls,display});
  }
  select.onchange=()=>{format=select.value;try{localStorage.setItem(preferenceKey,format);}catch(_){}editors.forEach(editor=>editor.display());};
  return ()=>editors.forEach(({source,controls})=>controls.querySelectorAll('input,select,button').forEach(control=>control.disabled=source.disabled));
}
