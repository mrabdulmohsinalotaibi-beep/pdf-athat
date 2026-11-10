// Move the *visible ownership* of a guest library into the signed-in account.
// The old guest IndexedDB is retained as a local recovery archive, not exposed
// through guest mode after a verified import. No PDF leaves this device.
(()=>{
'use strict';
const userId=window.__pdfAccountId;
if(!userId||!('indexedDB' in window))return;
const source=window.__pdfGuestDBName||'pdf-athat-v1';
const target='pdf-athat-account-'+userId;
if(source===target)return;
const guestKey='pdf-athat-active-guest-library';
const folderKey=name=>name==='pdf-athat-v1'?'pdfathat-folders':'pdfathat-folders:'+name;
const accountFolders='pdfathat-folders:'+userId;
const $=selector=>document.querySelector(selector);
const open=name=>new Promise((resolve,reject)=>{
 const req=indexedDB.open(name);
 req.onsuccess=()=>resolve(req.result);
 req.onerror=()=>reject(req.error);
});
const hasDatabase=async name=>{
 if(!indexedDB.databases)return name==='pdf-athat-v1';
 return (await indexedDB.databases()).some(item=>item.name===name);
};
const readAll=(db,store)=>new Promise((resolve,reject)=>{
 const tx=db.transaction(store,'readonly'),req=tx.objectStore(store).getAll();
 req.onsuccess=()=>resolve(req.result);
 req.onerror=()=>reject(req.error);
});
const readOne=(db,store,id)=>new Promise((resolve,reject)=>{
 const tx=db.transaction(store,'readonly'),req=tx.objectStore(store).get(id);
 req.onsuccess=()=>resolve(req.result);
 req.onerror=()=>reject(req.error);
});
const add=(db,store,record)=>new Promise((resolve,reject)=>{
 const tx=db.transaction(store,'readwrite'),req=tx.objectStore(store).add(record);
 tx.oncomplete=()=>resolve();
 tx.onerror=()=>reject(tx.error);
 tx.onabort=()=>reject(tx.error||Error('تعذر حفظ السجل في الحساب'));
 req.onerror=()=>{};
});
const hex=bytes=>Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');
const sha=async bytes=>hex(await crypto.subtle.digest('SHA-256',bytes));
const stableId=async(store,id,content='')=>{
 const digest=await sha(new TextEncoder().encode(source+'|'+store+'|'+id+'|'+content));
 return digest.slice(0,8)+'-'+digest.slice(8,12)+'-4'+digest.slice(13,16)+'-8'+digest.slice(17,20)+'-'+digest.slice(20,32);
};
const getFile=record=>record?.file instanceof Blob?record.file:null;
async function equalFiles(a,b){
 const x=getFile(a),y=getFile(b);
 if(!x||!y||x.size!==y.size)return false;
 return (await sha(await x.arrayBuffer()))===(await sha(await y.arrayBuffer()));
}
function parseFolders(key){
 try{const data=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(data)?data.filter(x=>typeof x==='string'&&x.trim()&&x.length<=40):[]}
 catch{return []}
}
async function transfer(oldDB,newDB){
 const docs=await readAll(oldDB,'documents');
 const notes=await readAll(oldDB,'strokes');
 const docMap=new Map(),checks=[];
 let importedDocs=0,importedNotes=0;
 for(const doc of docs){
  if(!doc||typeof doc.id!=='string'||!doc.id)throw Error('ملف قديم بلا معرّف؛ لم تُغلق مكتبة الزائر');
  let id=doc.id;
  let found=await readOne(newDB,'documents',id);
  if(found&&!(await equalFiles(found,doc))){
   id=await stableId('documents',doc.id,doc.name||'');
   found=await readOne(newDB,'documents',id);
   if(found&&!(await equalFiles(found,doc)))throw Error('تعارض ملف بنفس المعرّف؛ أُبقيت مكتبة الزائر كما هي');
  }
  if(!found){await add(newDB,'documents',{...doc,id});importedDocs++}
  docMap.set(doc.id,id);
  checks.push({store:'documents',id,source:doc});
 }
 for(const note of notes){
  if(!note||typeof note.id!=='string'||!note.id)throw Error('تعليق قديم بلا معرّف؛ لم تُغلق مكتبة الزائر');
  const original={...note,documentId:docMap.get(note.documentId)||note.documentId};
  let id=note.id;
  let found=await readOne(newDB,'strokes',id);
  if(found&&JSON.stringify(found)!==JSON.stringify(original)){
   id=await stableId('strokes',note.id);
   found=await readOne(newDB,'strokes',id);
   if(found&&JSON.stringify(found)!==JSON.stringify({...original,id}))
    throw Error('تعارض تعليق؛ أُبقيت مكتبة الزائر كما هي');
  }
  const record={...original,id};
  if(!found){await add(newDB,'strokes',record);importedNotes++}
  checks.push({store:'strokes',id,source:record});
 }
 // If another open tab modified the visitor's collection during copying,
 // do not rotate access to it until a fresh, complete transfer succeeds.
 const [latestDocs,latestNotes]=await Promise.all([
  readAll(oldDB,'documents'),readAll(oldDB,'strokes')
 ]);
 if(latestDocs.length!==docs.length||latestNotes.length!==notes.length||
    latestDocs.some((v,i)=>v.id!==docs[i]?.id)||
    latestNotes.some((v,i)=>v.id!==notes[i]?.id))
  throw Error('تغيّرت مكتبة الزائر أثناء الربط؛ أعد المحاولة بعد إغلاق التبويبات الأخرى');
 // Verify the destination while the source library is still accessible.
 for(const item of checks){
  const record=await readOne(newDB,item.store,item.id);
  if(!record)throw Error('لم يكتمل التحقق من نقل بياناتك');
  if(item.store==='documents' && !(await equalFiles(record,item.source)))
   throw Error('لم يكتمل التحقق من ملف PDF؛ مكتبة الزائر محفوظة');
  if(item.store==='strokes' && JSON.stringify(record)!==JSON.stringify(item.source))
   throw Error('لم يكتمل التحقق من التعليقات؛ مكتبة الزائر محفوظة');
 }
 return {documents:docs.length,notes:notes.length,importedDocs,importedNotes};
}
async function offer(){
 const bar=$('#manageBackup .manage-controls');
 const quick=$('.library-quick-actions');
 if(!bar&&!quick)return;
 const button=document.createElement('button');
 button.type='button';button.id='guestAccountLinkButton';button.className='subtle-btn';
 button.textContent='🔐 ربط ملفات الزائر بحسابي';
 button.title='ربط ملفات الزائر القديمة بحسابي حتى لا تظهر بعد تسجيل الخروج';
 button.style.cssText='font-size:12px;padding:9px 12px;min-height:41px;border:1px solid #780000;border-radius:10px;white-space:normal';
 (quick||bar).append(button);
 if(bar&&quick){
  const backupButton=document.createElement('button');
  backupButton.type='button';backupButton.textContent='ربط ملفات الزائر بحسابي';
  backupButton.title=button.title;backupButton.id='guestBackupLinkButton';
  backupButton.className='subtle-btn';backupButton.style.cssText='font-size:12px;padding:8px';
  backupButton.onclick=()=>button.click();
  bar.append(backupButton);
 }
 button.onclick=async()=>{
  button.disabled=true;button.textContent='جارٍ فحص مكتبة الزائر…';
  let oldDB,newDB;
  try{
   if(!(await hasDatabase(source))){
    alert('لا توجد مكتبة زائر قديمة على هذا الجهاز لربطها. إذا كانت ملفاتك تظهر في حسابك فقط، فهي معزولة بالفعل عن وضع الزائر. افتح الجهاز والمتصفح اللذين يحتويان ملفات الزائر القديمة لإجراء الربط.');
    return;
   }
   oldDB=await open(source);
   if(!oldDB.objectStoreNames.contains('documents')||!oldDB.objectStoreNames.contains('strokes'))
    throw Error('لم يُعثر على ملفات زائر صالحة في هذه المكتبة');
   const oldDocs=await readAll(oldDB,'documents'),oldNotes=await readAll(oldDB,'strokes');
   if(!oldDocs.length&&!oldNotes.length){
    alert('مكتبة الزائر الحالية فارغة؛ لا توجد ملفات أو تعليقات لربطها. ملفات حسابك المسجّل لا تظهر في وضع الزائر.');
    return;
   }
   if(!confirm('عُثر على '+oldDocs.length+' ملف و'+oldNotes.length+' تعليق في مكتبة الزائر. سنربطها بحسابك الحالي على هذا الجهاز ثم نجعل مكتبة الزائر فارغة. سنحتفظ بنسخة استرداد محلية ولن نرفع ملفاتك إلى الخادم. هل توافق؟'))return;
   newDB=await open(target);
   if(!newDB.objectStoreNames.contains('documents')||!newDB.objectStoreNames.contains('strokes'))
    throw Error('مكتبة الحساب غير جاهزة؛ أعد فتح الصفحة وحاول مجددًا');
   button.textContent='جارٍ الربط والتحقق من سلامة الملفات…';
   const result=await transfer(oldDB,newDB);
   const names=[...new Set([...parseFolders(folderKey(source)),...parseFolders(accountFolders)])];
   localStorage.setItem(accountFolders,JSON.stringify(names));
   const next='pdf-athat-guest-'+crypto.randomUUID();
   localStorage.setItem(guestKey,next);
   window.__pdfGuestDBName=next;
   alert('اكتمل ربط '+result.documents+' ملف و'+result.notes+' تعليق بحسابك. عند تسجيل الخروج والدخول كزائر ستظهر مكتبة فارغة، وتبقى الملفات داخل حسابك على الجهاز.');
   location.reload();
  }catch(error){
   alert('تعذر ربط مكتبة الزائر؛ لم تُحذف ملفاتك القديمة: '+(error.message||'خطأ'));
  }finally{
   oldDB?.close();newDB?.close();
   button.disabled=false;button.textContent='🔐 ربط ملفات الزائر بحسابي';
  }
 };
 if(new URLSearchParams(location.search).get('link-guest')==='1'){
  button.style.outline='3px solid #b47b44';
  button.scrollIntoView({behavior:'smooth',block:'center'});
  button.focus({preventScroll:true});
 }
}
offer().catch(error=>console.warn('legacy_library_link',error?.name));
})();
