// Remove active/external SVG content. Keep geometry, nested groups and gradient defs
// so paths survive as actual edit-friendly Hector Vector objects.
const NS='http://www.w3.org/2000/svg';
const TAGS=new Set(['svg','g','path','rect','circle','ellipse','polygon','polyline','line','defs',
  'lineargradient','radialgradient','stop','clippath','mask','title','desc']);
const ATTRS=new Set(['id','viewbox','width','height','x','y','x1','x2','y1','y2','cx','cy','r','rx','ry',
 'd','points','transform','fill','fill-opacity','fill-rule','stroke','stroke-width','stroke-opacity',
 'stroke-linecap','stroke-linejoin','stroke-dasharray','stroke-dashoffset','stroke-miterlimit','opacity',
 'clip-path','clip-rule','mask','offset','stop-color','stop-opacity','gradientunits','gradienttransform',
 'spreadmethod','preserveaspectratio','color','display','visibility','href','xlink:href','style']);
const STYLES=new Set(['fill','fill-opacity','fill-rule','stroke','stroke-width','stroke-opacity',
 'stroke-linecap','stroke-linejoin','stroke-dasharray','stroke-dashoffset','opacity','stop-color',
 'stop-opacity','color','clip-path','mask','display','visibility']);
const localUrl=/^url\(\s*['"]?#[a-zA-Z_][\w:.-]*['"]?\s*\)$/i;
function safeValue(v){
  if(/@import|expression\s*\(|javascript\s*:|data\s*:|[<>]/i.test(v))return false;
  const urls=v.match(/url\s*\([^)]*\)/ig)||[];
  return urls.every(x=>localUrl.test(x));
}
function safeStyle(value){
  return value.split(';').map(part=>{
    const i=part.indexOf(':');if(i<1)return null;
    const prop=part.slice(0,i).trim().toLowerCase(),v=part.slice(i+1).trim();
    return STYLES.has(prop)&&safeValue(v)?`${prop}:${v}`:null;
  }).filter(Boolean).join(';');
}
export function sanitizeVectorSvg(svgText,dimensions={}){
  if(typeof svgText!=='string'||svgText.length>3_800_000)throw new Error('SVG terlalu besar.');
  const doc=new DOMParser().parseFromString(svgText,'image/svg+xml');
  if(doc.querySelector('parsererror')||doc.documentElement.localName!=='svg'||doc.documentElement.namespaceURI!==NS)
    throw new Error('Vector Ink mengembalikan SVG tidak valid.');
  const root=doc.documentElement;
  function clean(node){
    if(node.namespaceURI!==NS || !TAGS.has(node.localName.toLowerCase())){node.remove();return;}
    for(const a of [...node.attributes]){
      const key=a.name.toLowerCase(),val=a.value.trim();
      if(!ATTRS.has(key)||key.startsWith('on')||!safeValue(val)) {node.removeAttribute(a.name);continue;}
      if((key==='href'||key==='xlink:href')&&!/^#[A-Za-z_][\w:.-]*$/.test(val))node.removeAttribute(a.name);
      if(key==='style'){
        const style=safeStyle(val);if(style)node.setAttribute(a.name,style);else node.removeAttribute(a.name);
      }
    }
    for(const child of [...node.children])clean(child);
  }
  clean(root);
  let vb=root.getAttribute('viewBox');
  const w=Number.parseFloat(root.getAttribute('width'))||dimensions.width;
  const h=Number.parseFloat(root.getAttribute('height'))||dimensions.height;
  if(!vb && w>0 && h>0){vb=`0 0 ${w} ${h}`;root.setAttribute('viewBox',vb);}
  if(!vb || vb.trim().split(/[\s,]+/).map(Number).length!==4)
    throw new Error('SVG tidak memiliki ukuran valid.');
  if(!root.querySelector('path,rect,circle,ellipse,polygon,polyline,line'))
    throw new Error('Trace tidak menghasilkan jalur vektor yang bisa diedit.');
  root.setAttribute('xmlns',NS);
  return new XMLSerializer().serializeToString(root);
}
