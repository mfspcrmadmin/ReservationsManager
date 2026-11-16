// Keep the Ezus storage vocabulary; never accept arbitrary HTML.
const textEscape=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
export function formatDocumentText(value) {
  const source=String(value??''),parts=source.split('[['),stack=[];
  const tags={b:['<strong>','</strong>'],i:['<em>','</em>'],red:['<span style="color:#d70018">','</span>'],color:['','</span>']};
  let html=textEscape(parts.shift());
  for(const part of parts){
    const end=part.indexOf(']]');
    if(end<0){html+=textEscape('[['+part);continue;}
    const token=part.slice(0,end),rest=part.slice(end+2);
    if(token==='br')html+='<br>';
    else if(/^color:#[0-9a-fA-F]{6}$/.test(token)){stack.push('color');html+='<span style="color:'+token.slice(6).toLowerCase()+'">';}
    else if(token!=='color' && Object.hasOwn(tags,token)){stack.push(token);html+=tags[token][0];}
    else if(token.startsWith('/') && Object.hasOwn(tags,token.slice(1))){
      const kind=token.slice(1);if(stack.pop()!==kind)return textEscape(source);
      html+=tags[kind][1];
    }else html+=textEscape('[['+token+']]');
    html+=textEscape(rest);
  }
  return stack.length?textEscape(source):html;
}
