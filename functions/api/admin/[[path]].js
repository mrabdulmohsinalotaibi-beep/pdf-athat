import { session, verifyAccountPassword } from '../../../server/auth.mjs';

const response = (data, status=200) => Response.json(data, {status, headers: {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const sql = (db, query, ...args) => db.prepare(query).bind(...args);
async function recordAudit(db,actorId,targetId,action,details=''){
 try{
  await sql(db,'INSERT INTO pdf_admin_audit(id,actor_id,target_id,action,details,created_at) VALUES(?,?,?,?,?,?)',crypto.randomUUID(),actorId,targetId,action,details,Math.floor(Date.now()/1000)).run();
 }catch(error){console.warn('admin_audit_log_unavailable',error?.name)}
}

export async function onRequest({request,env}) {
 try {
  if (!env.PDF_AUTH_DB) return response({error:'خدمة الحسابات غير مهيأة'},503);
  const user = await session(env.PDF_AUTH_DB,request);
  if (user?.role !== 'admin') return response({error:'هذه الصفحة مخصصة لمدير النظام فقط'},403);
  const url = new URL(request.url);
  const action = url.pathname.replace(/^\/api\/admin\/?/,'');
  if(request.method==='GET' && action==='overview') {
   const users=await sql(env.PDF_AUTH_DB,"SELECT COUNT(*) AS total, SUM(CASE WHEN role='admin' THEN 1 ELSE 0 END) AS admins FROM pdf_email_users").first();
   const time=Math.floor(Date.now()/1000);
   const sessions=await sql(env.PDF_AUTH_DB,'SELECT COUNT(*) AS total FROM pdf_email_sessions WHERE expires_at>?',time).first();
   const recent=await sql(env.PDF_AUTH_DB,'SELECT COUNT(*) AS total FROM pdf_email_users WHERE created_at>?',time-7*86400).first();
   const pending=await sql(env.PDF_AUTH_DB,"SELECT COUNT(*) AS total FROM pdf_email_challenges WHERE purpose='signup' AND expires_at>?",time).first();
   return response({users:Number(users?.total||0),admins:Number(users?.admins||0),activeSessions:Number(sessions?.total||0),recentUsers:Number(recent?.total||0),pendingVerifications:Number(pending?.total||0),mailConfigured:!!(env.RESEND_API_KEY&&env.OTP_FROM_EMAIL&&env.OTP_SECRET),localFiles:'لا تُرفع ملفات PDF إلى الخادم'});
  }
  if(action==='traffic' && request.method==='GET'){
   // Always authorize before querying: only signed-in administrators see stats.
   const now=new Date();
   const today=now.toISOString().slice(0,10);
   const since=days=>new Date(now.getTime()-(days-1)*86400000).toISOString().slice(0,10);
   const db=env.PDF_AUTH_DB;
   const count=async from=>{
    const result=await sql(db,'SELECT COALESCE(SUM(visits),0) AS views,COUNT(DISTINCT visitor_hash) AS visitors FROM pdf_traffic_visits WHERE day>=?',from).first();
    return {views:Number(result?.views||0),visitors:Number(result?.visitors||0)};
   };
   const [daily,weekly,monthly,yearly,history,countries,devices,browsers,pages]=await Promise.all([
    count(today),count(since(7)),count(since(30)),count(since(365)),
    sql(db,'SELECT day,SUM(visits) AS views,COUNT(DISTINCT visitor_hash) AS visitors FROM pdf_traffic_visits WHERE day>=? GROUP BY day ORDER BY day ASC',since(30)).all(),
    sql(db,'SELECT country,SUM(visits) AS views,COUNT(DISTINCT visitor_hash) AS visitors FROM pdf_traffic_visits WHERE day>=? GROUP BY country ORDER BY views DESC LIMIT 12',since(30)).all(),
    sql(db,'SELECT device,SUM(visits) AS views FROM pdf_traffic_visits WHERE day>=? GROUP BY device ORDER BY views DESC',since(30)).all(),
    sql(db,'SELECT browser,SUM(visits) AS views FROM pdf_traffic_visits WHERE day>=? GROUP BY browser ORDER BY views DESC',since(30)).all(),
    sql(db,'SELECT page,SUM(visits) AS views FROM pdf_traffic_visits WHERE day>=? GROUP BY page ORDER BY views DESC',since(30)).all()
   ]);
   return response({
    daily,weekly,monthly,yearly,days:history.results||[],
    countries:countries.results||[],devices:devices.results||[],
    browsers:browsers.results||[],pages:pages.results||[],
    since:since(30),asOf:today,retention:'aggregated-only'
   });
  }
  if(action==='ads' && request.method==='GET'){
   const rows=await sql(env.PDF_AUTH_DB,'SELECT id,title,body,link_url,starts_at,ends_at,duration_seconds,enabled,created_at FROM pdf_site_ads ORDER BY updated_at DESC LIMIT 100').all();
   return response({ads:rows.results||[]});
  }
  if(action==='ad-save' && request.method==='POST'){
   if(request.headers.get('Origin')!==url.origin || request.headers.get('Sec-Fetch-Site')==='cross-site')return response({error:'الطلب غير مسموح'},403);
   if(!request.headers.get('Content-Type')?.startsWith('application/json'))return response({error:'نوع الطلب غير مدعوم'},415);
   const body=await request.json();
   const title=typeof body.title==='string'?body.title.trim():'';
   const description=typeof body.body==='string'?body.body.trim():'';
   const link=typeof body.link_url==='string'?body.link_url.trim():'';
   const start=body.starts_at,end=body.ends_at,duration=body.duration_seconds;
   if(!title||title.length>90||description.length>400||link.length>500||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=end||end-start>366*86400||!Number.isSafeInteger(duration)||duration<0||duration>3600)return response({error:'تحقق من النص والتواريخ والمدة (حتى ساعة)'},400);
   if(link && (!/^https:\/\//i.test(link)||!(()=>{try{const target=new URL(link);return target.protocol==='https:'&&!target.username&&!target.password}catch{return false}})()))return response({error:'رابط الإعلان يجب أن يبدأ بـ HTTPS'},400);
   const enabled=body.enabled===false?0:1;
   const stamp=Math.floor(Date.now()/1000);
   const id=typeof body.id==='string'&&/^[0-9a-f-]{36}$/i.test(body.id)?body.id:crypto.randomUUID();
   if(body.id){
    const saved=await sql(env.PDF_AUTH_DB,'UPDATE pdf_site_ads SET title=?,body=?,link_url=?,starts_at=?,ends_at=?,duration_seconds=?,enabled=?,updated_at=? WHERE id=?',title,description,link,start,end,duration,enabled,stamp,id).run();
    if(!saved.meta?.changes)return response({error:'الإعلان غير موجود'},404);
   }else{
    await sql(env.PDF_AUTH_DB,'INSERT INTO pdf_site_ads(id,title,body,link_url,starts_at,ends_at,duration_seconds,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',id,title,description,link,start,end,duration,enabled,stamp,stamp).run();
   }
   return response({ok:true,id});
  }
  if((action==='ad-toggle'||action==='ad-delete')&&request.method==='POST'){
   if(request.headers.get('Origin')!==url.origin||request.headers.get('Sec-Fetch-Site')==='cross-site')return response({error:'الطلب غير مسموح'},403);
   if(!request.headers.get('Content-Type')?.startsWith('application/json'))return response({error:'نوع الطلب غير مدعوم'},415);
   const body=await request.json();
   if(typeof body?.id!=='string'||!/^[0-9a-f-]{36}$/i.test(body.id))return response({error:'معرف الإعلان غير صالح'},400);
   const result=action==='ad-delete'
    ?await sql(env.PDF_AUTH_DB,'DELETE FROM pdf_site_ads WHERE id=?',body.id).run()
    :await sql(env.PDF_AUTH_DB,'UPDATE pdf_site_ads SET enabled=CASE WHEN enabled=1 THEN 0 ELSE 1 END,updated_at=? WHERE id=?',Math.floor(Date.now()/1000),body.id).run();
   if(!result.meta?.changes)return response({error:'الإعلان غير موجود'},404);
   return response({ok:true});
  }
  if(request.method==='GET' && action==='audit') {
   const result=await sql(env.PDF_AUTH_DB,`SELECT a.action,a.details,a.created_at,
    COALESCE(actor.username,actor.email,'حساب غير موجود') AS actor,
    COALESCE(target.username,target.email,'غير متاح') AS target
    FROM pdf_admin_audit a
    LEFT JOIN pdf_email_users actor ON actor.id=a.actor_id
    LEFT JOIN pdf_email_users target ON target.id=a.target_id
    ORDER BY a.created_at DESC LIMIT 40`).all();
   return response({events:result.results||[]});
  }
  if(request.method==='GET' && action==='users') {
   const search=(url.searchParams.get('q')||'').trim().toLowerCase().slice(0,80);
   const page=Math.min(1000,Math.max(0,Number.parseInt(url.searchParams.get('page')||'0',10)||0));
   const pattern='%'+search.replace(/[\\%_]/g, x=>'\\'+x)+'%';
   const rows=await sql(env.PDF_AUTH_DB,"SELECT id,email,username,role,created_at,(SELECT COUNT(*) FROM pdf_email_sessions s WHERE s.user_id=pdf_email_users.id AND s.expires_at>?) AS sessions FROM pdf_email_users WHERE email LIKE ? ESCAPE '\\' OR username LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT 30 OFFSET ?",Math.floor(Date.now()/1000),pattern,pattern,page*30).all();
   const counts=await sql(env.PDF_AUTH_DB,"SELECT COUNT(*) AS total FROM pdf_email_users WHERE email LIKE ? ESCAPE '\\' OR username LIKE ? ESCAPE '\\'",pattern,pattern).first();
   return response({users:rows.results||[],total:Number(counts?.total||0),page});
  }
  if(request.method==='POST' && (action==='transfer-start'||action==='transfer-confirm')) {
   if(request.headers.get('Origin')!==url.origin || request.headers.get('Sec-Fetch-Site')==='cross-site')return response({error:'الطلب غير مسموح'},403);
   if(!request.headers.get('Content-Type')?.startsWith('application/json'))return response({error:'نوع الطلب غير مدعوم'},415);
   const body=await request.json();
   const db=env.PDF_AUTH_DB, time=Math.floor(Date.now()/1000);
   const owner=await sql(db,'SELECT id,email FROM pdf_email_users WHERE id=? AND email IN (SELECT email FROM pdf_admin_allowed_emails)',user.id).first();
   if(!owner)return response({error:'نقل الإدارة متاح لمالك الموقع المعتمد فقط'},403);
   if(!env.OTP_SECRET||!env.RESEND_API_KEY||!env.OTP_FROM_EMAIL)return response({error:'خدمة التحقق بالبريد غير مهيأة'},503);
   const encoder=new TextEncoder();
   const hex=buf=>Array.from(new Uint8Array(buf),v=>v.toString(16).padStart(2,'0')).join('');
   const makeKey=()=>crypto.subtle.importKey('raw',encoder.encode(env.OTP_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
   if(action==='transfer-start'){
    const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
    if(email.length>254||!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)||email===owner.email)return response({error:'أدخل بريدًا آخر صحيحًا'},400);
    // Rate-limit starts to protect mailbox delivery and password guessing.
    const quota=await sql(db,`INSERT INTO pdf_email_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END, expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING count`, 'owner-transfer:'+user.id,time+900,time,time).first();
    if(!quota||quota.count>5)return response({error:'محاولات كثيرة. حاول بعد 15 دقيقة'},429);
    if(!await verifyAccountPassword(db,user.id,body.password))return response({error:'كلمة مرور حساب المدير غير صحيحة'},401);
    const target=await sql(db,'SELECT id,email FROM pdf_email_users WHERE email=?',email).first();
    if(!target)return response({error:'البريد الجديد يحتاج حسابًا مسجلًا ومؤكدًا أولًا'},400);
    const challengeId=hex(crypto.getRandomValues(new Uint8Array(32)));
    const num=crypto.getRandomValues(new Uint32Array(1))[0]%1000000,code=String(num).padStart(6,'0');
    const signature=hex(await crypto.subtle.sign('HMAC',await makeKey(),encoder.encode(challengeId+':'+code)));
    await db.batch([
     sql(db,"DELETE FROM pdf_email_challenges WHERE purpose='admin-transfer' AND salt=?",user.id),
     sql(db,"INSERT INTO pdf_email_challenges(id,email,purpose,code_hash,salt,password_hash,expires_at,attempts) VALUES(?,?,'admin-transfer',?,?,?,?,0)",challengeId,email,signature,user.id,target.id,time+600)
    ]);
    try{
     const sent=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:env.OTP_FROM_EMAIL,to:[email],subject:'تأكيد نقل إدارة PDF.ATHAT',text:'طلب نقل صلاحية إدارة PDF.ATHAT إلى بريدك. رمز التأكيد: '+code+'\\nصالح 10 دقائق. إذا لم تطلب النقل فتجاهل الرسالة.'})});
     if(!sent.ok)throw Error('delivery');
    }catch{await sql(db,'DELETE FROM pdf_email_challenges WHERE id=?',challengeId).run();return response({error:'تعذر إرسال رمز التحقق إلى البريد الجديد'},503)}
    return response({challengeId,message:'تم إرسال رمز التحقق إلى البريد الجديد'});
   }
   if(typeof body.challengeId!=='string'||! /^[a-f0-9]{64}$/.test(body.challengeId)||! /^\\d{6}$/.test(body.code||''))return response({error:'رمز التأكيد غير صحيح'},400);
   const pending=await sql(db,"SELECT * FROM pdf_email_challenges WHERE id=? AND purpose='admin-transfer' AND salt=? AND expires_at>? AND attempts<5",body.challengeId,user.id,time).first();
   if(!pending)return response({error:'انتهت صلاحية طلب النقل، ابدأ من جديد'},400);
   const attempt=await sql(db,'UPDATE pdf_email_challenges SET attempts=attempts+1 WHERE id=? AND attempts<5 AND expires_at>?',pending.id,time).run();
   if(!attempt.meta?.changes)return response({error:'انتهت المحاولات المسموحة'},400);
   const matched=await crypto.subtle.verify('HMAC',await makeKey(),Uint8Array.from(pending.code_hash.match(/../g),h=>parseInt(h,16)),encoder.encode(pending.id+':'+body.code));
   if(!matched)return response({error:'رمز التأكيد غير صحيح'},400);
   const consumed=await sql(db,'DELETE FROM pdf_email_challenges WHERE id=?',pending.id).run();
   if(!consumed.meta?.changes)return response({error:'استُخدم الرمز من قبل'},400);
   const target=await sql(db,'SELECT id,email FROM pdf_email_users WHERE id=? AND email=?',pending.password_hash,pending.email).first();
   if(!target)return response({error:'حساب البريد الجديد لم يعد متاحًا'},400);
   await db.batch([
    sql(db,"UPDATE pdf_email_users SET role='admin' WHERE id=?",target.id),
    sql(db,'INSERT OR IGNORE INTO pdf_admin_allowed_emails(email) VALUES(?)',target.email),
    sql(db,'DELETE FROM pdf_admin_allowed_emails WHERE email=?',owner.email),
    sql(db,"UPDATE pdf_email_users SET role='user' WHERE id=?",owner.id),
    sql(db,'DELETE FROM pdf_email_sessions WHERE user_id IN (?,?)',owner.id,target.id)
   ]);
   await recordAudit(db,user.id,target.id,'transfer_ownership','ownership transferred to verified email');
   return response({ok:true,message:'تم نقل إدارة الموقع إلى البريد الجديد. سجّل الدخول به.'});
  }
  if(request.method==='POST' && (action==='role'||action==='revoke')) {
   if(request.headers.get('Origin')!==url.origin || request.headers.get('Sec-Fetch-Site')==='cross-site') return response({error:'الطلب غير مسموح'},403);
   if(!request.headers.get('Content-Type')?.startsWith('application/json')) return response({error:'نوع الطلب غير مدعوم'},415);
   const body=await request.json();
   if(typeof body?.id!=='string'||body.id.length>100||(action==='role'&&!['user','admin'].includes(body.role))) return response({error:'بيانات غير صالحة'},400);
   if(body.id===user.id) return response({error:'لا يمكن تغيير صلاحية حسابك من هذه الصفحة'},400);
   if(action==='revoke'){
    const exists=await sql(env.PDF_AUTH_DB,'SELECT id FROM pdf_email_users WHERE id=?',body.id).first();
    if(!exists)return response({error:'الحساب غير موجود'},404);
    const removed=await sql(env.PDF_AUTH_DB,'DELETE FROM pdf_email_sessions WHERE user_id=?',body.id).run();
    await recordAudit(env.PDF_AUTH_DB,user.id,body.id,'revoke_sessions',String(Number(removed.meta?.changes||0))+' sessions');
    return response({ok:true,revoked:Number(removed.meta?.changes||0)});
   }
   const res=await sql(env.PDF_AUTH_DB,"UPDATE pdf_email_users SET role=? WHERE id=? AND email NOT IN (SELECT email FROM pdf_admin_allowed_emails)",body.role,body.id).run();
   if(!res.meta?.changes) return response({error:'الحساب غير موجود أو محمي'},404);
   await sql(env.PDF_AUTH_DB,'DELETE FROM pdf_email_sessions WHERE user_id=?',body.id).run();
   await recordAudit(env.PDF_AUTH_DB,user.id,body.id,'change_role','new role: '+body.role);
   return response({ok:true});
  }
  return response({error:'المسار غير موجود'},404);
 } catch(error) {
  console.error('admin_endpoint_failed',error?.name);
  return response({error:'تعذر إكمال الطلب'},503);
 }
}
