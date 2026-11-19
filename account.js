const $=id=>document.getElementById(id);
const state={signupChallenge:null,resetChallenge:null,emailChallenge:null,currentUser:null};
const status=message=>{$('authStatus').textContent=message||''};
const profileStatus=message=>{$('profileStatus').textContent=message||''};
const post=async(path,body)=>{
 const response=await fetch('/api/auth/'+path,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',cache:'no-store',body:JSON.stringify(body)});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.error||'تعذر إكمال الطلب');
 return data;
};
function tab(name){
 for(const b of document.querySelectorAll('[data-tab]'))b.setAttribute('aria-selected',String(b.dataset.tab===name));
 for(const id of ['login','signup','recover','verify','reset'])$(id+'Form').hidden=id!==name;
 status('');
}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>tab(b.dataset.tab));
function guard(form,handler,errorTarget=null){
 form.addEventListener('submit',async event=>{
  event.preventDefault();
  const button=form.querySelector('button[type=submit]');
  button.disabled=true;status('');
  try{await handler(Object.fromEntries(new FormData(form)))}catch(error){if(errorTarget)messageFor(errorTarget,error.message);else status(error.message)}
  finally{button.disabled=false}
 });
}
function showAuth(){
 document.querySelector('.auth-layout')?.classList.remove('profile-active');
 $('profilePane').hidden=true;$('authPane').hidden=false;$('returnToProfile').hidden=true;
}
function forward(user){
 location.replace(user?.role==='admin'?'/admin.html':'/');
}
function enterGuest(){
 try{localStorage.setItem('pdf-athat-guest-mode','yes')}
 catch{status('تعذر حفظ وضع الزائر في المتصفح. تأكد من السماح بالتخزين المحلي.');return}
 location.replace('/');
}
$('guestLogin').onclick=enterGuest;
$('profileGuest').onclick=enterGuest;
const back=document.createElement('button');
back.id='returnToProfile';back.type='button';back.className='secondary';back.hidden=true;
back.textContent='العودة إلى بيانات حسابي';
$('authPane').append(back);
back.onclick=()=>{if(state.currentUser)showProfile(state.currentUser)};
const numbers=()=>({files:$('profileFiles'),notes:$('profileNotes'),folders:$('profileFolders')});
async function accountLibrarySummary(user){
 const fields=numbers();
 for(const field of Object.values(fields))field.textContent='—';
 const folderNames=new Set();
 try{
  const custom=JSON.parse(localStorage.getItem('pdfathat-folders:'+user.id)||'[]');
  if(Array.isArray(custom))for(const name of custom)if(typeof name==='string')folderNames.add(name);
 }catch{}
 try{
  if(!indexedDB?.databases){fields.files.textContent='—';fields.notes.textContent='—';fields.folders.textContent=folderNames.size;return}
  const name='pdf-athat-account-'+user.id;
  const found=(await indexedDB.databases()).some(item=>item.name===name);
  if(!found){fields.files.textContent=0;fields.notes.textContent=0;fields.folders.textContent=folderNames.size;return}
  const db=await new Promise((resolve,reject)=>{
   const request=indexedDB.open(name);
   request.onsuccess=()=>resolve(request.result);
   request.onerror=()=>reject(request.error);
  });
  try{
   if(!db.objectStoreNames.contains('documents')||!db.objectStoreNames.contains('strokes'))return;
   const totals=await new Promise((resolve,reject)=>{
    const transaction=db.transaction(['documents','strokes'],'readonly');
    let files=0,notes=0;
    const cursor=transaction.objectStore('documents').openCursor();
    cursor.onsuccess=()=>{
     const item=cursor.result;
     if(!item)return;
     const doc=item.value;
     if(!doc.deleted)files++;
     if(Array.isArray(doc.folders))for(const name of doc.folders)if(typeof name==='string')folderNames.add(name);
     item.continue();
    };
    cursor.onerror=()=>reject(cursor.error);
    const count=transaction.objectStore('strokes').count();
    count.onsuccess=()=>{notes=count.result};
    count.onerror=()=>reject(count.error);
    transaction.oncomplete=()=>resolve({files,notes});
    transaction.onerror=()=>reject(transaction.error);
   });
   if(state.currentUser?.id!==user.id)return;
   fields.files.textContent=totals.files;
   fields.notes.textContent=totals.notes;
   fields.folders.textContent=folderNames.size;
  }finally{db.close()}
 }catch(error){
  profileStatus('تعذر عرض إحصاءات هذا الجهاز؛ افتح المكتبة للتحقق منها.');
 }
}
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
async function recoverLocalLibraries(userId,onProgress=()=>{}){
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

async function scanGuestLibraries(){
 const btn=$('scanGuestLibraries'),status=$('guestLibraryScanStatus'),bar=$('guestRecoveryProgress'),result=$('guestRecoveryResult');
 if(!state.currentUser)return;
 btn.disabled=true;bar.hidden=false;bar.value=0;result.textContent='';
 status.textContent='جارٍ البحث عن مكتبات PDF السابقة…';
 try{
  const summary=await recoverLocalLibraries(state.currentUser.id,(done,total,message)=>{
   bar.value=total?Math.round(done/total*100):0;
   status.textContent=message+' — '+done+' / '+total+' ('+bar.value+'٪)';
  });
  if(!summary.libraries){
   bar.hidden=true;
   status.textContent='لم توجد ملفات سابقة قابلة للاستعادة في هذا المتصفح. استخدم الجهاز والمتصفح الأصليين، ولا تمسح بياناتهما.';
   return;
  }
  bar.value=100;
  status.textContent='اكتملت الاستعادة والتحقق من سلامة جميع العناصر.';
  result.textContent='تم التحقق من '+summary.documents+' ملف PDF و'+summary.notes+' تعليق عبر '+summary.libraries+' مكتبة سابقة. أضيف منها '+summary.importedDocs+' ملف و'+summary.importedNotes+' تعليق جديد.';
  await accountLibrarySummary(state.currentUser);
 }catch(error){
  status.textContent='تعذرت الاستعادة أو لم يكتمل التحقق. لم تُحذف الملفات القديمة.';
  result.textContent=error?.message||'خطأ غير معروف';
 }finally{btn.disabled=false}
}
$('scanGuestLibraries').onclick=()=>void scanGuestLibraries();
function showProfile(user){
 state.currentUser=user;
 document.querySelector('.auth-layout')?.classList.add('profile-active');
 $('authPane').hidden=true;$('profilePane').hidden=false;$('returnToProfile').hidden=true;
 $('profileUsername').textContent=user.username||'لم يُحدد';
 $('newProfileUsername').value=user.username||'';
 $('profileEmail').textContent=user.email||'—';
 $('accountRole').textContent=user.role==='admin'?'مدير النظام':'مستخدم';
 $('profileAdminLink').hidden=user.role!=='admin';
 $('accountDeleteTrigger').disabled=user.role==='admin';
 $('deleteSettingStatus').textContent=user.role==='admin'?'لحذف حساب المدير، انقل صلاحية الإدارة إلى حساب آخر أولًا.':'';

 let syncing=false;
 try{syncing=localStorage.getItem('pdf-athat-peer-sync-enabled:'+user.id)==='yes'}catch{}
 $('profileSync').textContent=syncing?'مفعّلة على هذا الجهاز':'غير مفعّلة على هذا الجهاز';
 profileStatus('');
 void accountLibrarySummary(user);

}

function messageFor(id,text){$(id).textContent=text||''}
guard($('profileUsernameForm'),async values=>{
 if(!state.currentUser)throw Error('سجّل الدخول أولًا');
 messageFor('usernameSettingStatus','');
 const result=await post('profile-username',values);
 const pass=$('profileUsernameForm').querySelector('input[name=password]');
 if(pass)pass.value='';
 showProfile(result.user);
 messageFor('usernameSettingStatus','تم تغيير اسم المستخدم بنجاح، ويمكنك تسجيل الدخول بالاسم الجديد.');
},'usernameSettingStatus');
guard($('profileEmailStartForm'),async values=>{
 if(!state.currentUser)throw Error('سجّل الدخول أولًا');
 messageFor('emailSettingStatus','');
 const result=await post('profile-email-start',values);
 state.emailChallenge=result.challengeId;
 $('profileEmailConfirmForm').hidden=false;
 const pass=$('profileEmailStartForm').querySelector('input[name=password]');
 if(pass)pass.value='';
 messageFor('emailSettingStatus',result.message||'تم إرسال رمز التحقق إلى البريد الجديد.');
},'emailSettingStatus');
guard($('profileEmailConfirmForm'),async values=>{
 if(!state.emailChallenge)throw Error('اطلب رمز التحقق أولًا');
 messageFor('emailSettingStatus','');
 const result=await post('profile-email-confirm',{challengeId:state.emailChallenge,code:values.code});
 state.emailChallenge=null;state.currentUser=null;
 $('profileEmailConfirmForm').hidden=true;
 showAuth();tab('login');
 status(result.message||'تم تغيير البريد. سجّل الدخول مرة أخرى.');
},'emailSettingStatus');
$('newProfileEmail').addEventListener('input',()=>{
 state.emailChallenge=null;$('profileEmailConfirmForm').hidden=true;
});
$('accountDeleteTrigger').onclick=()=>{
 if(!state.currentUser||state.currentUser.role==='admin')return;
 const dialog=$('accountDeleteDialog');
 $('accountDeleteError').textContent='';
 $('accountDeleteForm').reset();
 dialog.showModal();
};
$('accountDeleteCancel').onclick=()=>$('accountDeleteDialog').close();
$('accountDeleteForm').addEventListener('submit',async event=>{
 event.preventDefault();
 const form=$('accountDeleteForm');
 const button=$('accountDeleteSubmit');
 const values=Object.fromEntries(new FormData(form));
 const acknowledged=form.querySelector('input[name=acknowledge]')?.checked===true;
 if(!acknowledged||values.confirmation!=='حذف حسابي'){
  $('accountDeleteError').textContent='يجب قراءة التحذير وكتابة عبارة «حذف حسابي» حرفيًا.';
  return;
 }
 if(!confirm('تحذير أخير: هل تريد حذف حسابك نهائيًا؟ لن تتمكن من الدخول إليه مجددًا، وقد لا يمكن استعادة مكتبتك المحلية دون نسخة احتياطية.')){
  return;
 }
 button.disabled=true;$('accountDeleteError').textContent='';
 try{
  const result=await post('profile-delete',{password:values.password,confirmation:values.confirmation,acknowledge:true});
  $('accountDeleteDialog').close();
  form.reset();
  state.currentUser=null;state.emailChallenge=null;
  showAuth();tab('login');
  status(result.message||'تم حذف الحساب. ملفات PDF المحلية لم تُحذف.');
 }catch(error){$('accountDeleteError').textContent=error.message}
 finally{button.disabled=false}
});
$('accountPasswordChange').onclick=()=>{
 if(!state.currentUser)return;
 document.querySelector('.auth-layout')?.classList.remove('profile-active');
 $('profilePane').hidden=true;$('authPane').hidden=false;$('returnToProfile').hidden=false;
 tab('recover');
 $('recoverForm').elements.email.value=state.currentUser.email;
};
$('profileLogout').onclick=async()=>{
 const button=$('profileLogout');button.disabled=true;profileStatus('');
 try{
  await post('logout',{});
  state.currentUser=null;
  showAuth();tab('login');
  status('تم تسجيل الخروج. ملفاتك المحلية محفوظة على هذا الجهاز.');
 }catch(error){profileStatus(error.message)}finally{button.disabled=false}
};
guard($('loginForm'),async values=>{const result=await post('login',values);localStorage.removeItem('pdf-athat-guest-mode');forward(result.user)});
guard($('signupForm'),async values=>{
 if(values.password.length<8)throw Error('كلمة المرور يجب أن تكون 8 أحرف على الأقل');
 const result=await post('signup',values);
 state.signupChallenge=result.challengeId;tab('verify');
 status('أرسلنا رمز التحقق إذا كان البريد واسم المستخدم متاحين. افحص البريد الوارد والرسائل غير المرغوبة.');
});
guard($('verifyForm'),async values=>{
 if(!state.signupChallenge)throw Error('ابدأ بإنشاء الحساب أولًا');
 const result=await post('verify',{challengeId:state.signupChallenge,code:values.code});
 localStorage.removeItem('pdf-athat-guest-mode');
 forward(result.user);
});
guard($('recoverForm'),async values=>{
 const result=await post('forgot',values);
 state.resetChallenge=result.challengeId;tab('reset');
 status('إذا كان البريد مسجلًا فستصلك رسالة برمز الاستعادة.');
});
guard($('resetForm'),async values=>{
 if(!state.resetChallenge)throw Error('اطلب رمز الاستعادة أولًا');
 await post('reset',{challengeId:state.resetChallenge,code:values.code,password:values.password});
 state.currentUser=null;showAuth();tab('login');
 status('تم تغيير كلمة المرور. سجّل الدخول الآن.');
});
async function loadAccount(){
 try{
  const response=await fetch('/api/auth/session',{credentials:'same-origin',cache:'no-store'});
  if(!response.ok)throw Error('تعذر التحقق من جلسة الحساب. يمكنك المحاولة مجددًا.');
  const data=await response.json();
  if(data?.user?.id)showProfile(data.user);
  else{state.currentUser=null;showAuth()}
 }catch(error){
  state.currentUser=null;showAuth();
  status(error.message);
 }
}
void loadAccount();
