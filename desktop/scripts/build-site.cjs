'use strict';
// Build a fully local-dependency PWA from the same source as the desktop app.
// Run after: npm run build:offline
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const dist=path.resolve(__dirname,'../dist');
const file=path.join(dist,'app-v2.js');
if(!fs.existsSync(file))throw Error('Run build:offline first');
let source=fs.readFileSync(file,'utf8');
const root=path.resolve(__dirname,'../..');
const accountAssets=['account.html','account.js','site-entry.js','legacy-import.js','admin.html','admin.js','admin.css','admin-entry.js','prayer-bar.js','prayer-bar.css'];
const hash=crypto.createHash('sha256');for(const name of ['app-v2.js','index.html','style.css','icon.svg','manifest.webmanifest'])hash.update(fs.readFileSync(path.join(dist,name)));for(const name of accountAssets)hash.update(fs.readFileSync(path.join(root,name)));const version=hash.digest('hex').slice(0,12);
const htmlFile=path.join(dist,'index.html');
let html=fs.readFileSync(htmlFile,'utf8');
// Version the visual assets to bypass older service-worker caches on mobile devices.
// This affects only deployment output, not the offline desktop application.
for(const [fileName,attribute] of [['style.css','href'],['icon.svg','href'],['manifest.webmanifest','href'],['app-v2.js','src']]){
 const oldValue=attribute+'="./'+fileName+'"';
 if(!html.includes(oldValue))throw Error('Expected HTML reference missing: '+oldValue);
 html=html.replace(oldValue,attribute+'="./'+fileName+'?v='+version+'"');
}
// Web-only login gate. Never touch or delete any previous IndexedDB libraries.
for(const asset of accountAssets){
 fs.copyFileSync(path.join(root,asset),path.join(dist,asset));
}
const gatePath=path.join(dist,'site-entry.js');
fs.writeFileSync(gatePath,fs.readFileSync(gatePath,'utf8').replace("import('./app-v2.js')","import('./app-v2.js?v="+version+"')"));
html=html.replace('</head>','<link rel="stylesheet" href="./prayer-bar.css?v='+version+'"><script defer src="./admin-entry.js?v='+version+'"></script></head>');
fs.writeFileSync(htmlFile,html);

const moduleEntry='<script type="module" src="./app-v2.js?v='+version+'"></script>';
if(!html.includes(moduleEntry))throw Error('PDF reader entrypoint missing');
html=html.replace(moduleEntry,'<script type="module" src="./site-entry.js?v='+version+'"></script>');
fs.writeFileSync(htmlFile,html);

// build:offline removes the Electron-incompatible service-worker call, so the
// website registers its worker here instead of trying to replace it.
source += '\nif("serviceWorker" in navigator){let refreshing=false;navigator.serviceWorker.addEventListener("controllerchange",()=>{if(!refreshing&&!active){refreshing=true;location.reload()}else if(active)tell("تحديث جديد للموقع متاح؛ احفظ تعليقاتك ثم أعد فتح الصفحة")});navigator.serviceWorker.register("./sw.js",{updateViaCache:"none"}).then(reg=>reg.update()).catch(()=>{});}\n';
// Parse the final client module and guard the continuous-reader controls during deployment.
require('esbuild').transformSync(source,{loader:'js',format:'esm',target:'es2022'});
const htmlCheck=fs.readFileSync(htmlFile,'utf8');
const cssCheck=fs.readFileSync(path.join(dist,'style.css'),'utf8');
for(const color of ['--page:#C7B49C','--panel:#EFE3D4','--green:#780000'])if(!cssCheck.includes(color))throw Error('Sandstone theme variable missing '+color);
const manifestCheck=JSON.parse(fs.readFileSync(path.join(dist,'manifest.webmanifest'),'utf8'));
if(manifestCheck.background_color!=='#C7B49C'||manifestCheck.theme_color!=='#780000')throw Error('Manifest theme colors are not synchronized with sandstone palette');
if(!htmlCheck.includes('name="theme-color" content="#780000"'))throw Error('Browser theme color does not match the PDF.ATHAT logo');
for(const marker of ['id="readerModeSelect"','id="readerRTLToggle"','id="readerPagePrev"','id="readerPageNext"'])if(!html.includes(marker))throw Error('Missing page-turning option '+marker);
for(const marker of ['id="continuousReader"','id="readerFab"','id="readerTopbar"','id="readerPageInfo"','id="readerBookmark"']){
 if(!htmlCheck.includes(marker))throw Error('Reader UI missing '+marker);
}
// Guard against regression to low-resolution full-page desktop rendering.
// The browser's built-in PDF viewer remains optional; on desktop the default
// must always be our in-app PDFium/PDF.js reader (including after ink edits).
if(!source.includes('function showNativeReader()')||!source.includes('nativeURL+"#view=Fit&page="'))throw Error('Optional native PDF viewer missing');
for(const unintended of ['fontMode=isDesktopReader()&&readerMode==="single"?"native":"pdfjs"', 'if(isDesktopReader()&&readerMode==="single")showNativeReader()', 'if(next==="single"&&isDesktopReader())showNativeReader()', 'if(!isDesktopReader())try{pdfiumImport']){
 if(source.includes(unintended))throw Error('Desktop PDF must open inside PDF.ATHAT, not native viewer: '+unintended);
}
if(!source.includes('if(fontMode==="original"&&pdfiumDoc&&viewport.rotation===0)'))throw Error('Desktop embedded PDFium render path is missing');
for(const mode of ['single','spread','vertical','flip','horizontal','grid'])if(!html.includes('<option value="'+mode+'">'))throw Error('Missing PDF reading mode '+mode);
for(const marker of ['async function startContinuous()','async function renderPagedMode()','async function setReaderMode(','async function renderContinuousPage(','async function setReaderEditing(','function updateReaderBookmark()']){
 if(!source.includes(marker))throw Error('Reader controller missing '+marker);
}
for(const id of ['libraryStatsAll','libraryStatsFolders','libraryStatsBookmarks','libraryStatsFav'])if(!htmlCheck.includes('id="'+id+'"'))throw Error('Library overview missing '+id);
for(const marker of ['id="manageDetail"','id="manageFileList"','id="manageDefaultMode"','id="manageStorageSize"','id="manageCheckDuplicates"'])if(!htmlCheck.includes(marker))throw Error('Management UI missing '+marker);
for(const marker of ['id="libraryQuickAdd"','id="libraryQuickFolder"','id="libraryQuickContinue"','class="library-hero-art"','class="library-section-heading library-folders-heading"'])if(!htmlCheck.includes(marker))throw Error('Responsive library redesign missing '+marker);
for(const marker of ['latestResumeDocument','effectiveLayout','library-quick-actions'])if(!(source+cssCheck).includes(marker))throw Error('Responsive library integration missing '+marker);
for(const marker of ['id="libraryPage"','id="librarySearch"','id="libraryFolders"','id="libraryCards"','id="libraryListView"','id="libraryGridView"','id="libraryDocDialog"','id="file3"']){
 if(!htmlCheck.includes(marker))throw Error('Library UI missing '+marker);
}
for(const marker of ['function showLibrary()','async function renderLibrary()','function openLibraryDocument(','function docDialog(','async function drawLibraryCovers()']){
 if(!source.includes(marker))throw Error('Library controller missing '+marker);
}

fs.writeFileSync(file,source);
const precache=['./prayer-bar.css?v='+version,'./prayer-bar.js?v='+version,'./site-entry.js?v='+version,'./site-entry.js','./account.html','./account.js','./admin.html','./admin.js','./admin.css','./legacy-import.js','./prayer-bar.js','./prayer-bar.css','./','./index.html','./style.css','./app-v2.js','./manifest.webmanifest','./icon.svg','./vendor/pdfjs/build/pdf.min.mjs','./vendor/pdfjs/build/pdf.worker.min.mjs','./vendor/pdf-lib.esm.js','./pdfium-adapter.js','./vendor/pdfium/pdfium.wasm','./style.css?v='+version,'./icon.svg?v='+version,'./app-v2.js?v='+version,'./manifest.webmanifest?v='+version];
const sw=`const CACHE="pdf-athat-offline-${version}";
const SHELL=${JSON.stringify(precache)};
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('pdf-athat-')&&k!==CACHE).map(k=>caches.delete(k)))),self.clients.claim()])));
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET')return;
 const u=new URL(e.request.url);
 if(u.origin!==self.location.origin||u.pathname.startsWith('/api/'))return;
 e.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  const cached=await cache.match(e.request);
  const revalidate=e.request.mode==='navigate'||['/index.html','/style.css','/app-v2.js','/icon.svg','/manifest.webmanifest','/site-entry.js','/account.html','/account.js','/admin.html','/admin.js'].includes(u.pathname);
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
if(htmlCheck.includes('id="authGate"')||htmlCheck.includes('data-app-module='))throw Error('Unexpected account gate in public PDF build');
if(!htmlCheck.includes('site-entry.js?v='))throw Error('Account session gate missing');
if(!htmlCheck.includes('prayer-bar.css?v='))throw Error('Prayer stylesheet missing');
const bundled=fs.readFileSync(file,'utf8');
if(bundled.includes('cdn.jsdelivr.net'))throw Error('Unexpected CDN reference');
console.log('Offline-ready website PWA built. Cache version:',version);

