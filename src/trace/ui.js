import {traceImage,TRACE_DEFAULTS} from './client.js';
import {importTraceSvg} from './import.js';

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
  const say=(s)=>{status.textContent=s;};
  const update=()=>{const busy=!!controller;pick.disabled=busy;start.disabled=busy||!file;
    stop.hidden=!busy;start.hidden=busy;detail.disabled=smooth.disabled=noise.disabled=busy;};
  const safeExit=()=>{
    seq++;
    if(controller){controller.abort();controller=null;}
    if(previewURL){URL.revokeObjectURL(previewURL);previewURL=null;}
    preview.removeAttribute('src');preview.hidden=true;file=null;upload.value='';
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
    if(!['image/png','image/jpeg','image/webp'].includes(selected.type)||selected.size>12*1024*1024){
      say('Pilih PNG/JPG/WebP dengan ukuran maksimal 12 MB.');return;
    }
    file=selected;
    if(previewURL)URL.revokeObjectURL(previewURL);
    previewURL=URL.createObjectURL(selected);preview.src=previewURL;preview.hidden=false;
    say(`Siap: ${selected.name}. Tekan Trace Image untuk mulai.`);update();
  });
  window.vectorStudio={openTrace:open,closeTrace:safeExit,traceFile:file=>{
    // Small testing/automation seam; no bypass of sanitizer or actual network handler.
    const transfer=new DataTransfer();transfer.items.add(file);upload.files=transfer.files;
    upload.dispatchEvent(new Event('change'));
    return execute();
  },download:downloadCurrentSvg};
}
