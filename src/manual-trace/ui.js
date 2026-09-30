// Android-first manual tracing shell.
// Step 1 deliberately reuses Hector's proven tool/history/color engines.
// Future Control Pad and contour navigation will attach to these three modes.
export function installManualTraceUI({editor,setStatus}) {
  const bar=document.querySelector('#manual-trace-bar');
  if(!bar) return null;
  const stageWrap=document.querySelector('.stage-wrap');
  const toolButtons=[...bar.querySelectorAll('[data-manual-tool]')];
  const fillButton=bar.querySelector('#manual-fill');
  const strokeButton=bar.querySelector('#manual-stroke');
  const realFill=document.querySelector('#swatch-fill');
  const realStroke=document.querySelector('#swatch-stroke');

  const names={select:'Select',pen:'Pen',node:'Edit Points'};
  const syncTool=()=>{
    const tool=stageWrap?.getAttribute('data-tool')||editor.tool||'select';
    bar.dataset.activeTool=tool;
    for(const b of toolButtons){
      const on=b.dataset.manualTool===tool;
      b.classList.toggle('active',on);
      b.setAttribute('aria-pressed',on?'true':'false');
    }
  };
  for(const b of toolButtons){
    b.addEventListener('click',()=>{
      const tool=b.dataset.manualTool;
      editor.setTool(tool);
      syncTool();
      setStatus?.(names[tool]||tool,900);
    });
  }

  const copyPaint=(source,target)=>{
    if(!source||!target)return;
    const none=source.classList.contains('none');
    target.classList.toggle('none',none);
    const bg=source.style.background||'transparent';
    target.style.setProperty('--manual-paint',none?'transparent':bg);
    target.setAttribute('aria-label',(target===fillButton?'Fill':'Stroke')+(none?' none':' '+bg));
  };
  const syncPaint=()=>{
    copyPaint(realFill,fillButton);
    copyPaint(realStroke,strokeButton);
  };
  fillButton?.addEventListener('click',()=>realFill?.click());
  strokeButton?.addEventListener('click',()=>realStroke?.click());

  const toolObserver=stageWrap?new MutationObserver(syncTool):null;
  toolObserver?.observe(stageWrap,{attributes:true,attributeFilter:['data-tool']});
  const paintObserver=new MutationObserver(syncPaint);
  if(realFill)paintObserver.observe(realFill,{attributes:true,attributeFilter:['style','class']});
  if(realStroke)paintObserver.observe(realStroke,{attributes:true,attributeFilter:['style','class']});

  syncTool();
  queueMicrotask(syncPaint);
  return {syncTool,syncPaint,destroy(){toolObserver?.disconnect();paintObserver.disconnect();}};
}
