import { session } from '../../../server/auth.mjs';

const response = (data, status=200) => Response.json(data, {status, headers: {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const sql = (db, query, ...args) => db.prepare(query).bind(...args);
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
  if(request.method==='GET' && action==='users') {
   const search=(url.searchParams.get('q')||'').trim().toLowerCase().slice(0,80);
   const page=Math.min(1000,Math.max(0,Number.parseInt(url.searchParams.get('page')||'0',10)||0));
   const pattern='%'+search.replace(/[\\%_]/g, x=>'\\'+x)+'%';
   const rows=await sql(env.PDF_AUTH_DB,"SELECT id,email,username,role,created_at,(SELECT COUNT(*) FROM pdf_email_sessions s WHERE s.user_id=pdf_email_users.id AND s.expires_at>?) AS sessions FROM pdf_email_users WHERE email LIKE ? ESCAPE '\\' OR username LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT 30 OFFSET ?",Math.floor(Date.now()/1000),pattern,pattern,page*30).all();
   const counts=await sql(env.PDF_AUTH_DB,"SELECT COUNT(*) AS total FROM pdf_email_users WHERE email LIKE ? ESCAPE '\\' OR username LIKE ? ESCAPE '\\'",pattern,pattern).first();
   return response({users:rows.results||[],total:Number(counts?.total||0),page});
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
    return response({ok:true,revoked:Number(removed.meta?.changes||0)});
   }
   const res=await sql(env.PDF_AUTH_DB,"UPDATE pdf_email_users SET role=? WHERE id=? AND email NOT IN (SELECT email FROM pdf_admin_allowed_emails)",body.role,body.id).run();
   if(!res.meta?.changes) return response({error:'الحساب غير موجود أو محمي'},404);
   await sql(env.PDF_AUTH_DB,'DELETE FROM pdf_email_sessions WHERE user_id=?',body.id).run();
   return response({ok:true});
  }
  return response({error:'المسار غير موجود'},404);
 } catch(error) {
  console.error('admin_endpoint_failed',error?.name);
  return response({error:'تعذر إكمال الطلب'},503);
 }
}
