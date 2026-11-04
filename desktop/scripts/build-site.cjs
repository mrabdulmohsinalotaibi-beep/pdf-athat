'use strict';
// Build a fully local-dependency PWA from the same source as the desktop app.
// Run after: npm run build:offline
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const dist=path.resolve(__dirname,'../dist');
const file=path.join(dist,'app-v2.js');
if(!fs.existsSync(file))throw Error('Run build:offline first');
let source=fs.readFileSync(file,'utf8');
const hash=crypto.createHash('sha256');for(const name of ['app-v2.js','account.js','index.html','style.css','icon.svg','manifest.webmanifest'])hash.update(fs.readFileSync(path.join(dist,name)));const version=hash.digest('hex').slice(0,12);
const htmlFile=path.join(dist,'index.html');
let html=fs.readFileSync(htmlFile,'utf8');
// Version the visual assets to bypass older service-worker caches on mobile devices.
// This affects only deployment output, not the offline desktop application.
for(const [fileName,attribute] of [['style.css','href'],['icon.svg','href'],['manifest.webmanifest','href'],['app-v2.js','src']]){
 const oldValue=attribute+'="./'+fileName+'"';
 if(!html.includes(oldValue))throw Error('Expected HTML reference missing: '+oldValue);
 html=html.replace(oldValue,attribute+'="./'+fileName+'?v='+version+'"');
}
fs.writeFileSync(htmlFile,html);

// build:offline removes the Electron-incompatible service-worker call, so the
// website registers its worker here instead of trying to replace it.
source += '\nif("serviceWorker" in navigator){let refreshing=false;navigator.serviceWorker.addEventListener("controllerchange",()=>{if(!refreshing&&!active){refreshing=true;location.reload()}else if(active)tell("تحديث جديد للموقع متاح؛ احفظ تعليقاتك ثم أعد فتح الصفحة")});navigator.serviceWorker.register("./sw.js",{updateViaCache:"none"}).then(reg=>reg.update()).catch(()=>{});}\n';
// Parse the final client module and guard the continuous-reader controls during deployment.
require('esbuild').transformSync(source,{loader:'js',format:'esm',target:'es2022'});
const htmlCheck=fs.readFileSync(htmlFile,'utf8');
for(const marker of ['id="continuousReader"','id="readerFab"','id="readerTopbar"','id="readerPageInfo"']){
 if(!htmlCheck.includes(marker))throw Error('Reader UI missing '+marker);
}
for(const marker of ['async function startContinuous()','async function renderContinuousPage(','async function setReaderEditing(']){
 if(!source.includes(marker))throw Error('Reader controller missing '+marker);
}
for(const marker of ['id="libraryPage"','id="librarySearch"','id="libraryFolders"','id="libraryCards"','id="libraryListView"','id="libraryGridView"','id="libraryDocDialog"','id="file3"']){
 if(!htmlCheck.includes(marker))throw Error('Library UI missing '+marker);
}
for(const marker of ['function showLibrary()','async function renderLibrary()','function openLibraryDocument(','function docDialog(','async function drawLibraryCovers()']){
 if(!source.includes(marker))throw Error('Library controller missing '+marker);
}

fs.writeFileSync(file,source);
const precache=['./','./index.html','./style.css','./app-v2.js','./account.js','./manifest.webmanifest','./icon.svg','./vendor/pdfjs/build/pdf.min.mjs','./vendor/pdfjs/build/pdf.worker.min.mjs','./vendor/pdf-lib.esm.js','./pdfium-adapter.js','./vendor/pdfium/pdfium.wasm','./style.css?v='+version,'./icon.svg?v='+version,'./app-v2.js?v='+version,'./account.js?v='+version,'./manifest.webmanifest?v='+version];
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
  const revalidate=e.request.mode==='navigate'||['/index.html','/style.css','/app-v2.js','/icon.svg','/manifest.webmanifest'].includes(u.pathname);
  if(cached&&!revalidate)return cached;
  try{
   const response=await fetch(e.request,revalidate?{cache:'no-store'}:{});
   if(response.ok)cache.put(e.request,response.clone()).catch(()=>{});
   return response;
  }catch(err){
   if(cached)return cached;
   if(e.request.mode==='navigate')return await cache.match('./index.html')||Response.error();
   return Response.error();
  }
 })());
});`;
fs.writeFileSync(path.join(dist,'sw.js'),sw);
fs.writeFileSync(path.join(dist,'_headers'),'/\n  Cache-Control: no-cache, must-revalidate\n/index.html\n  Cache-Control: no-cache, must-revalidate\n/sw.js\n  Cache-Control: no-cache, must-revalidate\n/style.css\n  Cache-Control: no-cache, must-revalidate\n/icon.svg\n  Cache-Control: no-cache, must-revalidate\n/app-v2.js\n  Cache-Control: no-cache, must-revalidate\n');
const bundled=fs.readFileSync(file,'utf8');
if(bundled.includes('cdn.jsdelivr.net'))throw Error('Unexpected CDN reference');
console.log('Offline-ready website PWA built. Cache version:',version);
