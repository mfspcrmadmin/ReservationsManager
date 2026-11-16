import { formatDocumentText } from './document-text-format.js';

// The textarea remains the source for validation, dirty state and CRM writes.
export function mountDocumentRichEditors(container) {
  const editors=[];
  for(const textarea of container.querySelectorAll('textarea[data-crm-field]')) {
    const wrap=document.createElement('div');wrap.className='studio-rich-editor';
    const panel=document.createElement('div');
    const toolbar=document.createElement('div');toolbar.className='studio-rich-toolbar';toolbar.setAttribute('role','group');toolbar.setAttribute('aria-label','Text formatting');
    const input=document.createElement('div');input.className='studio-rich-input';input.setAttribute('role','textbox');input.setAttribute('aria-multiline','true');input.setAttribute('aria-label',container.querySelector('label[for="'+textarea.id+'"]')?.textContent || 'Formatted text');
    const hint=document.createElement('small');hint.hidden=true;
    let range;
    const remember=()=>{const s=window.getSelection();if(s?.rangeCount && input.contains(s.anchorNode) && input.contains(s.focusNode))range=s.getRangeAt(0).cloneRange();};
    const read=()=>{
      const runs=[];
      const append=(text,style={})=>{if(!text)return;const last=runs.at(-1);if(last && JSON.stringify(last.style)===JSON.stringify(style))last.text+=text;else runs.push({text,style});};
      const endsNewline=()=>runs.at(-1)?.text.endsWith('\n');
      const walk=(node,style={})=>{
        if(node.nodeType===3){append(node.textContent,style);return;}
        if(node.nodeType!==1)return;
        if(node.tagName==='BR'){append('\n');return;}
        const block=node!==input && ['DIV','P','LI'].includes(node.tagName);
        if(block && runs.length && !endsNewline())append('\n');
        const next={...style};
        if(['B','STRONG'].includes(node.tagName)||node.style.fontWeight==='bold'||Number(node.style.fontWeight)>=600)next.b=true;
        else if(node.style.fontWeight==='normal')delete next.b;
        if(['I','EM'].includes(node.tagName)||node.style.fontStyle==='italic')next.i=true;
        else if(node.style.fontStyle==='normal')delete next.i;
        const color=node.style.color||node.getAttribute('color');
        if(color) {
          const rgb=/^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/.exec(color);
          const hex=/^#[0-9a-f]{6}$/i.test(color)?color.toLowerCase():rgb?'#'+rgb.slice(1).map(n=>Math.min(255,Number(n)).toString(16).padStart(2,'0')).join(''):'';
          if(hex)next.color=hex;
        }
        node.childNodes.forEach(child=>walk(child,next));
      };
      walk(input);
      return runs.map(({text,style})=>{let value=text.replace(/\n/g,'[[br]]');if(style.color)value=style.color==='#d70018'?'[[red]]'+value+'[[/red]]':'[[color:'+style.color+']]'+value+'[[/color]]';for(const tag of ['i','b'])if(style[tag])value='[['+tag+']]'+value+'[[/'+tag+']]';return value;}).join('');
    };
    const syncValue=()=>{textarea.value=read();textarea.dispatchEvent(new Event('input',{bubbles:true}));remember();};
    const apply=(command,value)=>{if(textarea.disabled)return;remember();input.focus();if(range && input.contains(range.commonAncestorContainer)){const s=window.getSelection();s.removeAllRanges();s.addRange(range);}document.execCommand(command,false,value);syncValue();};
    for(const [label,text,command,value] of [['Bold','B','bold'],['Italic','I','italic'],['Remove formatting','Clear','removeFormat']]){
      const button=document.createElement('button');button.type='button';button.textContent=text;if(command==='bold')button.style.fontWeight='700';if(command==='italic')button.style.fontStyle='italic';button.setAttribute('aria-label',label);button.title=label;button.onmousedown=event=>event.preventDefault();button.onclick=()=>apply(command,value);toolbar.append(button);
    }
    const colorLabel=document.createElement('label');colorLabel.className='studio-rich-color';colorLabel.title='Text color';
    const colorInput=document.createElement('input');colorInput.type='color';colorInput.value='#2c2c2c';colorInput.setAttribute('aria-label','Text color');
    colorLabel.append(document.createTextNode('Text color'),colorInput);toolbar.append(colorLabel);
    toolbar.addEventListener('pointerdown',remember);input.addEventListener('blur',remember);
    colorInput.addEventListener('input',()=>apply('foreColor',colorInput.value));
    input.oninput=syncValue;input.onkeyup=remember;input.onmouseup=remember;
    input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();apply('insertLineBreak');}};
    input.onpaste=event=>{event.preventDefault();apply('insertHTML',formatDocumentText(event.clipboardData?.getData('text/plain')||'').replace(/\r?\n/g,'<br>'));};
    input.ondrop=event=>event.preventDefault();
    textarea.hidden=true;
    input.innerHTML=formatDocumentText(textarea.value).replace(/\r?\n/g,'<br>');
    panel.append(toolbar,input,hint);wrap.append(panel);textarea.after(wrap);
    editors.push({textarea,input,toolbar});
  }
  return ()=>editors.forEach(({textarea,input,toolbar})=>{input.contentEditable=String(!textarea.disabled);input.setAttribute('aria-disabled',String(textarea.disabled));toolbar.querySelectorAll('button,input').forEach(button=>button.disabled=textarea.disabled);});
}
