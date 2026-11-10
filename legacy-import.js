// Explicit, non-destructive copy from the former anonymous browser library.
// Never transmit filenames, documents, notes, or other PDF content over the network.
(()=>{
 const target='pdf-athat-account-'+window.__pdfAccountId;
 const source='pdf-athat-v1';
 if(!window.__pdfAccountId||!('indexedDB' in window))return;
 const open=(name,version)=>new Promise((resolve,reject)=>{const r=version?indexedDB.open(name,version):indexedDB.open(name);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
 const existing=()=>new Promise(resolve=>{if(!indexedDB.databases)return resolve(false);indexedDB.databases().then(x=>resolve(x.some(i=>i.name===source))).catch(()=>resolve(false))});
 function copyStore(oldDB,newDB,name){return new Promise((resolve,reject)=>{
  if(!oldDB.objectStoreNames.contains(name)||!newDB.objectStoreNames.contains(name))return resolve(0);
  let count=0;const read=oldDB.transaction(name,'readonly').objectStore(name).openCursor();
  read.onerror=()=>reject(read.error);
  read.onsuccess=()=>{const cursor=read.result;if(!cursor)return resolve(count);const item=cursor.value;const tx=newDB.transaction(name,'readwrite');const store=tx.objectStore(name);const get=store.get(cursor.key);get.onsuccess=()=>{if(get.result===undefined){const put=store.add(item);put.onerror=()=>reject(put.error);put.onsuccess=()=>{count++}}};tx.oncomplete=()=>cursor.continue();tx.onerror=()=>reject(tx.error)};
 })}
 async function offer(){
  if(!(await existing()))return;
  const bar=document.querySelector('.header-actions');if(!bar)return;
  const b=document.createElement('button');b.type='button';b.className='subtle-btn';b.textContent='ربط مكتبتي القديمة';b.title='نسخ ملفات المكتبة العامة القديمة إلى حسابك على هذا الجهاز فقط';b.style.cssText='font-size:12px;padding:8px';bar.prepend(b);
  b.onclick=async()=>{if(!confirm('سيتم نسخ ملفات وشروح المكتبة العامة القديمة إلى حسابك الحالي على هذا الجهاز فقط. لن تُحذف المكتبة القديمة ولن يُرفع أي ملف إلى الخادم. هل توافق؟'))return;
   b.disabled=true;b.textContent='جارٍ النسخ محليًا…';
   let oldDB,newDB;try{oldDB=await open(source);newDB=await open(target);const a=await copyStore(oldDB,newDB,'documents');const n=await copyStore(oldDB,newDB,'strokes');alert('تم نسخ '+a+' ملف و'+n+' تعليق محليًا. سيتم تحديث المكتبة.');location.reload()}
   catch(e){alert('تعذر النسخ. لم تُحذف المكتبة القديمة: '+e.message);b.disabled=false;b.textContent='إعادة المحاولة'}
   finally{oldDB?.close();newDB?.close()}
  }
 }
 offer().catch(()=>{});
})();
