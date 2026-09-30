import assert from 'node:assert/strict';
import {makeHandler,config} from '../netlify/functions/trace.mjs';
assert.equal(config.path,'/api/trace');
assert.equal(config.rateLimit.windowLimit,8);
const png=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]).toString('base64');
const req=(body,origin='https://vector.test')=>new Request('https://vector.test/api/trace',{
 method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)
});
const off=makeHandler({TRACE_ENABLED:'false'},async()=>{throw Error('must not fetch')});
assert.equal((await off(req({action:'color-trace',image:png}))).status,503);
const status=await (await makeHandler({})(new Request('https://vector.test/api/trace'))).json();
assert.equal(status.ok,true);assert.equal(status.colorEnabled,true);assert.equal(status.siteKey,null);
let calls=0;
const verified=makeHandler({},async(url,options)=>{
 calls++;
 assert.equal(url,'https://us-central1-vector-ink.cloudfunctions.net/traceImageController');
 assert.equal(options.method,'POST');
 assert.equal(options.headers['Content-Type'],'application/json');
 const payload=JSON.parse(options.body);
 assert.equal(payload.data.image,png);
 assert.deepEqual(Object.keys(payload),['data']);
 assert.deepEqual({...payload.data,image:''},{image:'',speckleSize:14,colorPrecision:8,cornerThreshold:60,segmentLength:5,
  spliceThreshold:45,maxIterations:6,pathPrecision:8});
 return Response.json({result:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><path d="M0 0L2 2"/></svg>'});
});
let result=await verified(req({action:'color-trace',image:png,options:{colorPrecision:8}}));
assert.equal(result.status,200);assert.match((await result.json()).svg,/<path/);assert.equal(calls,1);
result=await verified(req({action:'color-trace',image:png},'https://evil.test'));assert.equal(result.status,403);
result=await verified(req({action:'color-trace',image:'abc'}));assert.equal(result.status,400);
result=await verified(req({action:'wrong',image:png}));assert.equal(result.status,400);
let tries=0;
const retry=makeHandler({},async()=>{
 tries++;
 if(tries===1)return Response.json({error:{message:'temporary'}},{status:502});
 return Response.json({result:'<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L2 2"/></svg>'});
});
result=await retry(req({action:'color-trace',image:png}));assert.equal(result.status,200);assert.equal(tries,2);
const denied=makeHandler({},async()=>Response.json({error:{status:'PERMISSION_DENIED'}},{status:403}));
result=await denied(req({action:'color-trace',image:png}));assert.equal(result.status,502);
let captcha=0;
const secured=makeHandler({TRACE_TURNSTILE_SITE_KEY:'site-test',TRACE_TURNSTILE_SECRET:'secret-test'},async(url,opts)=>{
 if(url.includes('siteverify')){
  captcha++;assert.equal(opts.body.get('secret'),'secret-test');
  assert.equal(opts.body.get('remoteip'),'192.0.2.44');
  return Response.json({success:true});
 }
 return Response.json({result:'<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L2 2"/></svg>'});
});
result=await secured(req({action:'color-trace',image:png,turnstileToken:'token'}),{ip:'192.0.2.44'});
assert.equal(result.status,200);assert.equal(captcha,1);
result=await secured(req({action:'color-trace',image:png}));assert.equal(result.status,403);
console.log('PASS: V1 request contract, success, disabled, validation, same-origin, transient retry, 403 mapping, optional Turnstile, Netlify route');
