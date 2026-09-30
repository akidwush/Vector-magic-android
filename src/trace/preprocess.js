// Preserves Nexora V1's color preprocessing and retry bounds; no fake upscaling.
export const MAX_FILE_BYTES=12*1024*1024;
export const ACCEPTED_MIME=new Set(['image/png','image/jpeg','image/webp']);
const MAX_BLOB=2050*1024;
const isCancelled=(signal)=>{if(signal?.aborted)throw new DOMException('Trace dibatalkan.','AbortError');};
const toBlob=(canvas,type,quality)=>new Promise((resolve,reject)=>{
  canvas.toBlob(b=>b?resolve(b):reject(new Error('Gagal menyiapkan file gambar.')),type,quality);
});
export const toBase64=(blob)=>new Promise((resolve,reject)=>{
  const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');
  reader.onerror=()=>reject(new Error('Gagal membaca Base64 gambar.'));
  reader.readAsDataURL(blob);
});
async function openImage(file){
  if(typeof createImageBitmap==='function'){
    try{let b=await createImageBitmap(file);if(b.width&&b.height){let closed=false;return {bitmap:b,dispose:()=>{if(!closed){closed=true;b.close();}}};}
      b.close();}catch{} // Android: HTMLImageElement decoder may still succeed.
  }
  const url=URL.createObjectURL(file);
  try{const img=await new Promise((res,rej)=>{const im=new Image();im.onload=()=>res(im);im.onerror=()=>rej(new Error('Gambar tidak dapat dibuka.'));im.src=url;});
    let released=false;
    return {bitmap:img,dispose:()=>{if(!released){released=true;URL.revokeObjectURL(url);}}};
  }catch(e){URL.revokeObjectURL(url);throw e;}
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
    // V1 preserves alpha where possible; no unconditional JPEG white-matte conversion.
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
export async function preprocessForVectorInk(file,signal){
  if(!file||!ACCEPTED_MIME.has(file.type))throw new Error('Hanya PNG, JPG, dan WebP yang didukung.');
  if(file.size>MAX_FILE_BYTES)throw new Error('Gambar maksimal 12 MB.');
  try{return await attempt(file,1600,2_200_000,signal);}
  catch(first){if(first?.name==='AbortError')throw first;isCancelled(signal);return attempt(file,960,650_000,signal);}
}
