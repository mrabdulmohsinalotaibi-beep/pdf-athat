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

const adminViews=['overview','users','ads','health','audit','security','transferPanel'];
function selectAdminView(){
 const requested=location.hash.slice(1);
 const active=adminViews.includes(requested)?requested:'overview';
 for(const id of adminViews)$(id).hidden=id!==active;
 for(const link of document.querySelectorAll('.admin-sections a')){
  const current=link.getAttribute('href')==='#'+active;
  if(current)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
 }
 const holder=document.querySelector('.sections');
 if(holder)holder.hidden=active==='overview';
 window.scrollTo({top:0,behavior:'instant'});
}
window.addEventListener('hashchange',selectAdminView);

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
  const identity=document.createElement('td');identity.dataset.label='الحساب';const name=document.createElement('strong');name.textContent=user.username||'بدون اسم مستخدم';
  const email=document.createElement('small');email.className='sub-email';email.textContent=user.email;identity.append(name,email);
  const role=document.createElement('td');role.dataset.label='الصلاحية';const pill=document.createElement('span');pill.className='role-pill '+(user.role==='admin'?'role-admin':'');pill.textContent=user.role==='admin'?'مدير':'مستخدم';role.append(pill);
  const sessions=document.createElement('td');sessions.dataset.label='الجلسات';sessions.textContent=user.sessions;
  const control=document.createElement('td');control.dataset.label='الإجراء';
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

const adTime=seconds=>{
 if(!Number.isFinite(seconds))return '';
 const d=new Date(seconds*1000);
 const local=new Date(d.getTime()-d.getTimezoneOffset()*60000);
 return local.toISOString().slice(0,16);
};
const adDateLabel=seconds=>new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura',{dateStyle:'medium',timeStyle:'short'}).format(new Date(seconds*1000));
const adMessage=message=>{$('adStatus').textContent=message||''};
let managedAds=[];
function resetAd(){
 $('adForm').reset();$('adId').value='';$('adEnabled').checked=true;
 const start=new Date();const end=new Date(start.getTime()+7*86400000);
 $('adStart').value=adTime(Math.floor(start.getTime()/1000));
 $('adEnd').value=adTime(Math.floor(end.getTime()/1000));
 $('adDuration').value='0';adMessage('');
}
async function loadAds(){
 const result=await api('/api/admin/ads');
 managedAds=result.ads||[];
 const list=$('adList');list.replaceChildren();
 if(!managedAds.length){const p=document.createElement('p');p.textContent='لم تُنشئ أي إعلان بعد.';list.append(p);return}
 const now=Math.floor(Date.now()/1000);
 for(const ad of managedAds){
  const item=document.createElement('article');item.className='ad-item';
  const header=document.createElement('div');header.className='ad-item-header';
  const title=document.createElement('strong');title.textContent=ad.title;
  const badge=document.createElement('span');badge.className='ad-tag';
  const phase=!ad.enabled?'متوقف':ad.ends_at<=now?'انتهى':ad.starts_at>now?'مجدول':'ظاهر الآن';
  badge.textContent=phase;if(phase==='ظاهر الآن')badge.classList.add('live');else badge.classList.add('paused');
  header.append(title,badge);item.append(header);
  if(ad.body){const p=document.createElement('p');p.textContent=ad.body;item.append(p)}
  const schedule=document.createElement('small');schedule.textContent='من '+adDateLabel(ad.starts_at)+' إلى '+adDateLabel(ad.ends_at)+(ad.duration_seconds?' · مدة العرض '+ad.duration_seconds+' ثانية':' · حتى الإخفاء');item.append(schedule);
  const actions=document.createElement('div');actions.className='ad-item-actions';
  const edit=document.createElement('button');edit.type='button';edit.className='secondary';edit.textContent='تعديل';
  edit.onclick=()=>{
   $('adId').value=ad.id;$('adTitle').value=ad.title;$('adBody').value=ad.body;$('adLink').value=ad.link_url;
   $('adStart').value=adTime(ad.starts_at);$('adEnd').value=adTime(ad.ends_at);$('adDuration').value=String(ad.duration_seconds);$('adEnabled').checked=!!ad.enabled;
   $('adForm').scrollIntoView({behavior:'smooth',block:'center'});$('adTitle').focus();
  };
  const toggle=document.createElement('button');toggle.type='button';toggle.className='secondary';toggle.textContent=ad.enabled?'إيقاف':'تفعيل';
  toggle.onclick=async()=>{toggle.disabled=true;try{await post('/api/admin/ad-toggle',{id:ad.id});await loadAds();adMessage('تم تغيير حالة الإعلان')}catch(e){adMessage(e.message)}finally{toggle.disabled=false}};
  const remove=document.createElement('button');remove.type='button';remove.className='secondary';remove.textContent='حذف';
  remove.onclick=async()=>{if(!confirm('حذف هذا الإعلان نهائيًا؟'))return;remove.disabled=true;try{await post('/api/admin/ad-delete',{id:ad.id});if($('adId').value===ad.id)resetAd();await loadAds();adMessage('تم حذف الإعلان')}catch(e){adMessage(e.message)}finally{remove.disabled=false}};
  actions.append(edit,toggle,remove);item.append(actions);list.append(item);
 }
}
$('adReset').onclick=resetAd;
$('adForm').onsubmit=async event=>{
 event.preventDefault();const button=$('adSave');button.disabled=true;
 try{
  const start=Math.floor(new Date($('adStart').value).getTime()/1000);
  const end=Math.floor(new Date($('adEnd').value).getTime()/1000);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end)throw Error('تأكد أن وقت النهاية بعد البداية');
  await post('/api/admin/ad-save',{
   id:$('adId').value||undefined,title:$('adTitle').value,body:$('adBody').value,link_url:$('adLink').value,
   starts_at:start,ends_at:end,duration_seconds:Number($('adDuration').value),enabled:$('adEnabled').checked
  });
  resetAd();await loadAds();adMessage('تم حفظ الإعلان والجدولة');
 }catch(e){adMessage(e.message)}finally{button.disabled=false}
};
resetAd();
async function refresh(){
 notify('');
 const info=await api('/api/auth/session');
 view('loginPane',!info.user);view('deniedPane',false);view('dashboard',false);
 if(!info.user)return;
 if(info.user.role!=='admin'){view('deniedPane',true);return;}
 owner=info.user;view('dashboard',true);
 selectAdminView();
 $('welcomeEmail').textContent='مرحبًا '+(info.user.username||info.user.email)+' · '+info.user.email;
 const data=await api('/api/admin/overview');
 for(const [key,val] of [['statUsers',data.users],['statAdmins',data.admins],['statSessions',data.activeSessions],['statRecent',data.recentUsers],['statPending',data.pendingVerifications]])$(key).textContent=val;
 $('mailStatus').textContent='خدمة رسائل التحقق: '+(data.mailConfigured?'إعداداتها مفعّلة (وصول البريد يحتاج اختبارًا)':'الإعدادات غير مكتملة');
 $('healthStatus').textContent='اتصال قاعدة الحسابات: يعمل · ملفات المستخدمين محفوظة على أجهزتهم فقط';
 await Promise.all([loadUsers(),loadAudit(),loadAds()]);
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
