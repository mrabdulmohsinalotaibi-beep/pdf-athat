// Production-only account gate. The PDF reader is not loaded until a server session is verified.
(async()=>{
 const panel=document.getElementById('app');
 if(panel)panel.hidden=true;
 try {
  // Guest access is explicit and local to this browser. Existing anonymous books
  // remain in the original pdf-athat-v1 IndexedDB; signed-in libraries use IDs.
  const guestMode=localStorage.getItem('pdf-athat-guest-mode')==='yes';
  let user=null;
  if(!guestMode){
   const response=await fetch('/api/auth/session',{credentials:'same-origin',cache:'no-store'});
   if(!response.ok)throw Error('تعذر التحقق من الحساب');
   const data=await response.json();
   user=data?.user?.id?data.user:null;
   if(!user){location.replace('/account.html');return;}
  }
  if(user)window.__pdfAccountId=user.id;
  else delete window.__pdfAccountId;
  // Each completed guest-to-account link closes that guest library and opens a
  // fresh anonymous library. Previous files remain as local recovery archives,
  // never shown again to a guest after they have been linked to an account.
  const guestLibrary=localStorage.getItem('pdf-athat-active-guest-library');
  window.__pdfGuestDBName=guestLibrary && /^pdf-athat-guest-[a-f0-9-]{36}$/.test(guestLibrary)
   ? guestLibrary : 'pdf-athat-v1';
  window.__pdfGuestMode=guestMode;
  // Rotate an already-open guest tab when another tab finishes linking its
  // library to an account; never leave the old guest files visible.
  if(guestMode)window.addEventListener('storage',event=>{
   if(event.key==='pdf-athat-active-guest-library')location.reload();
  });
  if(panel)panel.hidden=false;
  const actions=document.querySelector('.header-actions');
  if(actions){
   if(user?.role==='admin'){
    const adminLink=document.createElement('a');adminLink.href='/admin.html';
    adminLink.className='subtle-btn';adminLink.textContent='الإدارة';
    adminLink.title='لوحة إدارة PDF.ATHAT';
    adminLink.style.cssText='font-size:12px;text-decoration:none;white-space:nowrap;padding:8px';
    actions.prepend(adminLink);
   }
   const link=document.createElement('a');link.href='/account.html';link.className='subtle-btn';
   link.textContent=user?'حسابي':'تسجيل / حساب';
   link.title=user?'الحساب: '+(user.username||user.email):'تسجيل الدخول أو إنشاء حساب للمزامنة';
   link.style.cssText='font-size:12px;text-decoration:none;white-space:nowrap;padding:8px';
   actions.prepend(link);
   const exit=document.createElement('button');exit.type='button';
   exit.className='subtle-btn';exit.textContent=user?'خروج':'إنهاء الزائر';
   exit.onclick=async()=>{
    if(guestMode){
     localStorage.removeItem('pdf-athat-guest-mode');
     location.replace('/account.html');
     return;
    }
    try{
     const result=await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json'},body:'{}'});
     if(!result.ok)throw Error('فشل تسجيل الخروج');
     location.replace('/account.html');
    }catch{alert('تعذر تسجيل الخروج')}
   };
   actions.append(exit);
  }
  await import('./app-v2.js');
  import('./prayer-bar.js').catch(()=>{});
  // Pilot is visible only after server-verified admin role; never enabled for guests.
  if(user?.role==='admin')import('./admin-prayer-notification-pilot.js').then(m=>m.mountAdminPrayerNotificationPilot(user)).catch(()=>{});
  import('./site-ads.js').catch(()=>{});
  // Never copy a registered user's library into the anonymous guest library.
  if(user){
   import('./legacy-import.js').catch(()=>{});
   import('./peer-sync.js').catch(error=>console.warn('peer_sync_disabled',error?.name));
  }

 } catch(error){
  if(panel){panel.hidden=false;panel.replaceChildren();}
  const alertBox=document.createElement('main');alertBox.dir='rtl';alertBox.style.cssText='max-width:520px;margin:14vh auto;padding:24px;background:#efe3d4;border-radius:18px;font:16px system-ui;text-align:center';
  const h=document.createElement('h2');h.textContent='تعذر فتح الجلسة';
  const p=document.createElement('p');p.textContent='اتصل بالإنترنت للتحقق من الحساب. ملفاتك ما زالت محفوظة على هذا الجهاز.';
  const a=document.createElement('a');a.href='/account.html';a.textContent='صفحة تسجيل الدخول';
  alertBox.append(h,p,a);document.body.append(alertBox);
 }
})();
