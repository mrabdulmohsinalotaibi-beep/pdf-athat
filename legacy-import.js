// Explicit, non-destructive copy from the former anonymous browser library.
// Never transmit filenames, documents, notes, or other PDF content over the network.
(()=>{
 const target='pdf-athat-account-'+window.__pdfAccountId;
 const source='pdf-athat-v1';
 if(!window.__pdfAccountId||!('indexedDB' in window))return;
 const open=(name,version)=>new Promise((resolve,reject)=>{const r=version?indexedDB.open(name,version):indexedDB.open(name);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
 const existing=()=>new Promise(resolve=>{if(!indexedDB.databases)return resolve(false);indexedDB.databases().then(x=>resolve(x.some(i=>i.name===source))).catch(()=>resolve(false))});
 async function copyStore(oldDB,newDB,name){
  if(!oldDB.objectStoreNames.contains(name)||!newDB.objectStoreNames.contains(name))return 0;
  // Complete the source transaction before starting writes; cursor transactions
  // cannot be paused while awaiting a different database's transactions.
  const entries=await new Promise((resolve,reject)=>{
   const tx=oldDB.transaction(name,'readonly'),req=tx.objectStore(name).getAll();
   req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
  let count=0;
  // Adding without overwriting preserves any new annotations created by the account.
  for(const record of entries){
   const added=await new Promise((resolve,reject)=>{
    const tx=newDB.transaction(name,'readwrite'),store=tx.objectStore(name);
    const request=store.add(record);request.onsuccess=()=>resolve(true);
    request.onerror=event=>{if(request.error?.name==='ConstraintError'){event.preventDefault();event.stopPropagation();resolve(false)}else reject(request.error)};
    tx.onerror=()=>reject(tx.error);
   });
   if(added)count++;
  }
  return count;
 }
 async function offer(){
  if(!(await existing()))return;
  const bar=document.querySelector('.header-actions');if(!bar)return;
  const b=document.createElement('button');b.type='button';b.className='subtle-btn';b.textContent='ربط مكتبتي القديمة';b.title='نسخ ملفات المكتبة العامة القديمة إلى حسابك على هذا الجهاز فقط';b.style.cssText='font-size:12px;padding:8px';bar.prepend(b);
  b.onclick=async()=>{if(!confirm('سيتم نسخ ملفات وشروح المكتبة العامة القديمة إلى حسابك الحالي على هذا الجهاز فقط. لن تُحذف المكتبة القديمة ولن يُرفع أي ملف إلى الخادم. هل توافق؟'))return;
   b.disabled=true;b.textContent='جارٍ النسخ محليًا…';
   let oldDB,newDB;try{oldDB=await open(source);newDB=await open(target);if(!newDB.objectStoreNames.contains('documents')||!newDB.objectStoreNames.contains('strokes'))throw Error('لم تكتمل تهيئة المكتبة الجديدة بعد. حاول مرة أخرى.');const a=await copyStore(oldDB,newDB,'documents');const n=await copyStore(oldDB,newDB,'strokes');alert('تم نسخ '+a+' ملف و'+n+' تعليق محليًا. سيتم تحديث المكتبة.');location.reload()}
   catch(e){alert('تعذر النسخ. لم تُحذف المكتبة القديمة: '+e.message);b.disabled=false;b.textContent='إعادة المحاولة'}
   finally{oldDB?.close();newDB?.close()}
  }
 }
 offer().catch(()=>{});
})();
