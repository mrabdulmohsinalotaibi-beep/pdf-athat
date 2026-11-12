// Opt-in background Web Push preferences, added to the existing prayer settings dialog.
// Web Push delivers the default iOS notification sound; uploaded adhan/iqama audio cannot play in background.
export async function mountPrayerBackgroundPush(){
 const dialog=document.querySelector('.prayer-dialog');
 if(!dialog||dialog.querySelector('[data-prayer-push]'))return;
 const box=document.createElement('section');
 box.dataset.prayerPush='true';box.className='prayer-sound-group';
 const heading=document.createElement('h3');heading.textContent='📲 تنبيهات الصلاة والموقع مغلق';
 const note=document.createElement('p');note.className='prayer-note';
 note.textContent='بعد تفعيل هذا الجهاز تصل تنبيهات الصلاة حتى عند إغلاق التطبيق، حسب سماح الآيفون وإعداداتك. يستخدم تنبيه النظام صوته الافتراضي، وليس ملف الأذان المحفوظ محليًا.';
 const activate=document.createElement('button');activate.type='button';activate.className='prayer-primary';
 activate.textContent='تفعيل / تحديث تنبيهات الخلفية';
 const disable=document.createElement('button');disable.type='button';disable.className='prayer-secondary';
 disable.textContent='إيقاف تنبيهات الخلفية على هذا الجهاز';
 const message=document.createElement('p');message.className='prayer-feedback';message.setAttribute('role','status');
 box.append(heading,note,activate,disable,message);
 const actions=box.querySelectorAll('button');for(const b of actions)b.style.margin='4px';
 dialog.querySelector('.prayer-dialog-actions')?.before(box);
 if(!box.isConnected)dialog.append(box);
 let publicKey=null;
 const key='pdf-athat-prayer-city-v1',soundKey='pdf-athat-prayer-sound-v1';
 const isGuest=window.__pdfGuestMode===true;

 const deviceStatus=document.createElement('p');deviceStatus.className='prayer-feedback';deviceStatus.setAttribute('role','status');box.insertBefore(deviceStatus,activate);
 const refreshDeviceStatus=async()=>{
  if(!('serviceWorker' in navigator)||!('PushManager' in window)){
   deviceStatus.textContent='حالة الجهاز: إشعارات الخلفية غير مدعومة هنا؛ على الآيفون ثبّت الموقع على الشاشة الرئيسية.';
   return;
  }
  if(isGuest){deviceStatus.textContent='حالة الجهاز: وضع الزائر. سجّل الدخول لتفعيل إشعارات الخلفية.';return}
  try{
   const registration=await navigator.serviceWorker.ready;
   const sub=await registration.pushManager.getSubscription();
   let serverEnabled=false;
   if(sub&&Notification.permission==='granted'){
    const response=await fetch('/api/prayer-push/status',{credentials:'same-origin',cache:'no-store'});
    if(response.ok)serverEnabled=!!(await response.json()).enabled;
   }
   const active=!!sub&&serverEnabled&&Notification.permission==='granted';
   deviceStatus.textContent=active?
    'حالة الجهاز: مفعّل لدى خادم التنبيهات. تصل إشعارات الصلاة والتطبيق مغلق وفق إعدادات الجهاز.':
    'حالة الجهاز: لم يكتمل ربط هذا الآيفون بالخادم. اضغط تفعيل الإشعارات.';
  }catch{
   deviceStatus.textContent='تعذر التأكد من حالة الإشعارات على الخادم. افتح إعدادات الصلاة وحاول التفعيل.';
  }
 };

 const json=async (path,body)=>{
  const response=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||'تعذر الاتصال بخدمة التنبيهات');
  return data;
 };
 try{
  const response=await fetch('/api/prayer-push/config',{cache:'no-store'});
  const result=await response.json();
  if(result.ready&&typeof result.publicKey==='string')publicKey=result.publicKey;
 }catch{}
 function supported(){
  if(isGuest){message.textContent='سجّل الدخول بحسابك لتفعيل إشعارات الخلفية.';return false}
  if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)){
   message.textContent='هذا الجهاز لا يدعم Web Push؛ على الآيفون افتح الموقع من أيقونته المثبتة بالشاشة الرئيسية.';return false;
  }
  if(!publicKey){message.textContent='الخدمة قيد التجهيز؛ لا يمكن تفعيل التنبيهات بعد.';return false}
  return true;
 }
 const decode=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
 const saveSubscription=async subscription=>{
  const place=JSON.parse(localStorage.getItem(key)||'null')||{type:'city',city:'Makkah',country:'SA'};
  if(place.type!=='city'||place.country!=='SA')
   throw Error('اختر مدينة سعودية من إعدادات مواقيت الصلاة ثم احفظها لتفعيل الإشعارات.');
  const settings=JSON.parse(localStorage.getItem(soundKey)||'null')||{};
  return json('/api/prayer-push/subscribe',{subscription:subscription.toJSON(),city:place.city,country:'SA',
   settings:{before:[0,5,10,15,30].includes(settings.before)?settings.before:0,
    adhan:settings.adhan!==false,iqama:settings.iqama===true,
    iqamaDelay:[5,10,15,20,30].includes(settings.iqamaDelay)?settings.iqamaDelay:10}
  });
 };
 activate.onclick=async()=>{
  if(!supported())return;
  activate.disabled=true;message.textContent='جاري تفعيل إشعارات الخلفية...';
  try{
   const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();
   if(permission!=='granted')throw Error('لم تسمح بإشعارات التطبيق من إعدادات الآيفون.');
   const place=JSON.parse(localStorage.getItem(key)||'null')||{type:'city',city:'Makkah',country:'SA'};
   if(place.type!=='city'||place.country!=='SA'){
    throw Error('اختر مدينة سعودية من قائمة مواقيت الصلاة أولًا، ثم احفظ المدينة.');
   }
   const settings=JSON.parse(localStorage.getItem(soundKey)||'null')||{};
   const registration=await navigator.serviceWorker.ready;
   let subscription=await registration.pushManager.getSubscription();
   const desiredKey=decode(publicKey);
   const currentKey=subscription?.options?.applicationServerKey;
   if(subscription&&currentKey&&
    (currentKey.byteLength!==desiredKey.byteLength||
     Array.from(new Uint8Array(currentKey)).some((n,i)=>n!==desiredKey[i]))){
    await subscription.unsubscribe();
    subscription=null;
   }
   subscription=subscription||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:desiredKey});
   await saveSubscription(subscription);
   message.textContent='تم تسجيل اشتراك هذا الجهاز لدى خدمة الإشعارات المجدولة. جرّب إغلاق التطبيق وانتظر موعد التنبيه التالي؛ قد يتأخر وصوله بحسب iOS والشبكة.';
   await refreshDeviceStatus();
  }catch(error){message.textContent='لم يكتمل التفعيل: '+(error?.message||'خطأ غير معروف')}
  finally{activate.disabled=false}
 };
 disable.onclick=async()=>{
  disable.disabled=true;
  try{
   const registration=await navigator.serviceWorker.ready;
   const subscription=await registration.pushManager.getSubscription();
   if(subscription){
    await json('/api/prayer-push/unsubscribe',{subscription:subscription.toJSON()});
    await subscription.unsubscribe();
   }
   message.textContent='توقفت تنبيهات الخلفية على هذا الجهاز.';
   await refreshDeviceStatus();
  }catch(error){message.textContent='تعذر إيقاف التنبيهات: '+(error?.message||'خطأ غير معروف')}
  finally{disable.disabled=false}
 };
 if(!publicKey)message.textContent='خدمة الإشعارات غير جاهزة الآن؛ جرّب لاحقًا. الأصوات المحلية لا تعمل بعد إغلاق التطبيق.';
 // A granted device can re-register silently after a session change or settings edit.
 // Never request notification permission without the user's direct tap.
 let syncing=false,lastSync=0;
 const syncExisting=async(force=false)=>{
  if(syncing||isGuest||!publicKey||!('Notification' in window)||Notification.permission!=='granted'||!('serviceWorker' in navigator))return;
  if(!force&&Date.now()-lastSync<60000)return;
  syncing=true;lastSync=Date.now();
  try{
   const registration=await navigator.serviceWorker.ready;
   const sub=await registration.pushManager.getSubscription();
   if(sub){await saveSubscription(sub);await refreshDeviceStatus()}
  }catch(error){console.warn('prayer_push_resync_failed',error?.message||error)}
  finally{syncing=false}
 };
 window.addEventListener('focus',()=>syncExisting());
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')syncExisting()});
 window.addEventListener('storage',event=>{if(event.key===key||event.key===soundKey)syncExisting(true)});
 dialog.addEventListener('close',()=>syncExisting(true));
 refreshDeviceStatus();
 syncExisting(true);
}
