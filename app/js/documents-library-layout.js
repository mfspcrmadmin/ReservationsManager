// Keep scrolling and tooltips local to the library; dispose on each repaint.
export function mountDocumentsLibrary(panel) {
  const region=panel.querySelector('.documents-table-scroll');
  if(!region)return ()=>{};
  let frame=0,target=null;
  const tooltip=document.createElement('div');
  tooltip.className='documents-library-tooltip';tooltip.id='documents-library-tooltip';
  tooltip.setAttribute('role','tooltip');tooltip.setAttribute('popover','manual');tooltip.hidden=true;
  document.body.append(tooltip);
  const hide=()=>{if(tooltip.matches(':popover-open'))tooltip.hidePopover();tooltip.hidden=true;target?.removeAttribute('aria-describedby');target=null;};
  const show=event=>{
    const next=event.target.closest('[title]');
    if(!next || !panel.contains(next))return;
    hide();target=next;tooltip.textContent=next.title;tooltip.hidden=false;
    tooltip.showPopover?.();target.setAttribute('aria-describedby',tooltip.id);
    const rect=target.getBoundingClientRect();
    tooltip.style.left=Math.max(8,Math.min(rect.left,innerWidth-tooltip.offsetWidth-8))+'px';
    tooltip.style.top=(rect.bottom+tooltip.offsetHeight+12<innerHeight?rect.bottom+6:Math.max(8,rect.top-tooltip.offsetHeight-6))+'px';
  };
  const resize=()=>{
    cancelAnimationFrame(frame);
    frame=requestAnimationFrame(()=>{
      if(!region.clientWidth)return;
      const top=region.getBoundingClientRect().top;
      let bottom=innerHeight-24;
      // Respect scroll/clipping boundaries of the actual workspace, if present.
      for(let parent=panel.parentElement;parent && parent!==document.body;parent=parent.parentElement){
        const style=getComputedStyle(parent);
        if(/auto|scroll|hidden|clip/.test(style.overflowY) && parent.clientHeight){
          bottom=Math.min(bottom,parent.getBoundingClientRect().top+parent.clientTop+parent.clientHeight-12);
        }
      }
      region.style.setProperty('--documents-list-height',Math.max(80,bottom-top)+'px');
    });
  };
  const scroll=()=>{
    region.classList.toggle('is-scrolled-x',region.scrollLeft>0);
    if(panel.contains(document.activeElement) && document.activeElement.matches('[title]'))show({target:document.activeElement});
    else hide();
  };
  const observer=new ResizeObserver(resize);observer.observe(panel);
  if(panel.parentElement)observer.observe(panel.parentElement);
  panel.addEventListener('pointerover',show);panel.addEventListener('focusin',show);
  panel.addEventListener('pointerout',scroll);panel.addEventListener('focusout',hide);
  region.addEventListener('scroll',scroll,{passive:true});window.addEventListener('resize',resize);
  scroll();resize();
  return ()=>{cancelAnimationFrame(frame);observer.disconnect();hide();tooltip.remove();panel.removeEventListener('pointerover',show);panel.removeEventListener('focusin',show);panel.removeEventListener('pointerout',scroll);panel.removeEventListener('focusout',hide);region.removeEventListener('scroll',scroll);window.removeEventListener('resize',resize);};
}
