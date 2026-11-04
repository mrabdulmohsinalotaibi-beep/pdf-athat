// PDF.ATHAT private account and opt-in device sync API.
// Cloudflare Pages Functions; D1: PDF_AUTH_DB, private R2: PDF_SYNC_R2.
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
 if(mode==="register")return fail("أنشئ الحساب باستخدام كلمة المرور ثم أكد البريد الإلكتروني.",400);
 if(mode==="login"&&!existing)return fail("لا يوجد حساب بهذا البريد. اختر إنشاء حساب جديد.",404);
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
 if(!user)return fail("أنشئ حسابًا جديدًا أولًا.",404)
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
 if(!env.PDF_AUTH_DB||!env.PDF_SYNC_R2)return fail("خدمة الحسابات قيد التجهيز.",503);
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
  if(path[0]!=="sync")return fail("غير موجود.",404);
  const {user,error}=await access(context);if(error)return error;
  const uid=user.user_id,bucket=env.PDF_SYNC_R2,db=env.PDF_AUTH_DB;
  if(path[1]==="list"&&method==="GET"){
   const rows=await db.prepare("SELECT id,name,sha256,size,updated_at,page FROM documents WHERE user_id=? ORDER BY updated_at DESC LIMIT 2000").bind(uid).all();
   return json({documents:rows.results||[]});
  }
  const id=path[2];if(!validId(id))return fail("معرّف غير صالح.",400);
  const objectKey=uid+"/"+id+".pdf";
  if(path[1]==="document"){
   if(method==="GET"){
    const record=await db.prepare("SELECT id FROM documents WHERE user_id=? AND id=?").bind(uid,id).first();if(!record)return fail("الملف غير موجود.",404);
    const obj=await bucket.get(objectKey);if(!obj)return fail("الملف غير موجود.",404);
    return new Response(obj.body,{headers:{"Content-Type":"application/pdf","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}})
   }
   if(method==="PUT"){
    const existing=await db.prepare("SELECT id FROM documents WHERE user_id=? AND id=?").bind(uid,id).first();
    if(existing)return fail("الملف موجود مسبقًا؛ لن نستبدله.",409);
    const limit=15*1024*1024;
    const body=await request.arrayBuffer();if(body.byteLength<5||body.byteLength>limit)return fail("حد المزامنة للملف 15 ميجابايت.",413);
    const bytes=new Uint8Array(body);
    if(new TextDecoder().decode(bytes.slice(0,1024)).indexOf("%PDF-")<0)return fail("الملف ليس PDF صالحًا.",400);
    const sha=await digest(body),name=decodeURIComponent(request.headers.get("x-pdf-name")||"document.pdf").slice(0,250);
    const page=Math.max(1,Math.min(100000,Number(request.headers.get("x-pdf-page")||1)||1));
    await bucket.put(objectKey,body,{httpMetadata:{contentType:"application/pdf"}});
    await db.prepare("INSERT OR IGNORE INTO documents(user_id,id,name,sha256,size,updated_at,page) VALUES(?,?,?,?,?,?,?)").bind(uid,id,name,sha,body.byteLength,Date.now(),page).run();
    return json({ok:true,sha256:sha})
   }
  }
  if(path[1]==="notes"){
   const doc=await db.prepare("SELECT id FROM documents WHERE user_id=? AND id=?").bind(uid,id).first();if(!doc)return fail("زامن ملف PDF أولًا.",404);
   if(method==="GET"){
    const row=await db.prepare("SELECT json FROM notes WHERE user_id=? AND doc_id=?").bind(uid,id).first();
    return json({notes:row?JSON.parse(row.json):[]})
   }
   if(method==="PUT"){
    const arr=await input(request,300000);
    if(!Array.isArray(arr)||arr.length>1000||!arr.every(x=>typeof x?.id==="string"&&x.id.length<150&&x.documentId===id&&Number.isInteger(x.page)&&x.page>0&&Array.isArray(x.points)&&x.points.length<=10000))return fail("بيانات التعليقات غير صالحة.",400);
    const row=await db.prepare("SELECT json FROM notes WHERE user_id=? AND doc_id=?").bind(uid,id).first();
    const merged=new Map((row?JSON.parse(row.json):[]).map(x=>[x.id,x]));
    for(const x of arr)if(!merged.has(x.id))merged.set(x.id,x);
    const result=Array.from(merged.values());if(result.length>3000)return fail("التعليقات تتجاوز الحد.",413);
    await db.prepare("INSERT INTO notes(user_id,doc_id,json,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,doc_id) DO UPDATE SET json=excluded.json,updated_at=excluded.updated_at").bind(uid,id,JSON.stringify(result),Date.now()).run();
    return json({ok:true,notes:result})
   }
  }
  return fail("غير موجود.",404)
 }catch(err){console.error("PDF.ATHAT API",err);return fail("تعذر تنفيذ العملية حاليًا.",500)}
}
