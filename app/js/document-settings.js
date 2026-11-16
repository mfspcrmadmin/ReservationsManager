import { layoutDocumentSettings } from './document-settings-layout.js';
import { documentDateOptions, outputDateFormats, outputTimeFormats, formatDocumentTemporal } from './document-output-dates.js';
import { mountDocumentRulesSettings } from './document-rules-editor.js';
import { escapeHtml as e } from './utils.js';
import { proposalTypes } from './document-presentation.js';

export function openDocumentSettings({studio,doc,records={},save,isCurrent,setBusy,onSaved,onDirtyChange=()=>{}}) {
  const modal=document.createElement('dialog');
  modal.className='document-create-dialog document-import-dialog document-settings-dialog';
  modal.setAttribute('aria-labelledby','document-settings-title');
  const settings=doc.settings || {};
  const emergency=doc.presentation?.emergency_contact || {};
  const teams=[['616617000004053072','Team 1 (Paloma & Laura)'],['616617000004054001','Team 2 (Mar\u00eda & Natalia)']];
  const detected=Object.values(records).find(r=>r.module==='Deals')?.branding?.hour_rep?.id || emergency.rep_id || '';
  const detectedName=teams.find(([id])=>id===String(detected))?.[1] || 'No team assigned';
  const teamOptions=[['','Booking default - '+detectedName],...teams];
  modal.innerHTML='<form><h2 id="document-settings-title">Document settings</h2><label class="studio-field">Document presentation<span class="shared-select-wrap"><select name="proposal_type">'+proposalTypes.map(([value,label])=>'<option value="'+value+'"'+(value===(settings.proposal_type || 'Standard')?' selected':'')+'>'+label+'</option>').join('')+'</select><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></span></label><label class="studio-field" data-logo-field>Partner logo URL<input name="partner_logo_url" type="url" maxlength="255" placeholder="https://…" value="'+e(settings.partner_logo_url || '')+'"></label><label class="studio-field">24h Rep<span class="shared-select-wrap"><select data-hour-rep name="emergency_team" aria-describedby="document-hour-rep-help">'+teamOptions.map(([id,label])=>'<option value="'+id+'"'+(id===(settings.rules?.emergency_team||'')?' selected':'')+'>'+e(label)+'</option>').join('')+'</select><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></span></label><p id="document-hour-rep-help" class="studio-hint">Applies to this document. Does not change the booking&#39;s 24h Rep.</p><p class="document-settings-description"></p><p role="status" data-status></p><div class="document-create-actions"><button type="button" class="button tertiary" data-cancel>Cancel</button><button type="submit" class="button primary">Save settings</button></div></form>';
  const form=modal.querySelector('form'),select=form.elements.proposal_type,logo=form.elements.partner_logo_url,status=modal.querySelector('[data-status]'),submit=modal.querySelector('[type=submit]');
  const readRules=mountDocumentRulesSettings(form,settings,records);
  const dateOptions=documentDateOptions(settings),formats=document.createElement('fieldset');formats.className='studio-document-rules';
  formats.innerHTML='<legend>Dates & times in the document</legend><p>Applies to date fields, itinerary days and schedules. Keeps the local time stored in CRM; does not convert time zones.</p>';
  const controls={};
  for(const [key,label,choices] of [['date','Date format',outputDateFormats.map(v=>[v,formatDocumentTemporal('2026-07-14','date',{date:v})+' ('+v+')'])],['time','Time format',outputTimeFormats.map(v=>[v,formatDocumentTemporal('2026-07-14T16:30:45+02:00','time',{time:v})+' ('+v+')'])],['datetime','Date-time fields',[['date_time','Date and time'],['date','Date only'],['time','Time only']]],['timezone','Time zone in document',[['hidden','Hidden'],['shown','Show UTC offset']]]]){
    const labelNode=document.createElement('label');labelNode.className='studio-field';labelNode.append(label);const input=document.createElement('select');input.name='output_'+key;input.setAttribute('aria-label',label);
    for(const [value,text] of choices){const option=document.createElement('option');option.value=value;option.textContent=text;input.append(option);}input.value=dateOptions[key];controls[key]=input;labelNode.append(input);formats.append(labelNode);
  }
  const example=document.createElement('p');example.setAttribute('role','status');example.dataset.outputDateExample='';formats.append(example);
  const readDateOptions=()=>Object.fromEntries(Object.entries(controls).map(([key,input])=>[key,input.value]));
  const dateExample=()=>example.textContent='Example: '+formatDocumentTemporal('2026-07-14T16:30:45+02:00','datetime',readDateOptions());
  formats.addEventListener('change',dateExample);dateExample();form.querySelector('.studio-document-rules').before(formats);
  const apply=document.createElement('button');apply.type='button';apply.className='button tertiary';apply.dataset.applyDocumentRules='';apply.textContent='Apply to whole document';
  form.querySelector('.document-create-actions').prepend(apply);
  const disposeLayout=layoutDocumentSettings(modal);
  let pending=false,confirming=false;
  const alive=()=>modal.isConnected && isCurrent();
  const snapshot=()=>JSON.stringify([...form.querySelectorAll('input:not([data-settings-navigation]),select:not([data-settings-navigation]),textarea:not([data-settings-navigation])')].map(input=>[input.value,input.checked]));
  const initial=snapshot();
  const changed=()=>snapshot()!==initial;
  const trigger=document.activeElement;
  const finish=()=>{disposeLayout();onDirtyChange(false);modal.close();modal.remove();if(trigger?.isConnected)trigger.focus({preventScroll:true});};
  const close=()=>{if(!pending && !confirming && (!changed() || window.confirm('Discard unsaved document settings?')))finish();};
  form.addEventListener('input',()=>onDirtyChange(changed()));
  form.addEventListener('change',()=>onDirtyChange(changed()));
  const sync=()=>{
    modal.querySelector('[data-logo-field]').hidden=select.value!=='Cobranding';
    modal.querySelector('.document-settings-description').textContent={Standard:'Includes the agency and contact from the primary booking.',Wendy_Perrin:'Adds the VIP introduction and Virginia Irurita. Omits agency collaboration.',Private_Clients:'Omits agency collaboration.',Cobranding:'Includes the partner logo and agency collaboration.',Agent_Trip:'Displays the client company as Travel Agency.'}[select.value];
  };
  select.onchange=sync;sync();
  modal.querySelector('[data-cancel]').onclick=close;
  modal.querySelector('[data-settings-close]').onclick=close;
  modal.addEventListener('cancel',event=>{event.preventDefault();close();});
  const saveSettings=async applyToAll=>{
    if(pending || confirming || !alive())return;
    if(applyToAll){
      confirming=true;
      const confirmed=await confirmApplyRules(modal);
      confirming=false;if(!confirmed||!alive())return;
    }
    if(logo.value.trim() && !logo.value.trim().startsWith('https://')){status.textContent='Use an HTTPS image URL.';return;}
    pending=true;setBusy(true);status.textContent='';
    const disabledBefore=new Map([...form.querySelectorAll('input,select,button')].map(control=>[control,control.disabled]));
    form.querySelectorAll('input,select,button').forEach(control=>control.disabled=true);
    submit.setAttribute('aria-busy','true');submit.innerHTML='<span class="studio-button-spinner" aria-hidden="true"></span>Save settings';
    try {
      const response=await save({proposal_type:select.value,partner_logo_url:logo.value.trim(),...(applyToAll?{apply_to_all:true,confirmed:true}:{}),rules:{...readRules(),emergency_team:form.elements.emergency_team.value,date_display:readDateOptions(),field_dates:settings.rules?.field_dates||{}}});
      if(!alive())return;
      pending=false;setBusy(false);finish();onSaved(response);
    } catch(error){
      if(!alive())return;
      status.setAttribute('role','alert');status.textContent=error.message+' Your settings are still here.';
      pending=false;disabledBefore.forEach((disabled,control)=>{control.disabled=disabled;});
      submit.removeAttribute('aria-busy');submit.textContent='Save settings';
    } finally {if(isCurrent())setBusy(false);}
  };
  form.onsubmit=event=>{event.preventDefault();saveSettings(false);};
  apply.onclick=()=>{if(form.reportValidity())saveSettings(true);};
  studio.append(modal);modal.showModal();select.focus();
}

function confirmApplyRules(parent) {
  return new Promise(resolve=>{
    const dialog=document.createElement('dialog');dialog.className='document-create-dialog document-import-dialog document-rules-confirm';dialog.setAttribute('aria-labelledby','apply-rules-title');
    dialog.innerHTML='<h2 id="apply-rules-title">Apply settings to the whole document?</h2><p>This saves the current settings and replaces individual step and item visibility, contact visibility and contact choices with these defaults.</p><p>Text, images and field selections are kept. CRM exclusions still apply. The published document is not changed.</p><div class="document-create-actions"><button type="button" class="button tertiary" data-cancel-apply>Keep individual settings</button><button type="button" class="button primary" data-confirm-apply>Apply to whole document</button></div>';
    const focus=document.activeElement;let settled=false;
    const finish=value=>{if(settled)return;settled=true;observer.disconnect();dialog.close();dialog.remove();if(focus?.isConnected)focus.focus({preventScroll:true});resolve(value);};
    const observer=new MutationObserver(()=>{if(!parent.isConnected)finish(false);});observer.observe(document.body,{childList:true,subtree:true});
    dialog.querySelector('[data-cancel-apply]').onclick=()=>finish(false);dialog.querySelector('[data-confirm-apply]').onclick=()=>finish(true);
    dialog.addEventListener('cancel',event=>{event.preventDefault();event.stopPropagation();finish(false);});parent.append(dialog);dialog.showModal();dialog.querySelector('[data-cancel-apply]').focus();
  });
}
