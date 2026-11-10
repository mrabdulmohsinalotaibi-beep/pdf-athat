const encoder = new TextEncoder();
const ITERATIONS = 100000; // Workers Web Crypto PBKDF2 limit.
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const COOKIE = '__Host-pdf_session';
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
const unhex = value => Uint8Array.from(value.match(/../g) || [], b => parseInt(b, 16));
const random = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const digest = async value => hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
const now = () => Math.floor(Date.now() / 1000);
const json = (data, status = 200, headers = {}) => Response.json(data, {
 status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers }
});
class PublicError extends Error {
 constructor(message, status = 400) { super(message); this.status = status; }
}
const fail = (message, status) => { throw new PublicError(message, status); };
const statement = (db, sql, ...params) => db.prepare(sql).bind(...params);
export async function passwordHash(password, salt) {
 const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
 return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(salt), iterations: ITERATIONS }, key, 256));
}
// HMAC verification avoids a JavaScript secret comparison and protects low-entropy codes at rest.
async function macKey(secret) {
 return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function matches(value, expected) {
 const key = await macKey(expected);
 const signature = await crypto.subtle.sign('HMAC', key, encoder.encode('pdf-athat-password-check'));
 return crypto.subtle.verify('HMAC', await macKey(value), signature, encoder.encode('pdf-athat-password-check'));
}
export async function verifyAccountPassword(db, userId, password) {
 if(typeof userId!=='string' || typeof password!=='string' || password.length>128)return false;
 const row=await db.prepare('SELECT salt,password_hash FROM pdf_email_users WHERE id=?').bind(userId).first();
 if(!row)return false;
 const computed=await passwordHash(password,row.salt);
 return matches(computed,row.password_hash);
}
function emailAddress(value) {
 const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
 if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('أدخل بريدًا إلكترونيًا صحيحًا.');
 return email;
}
function usernameValue(value) {
 const name = typeof value==='string' ? value.trim().toLowerCase() : '';
 if (!/^[a-z][a-z0-9_]{2,31}$/.test(name)) fail('اسم المستخدم يجب أن يبدأ بحرف إنجليزي وأن يتكون من 3 إلى 32 حرفًا أو رقمًا أو شرطة سفلية.');
 return name;
}
function strongPassword(value) {
 if (typeof value !== 'string' || value.length < 6 || value.length > 128) fail('استخدم كلمة مرور من 6 إلى 128 حرفًا.');
 return value;
}
async function readBody(request) {
 if (!request.headers.get('Content-Type')?.startsWith('application/json')) fail('نوع الطلب غير مدعوم.', 415);
 const reader = request.body?.getReader();
 if (!reader) fail('الطلب غير صالح.');
 let text = '', size = 0;
 const decoder = new TextDecoder();
 for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  size += value.byteLength;
  if (size > 8192) { await reader.cancel(); fail('حجم الطلب أكبر من المسموح.', 413); }
  text += decoder.decode(value, { stream: true });
 }
 try {
  const body = JSON.parse(text + decoder.decode());
  if (!body || Array.isArray(body) || typeof body !== 'object') throw Error();
  return body;
 } catch { fail('الطلب غير صالح.'); }
}
async function limit(db, key, maximum, seconds) {
 const time = now();
 // One atomic D1 query instead of INSERT/UPDATE plus SELECT, with the same
 // per-key rolling window and rate limit. Do not remove brute-force protection.
 const row = await statement(db, `INSERT INTO pdf_email_limits(key,count,expires_at) VALUES(?,1,?)
 ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,
 expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END
 RETURNING count`, key, time + seconds, time, time).first();
 if (!row || row.count > maximum) fail('محاولات كثيرة. انتظر قليلًا ثم حاول مرة أخرى.', 429);
}
function cookie(token, seconds = SESSION_SECONDS) {
 return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;
}
async function tokenHash(request) {
 const token = request.headers.get('Cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
 return token && /^[a-f0-9]{64}$/.test(token) ? digest(token) : null;
}
export async function session(db, request) {
 const hash = await tokenHash(request);
 return hash ? statement(db, `SELECT u.id,u.email,u.username,u.role FROM pdf_email_sessions s JOIN pdf_email_users u ON u.id=s.user_id
 WHERE s.token_hash=? AND s.expires_at>?`, hash, now()).first() : null;
}
async function loginSession(db, user, request, expectedHash) {
 // Rotate this browser's previous session, without revoking other devices.
 const previous = await tokenHash(request);
 const token = random();
 const result = await db.batch([
  statement(db, 'DELETE FROM pdf_email_sessions WHERE token_hash=?', previous || ''),
  statement(db, 'INSERT INTO pdf_email_sessions(token_hash,user_id,expires_at) SELECT ?,id,? FROM pdf_email_users WHERE id=? AND password_hash=?', await digest(token), now() + SESSION_SECONDS, user.id, expectedHash)
 ]);
 if (!result[1].meta.changes) fail('تغيرت بيانات الحساب. سجّل الدخول مجددًا.', 401);
 return json({ user: { id: user.id, email: user.email, username: user.username || null, role: user.role || 'user' } }, 200, { 'Set-Cookie': cookie(token) });
}
function mailReady(env) { return !!(env.RESEND_API_KEY && env.OTP_FROM_EMAIL && env.OTP_SECRET); }
async function sendCode(env, email, code, purpose) {
 const response = await fetch('https://api.resend.com/emails', {
  method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ from: env.OTP_FROM_EMAIL, to: [email], subject: purpose === 'signup' ? 'تأكيد بريدك في PDF.ATHAT' : purpose === 'change_email' ? 'تأكيد البريد الجديد في PDF.ATHAT' : 'استعادة كلمة المرور — PDF.ATHAT',
   text: `رمزك هو: ${code}\nصالح لمدة 10 دقائق. لا تشارك الرمز مع أي شخص.\nإذا لم تطلب هذا الرمز، تجاهل الرسالة.` }),
  signal: AbortSignal.timeout(10000)
 });
 if (!response.ok) throw Error('mail_delivery_failed');
}
async function challenge(env, db, email, purpose, credentials = {}) {
 const id = random();
 // Rejection sampling gives each six-digit code the same probability.
 let number;
 do { number = crypto.getRandomValues(new Uint32Array(1))[0]; } while (number >= 4294000000);
 const code = String(number % 1000000).padStart(6, '0');
 const codeHash = hex(await crypto.subtle.sign('HMAC', await macKey(env.OTP_SECRET), encoder.encode(`${id}:${code}`)));
 await db.batch([
  statement(db, 'DELETE FROM pdf_email_challenges WHERE email=? AND purpose=?', email, purpose),
  statement(db, `INSERT INTO pdf_email_challenges(id,email,purpose,code_hash,salt,password_hash,expires_at,username) VALUES(?,?,?,?,?,?,?,?)`,
   id, email, purpose, codeHash, credentials.salt || null, credentials.hash || null, now() + 600, credentials.username || null)
 ]);
 try { await sendCode(env, email, code, purpose); }
 catch { await statement(db, 'DELETE FROM pdf_email_challenges WHERE id=?', id).run(); fail('تعذر إرسال رسالة التحقق. حاول لاحقًا.', 503); }
 return id;
}
async function consume(env, db, body, purpose) {
 if (typeof body.challengeId !== 'string' || !/^[a-f0-9]{64}$/.test(body.challengeId) || !/^\d{6}$/.test(body.code)) fail('أدخل رمز التحقق المكوّن من 6 أرقام.');
 const row = await statement(db, 'SELECT * FROM pdf_email_challenges WHERE id=? AND purpose=? AND expires_at>? AND attempts<5', body.challengeId, purpose, now()).first();
 if (!row) fail('الرمز غير صحيح أو انتهت صلاحيته. اطلب رمزًا جديدًا.');
 const attempt = await statement(db, 'UPDATE pdf_email_challenges SET attempts=attempts+1 WHERE id=? AND expires_at>? AND attempts<5', row.id, now()).run();
 if (!attempt.meta.changes || !await crypto.subtle.verify('HMAC', await macKey(env.OTP_SECRET), unhex(row.code_hash), encoder.encode(`${row.id}:${body.code}`))) fail('الرمز غير صحيح أو انتهت صلاحيته. اطلب رمزًا جديدًا.');
 // Only the request that deletes the challenge may complete the operation.
 const result = await statement(db, 'DELETE FROM pdf_email_challenges WHERE id=?', row.id).run();
 if (!result.meta.changes) fail('استُخدم الرمز بالفعل. اطلب رمزًا جديدًا.');
 return row;
}
async function route(context) {
 const { request, env } = context;
 context.data ||= {};
 context.data.authStage = 'request';
 const url = new URL(request.url), action = url.pathname.replace(/^\/api\/auth\//, '');
 const db = env.PDF_AUTH_DB;
 if (!db) fail('خدمة الحسابات غير مهيأة بعد.', 503);
 if (request.method === 'GET' && action === 'config') return json({ signupReady: mailReady(env) });
 if (request.method === 'GET' && action === 'session') return json({ user: await session(db, request) });
 if (request.method !== 'POST') fail('الطلب غير متاح.', 405);
 if (request.headers.get('Origin') !== url.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') fail('الطلب غير مسموح.', 403);
 if (!['signup','verify','login','forgot','reset','logout','profile-username','profile-email-start','profile-email-confirm','profile-delete'].includes(action)) fail('الطلب غير موجود.', 404);
 const body = await readBody(request);
 context.data.authStage = 'ip-limit';
 await limit(db, 'ip:' + await digest(request.headers.get('CF-Connecting-IP') || 'local'), 60, 900);
 if (action === 'logout') {
  await statement(db, 'DELETE FROM pdf_email_sessions WHERE token_hash=?', await tokenHash(request) || '').run();
  return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
 }
 if (['signup','forgot','verify','reset'].includes(action) && !mailReady(env)) fail('إرسال رسائل الحسابات غير مفعّل بعد. حاول لاحقًا.', 503);

 if (['profile-username','profile-email-start','profile-email-confirm','profile-delete'].includes(action)) {
  context.data.authStage = action;
  const user = await session(db, request);
  if (!user) fail('انتهت جلسة الحساب. سجّل الدخول مجددًا.', 401);
  // Rate limits apply per authenticated account and action, not just IP.
  if (action === 'profile-username') {
   const username = usernameValue(body.username);
   if (username === user.username) return json({user});
   await limit(db, 'profile-name:'+user.id, 6, 1800);
   if (!await verifyAccountPassword(db, user.id, body.password)) fail('كلمة المرور الحالية غير صحيحة.', 401);
   const taken=await statement(db,'SELECT id FROM pdf_email_users WHERE username=? AND id<>?', username,user.id).first();
   if(taken)fail('اسم المستخدم مستخدم بالفعل. اختر اسمًا آخر.',409);
   try{
    const changed=await statement(db,'UPDATE pdf_email_users SET username=? WHERE id=?', username,user.id).run();
    if(!changed.meta.changes)fail('لم يمكن تحديث اسم المستخدم.',409);
   }catch(error){
    if(error instanceof PublicError)throw error;
    if(/UNIQUE constraint failed|SQLITE_CONSTRAINT|D1_ERROR.*UNIQUE/i.test(error.message||''))fail('اسم المستخدم مستخدم بالفعل.',409);
    throw error;
   }
   return json({ok:true,user:{...user,username}});
  }
  if (action === 'profile-email-start') {
   if (!mailReady(env)) fail('خدمة التحقق بالبريد غير مفعّلة حاليًا.', 503);
   const email=emailAddress(body.email);
   if(email===user.email)fail('هذا هو البريد المرتبط بحسابك حاليًا.');
   await limit(db,'profile-email:'+user.id,3,900);
   if(!await verifyAccountPassword(db,user.id,body.password))fail('كلمة المرور الحالية غير صحيحة.',401);
   const taken=await statement(db,'SELECT id FROM pdf_email_users WHERE email=?',email).first();
   if(taken)fail('البريد الإلكتروني مستخدم بالفعل في حساب آخر.',409);
   // Store the verified session owner in the existing challenge username field.
   const challengeId=await challenge(env,db,email,'change_email',{username:user.id});
   return json({challengeId,message:'أُرسل رمز تأكيد إلى البريد الإلكتروني الجديد. تنتهي صلاحيته بعد عشر دقائق.'});
  }
  if (action === 'profile-email-confirm') {
   if (!mailReady(env)) fail('خدمة التحقق بالبريد غير مفعّلة حاليًا.',503);
   const id=typeof body.challengeId==='string'?body.challengeId:'';
   const pending=await statement(db,
    "SELECT username,email FROM pdf_email_challenges WHERE id=? AND purpose='change_email' AND expires_at>? AND attempts<5",id,now()).first();
   if(!pending||pending.username!==user.id)fail('هذا الطلب لا يخص حسابك أو انتهت صلاحيته.',403);
   const taken=await statement(db,'SELECT id FROM pdf_email_users WHERE email=?',pending.email).first();
   if(taken)fail('البريد الإلكتروني مستخدم بالفعل في حساب آخر.',409);
   const verified=await consume(env,db,body,'change_email');
   if(verified.username!==user.id)fail('لا يمكن تأكيد تغيير البريد لهذا الحساب.',403);
   // Keep a protected administrator's allowance in step with their verified email.
   const protectedEmail=await statement(db,'SELECT email FROM pdf_admin_allowed_emails WHERE email=?',user.email).first();
   try{
    await db.batch([
     statement(db,'UPDATE pdf_email_users SET email=? WHERE id=? AND email=?',verified.email,user.id,user.email),
     ...(protectedEmail?[
      statement(db,'INSERT OR IGNORE INTO pdf_admin_allowed_emails(email) VALUES(?)',verified.email),
      statement(db,'DELETE FROM pdf_admin_allowed_emails WHERE email=?',user.email)
     ]:[]),
     statement(db,'DELETE FROM pdf_email_sessions WHERE user_id=?',user.id),
     statement(db,'DELETE FROM pdf_email_challenges WHERE username=? OR email=?',user.id,user.email)
    ]);
   }catch(error){
    if(/UNIQUE constraint failed|SQLITE_CONSTRAINT|D1_ERROR.*UNIQUE/i.test(error.message||''))fail('تعذر تغيير البريد لأنه أصبح مستخدمًا في حساب آخر.',409);
    throw error;
   }
   return json({ok:true,message:'تم تأكيد البريد الجديد. سجّل الدخول به مرة أخرى.'},200,{'Set-Cookie':cookie('',0)});
  }
  if (action === 'profile-delete') {
   await limit(db,'profile-delete:'+user.id,5,3600);
   if(user.role==='admin')fail('يجب نقل صلاحية المدير إلى حساب آخر أولًا قبل حذف هذا الحساب.',403);
   if(body.confirmation!=='حذف حسابي'||body.acknowledge!==true)fail('أكد أنك قرأت التحذير واكتب «حذف حسابي» لإتمام الحذف.');
   if(!await verifyAccountPassword(db,user.id,body.password))fail('كلمة المرور الحالية غير صحيحة.',401);
   // No IndexedDB or PDF files are touched: the user must back up private local
   // data before deletion, as a future account will have a different immutable ID.
   await db.batch([
    statement(db,'DELETE FROM pdf_sync_signals WHERE user_id=?',user.id),
    statement(db,'DELETE FROM pdf_sync_peers WHERE user_id=?',user.id),
    statement(db,'DELETE FROM pdf_email_sessions WHERE user_id=?',user.id),
    statement(db,'DELETE FROM pdf_email_challenges WHERE email=? OR username=?',user.email,user.id),
    statement(db,'DELETE FROM pdf_admin_audit WHERE actor_id=? OR target_id=?',user.id,user.id),
    statement(db,'DELETE FROM pdf_email_users WHERE id=? AND role=?',user.id,'user')
   ]);
   return json({ok:true,message:'حُذف الحساب من خدمة تسجيل الدخول. ملفات PDF الموجودة على الجهاز لم تُحذف.'},200,{'Set-Cookie':cookie('',0)});
  }
 }
 if (action === 'signup' || action === 'forgot') {
  context.data.authStage = 'signup-validation';
  const email = emailAddress(body.email);
  const password = action === 'signup' ? strongPassword(body.password) : null;
  const username = action === 'signup' ? usernameValue(body.username) : null;
  context.data.authStage = 'email-limit';
  await limit(db, 'mail:' + await digest(email), 3, 900);
  context.data.authStage = 'signup-user-lookup';
  const user = await statement(db, 'SELECT id FROM pdf_email_users WHERE email=?', email).first();
  const usernameUsed = action === 'signup' ? await statement(db, 'SELECT 1 FROM pdf_email_users WHERE username=?', username).first() : null;
  // Return the same response for existing and unknown addresses.
  let challengeId = random();
  if (action === 'signup' && !user && !usernameUsed) {
   context.data.authStage = 'signup-password';
   const salt = random();
   challengeId = await challenge(env, db, email, 'signup', { salt, hash: await passwordHash(password, salt), username });
  } else if (action === 'forgot' && user) challengeId = await challenge(env, db, email, 'reset');
  return json({ challengeId, message: action === 'signup' ? 'إذا كان البريد متاحًا للتسجيل فسيصلك رمز تأكيد. إن كان لديك حساب، سجّل الدخول.' : 'إذا كان البريد مسجلًا فسيصلك رمز استعادة كلمة المرور.' });
 }
 if (action === 'verify') {
  const pending = await consume(env, db, body, 'signup');
  const user = { id: crypto.randomUUID(), email: pending.email, username: pending.username };
  const result = await statement(db, `INSERT OR IGNORE INTO pdf_email_users(id,email,salt,password_hash,created_at,role,username) VALUES(?,?,?,?,?,CASE WHEN EXISTS(SELECT 1 FROM pdf_admin_allowed_emails WHERE email=?) THEN 'admin' ELSE 'user' END,?)`, user.id, user.email, pending.salt, pending.password_hash, now(), pending.email, pending.username).run();
  if (!result.meta.changes) fail('تعذر إكمال التسجيل. جرّب تسجيل الدخول.');
  const created = await statement(db, 'SELECT id,email,username,role FROM pdf_email_users WHERE id=?', user.id).first();
  return loginSession(db, created, request, pending.password_hash);
 }
 if (action === 'login') {
  const identifier = typeof body.identifier==='string' ? body.identifier.trim().toLowerCase() : (typeof body.email==='string' ? body.email.trim().toLowerCase() : '');
  if (identifier.length>254 || !identifier || (!identifier.includes('@') && !/^[a-z][a-z0-9_]{2,31}$/.test(identifier))) fail('اسم المستخدم أو كلمة المرور غير صحيحة.',401);
  if (typeof body.password !== 'string' || body.password.length > 128) fail('البريد أو كلمة المرور غير صحيحة.', 401);
  await limit(db, 'login:' + await digest(identifier), 10, 900);
  const user = await statement(db, 'SELECT * FROM pdf_email_users WHERE email=? OR username=?', identifier, identifier).first();
  const hash = await passwordHash(body.password, user?.salt || '00'.repeat(32));
  if (!await matches(hash, user?.password_hash || '00'.repeat(32)) || !user) fail('البريد أو كلمة المرور غير صحيحة.', 401);
  return loginSession(db, user, request, user.password_hash);
 }
 if (action === 'reset') {
  const password = strongPassword(body.password);
  const pending = await consume(env, db, body, 'reset');
  const salt = random(), hash = await passwordHash(password, salt);
  // Reset credentials and revoke every session atomically.
  await db.batch([
   statement(db, 'UPDATE pdf_email_users SET salt=?,password_hash=? WHERE email=?', salt, hash, pending.email),
   statement(db, 'DELETE FROM pdf_email_sessions WHERE user_id IN (SELECT id FROM pdf_email_users WHERE email=?)', pending.email),
   statement(db, 'DELETE FROM pdf_email_challenges WHERE email=?', pending.email)
  ]);
  return json({ message: 'تم تغيير كلمة المرور. سجّل الدخول بكلمتك الجديدة.' }, 200, { 'Set-Cookie': cookie('', 0) });
 }
}
export async function handleAuth(context) {
 try {
  const response = await route(context);
  // Expiration is enforced by indexed queries. Do not run three D1 DELETEs
  // on every request: free-tier write quotas are shared across this account.
  // Expired rows may be pruned separately during scheduled maintenance.
  return response;
 } catch (error) {
  if (error instanceof PublicError) return json({ error: error.message }, error.status);
  console.error(JSON.stringify({ event: 'auth_request_failed', stage: context.data?.authStage, name: error.name, message: error.message }));
  if (/exceeded.*(?:free tier|row read|row write).*limit/i.test(error.message || '')) {
   return json({ error: 'خدمة الحسابات متوقفة مؤقتًا بسبب بلوغ حد الاستخدام اليومي. حاول لاحقًا.', code: 'ACCOUNT_SERVICE_LIMIT' }, 503);
  }
  return json({ error: 'تعذر الاتصال بخدمة الحسابات. حاول لاحقًا.' }, 503);
 }
}
