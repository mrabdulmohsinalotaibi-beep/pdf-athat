const $=id=>document.getElementById(id);
const view=(id,visible)=>$(id).hidden=!visible;
const notify=message=>{$('status').textContent=message||''};
async function api(path,options={}){
 const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options});
 let data={};try{data=await response.json()}catch{}
 if(!response.ok)throw Error(data.error||'تعذر الاتصال بالخادم');
 return data;
}
const post=(path,data)=>api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
let page=0,query='',owner=null;
async function loadUsers(){
 const result=await api('/api/admin/users?page='+page+'&q='+encodeURIComponent(query));
 $('usersTotal').textContent=result.total+' حساب';
 $('pageLabel').textContent='صفحة '+(page+1)+' من '+Math.max(1,Math.ceil(result.total/30));
 $('pagePrev').disabled=page<=0;
 $('pageNext').disabled=(page+1)*30>=result.total;
 const rows=$('usersRows');rows.replaceChildren();
 if(!result.users.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=4;td.textContent='لا توجد حسابات مطابقة';tr.append(td);rows.append(tr);return}
 for(const user of result.users){
  const tr=document.createElement('tr');
  const identity=document.createElement('td');const name=document.createElement('strong');name.textContent=user.username||'بدون اسم مستخدم';
  const email=document.createElement('small');email.className='sub-email';email.textContent=user.email;identity.append(name,email);
  const role=document.createElement('td');const pill=document.createElement('span');pill.className='role-pill '+(user.role==='admin'?'role-admin':'');pill.textContent=user.role==='admin'?'مدير':'مستخدم';role.append(pill);
  const sessions=document.createElement('td');sessions.textContent=user.sessions;
  const control=document.createElement('td');
  if(user.id===owner?.id){control.textContent='حساب المدير الحالي'}
  else {
   const wrap=document.createElement('div');wrap.className='user-actions';
   const select=document.createElement('select');select.setAttribute('aria-label','صلاحية '+(user.username||user.email));
   for(const [value,label] of [['user','مستخدم'],['admin','مدير']])select.append(new Option(label,value));
   select.value=user.role;
   const save=document.createElement('button');save.textContent='تحديث';save.type='button';
   save.onclick=async()=>{if(select.value===user.role)return; if(!confirm('تغيير صلاحية الحساب سينهي جلساته الحالية. متابعة؟'))return;save.disabled=true;try{await post('/api/admin/role',{id:user.id,role:select.value});notify('تم تحديث الصلاحية بأمان');await refresh()}catch(e){notify(e.message)}finally{save.disabled=false}};
   const revoke=document.createElement('button');revoke.textContent='إنهاء الجلسات';revoke.type='button';revoke.className='secondary';
   revoke.onclick=async()=>{if(!confirm('إنهاء كل جلسات هذا الحساب؟ لن تُحذف الملفات المخزنة على أجهزته.'))return;revoke.disabled=true;try{const res=await post('/api/admin/revoke',{id:user.id});notify('أُنهِيت '+res.revoked+' جلسة');await refresh()}catch(e){notify(e.message)}finally{revoke.disabled=false}};
   wrap.append(select,save,revoke);control.append(wrap);
  }
  tr.append(identity,role,sessions,control);rows.append(tr);
 }
}

async function loadAudit(){
 const container=$('auditList');container.replaceChildren();
 try{
  const result=await api('/api/admin/audit');
  if(!result.events?.length){const empty=document.createElement('p');empty.textContent='لا توجد إجراءات إدارية مسجلة بعد.';container.append(empty);return}
  const labels={change_role:'تغيير صلاحية',revoke_sessions:'إنهاء جلسات',transfer_ownership:'نقل ملكية الإدارة'};
  for(const event of result.events){
   const row=document.createElement('div');row.className='admin-audit-entry';
   const title=document.createElement('strong');title.textContent=(labels[event.action]||'إجراء إداري')+' · '+event.actor;
   const details=document.createElement('small');
   const time=Number.isFinite(event.created_at)?new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura',{dateStyle:'medium',timeStyle:'short'}).format(new Date(event.created_at*1000)):'';
   details.textContent='الحساب المعني: '+event.target+' · '+time+(event.details?' · '+event.details:'');
   row.append(title,details);container.append(row);
  }
 }catch(error){const p=document.createElement('p');p.textContent='تعذر قراءة سجل الإدارة: '+error.message;container.append(p)}
}
function csvSafe(value){
 const text=String(value??'');
 const guarded=/^[\s]*[=+@-]/.test(text)?"'"+text:text;
 return '"'+guarded.replaceAll('"','""')+'"';
}
$('exportUsers').onclick=async()=>{
 const button=$('exportUsers');button.disabled=true;
 try{
  const records=[];
  for(let i=0;i<100;i++){
   const pageData=await api('/api/admin/users?page='+i);
   records.push(...pageData.users);
   if(records.length>=pageData.total||pageData.users.length<30)break;
  }
  const rows=[['اسم المستخدم','البريد الإلكتروني','الصلاحية','تاريخ إنشاء الحساب','عدد الجلسات'],...records.map(user=>[user.username||'',user.email,user.role,user.created_at?new Date(user.created_at*1000).toISOString():'',user.sessions])];
  const text='\ufeff'+rows.map(row=>row.map(csvSafe).join(',')).join('\r\n');
  const file=new Blob([text],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(file);
  const link=document.createElement('a');link.href=url;link.download='PDF-ATHAT-users-'+new Date().toISOString().slice(0,10)+'.csv';
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);
  notify('أُنشئ ملف الحسابات محليًا. احفظه في مكان آمن لأنه يتضمن عناوين بريد المستخدمين.');
 }catch(error){notify('تعذر تصدير الحسابات: '+error.message)}
 finally{button.disabled=false}
};
async function refresh(){
 notify('');
 const info=await api('/api/auth/session');
 view('loginPane',!info.user);view('deniedPane',false);view('dashboard',false);
 if(!info.user)return;
 if(info.user.role!=='admin'){view('deniedPane',true);return;}
 owner=info.user;view('dashboard',true);
 $('welcomeEmail').textContent='مرحبًا '+(info.user.username||info.user.email)+' · '+info.user.email;
 const data=await api('/api/admin/overview');
 for(const [key,val] of [['statUsers',data.users],['statAdmins',data.admins],['statSessions',data.activeSessions],['statRecent',data.recentUsers],['statPending',data.pendingVerifications]])$(key).textContent=val;
 $('mailStatus').textContent='خدمة رسائل التحقق: '+(data.mailConfigured?'إعداداتها مفعّلة (وصول البريد يحتاج اختبارًا)':'الإعدادات غير مكتملة');
 $('healthStatus').textContent='اتصال قاعدة الحسابات: يعمل · ملفات المستخدمين محفوظة على أجهزتهم فقط';
 await loadUsers();
 await loadAudit();
}
let transferChallengeId='';
const transferStatus=message=>$('transferStatus').textContent=message;
$('transferStartForm').onsubmit=async event=>{
 event.preventDefault();
 const form=event.currentTarget,button=form.querySelector('button[type=submit]');
 const values=Object.fromEntries(new FormData(form));button.disabled=true;transferStatus('');
 try{
  const result=await post('/api/admin/transfer-start',values);
  transferChallengeId=result.challengeId;
  $('transferConfirmForm').hidden=false;
  form.querySelector('input[name=password]').value='';
  transferStatus('تم إرسال رمز التحقق إلى البريد الجديد. أكد الرمز خلال عشر دقائق.');
 }catch(error){transferStatus(error.message)}finally{button.disabled=false}
};
$('transferConfirmForm').onsubmit=async event=>{
 event.preventDefault();
 const form=event.currentTarget,button=form.querySelector('button[type=submit]');
 if(!transferChallengeId)return transferStatus('اطلب رمز النقل أولًا');
 if(!confirm('هل تؤكد نقل صلاحية المدير إلى البريد الجديد وإلغاء صلاحية الحساب الحالي؟'))return;
 button.disabled=true;
 try{
  const data=await post('/api/admin/transfer-confirm',{challengeId:transferChallengeId,code:form.querySelector('input[name=code]').value});
  transferChallengeId='';
  alert(data.message);
  location.replace('/account.html');
 }catch(error){transferStatus(error.message)}finally{button.disabled=false}
};
$('userSearchForm').onsubmit=event=>{event.preventDefault();query=$('userSearch').value.trim();page=0;loadUsers().catch(e=>notify(e.message))};
$('pagePrev').onclick=()=>{if(page>0){page--;loadUsers().catch(e=>notify(e.message))}};
$('pageNext').onclick=()=>{page++;loadUsers().catch(e=>notify(e.message))};
$('refreshBtn').onclick=()=>refresh().catch(e=>notify(e.message));
async function logout(){try{await post('/api/auth/logout',{});await refresh()}catch(e){notify(e.message)}}
$('logoutBtn').onclick=logout;$('deniedLogout').onclick=logout;
refresh().catch(e=>{view('loginPane',true);notify(e.message)});
