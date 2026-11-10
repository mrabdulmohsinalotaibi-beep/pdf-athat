// PDF.ATHAT web-only prayer strip. Never requests device location without a click.
// Prayer settings and cached times stay on this device; PDF files are unaffected.
(()=>{
 'use strict';
 const root=document.getElementById('app'), header=root?.querySelector('.appbar');
 if(!header)return;
 const key='pdf-athat-prayer-city-v1', hiddenKey='pdf-athat-prayer-hidden-v1';
 const cityChoices=[
  ['Makkah','مكة المكرمة'],['Jeddah','جدة'],['Madinah','المدينة المنورة'],
  ['Riyadh','الرياض'],['Dammam','الدمام'],['Taif','الطائف'],['Tabuk','تبوك'],
  ['Abha','أبها'],['Jazan','جازان'],['Hail','حائل'],['Buraydah','بريدة'],
  ['Najran','نجران'],['Al Hofuf','الأحساء'],['Yanbu','ينبع']
 ];
 const prayers=[['Fajr','الفجر'],['Dhuhr','الظهر'],['Asr','العصر'],['Maghrib','المغرب'],['Isha','العشاء']];
 const parse=s=>{try{return JSON.parse(s)}catch{return null}};
 const defaultPlace={type:'city',city:'Makkah',country:'SA',label:'مكة المكرمة'};
 const stored=parse(localStorage.getItem(key));
 let place=stored&&((stored.type==='city'&&typeof stored.city==='string'&&typeof stored.country==='string')||(stored.type==='coords'&&Number.isFinite(stored.latitude)&&Number.isFinite(stored.longitude)))?stored:defaultPlace;
 let data=null, day='', zone='Asia/Riyadh', busy=false, popupTimer=null;
 let visible=localStorage.getItem(hiddenKey)!=='yes';
 const el=(tag,className,text)=>{const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e};
 const toggle=el('button','prayer-toggle','🕌 الصلاة');toggle.type='button';toggle.title='عرض مواقيت الصلاة';toggle.setAttribute('aria-expanded',String(visible));
 header.querySelector('.header-actions')?.prepend(toggle);
 const bar=el('section','prayer-bar');bar.setAttribute('aria-label','مواقيت الصلاة اليوم');bar.hidden=!visible;
 const info=el('div','prayer-place');const cityButton=el('button','prayer-city','📍 '+place.label);cityButton.type='button';cityButton.title='تغيير مدينة مواقيت الصلاة';
 const soon=el('small','prayer-soon','جاري تحميل مواقيت اليوم…');
 const hijri=el('small','prayer-hijri','');
 info.append(cityButton,soon,hijri);
 const times=el('div','prayer-times');
 const settings=el('button','prayer-settings','⚙');settings.type='button';settings.title='تغيير المدينة';
 const dismiss=el('button','prayer-dismiss','×');dismiss.type='button';dismiss.title='إخفاء مواقيت الصلاة';
 bar.append(info,times,settings,dismiss);header.insertAdjacentElement('afterend',bar);
 const toast=el('div','prayer-alert');toast.hidden=true;toast.setAttribute('role','status');toast.setAttribute('aria-live','polite');
 const alertText=el('strong','prayer-alert-text');const closeToast=el('button','prayer-alert-close','×');closeToast.type='button';closeToast.title='إغلاق التنبيه';
 toast.append(el('span','prayer-alert-icon','🕌'),alertText,closeToast);document.body.append(toast);
 const dialog=el('dialog','prayer-dialog');dialog.dir='rtl';
 const title=el('h2','', 'المدينة ومواقيت الصلاة');
 const note=el('p','prayer-note','اختر مدينتك أو اسمح بتحديد موقع الجهاز. لن نطلب الموقع تلقائيًا، وتُحفظ إعدادات المدينة على هذا الجهاز فقط.');
 const citySelect=el('select','prayer-select');citySelect.setAttribute('aria-label','المدينة');
 for(const [id,label] of cityChoices){const option=el('option','',label);option.value=id;citySelect.append(option)}
 const customOption=el('option','','مدينة أخرى…');customOption.value='other';citySelect.append(customOption);
 const custom=el('div','prayer-custom');custom.hidden=true;
 const cityInput=el('input','');cityInput.placeholder='اسم المدينة بالإنجليزية، مثل London';cityInput.setAttribute('aria-label','اسم المدينة');
 const countryInput=el('input','');countryInput.placeholder='رمز الدولة، مثل GB';countryInput.value='SA';countryInput.setAttribute('aria-label','رمز الدولة');
 custom.append(cityInput,countryInput);
 const alertControl=el('label','prayer-alert-control');
 const alertsOn=el('input');alertsOn.type='checkbox';alertsOn.checked=localStorage.getItem('pdf-athat-prayer-alerts')!=='no';
 alertControl.append(alertsOn,document.createTextNode(' إظهار تنبيه مرئي صامت عند حلول الصلاة (30 ثانية)'));
 const locationButton=el('button','prayer-secondary','استخدام موقعي بإذني');locationButton.type='button';
 const saveButton=el('button','prayer-primary','حفظ المدينة');saveButton.type='button';
 const cancelButton=el('button','prayer-secondary','إلغاء');cancelButton.type='button';
 const dialogActions=el('div','prayer-dialog-actions');dialogActions.append(saveButton,locationButton,cancelButton);
 const feedback=el('p','prayer-feedback','');
 dialog.append(title,note,citySelect,custom,alertControl,dialogActions,feedback);document.body.append(dialog);
 const toggleOpen=open=>{visible=open;bar.hidden=!open;toggle.setAttribute('aria-expanded',String(open));localStorage.setItem(hiddenKey,open?'no':'yes')};
 toggle.onclick=()=>toggleOpen(!visible);
 dismiss.onclick=()=>toggleOpen(false);
 settings.onclick=cityButton.onclick=()=>{
  citySelect.value=place.type==='city'&&place.country==='SA'&&cityChoices.some(x=>x[0]===place.city)?place.city:'other';
  custom.hidden=citySelect.value!=='other';
  cityInput.value=place.type==='city'&&citySelect.value==='other'?place.city:'';
  countryInput.value=place.type==='city'?place.country:'SA';
  feedback.textContent='';dialog.showModal();
 };
 cancelButton.onclick=()=>dialog.close();
 citySelect.onchange=()=>{custom.hidden=citySelect.value!=='other'};
 const timeNow=(timeZone)=>new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone}).format(new Date());
 const dateNow=(timeZone)=>new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'2-digit',year:'numeric',timeZone}).format(new Date()).replaceAll('/','-');
 const minutes=raw=>{const match=String(raw||'').match(/^(\d{1,2}):(\d{2})/);return match?Number(match[1])*60+Number(match[2]):null};
 const human=raw=>{const m=minutes(raw);if(m===null)return '—';const h=Math.floor(m/60),period=h<12?'ص':'م';return String(h%12||12)+':'+String(m%60).padStart(2,'0')+' '+period};
 const normalizeTimeZone=z=>{try{new Intl.DateTimeFormat('en',{timeZone:z});return z}catch{return 'Asia/Riyadh'}};
 const hijriToday=()=>{
  try{return new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura',{timeZone:zone,day:'numeric',month:'long',year:'numeric'}).format(new Date())}
  catch{return ''}
 };
 alertsOn.onchange=()=>{localStorage.setItem('pdf-athat-prayer-alerts',alertsOn.checked?'yes':'no');if(!alertsOn.checked){toast.hidden=true;clearTimeout(popupTimer)}};

 async function load(){
  if(busy)return;busy=true;soon.textContent='تحديث المواقيت…';
  try{
   const date=dateNow(zone),cacheKey='pdf-prayers:'+JSON.stringify(place)+':'+date;
   const cached=parse(localStorage.getItem(cacheKey));
   let result=cached;
   if(!result){
    const search=new URLSearchParams({method:'4',school:'0'});
    if(place.type==='coords'){search.set('latitude',String(place.latitude));search.set('longitude',String(place.longitude))}
    else{search.set('city',place.city);search.set('country',place.country)}
    const endpoint=place.type==='coords'?'timings':'timingsByCity';
    const response=await fetch('https://api.aladhan.com/v1/'+endpoint+'/'+date+'?'+search.toString(),{cache:'no-store'});
    if(!response.ok)throw Error('تعذر جلب مواقيت المدينة');
    const payload=await response.json();
    if(payload.code!==200||!payload.data?.timings?.Fajr||!payload.data?.meta?.timezone)throw Error('لم يتم العثور على مواقيت لهذه المدينة');
    result={timings:payload.data.timings,timezone:payload.data.meta.timezone};
    localStorage.setItem(cacheKey,JSON.stringify(result));
   }
   data=result.timings;zone=normalizeTimeZone(result.timezone);day=dateNow(zone);
   // Cities close to a timezone date boundary may differ: get the correct city's day.
   if(day!==date && !cached){busy=false;return load()}
   cityButton.textContent='📍 '+place.label;
   hijri.textContent=hijriToday();
   render();
  }catch(error){data=null;soon.textContent=error.message||'المواقيت غير متاحة الآن';times.replaceChildren()}
  finally{busy=false}
 }
 function showAlert(label,stamp){
  if(document.visibilityState!=='visible'||!visible||!alertsOn.checked)return;
  const id='pdf-prayer-shown:'+JSON.stringify(place)+':'+day+':'+stamp;
  if(sessionStorage.getItem(id))return;
  sessionStorage.setItem(id,'yes');
  alertText.textContent='حان الآن موعد صلاة '+label+' في '+place.label;
  toast.hidden=false;
  clearTimeout(popupTimer);popupTimer=setTimeout(()=>{toast.hidden=true},30000);
 }
 closeToast.onclick=()=>{toast.hidden=true;clearTimeout(popupTimer)};
 function render(){
  if(!data)return;
  const current=minutes(timeNow(zone));if(current===null)return;
  const nowDate=new Date();
  const seconds=Number(new Intl.DateTimeFormat('en-GB',{second:'2-digit',timeZone:zone}).format(nowDate));
  const entries=prayers.map(([key,label])=>({key,label,when:minutes(data[key]),raw:data[key]})).filter(x=>x.when!==null);
  let next=entries.find(x=>x.when>current);
  const tomorrow=!next;
  if(!next)next=entries[0];
  const duration=(next.when-current+(tomorrow?1440:0));
  const hour=Math.floor(duration/60),min=duration%60;
  soon.textContent='القادمة: '+next.label+' · '+(hour?hour+' س ':'')+min+' د';
  times.replaceChildren();
  for(const item of entries){
   const node=el('div','prayer-time'+(next.key===item.key?' is-next':''));
   const label=el('span','',item.label),clock=el('b','',human(item.raw));
   node.append(label,clock);times.append(node);
   if(item.when===current&&seconds<30)showAlert(item.label,item.key);
  }
 }
 async function tick(){
  if(!data){if(document.visibilityState==='visible'&&!busy)await load();return}
  if(day!==dateNow(zone)){data=null;await load();return}
  hijri.textContent=hijriToday();render();
 }
 saveButton.onclick=async()=>{
  let nextPlace;
  if(citySelect.value==='other'){
   const city=cityInput.value.trim(),country=countryInput.value.trim().toUpperCase();
   if(!/^[a-zA-Z][a-zA-Z\s.'-]{1,60}$/.test(city)||!/^([A-Z]{2})$/.test(country)){feedback.textContent='اكتب اسم المدينة بالإنجليزية ورمز الدولة من حرفين.';return}
   nextPlace={type:'city',city,country,label:city};
  }else nextPlace={type:'city',city:citySelect.value,country:'SA',label:cityChoices.find(x=>x[0]===citySelect.value)?.[1]||citySelect.value};
  place=nextPlace;zone='Asia/Riyadh';localStorage.setItem(key,JSON.stringify(place));data=null;dialog.close();toggleOpen(true);await load();
 };
 locationButton.onclick=()=>{
  if(!navigator.geolocation){feedback.textContent='المتصفح لا يدعم تحديد الموقع';return}
  feedback.textContent='بانتظار إذن الموقع من المتصفح…';
  navigator.geolocation.getCurrentPosition(async position=>{
   place={type:'coords',latitude:Number(position.coords.latitude.toFixed(4)),longitude:Number(position.coords.longitude.toFixed(4)),label:'موقعي الحالي'};
   localStorage.setItem(key,JSON.stringify(place));data=null;dialog.close();toggleOpen(true);await load();
  },()=>{feedback.textContent='لم يُسمح بالموقع. اختر مدينتك يدويًا.'},{enableHighAccuracy:false,timeout:12000,maximumAge:600000});
 };
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')tick()});
 setInterval(tick,15000);
 load();
})();
