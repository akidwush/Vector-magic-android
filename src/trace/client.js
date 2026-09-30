import {preprocessForVectorInk} from './preprocess.js';
export const TRACE_DEFAULTS=Object.freeze({
  speckleSize:14,colorPrecision:6,cornerThreshold:60,segmentLength:5,
  spliceThreshold:45,maxIterations:6,pathPrecision:8
});
export async function traceImage(file,{options={},turnstileToken='',signal,onPhase=()=>{}}={}){
  onPhase('Menyiapkan gambar seperti NEXORA V1…');
  const processed=await preprocessForVectorInk(file,signal);
  onPhase(`Mengirim ${processed.width} × ${processed.height} ke Vector Ink…`);
  const r=await fetch('/api/trace',{
    method:'POST',credentials:'same-origin',cache:'no-store',signal,
    headers:{'Content-Type':'application/json','Accept':'application/json'},
    body:JSON.stringify({action:'color-trace',image:processed.base64,
      options:{...TRACE_DEFAULTS,...options},turnstileToken})
  });
  const data=await r.json().catch(()=>({}));
  processed.base64='';
  if(!r.ok||data.ok!==true||typeof data.svg!=='string'){
    const codes={ORIGIN_NOT_ALLOWED:'Permintaan ditolak: domain berbeda.',CAPTCHA_FAILED:'CAPTCHA gagal. Ulangi verifikasi.',
      RATE_LIMITED:'Terlalu banyak percobaan. Coba lagi sebentar.',PROVIDER_TIMEOUT:'Vector Ink kehabisan waktu.',
      PROVIDER_UNAVAILABLE:'Vector Ink tidak tersedia. Jangan ulangi terus-menerus.',
      COLOR_PROVIDER_DISABLED:'Trace sedang dinonaktifkan pemilik situs.'};
    throw new Error(codes[data.error]||data.message||`Trace gagal (HTTP ${r.status}).`);
  }
  return {svg:data.svg,meta:processed,source:data.provider};
}
