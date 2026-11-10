const $=id=>document.getElementById(id);
const state={signupChallenge:null,resetChallenge:null};
const status=message=>$('authStatus').textContent=message||'';
const post=async(path,body)=>{const res=await fetch('/api/auth/'+path,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',cache:'no-store',body:JSON.stringify(body)});const data=await res.json().catch(()=>({}));if(!res.ok)throw Error(data.error||'تعذر إكمال الطلب');return data};
function tab(name){for(const b of document.querySelectorAll('[data-tab]'))b.setAttribute('aria-selected',String(b.dataset.tab===name));for(const id of ['login','signup','recover','verify','reset'])$(id+'Form').hidden=id!==name;status('')}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>tab(b.dataset.tab));
function guard(form,handler){form.addEventListener('submit',async e=>{e.preventDefault();const b=form.querySelector('button[type=submit]');b.disabled=true;status('');try{await handler(Object.fromEntries(new FormData(form)))}catch(err){status(err.message)}finally{b.disabled=false}})}
function forward(user){ const isAdmin=user?.role==='admin'; location.replace(isAdmin?'/admin.html':'/'); }
// "حسابي" must display the existing authenticated user's account,
// never silently bounce a signed-in reader to the library or login form.
let signedUser=null;
function showProfile(user){
 if(!user?.id)throw Error('جلسة الحساب غير صالحة');
 signedUser=user;
 $('accountLoading').hidden=true;
 $('authLayout').hidden=true;
 $('profileLayout').hidden=false;
 $('returnToProfile').hidden=true;
 $('profileUsername').textContent=user.username||'غير محدد';
 $('profileEmail').textContent=user.email||'غير محدد';
 $('profileRole').textContent=user.role==='admin'?'مدير النظام':'مستخدم';
 $('profileAdmin').hidden=user.role!=='admin';
 $('profileMessage').textContent='';
}
function showLogin(){
 signedUser=null;
 $('accountLoading').hidden=true;
 $('profileLayout').hidden=true;
 $('authLayout').hidden=false;
 $('returnToProfile').hidden=true;
 tab('login');
}
$('profilePassword').onclick=()=>{
 if(!signedUser)return;
 $('profileLayout').hidden=true;
 $('authLayout').hidden=false;
 $('returnToProfile').hidden=false;
 tab('recover');
 const email=$('recoverForm').querySelector('input[name="email"]');
 if(email)email.value=signedUser.email||'';
};
$('returnToProfile').onclick=()=>{if(signedUser)showProfile(signedUser);else showLogin()};
$('profileLogout').onclick=async()=>{
 const button=$('profileLogout');
 button.disabled=true;
 $('profileMessage').textContent='';
 try{
  await post('logout',{});
  signedUser=null;
  location.replace('/account.html');
 }catch(error){
  $('profileMessage').textContent=error.message||'تعذر تسجيل الخروج';
  button.disabled=false;
 }
};
guard($('loginForm'),async values=>{const result=await post('login',values);forward(result.user)});
guard($('signupForm'),async values=>{if(values.password.length<8)throw Error('كلمة المرور يجب أن تكون 8 أحرف على الأقل');const result=await post('signup',values);state.signupChallenge=result.challengeId;tab('verify');status('أرسلنا رمز التحقق إذا كان البريد واسم المستخدم متاحين. افحص البريد الوارد والرسائل غير المرغوبة.')});
guard($('verifyForm'),async values=>{if(!state.signupChallenge)throw Error('ابدأ بإنشاء الحساب أولًا');const result=await post('verify',{challengeId:state.signupChallenge,code:values.code});forward(result.user)});
guard($('recoverForm'),async values=>{const result=await post('forgot',values);state.resetChallenge=result.challengeId;tab('reset');status('إذا كان البريد مسجلًا فستصلك رسالة برمز الاستعادة.')});
guard($('resetForm'),async values=>{if(!state.resetChallenge)throw Error('اطلب رمز الاستعادة أولًا');await post('reset',{challengeId:state.resetChallenge,code:values.code,password:values.password});signedUser=null;$('returnToProfile').hidden=true;tab('login');status('تم تغيير كلمة المرور. سجّل الدخول الآن.')});
fetch('/api/auth/session',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(12000)})
 .then(async response=>{
  if(!response.ok)throw Error('خدمة الحسابات غير متاحة حاليًا');
  return response.json();
 })
 .then(data=>{if(data?.user?.id)showProfile(data.user);else showLogin()})
 .catch(()=>{
  // An outage is not proof of logout: don't redirect or erase any local PDF files.
  $('accountLoading').textContent='تعذر التحقق من الجلسة حاليًا. أعد فتح الصفحة عند عودة الاتصال. ملفاتك المحلية محفوظة على الجهاز.';
  $('accountLoading').hidden=false;
  $('authLayout').hidden=true;
  $('profileLayout').hidden=true;
 });
