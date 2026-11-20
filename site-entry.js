// Browser entrypoint: read previously verified, device-local libraries even without network.
// Server authentication is always authoritative when reachable. Never migrate or delete PDFs.
(async()=>{
 'use strict';
 const OFFLINE_KEY='pdf-athat-last-verified-user-v1';
 const PENDING_LOGOUT='pdf-athat-offline-logout-pending-v1';
 const panel=document.getElementById('app');
 const storedUser=()=>{
  try{
   if(localStorage.getItem(PENDING_LOGOUT)==='yes')return null;
   const user=JSON.parse(localStorage.getItem(OFFLINE_KEY)||'null');
   return user&&typeof user.id==='string'&&user.id.length>0&&user.id.length<=150?user:null;
  }catch{return null}
 };
 const remember=user=>{
  if(user&&typeof user.id==='string'&&user.id.length<=150){
   try{localStorage.setItem(OFFLINE_KEY,JSON.stringify({
    id:user.id,username:String(user.username||'').slice(0,100),
    email:String(user.email||'').slice(0,180),role:user.role==='admin'?'admin':'user'
   }))}catch{}
  }
 };
 const forget=()=>{try{localStorage.removeItem(OFFLINE_KEY)}catch{}};
 const onlineRequest=async(url,options={})=>{
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),6500);
  try{return await fetch(url,{credentials:'same-origin',cache:'no-store',...options,signal:controller.signal})}
  finally{clearTimeout(timeout)}
 };
 try{
  // Guest mode is opt-in and never exposes the local library of a registered user.
  const guestMode=localStorage.getItem('pdf-athat-guest-mode')==='yes';
  let user=null,offlineSession=false;
  if(!guestMode){
   if(localStorage.getItem(PENDING_LOGOUT)==='yes'){
    if(navigator.onLine){
     try{
      const response=await onlineRequest('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      if(response.ok)localStorage.removeItem(PENDING_LOGOUT);
     }catch{}
    }
    location.replace('/account.html');return;
   }
   if(!navigator.onLine){
    user=storedUser();offlineSession=!!user;
    if(!user)throw Error('لا يوجد حساب سبق التحقق منه على هذا الجهاز. افتح التطبيق بالإنترنت مرة واحدة.');
   }else{
    try{
     const response=await onlineRequest('/api/auth/session');
     // A definite unauthorized response must NEVER unlock the offline cache.
     if(response.status===401||response.status===403){
      forget();location.replace('/account.html');return;
     }
     if(!response.ok)throw Error('تعذر الوصول إلى خدمة الحسابات');
     const data=await response.json();
     user=data?.user?.id?data.user:null;
     if(!user){forget();location.replace('/account.html');return}
     remember(user);
    }catch(error){
     // Network failure only: preserve the last *verified* account on this device.
     user=storedUser();offlineSession=!!user;
     if(!user)throw error;
    }
   }
  }
  if(user)window.__pdfAccountId=user.id;
  else delete window.__pdfAccountId;
  window.__pdfOfflineSession=offlineSession;

  // Keep old and linked libraries isolated. Never rewrite or clear IndexedDB.
  const guestLibrary=localStorage.getItem('pdf-athat-active-guest-library');
  window.__pdfGuestDBName=guestLibrary&&/^pdf-athat-guest-[a-f0-9-]{36}$/.test(guestLibrary)
   ?guestLibrary:'pdf-athat-v1';
  window.__pdfGuestMode=guestMode;
  if(guestMode)window.addEventListener('storage',event=>{
   if(event.key==='pdf-athat-active-guest-library')location.reload();
  });

  if(panel)panel.hidden=false;
  const actions=document.querySelector('.header-actions');
  if(actions){
   if(user?.role==='admin'&&!offlineSession){
    const adminLink=document.createElement('a');adminLink.href='/admin.html';
    adminLink.className='subtle-btn';adminLink.textContent='الإدارة';
    adminLink.title='لوحة إدارة PDF.ATHAT';
    adminLink.style.cssText='font-size:12px;text-decoration:none;white-space:nowrap;padding:8px';
    actions.prepend(adminLink);
   }
   const link=document.createElement('a');link.href='/account.html';link.className='subtle-btn';
   link.textContent=user?'حسابي':'تسجيل / حساب';
   link.title=user?'الحساب: '+(user.username||user.email||'مكتبتي'):'تسجيل الدخول أو إنشاء حساب للمزامنة';
   link.style.cssText='font-size:12px;text-decoration:none;white-space:nowrap;padding:8px';
   actions.prepend(link);
   const exit=document.createElement('button');exit.type='button';
   exit.className='subtle-btn';exit.textContent=user?'خروج':'إنهاء الزائر';
   exit.onclick=async()=>{
    if(guestMode){
     localStorage.removeItem('pdf-athat-guest-mode');
     location.replace('/account.html');return;
    }
    if(!navigator.onLine||offlineSession){
     // Log out locally now, and revoke the server session on next connectivity.
     forget();localStorage.setItem(PENDING_LOGOUT,'yes');
     location.replace('/account.html');return;
    }
    try{
     const result=await onlineRequest('/api/auth/logout',{
      method:'POST',headers:{'Content-Type':'application/json'},body:'{}'
     });
     if(!result.ok)throw Error('فشل تسجيل الخروج');
     forget();localStorage.removeItem(PENDING_LOGOUT);
     location.replace('/account.html');
    }catch{alert('تعذر تسجيل الخروج. أعد المحاولة، أو أوقف الإنترنت للخروج محليًا.')}
   };
   actions.append(exit);
   if(offlineSession){
    const note=document.createElement('span');
    note.textContent='وضع دون إنترنت';
    note.title='القراءة والحفظ المحلي متاحان. المزامنة تنتظر اتصال الإنترنت والجهاز الآخر.';
    note.style.cssText='font-size:11px;color:#780000;white-space:nowrap';
    actions.prepend(note);
   }
  }

  await import('./app-v2.js');
  document.documentElement.dataset.pdfBootReady='yes';
  // Optional online integrations must not block the offline reader.
  if(navigator.onLine)import('./prayer-bar.js').then(async()=>{
   const m=await import('./admin-prayer-notification-pilot.js');m.mountPrayerNotificationTest();
   const push=await import('./prayer-background-push.js');await push.mountPrayerBackgroundPush();
  }).catch(()=>{});
  if(navigator.onLine)import('./site-ads.js').catch(()=>{});
  if(user)import('./peer-sync.js').catch(error=>console.warn('peer_sync_disabled',error?.name));

 }catch(error){
  document.documentElement.dataset.pdfBootReady='error';
  if(panel)panel.hidden=true;
  const alertBox=document.createElement('main');alertBox.dir='rtl';
  alertBox.style.cssText='max-width:520px;margin:12vh auto;padding:24px;background:#efe3d4;border:1px solid #b89a83;border-radius:18px;color:#563c2e;font:16px system-ui;text-align:center;line-height:1.8';
  const h=document.createElement('h2');h.textContent='تعذر فتح المكتبة المحلية';
  const p=document.createElement('p');p.textContent=error?.message||'تعذر تحميل ملفات تشغيل التطبيق. ملفاتك المحلية لم تُحذف.';
  const retry=document.createElement('button');retry.type='button';retry.textContent='إعادة المحاولة';
  retry.style.cssText='padding:10px 16px;margin:8px;border:0;border-radius:9px;background:#780000;color:white;font:inherit';
  retry.onclick=()=>location.reload();
  const a=document.createElement('a');a.href='/account.html';a.textContent='صفحة الحساب';
  a.style.cssText='display:inline-block;margin:12px;color:#780000';
  alertBox.append(h,p,retry,a);document.body.append(alertBox);
 }
})();
