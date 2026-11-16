// Reading position is independent from the section being edited: no rerender or discarded input.
export function trackStudioReading({canvas,paper,outline,toolbar,groups,state}) {
  const sections=[...paper.querySelectorAll('[data-preview-key]')];
  const buttons=[...outline.querySelectorAll('[data-section]')];
  const location=document.createElement('p');location.className='studio-outline-location';location.hidden=true;
  outline.querySelector('.studio-outline-tools').append(location);
  let frame=0,disposed=false,lastKey='';
  function reveal(row) {
    if(!row || row.hidden || !outline.clientHeight)return;
    const tree=outline.querySelector('.studio-outline-tree');if(!row.getClientRects().length)return;const bounds=tree.getBoundingClientRect(),rect=row.getBoundingClientRect();
    const visibleTop=bounds.top;
    if(rect.top<visibleTop)tree.scrollTop+=rect.top-visibleTop;
    else if(rect.bottom>bounds.bottom)tree.scrollTop+=rect.bottom-bounds.bottom;
  }
  function update() {
    frame=0;
    if(disposed || !sections.length)return;
    if(!canvas.clientHeight) {reveal(buttons.find(button=>groups[Number(button.dataset.section)]?.key===lastKey));return;}
    const top=canvas.getBoundingClientRect().top+toolbar.offsetHeight+24;
    let active=sections[0];
    for(const section of sections) {if(section.getBoundingClientRect().top<=top)active=section;}
    if(canvas.scrollHeight>canvas.clientHeight && canvas.scrollTop+canvas.clientHeight>=canvas.scrollHeight-3)active=sections.at(-1);
    const key=active.dataset.previewKey;
    const row=buttons.find(button=>groups[Number(button.dataset.section)]?.key===key);
    if(!row)return;
    state.readingKey=key;
    for(const button of buttons){const current=button===row;button.classList.toggle('is-reading',current);}
    location.hidden=!row.hidden;
    location.textContent='Viewing: '+(groups[Number(row.dataset.section)].title||'Untitled section');
    // Reading highlights never move the tree or replace the editing selection.
    lastKey=key;
  }
  function schedule(){if(!frame && !disposed)frame=requestAnimationFrame(update);}
  canvas.addEventListener('scroll',schedule,{passive:true});
  const observer=new ResizeObserver(schedule);observer.observe(canvas);observer.observe(paper);observer.observe(outline);
  // Keep the current reading marker accurate when filtering or reopening the outline.
  const search=outline.querySelector('input[type=search]');search?.addEventListener('input',schedule);
  schedule();
  return ()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();canvas.removeEventListener('scroll',schedule);search?.removeEventListener('input',schedule);location.remove();};
}
