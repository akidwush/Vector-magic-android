// Android-first Manual Trace UI.
// Step 3 adds compound-path contours while keeping Hector as the SVG/history engine.
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
  const contourDock=document.querySelector('#manual-contour-dock');
  const contourTitle=document.querySelector('#manual-contour-title');
  const contourName=document.querySelector('#manual-contour-name');
  const contourTotal=document.querySelector('#manual-contour-total');
  const contourMenu=document.querySelector('#manual-contour-menu');
  const contourList=document.querySelector('#manual-contour-list');
  const addContour=document.querySelector('#manual-add-contour');
  const contourPrev=document.querySelector('#manual-contour-prev');
  const contourNext=document.querySelector('#manual-contour-next');
  const contourRange=document.querySelector('#manual-contour-range');
  if(!bar||!stageWrap||!pad||!padSurface) return null;

  const toolButtons=[...bar.querySelectorAll('[data-manual-tool]')];
  const fillButton=bar.querySelector('#manual-fill');
  const strokeButton=bar.querySelector('#manual-stroke');
  const realFill=document.querySelector('#swatch-fill');
  const realStroke=document.querySelector('#swatch-stroke');
  const names={select:'Select',pen:'Pen',node:'Edit Points'};

  let cursor={x:0,y:0},cursorStage=null,activePointer=null;
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
  const clampCursor=()=>{const b=bounds();cursor.x=Math.max(b.x0,Math.min(b.x1,cursor.x));cursor.y=Math.max(b.y0,Math.min(b.y1,cursor.y));};
  function ensureCursor(){
    if(!editor.stage)return false;
    if(cursorStage!==editor.stage||!Number.isFinite(cursor.x)||!Number.isFinite(cursor.y)){
      cursorStage=editor.stage;const b=bounds();cursor={x:(b.x0+b.x1)/2,y:(b.y0+b.y1)/2};
    }
    clampCursor();return true;
  }
  function clearCrosshair(){document.querySelectorAll('.manual-trace-crosshair').forEach(n=>n.remove());}
  function renderCrosshair(){
    clearCrosshair();
    if(currentTool()!=='pen'||!ensureCursor())return;
    const ov=editor._overlayEl?.();if(!ov)return;
    const m=editor.stageCTM?.(),k=m?Math.hypot(m.a,m.b)||1:1;
    const arm=11/k,r=2.8/k,sw=1.5/k;
    const g=document.createElementNS(SVG_NS,'g');g.setAttribute('class','manual-trace-crosshair');g.setAttribute('pointer-events','none');
    const line=(x1,y1,x2,y2)=>{const n=document.createElementNS(SVG_NS,'line');n.setAttribute('x1',x1);n.setAttribute('y1',y1);n.setAttribute('x2',x2);n.setAttribute('y2',y2);n.setAttribute('stroke','#26e5a7');n.setAttribute('stroke-width',sw);n.setAttribute('vector-effect','non-scaling-stroke');g.appendChild(n);};
    line(cursor.x-arm,cursor.y,cursor.x+arm,cursor.y);line(cursor.x,cursor.y-arm,cursor.x,cursor.y+arm);
    const c=document.createElementNS(SVG_NS,'circle');c.setAttribute('cx',cursor.x);c.setAttribute('cy',cursor.y);c.setAttribute('r',r);c.setAttribute('fill','#26e5a7');c.setAttribute('stroke','#08100d');c.setAttribute('stroke-width',1/k);g.appendChild(c);
    ov.appendChild(g);editor.manualPenPreview?.(cursor);
  }

  function contourState(){
    const info=editor.manualVectorLayerContours?.()||{node:null,contours:[],editable:false,active:-1};
    const drawing=!!editor._pen?.contourAppend;
    let count=info.contours.length;
    let active=info.active;
    if(drawing&&editor._pen?.pts?.length===0){count+=1;active=count-1;}
    return{...info,drawing,count,active:Math.max(0,active||0)};
  }
  function renderContours(){
    if(!contourDock)return;
    const tool=currentTool(),state=contourState();
    const visible=(tool==='pen'||tool==='node')&&(state.node||state.drawing);
    contourDock.hidden=!visible;
    if(!visible)return;
    const count=Math.max(1,state.count);
    const active=Math.min(count-1,state.active);
    if(contourName)contourName.textContent='Contour '+(active+1);
    if(contourTotal)contourTotal.textContent=(active+1)+' / '+count;
    if(contourRange){contourRange.min='1';contourRange.max=String(count);contourRange.value=String(active+1);contourRange.disabled=state.drawing||count<2;}
    if(contourPrev)contourPrev.disabled=state.drawing||active<=0;
    if(contourNext)contourNext.disabled=state.drawing||active>=count-1;
    if(addContour)addContour.disabled=!!editor._pen||!state.node||!state.editable;
    if(contourList){
      contourList.replaceChildren();
      for(let i=0;i<count;i++){
        const b=document.createElement('button');b.type='button';b.role='option';
        b.dataset.contour=String(i);b.className='manual-contour-item'+(i===active?' active':'');
        const real=state.contours[i];
        b.innerHTML='<span>Contour '+(i+1)+'</span><small>'+(real?(real.closed?'Closed':'Open')+' · '+real.count+' pts':'Drawing…')+'</small>';
        b.disabled=state.drawing&&i===count-1;
        contourList.appendChild(b);
      }
    }
  }
  function focusContour(index){
    const state=contourState();if(!state.node||state.drawing||!state.contours.length)return;
    const i=Math.max(0,Math.min(state.contours.length-1,Number(index)||0));
    if(currentTool()!=='node'){editor._manualTraceTouchMode='node';editor.setTool('node');}
    editor.manualFocusContour?.(i);syncTool();renderContours();contourMenu.hidden=true;contourTitle?.setAttribute('aria-expanded','false');
    setStatus?.('Editing Contour '+(i+1),800);
  }

  function updatePointState(){
    const n=editor._pen?.pts?.length||0;
    if(pointCount)pointCount.textContent=n+' point'+(n===1?'':'s');
    if(closePath)closePath.disabled=n<3;
    if(finishPath)finishPath.disabled=n<2;
    renderContours();
  }
  function syncTool(){
    const tool=currentTool();editor._manualTraceTouchMode=touchModeFor(tool);bar.dataset.activeTool=tool;
    for(const b of toolButtons){const on=b.dataset.manualTool===tool;b.classList.toggle('active',on);b.setAttribute('aria-pressed',on?'true':'false');}
    const pen=tool==='pen';pad.hidden=!pen;app?.classList.toggle('manual-pad-open',pen);
    if(pen){ensureCursor();renderCrosshair();}else clearCrosshair();
    updatePointState();renderContours();
    if(tool==='node'&&editor.stage)editor.mountNodeHandles?.();
  }
  for(const b of toolButtons)b.addEventListener('click',()=>{const tool=b.dataset.manualTool;editor._manualTraceTouchMode=touchModeFor(tool);editor.setTool(tool);syncTool();setStatus?.(names[tool]||tool,900);});

  contourTitle?.addEventListener('click',()=>{const next=contourMenu.hidden;contourMenu.hidden=!next;contourTitle.setAttribute('aria-expanded',next?'true':'false');renderContours();});
  contourList?.addEventListener('click',(e)=>{const b=e.target.closest('[data-contour]');if(b)focusContour(Number(b.dataset.contour));});
  contourPrev?.addEventListener('click',()=>focusContour(contourState().active-1));
  contourNext?.addEventListener('click',()=>focusContour(contourState().active+1));
  contourRange?.addEventListener('input',()=>focusContour(Number(contourRange.value)-1));
  addContour?.addEventListener('click',()=>{
    if(editor._pen)return;
    if(currentTool()!=='pen'){editor._manualTraceTouchMode='pen';editor.setTool('pen');syncTool();}
    if(editor.manualStartContour?.()){
      contourMenu.hidden=true;contourTitle?.setAttribute('aria-expanded','false');
      updatePointState();renderCrosshair();setStatus?.('New contour — swipe, then tap to add points.',1500);
    }else setStatus?.('Select one editable path first.',1400);
  });

  const copyPaint=(source,target)=>{if(!source||!target)return;const none=source.classList.contains('none');target.classList.toggle('none',none);const bg=source.style.background||'transparent';target.style.setProperty('--manual-paint',none?'transparent':bg);target.setAttribute('aria-label',(target===fillButton?'Fill':'Stroke')+(none?' none':' '+bg));};
  const syncPaint=()=>{copyPaint(realFill,fillButton);copyPaint(realStroke,strokeButton);};
  fillButton?.addEventListener('click',()=>realFill?.click());strokeButton?.addEventListener('click',()=>realStroke?.click());

  const scale=()=>{const m=editor.stageCTM?.();return m?Math.hypot(m.a,m.b)||1:1;};
  const moveCursor=(x,y)=>{cursor.x=x;cursor.y=y;clampCursor();renderCrosshair();};
  function placePoint(){
    if(currentTool()!=='pen'||!ensureCursor())return;
    if(editor.manualPenPlacePoint?.(cursor)){updatePointState();renderCrosshair();setStatus?.('Point added',550);}
  }

  padSurface.addEventListener('pointerdown',(e)=>{if(currentTool()!=='pen'||activePointer||e.button!==0)return;e.preventDefault();e.stopPropagation();ensureCursor();activePointer={id:e.pointerId,startX:e.clientX,startY:e.clientY,cursorX:cursor.x,cursorY:cursor.y,moved:false};try{padSurface.setPointerCapture(e.pointerId);}catch{}padSurface.classList.add('tracking');});
  padSurface.addEventListener('pointermove',(e)=>{if(!activePointer||e.pointerId!==activePointer.id)return;e.preventDefault();e.stopPropagation();const dx=e.clientX-activePointer.startX,dy=e.clientY-activePointer.startY;if(Math.hypot(dx,dy)>5)activePointer.moved=true;const k=scale(),gain=.72;moveCursor(activePointer.cursorX+(dx/k)*gain,activePointer.cursorY+(dy/k)*gain);});
  const endPad=(e,place)=>{if(!activePointer||e.pointerId!==activePointer.id)return;e.preventDefault();e.stopPropagation();const tap=!activePointer.moved;try{padSurface.releasePointerCapture(e.pointerId);}catch{}activePointer=null;padSurface.classList.remove('tracking');if(place&&tap)placePoint();};
  padSurface.addEventListener('pointerup',(e)=>endPad(e,true));padSurface.addEventListener('pointercancel',(e)=>endPad(e,false));
  padSurface.addEventListener('keydown',(e)=>{if((e.key==='Enter'||e.key===' ')&&currentTool()==='pen'){e.preventDefault();placePoint();}});

  closePath?.addEventListener('click',()=>{if(editor.manualPenClose?.()){updatePointState();renderCrosshair();setStatus?.('Contour closed',900);}});
  finishPath?.addEventListener('click',()=>{if(editor.manualPenFinishOpen?.()){updatePointState();renderCrosshair();setStatus?.('Open contour finished',900);}});

  const toolObserver=new MutationObserver(syncTool);toolObserver.observe(stageWrap,{attributes:true,attributeFilter:['data-tool']});
  const paintObserver=new MutationObserver(syncPaint);if(realFill)paintObserver.observe(realFill,{attributes:true,attributeFilter:['style','class']});if(realStroke)paintObserver.observe(realStroke,{attributes:true,attributeFilter:['style','class']});
  const stageObserver=new MutationObserver(()=>renderContours());
  if(editor.stage)stageObserver.observe(editor.stage,{subtree:true,attributes:true,attributeFilter:['d']});

  syncTool();queueMicrotask(syncPaint);
  return{syncTool,syncPaint,getCursor:()=>({...cursor}),placePoint,renderContours,
    destroy(){toolObserver.disconnect();paintObserver.disconnect();stageObserver.disconnect();clearCrosshair();editor._manualTraceTouchMode=null;app?.classList.remove('manual-pad-open');}
  };
}
