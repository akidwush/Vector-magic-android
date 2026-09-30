// Android-first Manual Trace UI.
// Step 2: Alight-style relative Control Pad for Pen placement + strict canvas touch policy.
// Geometry/history remain owned by Hector's real editor/pen/node engines.
const SVG_NS="http://www.w3.org/2000/svg";

export function installManualTraceUI({editor,setStatus}) {
  const app=document.querySelector('main.app');
  const bar=document.querySelector('#manual-trace-bar');
  const stageWrap=document.querySelector('.stage-wrap');
  const pad=document.querySelector('#manual-control-pad');
  const padSurface=document.querySelector('#manual-pad-surface');
  const pointCount=document.querySelector('#manual-point-count');
  const closePath=document.querySelector('#manual-close-path');
  const finishPath=document.querySelector('#manual-finish-path');
  if(!bar||!stageWrap||!pad||!padSurface) return null;

  const toolButtons=[...bar.querySelectorAll('[data-manual-tool]')];
  const fillButton=bar.querySelector('#manual-fill');
  const strokeButton=bar.querySelector('#manual-stroke');
  const realFill=document.querySelector('#swatch-fill');
  const realStroke=document.querySelector('#swatch-stroke');
  const names={select:'Select',pen:'Pen',node:'Edit Points'};

  let cursor={x:0,y:0};
  let cursorStage=null;
  let activePointer=null;

  const currentTool=()=>stageWrap.getAttribute('data-tool')||editor.tool||'select';
  const touchModeFor=(tool)=>tool==='pen'?'pen':tool==='node'?'node':null;

  function bounds(){
    const ab=editor.artboardEl?.();
    if(ab){
      const x=Number(ab.getAttribute('x'))||0,y=Number(ab.getAttribute('y'))||0;
      const w=Number(ab.getAttribute('width')),h=Number(ab.getAttribute('height'));
      if(w>0&&h>0)return{x0:x,y0:y,x1:x+w,y1:y+h};
    }
    const vb=editor.stage?.viewBox?.baseVal;
    if(vb&&vb.width>0&&vb.height>0)return{x0:vb.x,y0:vb.y,x1:vb.x+vb.width,y1:vb.y+vb.height};
    return{x0:-10000,y0:-10000,x1:10000,y1:10000};
  }
  const clampCursor=()=>{
    const b=bounds();
    cursor.x=Math.max(b.x0,Math.min(b.x1,cursor.x));
    cursor.y=Math.max(b.y0,Math.min(b.y1,cursor.y));
  };
  function ensureCursor(){
    if(!editor.stage)return false;
    if(cursorStage!==editor.stage||!Number.isFinite(cursor.x)||!Number.isFinite(cursor.y)){
      cursorStage=editor.stage;
      const b=bounds();
      cursor={x:(b.x0+b.x1)/2,y:(b.y0+b.y1)/2};
    }
    clampCursor();
    return true;
  }
  function clearCrosshair(){
    document.querySelectorAll('.manual-trace-crosshair').forEach(n=>n.remove());
  }
  function renderCrosshair(){
    clearCrosshair();
    if(currentTool()!=='pen'||!ensureCursor())return;
    const ov=editor._overlayEl?.();if(!ov)return;
    const m=editor.stageCTM?.(),k=m?Math.hypot(m.a,m.b)||1:1;
    const arm=11/k,r=2.8/k,sw=1.5/k;
    const g=document.createElementNS(SVG_NS,'g');
    g.setAttribute('class','manual-trace-crosshair');
    g.setAttribute('pointer-events','none');
    const line=(x1,y1,x2,y2)=>{
      const n=document.createElementNS(SVG_NS,'line');
      n.setAttribute('x1',String(x1));n.setAttribute('y1',String(y1));
      n.setAttribute('x2',String(x2));n.setAttribute('y2',String(y2));
      n.setAttribute('stroke','#26e5a7');n.setAttribute('stroke-width',String(sw));
      n.setAttribute('vector-effect','non-scaling-stroke');
      g.appendChild(n);
    };
    line(cursor.x-arm,cursor.y,cursor.x+arm,cursor.y);
    line(cursor.x,cursor.y-arm,cursor.x,cursor.y+arm);
    const c=document.createElementNS(SVG_NS,'circle');
    c.setAttribute('cx',String(cursor.x));c.setAttribute('cy',String(cursor.y));
    c.setAttribute('r',String(r));c.setAttribute('fill','#26e5a7');
    c.setAttribute('stroke','#08100d');c.setAttribute('stroke-width',String(1/k));
    g.appendChild(c);ov.appendChild(g);
    editor.manualPenPreview?.(cursor);
  }
  function updatePointState(){
    const n=editor._pen?.pts?.length||0;
    if(pointCount)pointCount.textContent=n+' point'+(n===1?'':'s');
    if(closePath)closePath.disabled=n<3;
    if(finishPath)finishPath.disabled=n<2;
  }
  function syncTool(){
    const tool=currentTool();
    editor._manualTraceTouchMode=touchModeFor(tool);
    bar.dataset.activeTool=tool;
    for(const b of toolButtons){
      const on=b.dataset.manualTool===tool;
      b.classList.toggle('active',on);
      b.setAttribute('aria-pressed',on?'true':'false');
    }
    const pen=tool==='pen';
    pad.hidden=!pen;
    app?.classList.toggle('manual-pad-open',pen);
    if(pen){ensureCursor();renderCrosshair();}
    else clearCrosshair();
    updatePointState();
    if(tool==='node'&&editor.stage)editor.mountNodeHandles?.();
  }
  for(const b of toolButtons){
    b.addEventListener('click',()=>{
      const tool=b.dataset.manualTool;
      editor._manualTraceTouchMode=touchModeFor(tool);
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
  const syncPaint=()=>{copyPaint(realFill,fillButton);copyPaint(realStroke,strokeButton);};
  fillButton?.addEventListener('click',()=>realFill?.click());
  strokeButton?.addEventListener('click',()=>realStroke?.click());

  const scale=()=>{
    const m=editor.stageCTM?.();
    return m?Math.hypot(m.a,m.b)||1:1;
  };
  const moveCursor=(x,y)=>{
    cursor.x=x;cursor.y=y;clampCursor();renderCrosshair();
  };
  function placePoint(){
    if(currentTool()!=='pen'||!ensureCursor())return;
    if(editor.manualPenPlacePoint?.(cursor)){
      updatePointState();renderCrosshair();
      setStatus?.('Point added',550);
    }
  }

  padSurface.addEventListener('pointerdown',(e)=>{
    if(currentTool()!=='pen'||activePointer)return;
    if(e.button!==0)return;
    e.preventDefault();e.stopPropagation();
    ensureCursor();
    activePointer={
      id:e.pointerId,startX:e.clientX,startY:e.clientY,
      cursorX:cursor.x,cursorY:cursor.y,moved:false
    };
    try{padSurface.setPointerCapture(e.pointerId);}catch{}
    padSurface.classList.add('tracking');
  });
  padSurface.addEventListener('pointermove',(e)=>{
    if(!activePointer||e.pointerId!==activePointer.id)return;
    e.preventDefault();e.stopPropagation();
    const dx=e.clientX-activePointer.startX,dy=e.clientY-activePointer.startY;
    if(Math.hypot(dx,dy)>5)activePointer.moved=true;
    const k=scale(),gain=.72;
    moveCursor(activePointer.cursorX+(dx/k)*gain,activePointer.cursorY+(dy/k)*gain);
  });
  const endPad=(e,place)=>{
    if(!activePointer||e.pointerId!==activePointer.id)return;
    e.preventDefault();e.stopPropagation();
    const tap=!activePointer.moved;
    try{padSurface.releasePointerCapture(e.pointerId);}catch{}
    activePointer=null;padSurface.classList.remove('tracking');
    if(place&&tap)placePoint();
  };
  padSurface.addEventListener('pointerup',(e)=>endPad(e,true));
  padSurface.addEventListener('pointercancel',(e)=>endPad(e,false));
  padSurface.addEventListener('keydown',(e)=>{
    if((e.key==='Enter'||e.key===' ')&&currentTool()==='pen'){
      e.preventDefault();placePoint();
    }
  });

  closePath?.addEventListener('click',()=>{
    if(editor.manualPenClose?.()){
      updatePointState();renderCrosshair();
      setStatus?.('Path closed',900);
    }
  });
  finishPath?.addEventListener('click',()=>{
    if(editor.manualPenFinishOpen?.()){
      updatePointState();renderCrosshair();
      setStatus?.('Open path finished',900);
    }
  });

  const toolObserver=new MutationObserver(syncTool);
  toolObserver.observe(stageWrap,{attributes:true,attributeFilter:['data-tool']});
  const paintObserver=new MutationObserver(syncPaint);
  if(realFill)paintObserver.observe(realFill,{attributes:true,attributeFilter:['style','class']});
  if(realStroke)paintObserver.observe(realStroke,{attributes:true,attributeFilter:['style','class']});

  syncTool();queueMicrotask(syncPaint);
  return {
    syncTool,syncPaint,
    getCursor:()=>({...cursor}),
    placePoint,
    destroy(){
      toolObserver.disconnect();paintObserver.disconnect();
      clearCrosshair();editor._manualTraceTouchMode=null;
      app?.classList.remove('manual-pad-open');
    }
  };
}
