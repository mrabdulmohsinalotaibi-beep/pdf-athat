// Public, read-only, time-limited announcements. Never return disabled/expired ads.
export async function onRequestGet({env}){
 try{
  if(!env.PDF_AUTH_DB)return Response.json({ads:[]},{headers:{'Cache-Control':'no-store'}});
  const now=Math.floor(Date.now()/1000);
  const results=await env.PDF_AUTH_DB.prepare('SELECT id,title,body,link_url,duration_seconds FROM pdf_site_ads WHERE enabled=1 AND starts_at<=? AND ends_at>? ORDER BY updated_at DESC LIMIT 5').bind(now,now).all();
  return Response.json({ads:results.results||[]},{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 }catch(error){console.warn('site_ads_unavailable',error?.name);return Response.json({ads:[]},{headers:{'Cache-Control':'no-store'}})}
}
