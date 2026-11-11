// Admin-only opt-in pilot. This tests an OS notification, NOT background prayer scheduling.
// The caller must pass a user object from the server-verified /api/auth/session response.
export async function mountAdminPrayerNotificationPilot(user) {
 if (!user || user.role !== 'admin') return;
 const actions=document.querySelector('.header-actions');
 if (!actions) return;
 const button=document.createElement('button');
 button.type='button';button.className='subtle-btn';
 button.textContent='🔔 تجربة إشعار الصلاة';
 button.title='تجربة خاصة بالمدير فقط؛ لا ترسل إشعارات للمستخدمين الآخرين';
 button.style.cssText='font-size:12px;white-space:nowrap;padding:8px';
 actions.prepend(button);
 const status=document.createElement('p');
 status.setAttribute('role','status');
 status.style.cssText='font:12px system-ui;color:#780000;margin:5px 12px;text-align:right';
 button.insertAdjacentElement('afterend',status);
 button.addEventListener('click',async()=>{
  status.textContent='';
  if (!('Notification' in window)||!('serviceWorker' in navigator)) {
   status.textContent='هذا المتصفح لا يدعم إشعارات الويب. على الآيفون افتح الموقع من أيقونته المثبتة على الشاشة الرئيسية.';
   return;
  }
  try {
   const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();
   if(permission!=='granted'){status.textContent='لم يتم السماح بالإشعارات من إعدادات الجهاز.';return;}
   const registration=await navigator.serviceWorker.ready;
   await registration.showNotification('PDF.ATHAT · تجربة صلاة', {
    body:'هذا إشعار تجريبي لحساب المدير فقط. لم يتم تفعيل تنبيهات الصلاة التلقائية.',
    icon:'./icon.svg',badge:'./icon.svg',tag:'pdf-athat-admin-prayer-test'
   });
   status.textContent='تم طلب عرض الإشعار التجريبي؛ تحقّق من مركز إشعارات الجهاز.';
  }catch(error){status.textContent='تعذرت تجربة الإشعار على هذا الجهاز: '+(error?.message||'خطأ غير معروف');}
 });
}
