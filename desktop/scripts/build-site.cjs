'use strict';
// Build a fully local-dependency PWA from the same source as the desktop app.
// Run after: npm run build:offline
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const dist=path.resolve(__dirname,'../dist');
const file=path.join(dist,'app-v2.js');
if(!fs.existsSync(file))throw Error('Run build:offline first');
let source=fs.readFileSync(file,'utf8');
const version=crypto.createHash('sha256').update(source).digest('hex').slice(0,12);
source+='\nif ("serviceWorker" in navigator) { addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(console.error)); }\n';
fs.writeFileSync(file,source);
const precache=['./','./index.html','./style.css','./app-v2.js','./manifest.webmanifest','./icon.svg','./vendor/pdfjs/build/pdf.min.mjs','./vendor/pdfjs/build/pdf.worker.min.mjs','./vendor/pdf-lib.esm.js'];
const sw=`const CACHE="pdf-athat-offline-${version}";
const SHELL=${JSON.stringify(precache)};
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('pdf-athat-')&&k!==CACHE).map(k=>caches.delete(k)))),self.clients.claim()])));
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET')return;
 const u=new URL(e.request.url);
 if(u.origin!==self.location.origin)return;
 e.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  const cached=await cache.match(e.request);
  if(cached)return cached;
  try{
   const response=await fetch(e.request);
   if(response.ok)cache.put(e.request,response.clone()).catch(()=>{});
   return response;
  }catch(err){
   if(e.request.mode==='navigate')return await cache.match('./index.html')||Response.error();
   return Response.error();
  }
 })());
});`;
fs.writeFileSync(path.join(dist,'sw.js'),sw);
const bundled=fs.readFileSync(file,'utf8');
if(bundled.includes('cdn.jsdelivr.net'))throw Error('Unexpected CDN reference');
console.log('Offline-ready website PWA built. Cache version:',version);
