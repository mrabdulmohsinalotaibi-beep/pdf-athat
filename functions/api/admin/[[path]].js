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
   const sessions=await sql(env.PDF_AUTH_DB,'SELECT COUNT(*) AS total FROM pdf_email_sessions WHERE expires_at>?',Math.floor(Date.now()/1000)).first();
   return response({users:Number(users?.total||0),admins:Number(users?.admins||0),activeSessions:Number(sessions?.total||0),mailConfigured:!!(env.RESEND_API_KEY&&env.OTP_FROM_EMAIL&&env.OTP_SECRET),localFiles:'لا تُرفع ملفات PDF إلى الخادم'});
  }
  if(request.method==='GET' && action==='users') {
   const rows=await sql(env.PDF_AUTH_DB,'SELECT id,email,role,created_at FROM pdf_email_users ORDER BY created_at DESC LIMIT 100').all();
   return response({users:rows.results||[]});
  }
  if(request.method==='POST' && action==='role') {
   if(request.headers.get('Origin')!==url.origin || request.headers.get('Sec-Fetch-Site')==='cross-site') return response({error:'الطلب غير مسموح'},403);
   if(!request.headers.get('Content-Type')?.startsWith('application/json')) return response({error:'نوع الطلب غير مدعوم'},415);
   const body=await request.json();
   if(typeof body?.id!=='string'||body.id.length>100||!['user','admin'].includes(body.role)) return response({error:'بيانات غير صالحة'},400);
   if(body.id===user.id) return response({error:'لا يمكن تغيير صلاحية حسابك من هذه الصفحة'},400);
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
