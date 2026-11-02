'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),desktop=path.resolve(__dirname,'..'),out=path.join(desktop,'dist');
const copy=(from,to)=>{fs.mkdirSync(path.dirname(to),{recursive:true});fs.cpSync(from,to,{recursive:true})};
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
for(const name of ['index.html','style.css','app-v2.js','manifest.webmanifest','icon.svg']){
 const src=path.join(root,name);if(!fs.existsSync(src))throw new Error('Missing application asset: '+name);
 copy(src,path.join(out,name));
}
const vendor=path.join(out,'vendor');
const pdfjs=path.join(desktop,'node_modules/pdfjs-dist');
const pdflib=path.join(desktop,'node_modules/pdf-lib/dist/pdf-lib.esm.js');
for(const dir of ['build','cmaps','standard_fonts','wasm']){
 if(!fs.existsSync(path.join(pdfjs,dir)))throw new Error('Missing pdfjs assets: '+dir);
 copy(path.join(pdfjs,dir),path.join(vendor,'pdfjs',dir));
}
if(!fs.existsSync(pdflib))throw new Error('Missing pdf-lib ESM bundle');
copy(pdflib,path.join(vendor,'pdf-lib.esm.js'));
let js=fs.readFileSync(path.join(out,'app-v2.js'),'utf8');
const replacements=[
 ['https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.394/build/pdf.min.mjs','./vendor/pdfjs/build/pdf.min.mjs'],
 ['https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.394/build/pdf.worker.min.mjs','./vendor/pdfjs/build/pdf.worker.min.mjs'],
 ['https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.394/cmaps/','./vendor/pdfjs/cmaps/'],
 ['https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.394/standard_fonts/','./vendor/pdfjs/standard_fonts/'],
 ['https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.394/wasm/','./vendor/pdfjs/wasm/'],
 ['https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm','./vendor/pdf-lib.esm.js']
];
for(const [from,to]of replacements){if(!js.includes(from))throw new Error('Expected dependency URL not found: '+from);js=js.replaceAll(from,to)}
// Electron serves complete immutable assets from disk; a PWA service worker is unnecessary
// and would leave an obsolete cache after desktop upgrades.
const swCall='if("serviceWorker"in navigator)navigator.serviceWorker.register("./sw.js").catch(()=>{});';
if(!js.includes(swCall))throw new Error('Expected service worker registration not found');
js=js.replace(swCall,'/* Desktop: bundled assets, no service worker */');
if(js.includes('https://')||js.includes('http://'))throw new Error('External URL reference remains in desktop application');
fs.writeFileSync(path.join(out,'app-v2.js'),js);
const html=fs.readFileSync(path.join(out,'index.html'),'utf8');
if(!html.includes('id="downloadOriginal"')||!html.includes('id="toggleInk"'))throw new Error('Original PDF protection controls are missing');
if(!js.includes('saveBlob(file,active.name)'))throw new Error('Original PDF export is missing');
console.log('PDF.ATHAT fully bundled assets ready: '+out);
