import {editor} from '../editor.js';
import {mountStageFromText} from '../ui/docio.js';
import {canvasIsEmpty} from '../ui/gallery.js';
import {sanitizeVectorSvg} from './sanitize.js';
const SVG_NS='http://www.w3.org/2000/svg';

// For an existing drawing, preserve all defs and all editable geometry together.
// Hector Vector's generic placeSvgMarkup deliberately skips defs: do not use it here.
function placeWithDefs(markup,name){
  if(!editor.stage)throw new Error('Canvas belum siap.');
  const root=new DOMParser().parseFromString(markup,'image/svg+xml').documentElement;
  const artwork=[...root.children].filter(n=>!['defs','title','desc'].includes(n.localName.toLowerCase()));
  if(!artwork.length)throw new Error('SVG tanpa objek.');
  const p=(root.getAttribute('viewBox')||'').trim().split(/[\s,]+/).map(Number);
  const vb=editor.stage.viewBox.baseVal;
  if(p.length!==4||p[2]<=0||p[3]<=0||!vb?.width||!vb?.height)throw new Error('SVG tanpa viewBox yang valid.');
  const s=Math.min(1,0.95*Math.min(vb.width/p[2],vb.height/p[3]));
  const tx=vb.x+(vb.width-p[2]*s)/2-p[0]*s;
  const ty=vb.y+(vb.height-p[3]*s)/2-p[1]*s;
  const defs=[...root.querySelectorAll('defs')].flatMap(d=>[...d.children]).map(n=>document.importNode(n,true));
  const group=document.createElementNS(SVG_NS,'g');
  // Outer group stays translate-only as Hector Vector expects for drag/move.
  // Inner wrapper carries the fit matrix, which dragging the outer group cannot erase.
  const fitted=document.createElementNS(SVG_NS,'g');
  fitted.setAttribute('transform',`matrix(${s} 0 0 ${s} ${tx} ${ty})`);
  group.setAttribute('data-hv-name','Trace: '+name.replace(/\.[^.]+$/,''));
  for(const node of artwork)fitted.appendChild(document.importNode(node,true));
  group.appendChild(fitted);
  // Nested defs were collected above and are moved into the destination's resource store.
  group.querySelectorAll('defs').forEach(d=>d.remove());
  // Namespaced resource IDs avoid conflicts with the current editor's gradients/masks.
  const roots=[...defs,group], ids=new Map();
  const all=[];
  for(const n of roots){all.push(n,...n.querySelectorAll('*'));}
  for(const n of all){
    const old=n.getAttribute('id');if(!old)continue;
    if(ids.has(old))throw new Error('SVG memiliki resource ID ganda.');
    const fresh='hvtrace'+(++editor.idSeq);ids.set(old,fresh);n.setAttribute('id',fresh);
  }
  const remap=v=>v.replace(/url\(\s*(['"]?)#([\w:.-]+)\1\s*\)/g,(all,q,id)=>ids.has(id)?`url(#${ids.get(id)})`:all);
  for(const n of all){
    for(const a of [...n.attributes]){
      let val=a.value;
      if((a.name==='href'||a.name==='xlink:href')&&val.startsWith('#')&&ids.has(val.slice(1)))
        val='#'+ids.get(val.slice(1));
      else val=remap(val);
      if(val!==a.value)n.setAttribute(a.name,val);
    }
  }
  // Validate all content BEFORE the first document mutation. Then one history entry.
  editor.beginCoalesce();
  try{
    for(const n of defs)editor._defs().appendChild(n);
    group.setAttribute('data-hv-id','n'+(++editor.idSeq));
    for(const n of group.querySelectorAll('g,path,rect,circle,ellipse,polygon,polyline,line'))
      n.setAttribute('data-hv-id','n'+(++editor.idSeq));
    editor._artHome().insertBefore(group,editor.isIsolated()?null:editor._overlayEl());
    editor.commitCoalesce('Trace Image');
    editor.selection=new Set([group.getAttribute('data-hv-id')]);editor.artboardSelected=false;
    editor._renderSelection();editor._renderInspector();editor._renderLayers();
  }catch(e){editor.cancelCoalesce();throw e;}
  return {mode:'group',shapes:group.querySelectorAll('path,rect,circle,ellipse,polygon,polyline,line').length};
}
export function importTraceSvg(markup,name='trace.svg',dimensions={}){
  const safe=sanitizeVectorSvg(markup,dimensions);
  if(canvasIsEmpty()){
    // New document: Hector's native adoption keeps gradient defs, original path geometry,
    // transforms, per-path color and multi-contour path 'd' unmodified.
    mountStageFromText(safe,name.replace(/\.[^.]+$/,'')+'-vector.svg');
    const shapes=editor.stage.querySelectorAll('path,rect,circle,ellipse,polygon,polyline,line:not(.hv-overlay *)').length;
    return {mode:'new',shapes};
  }
  return placeWithDefs(safe,name);
}
