'use strict';
// End-to-end test of the real Electron UI and persistent offline PDF library.
// Run on a Linux runner with: xvfb-run -a npm run test:e2e
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const { _electron: electron }=require('playwright-core');
const {PDFDocument}=require('pdf-lib');
const electronPath=require('electron');
const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'pdf-athat-e2e-'));
const base=path.resolve(__dirname,'..');
let app;
const sha=buf=>crypto.createHash('sha256').update(buf).digest('hex');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function start(){
 app=await electron.launch({executablePath:electronPath,args:[base],env:{...process.env,PDF_ATHAT_TEST_DATA_DIR:dataDir}});
 const page=await app.firstWindow();
 await page.waitForFunction(()=>document.documentElement.dataset.ready==='yes',{timeout:30000});
 const external=[];
 page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:41753/')&&!r.url().startsWith('blob:')&&!r.url().startsWith('data:'))external.push(r.url())});
 page.on('dialog',d=>d.accept());
 return {page,external};
}
const docs=async page=>page.evaluate(()=>new Promise((resolve,reject)=>{
 const req=indexedDB.open('pdf-athat-v1');
 req.onsuccess=()=>{const tx=req.result.transaction(['documents','strokes'],'readonly');let files,notes;tx.objectStore('documents').getAll().onsuccess=e=>files=e.target.result;tx.objectStore('strokes').getAll().onsuccess=e=>notes=e.target.result;tx.oncomplete=()=>{req.result.close();resolve({files:files.map(d=>({id:d.id,name:d.name})),notes})};tx.onerror=()=>reject(tx.error)};
 req.onerror=()=>reject(req.error)
}));
(async()=>{
 const pdf=await PDFDocument.create();
 pdf.addPage([595,842]).drawText('PDF ATHAT OFFLINE TEST',{x:42,y:780});
 const source=Buffer.from(await pdf.save());
 const first=await start();
 let page=first.page;
 await page.locator('#file').setInputFiles({name:'test.pdf',mimeType:'application/pdf',buffer:source});
 await page.locator('#viewer').waitFor({state:'visible'});
 await page.waitForFunction(()=>document.querySelector('#pages')?.textContent.includes('1 / 1'),{timeout:30000});
 await page.locator('#revealControls').click();
 await page.locator('#pen').click();
 const canvas=page.locator('#inkCanvas');
 const bounds=await canvas.boundingBox();
 assert(bounds&&bounds.width>100);
 await page.mouse.move(bounds.x+bounds.width*.25,bounds.y+bounds.height*.25);
 await page.mouse.down();
 await page.mouse.move(bounds.x+bounds.width*.55,bounds.y+bounds.height*.3,{steps:12});
 await page.mouse.up();
 await page.waitForFunction(async()=>{
 const r=indexedDB.open('pdf-athat-v1');return new Promise(resolve=>{r.onsuccess=()=>{const q=r.result.transaction('strokes').objectStore('strokes').count();q.onsuccess=()=>{resolve(q.result>=1);r.result.close()}};r.onerror=()=>resolve(false)})
 },{timeout:15000});
 let before=await docs(page);
 assert.equal(before.files.length,1);
 assert.equal(before.notes.length,1);
 const originalDownload=page.waitForEvent('download');
 await page.locator('#downloadOriginal').click();
 const dl=await originalDownload;
 const originalBytes=fs.readFileSync(await dl.path());
 assert.equal(sha(originalBytes),sha(source),'Original PDF bytes changed');
 const annotatedDownload=page.waitForEvent('download');
 await page.locator('#download').click();
 const annotated=await annotatedDownload;
 const output=fs.readFileSync(await annotated.path());
 assert.notEqual(sha(output),sha(source),'Annotated copy should differ from original');
 assert.equal((await PDFDocument.load(output)).getPageCount(),1);
 await page.locator('#libraryToggle').click();
 const backupDownload=page.waitForEvent('download');
 await page.locator('#backupExport').click();
 const backup=await backupDownload;
 const archive=fs.readFileSync(await backup.path());
 const data=JSON.parse(archive.toString('utf8'));
 assert.equal(data.format,'PDF.ATHAT.backup');
 assert.equal(data.documents.length,1);
 assert.equal(data.strokes.length,1);
 assert.equal(data.documents[0].file.sha256,sha(source));
 await page.locator('#backupImport').setInputFiles({name:'test.athatbackup',mimeType:'application/json',buffer:archive});
 await page.waitForFunction(async()=>{
 const r=indexedDB.open('pdf-athat-v1');return new Promise(resolve=>{r.onsuccess=()=>{const q=r.result.transaction('documents').objectStore('documents').count();q.onsuccess=()=>{resolve(q.result===2);r.result.close()}};r.onerror=()=>resolve(false)})
 },{timeout:15000});
 before=await docs(page);
 assert.equal(before.notes.length,2);
 assert.notEqual(before.notes[0].documentId,before.notes[1].documentId);
 assert.deepEqual(first.external,[],'External network requests detected');
 await app.close();app=null;
 const second=await start();
 page=second.page;
 const restored=await docs(page);
 assert.equal(restored.files.length,2,'Files were lost on app restart');
 assert.equal(restored.notes.length,2,'Ink was lost on app restart');
 assert.deepEqual(second.external,[],'External network requests after restart');
 await app.close();app=null;
 console.log('PASS: Electron UI, offline PDF, ink save, exported PDF, unchanged original, backup/restore, restart persistence');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(app)await app.close().catch(()=>{});await sleep(250);fs.rmSync(dataDir,{recursive:true,force:true})});
