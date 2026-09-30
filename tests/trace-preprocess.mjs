import assert from 'node:assert/strict';
import {preprocessForVectorInk} from '../src/trace/preprocess.js';
const magic=Buffer.from([137,80,78,71,13,10,26,10,0]);
let closed=0,dimensions=[],mime=[];
globalThis.createImageBitmap=async()=>({width:2000,height:2000,close:()=>{closed++;}});
globalThis.document={createElement(name){assert.equal(name,'canvas');let canvas={width:0,height:0,
  getContext(){return {drawImage(){dimensions.push([canvas.width,canvas.height]);}};},
  toBlob(fn,type){mime.push(type);fn(new Blob([magic],{type}));}};return canvas;}};
globalThis.FileReader=class {
 readAsDataURL(b){b.arrayBuffer().then(v=>{this.result='data:'+b.type+';base64,'+Buffer.from(v).toString('base64');this.onload();});}
};
const file={type:'image/png',size:200_000};
const r=await preprocessForVectorInk(file);
assert.ok(r.width<=1600 && r.height<=1600 && r.width*r.height<=2_200_000);
assert.equal(r.mime,'image/png');
assert.match(r.base64,/^[A-Za-z0-9+/]+=*$/);
assert.equal(closed,1);assert.equal(mime[0],'image/png');
let failed=false;
try{await preprocessForVectorInk({type:'application/pdf',size:100});}catch{failed=true;}
assert.equal(failed,true);
failed=false;try{await preprocessForVectorInk({type:'image/png',size:13*1024*1024});}catch{failed=true;}
assert.equal(failed,true);
console.log('PASS V1-style image bounds, alpha-preserving PNG, magic-byte Base64, cleanup and input checks');
