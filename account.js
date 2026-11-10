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
 $('profilePane').hidden=true;$('authPane').hidden=false;$('returnToProfile').hidden=true;
}
function forward(user){
 location.replace(user?.role==='admin'?'/admin.html':'/');
}
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
function showProfile(user){
 state.currentUser=user;
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
guard($('loginForm'),async values=>{const result=await post('login',values);forward(result.user)});
guard($('signupForm'),async values=>{
 if(values.password.length<8)throw Error('كلمة المرور يجب أن تكون 8 أحرف على الأقل');
 const result=await post('signup',values);
 state.signupChallenge=result.challengeId;tab('verify');
 status('أرسلنا رمز التحقق إذا كان البريد واسم المستخدم متاحين. افحص البريد الوارد والرسائل غير المرغوبة.');
});
guard($('verifyForm'),async values=>{
 if(!state.signupChallenge)throw Error('ابدأ بإنشاء الحساب أولًا');
 const result=await post('verify',{challengeId:state.signupChallenge,code:values.code});
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
