// Vector Studio — self-contained Netlify Function.
// Same Vector Ink wire contract and trace option defaults as Nexora V1.
// This does not call Nexora V1, and it does not need V1's tokens or hosting.
const VECTOR_INK_TRACE_URL = 'https://us-central1-vector-ink.cloudfunctions.net/traceImageController';
const MAX_BASE64_CHARS = 3_250_000;
const MAX_SVG_CHARS = 3_800_000;
const MAX_REQUEST_BYTES = 3_600_000;
const DEFAULTS = Object.freeze({
  speckleSize:14, colorPrecision:6, cornerThreshold:60, segmentLength:5,
  spliceThreshold:45, maxIterations:6, pathPrecision:8
});

function response(status, body) {
  return Response.json(body, {status, headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
const enabled = (env) => !['0','false','no','off'].includes(String(env.TRACE_ENABLED ?? 'true').toLowerCase());
const optionsOf = (raw) => {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const ranges = {speckleSize:[0,100],colorPrecision:[1,20],cornerThreshold:[0,180],
    segmentLength:[1,100],spliceThreshold:[0,180],maxIterations:[1,20],pathPrecision:[1,20]};
  return Object.fromEntries(Object.keys(DEFAULTS).map(k => {
    const n=Number(o[k]), [min,max]=ranges[k];
    return [k, Number.isFinite(n) ? Math.round(Math.max(min,Math.min(max,n))) : DEFAULTS[k]];
  }));
};
function validateImage(base64) {
  if (typeof base64 !== 'string' || !base64) return 'EMPTY_IMAGE';
  if (base64.length>MAX_BASE64_CHARS) return 'PAYLOAD_TOO_LARGE';
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length%4===1) return 'INVALID_IMAGE';
  const raw=Buffer.from(base64.slice(0,64),'base64');
  const png=raw.length>=8 && raw.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg=raw.length>=3 && raw[0]===255 && raw[1]===216 && raw[2]===255;
  const webp=raw.length>=12 && raw.toString('ascii',0,4)==='RIFF' && raw.toString('ascii',8,12)==='WEBP';
  return png||jpeg||webp ? null : 'UNSUPPORTED_IMAGE';
}
function validSvg(svg) {
  return typeof svg === 'string' && svg.length>0 && svg.length<=MAX_SVG_CHARS &&
    /^\s*<svg(?:\s|>)/i.test(svg) && /<\s*(?:path|rect|circle|ellipse|polygon|polyline|line|g)(?:\s|>|\/)/i.test(svg) &&
    !/<\s*(?:script|foreignobject|iframe|image|object|embed)\b/i.test(svg) &&
    !/\bon[a-z]+\s*=|javascript\s*:|data\s*:/i.test(svg);
}
async function boundedJSON(request) {
  if(Number(request.headers.get('content-length')||0)>MAX_REQUEST_BYTES) return null;
  if(!request.body) return {};
  const reader=request.body.getReader();let bytes=0;let chunks=[];
  try {
    while(true) { const {done,value}=await reader.read();if(done)break;
      bytes+=value.byteLength;
      if(bytes>MAX_REQUEST_BYTES){await reader.cancel();return null;}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  const all=Buffer.concat(chunks.map(c=>Buffer.from(c)),bytes);
  return JSON.parse(all.toString('utf8'));
}
async function verifyTurnstile(token,secret,ip,fetcher){
  if(typeof token!=='string'||!token||token.length>2048)return false;
  const form=new URLSearchParams({secret,response:token});
  if(ip)form.set('remoteip',ip);
  try{
    const r=await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify',{
      method:'POST',body:form,signal:AbortSignal.timeout(8000)});
    const d=await r.json();return r.ok && d.success===true;
  }catch{return false;}
}
async function askProvider(payload,fetcher,timeoutMs) {
  let r;
  try {r=await fetcher(VECTOR_INK_TRACE_URL,{
    method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},
    body:JSON.stringify({data:payload}),signal:AbortSignal.timeout(timeoutMs)
  });}
  catch(e){let err=new Error(e?.name==='TimeoutError'||e?.name==='AbortError'?'PROVIDER_TIMEOUT':'PROVIDER_UNAVAILABLE');err.transient=true;throw err;}
  if(r.status===401||r.status===403){throw new Error('PROVIDER_UNAVAILABLE');}
  let data={};try{data=await r.json();}catch{throw new Error('PROVIDER_INVALID_RESPONSE');}
  if(!r.ok){
    let e=new Error(r.status===400?'INVALID_TRACE_OPTIONS':'PROVIDER_UNAVAILABLE');
    e.transient=r.status>=500;throw e;
  }
  if(data?.error){
    const code=String(data.error.code||data.error.status||'').toUpperCase();
    if(/UNAUTHENTICATED|PERMISSION_DENIED|FORBIDDEN/.test(code))throw new Error('PROVIDER_UNAVAILABLE');
    throw new Error('PROVIDER_INVALID_RESPONSE');
  }
  if(!validSvg(data?.result))throw new Error('PROVIDER_INVALID_RESPONSE');
  return data.result.trim();
}
export function makeHandler(env=process.env,fetcher=globalThis.fetch){
  return async function handler(request,context={}){
    if(request.method==='GET')return response(200,{ok:true,service:'vector-studio-trace',colorEnabled:enabled(env),
      siteKey:env.TRACE_TURNSTILE_SITE_KEY&&env.TRACE_TURNSTILE_SECRET?env.TRACE_TURNSTILE_SITE_KEY:null});
    if(request.method==='HEAD')return new Response(null,{status:204,headers:{'Cache-Control':'no-store'}});
    if(request.method!=='POST')return response(405,{ok:false,error:'METHOD_NOT_ALLOWED'});
    // Browsers must call from this site's own domain. No permissive CORS headers.
    const origin=request.headers.get('origin');
    if(origin!==new URL(request.url).origin || request.headers.get('sec-fetch-site')==='cross-site')
      return response(403,{ok:false,error:'ORIGIN_NOT_ALLOWED'});
    if(!enabled(env))return response(503,{ok:false,error:'COLOR_PROVIDER_DISABLED'});
    if(!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('content-type')||''))
      return response(415,{ok:false,error:'INVALID_CONTENT_TYPE'});
    let body;
    try{body=await boundedJSON(request);}catch{return response(400,{ok:false,error:'INVALID_JSON'});}
    if(body===null)return response(413,{ok:false,error:'PAYLOAD_TOO_LARGE'});
    if(!body || typeof body!=='object' || body.action!=='color-trace')return response(400,{ok:false,error:'INVALID_ACTION'});
    const bad=validateImage(body.image);
    if(bad)return response(bad==='PAYLOAD_TOO_LARGE'?413:400,{ok:false,error:bad});
    // Optional turnstile; set BOTH variables to require proof for every public trace.
    if(Boolean(env.TRACE_TURNSTILE_SITE_KEY)!==Boolean(env.TRACE_TURNSTILE_SECRET))
      return response(503,{ok:false,error:'TURNSTILE_MISCONFIGURED'});
    if(env.TRACE_TURNSTILE_SECRET && !await verifyTurnstile(body.turnstileToken,env.TRACE_TURNSTILE_SECRET,context.ip,fetcher))
      return response(403,{ok:false,error:'CAPTCHA_FAILED'});
    const payload={image:body.image,...optionsOf(body.options)};
    try {
      let svg;
      try{svg=await askProvider(payload,fetcher,35000);}
      catch(e){if(!e.transient)throw e;svg=await askProvider(payload,fetcher,14000);}
      return response(200,{ok:true,svg,provider:'vector-ink',mode:'color',metadata:{options:optionsOf(body.options)}});
    }catch(e){
      const code=['PROVIDER_TIMEOUT','INVALID_TRACE_OPTIONS','PROVIDER_INVALID_RESPONSE'].includes(e.message)?e.message:'PROVIDER_UNAVAILABLE';
      return response(code==='PROVIDER_TIMEOUT'?504:code==='INVALID_TRACE_OPTIONS'?422:502,{
        ok:false,error:code,message:code==='PROVIDER_UNAVAILABLE'?'Vector Ink gagal dihubungi. Coba lagi nanti.':code});
    }
  };
}
export default async function handler(request,context){return makeHandler()(request,context);}
export const config={path:'/api/trace',rateLimit:{windowLimit:8,windowSize:60,aggregateBy:['ip','domain']}};
