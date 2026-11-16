import { escapeHtml as e } from './utils.js';

export function confirmSectionChange({studio,sectionName,crm,onDiscard,closing=false}) {
  const previousFocus=document.activeElement;
  const modal=document.createElement('dialog');
  modal.className='document-create-dialog document-import-dialog document-unsaved-dialog';
  modal.setAttribute('aria-labelledby','document-unsaved-title');
  modal.setAttribute('aria-describedby','document-unsaved-message document-unsaved-help');
  const action=closing?'close Document Studio':'move to another section';
  modal.innerHTML='<h2 id="document-unsaved-title">Unsaved changes</h2><p id="document-unsaved-message">Your changes to <strong>'+e(sectionName||'this section')+'</strong> have not been saved. If you '+action+' now, these changes will be lost.</p><p id="document-unsaved-help">To keep your changes, choose <strong>Keep editing</strong>, then select <strong>'+(crm?'Save to CRM':'Save section')+'</strong> before you '+action+'.'+(closing?' Saving keeps your edits; use Generate document when you want to update the saved preview.':'')+'</p><div class="document-create-actions"><button type="button" class="button tertiary" data-discard-section>'+(closing?'Discard changes and close':'Discard changes and continue')+'</button><button type="button" class="button primary" data-keep-editing>Keep editing</button></div>';
  let finished=false;
  const close=()=>{
    if(finished)return;finished=true;
    modal.close();modal.remove();
    if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});
  };
  modal.querySelector('[data-keep-editing]').onclick=close;
  modal.addEventListener('cancel',event=>{event.preventDefault();event.stopPropagation();close();});
  modal.querySelector('[data-discard-section]').onclick=()=>{if(finished)return;close();onDiscard();};
  studio.append(modal);modal.showModal();modal.querySelector('[data-keep-editing]').focus();
  return close;
}
