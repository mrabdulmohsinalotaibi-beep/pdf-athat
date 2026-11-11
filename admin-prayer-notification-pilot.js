// An opt-in system notification test for all PDF.ATHAT visitors.
// This does not schedule background push notifications or change any PDF documents.
export function mountPrayerNotificationTest(){
 const bar=document.querySelector('.prayer-bar');
 if(!bar || bar.querySelector('[data-prayer-notify-test]'))return;
 const button=document.createElement('button');
 button.type='button';
 button.dataset.prayerNotifyTest='true';
 button.className='prayer-notify-test';
 button.textContent='🔔';
 button.title='تجربة إشعار الصلاة';
 button.setAttribute('aria-label','تجربة إشعار الصلاة');
 const status=document.createElement('span');
 status.setAttribute('role','status');
 status.setAttribute('aria-live','polite');
 status.style.cssText='display:block;width:100%;font-size:12px;color:#780000;text-align:right;padding:2px 8px;';
 // Place the bell next to prayer settings, not in the global header.
 const settings=bar.querySelector('.prayer-settings');
 if(settings)settings.insertAdjacentElement('beforebegin',button);
 else bar.append(button);
 bar.insertAdjacentElement('afterend',status);
 button.addEventListener('click',async()=>{
  status.textContent='';
  if(!('Notification' in window)||!('serviceWorker' in navigator)){
   status.textContent='إشعارات الويب غير مدعومة هنا؛ على الآيفون أضف الموقع إلى الشاشة الرئيسية وافتحه من أيقونته.';
   return;
  }
  try{
   const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();
   if(permission!=='granted'){
    status.textContent='لم يتم السماح بالإشعارات. يمكنك تعديل الإذن من إعدادات الجهاز.';
    return;
   }
   const registration=await navigator.serviceWorker.ready;
   await registration.showNotification('PDF.ATHAT · تجربة إشعار الصلاة',{
    body:'وصل إشعار تجريبي بنجاح. الإشعارات التلقائية عند دخول وقت الصلاة غير مفعلة بعد.',
    icon:'./icon.svg',badge:'./icon.svg',tag:'pdf-athat-prayer-test'
   });
   status.textContent='تم إرسال إشعار تجريبي إلى نظام الجهاز. تحقق من مركز الإشعارات.';
  }catch(error){
   status.textContent='تعذر إرسال الإشعار: '+(error?.message||'خطأ غير معروف');
  }
 });
}
