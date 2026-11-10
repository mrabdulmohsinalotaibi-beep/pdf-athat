// Public first-party, anonymous traffic counter. Only coarse metadata is
// persisted; raw IPs, full agents, account IDs, PDF names and URLs are not.
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const encoder=new TextEncoder();
const hex=bytes=>Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');
export function classifyAgent(agent=''){
 const ua=typeof agent==='string'?agent.slice(0,350):'';
 const device=/bot|crawler|spider|slurp|headless|lighthouse|uptimerobot/i.test(ua)?'bot':/ipad|tablet|android(?!.*mobile)/i.test(ua)?'tablet':/iphone|ipod|android|mobile/i.test(ua)?'mobile':'desktop';
 const browser=/edg\//i.test(ua)?'Edge':/firefox\//i.test(ua)?'Firefox':/crios\/|chrome\//i.test(ua)?'Chrome':/safari\//i.test(ua)?'Safari':'Other';
 return {device,browser};
}
export function safeCountry(country){
 return typeof country==='string'&&/^[A-Z]{2}$/.test(country)?country:'ZZ';
}
export function dayRiyadh(stamp=Date.now()){return new Date(stamp+3*3600000).toISOString().slice(0,10)}
export async function visitorDigest(secret,day,ip,agent){
 const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return hex(await crypto.subtle.sign('HMAC',key,encoder.encode(day+'|'+ip+'|'+agent.slice(0,220))));
}
export async function onRequest({request,env}){
 try{
  if(request.method!=='POST')return json({error:'طريقة غير مدعومة'},405);
  const url=new URL(request.url);
  const origin=request.headers.get('Origin');
  if(origin!==url.origin||request.headers.get('Sec-Fetch-Site')==='cross-site')return json({error:'غير مسموح'},403);
  if(!env.PDF_AUTH_DB||!env.OTP_SECRET)return json({recorded:false},503);
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'نوع الطلب غير مدعوم'},415);
  const length=Number(request.headers.get('Content-Length')||0);
  if(length>128)return json({error:'الطلب كبير'},413);
  const body=await request.json().catch(()=>null);
  if(!body||!['home','account','admin'].includes(body.page)||Object.keys(body).length!==1)return json({error:'صفحة غير صالحة'},400);
  const agent=request.headers.get('User-Agent')||'';
  const {device,browser}=classifyAgent(agent);
  if(device==='bot')return json({recorded:false});
  const day=dayRiyadh();
  const ip=request.headers.get('CF-Connecting-IP')||'';
  if(!ip)return json({recorded:false});
  const visitor_hash=await visitorDigest(env.OTP_SECRET,day,ip,agent);
  const country=safeCountry(request.cf?.country);
  const stmt=env.PDF_AUTH_DB.prepare(`INSERT INTO pdf_traffic_visits(day,visitor_hash,country,device,browser,page,visits,last_seen)
   VALUES(?,?,?,?,?,?,1,?)
   ON CONFLICT(day,visitor_hash,page) DO UPDATE SET
   visits=MIN(50,pdf_traffic_visits.visits+1),last_seen=excluded.last_seen`)
   .bind(day,visitor_hash,country,device,browser,body.page,Math.floor(Date.now()/1000));
  await stmt.run();
  return json({recorded:true});
 }catch(error){console.warn('traffic_record_failed',error?.name);return json({recorded:false},503)}
}
