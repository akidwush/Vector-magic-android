import assert from 'node:assert/strict';
import {
  preprocessForVectorInk,normalizePickedImage,detectRasterMime
} from '../src/trace/preprocess.js';

const png=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0,73,72,68,82]);
let closed=0,dimensions=[],mime=[];
globalThis.createImageBitmap=async()=>({width:2000,height:2000,close:()=>{closed++;}});
globalThis.document={createElement(name){assert.equal(name,'canvas');let canvas={width:0,height:0,
  getContext(){return {drawImage(){dimensions.push([canvas.width,canvas.height]);}};},
  toBlob(fn,type){mime.push(type);fn(new Blob([png],{type}));}};return canvas;}};
globalThis.FileReader=class {
  readAsDataURL(b){b.arrayBuffer().then(v=>{this.result='data:'+b.type+';base64,'+Buffer.from(v).toString('base64');this.onload();},e=>{this.error=e;this.onerror();});}
  readAsArrayBuffer(b){b.arrayBuffer().then(v=>{this.result=v;this.onload();},e=>{this.error=e;this.onerror();});}
};
function namedBlob(bytes,type='application/octet-stream',name='picked-image'){
  const b=new Blob([bytes],{type});
  Object.defineProperty(b,'name',{value:name,configurable:true});
  Object.defineProperty(b,'lastModified',{value:1,configurable:true});
  return b;
}

assert.equal(detectRasterMime(png),'image/png');
assert.equal(detectRasterMime(Buffer.from([255,216,255,0])),'image/jpeg');
assert.equal(detectRasterMime(Buffer.from('RIFFxxxxWEBP','ascii')),'image/webp');

const picked=namedBlob(Buffer.concat([png,Buffer.alloc(64)]),'image/jpeg','android-photo.jpg');
const normalized=await normalizePickedImage(picked);
assert.equal(normalized.type,'image/png','magic bytes must win over misleading Android MIME');
assert.equal(normalized.name,'android-photo.jpg');

const r=await preprocessForVectorInk(normalized);
assert.ok(r.width<=1600 && r.height<=1600 && r.width*r.height<=2_200_000);
assert.equal(r.mime,'image/png');
assert.match(r.base64,/^[A-Za-z0-9+/]+=*$/);
assert.equal(closed,1);
assert.equal(mime[0],'image/png');

await assert.rejects(()=>normalizePickedImage(namedBlob(Buffer.from('ftypheic-not-png'),'image/jpeg','fake.jpg')),
  /Format asli file bukan PNG/);
await assert.rejects(()=>normalizePickedImage(namedBlob(Buffer.alloc(0),'image/png','empty.png')),
  /kosong/);
await assert.rejects(()=>normalizePickedImage({size:13*1024*1024,name:'huge.png',arrayBuffer:async()=>new ArrayBuffer(0)}),
  /maksimal 12 MB/);

console.log('PASS Android byte detachment, magic MIME detection, V1 bounds, PNG alpha path and invalid-file diagnostics');
