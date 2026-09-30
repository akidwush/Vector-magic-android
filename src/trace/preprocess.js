// Preserves Nexora V1's color preprocessing and retry bounds; no fake upscaling.
export const MAX_FILE_BYTES=12*1024*1024;
export const ACCEPTED_MIME=new Set(['image/png','image/jpeg','image/webp']);
const MAX_BLOB=2050*1024;
const NORMALIZED=new WeakSet();
const isCancelled=(signal)=>{if(signal?.aborted)throw new DOMException('Trace dibatalkan.','AbortError');};

const readWithFileReader=(blob)=>new Promise((resolve,reject)=>{
  const reader=new FileReader();
  reader.onload=()=>resolve(reader.result);
  reader.onerror=()=>reject(reader.error||new Error('File gambar tidak dapat dibaca.'));
  reader.readAsArrayBuffer(blob);
});
const readBuffer=async(blob)=>{
  if(blob && typeof blob.arrayBuffer==='function'){
    try{return await blob.arrayBuffer();}
    catch{/* Android content providers occasionally recover through FileReader. */}
  }
  return readWithFileReader(blob);
};
const dataUrl=(blob)=>new Promise((resolve,reject)=>{
  const reader=new FileReader();
  reader.onload=()=>resolve(String(reader.result||''));
  reader.onerror=()=>reject(reader.error||new Error('Gambar tidak dapat dibaca.'));
  reader.readAsDataURL(blob);
});
export const toBase64=(blob)=>dataUrl(blob).then(v=>v.split(',')[1]||'');
export const blobDataUrl=(blob)=>dataUrl(blob);

export function detectRasterMime(input){
  const b=input instanceof Uint8Array?input:new Uint8Array(input||0);
  if(b.length>=8 && b[0]===0x89&&b[1]===0x50&&b[2]===0x4e&&b[3]===0x47&&b[4]===0x0d&&b[5]===0x0a&&b[6]===0x1a&&b[7]===0x0a)return 'image/png';
  if(b.length>=3 && b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)return 'image/jpeg';
  if(b.length>=12 && String.fromCharCode(...b.slice(0,4))==='RIFF' && String.fromCharCode(...b.slice(8,12))==='WEBP')return 'image/webp';
  return '';
}
export async function normalizePickedImage(file){
  if(!file || typeof file.size!=='number')throw new Error('File gambar tidak valid.');
  if(file.size<=0)throw new Error('File gambar kosong atau belum selesai dibaca dari penyimpanan Android.');
  if(file.size>MAX_FILE_BYTES)throw new Error('Gambar maksimal 12 MB.');
  if(NORMALIZED.has(file))return file;
  let buffer;
  try{buffer=await readBuffer(file);}
  catch{throw new Error('Android tidak dapat membaca file ini. Simpan gambar ke penyimpanan lokal lalu pilih ulang.');}
  if(!buffer || !buffer.byteLength)throw new Error('File gambar kosong atau tidak dapat dibaca.');
  const mime=detectRasterMime(new Uint8Array(buffer,0,Math.min(16,buffer.byteLength)));
  if(!mime)throw new Error('Format asli file bukan PNG, JPG, atau WebP. HEIC/AVIF belum didukung.');
  const name=String(file.name||'image').trim()||'image';
  let normalized;
  try{
    normalized=typeof File==='function'
      ? new File([buffer],name,{type:mime,lastModified:Number(file.lastModified)||Date.now()})
      : new Blob([buffer],{type:mime});
  }catch{normalized=new Blob([buffer],{type:mime});}
  if(!('name' in normalized)){
    try{Object.defineProperty(normalized,'name',{value:name,configurable:true});}catch{}
  }
  NORMALIZED.add(normalized);
  return normalized;
}

const toBlob=(canvas,type,quality)=>new Promise((resolve,reject)=>{
  canvas.toBlob(b=>b?resolve(b):reject(new Error('Gagal menyiapkan file gambar.')),type,quality);
});
const imageFromSrc=(src)=>new Promise((resolve,reject)=>{
  const im=new Image();
  im.decoding='async';
  im.onload=()=>resolve(im);
  im.onerror=()=>reject(new Error('Gambar tidak dapat dibuka.'));
  im.src=src;
});
async function openImage(file){
  if(typeof createImageBitmap==='function'){
    try{
      let b=await createImageBitmap(file);
      if(b&&b.width>0&&b.height>0){
        let closed=false;
        return {bitmap:b,dispose:()=>{if(!closed){closed=true;b.close?.();}}};
      }
      b?.close?.();
    }catch{} // Android: continue with HTMLImageElement fallbacks.
  }
  let url='';
  try{
    url=URL.createObjectURL(file);
    const img=await imageFromSrc(url);
    let released=false;
    return {bitmap:img,dispose:()=>{if(!released){released=true;URL.revokeObjectURL(url);}}};
  }catch{
    if(url)URL.revokeObjectURL(url);
  }
  // Some Android content-provider/File implementations fail both createImageBitmap
  // and blob: decoding. A detached in-memory Blob + data URL is slower but reliable.
  try{
    const src=await blobDataUrl(file);
    const img=await imageFromSrc(src);
    return {bitmap:img,dispose:()=>{}};
  }catch{throw new Error('Gambar tidak dapat dibuka. Coba simpan ulang sebagai PNG/JPG/WebP lalu pilih lagi.');}
}
async function attempt(file,maxSide,maxPixels,signal){
  isCancelled(signal);
  const opened=await openImage(file);let canvas;
  try {
    const source=opened.bitmap, w=source.width||source.naturalWidth,h=source.height||source.naturalHeight;
    if(!(w>0&&h>0))throw new Error('Dimensi gambar tidak valid.');
    const s=Math.min(1,maxSide/Math.max(w,h),Math.sqrt(maxPixels/(w*h)));
    canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(w*s));canvas.height=Math.max(1,Math.round(h*s));
    const ctx=canvas.getContext('2d',{alpha:true});if(!ctx)throw new Error('Memori canvas Android tidak cukup.');
    ctx.drawImage(source,0,0,canvas.width,canvas.height);opened.dispose();
    isCancelled(signal);
    const transparent=file.type==='image/png'||file.type==='image/webp';
    const type=transparent?'image/png':'image/jpeg';const quality=.88;
    let blob=await toBlob(canvas,type,quality);
    for(let guard=0;blob.size>MAX_BLOB&&guard<4;guard++){
      isCancelled(signal);
      const ratio=Math.max(.68,Math.sqrt(MAX_BLOB/blob.size)*.94);
      const next=document.createElement('canvas');
      next.width=Math.max(1,Math.round(canvas.width*ratio));next.height=Math.max(1,Math.round(canvas.height*ratio));
      const nextCtx=next.getContext('2d',{alpha:true});if(!nextCtx)throw new Error('Memori tidak cukup.');
      nextCtx.drawImage(canvas,0,0,next.width,next.height);
      canvas.width=canvas.height=1;canvas=next;
      blob=await toBlob(canvas,type,quality);
    }
    if(blob.size>MAX_BLOB&&transparent)blob=await toBlob(canvas,'image/webp',.88);
    if(blob.size>MAX_BLOB)throw new Error('Gambar terlalu kompleks untuk endpoint.');
    isCancelled(signal);
    const base64=await toBase64(blob);
    if(base64.length>2_800_000)throw new Error('Payload trace terlalu besar.');
    return {base64,width:canvas.width,height:canvas.height,originalWidth:w,originalHeight:h,mime:blob.type,bytes:blob.size};
  } finally {opened.dispose();if(canvas)canvas.width=canvas.height=1;}
}
export async function preprocessForVectorInk(input,signal){
  const file=NORMALIZED.has(input)?input:await normalizePickedImage(input);
  if(!ACCEPTED_MIME.has(file.type))throw new Error('Hanya PNG, JPG, dan WebP yang didukung.');
  try{return await attempt(file,1600,2_200_000,signal);}
  catch(first){if(first?.name==='AbortError')throw first;isCancelled(signal);return attempt(file,960,650_000,signal);}
}
