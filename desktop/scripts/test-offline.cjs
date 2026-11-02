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
assert(app.includes('version:2,createdAt')&&app.includes('![1,2].includes(backup.version)'),'New backups must enforce hashes and remain backward compatible');
assert(app.includes('crypto.subtle.digest("SHA-256"')&&app.includes('sha256:await digestHex'),'Backup exports must include integrity hashes');
assert(app.includes('(await digestHex(bytes)).toLowerCase()!==d.file.sha256.toLowerCase()'),'Backup imports must verify file hashes');
assert(app.includes('db.transaction(["documents","strokes"],"readwrite")'),'Backup restore must be atomic');
assert(app.includes('documentId:remap.get(note.documentId)'),'Annotations must be remapped to restored documents');
assert(app.includes('transaction.objectStore("documents").add(d)'),'Backup must not overwrite existing documents');
assert(app.includes('await save("strokes",s);strokes.push(s)'),'Ink must be stored before UI state changes');
assert(app.includes('let editing=false;'),'Undo and redo must have an operation lock');
console.log('PASS: local PDF engines, original-preserving controls and annotation layer');
