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
 button.title='إعدادات إشعارات الصلاة';
 button.setAttribute('aria-label','فتح إعدادات إشعارات الصلاة');
 // One compact bell in the strip. The test stays inside the existing settings dialog.
 const settings=bar.querySelector('.prayer-settings');
 if(settings)settings.insertAdjacentElement('beforebegin',button);
 else bar.append(button);
 const dialog=document.querySelector('.prayer-dialog');
 const testSection=document.createElement('section');
 testSection.className='prayer-sound-group';
 const testButton=document.createElement('button');
 testButton.type='button';testButton.className='prayer-secondary';
 testButton.textContent='🔔 تجربة إشعار النظام (اختبار محلي)';
 const status=document.createElement('p');
 status.className='prayer-feedback';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 testSection.append(testButton,status);
 dialog?.querySelector('.prayer-dialog-actions')?.before(testSection);
 if(dialog&&!testSection.isConnected)dialog.append(testSection);
 button.addEventListener('click',()=>{
  if(dialog?.open){dialog.querySelector('[data-prayer-push]')?.scrollIntoView({block:'nearest',behavior:'smooth'});}
  else settings?.click();
 });
 testButton.addEventListener('click',async()=>{
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
    body:'اختبار محلي ناجح. لتشغيل تنبيهات الصلاة والتطبيق مغلق افتح إعدادات الصلاة وفعّل تنبيهات الخلفية.',
    icon:'./icon.svg',badge:'./icon.svg',tag:'pdf-athat-prayer-test'
   });
   status.textContent='نجح الاختبار المحلي فقط. لتفعيل الإشعارات أثناء إغلاق التطبيق افتح ⚙ إعدادات الصلاة ثم اضغط «تفعيل / تحديث تنبيهات الخلفية».';
  }catch(error){
   status.textContent='تعذر إرسال الإشعار: '+(error?.message||'خطأ غير معروف');
  }
 });
}
