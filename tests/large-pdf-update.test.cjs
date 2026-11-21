'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'app-v2.js'),'utf8');
const splitter=fs.readFileSync(path.join(root,'large-pdf-split.js'),'utf8');
const builder=fs.readFileSync(path.join(root,'desktop/scripts/build-site.cjs'),'utf8');
assert(!/PDF_SPLIT_INPUT_LIMIT|الكتب الأكبر من 300 ميجابايت|أكبر من 300 ميجابايت/.test(source+splitter),
  'The 300MB artificial cap must not return');
assert(source.includes('await confirmLargePdf(file)'),'Oversized books must offer in-app splitting');
assert(source.includes('beginLargePdfProgress(file)'),'Progress panel must be wired to saving');
assert(source.includes('splitPdfOnDevice(file,'),'Large PDFs must run in an isolated worker');
assert(source.includes('worker.postMessage({type:"saved"})'),'Worker must wait for local save confirmation');
assert(fs.readFileSync(path.join(root,'large-pdf-worker.js'),'utf8').includes('splitLargePdf(data.file'),'Worker must generate PDF parts locally');
assert(source.includes('getAll("documents")'),'Stored parts must be verified');
assert(builder.includes("source=source.replace(splitterSpecifier"),
  'The split module import must be versioned for iOS PWA updates');
assert(builder.includes("'./large-pdf-split.js?v='+version"),
  'The versioned split module must be precached');
assert(builder.includes("'/large-pdf-worker.js'"),'Worker must be revalidated while online');
assert(builder.includes("'/large-pdf-split.js'"),
  'The split module must be revalidated while online');
console.log('Oversized PDF local splitter: no fixed 300MB limit and versioned PWA import.');

// Safari/WebKit rejects service-worker-served navigation responses that followed
// redirects. Keep admin online-only; never replay redirected responses from cache.
assert(builder.includes("u.pathname==='/admin.html'"),'Admin navigations must bypass the generated service worker');
assert(builder.includes("if(cached?.redirected)await cache.delete(e.request)"),'Redirected cache entries must be discarded');
assert(builder.includes("response.ok&&!response.redirected"),'Redirected responses must not be cached');
assert(builder.includes("hash.update(fs.readFileSync(__filename))"),'SW changes must rotate the PWA cache version');
assert(!builder.match(/const precache=\\[[^\\n]*'\\.\\/admin\\.html'/),'Admin document must not be precached');
const devSW=fs.readFileSync(path.join(root,'sw.js'),'utf8');
assert(devSW.includes('url.pathname==="/admin.html"'),'Development service worker must bypass admin');
assert(devSW.includes('response.ok&&!response.redirected'),'Development service worker must avoid caching redirects');
