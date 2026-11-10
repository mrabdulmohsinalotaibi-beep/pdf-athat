// Production-only account gate. The PDF reader is not loaded until a server session is verified.
(async()=>{
 const panel=document.getElementById('app');
 if(panel)panel.hidden=true;
 try {
  const response=await fetch('/api/auth/session',{credentials:'same-origin',cache:'no-store'});
  if(!response.ok)throw Error('تعذر التحقق من الحساب');
  const data=await response.json();
  if(!data?.user?.id){location.replace('/account.html');return;}
  // Server-assigned immutable account ID selects a distinct local IndexedDB database.
  window.__pdfAccountId=data.user.id;
  if(panel)panel.hidden=false;
  const actions=document.querySelector('.header-actions');
  if(actions){
   if(data.user.role==='admin'){
    const adminLink=document.createElement('a');adminLink.href='/admin.html';adminLink.className='subtle-btn';adminLink.textContent='لوحة الإدارة';adminLink.style.cssText='font-size:12px;text-decoration:none;white-space:nowrap;padding:8px';actions.prepend(adminLink);
   }
   const link=document.createElement('a');link.href='/account.html';link.className='subtle-btn';
   link.textContent='حسابي: '+(data.user.username||data.user.email);
   link.style.cssText='font-size:12px;text-decoration:none;white-space:nowrap;padding:8px';
   actions.prepend(link);
   const logout=document.createElement('button');logout.type='button';logout.className='subtle-btn';logout.textContent='خروج';
   logout.onclick=async()=>{try{await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'});location.replace('/account.html')}catch{alert('تعذر تسجيل الخروج')}};
   actions.append(logout);
  }
  await import('./app-v2.js');
  // Prayer times are web-only and never access PDF bytes or annotations.
  import('./prayer-bar.js').catch(()=>{});
  // Only after the reader opens its account-specific IndexedDB, offer optional
  // non-destructive migration of the old anonymous library on this device.
  import('./legacy-import.js').catch(()=>{});
  // Optional peer-to-peer transfer: runs only for signed-in users and only if enabled on this device.
  import('./peer-sync.js').catch(error=>console.warn('peer_sync_disabled',error?.name));
 } catch(error){
  if(panel){panel.hidden=false;panel.replaceChildren();}
  const alertBox=document.createElement('main');alertBox.dir='rtl';alertBox.style.cssText='max-width:520px;margin:14vh auto;padding:24px;background:#efe3d4;border-radius:18px;font:16px system-ui;text-align:center';
  const h=document.createElement('h2');h.textContent='تعذر فتح الجلسة';
  const p=document.createElement('p');p.textContent='اتصل بالإنترنت للتحقق من الحساب. ملفاتك ما زالت محفوظة على هذا الجهاز.';
  const a=document.createElement('a');a.href='/account.html';a.textContent='صفحة تسجيل الدخول';
  alertBox.append(h,p,a);document.body.append(alertBox);
 }
})();
