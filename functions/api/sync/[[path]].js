import {session} from '../../../server/auth.mjs';

// Signaling only. SDP/ICE includes network connection data; never accept PDF content.
const response=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const sql=(db,q,...params)=>db.prepare(q).bind(...params);
const validId=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const now=()=>Math.floor(Date.now()/1000);
async function readJSON(request){
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))return null;
 const text=await request.text();
 if(text.length>55000)return null;
 try{const parsed=JSON.parse(text);return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:null}catch{return null}
}
export async function onRequest({request,env}){
 try{
  if(!env.PDF_AUTH_DB)return response({error:'خدمة الحسابات غير متاحة'},503);
  if(request.method!=='POST')return response({error:'طريقة الطلب غير مدعومة'},405);
  const url=new URL(request.url);
  if(request.headers.get('Origin')!==url.origin || request.headers.get('Sec-Fetch-Site')==='cross-site')return response({error:'الطلب غير مسموح'},403);
  const user=await session(env.PDF_AUTH_DB,request);
  if(!user)return response({error:'يجب تسجيل الدخول أولًا'},401);
  const body=await readJSON(request);
  if(!body||!validId(body.deviceId))return response({error:'بيانات الجهاز غير صالحة'},400);
  const db=env.PDF_AUTH_DB,stamp=now(),userId=user.id,deviceId=body.deviceId;
  const action=url.pathname.replace(/^\/api\/sync\/?/,'');
  if(action==='heartbeat'){
   const name=typeof body.name==='string'?body.name.trim().slice(0,45):'جهاز';
   if(!name||name.length>45)return response({error:'اسم الجهاز غير صالح'},400);
   const current=await sql(db,'SELECT COUNT(*) AS count FROM pdf_sync_peers WHERE user_id=? AND last_seen>?',userId,stamp-80).first();
   const existing=await sql(db,'SELECT 1 AS yes FROM pdf_sync_peers WHERE user_id=? AND device_id=?',userId,deviceId).first();
   if(!existing&&Number(current?.count||0)>=5)return response({error:'الحد الأقصى خمسة أجهزة متصلة بالحساب'},429);
   await sql(db,'INSERT INTO pdf_sync_peers(user_id,device_id,device_name,last_seen) VALUES(?,?,?,?) ON CONFLICT(user_id,device_id) DO UPDATE SET device_name=excluded.device_name,last_seen=excluded.last_seen',userId,deviceId,name,stamp).run();
   // Time bounded: stale sessions and signaling never contain library content.
   await sql(db,'DELETE FROM pdf_sync_signals WHERE expires_at<?',stamp).run();
   await sql(db,'DELETE FROM pdf_sync_peers WHERE last_seen<?',stamp-300).run();
   const peers=await sql(db,'SELECT device_id AS id,device_name AS name FROM pdf_sync_peers WHERE user_id=? AND device_id<>? AND last_seen>? ORDER BY device_id LIMIT 5',userId,deviceId,stamp-80).all();
   return response({peers:peers.results||[],relay:'signaling-only',filesInCloud:false});
  }
  const exists=await sql(db,'SELECT 1 AS yes FROM pdf_sync_peers WHERE user_id=? AND device_id=? AND last_seen>?',userId,deviceId,stamp-80).first();
  if(!exists)return response({error:'سجّل الجهاز في المزامنة أولًا'},409);
  if(action==='poll'){
   const inbox=await sql(db,'DELETE FROM pdf_sync_signals WHERE id IN (SELECT id FROM pdf_sync_signals WHERE user_id=? AND to_device=? ORDER BY created_at ASC LIMIT 20) RETURNING from_device AS sender,kind,payload,expires_at',userId,deviceId).all();
   return response({messages:(inbox.results||[]).filter(m=>m.expires_at>=stamp).map(m=>({sender:m.sender,kind:m.kind,payload:JSON.parse(m.payload)}))});
  }
  if(action==='leave'){
   await sql(db,'DELETE FROM pdf_sync_peers WHERE user_id=? AND device_id=?',userId,deviceId).run();
   await sql(db,'DELETE FROM pdf_sync_signals WHERE user_id=? AND (from_device=? OR to_device=?)',userId,deviceId,deviceId).run();
   return response({ok:true});
  }
  if(action==='signal'){
   if(!validId(body.to)||body.to===deviceId || !['offer','answer'].includes(body.kind) || !body.payload || body.payload.type!==body.kind || typeof body.payload.sdp!=='string' || body.payload.sdp.length>48000 || body.payload.sdp.length<30)return response({error:'بيانات الاتصال غير صالحة'},400);
   const target=await sql(db,'SELECT 1 AS yes FROM pdf_sync_peers WHERE user_id=? AND device_id=? AND last_seen>?',userId,body.to,stamp-80).first();
   if(!target)return response({error:'الجهاز الآخر غير متصل حاليًا'},404);
   const rate=await sql(db,`INSERT INTO pdf_email_limits(key,count,expires_at) VALUES(?,1,?)
     ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,
     expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING count`,
     'pdf-peer-signal:'+userId+':'+deviceId,stamp+300,stamp,stamp).first();
   if(!rate||rate.count>60)return response({error:'محاولات اتصال كثيرة'},429);
   await sql(db,'INSERT INTO pdf_sync_signals(id,user_id,from_device,to_device,kind,payload,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)',crypto.randomUUID(),userId,deviceId,body.to,body.kind,JSON.stringify({type:body.kind,sdp:body.payload.sdp}),stamp,stamp+120).run();
   return response({ok:true});
  }
  return response({error:'المسار غير موجود'},404);
 }catch(error){
  console.error('pdf_peer_sync_error',error?.name);
  return response({error:'تعذر الاتصال بخدمة ربط الأجهزة'},503);
 }
}
