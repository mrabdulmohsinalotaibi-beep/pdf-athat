import { session } from '../../../server/auth.mjs';

const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const cities=new Set(['Makkah','Jeddah','Madinah','Riyadh','Dammam','Taif','Tabuk','Abha','Jazan','Hail','Buraydah','Najran','Al Hofuf','Yanbu']);
const before=new Set([0,5,10,15,30]),delay=new Set([5,10,15,20,30]);
const sql=(db,query,...values)=>db.prepare(query).bind(...values);
const validPushEndpoint=value=>{
 try{
  const u=new URL(value);
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||value.length>1500)return false;
  const host=u.hostname.toLowerCase();
  return host==='web.push.apple.com'||host.endsWith('.push.apple.com')||
   host==='fcm.googleapis.com'||host==='updates.push.services.mozilla.com'||
   host==='push.services.mozilla.com'||host.endsWith('.push.services.mozilla.com');
 }catch{return false}
};
const validKey=x=>typeof x==='string'&&x.length>=16&&x.length<=180&&/^[A-Za-z0-9_-]+$/.test(x);
export async function onRequest({request,env}){
 if(!env.PDF_AUTH_DB)return json({error:'خدمة الإشعارات غير متاحة'},503);
 const pathname=new URL(request.url).pathname;
 const action=pathname.replace(/^\/api\/prayer-push\/?/,'');
 if(request.method==='GET'&&action==='config'){
  return json({publicKey:env.PRAYER_VAPID_PUBLIC||null,ready:!!env.PRAYER_VAPID_PUBLIC});
 }
 let user;
 try{user=await session(env.PDF_AUTH_DB,request)}catch{return json({error:'تعذر التحقق من الجلسة'},503)}
 if(!user?.id)return json({error:'سجّل الدخول لتفعيل إشعارات الصلاة في الخلفية'},401);
 if(request.method==='GET'&&action==='status'){
  const result=await sql(env.PDF_AUTH_DB,'SELECT COUNT(*) AS count FROM pdf_prayer_push_subscriptions WHERE user_id=? AND enabled=1',user.id).first();
  return json({enabled:Number(result?.count||0)>0,devices:Number(result?.count||0)});
 }
 if(request.method!=='POST')return json({error:'الطلب غير مدعوم'},405);
 const origin=new URL(request.url).origin;
 if(request.headers.get('Origin')!==origin||request.headers.get('Sec-Fetch-Site')==='cross-site')return json({error:'طلب غير مسموح'},403);
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'نوع الطلب غير مدعوم'},415);
 if(Number(request.headers.get('Content-Length')||0)>6000)return json({error:'الطلب كبير جدًا'},413);
 let payload;
 try{payload=await request.json()}catch{return json({error:'بيانات غير صحيحة'},400)}
 const endpoint=payload?.subscription?.endpoint;
 if(!validPushEndpoint(endpoint))return json({error:'عنوان خدمة Push غير معتمد'},400);
 if(action==='unsubscribe'){
  await sql(env.PDF_AUTH_DB,'DELETE FROM pdf_prayer_push_subscriptions WHERE endpoint=? AND user_id=?',endpoint,user.id).run();
  return json({ok:true});
 }
 if(action!=='subscribe')return json({error:'الإجراء غير معروف'},404);
 if(!env.PRAYER_VAPID_PUBLIC)return json({error:'خدمة إشعارات الخلفية لم تُفعّل بعد'},503);
 const keys=payload?.subscription?.keys||{};
 const city=payload?.city,country=payload?.country;
 const settings=payload?.settings||{};
 if(!validKey(keys.p256dh)||!validKey(keys.auth)||!cities.has(city)||country!=='SA'||
  !before.has(settings.before)||!delay.has(settings.iqamaDelay)||
  typeof settings.adhan!=='boolean'||typeof settings.iqama!=='boolean'){
  return json({error:'بيانات الاشتراك أو المدينة أو الإعدادات غير صحيحة'},400);
 }
 const existing=await sql(env.PDF_AUTH_DB,'SELECT user_id,id FROM pdf_prayer_push_subscriptions WHERE endpoint=?',endpoint).first();
 if(existing&&existing.user_id!==user.id)return json({error:'هذا الجهاز مرتبط بحساب آخر، ألغِ اشتراكه أولًا'},409);
 const count=await sql(env.PDF_AUTH_DB,'SELECT COUNT(*) count FROM pdf_prayer_push_subscriptions WHERE user_id=?',user.id).first();
 if(!existing&&Number(count?.count||0)>=6)return json({error:'وصلت للحد الأقصى للأجهزة (6)'},429);
 const now=Math.floor(Date.now()/1000);
 await sql(env.PDF_AUTH_DB,`INSERT INTO pdf_prayer_push_subscriptions
  (id,user_id,endpoint,p256dh,auth,city,country,timezone,before_minutes,adhan,iqama,iqama_delay,enabled,created_at,updated_at)
  VALUES(?,?,?,?,?,?,?,'Asia/Riyadh',?,?,?,?,1,?,?)
  ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth,
   city=excluded.city,country=excluded.country,before_minutes=excluded.before_minutes,
   adhan=excluded.adhan,iqama=excluded.iqama,iqama_delay=excluded.iqama_delay,
   enabled=1,updated_at=excluded.updated_at`,
  existing?.id||crypto.randomUUID(),user.id,endpoint,keys.p256dh,keys.auth,city,country,
  settings.before,settings.adhan?1:0,settings.iqama?1:0,settings.iqamaDelay,now,now).run();
 return json({ok:true});
}
