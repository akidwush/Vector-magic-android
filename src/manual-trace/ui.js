// Android-first Manual Trace UI.
// Step 4: Alight-style workspace + real Fill/Stroke editing against the active Vector Layer.
import { openColorPicker } from "../ui/colorpicker.js";

const SVG_NS="http://www.w3.org/2000/svg";

export function installManualTraceUI({editor,setStatus}) {
  const app=document.querySelector('main.app');
  const bar=document.querySelector('#manual-trace-bar');
  const stageWrap=document.querySelector('.stage-wrap');
  const head=document.querySelector('#manual-vector-head');
  const headTitle=document.querySelector('#manual-vector-title');
  const headBack=document.querySelector('#manual-vector-back');
  const headUndo=document.querySelector('#manual-vector-undo');
  const headRedo=document.querySelector('#manual-vector-redo');
  const pad=document.querySelector('#manual-control-pad');
  const padSurface=document.querySelector('#manual-pad-surface');
  const padText=padSurface?.querySelector('span');
  const padHint=padSurface?.querySelector('small');
  const pointCount=document.querySelector('#manual-point-count');
  const closePath=document.querySelector('#manual-close-path');
  const finishPath=document.querySelector('#manual-finish-path');

  const paintSheet=document.querySelector('#manual-paint-sheet');
  const paintBack=document.querySelector('#manual-paint-back');
  const paintTitle=document.querySelector('#manual-paint-title');
  const paintTarget=document.querySelector('#manual-paint-target');
  const paintPicker=document.querySelector('#manual-paint-picker');
  const strokeWidthWrap=document.querySelector('#manual-stroke-width');
  const strokeRange=document.querySelector('#manual-stroke-range');
  const strokeValue=document.querySelector('#manual-stroke-value');

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
  const names={select:'Select',pen:'Vector Drawing',node:'Edit Points'};

  let cursor={x:0,y:0},cursorStage=null,activePointer=null;
  let paintCtl=null,paintMode=null,paintCoalescing=false,nodeCoalescing=false;

  const currentTool=()=>stageWrap.getAttribute('data-tool')||editor.tool||'select';
  const touchModeFor=(tool)=>tool==='pen'?'pen':tool==='node'?'node':null;
  const vectorMode=()=>currentTool()==='pen'||currentTool()==='node';

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
    const line=(x1,y1,x2,y2)=>{const n=document.createElementNS(SVG_NS,'line');n.setAttribute('x1',x1);n.setAttribute('y1',y1);n.setAttribute('x2',x2);n.setAttribute('y2',y2);n.setAttribute('stroke','#20e3a7');n.setAttribute('stroke-width',sw);n.setAttribute('vector-effect','non-scaling-stroke');g.appendChild(n);};
    line(cursor.x-arm,cursor.y,cursor.x+arm,cursor.y);line(cursor.x,cursor.y-arm,cursor.x,cursor.y+arm);
    const c=document.createElementNS(SVG_NS,'circle');c.setAttribute('cx',cursor.x);c.setAttribute('cy',cursor.y);c.setAttribute('r',r);c.setAttribute('fill','#20e3a7');c.setAttribute('stroke','#08100d');c.setAttribute('stroke-width',1/k);g.appendChild(c);
    ov.appendChild(g);editor.manualPenPreview?.(cursor);
  }

  function paintVisual(state){
    const p=state?.paint;
    if(!p||p.kind==='none')return{none:true,color:'#fff'};
    if(p.kind==='gradient')return{none:false,color:p.spec?.stops?.[0]?.color||'#808080',gradient:true};
    return{none:false,color:p.color||state?.color||'#808080'};
  }
  function refreshPaintChips(){
    for(const [button,which] of [[fillButton,'fill'],[strokeButton,'stroke']]){
      if(!button)continue;
      const state=editor.manualPaintState?.(which);
      const v=paintVisual(state);
      button.classList.toggle('none',v.none);
      button.classList.toggle('gradient',!!v.gradient);
      button.classList.toggle('active-paint',paintMode===which&&!paintSheet?.hidden);
      button.style.setProperty('--manual-paint',v.none?'transparent':v.color);
      button.setAttribute('aria-label',(which==='fill'?'Fill':'Stroke')+(v.none?' none':' '+v.color));
    }
  }
  function ensurePaintHistory(){
    if(editor._pen||paintCoalescing)return;
    editor.beginCoalesce();paintCoalescing=true;
  }
  function commitPaintHistory(){
    if(!paintCoalescing)return;
    editor.commitCoalesce(paintMode==='stroke'?'Stroke':'Fill');paintCoalescing=false;
  }
  function closePaint(){
    commitPaintHistory();
    paintCtl?.destroy?.();paintCtl=null;paintMode=null;
    if(paintSheet)paintSheet.hidden=true;
    app?.classList.remove('manual-paint-open');
    refreshPaintChips();
    syncTool();
  }
  function openPaint(which){
    if(!editor.stage)return;
    paintMode=which==='stroke'?'stroke':'fill';
    paintCtl?.destroy?.();paintCtl=null;
    const f=editor.manualPaintState?.('fill')||{color:editor.style.fill,alpha:1,paint:{kind:'solid',color:editor.style.fill}};
    const st=editor.manualPaintState?.('stroke')||{color:editor.style.stroke,alpha:1,width:editor.style.strokeWidth||0,paint:{kind:'none'}};
    if(paintTitle)paintTitle.textContent=paintMode==='stroke'?'Stroke':'Color & Fill';
    if(paintTarget)paintTarget.textContent=editor.manualPaintTarget?.()?'Vector Layer':'New Vector Layer';
    if(strokeWidthWrap)strokeWidthWrap.hidden=paintMode!=='stroke';
    const sw=st.width>0?st.width:2;
    if(strokeRange)strokeRange.value=String(sw);
    if(strokeValue)strokeValue.textContent=String(sw);
    if(paintSheet)paintSheet.hidden=false;
    app?.classList.add('manual-paint-open');
    if(pad)pad.hidden=true;
    if(contourDock)contourDock.hidden=true;

    const applySolid=(w,hex,a)=>{
      ensurePaintHistory();
      let width=Number(strokeRange?.value||st.width||2);
      if(w==='stroke'&&hex&&width<=0){width=2;if(strokeRange)strokeRange.value='2';if(strokeValue)strokeValue.textContent='2';}
      editor.manualApplyPaint?.(w,hex?{kind:'solid',color:hex,opacity:a}:{kind:'none'},width);
      refreshPaintChips();
    };
    const applyGradient=(w,spec)=>{
      ensurePaintHistory();
      let width=Number(strokeRange?.value||st.width||2);
      if(w==='stroke'&&width<=0){width=2;if(strokeRange)strokeRange.value='2';if(strokeValue)strokeValue.textContent='2';}
      editor.manualApplyPaint?.(w,{kind:'gradient',spec},width);
      refreshPaintChips();
    };

    paintCtl=openColorPicker({
      title:paintMode==='stroke'?'Stroke':'Color & Fill',
      allowNone:true,
      host:paintPicker,
      duo:{
        active:paintMode,
        fill:{color:f.color,alpha:f.alpha,paint:f.paint},
        stroke:{color:st.color,alpha:st.alpha,paint:st.paint},
        apply:applySolid,
        applyGradient,
      }
    });
    paintCtl.switchTo?.(paintMode);
    refreshPaintChips();
  }

  function contourState(){
    const info=editor.manualVectorLayerContours?.()||{node:null,contours:[],editable:false,active:-1};
    const drawing=!!editor._pen?.contourAppend;
    let count=info.contours.length,active=info.active;
    if(drawing&&editor._pen?.pts?.length===0){count+=1;active=count-1;}
    return{...info,drawing,count,active:Math.max(0,active||0)};
  }
  function renderContours(){
    if(!contourDock)return;
    const tool=currentTool(),state=contourState();
    const visible=!paintMode&&(tool==='pen'||tool==='node')&&(state.node||state.drawing);
    contourDock.hidden=!visible;
    if(!visible)return;
    const count=Math.max(1,state.count),active=Math.min(count-1,state.active);
    if(contourName)contourName.textContent='Contour '+(active+1);
    if(contourTotal)contourTotal.textContent=(active+1)+' / '+count;
    if(contourRange){contourRange.min='1';contourRange.max=String(count);contourRange.value=String(active+1);contourRange.disabled=state.drawing||count<2;}
    if(contourPrev)contourPrev.disabled=state.drawing||active<=0;
    if(contourNext)contourNext.disabled=state.drawing||active>=count-1;
    if(addContour)addContour.disabled=!!editor._pen||!state.node||!state.editable;
    if(contourList){
      contourList.replaceChildren();
      for(let i=0;i<count;i++){
        const b=document.createElement('button');b.type='button';b.role='option';b.dataset.contour=String(i);b.className='manual-contour-item'+(i===active?' active':'');
        const real=state.contours[i];b.innerHTML='<span>Contour '+(i+1)+'</span><small>'+(real?(real.closed?'Closed':'Open')+' · '+real.count+' pts':'Drawing…')+'</small>';
        b.disabled=state.drawing&&i===count-1;contourList.appendChild(b);
      }
    }
  }
  function focusContour(index){
    const state=contourState();if(!state.node||state.drawing||!state.contours.length)return;
    const i=Math.max(0,Math.min(state.contours.length-1,Number(index)||0));
    if(currentTool()!=='node'){editor._manualTraceTouchMode='node';editor.setTool('node');}
    editor.manualFocusContour?.(i);syncTool();renderContours();contourMenu.hidden=true;contourTitle?.setAttribute('aria-expanded','false');setStatus?.('Editing Contour '+(i+1),800);
  }

  function updatePointState(){
    const n=editor._pen?.pts?.length||0;
    if(pointCount){
      if(currentTool()==='node'){
        const sel=editor.manualSelectedNodeCount?.()||0;
        pointCount.textContent=sel?sel+' selected':'Select a point';
      }else pointCount.textContent=n+' point'+(n===1?'':'s');
    }
    if(closePath)closePath.disabled=n<3;
    if(finishPath)finishPath.disabled=n<2;
    renderContours();refreshPaintChips();
  }
  function syncTool(){
    const tool=currentTool(),editing=tool==='pen'||tool==='node',pen=tool==='pen',node=tool==='node';
    editor._manualTraceTouchMode=touchModeFor(tool);bar.dataset.activeTool=tool;
    for(const b of toolButtons){const on=b.dataset.manualTool===tool;b.classList.toggle('active',on);b.setAttribute('aria-pressed',on?'true':'false');}
    app?.classList.toggle('manual-vector-mode',editing);
    app?.classList.toggle('manual-pen-mode',pen);
    app?.classList.toggle('manual-node-mode',node);
    if(head)head.hidden=!editing;
    if(headTitle)headTitle.textContent=pen?'Vector Drawing':node?'Edit Points':'Canvas';
    if(!paintMode){
      pad.hidden=!editing;
      if(contourDock)renderContours();
    }
    if(padText)padText.textContent=pen?'Swipe to position next point':'Swipe to move point';
    if(padHint)padHint.textContent=pen?'Tap to add point':(editor.manualSelectedNodeCount?.()?'Selected point follows your swipe':'Tap a node on canvas first');
    if(closePath)closePath.hidden=!pen;
    if(finishPath)finishPath.hidden=!pen;
    if(pen){ensureCursor();renderCrosshair();}else clearCrosshair();
    if(node&&editor.stage)editor.mountNodeHandles?.();
    updatePointState();
  }
  for(const b of toolButtons)b.addEventListener('click',()=>{closePaint();const tool=b.dataset.manualTool;editor._manualTraceTouchMode=touchModeFor(tool);editor.setTool(tool);syncTool();setStatus?.(names[tool]||tool,900);});

  headBack?.addEventListener('click',()=>{closePaint();editor._manualTraceTouchMode=null;editor.setTool('select');syncTool();});
  headUndo?.addEventListener('click',()=>{editor.undo?.();setTimeout(()=>{syncTool();renderContours();},0);});
  headRedo?.addEventListener('click',()=>{editor.redoAction?.();setTimeout(()=>{syncTool();renderContours();},0);});
  paintBack?.addEventListener('click',closePaint);
  fillButton?.addEventListener('click',()=>openPaint('fill'));
  strokeButton?.addEventListener('click',()=>openPaint('stroke'));

  strokeRange?.addEventListener('input',()=>{
    ensurePaintHistory();
    const v=Math.max(0,Number(strokeRange.value)||0);
    editor.manualSetStrokeWidth?.(v);
    if(strokeValue)strokeValue.textContent=String(v);
    refreshPaintChips();
  });

  contourTitle?.addEventListener('click',()=>{const next=contourMenu.hidden;contourMenu.hidden=!next;contourTitle.setAttribute('aria-expanded',next?'true':'false');renderContours();});
  contourList?.addEventListener('click',(e)=>{const b=e.target.closest('[data-contour]');if(b)focusContour(Number(b.dataset.contour));});
  contourPrev?.addEventListener('click',()=>focusContour(contourState().active-1));
  contourNext?.addEventListener('click',()=>focusContour(contourState().active+1));
  contourRange?.addEventListener('input',()=>focusContour(Number(contourRange.value)-1));
  addContour?.addEventListener('click',()=>{
    if(editor._pen)return;
    if(currentTool()!=='pen'){editor._manualTraceTouchMode='pen';editor.setTool('pen');syncTool();}
    if(editor.manualStartContour?.()){contourMenu.hidden=true;contourTitle?.setAttribute('aria-expanded','false');updatePointState();renderCrosshair();setStatus?.('New contour — swipe, then tap to add points.',1500);}
    else setStatus?.('Select one editable path first.',1400);
  });

  const scale=()=>{const m=editor.stageCTM?.();return m?Math.hypot(m.a,m.b)||1:1;};
  const moveCursor=(x,y)=>{cursor.x=x;cursor.y=y;clampCursor();renderCrosshair();};
  function placePoint(){
    if(currentTool()!=='pen'||!ensureCursor())return;
    if(editor.manualPenPlacePoint?.(cursor)){updatePointState();renderCrosshair();setStatus?.('Point added',550);}
  }

  padSurface.addEventListener('pointerdown',(e)=>{
    if(!vectorMode()||activePointer||e.button!==0||paintMode)return;
    e.preventDefault();e.stopPropagation();
    if(currentTool()==='pen')ensureCursor();
    activePointer={id:e.pointerId,startX:e.clientX,startY:e.clientY,lastX:e.clientX,lastY:e.clientY,cursorX:cursor.x,cursorY:cursor.y,moved:false,nodeMoved:false};
    try{padSurface.setPointerCapture(e.pointerId);}catch{}
    padSurface.classList.add('tracking');
  });
  padSurface.addEventListener('pointermove',(e)=>{
    if(!activePointer||e.pointerId!==activePointer.id)return;
    e.preventDefault();e.stopPropagation();
    const totalDx=e.clientX-activePointer.startX,totalDy=e.clientY-activePointer.startY;
    if(Math.hypot(totalDx,totalDy)>5)activePointer.moved=true;
    const k=scale(),gain=.72;
    if(currentTool()==='pen'){
      moveCursor(activePointer.cursorX+(totalDx/k)*gain,activePointer.cursorY+(totalDy/k)*gain);
    }else if(currentTool()==='node'&&activePointer.moved){
      const dx=((e.clientX-activePointer.lastX)/k)*gain,dy=((e.clientY-activePointer.lastY)/k)*gain;
      if((dx||dy)&&editor.manualSelectedNodeCount?.()>0){
        if(!nodeCoalescing){editor.beginCoalesce();nodeCoalescing=true;}
        if(editor.manualMoveSelectedNodes?.(dx,dy))activePointer.nodeMoved=true;
      }
      activePointer.lastX=e.clientX;activePointer.lastY=e.clientY;
    }
  });
  const endPad=(e,place)=>{
    if(!activePointer||e.pointerId!==activePointer.id)return;
    e.preventDefault();e.stopPropagation();
    const tap=!activePointer.moved,nodeMoved=activePointer.nodeMoved;
    try{padSurface.releasePointerCapture(e.pointerId);}catch{}
    activePointer=null;padSurface.classList.remove('tracking');
    if(nodeCoalescing){if(nodeMoved)editor.commitCoalesce('Move point');else editor.cancelCoalesce();nodeCoalescing=false;}
    if(currentTool()==='pen'&&place&&tap)placePoint();
    if(currentTool()==='node')updatePointState();
  };
  padSurface.addEventListener('pointerup',(e)=>endPad(e,true));padSurface.addEventListener('pointercancel',(e)=>endPad(e,false));
  padSurface.addEventListener('keydown',(e)=>{if((e.key==='Enter'||e.key===' ')&&currentTool()==='pen'){e.preventDefault();placePoint();}});

  closePath?.addEventListener('click',()=>{if(editor.manualPenClose?.()){updatePointState();renderCrosshair();setStatus?.('Contour closed',900);}});
  finishPath?.addEventListener('click',()=>{if(editor.manualPenFinishOpen?.()){updatePointState();renderCrosshair();setStatus?.('Open contour finished',900);}});

  const toolObserver=new MutationObserver(syncTool);toolObserver.observe(stageWrap,{attributes:true,attributeFilter:['data-tool']});
  const stageObserver=new MutationObserver(()=>{renderContours();refreshPaintChips();});
  if(editor.stage)stageObserver.observe(editor.stage,{subtree:true,attributes:true,attributeFilter:['d','fill','stroke','fill-opacity','stroke-opacity','stroke-width']});

  syncTool();refreshPaintChips();
  return{syncTool,getCursor:()=>({...cursor}),placePoint,renderContours,openPaint,closePaint,
    destroy(){toolObserver.disconnect();stageObserver.disconnect();paintCtl?.destroy?.();clearCrosshair();editor._manualTraceTouchMode=null;app?.classList.remove('manual-vector-mode','manual-pen-mode','manual-node-mode','manual-paint-open');}
  };
}
