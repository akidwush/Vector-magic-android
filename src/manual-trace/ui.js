// Android-first Manual Trace UI.
// Step 5: Alight-style Control Pad, compound contours, real Fill/Stroke,
// and Curve/Bezier point editing without covering the canvas.
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
  const navToggle=document.querySelector('#manual-nav-toggle');
  const pad=document.querySelector('#manual-control-pad');
  const padSurface=document.querySelector('#manual-pad-surface');
  const padText=padSurface?.querySelector('span');
  const padHint=padSurface?.querySelector('small');
  const pointCount=document.querySelector('#manual-point-count');
  const closePath=document.querySelector('#manual-close-path');
  const finishPath=document.querySelector('#manual-finish-path');

  const bezierTools=document.querySelector('#manual-bezier-tools');
  const bezierButtons=[...(bezierTools?.querySelectorAll('[data-bezier-action]')||[])];
  const handleSideWrap=document.querySelector('#manual-handle-side');
  const handleSideButtons=[...(handleSideWrap?.querySelectorAll('[data-handle-side]')||[])];

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
  let nodeAction='move';          // move | handle | add
  let handleRelation='mirror';   // mirror | break
  let handleSide='out';          // in | out
  let navMode=false;             // Alight-style canvas Pan & Zoom toggle

  const currentTool=()=>stageWrap.getAttribute('data-tool')||editor.tool||'select';
  const touchModeFor=(tool)=>tool==='pen'?'pen':tool==='node'?'node':null;
  const vectorMode=()=>currentTool()==='pen'||currentTool()==='node';

  function syncNavigationUI(){
    const available=vectorMode()&&!paintMode;
    if(navMode&&!available)navMode=false;
    editor._manualTraceNavMode=navMode;
    app?.classList.toggle('manual-panzoom-mode',navMode);
    if(navToggle){
      navToggle.hidden=!available;
      navToggle.classList.toggle('active',navMode);
      navToggle.setAttribute('aria-pressed',navMode?'true':'false');
      navToggle.setAttribute('aria-label',navMode?'Exit Pan & Zoom':'Pan & Zoom');
      navToggle.title=navMode?'Return to vector editing':'Pan & Zoom';
    }
    padSurface.classList.toggle('navigation',navMode);
    padSurface.setAttribute('aria-disabled',navMode?'true':'false');
  }
  function setNavigation(on,announce=true){
    const next=!!on&&vectorMode()&&!paintMode;
    if(navMode===next){syncNavigationUI();return;}
    navMode=next;
    syncNavigationUI();
    renderCrosshair();
    updatePointState();
    if(announce)setStatus?.(
      navMode
        ?'Pan & Zoom — drag canvas with one finger, pinch with two.'
        :'Vector editing — Control Pad and point tools active.',
      1400
    );
  }

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
  function setCursor(pt){
    if(!pt||!Number.isFinite(Number(pt.x))||!Number.isFinite(Number(pt.y)))return false;
    cursorStage=editor.stage;cursor={x:Number(pt.x),y:Number(pt.y)};clampCursor();renderCrosshair();return true;
  }
  function clearCrosshair(){document.querySelectorAll('.manual-trace-crosshair').forEach(n=>n.remove());}
  function crosshairWanted(){return currentTool()==='pen'||(currentTool()==='node'&&nodeAction==='add');}
  function renderCrosshair(){
    clearCrosshair();
    if(!crosshairWanted()||!ensureCursor())return;
    const ov=editor._overlayEl?.();if(!ov)return;
    const m=editor.stageCTM?.(),k=m?Math.hypot(m.a,m.b)||1:1;
    const arm=11/k,r=2.8/k,sw=1.5/k;
    const g=document.createElementNS(SVG_NS,'g');g.setAttribute('class','manual-trace-crosshair');g.setAttribute('pointer-events','none');
    const line=(x1,y1,x2,y2)=>{const n=document.createElementNS(SVG_NS,'line');n.setAttribute('x1',x1);n.setAttribute('y1',y1);n.setAttribute('x2',x2);n.setAttribute('y2',y2);n.setAttribute('stroke','#20e3a7');n.setAttribute('stroke-width',sw);n.setAttribute('vector-effect','non-scaling-stroke');g.appendChild(n);};
    line(cursor.x-arm,cursor.y,cursor.x+arm,cursor.y);line(cursor.x,cursor.y-arm,cursor.x,cursor.y+arm);
    const c=document.createElementNS(SVG_NS,'circle');c.setAttribute('cx',cursor.x);c.setAttribute('cy',cursor.y);c.setAttribute('r',r);c.setAttribute('fill','#20e3a7');c.setAttribute('stroke','#08100d');c.setAttribute('stroke-width',1/k);g.appendChild(c);
    ov.appendChild(g);
    if(currentTool()==='pen')editor.manualPenPreview?.(cursor);
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
    if(editor._pen||paintCoalescing||!editor.manualPaintTarget?.())return;
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
    setNavigation(false,false);
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
    if(bezierTools)bezierTools.hidden=true;

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
    if(navMode)setNavigation(false,false);
    const state=contourState();if(!state.node||state.drawing||!state.contours.length)return;
    const i=Math.max(0,Math.min(state.contours.length-1,Number(index)||0));
    if(currentTool()!=='node'){editor._manualTraceTouchMode='node';editor.setTool('node');}
    nodeAction='move';
    editor.manualFocusContour?.(i);syncTool();renderContours();contourMenu.hidden=true;contourTitle?.setAttribute('aria-expanded','false');setStatus?.('Editing Contour '+(i+1),800);
  }

  function syncBezierTools(){
    if(!bezierTools)return;
    const node=currentTool()==='node'&&!paintMode;
    bezierTools.hidden=!node;
    if(!node)return;
    const state=editor.manualSelectedAnchorState?.()||{selected:false};
    for(const b of bezierButtons){
      const action=b.dataset.bezierAction;
      let active=false,stateOn=false;
      if(action==='corner')stateOn=!!state.corner;
      if(action==='smooth')stateOn=!!state.smooth&&!state.broken;
      if(action==='mirror'){active=nodeAction==='handle'&&handleRelation==='mirror';stateOn=!!state.mirrored;}
      if(action==='break'){active=nodeAction==='handle'&&handleRelation==='break';stateOn=!!state.broken;}
      if(action==='add')active=nodeAction==='add';
      b.classList.toggle('active',active);
      b.classList.toggle('state-on',stateOn);
      b.setAttribute('aria-pressed',active?'true':'false');
      if(action!=='add'&&action!=='delete')b.disabled=!state.selected;
      if(action==='delete')b.disabled=!state.selected;
    }
    if(handleSideWrap)handleSideWrap.hidden=nodeAction!=='handle';
    for(const b of handleSideButtons){
      const on=b.dataset.handleSide===handleSide;
      b.classList.toggle('active',on);b.setAttribute('aria-pressed',on?'true':'false');
    }
  }
  function selectBezierAction(action){
    if(currentTool()!=='node')return;
    if(navMode)setNavigation(false,false);
    if(action==='delete'){
      if(editor.deleteNodeSelection?.()){nodeAction='move';syncBezierTools();updatePointState();}
      return;
    }
    if(action==='corner'||action==='smooth'){
      if(editor.manualSetSelectedAnchorType?.(action)){nodeAction='move';syncBezierTools();updatePointState();}
      return;
    }
    if(action==='mirror'||action==='break'){
      if(!editor.manualSelectedPathAnchor?.()){setStatus?.('Tap one anchor first.',1200);return;}
      handleRelation=action;nodeAction='handle';
      editor.manualSetHandleRelation?.(action,handleSide);
      syncBezierTools();updatePointState();renderCrosshair();
      setStatus?.(action==='mirror'?'Mirrored handles — swipe the pad.':'Broken handles — swipe one side independently.',1400);
      return;
    }
    if(action==='add'){
      nodeAction=nodeAction==='add'?'move':'add';
      ensureCursor();renderCrosshair();syncBezierTools();updatePointState();
      setStatus?.(nodeAction==='add'?'Add Point — move the crosshair onto a contour and tap.':'Add Point cancelled.',1400);
    }
  }

  function updatePointState(){
    const n=editor._pen?.pts?.length||0;
    if(pointCount){
      if(currentTool()==='node'){
        const sel=editor.manualSelectedNodeCount?.()||0;
        if(nodeAction==='add')pointCount.textContent='Add Point';
        else if(nodeAction==='handle')pointCount.textContent=(handleRelation==='mirror'?'Mirror ':'Break ')+handleSide.toUpperCase();
        else pointCount.textContent=sel?sel+' selected':'Select a point';
      }else pointCount.textContent=n+' point'+(n===1?'':'s');
    }
    if(closePath)closePath.disabled=n<3;
    if(finishPath)finishPath.disabled=n<2;
    if(padText){
      if(navMode)padText.textContent='Drag canvas to pan';
      else if(currentTool()==='pen')padText.textContent='Swipe to position next point';
      else if(nodeAction==='add')padText.textContent='Swipe to position new point';
      else if(nodeAction==='handle')padText.textContent='Swipe to reshape '+handleSide.toUpperCase()+' handle';
      else padText.textContent='Swipe to move point';
    }
    if(padHint){
      if(navMode)padHint.textContent='Pinch with two fingers to zoom';
      else if(currentTool()==='pen')padHint.textContent='Tap to add point';
      else if(nodeAction==='add')padHint.textContent='Tap here when crosshair is on the contour';
      else if(nodeAction==='handle')padHint.textContent=handleRelation==='mirror'?'Opposite handle mirrors automatically':'Only this handle moves';
      else padHint.textContent=editor.manualSelectedNodeCount?.()?'Selected point follows your swipe':'Tap a node on canvas first';
    }
    renderContours();refreshPaintChips();syncBezierTools();
  }
  function syncTool(){
    const tool=currentTool(),editing=tool==='pen'||tool==='node',pen=tool==='pen',node=tool==='node';
    editor._manualTraceTouchMode=touchModeFor(tool);bar.dataset.activeTool=tool;
    for(const b of toolButtons){const on=b.dataset.manualTool===tool;b.classList.toggle('active',on);b.setAttribute('aria-pressed',on?'true':'false');}
    app?.classList.toggle('manual-vector-mode',editing);
    app?.classList.toggle('manual-pen-mode',pen);
    app?.classList.toggle('manual-node-mode',node);
    if(!editing)navMode=false;
    syncNavigationUI();
    if(head)head.hidden=!editing;
    if(headTitle)headTitle.textContent=pen?'Vector Drawing':node?'Edit Points':'Canvas';
    if(!paintMode){
      pad.hidden=!editing;
      if(contourDock)renderContours();
    }
    if(closePath)closePath.hidden=!pen;
    if(finishPath)finishPath.hidden=!pen;
    if(pen){nodeAction='move';ensureCursor();renderCrosshair();}
    else if(node){editor.mountNodeHandles?.();renderCrosshair();}
    else {nodeAction='move';clearCrosshair();}
    updatePointState();
  }

  for(const b of toolButtons)b.addEventListener('click',()=>{
    closePaint();setNavigation(false,false);const tool=b.dataset.manualTool;
    if(tool!=='node')nodeAction='move';
    editor._manualTraceTouchMode=touchModeFor(tool);editor.setTool(tool);syncTool();setStatus?.(names[tool]||tool,900);
  });
  navToggle?.addEventListener('click',()=>setNavigation(!navMode));
  for(const b of bezierButtons)b.addEventListener('click',()=>selectBezierAction(b.dataset.bezierAction));
  for(const b of handleSideButtons)b.addEventListener('click',()=>{
    handleSide=b.dataset.handleSide==='in'?'in':'out';
    if(nodeAction==='handle'&&handleRelation==='mirror')editor.manualSetHandleRelation?.('mirror',handleSide);
    syncBezierTools();updatePointState();
  });

  headBack?.addEventListener('click',()=>{closePaint();setNavigation(false,false);nodeAction='move';editor._manualTraceTouchMode=null;editor.setTool('select');syncTool();});
  headUndo?.addEventListener('click',()=>{editor.undo?.();setTimeout(()=>{nodeAction='move';syncTool();renderContours();},0);});
  headRedo?.addEventListener('click',()=>{editor.redoAction?.();setTimeout(()=>{nodeAction='move';syncTool();renderContours();},0);});
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
    if(currentTool()!=='pen'){nodeAction='move';editor._manualTraceTouchMode='pen';editor.setTool('pen');syncTool();}
    if(editor.manualStartContour?.()){contourMenu.hidden=true;contourTitle?.setAttribute('aria-expanded','false');updatePointState();renderCrosshair();setStatus?.('New contour — swipe, then tap to add points.',1500);}
    else setStatus?.('Select one editable path first.',1400);
  });

  const scale=()=>{const m=editor.stageCTM?.();return m?Math.hypot(m.a,m.b)||1:1;};
  const moveCursor=(x,y)=>{cursor.x=x;cursor.y=y;clampCursor();renderCrosshair();};
  function placePoint(){
    if(currentTool()!=='pen'||!ensureCursor())return;
    if(editor.manualPenPlacePoint?.(cursor)){updatePointState();renderCrosshair();setStatus?.('Point added',550);}
  }
  function addPointAtCursor(){
    if(currentTool()!=='node'||nodeAction!=='add'||!ensureCursor())return false;
    const ok=editor.manualAddPointAt?.(cursor);
    if(ok){nodeAction='move';renderCrosshair();updatePointState();}
    return !!ok;
  }

  padSurface.addEventListener('pointerdown',(e)=>{
    if(navMode||!vectorMode()||activePointer||e.button!==0||paintMode)return;
    e.preventDefault();e.stopPropagation();
    if(currentTool()==='pen'||nodeAction==='add')ensureCursor();
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
    if(currentTool()==='pen'||(currentTool()==='node'&&nodeAction==='add')){
      moveCursor(activePointer.cursorX+(totalDx/k)*gain,activePointer.cursorY+(totalDy/k)*gain);
    }else if(currentTool()==='node'&&activePointer.moved){
      const dx=((e.clientX-activePointer.lastX)/k)*gain,dy=((e.clientY-activePointer.lastY)/k)*gain;
      if(dx||dy){
        if(nodeAction==='handle'){
          if(editor.manualSelectedNodeCount?.()===1){
            if(!nodeCoalescing){editor.beginCoalesce();nodeCoalescing=true;}
            if(editor.manualMoveSelectedHandle?.(handleSide,dx,dy,handleRelation==='mirror'))activePointer.nodeMoved=true;
          }
        }else if(editor.manualSelectedNodeCount?.()>0){
          if(!nodeCoalescing){editor.beginCoalesce();nodeCoalescing=true;}
          if(editor.manualMoveSelectedNodes?.(dx,dy))activePointer.nodeMoved=true;
        }
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
    if(nodeCoalescing){
      if(nodeMoved)editor.commitCoalesce(nodeAction==='handle'?(handleRelation==='mirror'?'Mirror handle':'Break handle'):'Move point');
      else editor.cancelCoalesce();
      nodeCoalescing=false;
    }
    if(currentTool()==='pen'&&place&&tap)placePoint();
    else if(currentTool()==='node'&&nodeAction==='add'&&place&&tap)addPointAtCursor();
    if(currentTool()==='node')updatePointState();
  };
  padSurface.addEventListener('pointerup',(e)=>endPad(e,true));
  padSurface.addEventListener('pointercancel',(e)=>endPad(e,false));
  padSurface.addEventListener('keydown',(e)=>{
    if(navMode||e.key!=='Enter'&&e.key!==' ')return;
    if(currentTool()==='pen'){e.preventDefault();placePoint();}
    else if(currentTool()==='node'&&nodeAction==='add'){e.preventDefault();addPointAtCursor();}
  });

  closePath?.addEventListener('click',()=>{if(editor.manualPenClose?.()){updatePointState();renderCrosshair();setStatus?.('Contour closed',900);}});
  finishPath?.addEventListener('click',()=>{if(editor.manualPenFinishOpen?.()){updatePointState();renderCrosshair();setStatus?.('Open contour finished',900);}});

  // A canvas node tap changes editor._nodeSel rather than a normal DOM form value.
  // Refresh the Control Pad state after the pointer finishes so Corner/Smooth/etc
  // immediately light up for the anchor the user just picked.
  const selectionRefresh=()=>{if(currentTool()==='node')setTimeout(()=>{syncBezierTools();updatePointState();},0);};
  document.addEventListener('pointerup',selectionRefresh,true);

  const toolObserver=new MutationObserver(syncTool);
  toolObserver.observe(stageWrap,{attributes:true,attributeFilter:['data-tool']});
  let observedStage=null;
  const stageObserver=new MutationObserver(()=>{renderContours();refreshPaintChips();syncBezierTools();});
  function observeStage(){
    if(observedStage===editor.stage)return;
    stageObserver.disconnect();observedStage=editor.stage;
    if(observedStage)stageObserver.observe(observedStage,{subtree:true,attributes:true,attributeFilter:['d','fill','stroke','fill-opacity','stroke-opacity','stroke-width']});
  }
  observeStage();

  syncTool();refreshPaintChips();
  return{
    syncTool,
    getCursor:()=>({...cursor}),
    setCursor,
    getBezierMode:()=>({nodeAction,handleRelation,handleSide}),
    placePoint,renderContours,openPaint,closePaint,
    destroy(){
      toolObserver.disconnect();stageObserver.disconnect();document.removeEventListener('pointerup',selectionRefresh,true);
      paintCtl?.destroy?.();clearCrosshair();editor._manualTraceTouchMode=null;editor._manualTraceNavMode=false;
      app?.classList.remove('manual-vector-mode','manual-pen-mode','manual-node-mode','manual-paint-open','manual-panzoom-mode');
    }
  };
}
