'use strict';
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {PDFDocument}=require('pdf-lib');
const {_electron:electron}=require('playwright');

const root=path.resolve(__dirname,'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'athat-e2e-'));
const userData=path.join(temp,'user-data');
const hash=b=>createHash('sha256').update(b).digest('hex');
const delay=ms=>new Promise(r=>setTimeout(r,ms));

async function storeCount(page,name){
 return page.evaluate(name=>new Promise((resolve,reject)=>{
  const opened=indexedDB.open('pdf-athat-v1');
  opened.onerror=()=>reject(opened.error);
  opened.onsuccess=()=>{
   const db=opened.result;
   const t=db.transaction(name,'readonly');
   const r=t.objectStore(name).count();
   r.onsuccess=()=>resolve(r.result);
   r.onerror=()=>reject(r.error);
   t.oncomplete=()=>db.close();
  };
 }),name);
}
async function expectCount(page,store,expected){
 for(let i=0;i<60;i++){
  const actual=await storeCount(page,store);
  if(actual===expected)return;
  await delay(150);
 }
 assert.equal(await storeCount(page,store),expected,store+' count mismatch');
}
async function samplePdf(){
 const doc=await PDFDocument.create();
 doc.addPage([595,842]).drawText('PDF.ATHAT first page',{x:45,y:780,size:18});
 doc.addPage([595,842]).drawText('PDF.ATHAT second page',{x:45,y:780,size:18});
 return Buffer.from(await doc.save());
}
async function run(){
 let instance,page;
 try{
  const original=await samplePdf();
  instance=await electron.launch({
   args:[path.join(root,'main.cjs'),'--no-sandbox'],
   cwd:root,
   env:{...process.env,ATHAT_TEST_USER_DATA:userData},
   timeout:60000
  });
  page=await instance.firstWindow();
  const external=[];
  page.on('request',request=>{
   try{
    const u=new URL(request.url());
    if(['http:','https:'].includes(u.protocol)&&u.hostname!=='127.0.0.1')external.push(u.href);
   }catch{}
  });
  await page.waitForFunction(()=>document.documentElement.dataset.ready==='yes',null,{timeout:45000});
  await page.locator('#file').setInputFiles({name:'ATHAT-test.pdf',mimeType:'application/pdf',buffer:original});
  await page.waitForFunction(()=>document.querySelector('#pages')?.textContent?.includes(' / 2'),null,{timeout:45000});
  await expectCount(page,'documents',1);
  await page.locator('#revealControls').click();
  await page.locator('#pen').click();
  const ink=page.locator('#inkCanvas');
  await ink.scrollIntoViewIfNeeded();
  const rect=await ink.boundingBox();
  assert(rect&&rect.width>30&&rect.height>30,'PDF drawing surface not visible');
  const px=rect.x+rect.width*.43,py=rect.y+rect.height*.35;
  await page.mouse.move(px,py);
  await page.mouse.down();
  await page.mouse.move(px+35,py+28,{steps:9});
  await page.mouse.up();
  await expectCount(page,'strokes',1);
  await page.locator('#undo').click();
  await expectCount(page,'strokes',0);
  await page.locator('#redo').click();
  await expectCount(page,'strokes',1);
  await page.locator('#textTool').click();
  page.once('dialog',dialog=>dialog.accept('ملاحظة عربية\\nسطر جديد'.replace('\\n','\n')));
  await page.mouse.click(px,py+65);
  await expectCount(page,'strokes',2);

  const [originalDownload]=await Promise.all([
   page.waitForEvent('download'),page.locator('#downloadOriginal').click()
  ]);
  const originalPath=path.join(temp,'original.pdf');
  await originalDownload.saveAs(originalPath);
  assert.equal(hash(fs.readFileSync(originalPath)),hash(original),'Original PDF bytes changed');

  const [annotatedDownload]=await Promise.all([
   page.waitForEvent('download'),page.locator('#download').click()
  ]);
  const annotatedPath=path.join(temp,'annotated.pdf');
  await annotatedDownload.saveAs(annotatedPath);
  assert.notEqual(hash(fs.readFileSync(annotatedPath)),hash(original),'Annotated copy must differ');
  assert.equal((await PDFDocument.load(fs.readFileSync(annotatedPath))).getPageCount(),2);

  await page.locator('#libraryToggle').click();
  const [backupDownload]=await Promise.all([
   page.waitForEvent('download'),page.locator('#backupExport').click()
  ]);
  const backupPath=path.join(temp,'backup.athatbackup');
  await backupDownload.saveAs(backupPath);
  const backup=JSON.parse(fs.readFileSync(backupPath,'utf8'));
  assert.equal(backup.documents.length,1);
  assert.equal(backup.version,2,'New backups must require integrity fingerprints');
  assert.equal(backup.strokes.length,2);
  assert.equal(backup.documents[0].file.sha256,hash(original));
  page.on('dialog',dialog=>dialog.accept());
  await page.locator('#backupImport').setInputFiles(backupPath);
  await expectCount(page,'documents',2);
  await expectCount(page,'strokes',4);
  const damaged={...backup,documents:backup.documents.map(d=>({...d,file:{...d.file,sha256:'0'.repeat(64)}}))};
  await page.locator('#backupImport').setInputFiles({name:'damaged.athatbackup',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(damaged))});
  await delay(300);
  await expectCount(page,'documents',2);
  await expectCount(page,'strokes',4);
  assert.deepEqual(external,[],'App attempted an external network request');

  await instance.close();
  instance=await electron.launch({
   args:[path.join(root,'main.cjs'),'--no-sandbox'],
   cwd:root,
   env:{...process.env,ATHAT_TEST_USER_DATA:userData},
   timeout:60000
  });
  page=await instance.firstWindow();
  await page.waitForFunction(()=>document.documentElement.dataset.ready==='yes',null,{timeout:45000});
  await expectCount(page,'documents',2);
  await expectCount(page,'strokes',4);
  const integrity=await page.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{const open=indexedDB.open('pdf-athat-v1');open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error)});
    const read=store=>new Promise((resolve,reject)=>{const t=db.transaction(store,'readonly');const request=t.objectStore(store).getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
    const docs=await read('documents'),notes=await read('strokes');
    const out=[];
    for(const doc of docs){
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await doc.file.arrayBuffer()))).map(b=>b.toString(16).padStart(2,'0')).join('');
      out.push({id:doc.id,hash});
    }
    db.close();
    return {docs:out,notes:notes.map(note=>({documentId:note.documentId,page:note.page}))};
  });
  assert.equal(integrity.docs.length,2);
  assert.equal(integrity.notes.length,4);
  assert(integrity.docs.every(doc=>doc.hash===hash(original)),'Restored PDF differs from original');
  const knownIds=new Set(integrity.docs.map(doc=>doc.id));
  assert(integrity.notes.every(note=>knownIds.has(note.documentId)&&note.page===1),'Annotations lost original document/page association');
  console.log('PASS: Electron offline PDF import, pen, original checksum, annotated export, backup restore, persisted restart');
 }catch(error){
  if(page)try{fs.mkdirSync(path.join(root,'test-results'),{recursive:true});await page.screenshot({path:path.join(root,'test-results','desktop-failure.png'),fullPage:true})}catch{}
  throw error;
 }finally{
  if(instance)await instance.close().catch(()=>{});
  fs.rmSync(temp,{recursive:true,force:true});
 }
}
run().catch(error=>{console.error(error);process.exitCode=1});
