'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../dist');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const app=read('app-v2.js'),html=read('index.html');
for(const p of ['vendor/pdfjs/build/pdf.min.mjs','vendor/pdfjs/build/pdf.worker.min.mjs','vendor/pdf-lib.esm.js','vendor/pdfjs/cmaps','vendor/pdfjs/standard_fonts','vendor/pdfjs/wasm']){
 assert(fs.existsSync(path.join(root,p)),'Missing offline asset: '+p);
}
for(const id of ['pdfCanvas','inkCanvas','toggleInk','downloadOriginal','download','backupExport','backupImport']){
 assert(html.includes('id="'+id+'"'),'Missing UI control: '+id);
}
assert(app.includes('saveBlob(active.file,active.name)'),'Original export must use original Blob');
assert(app.includes('if(!inkVisible)return'),'Annotations visibility is not independent');
assert(!app.includes('https://cdn.jsdelivr.net'),'CDN dependency must not appear in desktop app');
assert(app.includes('PDF.ATHAT.backup')&&app.includes('base64ToBytes'),'Backup export and restore must be bundled');
console.log('PASS: local PDF engines, original-preserving controls and annotation layer');
