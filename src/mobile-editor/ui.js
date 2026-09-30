// Mobile-first SVG editor shell inspired by the interaction model of Alight Motion.
// It does not copy Alight assets/UI code: it reuses Vector Studio's own SVG/editor engines.
const readDataUrl=(file)=>new Promise((resolve,reject)=>{
  const r=new FileReader();
  r.onload=()=>resolve(String(r.result||""));
  r.onerror=()=>reject(r.error||new Error("Gambar tidak dapat dibaca."));
  r.readAsDataURL(file);
});
const imageSize=(src)=>new Promise((resolve,reject)=>{
  const im=new Image();
  im.onload=()=>resolve({w:im.naturalWidth||im.width||0,h:im.naturalHeight||im.height||0});
  im.onerror=()=>reject(new Error("Gambar referensi tidak dapat dibuka."));
  im.src=src;
});

export function installAlightMobileUI({editor,setStatus}){
  const app=document.querySelector("main.app");
  const stageWrap=document.querySelector(".stage-wrap");
  const fab=document.querySelector("#mobile-add-fab");
  const scrim=document.querySelector("#mobile-add-scrim");
  const addSheet=document.querySelector("#mobile-add-sheet");
  const addClose=document.querySelector("#mobile-add-close");
  const tabs=[...document.querySelectorAll("[data-add-tab]")];
  const panels=[...document.querySelectorAll("[data-add-panel]")];
  const shapeButtons=[...document.querySelectorAll("[data-add-shape]")];
  const referencePick=document.querySelector("#mobile-reference-pick");
  const referenceInput=document.querySelector("#mobile-reference-file");
  const traceOpen=document.querySelector("#mobile-trace-open");
  const vectorDraw=document.querySelector("#mobile-vector-draw");

  const objectSheet=document.querySelector("#mobile-object-sheet");
  const objectClose=document.querySelector("#mobile-object-close");
  const objectDelete=document.querySelector("#mobile-object-delete");
  const objectTitle=document.querySelector("#mobile-object-title");
  const shapeQuick=document.querySelector("#mobile-shape-quick");
  const shapeKindLabel=document.querySelector("#mobile-shape-kind");
  const shapeRoundRow=document.querySelector("#mobile-shape-round-row");
  const shapeRound=document.querySelector("#mobile-shape-round");
  const shapeRoundValue=document.querySelector("#mobile-shape-round-value");
  const shapeSidesRow=document.querySelector("#mobile-shape-sides-row");
  const shapeSides=document.querySelector("#mobile-shape-sides");
  const shapeSidesValue=document.querySelector("#mobile-shape-sides-value");
  const shapePointsRow=document.querySelector("#mobile-shape-points-row");
  const shapePoints=document.querySelector("#mobile-shape-points");
  const shapePointsValue=document.querySelector("#mobile-shape-points-value");
  const shapeInsetRow=document.querySelector("#mobile-shape-inset-row");
  const shapeInset=document.querySelector("#mobile-shape-inset");
  const shapeInsetValue=document.querySelector("#mobile-shape-inset-value");
  const shapeInnerRow=document.querySelector("#mobile-shape-inner-row");
  const shapeInner=document.querySelector("#mobile-shape-inner");
  const shapeInnerValue=document.querySelector("#mobile-shape-inner-value");
  const objectGrid=document.querySelector("#mobile-object-grid");
  const objectDetail=document.querySelector("#mobile-object-detail");
  const detailTitle=document.querySelector("#mobile-object-detail-title");
  const detailBack=document.querySelector("#mobile-object-detail-back");
  const borderDetail=document.querySelector('[data-object-detail="border"]');
  const blendDetail=document.querySelector('[data-object-detail="blend"]');
  const strokeRange=document.querySelector("#mobile-stroke-width");
  const strokeValue=document.querySelector("#mobile-stroke-value");
  const strokeColor=document.querySelector("#mobile-stroke-color");
  const shadowToggle=document.querySelector("#mobile-shadow-toggle");
  const opacityRange=document.querySelector("#mobile-object-opacity");
  const opacityValue=document.querySelector("#mobile-object-opacity-value");
  const blendMode=document.querySelector("#mobile-blend-mode");

  if(!app||!stageWrap||!fab||!addSheet||!objectSheet)return null;

  let activeTab="shape";
  let editCoalesce=null;

  const mobile=()=>matchMedia("(max-width:620px)").matches;
  const isReference=(n)=>!!n&&n.getAttribute("data-vs-reference")==="1";
  const selectedVector=()=>{
    if(editor.tool!=="select"||editor.selection?.size!==1)return null;
    const n=editor.selectedNodes?.()[0]||null;
    if(!n||isReference(n)||n.tagName?.toLowerCase()==="image")return null;
    return n;
  };
  const paintLeaves=(n)=>{
    if(!n)return[];
    const sel="path,rect,circle,ellipse,polygon,polyline,line,text";
    if(n.matches?.(sel))return[n];
    return[...n.querySelectorAll?.(sel)||[]];
  };
  const beginEdit=(label)=>{
    if(editCoalesce)return;
    editor.beginCoalesce?.();
    editCoalesce=label;
  };
  const commitEdit=()=>{
    if(!editCoalesce)return;
    editor.commitCoalesce?.(editCoalesce);
    editCoalesce=null;
    editor._renderInspector?.();
  };

  function setTab(tab){
    activeTab=["shape","media","vector"].includes(tab)?tab:"shape";
    tabs.forEach((b)=>{
      const on=b.dataset.addTab===activeTab;
      b.classList.toggle("active",on);
      b.setAttribute("aria-selected",on?"true":"false");
    });
    panels.forEach((p)=>p.hidden=p.dataset.addPanel!==activeTab);
  }
  function closeObject(){
    commitEdit();
    objectSheet.hidden=true;
    objectSheet.dataset.view="menu";
    objectGrid.hidden=false;
    objectDetail.hidden=true;
    borderDetail.hidden=true;
    blendDetail.hidden=true;
    app.classList.remove("alight-object-open");
  }
  function closeAdd(){
    addSheet.hidden=true;
    if(scrim)scrim.hidden=true;
    app.classList.remove("alight-add-open");
  }
  function openAdd(tab="shape"){
    if(!mobile()||app.classList.contains("manual-vector-mode"))return;
    closeObject();
    setTab(tab);
    addSheet.hidden=false;
    if(scrim)scrim.hidden=false;
    app.classList.add("alight-add-open");
  }
  function syncShapeControls(node){
    const info=editor.quickShapeInfo?.(node);
    if(!shapeQuick)return;
    shapeQuick.hidden=!info;
    if(!info)return;
    const names={rect:"Rectangle",poly:"Polygon",star:"Star",ellipse:"Ellipse"};
    if(shapeKindLabel)shapeKindLabel.textContent=names[info.kind]||"Shape";
    const roundable=info.kind==="rect"||info.kind==="poly"||info.kind==="star";
    if(shapeRoundRow)shapeRoundRow.hidden=!roundable;
    if(shapeSidesRow)shapeSidesRow.hidden=info.kind!=="poly";
    if(shapePointsRow)shapePointsRow.hidden=info.kind!=="star";
    if(shapeInsetRow)shapeInsetRow.hidden=info.kind!=="star";
    if(shapeInnerRow)shapeInnerRow.hidden=info.kind!=="ellipse";
    if(roundable&&shapeRound){
      const raw=info.kind==="rect"?info.radius:info.corner;
      const pct=info.maxCorner>0?Math.round(raw/info.maxCorner*100):0;
      shapeRound.value=String(Math.max(0,Math.min(100,pct)));
      if(shapeRoundValue)shapeRoundValue.textContent=shapeRound.value+"%";
    }
    if(shapeSides){shapeSides.value=String(info.sides||5);if(shapeSidesValue)shapeSidesValue.textContent=shapeSides.value;}
    if(shapePoints){shapePoints.value=String(info.points||5);if(shapePointsValue)shapePointsValue.textContent=shapePoints.value;}
    if(shapeInset){shapeInset.value=String(Math.round((info.inset||.5)*100));if(shapeInsetValue)shapeInsetValue.textContent=shapeInset.value+"%";}
    if(shapeInner){shapeInner.value=String(Math.round((info.inner||0)*100));if(shapeInnerValue)shapeInnerValue.textContent=shapeInner.value+"%";}
  }
  function syncObjectValues(node){
    syncShapeControls(node);
    const leaves=paintLeaves(node);
    const sample=leaves[0]||node;
    const sw=Math.max(0,parseFloat(sample.getAttribute("stroke-width"))||0);
    if(strokeRange)strokeRange.value=String(Math.min(40,sw));
    if(strokeValue)strokeValue.textContent=String(sw);
    const op=Math.max(0,Math.min(1,parseFloat(node.getAttribute("opacity")||"1")||0));
    if(opacityRange)opacityRange.value=String(Math.round(op*100));
    if(opacityValue)opacityValue.textContent=Math.round(op*100)+"%";
    if(blendMode)blendMode.value=node.style?.mixBlendMode||"normal";
    if(shadowToggle){
      const on=(node.style?.filter||"").includes("drop-shadow");
      shadowToggle.classList.toggle("active",on);
      shadowToggle.setAttribute("aria-pressed",on?"true":"false");
    }
  }
  function openObject(){
    const node=selectedVector();
    if(!mobile()||!node||app.classList.contains("manual-vector-mode")||!addSheet.hidden){
      closeObject();return false;
    }
    objectTitle.textContent=editor.nodeName?.(node)||"Vector Object";
    syncObjectValues(node);
    objectSheet.hidden=false;
    objectSheet.dataset.view="menu";
    objectGrid.hidden=false;
    objectDetail.hidden=true;
    app.classList.add("alight-object-open");
    return true;
  }
  function openDetail(kind){
    const node=selectedVector();if(!node)return;
    syncObjectValues(node);
    objectSheet.dataset.view="detail";
    objectGrid.hidden=true;
    objectDetail.hidden=false;
    borderDetail.hidden=kind!=="border";
    blendDetail.hidden=kind!=="blend";
    detailTitle.textContent=kind==="border"?"Border & Shadow":"Blending & Opacity";
  }
  function detailToMenu(){
    commitEdit();
    objectSheet.dataset.view="menu";
    objectGrid.hidden=false;
    objectDetail.hidden=true;
    borderDetail.hidden=true;
    blendDetail.hidden=true;
  }

  fab.addEventListener("click",()=>openAdd(activeTab));
  scrim?.addEventListener("click",closeAdd);
  addClose?.addEventListener("click",closeAdd);
  tabs.forEach((b)=>b.addEventListener("click",()=>setTab(b.dataset.addTab)));
  shapeButtons.forEach((b)=>b.addEventListener("click",()=>{
    const made=editor.insertQuickShape?.(b.dataset.addShape);
    if(!made)return;
    editor.setTool("select");
    closeAdd();
    setTimeout(openObject,0);
  }));

  referencePick?.addEventListener("click",()=>referenceInput?.click());
  referenceInput?.addEventListener("change",async()=>{
    const file=referenceInput.files?.[0];referenceInput.value="";
    if(!file)return;
    if(!file.type?.startsWith("image/")){setStatus?.("Pilih file gambar.",1800);return;}
    try{
      setStatus?.("Membuka gambar referensi…",1200);
      const src=await readDataUrl(file);
      const {w,h}=await imageSize(src);
      if(!editor.placeReferenceImage?.(src,file.name,w,h))return;
      closeAdd();closeObject();
      setStatus?.("Reference image masuk canvas dan tidak ikut SVG export.",2400);
    }catch(err){setStatus?.(err?.message||"Gagal membuka gambar referensi.",2600);}
  });
  traceOpen?.addEventListener("click",()=>{
    closeAdd();closeObject();
    document.querySelector("#studio-trace-button")?.click();
  });
  vectorDraw?.addEventListener("click",()=>{
    closeAdd();closeObject();
    editor.setTool("pen");
    window.manualTraceUI?.syncTool?.();
    setStatus?.("Vector Drawing — gunakan Control Pad untuk menaruh anchor.",1800);
  });

  document.querySelectorAll("[data-object-action]").forEach((b)=>b.addEventListener("click",()=>{
    const action=b.dataset.objectAction;
    const node=selectedVector();if(!node)return;
    if(action==="fill"){
      closeObject();
      document.querySelector("#swatch-fill")?.click();
    }else if(action==="border"){
      openDetail("border");
    }else if(action==="blend"){
      openDetail("blend");
    }else if(action==="transform"){
      closeObject();
      editor.setTool("select");
      document.querySelector("#act-scale")?.click();
      setStatus?.("Move & Transform — drag object atau handle transform.",1800);
    }else if(action==="points"){
      closeObject();
      editor.setTool("node");
      window.manualTraceUI?.syncTool?.();
      setStatus?.("Edit Points — pilih anchor lalu gunakan Control Pad.",1600);
    }
  }));
  objectClose?.addEventListener("click",closeObject);
  objectDelete?.addEventListener("click",()=>{
    const node=selectedVector();if(!node)return;
    const name=editor.nodeName?.(node)||"SVG layer";
    closeObject();
    editor.deleteSelection?.();
    setStatus?.(name+" deleted.",1400);
  });
  detailBack?.addEventListener("click",detailToMenu);

  const bindShapeRange=(el,label,apply,format=(v)=>String(v))=>{
    if(!el)return;
    el.addEventListener("pointerdown",()=>beginEdit(label));
    el.addEventListener("input",()=>{
      const node=selectedVector();if(!node)return;
      beginEdit(label);
      apply(node,Number(el.value)||0);
      syncShapeControls(node);
    });
    el.addEventListener("change",commitEdit);
    el.addEventListener("pointerup",commitEdit);
  };
  bindShapeRange(shapeRound,"Shape roundness",(node,pct)=>{
    const info=editor.quickShapeInfo?.(node);if(!info)return;
    const value=info.maxCorner*Math.max(0,Math.min(100,pct))/100;
    editor.setQuickShapeParam?.(info.kind==="rect"?"r":"corner",value);
  });
  bindShapeRange(shapeSides,"Polygon sides",(_node,v)=>editor.setQuickShapeParam?.("sides",Math.max(3,Math.min(12,Math.round(v)))));
  bindShapeRange(shapePoints,"Star points",(_node,v)=>editor.setQuickShapeParam?.("points",Math.max(3,Math.min(12,Math.round(v)))));
  bindShapeRange(shapeInset,"Star inner radius",(_node,v)=>editor.setQuickShapeParam?.("inset",Math.max(.05,Math.min(.9,v/100))));
  bindShapeRange(shapeInner,"Ellipse hole",(_node,v)=>editor.setQuickShapeParam?.("inner",Math.max(0,Math.min(.9,v/100))));

  strokeRange?.addEventListener("pointerdown",()=>beginEdit("Border width"));
  strokeRange?.addEventListener("input",()=>{
    const node=selectedVector();if(!node)return;
    beginEdit("Border width");
    const v=Math.max(0,Number(strokeRange.value)||0);
    for(const n of paintLeaves(node)){
      if(v<=0){n.setAttribute("stroke","none");n.setAttribute("stroke-width","0");}
      else{
        if(!n.getAttribute("stroke")||n.getAttribute("stroke")==="none")n.setAttribute("stroke","#ffffff");
        n.setAttribute("stroke-width",String(v));
        n.setAttribute("vector-effect","non-scaling-stroke");
      }
    }
    if(strokeValue)strokeValue.textContent=String(v);
  });
  strokeRange?.addEventListener("change",commitEdit);
  strokeRange?.addEventListener("pointerup",commitEdit);
  strokeColor?.addEventListener("click",()=>{
    commitEdit();closeObject();document.querySelector("#swatch-stroke")?.click();
  });
  shadowToggle?.addEventListener("click",()=>{
    const node=selectedVector();if(!node)return;
    beginEdit("Shadow");
    const on=(node.style?.filter||"").includes("drop-shadow");
    node.style.filter=on?"":"drop-shadow(0px 5px 8px rgba(0,0,0,.38))";
    shadowToggle.classList.toggle("active",!on);
    shadowToggle.setAttribute("aria-pressed",!on?"true":"false");
    commitEdit();
  });

  opacityRange?.addEventListener("pointerdown",()=>beginEdit("Opacity"));
  opacityRange?.addEventListener("input",()=>{
    const node=selectedVector();if(!node)return;
    beginEdit("Opacity");
    const v=Math.max(0,Math.min(100,Number(opacityRange.value)||0));
    node.setAttribute("opacity",String(v/100));
    if(opacityValue)opacityValue.textContent=Math.round(v)+"%";
  });
  opacityRange?.addEventListener("change",commitEdit);
  opacityRange?.addEventListener("pointerup",commitEdit);
  blendMode?.addEventListener("change",()=>{
    const node=selectedVector();if(!node)return;
    beginEdit("Blend mode");
    const v=blendMode.value||"normal";
    node.style.mixBlendMode=v==="normal"?"":v;
    commitEdit();
  });

  // Exactly like the requested object flow: the property menu is summoned by
  // tapping an existing vector on the canvas, not by merely having a selection.
  stageWrap.addEventListener("pointerup",()=>{
    if(!mobile())return;
    setTimeout(()=>{
      if(editor.tool==="select"&&selectedVector())openObject();
      else closeObject();
    },0);
  },true);

  // Tool transitions must never leave an old object sheet covering Vector Drawing.
  const toolObserver=new MutationObserver(()=>{
    if(stageWrap.getAttribute("data-tool")!=="select")closeObject();
    if(app.classList.contains("manual-vector-mode"))closeAdd();
  });
  toolObserver.observe(stageWrap,{attributes:true,attributeFilter:["data-tool"]});

  setTab("shape");
  return{
    openAdd,closeAdd,openObject,closeObject,setTab,
    destroy(){toolObserver.disconnect();closeAdd();closeObject();}
  };
}
