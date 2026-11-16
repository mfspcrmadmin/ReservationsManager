const LIMITS = {outline:{min:200,max:380,initial:260},properties:{min:280,max:480,initial:360}};
const clamp = (value,min,max) => Math.max(min,Math.min(max,value));

export function studioPanelWidths(width, preferred={}) {
  const left=LIMITS.outline,right=LIMITS.properties;
  let outline=clamp(Number(preferred.outline)||left.initial,left.min,left.max);
  let properties=clamp(Number(preferred.properties)||right.initial,right.min,right.max);
  const budget=Math.max(left.min+right.min,width-320-12);
  const excess=Math.max(0,outline+properties-budget);
  const room=outline-left.min+properties-right.min;
  if(excess && room){outline-=excess*(outline-left.min)/room;properties-=excess*(properties-right.min)/room;}
  outline=Math.round(outline);
  return {outline,properties:Math.min(Math.round(properties),Math.floor(budget-outline))};
}

export function mountStudioPanelResize(dialog,state) {
  const layout=dialog.querySelector('.studio-layout');
  const outline=dialog.querySelector('.studio-outline'),properties=dialog.querySelector('.studio-inspector');
  outline.id='studio-outline-panel';properties.id='studio-properties-panel';
  layout.classList.add('studio-resizable');
  state.panelWidths ||= {};
  const handles={};let actual,drag=null;
  const desktop=()=>window.matchMedia('(min-width:951px)').matches;
  function update(){
    if(!desktop())return;
    actual=studioPanelWidths(layout.clientWidth,state.panelWidths);
    for(const side of ['outline','properties']){
      layout.style.setProperty('--studio-'+side+'-width',actual[side]+'px');
      const other=side==='outline'?'properties':'outline';
      const maximum=Math.max(LIMITS[side].min,Math.min(LIMITS[side].max,layout.clientWidth-332-actual[other]));
      handles[side].setAttribute('aria-valuemax',String(Math.floor(maximum)));
      handles[side].setAttribute('aria-valuenow',String(actual[side]));
      handles[side].setAttribute('aria-valuetext',actual[side]+' pixels');
    }
  }
  function change(side,width){
    const maximum=Number(handles[side].getAttribute('aria-valuemax'));
    state.panelWidths={...actual,[side]:clamp(Math.round(width),LIMITS[side].min,maximum)};
    update();
  }
  function finish(){drag=null;dialog.classList.remove('studio-is-resizing');}
  for(const [side,panel] of [['outline',outline],['properties',properties]]){
    const handle=document.createElement('div');handles[side]=handle;
    handle.className='studio-panel-resizer';handle.dataset.resizePanel=side;handle.tabIndex=0;
    handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','vertical');
    handle.setAttribute('aria-label',side==='outline'?'Resize document navigation':'Resize section properties');
    handle.setAttribute('aria-controls',panel.id);handle.setAttribute('aria-valuemin',String(LIMITS[side].min));
    handle.title='Drag to resize. Use arrow keys, or double-click to reset.';
    if(side==='outline')panel.after(handle);else panel.before(handle);
    handle.onpointerdown=event=>{
      if(event.button!==0 || !desktop())return;
      event.preventDefault();handle.focus({preventScroll:true});
      drag={side,x:event.clientX,width:actual[side],pointer:event.pointerId};
      handle.setPointerCapture(event.pointerId);dialog.classList.add('studio-is-resizing');
    };
    handle.onpointermove=event=>{if(drag?.side===side && drag.pointer===event.pointerId)change(side,drag.width+(event.clientX-drag.x)*(side==='outline'?1:-1));};
    handle.onpointerup=event=>{if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);finish();};
    handle.onpointercancel=finish;handle.onlostpointercapture=finish;
    handle.ondblclick=()=>change(side,LIMITS[side].initial);
    handle.onkeydown=event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();
      const delta=(event.shiftKey?40:10)*(event.key==='ArrowRight'?1:-1)*(side==='outline'?1:-1);
      change(side,event.key==='Home'?LIMITS[side].min:event.key==='End'?Number(handle.getAttribute('aria-valuemax')):actual[side]+delta);
    };
  }
  const observer=new ResizeObserver(update);observer.observe(layout);update();
  return ()=>{finish();observer.disconnect();};
}
