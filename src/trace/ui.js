import {traceImage,TRACE_DEFAULTS} from './client.js';
import {importTraceSvg} from './import.js';
import {normalizePickedImage,blobDataUrl,MAX_FILE_BYTES} from './preprocess.js';

export function installTraceUI({setStatus,downloadCurrentSvg}){
  const launch=document.querySelector('#studio-trace-button');
  const canvas=document.querySelector('#studio-canvas-button');
  const dialog=document.querySelector('#studio-trace-dialog');
  const upload=dialog.querySelector('#studio-trace-file');
  const pick=dialog.querySelector('#studio-trace-pick');
  const start=dialog.querySelector('#studio-trace-run');
  const stop=dialog.querySelector('#studio-trace-cancel');
  const close=dialog.querySelector('#studio-trace-close');
  const status=dialog.querySelector('#studio-trace-status');
  const preview=dialog.querySelector('#studio-trace-original');
  const detail=dialog.querySelector('#studio-trace-detail');
  const smooth=dialog.querySelector('#studio-trace-smooth');
  const noise=dialog.querySelector('#studio-trace-noise');
  const challenge=dialog.querySelector('#studio-trace-challenge');
  let file=null,controller=null,previewURL=null,siteKey=null,widget=null,seq=0,widgetLoading=null;
  let loadingFile=false,fileSeq=0;
  const say=(s)=>{status.textContent=s;};
  const update=()=>{const busy=!!controller;pick.disabled=busy||loadingFile;start.disabled=busy||loadingFile||!file;
    stop.hidden=!busy;start.hidden=busy;detail.disabled=smooth.disabled=noise.disabled=busy||loadingFile;};
  const safeExit=()=>{
    seq++;fileSeq++;loadingFile=false;
    if(controller){controller.abort();controller=null;}
    if(previewURL){URL.revokeObjectURL(previewURL);previewURL=null;}
    preview.onload=null;preview.onerror=null;preview.removeAttribute('src');preview.hidden=true;file=null;upload.value='';
    if(widget!==null&&window.turnstile){window.turnstile.remove(widget);widget=null;}
    challenge.replaceChildren();dialog.hidden=true;update();
  };
  close.addEventListener('click',safeExit);
  dialog.addEventListener('click',e=>{if(e.target===dialog)safeExit();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!dialog.hidden){e.stopPropagation();safeExit();}});
  function open(){
    if(!dialog.hidden)return;
    dialog.hidden=false;update();
    say('Pilih gambar. Setelah trace selesai, hasil langsung masuk ke canvas.');
    pick.focus();
    fetch('/api/trace',{cache:'no-store'}).then(r=>r.json()).then(x=>{
      if(dialog.hidden)return;
      siteKey=x.siteKey||null;
      if(x.colorEnabled===false){say('Endpoint Trace sementara dinonaktifkan.');start.disabled=true;}
      if(siteKey)setupCaptcha().catch(()=>say('CAPTCHA belum dapat dimuat. Periksa koneksi.'));
    }).catch(()=>{/* GET status is best-effort. POST surfaces the actual error. */});
  }
  canvas.addEventListener('click',()=>{if(!dialog.hidden)safeExit();document.querySelector('.stage-wrap')?.focus?.();});
  launch.addEventListener('click',open);
  pick.addEventListener('click',()=>upload.click());
  async function setupCaptcha(){
    if(window.turnstile){renderCaptcha();return;}
    if(!widgetLoading){widgetLoading=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.onload=resolve;script.onerror=()=>{widgetLoading=null;reject(new Error('Turnstile gagal.'));};
      document.head.appendChild(script);
    });}
    await widgetLoading;if(!dialog.hidden)renderCaptcha();
  }
  function renderCaptcha(){
    if(!siteKey||widget!==null||dialog.hidden)return;
    widget=window.turnstile.render(challenge,{sitekey:siteKey,theme:'dark'});
  }
  const readOptions=()=>{
    const d=Number(detail.value),s=Number(smooth.value),n=Number(noise.value);
    return {...TRACE_DEFAULTS,speckleSize:n,colorPrecision:d,pathPrecision:Math.min(20,d+2),
      cornerThreshold:Math.round(130-s),segmentLength:Math.max(1,Math.round(7-s/35)),
      spliceThreshold:Math.round(30+s*.214)};
  };
  async function execute(){
    if(!file||controller)return;
    if(siteKey && widget===null){say('Verifikasi CAPTCHA belum siap.');return;}
    const t=siteKey?window.turnstile?.getResponse(widget):'';
    if(siteKey&&!t){say('Selesaikan CAPTCHA, lalu ulangi.');return;}
    const id=++seq;controller=new AbortController();update();
    try{
      const result=await traceImage(file,{options:readOptions(),turnstileToken:t||'',
        signal:controller.signal,onPhase:s=>{if(seq===id)say(s);}});
      if(seq!==id||controller.signal.aborted)return;
      say('Membuka SVG sebagai objek vektor…');
      const imported=importTraceSvg(result.svg,file.name,result.meta);
      const message=`Vector Ink berhasil: ${imported.shapes} objek vektor. `+
        (imported.mode==='group'?'Pilih Ungroup untuk mengedit jalur di dalam grup.':'Pilih Node Tool untuk mengedit titik.');
      safeExit();setStatus(message,6500);
      document.dispatchEvent(new CustomEvent('vector-studio:trace-complete',{detail:{...imported,provider:result.source}}));
    }catch(err){
      if(seq!==id)return;
      if(err.name!=='AbortError')say('Gagal: '+err.message);
      if(siteKey&&widget!==null&&window.turnstile)window.turnstile.reset(widget);
    }finally{if(seq===id){controller=null;update();}}
  }
  start.addEventListener('click',execute);
  stop.addEventListener('click',()=>{
    if(controller){seq++;controller.abort();controller=null;update();say('Dibatalkan. File tetap dipilih.');}
  });
  upload.addEventListener('change',async()=>{
    const selected=upload.files?.[0];if(!selected)return;
    const chosen=++fileSeq;
    if(selected.size>MAX_FILE_BYTES){
      file=null;say('Gagal: Gambar maksimal 12 MB.');update();return;
    }
    loadingFile=true;file=null;update();
    if(previewURL){URL.revokeObjectURL(previewURL);previewURL=null;}
    preview.onload=null;preview.onerror=null;preview.removeAttribute('src');preview.hidden=true;
    say('Membaca file dari penyimpanan Android…');
    try{
      // Copy the bytes immediately. Android content-provider Files can become
      // unreadable after the picker callback even though name/type still exist.
      const normalized=await normalizePickedImage(selected);
      if(chosen!==fileSeq||dialog.hidden)return;
      file=normalized;
      preview.hidden=false;
      try{
        previewURL=URL.createObjectURL(normalized);
        preview.onerror=async()=>{
          if(file!==normalized||dialog.hidden)return;
          preview.onerror=null;
          if(previewURL){URL.revokeObjectURL(previewURL);previewURL=null;}
          try{preview.src=await blobDataUrl(normalized);}
          catch{say('Gambar terbaca, tetapi pratinjau Android gagal. Trace masih bisa dicoba.');}
        };
        preview.src=previewURL;
      }catch{
        preview.src=await blobDataUrl(normalized);
      }
      say(`Siap: ${normalized.name||selected.name} · ${normalized.type}. Tekan Trace Image untuk mulai.`);
    }catch(err){
      if(chosen===fileSeq){file=null;say('Gagal: '+(err?.message||'File gambar tidak dapat dibaca.'));}
    }finally{
      if(chosen===fileSeq){loadingFile=false;update();}
    }
  });
  window.vectorStudio={openTrace:open,closeTrace:safeExit,traceFile:file=>{
    // Small testing/automation seam; no bypass of sanitizer or actual network handler.
    const transfer=new DataTransfer();transfer.items.add(file);upload.files=transfer.files;
    upload.dispatchEvent(new Event('change'));
    return execute();
  },download:downloadCurrentSvg};
}
