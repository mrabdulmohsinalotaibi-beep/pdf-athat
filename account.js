const $=id=>document.getElementById(id);
const state={signupChallenge:null,resetChallenge:null};
const status=message=>$('authStatus').textContent=message||'';
const post=async(path,body)=>{const res=await fetch('/api/auth/'+path,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',cache:'no-store',body:JSON.stringify(body)});const data=await res.json().catch(()=>({}));if(!res.ok)throw Error(data.error||'تعذر إكمال الطلب');return data};
function tab(name){for(const b of document.querySelectorAll('[data-tab]'))b.setAttribute('aria-selected',String(b.dataset.tab===name));for(const id of ['login','signup','recover','verify','reset'])$(id+'Form').hidden=id!==name;status('')}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>tab(b.dataset.tab));
function guard(form,handler){form.addEventListener('submit',async e=>{e.preventDefault();const b=form.querySelector('button[type=submit]');b.disabled=true;status('');try{await handler(Object.fromEntries(new FormData(form)))}catch(err){status(err.message)}finally{b.disabled=false}})}
function forward(){const target=new URLSearchParams(location.search).get('next');location.replace(target==='/admin.html'?'/admin.html':'/')}
guard($('loginForm'),async values=>{await post('login',values);forward()});
guard($('signupForm'),async values=>{if(values.password.length<8)throw Error('كلمة المرور يجب أن تكون 8 أحرف على الأقل');const result=await post('signup',values);state.signupChallenge=result.challengeId;tab('verify');status('أرسلنا رمز التحقق إذا كان البريد واسم المستخدم متاحين. افحص البريد الوارد والرسائل غير المرغوبة.')});
guard($('verifyForm'),async values=>{if(!state.signupChallenge)throw Error('ابدأ بإنشاء الحساب أولًا');await post('verify',{challengeId:state.signupChallenge,code:values.code});forward()});
guard($('recoverForm'),async values=>{const result=await post('forgot',values);state.resetChallenge=result.challengeId;tab('reset');status('إذا كان البريد مسجلًا فستصلك رسالة برمز الاستعادة.')});
guard($('resetForm'),async values=>{if(!state.resetChallenge)throw Error('اطلب رمز الاستعادة أولًا');await post('reset',{challengeId:state.resetChallenge,code:values.code,password:values.password});tab('login');status('تم تغيير كلمة المرور. سجّل الدخول الآن.')});
fetch('/api/auth/session',{credentials:'same-origin',cache:'no-store'}).then(r=>r.ok?r.json():null).then(d=>{if(d?.user)forward()}).catch(()=>{});
