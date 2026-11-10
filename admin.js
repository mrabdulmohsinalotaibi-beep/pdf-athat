const $=id=>document.getElementById(id);
const view=(id,visible)=>$(id).hidden=!visible;
const notify=message=>{$('status').textContent=message||''};
async function api(path,options={}) {
 const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options});
 let data={};try{data=await response.json()}catch{}
 if(!response.ok)throw Error(data.error||'تعذر الاتصال بالخادم');
 return data;
}
const post=(path,data)=>api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
let challengeId='';
async function refresh() {
 notify('');
 const info=await api('/api/auth/session');
 view('loginPane',!info.user);
 view('deniedPane',false);view('dashboard',false);
 if(!info.user)return;
 if(info.user.role!=='admin'){view('deniedPane',true);return;}
 view('loginPane',false);view('dashboard',true);
 $('welcomeEmail').textContent=info.user.email;
 const [overview,users]=await Promise.all([api('/api/admin/overview'),api('/api/admin/users')]);
 $('statUsers').textContent=overview.users;
 $('statAdmins').textContent=overview.admins;
 $('statSessions').textContent=overview.activeSessions;
 $('mailStatus').textContent=overview.mailConfigured?'إرسال رسائل التحقق: مهيأ':'إرسال رسائل التحقق: غير مهيأ';
 const rows=$('usersRows');rows.replaceChildren();
 for(const user of users.users){
  const tr=document.createElement('tr');
  const email=document.createElement('td');email.textContent=user.email;
  const role=document.createElement('td');role.textContent=user.role==='admin'?'مدير':'مستخدم';
  const control=document.createElement('td');
  if(user.id===info.user.id){control.textContent='حسابك الحالي';}
  else{
   const select=document.createElement('select');
   for(const [value,label] of [['user','مستخدم'],['admin','مدير']]){const option=new Option(label,value);select.append(option)}
   select.value=user.role;select.setAttribute('aria-label','صلاحية '+user.email);
   const button=document.createElement('button');button.textContent='حفظ';button.style.marginInlineStart='8px';
   button.onclick=async()=>{button.disabled=true;try{await post('/api/admin/role',{id:user.id,role:select.value});notify('تم تحديث الصلاحية وإلغاء جلسات الحساب');await refresh()}catch(e){notify(e.message)}finally{button.disabled=false}};
   control.append(select,button);
  }
  tr.append(email,role,control);rows.append(tr);
 }
}
$('loginForm').onsubmit=async event=>{event.preventDefault();notify('');try{await post('/api/auth/login',{email:$('email').value,password:$('password').value});$('password').value='';await refresh()}catch(e){notify(e.message)}};
$('signupForm').onsubmit=async event=>{event.preventDefault();try{const data=await post('/api/auth/signup',{email:$('newEmail').value,password:$('newPassword').value});challengeId=data.challengeId;view('verifyForm',true);notify('إذا كان البريد متاحًا فسيصلك رمز التحقق.')}catch(e){notify(e.message)}};
$('verifyForm').onsubmit=async event=>{event.preventDefault();try{await post('/api/auth/verify',{challengeId,code:$('verifyCode').value});$('newPassword').value='';await refresh()}catch(e){notify(e.message)}};
async function logout(){try{await post('/api/auth/logout',{});await refresh()}catch(e){notify(e.message)}}
$('logoutBtn').onclick=logout;$('deniedLogout').onclick=logout;
refresh().catch(e=>{view('loginPane',true);notify(e.message)});
