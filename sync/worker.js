// PDF.ATHAT account and signaling Worker. No uploaded PDF bytes, files or annotations.
// Bind DB to D1; set MAIL_FROM, RESEND_API_KEY, ALLOWED_ORIGIN as secrets/vars.
const json=(body,status=200,extra={})=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...extra}});
const hex=async(s)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)))).map(v=>v.toString(16).padStart(2,"0")).join("");
const now=()=>Math.floor(Date.now()/1000);
const random=(n=32)=>{let a=new Uint8Array(n);crypto.getRandomValues(a);return Array.from(a).map(x=>x.toString(16).padStart(2,"0")).join("")};
const consumeRate=async(db,bucket,limit,windowSeconds)=>{const t=now();const row=await db.prepare("SELECT counter,resets_at FROM rate_limits WHERE bucket=?").bind(bucket).first();if(row&&row.resets_at>t&&row.counter>=limit)return false;await db.prepare("INSERT INTO rate_limits(bucket,counter,resets_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET counter=CASE WHEN resets_at<=? THEN 1 ELSE counter+1 END,resets_at=CASE WHEN resets_at<=? THEN excluded.resets_at ELSE resets_at END").bind(bucket,t+windowSeconds,t,t).run();return true};
const validEmail=s=>typeof s==="string"&&s.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const allowed=(request,env)=>{const o=request.headers.get("origin");return o===env.ALLOWED_ORIGIN||!o};
export default {async fetch(request,env){
 const origin=request.headers.get("origin")||"";
 const cors=origin===env.ALLOWED_ORIGIN?{"access-control-allow-origin":origin,"vary":"Origin","access-control-allow-headers":"content-type,authorization","access-control-allow-methods":"GET,POST,OPTIONS"}:{};
 if(request.method==="OPTIONS")return new Response(null,{status:allowed(request,env)?204:403,headers:cors});
 const respond=(data,status=200)=>json(data,status,cors);
 if(!allowed(request,env))return respond({error:"origin_not_allowed"},403);
 if(!env.DB||!env.RESEND_API_KEY||!env.MAIL_FROM||!env.ALLOWED_ORIGIN||!env.OTP_PEPPER)return respond({error:"server_not_configured"},503);
 const u=new URL(request.url),path=u.pathname;
 if(path==="/health")return respond({ok:true,mode:"peer-only"});
 const ip=request.headers.get("CF-Connecting-IP")||"unidentified";
 let body={};
 if(request.method==="POST"){
  if(Number(request.headers.get("content-length")||0)>12000)return respond({error:"request_too_large"},413);
  try{const raw=await request.text();if(raw.length>12000)return respond({error:"request_too_large"},413);body=JSON.parse(raw)}catch{return respond({error:"invalid_json"},400)}
 }
 try{
 if(path==="/auth/request"&&request.method==="POST"){
  const email=String(body.email||"").trim().toLowerCase();
  if(!validEmail(email))return respond({error:"invalid_email"},400);
  if(!await consumeRate(env.DB,"otp-ip:"+await hex(ip),12,3600)||!await consumeRate(env.DB,"otp-email:"+await hex(email),5,3600))return respond({error:"rate_limited"},429);
  const existing=await env.DB.prepare("SELECT sent_at FROM otp_codes WHERE email=?").bind(email).first();
  if(existing&&now()-existing.sent_at<60)return respond({ok:true});
  const code=String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,"0");
  const hash=await hex(email+":"+code+":"+env.OTP_PEPPER);
  const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"authorization":"Bearer "+env.RESEND_API_KEY,"content-type":"application/json"},body:JSON.stringify({from:env.MAIL_FROM,to:[email],subject:"رمز دخول PDF.ATHAT",text:"رمز الدخول: "+code+"\nصالح لمدة 10 دقائق. لا تشاركه مع أحد."})});
  if(!response.ok)return respond({error:"delivery_failed"},502);
  await env.DB.prepare("INSERT INTO otp_codes(email,code_hash,expires_at,sent_at,attempts) VALUES(?,?,?,?,0) ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,sent_at=excluded.sent_at,attempts=0").bind(email,hash,now()+600,now()).run();
  return respond({ok:true});
 }
 if(path==="/auth/verify"&&request.method==="POST"){
  const email=String(body.email||"").trim().toLowerCase(),code=String(body.code||"");
  const deviceId=String(body.deviceId||""),deviceName=String(body.deviceName||"جهاز").slice(0,80);
  if(!validEmail(email)||!/^[0-9]{6}$/.test(code)||!/^[0-9a-f-]{36}$/i.test(deviceId))return respond({error:"invalid_request"},400);
  if(!await consumeRate(env.DB,"verify-ip:"+await hex(ip),30,3600)||!await consumeRate(env.DB,"verify-email:"+await hex(email),12,3600))return respond({error:"rate_limited"},429);
  const row=await env.DB.prepare("SELECT * FROM otp_codes WHERE email=?").bind(email).first();
  if(!row||row.expires_at<now()||row.attempts>=5)return respond({error:"code_expired"},401);
  await env.DB.prepare("UPDATE otp_codes SET attempts=attempts+1 WHERE email=?").bind(email).run();
  if(row.code_hash!==await hex(email+":"+code+":"+env.OTP_PEPPER))return respond({error:"invalid_code"},401);
  await env.DB.prepare("DELETE FROM otp_codes WHERE email=?").bind(email).run();
  const token=random(32),tokenHash=await hex(token);
  await env.DB.prepare("INSERT INTO sessions(token_hash,email,device_id,device_name,expires_at) VALUES(?,?,?,?,?)").bind(tokenHash,email,deviceId,deviceName,now()+30*86400).run();
  return respond({token,email,deviceId,expiresAt:now()+30*86400});
 }
 const token=(request.headers.get("authorization")||"").match(/^Bearer ([0-9a-f]{64})$/i)?.[1];
 if(!token)return respond({error:"unauthorized"},401);
 const session=await env.DB.prepare("SELECT * FROM sessions WHERE token_hash=? AND expires_at>?").bind(await hex(token),now()).first();
 if(!session)return respond({error:"session_expired"},401);
 if(!await consumeRate(env.DB,"api:"+session.token_hash,1800,3600))return respond({error:"rate_limited"},429);
 if(path==="/auth/logout"&&request.method==="POST"){await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await hex(token)).run();return respond({ok:true})}
 if(path==="/devices/revoke"&&request.method==="POST"){
  const target=String(body.deviceId||"");if(!/^[0-9a-f-]{36}$/i.test(target)||target===session.device_id)return respond({error:"invalid_device"},400);
  await env.DB.prepare("DELETE FROM sessions WHERE email=? AND device_id=?").bind(session.email,target).run();
  await env.DB.prepare("DELETE FROM peer_signals WHERE email=? AND (recipient=? OR sender=?)").bind(session.email,target,target).run();return respond({ok:true});
 }
 if(path==="/devices"&&request.method==="GET"){
  const data=await env.DB.prepare("SELECT device_id,device_name FROM sessions WHERE email=? AND expires_at>? GROUP BY device_id ORDER BY MAX(expires_at) DESC").bind(session.email,now()).all();
  return respond({devices:data.results.filter(x=>x.device_id!==session.device_id)});
 }
 if(path==="/signal"&&request.method==="POST"){
  const recipient=String(body.recipient||""),kind=String(body.kind||""),payload=body.payload;
  if(!/^[0-9a-f-]{36}$/i.test(recipient)||!["offer","answer","ice","request","accept","reject"].includes(kind))return respond({error:"invalid_signal"},400);
  if(typeof payload!=="string"||payload.length>8000)return respond({error:"invalid_payload"},400);
  if(!await consumeRate(env.DB,"signal:"+session.token_hash,400,3600))return respond({error:"rate_limited"},429);
  const peer=await env.DB.prepare("SELECT 1 FROM sessions WHERE email=? AND device_id=? AND expires_at>?").bind(session.email,recipient,now()).first();
  if(!peer)return respond({error:"device_not_online_or_registered"},404);
  await env.DB.prepare("DELETE FROM peer_signals WHERE expires_at<?").bind(now()).run();
  await env.DB.prepare("INSERT INTO peer_signals(email,recipient,sender,kind,payload,expires_at) VALUES(?,?,?,?,?,?)").bind(session.email,recipient,session.device_id,kind,payload,now()+120).run();
  return respond({ok:true});
 }
 if(path==="/signals"&&request.method==="GET"){
  const rows=await env.DB.prepare("SELECT id,sender,kind,payload FROM peer_signals WHERE email=? AND recipient=? AND expires_at>? ORDER BY id LIMIT 50").bind(session.email,session.device_id,now()).all();
  if(rows.results.length){await env.DB.prepare("DELETE FROM peer_signals WHERE email=? AND recipient=? AND id<=?").bind(session.email,session.device_id,rows.results.at(-1).id).run()}
  return respond({signals:rows.results});
 }
 return respond({error:"not_found"},404)
 }catch(error){console.error("PDF sync error",error?.message);return respond({error:"server_error"},500)}
}};
