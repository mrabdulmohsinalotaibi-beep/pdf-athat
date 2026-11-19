// Single, opt-in recovery path: Account settings -> Restore local library.
// Copies only from local guest IndexedDB stores. Never deletes source data or uploads PDFs.
const validSource=name=>name==='pdf-athat-v1'||/^pdf-athat-guest-[a-f0-9-]{36}$/.test(name||'');
const openDB=name=>new Promise((resolve,reject)=>{
 const request=indexedDB.open(name);
 request.onupgradeneeded=()=>{if(name.startsWith('pdf-athat-account-')){
  const db=request.result;
  if(!db.objectStoreNames.contains('documents'))db.createObjectStore('documents',{keyPath:'id'});
  if(!db.objectStoreNames.contains('strokes'))db.createObjectStore('strokes',{keyPath:'id'});
 }};
 request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
});
const getAll=(db,store)=>new Promise((resolve,reject)=>{
 const req=db.transaction(store,'readonly').objectStore(store).getAll();
 req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
});
const get=(db,store,id)=>new Promise((resolve,reject)=>{
 const req=db.transaction(store,'readonly').objectStore(store).get(id);
 req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
});
const put=(db,store,record)=>new Promise((resolve,reject)=>{
 const tx=db.transaction(store,'readwrite');tx.objectStore(store).add(record);
 tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('فشل حفظ أحد العناصر'));
});
const hex=buf=>Array.from(new Uint8Array(buf),v=>v.toString(16).padStart(2,'0')).join('');
const hash=async data=>hex(await crypto.subtle.digest('SHA-256',data));
const collisionId=async(db,store,oldId,name)=>{const h=await hash(new TextEncoder().encode(db+'|'+store+'|'+oldId+'|'+name));return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32)};
const sameFile=async(a,b)=>{
 if(!(a?.file instanceof Blob)||!(b?.file instanceof Blob)||a.file.size!==b.file.size)return false;
 return (await hash(await a.file.arrayBuffer()))===(await hash(await b.file.arrayBuffer()));
};
const sameNote=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const foldersKey=name=>name==='pdf-athat-v1'?'pdfathat-folders':'pdfathat-folders:'+name;
function folders(key){try{const a=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(a)?a.filter(x=>typeof x==='string'&&x.trim()&&x.length<=40):[]}catch{return []}}
async function sources(){
 if(typeof indexedDB.databases==='function'){
  const all=await indexedDB.databases();
  return [...new Set(all.map(x=>x.name).filter(validSource))];
 }
 // Old browsers without databases() can still recover the original guest library.
 return ['pdf-athat-v1'];
}
export async function recoverLocalLibraries(userId,onProgress=()=>{}){
 if(!userId||!('indexedDB' in window))throw Error('يجب تسجيل الدخول على الجهاز الذي يحتوي الملفات القديمة');
 const names=await sources(), target='pdf-athat-account-'+userId;
 const candidates=[];
 for(const name of names){
  let db;
  try{
   db=await openDB(name);
   if(!db.objectStoreNames.contains('documents')||!db.objectStoreNames.contains('strokes'))continue;
   const docs=await getAll(db,'documents'),notes=await getAll(db,'strokes');
   if(docs.length||notes.length)candidates.push({name,docs,notes});
  }finally{db?.close()}
 }
 const total=candidates.reduce((sum,x)=>sum+2*(x.docs.length+x.notes.length),0);
 if(!total)return {libraries:0,documents:0,notes:0,importedDocs:0,importedNotes:0};
 let done=0,importedDocs=0,importedNotes=0;
 const progress=label=>onProgress(done,total,label);
 const destination=await openDB(target);
 try{
  for(const {name,docs,notes} of candidates){
   let source;
   try{
    source=await openDB(name);
    const map=new Map(),checks=[];
    progress('جارٍ استعادة الملفات من المكتبات السابقة');
    for(const doc of docs){
     if(typeof doc?.id!=='string'||!doc.id)throw Error('ملف قديم بلا معرّف في '+name);
     let id=doc.id,existing=await get(destination,'documents',id);
     if(existing&&!(await sameFile(existing,doc))){
      id=await collisionId(name,'documents',doc.id,doc.name||'');
      existing=await get(destination,'documents',id);
      if(existing&&!(await sameFile(existing,doc)))throw Error('تعارض غير قابل للحل في الملف '+(doc.name||doc.id));
     }
     if(!existing){await put(destination,'documents',{...doc,id});importedDocs++}
     map.set(doc.id,id);checks.push({store:'documents',id,expected:{...doc,id}});
     done++;progress('جارٍ نقل ملفات PDF');
    }
    for(const note of notes){
     if(typeof note?.id!=='string'||!note.id)throw Error('تعليق سابق بلا معرّف في '+name);
     const base={...note,documentId:map.get(note.documentId)||note.documentId};
     let id=note.id,existing=await get(destination,'strokes',id);
     if(existing&&!sameNote(existing,base)){
      id=await collisionId(name,'strokes',note.id,'');
      existing=await get(destination,'strokes',id);
      if(existing&&!sameNote(existing,{...base,id}))throw Error('تعارض غير قابل للحل في تعليق قديم');
     }
     const expected={...base,id};
     if(!existing){await put(destination,'strokes',expected);importedNotes++}
     checks.push({store:'strokes',id,expected});
     done++;progress('جارٍ نقل التعليقات');
    }
    const [currentDocs,currentNotes]=await Promise.all([getAll(source,'documents'),getAll(source,'strokes')]);
    if(currentDocs.length!==docs.length||currentNotes.length!==notes.length||
       currentDocs.some((x,i)=>x.id!==docs[i].id)||currentNotes.some((x,i)=>x.id!==notes[i].id))
      throw Error('تغيرت المكتبة القديمة أثناء الاستعادة؛ أوقف استخدامها وأعد المحاولة');
    for(const item of checks){
     const saved=await get(destination,item.store,item.id);
     if(!saved||(item.store==='documents'?!(await sameFile(saved,item.expected)):!sameNote(saved,item.expected)))
      throw Error('لم ينجح التحقق من أحد العناصر؛ النسخة الأصلية محفوظة');
     done++;progress('جارٍ التحقق من سلامة الملفات والتعليقات');
    }
    const key='pdfathat-folders:'+userId;
    const merged=[...new Set([...folders(key),...folders(foldersKey(name))])];
    localStorage.setItem(key,JSON.stringify(merged));
   }finally{source?.close()}
  }
  // After verified recovery, keep old bytes as a recovery archive but isolate guest mode.
  const active=localStorage.getItem('pdf-athat-active-guest-library')||'pdf-athat-v1';
  if(candidates.some(item=>item.name===active)){
   localStorage.setItem('pdf-athat-active-guest-library','pdf-athat-guest-'+crypto.randomUUID());
  }
  progress('اكتمل النقل والتحقق');
  return {
   libraries:candidates.length,
   documents:candidates.reduce((n,x)=>n+x.docs.length,0),
   notes:candidates.reduce((n,x)=>n+x.notes.length,0),
   importedDocs,importedNotes
  };
 }finally{destination.close()}
}
