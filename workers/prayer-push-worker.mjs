// Dedicated Cloudflare Worker — Web Push prayer reminder sender.
// Secrets: PRAYER_VAPID_PRIVATE_JWK (JWK JSON), PRAYER_VAPID_PUBLIC (base64url).
// Binding: PDF_AUTH_DB (D1). Trigger: */1 * * * * (UTC).
// No user documents or email addresses are read by this Worker.
const encoder=new TextEncoder();
const b64=u8=>btoa(String.fromCharCode(...u8)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const bytes=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
const concat=(...parts)=>{const a=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let n=0;for(const p of parts){a.set(p,n);n+=p.length}return a};
const hkdf=async(key,salt,info,len)=>{
 const k=await crypto.subtle.importKey('raw',key,'HKDF',false,['deriveBits']);
 return new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info},k,len*8));
};
const timeOf=t=>{const m=String(t||'').match(/^(\d{1,2}):(\d{2})/);return m?Number(m[1])*60+Number(m[2]):null};
const isoDate=now=>new Date(now+3*3600000).toISOString().slice(0,10);
async function scheduleFor(db,city,day){
 const key=city+':'+day;
 let row=await db.prepare('SELECT timings FROM pdf_prayer_push_times WHERE city_day=?').bind(key).first();
 if(row)return JSON.parse(row.timings);
 const [year,month,date]=day.split('-');
 const qs=new URLSearchParams({city,country:'SA',method:'4',school:'0'});
 const response=await fetch('https://api.aladhan.com/v1/timingsByCity/'+date+'-'+month+'-'+year+'?'+qs,{signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw Error('prayer_times_http_'+response.status);
 const result=await response.json();
 if(result.code!==200||!result.data?.timings?.Fajr)throw Error('prayer_times_invalid');
 const timings={};for(const k of ['Fajr','Dhuhr','Asr','Maghrib','Isha']){
  timings[k]=timeOf(result.data.timings[k]);
  if(!Number.isFinite(timings[k]))throw Error('prayer_time_missing_'+k);
 }
 await db.prepare('INSERT OR REPLACE INTO pdf_prayer_push_times(city_day,timings,created_at) VALUES(?,?,?)')
  .bind(key,JSON.stringify(timings),Math.floor(Date.now()/1000)).run();
 return timings;
}
async function encrypt(subscription,payload){
 const receiver=await crypto.subtle.importKey('raw',bytes(subscription.p256dh),{name:'ECDH',namedCurve:'P-256'},false,[]);
 const sender=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
 const serverPublic=new Uint8Array(await crypto.subtle.exportKey('raw',sender.publicKey));
 const shared=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:receiver},sender.privateKey,256));
 const secret=await hkdf(shared,bytes(subscription.auth),concat(encoder.encode('WebPush: info\0'),bytes(subscription.p256dh),serverPublic),32);
 const salt=crypto.getRandomValues(new Uint8Array(16));
 const cek=await hkdf(secret,salt,encoder.encode('Content-Encoding: aes128gcm\0'),16);
 const nonce=await hkdf(secret,salt,encoder.encode('Content-Encoding: nonce\0'),12);
 const aes=await crypto.subtle.importKey('raw',cek,{name:'AES-GCM'},false,['encrypt']);
 const plain=concat(encoder.encode(JSON.stringify(payload)),new Uint8Array([2]));
 const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,tagLength:128},aes,plain));
 const recordSize=new Uint8Array([0,0,16,0]); // 4096-byte record
 return concat(salt,recordSize,new Uint8Array([serverPublic.length]),serverPublic,cipher);
}
async function jwt(privateJwk,endpoint){
 const aud=new URL(endpoint).origin;
 const enc=obj=>b64(encoder.encode(JSON.stringify(obj)));
 const body=enc({aud,exp:Math.floor(Date.now()/1000)+3600,sub:'https://pdf.athat.app'});
 const signed=enc({typ:'JWT',alg:'ES256'})+'.'+body;
 const privateKey=await crypto.subtle.importKey('jwk',privateJwk,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
 const signature=new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},privateKey,encoder.encode(signed)));
 return signed+'.'+b64(signature);
}
async function send(env,subscription,event){
 const body=await encrypt(subscription,{title:'PDF.ATHAT · مواقيت الصلاة',body:event.message,tag:event.key,url:'/'});
 const token=await jwt(JSON.parse(env.PRAYER_VAPID_PRIVATE_JWK),subscription.endpoint);
 const r=await fetch(subscription.endpoint,{method:'POST',headers:{
  'Authorization':'vapid t='+token+', k='+env.PRAYER_VAPID_PUBLIC,
  'TTL':'600','Urgency':'high','Content-Encoding':'aes128gcm',
  'Content-Type':'application/octet-stream'
 },body});
 if(r.status===404||r.status===410){
  await env.PDF_AUTH_DB.prepare('DELETE FROM pdf_prayer_push_subscriptions WHERE id=?').bind(subscription.id).run();
  return 'gone';
 }
 if(!r.ok)throw Error('push_http_'+r.status);
 return 'sent';
}
export function eventsFor(row,times,day,now){
 const entries=[['Fajr','الفجر'],['Dhuhr','الظهر'],['Asr','العصر'],['Maghrib','المغرب'],['Isha','العشاء']];
 const [y,m,d]=day.split('-').map(Number);
 const output=[];
 for(const [id,name] of entries){
  const mins=times[id];
  const cases=[];
  if(row.before_minutes>0)cases.push(['before',mins-row.before_minutes,'اقترب موعد صلاة '+name+' في '+row.city+' (بعد '+row.before_minutes+' دقائق)']);
  if(row.adhan)cases.push(['adhan',mins,'حان الآن وقت صلاة '+name+' في '+row.city]);
  if(row.iqama)cases.push(['iqama',mins+row.iqama_delay,'تنبيه إقامة صلاة '+name+' بعد الأذان بـ'+row.iqama_delay+' دقيقة']);
  for(const [kind,minute,message] of cases){
   const due=Date.UTC(y,m-1,d,0,minute)-3*3600000;
   if(now>=due&&now-due<105000)output.push({key:day+':'+id+':'+kind,message});
  }
 }
 return output;
}
export async function processMinute(env,now=Date.now()){
 if(!env.PDF_AUTH_DB||!env.PRAYER_VAPID_PRIVATE_JWK||!env.PRAYER_VAPID_PUBLIC)throw Error('push_config_missing');
 const db=env.PDF_AUTH_DB,day=isoDate(now);
 await db.prepare("INSERT INTO pdf_prayer_push_worker_status(key,heartbeat_at) VALUES('cron',?) ON CONFLICT(key) DO UPDATE SET heartbeat_at=excluded.heartbeat_at").bind(Math.floor(now/1000)).run();
 const subscriptionRows=await db.prepare('SELECT id,endpoint,p256dh,auth,city,before_minutes,adhan,iqama,iqama_delay FROM pdf_prayer_push_subscriptions WHERE enabled=1 LIMIT 500').all();
 const rows=subscriptionRows.results||[];
 const cities=[...new Set(rows.map(r=>r.city))],schedules=new Map();
 for(const city of cities){try{schedules.set(city,await scheduleFor(db,city,day))}catch(error){console.warn('prayer_times_failed',city,String(error).slice(0,100))}}
 let sent=0;
 for(const row of rows){
  const times=schedules.get(row.city);if(!times)continue;
  for(const event of eventsFor(row,times,day,now)){
   const done=await db.prepare('SELECT 1 AS sent FROM pdf_prayer_push_deliveries WHERE subscription_id=? AND event_key=?')
    .bind(row.id,event.key).first();
   if(done)continue;
   try{
    const status=await send(env,row,event);
    if(status==='sent'){
     await db.prepare('INSERT OR IGNORE INTO pdf_prayer_push_deliveries(subscription_id,event_key,created_at) VALUES(?,?,?)')
      .bind(row.id,event.key,Math.floor(now/1000)).run();
     sent++;
    }
   }catch(error){console.warn('prayer_push_send_failed',String(error).slice(0,110))}
  }
 }
 // Cleanup once daily, avoiding unlimited growth.
 if(new Date(now).getUTCHours()===0&&new Date(now).getUTCMinutes()===0){
  await db.prepare('DELETE FROM pdf_prayer_push_deliveries WHERE created_at<?').bind(Math.floor(now/1000)-8*86400).run();
  await db.prepare('DELETE FROM pdf_prayer_push_times WHERE created_at<?').bind(Math.floor(now/1000)-3*86400).run();
 }
 return {devices:rows.length,sent};
}
export default {
 async scheduled(event,env,ctx){ctx.waitUntil(processMinute(env))},
 async fetch(){return new Response('Not found',{status:404})}
};
