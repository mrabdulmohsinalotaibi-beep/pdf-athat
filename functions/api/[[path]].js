// PDF.ATHAT private account and opt-in device sync API.
// Cloudflare Pages Functions; existing PDF_AUTH_DB only. No PDF file storage.
// Requires OTP_SECRET, RESEND_API_KEY and OTP_FROM_EMAIL. No code is ever returned to the browser.
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const fail=(message,status)=>json({error:message},status);
const now=()=>Math.floor(Date.now()/1000);
const validId=x=>typeof x==="string"&&/^[a-zA-Z0-9_-]{8,100}$/.test(x);
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
const digest=async value=>hex(new Uint8Array(await crypto.subtle.digest("SHA-256",typeof value==="string"?new TextEncoder().encode(value):value)));
const hmac=async(secret,text)=>{const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return hex(new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(text))))};
const random=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
const cleanEmail=v=>typeof v==="string"?v.trim().toLowerCase():"";
const emailValid=e=>e.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
function cookie(request){return (request.headers.get("cookie")||"").split(";").map(x=>x.trim()).find(x=>x.startsWith("pdf_session="))?.slice(12)||""}
function sessionCookie(value,seconds){return `pdf_session=${value}; Max-Age=${seconds}; Path=/api; HttpOnly; Secure; SameSite=Lax`}
async function member(context){
 const token=cookie(context.request);if(!/^[0-9a-f]{64}$/.test(token))return null;
 const hash=await digest(token);
 return await context.env.PDF_AUTH_DB.prepare("SELECT s.user_id,s.device_id,s.device_name,u.email FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?").bind(hash,now()).first()
}
async function throttle(db,key,max,period){
 const stamp=now();const row=await db.prepare("SELECT cnt,window_start FROM limits WHERE k=?").bind(key).first();
 const count=row&&row.window_start>stamp-period?row.cnt:0;
 if(count>=max)return false;
 await db.prepare("INSERT INTO limits(k,cnt,window_start) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET cnt=excluded.cnt, window_start=excluded.window_start").bind(key,count+1,count?row.window_start:stamp).run();
 return true
}
async function input(request,limit=2000){
 if(Number(request.headers.get("content-length"))>limit)return null;
 const text=await request.text();if(text.length>limit)return null;
 try{return JSON.parse(text)}catch{return null}
}
// Independent PDF.ATHAT password credentials, unrelated to AAA's user database.
const ITERATIONS=210000;
const passwordOk=v=>typeof v==="string"&&v.length>=12&&v.length<=128;
async function derive(password,salt,iterations=ITERATIONS){
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(password),"PBKDF2",false,["deriveBits"]);
 return hex(new Uint8Array(await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt:Uint8Array.from(salt.match(/../g).map(x=>parseInt(x,16))),iterations},key,256)))
}
async function establishSession(env,userId,deviceName){
 const token=random(),device=crypto.randomUUID();
 await env.PDF_AUTH_DB.prepare("INSERT INTO sessions(token_hash,user_id,device_id,device_name,expires_at,created_at) VALUES(?,?,?,?,?,?)").bind(await digest(token),userId,device,String(deviceName||"جهاز جديد").slice(0,70),now()+2592000,now()).run();
 return new Response(JSON.stringify({ok:true,deviceId:device}),{headers:{"Content-Type":"application/json","Cache-Control":"no-store","Set-Cookie":sessionCookie(token,2592000)}})
}
async function passwordAction(context,action){
 const {request,env}=context,data=await input(request,2500);
 const email=cleanEmail(data?.email),password=data?.password;
 if(!emailValid(email)||!passwordOk(password))return fail("أدخل بريدًا صحيحًا وكلمة مرور من 12 إلى 128 حرفًا.",400);
 const ip=request.headers.get("cf-connecting-ip")||"unknown";
 const ipHash=await hmac(env.OTP_SECRET||"pdf-athat-limits",ip);
 if(!await throttle(env.PDF_AUTH_DB,"password-ip:"+ipHash,30,3600))return fail("محاولات كثيرة من هذا الجهاز. حاول لاحقًا.",429);
 if(!await throttle(env.PDF_AUTH_DB,"password-email:"+await digest(email),10,900))return fail("محاولات كثيرة لهذا البريد. حاول بعد 15 دقيقة.",429);
 if(action==="register"){
  const existing=await env.PDF_AUTH_DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first();
  if(existing)return fail("هذا البريد مسجل بالفعل. اختر تسجيل الدخول.",409);
  if(!env.RESEND_API_KEY||!env.OTP_FROM_EMAIL||!env.OTP_SECRET)return fail("إرسال رسائل تأكيد البريد لم يُفعّل بعد. يرجى التواصل مع إدارة الموقع.",503);
  const salt=random(),hash=await derive(password,salt);
  const code=String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,"0");
  const codeHash=await hmac(env.OTP_SECRET,"password-signup:"+email+":"+code);
  await env.PDF_AUTH_DB.prepare("INSERT INTO pending_password_signups(email,salt,hash,iterations,code_hash,expires_at,attempts,created_at) VALUES(?,?,?,?,?,?,0,?) ON CONFLICT(email) DO UPDATE SET salt=excluded.salt,hash=excluded.hash,iterations=excluded.iterations,code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0,created_at=excluded.created_at").bind(email,salt,hash,ITERATIONS,codeHash,now()+600,now()).run();
  const response=await fetch("https://api.resend.com/emails",{
   method:"POST",headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},
   body:JSON.stringify({from:env.OTP_FROM_EMAIL,to:[email],subject:"PDF.ATHAT - تأكيد البريد الإلكتروني",text:"رمز تفعيل حسابك في PDF.ATHAT: "+code+"\nصالح لمدة 10 دقائق. إذا لم تطلب إنشاء حساب، تجاهل الرسالة."})
  });
  if(!response.ok){
   await env.PDF_AUTH_DB.prepare("DELETE FROM pending_password_signups WHERE email=? AND code_hash=?").bind(email,codeHash).run();
   return fail("تعذر إرسال رسالة التأكيد. تحقق من إعدادات البريد وأعد المحاولة.",502)
  }
  return json({ok:true,verificationRequired:true,message:"أرسلنا رمز التفعيل إلى بريدك. أدخله لإتمام إنشاء الحساب."})
 }
 const user=await env.PDF_AUTH_DB.prepare("SELECT u.id,p.salt,p.hash,p.iterations FROM users u JOIN password_credentials p ON p.user_id=u.id WHERE u.email=?").bind(email).first();
 if(!user){await derive(password,random());return fail("البريد أو كلمة المرور غير صحيحة.",401)}
 const candidate=await derive(password,user.salt,user.iterations);
 // Fixed-length comparison avoids early exits.
 const a=Uint8Array.from(candidate.match(/../g).map(x=>parseInt(x,16))),b=Uint8Array.from(user.hash.match(/../g).map(x=>parseInt(x,16)));
 let diff=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)diff|=(a[i]||0)^(b[i]||0);
 if(diff!==0)return fail("البريد أو كلمة المرور غير صحيحة.",401);
 return establishSession(env,user.id,data.deviceName)
}
async function confirmSignup(context){
 const {env,request}=context;
 if(!env.OTP_SECRET)return fail("التحقق غير مهيأ.",503);
 const data=await input(request,1500),email=cleanEmail(data?.email),code=String(data?.code||"");
 if(!emailValid(email)||!/^[0-9]{6}$/.test(code))return fail("البريد أو رمز التحقق غير صحيح.",400);
 const ip=request.headers.get("cf-connecting-ip")||"unknown";
 if(!await throttle(env.PDF_AUTH_DB,"signup-verify:"+await hmac(env.OTP_SECRET,ip+":"+email),10,900))return fail("محاولات كثيرة، حاول لاحقًا.",429);
 const pending=await env.PDF_AUTH_DB.prepare("SELECT salt,hash,iterations,code_hash,expires_at,attempts FROM pending_password_signups WHERE email=?").bind(email).first();
 if(!pending||pending.expires_at<now()||pending.attempts>=5)return fail("الرمز غير صالح أو انتهى. أعد التسجيل للحصول على رمز جديد.",401);
 await env.PDF_AUTH_DB.prepare("UPDATE pending_password_signups SET attempts=attempts+1 WHERE email=?").bind(email).run();
 const expected=await hmac(env.OTP_SECRET,"password-signup:"+email+":"+code);
 let mismatch=expected.length^pending.code_hash.length;
 for(let i=0;i<Math.max(expected.length,pending.code_hash.length);i++)mismatch|=(expected.charCodeAt(i)||0)^(pending.code_hash.charCodeAt(i)||0);
 if(mismatch)return fail("رمز التحقق غير صحيح.",401);
 const already=await env.PDF_AUTH_DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first();
 if(already)return fail("هذا البريد مرتبط بحساب آخر. استخدم تسجيل الدخول.",409);
 const id=crypto.randomUUID(),stamp=now();
 try{
  await env.PDF_AUTH_DB.batch([
   env.PDF_AUTH_DB.prepare("INSERT INTO users(id,email,created_at) VALUES(?,?,?)").bind(id,email,stamp),
   env.PDF_AUTH_DB.prepare("INSERT INTO password_credentials(user_id,salt,hash,iterations,created_at) VALUES(?,?,?,?,?)").bind(id,pending.salt,pending.hash,pending.iterations,stamp),
   env.PDF_AUTH_DB.prepare("DELETE FROM pending_password_signups WHERE email=?").bind(email)
  ]);
 }catch(error){console.error("signup confirm",error);return fail("لم يكتمل إنشاء الحساب، حاول مجددًا.",409)}
 return establishSession(env,id,data.deviceName)
}
async function requestCode(context){
 const {request,env}=context;
 if(!env.RESEND_API_KEY||!env.OTP_FROM_EMAIL||!env.OTP_SECRET)return fail("خدمة إرسال رموز البريد لم تُفعّل بعد.",503);
 const obj=await input(request),email=cleanEmail(obj?.email),mode=obj?.mode==="register"?"register":obj?.mode==="login"?"login":null;
 if(!mode)return fail("اختر إنشاء حساب أو تسجيل الدخول.",400);
 if(!emailValid(email))return fail("أدخل بريدًا إلكترونيًا صحيحًا.",400);
 const existing=await env.PDF_AUTH_DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first();
 
 if(mode==="login"&&!existing)return fail("لا يوجد حساب بهذا البريد. اختر إنشاء حساب جديد.",404);
 if(mode==="register"&&existing)return fail("هذا البريد مسجل بالفعل؛ اختر تسجيل الدخول.",409);
 const ip=request.headers.get("cf-connecting-ip")||"unknown";
 const ipKey=await hmac(env.OTP_SECRET,"ip:"+ip);
 if(!await throttle(env.PDF_AUTH_DB,"otp-ip:"+ipKey,12,3600)||!await throttle(env.PDF_AUTH_DB,"otp-mail:"+await hmac(env.OTP_SECRET,email),4,3600))return fail("طلبات كثيرة، حاول لاحقًا.",429);
 const value=crypto.getRandomValues(new Uint32Array(1))[0]%1000000,code=String(value).padStart(6,"0");
 const codeHash=await hmac(env.OTP_SECRET,email+":"+mode+":"+code);
 await env.PDF_AUTH_DB.prepare("INSERT INTO challenges(email,code_hash,expires_at,attempts,issued_at) VALUES(?,?,?,0,?) ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0,issued_at=excluded.issued_at").bind(email,codeHash,now()+600,now()).run();
 const sent=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from:env.OTP_FROM_EMAIL,to:[email],subject:"رمز الدخول إلى PDF.ATHAT",text:"رمز التحقق الخاص بك: "+code+"\nصالح لمدة عشر دقائق. إذا لم تطلبه فتجاهل الرسالة."})});
 if(!sent.ok){await env.PDF_AUTH_DB.prepare("DELETE FROM challenges WHERE email=?").bind(email).run();return fail("تعذر إرسال رمز التحقق، حاول مرة أخرى.",502)}
 return json({ok:true,message:"أرسلنا رمزًا من 6 أرقام إلى بريدك الإلكتروني."})
}
async function verifyCode(context){
 const {request,env}=context;if(!env.OTP_SECRET)return fail("إعدادات التحقق غير مكتملة.",503);
 const data=await input(request),email=cleanEmail(data?.email),code=String(data?.code||""),mode=data?.mode==="register"?"register":data?.mode==="login"?"login":null;
 if(!mode||!emailValid(email)||!/^[0-9]{6}$/.test(code))return fail("تحقق من البريد والرمز.",400);
 const row=await env.PDF_AUTH_DB.prepare("SELECT * FROM challenges WHERE email=?").bind(email).first();
 if(!row||row.expires_at<now()||row.attempts>=5)return fail("الرمز غير صالح أو انتهت صلاحيته.",401);
 await env.PDF_AUTH_DB.prepare("UPDATE challenges SET attempts=attempts+1 WHERE email=?").bind(email).run();
 const candidate=await hmac(env.OTP_SECRET,email+":"+mode+":"+code);
 if(candidate!==row.code_hash)return fail("الرمز غير صحيح.",401);
 await env.PDF_AUTH_DB.prepare("DELETE FROM challenges WHERE email=?").bind(email).run();
 let user=await env.PDF_AUTH_DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first();
 if(mode==="login"&&!user)return fail("لا يوجد حساب بهذا البريد. اختر إنشاء حساب جديد.",404);
 if(mode==="register"&&user)return fail("الحساب موجود بالفعل. اختر تسجيل الدخول.",409);
 if(!user&&mode==="register"){const id=crypto.randomUUID();await env.PDF_AUTH_DB.prepare("INSERT OR IGNORE INTO users(id,email,created_at) VALUES(?,?,?)").bind(id,email,now()).run();user=await env.PDF_AUTH_DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first()}
 if(!user)return fail("لا يوجد حساب بهذا البريد.",404)
 const token=random(),device=crypto.randomUUID();
 const deviceName=String(data?.deviceName||"جهاز جديد").slice(0,70);
 await env.PDF_AUTH_DB.prepare("INSERT INTO sessions(token_hash,user_id,device_id,device_name,expires_at,created_at) VALUES(?,?,?,?,?,?)").bind(await digest(token),user.id,device,deviceName,now()+2592000,now()).run();
 return new Response(JSON.stringify({ok:true,email,deviceId:device}),{headers:{"Content-Type":"application/json","Cache-Control":"no-store","Set-Cookie":sessionCookie(token,2592000)}})
}
async function access(context){
 const memberInfo=await member(context);
 if(!memberInfo)return {error:fail("سجل دخولك بالبريد أولًا.",401)};
 return {user:memberInfo};
}
async function logout(context){
 const token=cookie(context.request);if(token)await context.env.PDF_AUTH_DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await digest(token)).run();
 return new Response(JSON.stringify({ok:true}),{headers:{"Content-Type":"application/json","Set-Cookie":sessionCookie("",0),"Cache-Control":"no-store"}})
}
const parsePath=ctx=>{const p=ctx.params.path;return(Array.isArray(p)?p:[p||""]).map(String)};
export async function onRequest(context){
 const {request,env}=context;
 if(!env.PDF_AUTH_DB)return fail("خدمة الحسابات قيد التجهيز.",503);
 const path=parsePath(context),method=request.method;
 if(method!=="GET"&&method!=="HEAD"){
  const origin=request.headers.get("origin");
  if(origin&&origin!==new URL(request.url).origin)return fail("مصدر الطلب غير مسموح.",403);
 }
 if(path.join("/")==="health"&&method==="GET")return json({ok:true,otpReady:Boolean(env.RESEND_API_KEY&&env.OTP_FROM_EMAIL&&env.OTP_SECRET),signupVerificationReady:Boolean(env.RESEND_API_KEY&&env.OTP_FROM_EMAIL&&env.OTP_SECRET)});
 try{
  if(path.join("/")==="auth/password/register"&&method==="POST")return await passwordAction(context,"register");
  if(path.join("/")==="auth/password/login"&&method==="POST")return await passwordAction(context,"login");
  if(path.join("/")==="auth/password/confirm"&&method==="POST")return await confirmSignup(context);
  if(path.join("/")==="auth/request"&&method==="POST")return await requestCode(context);
  if(path.join("/")==="auth/verify"&&method==="POST")return await verifyCode(context);
  if(path.join("/")==="auth/logout"&&method==="POST")return await logout(context);
  if(path.join("/")==="auth/session"&&method==="GET"){
   const u=await member(context);
   if(!u)return json({signedIn:false});
   const rows=await env.PDF_AUTH_DB.prepare("SELECT device_id,device_name,created_at FROM sessions WHERE user_id=? AND expires_at>? ORDER BY created_at DESC").bind(u.user_id,now()).all();
   return json({signedIn:true,email:u.email,deviceId:u.device_id,devices:rows.results||[]});
  }

  // Device-presence metadata and short-lived WebRTC signaling only; no PDF payload endpoints.
  const {user,error}=await access(context);if(error)return error;
  const db=env.PDF_AUTH_DB,uid=user.user_id,device=user.device_id,stamp=now();
  if(path.join("/") === "devices/revoke" && method==="POST"){
   const x=await input(request,1000),target=x?.deviceId;
   if(typeof target!=="string"||target===device||!/^[-0-9a-f]{36}$/i.test(target))return fail("جهاز غير صالح.",400);
   await db.prepare("DELETE FROM sessions WHERE user_id=? AND device_id=?").bind(uid,target).run();
   await db.prepare("DELETE FROM peer_signals WHERE user_id=? AND (recipient=? OR sender=?)").bind(uid,target,target).run();
   await db.prepare("DELETE FROM peer_presence WHERE user_id=? AND device_id=?").bind(uid,target).run();
   return json({ok:true});
  }
  if(path.join("/") === "devices" && method==="GET"){
   const rows=await db.prepare("SELECT s.device_id,s.device_name,MAX(COALESCE(p.last_seen,0)) AS last_seen FROM sessions s LEFT JOIN peer_presence p ON p.user_id=s.user_id AND p.device_id=s.device_id WHERE s.user_id=? AND s.expires_at>? GROUP BY s.device_id,s.device_name ORDER BY MAX(s.created_at) DESC").bind(uid,stamp).all();
   return json({devices:(rows.results||[]).filter(x=>x.device_id!==device).map(x=>({device_id:x.device_id,device_name:x.device_name,online:x.last_seen>stamp-45}))});
  }
  if(path.join("/") === "signal" && method==="POST"){
   const x=await input(request,11000);
   if(!x||typeof x.recipient!=="string"||!/^[0-9a-f-]{36}$/i.test(x.recipient)||!["offer","answer","ice"].includes(x.kind)||typeof x.payload!=="string"||x.payload.length>10000)return fail("إشارة غير صالحة.",400);
   const valid=await db.prepare("SELECT 1 FROM sessions WHERE user_id=? AND device_id=? AND expires_at>?").bind(uid,x.recipient,stamp).first();
   if(!valid)return fail("الجهاز غير مرتبط بهذا الحساب.",404);
   if(!await throttle(db,"peer-signal:"+uid+":"+device,400,3600))return fail("طلبات الاتصال كثيرة.",429);
   await db.prepare("DELETE FROM peer_signals WHERE expires_at<?").bind(stamp).run();
   await db.prepare("INSERT INTO peer_signals(user_id,recipient,sender,kind,payload,expires_at) VALUES(?,?,?,?,?,?)").bind(uid,x.recipient,device,x.kind,x.payload,stamp+120).run();
   return json({ok:true});
  }
  if(path.join("/") === "presence" && method==="POST"){
   await db.prepare("INSERT INTO peer_presence(user_id,device_id,last_seen) VALUES(?,?,?) ON CONFLICT(user_id,device_id) DO UPDATE SET last_seen=excluded.last_seen").bind(uid,device,stamp).run();
   return json({ok:true});
  }
  if(path.join("/") === "signals" && method==="GET"){
   const rows=await db.prepare("SELECT id,sender,kind,payload FROM peer_signals WHERE user_id=? AND recipient=? AND expires_at>? ORDER BY id LIMIT 50").bind(uid,device,stamp).all();
   if(rows.results?.length)await db.prepare("DELETE FROM peer_signals WHERE user_id=? AND recipient=? AND id<=?").bind(uid,device,rows.results.at(-1).id).run();
   return json({signals:rows.results||[]});
  }
  return fail("غير موجود.",404)
 }catch(err){console.error("PDF.ATHAT API",err);return fail("تعذر تنفيذ العملية حاليًا.",500)}
}
