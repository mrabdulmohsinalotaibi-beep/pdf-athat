import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleAuth } from '../server/auth.mjs';

// Exercise the real SQL and cryptography through a small SQLite-backed D1 adapter.
function fixture() {
 const sqlite = new DatabaseSync(':memory:');
 sqlite.exec(readFileSync(new URL('../migrations/0001_email_auth.sql', import.meta.url), 'utf8'));
 sqlite.exec(readFileSync(new URL('../migrations/0002_admin_role.sql', import.meta.url), 'utf8'));
 sqlite.exec(readFileSync(new URL('../migrations/0003_admin_invites.sql', import.meta.url), 'utf8'));
 sqlite.exec(readFileSync(new URL('../migrations/0004_usernames.sql', import.meta.url), 'utf8'));
 sqlite.exec(readFileSync(new URL('../migrations/0005_admin_audit.sql', import.meta.url), 'utf8'));
 sqlite.exec(readFileSync(new URL('../migrations/0006_p2p_sync.sql', import.meta.url), 'utf8'));
 const db = { prepare(sql) {
  return { bind(...args) {
   const stmt = sqlite.prepare(sql);
   return { async first() { return stmt.get(...args) || null; }, async run() { const result=stmt.run(...args); return { meta: { changes: result.changes } }; } };
  } };
 }, async batch(statements) {
  sqlite.exec('BEGIN');
  try { const results=[]; for(const stmt of statements) results.push(await stmt.run()); sqlite.exec('COMMIT'); return results; }
  catch(error) { sqlite.exec('ROLLBACK'); throw error; }
 } };
 const env = { PDF_AUTH_DB: db, OTP_SECRET: 'test-secret-only-do-not-deploy', RESEND_API_KEY: 'mock', OTP_FROM_EMAIL: 'test@example.com' };
 const mail=[];
 const call = async (action, body, cookie='', options={}) => {
  const response=await handleAuth({env, request: new Request('https://pdf.example/api/auth/'+action, {
   method:body===undefined?'GET':'POST', headers:{Origin:'https://pdf.example','Content-Type':'application/json',Cookie:cookie,...options.headers},
   body:body===undefined?undefined:JSON.stringify(body)
  })});
  return {status:response.status,body:await response.json(),cookie:response.headers.get('Set-Cookie')?.split(';')[0],headers:response.headers};
 };
 return {sqlite,env,mail,call};
}
const email='reader@example.com', username='reader_test', password='a long private password';
async function withMail(run) {
 const original=globalThis.fetch, f=fixture();
 globalThis.fetch=async (url,request) => {
  assert.equal(url,'https://api.resend.com/emails');
  const body=JSON.parse(request.body); f.mail.push(body);
  return Response.json({id:'mock-message'});
 };
 try {await run(f);} finally {globalThis.fetch=original;f.sqlite.close();}
}
const code=f=>f.mail.at(-1).text.match(/\d{6}/)[0];
async function register(f) {
 const signup=await f.call('signup',{email,username,password}); assert.equal(signup.status,200);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM pdf_email_users').get().n,0);
 const result=await f.call('verify',{challengeId:signup.body.challengeId,code:code(f)});
 assert.equal(result.status,200); return result;
}
test('verified signup, protected cookie, login, session lookup, logout and account isolation',()=>withMail(async f=>{
 const verified=await register(f);
 assert.match(verified.headers.get('Set-Cookie'),/HttpOnly; Secure; SameSite=Lax/);
 assert.equal(verified.headers.get('Cache-Control'),'no-store');
 const row=f.sqlite.prepare('SELECT * FROM pdf_email_users').get();
 assert.notEqual(row.password_hash,password);
 assert.equal((await f.call('session')).body.user,null);
 assert.equal((await f.call('session',undefined,verified.cookie)).body.user.email,email);
 assert.equal((await f.call('login',{email,password:'incorrect'})).status,401);
 const login=await f.call('login',{email:email.toUpperCase(),password}); assert.equal(login.status,200);
 assert.equal(login.body.user.id,verified.body.user.id);
 await f.call('logout',{},login.cookie);
 assert.equal((await f.call('session',undefined,login.cookie)).body.user,null);
 assert.equal((await f.call('session',undefined,verified.cookie)).body.user.id,row.id);
 assert.equal((await f.call('session',undefined,'__Host-pdf_session='+ 'a'.repeat(64))).body.user,null);
}));
test('codes expire, cannot be replayed, and lock after five failed attempts',()=>withMail(async f=>{
 const signup=await f.call('signup',{email,username,password}), correct=code(f);
 for(let i=0;i<5;i++) assert.equal((await f.call('verify',{challengeId:signup.body.challengeId,code:correct==='000000'?'111111':'000000'})).status,400);
 assert.equal((await f.call('verify',{challengeId:signup.body.challengeId,code:correct})).status,400);
 const second=await f.call('signup',{email,username,password});
 f.sqlite.prepare('UPDATE pdf_email_challenges SET expires_at=0').run();
 assert.equal((await f.call('verify',{challengeId:second.body.challengeId,code:code(f)})).status,400);
 const third=await f.call('signup',{email,username,password}), payload={challengeId:third.body.challengeId,code:code(f)};
 assert.equal((await f.call('verify',payload)).status,200);
 assert.equal((await f.call('verify',payload)).status,400);
}));
test('password reset verifies code, changes password and revokes all sessions',()=>withMail(async f=>{
 const original=await register(f), forgot=await f.call('forgot',{email});
 const next='a different long password';
 assert.equal((await f.call('reset',{challengeId:forgot.body.challengeId,code:code(f),password:next})).status,200);
 assert.equal((await f.call('session',undefined,original.cookie)).body.user,null);
 assert.equal((await f.call('login',{email,username,password})).status,401);
 assert.equal((await f.call('login',{email,password:next})).status,200);
}));
test('server enforces input validation, CSRF, mail readiness and rate limits',()=>withMail(async f=>{
 assert.equal((await f.call('signup',{email,username,password:'short'})).status,400);
 assert.equal((await f.call('signup',{email:'bad',username,password})).status,400);
 assert.equal((await f.call('login',{email,username,password},'',{headers:{Origin:'https://evil.example'}})).status,403);
 assert.equal((await f.call('signup',{email,username,password:'x'.repeat(9000)})).status,413);
 delete f.env.RESEND_API_KEY;
 assert.equal((await f.call('config')).body.signupReady,false);
 assert.equal((await f.call('signup',{email,username,password})).status,503);
 f.env.RESEND_API_KEY='mock';
 for(let i=0;i<3;i++) assert.equal((await f.call('forgot',{email})).status,200);
 assert.equal(f.mail.length,0); // Unknown email is not exposed and receives no mail.
 assert.equal((await f.call('forgot',{email})).status,429);
}));
test('provider delivery failure leaves no usable challenge',()=>withMail(async f=>{
 globalThis.fetch=async()=>new Response('unavailable',{status:503});
 assert.equal((await f.call('signup',{email,username,password})).status,503);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM pdf_email_challenges').get().n,0);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM pdf_email_users').get().n,0);
}));

test('daily provider quota failures are explained without leaking database details', async()=>{
 const f=fixture();
 f.env.PDF_AUTH_DB.prepare=()=>{throw Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.");};
 try{
  const result=await f.call('signup',{email,username,password});
  assert.equal(result.status,503);
  assert.equal(result.body.code,'ACCOUNT_SERVICE_LIMIT');
  assert.match(result.body.error,/حد الاستخدام اليومي/);
  assert.equal(result.body.detail,undefined);
 }finally{f.sqlite.close();}
});

test('username sign-in uses the same verified account and does not expose another library',()=>withMail(async f=>{
 const verified=await register(f);
 assert.equal(verified.body.user.username,username);
 const login=await f.call('login',{identifier:username.toUpperCase(),password});
 assert.equal(login.status,200);
 assert.equal(login.body.user.id,verified.body.user.id);
 assert.equal((await f.call('login',{identifier:'unknown_user',password})).status,401);
}));
test('duplicate usernames do not create usable registration challenges',()=>withMail(async f=>{
 await register(f);
 const second=await f.call('signup',{email:'second@example.com',username,password});
 assert.equal(second.status,200);
 assert.equal(f.mail.length,1);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM pdf_email_challenges WHERE email='second@example.com'").get().count,0);
}));

test('admin audit schema records only allowed administrative action types',()=>{
 const f=fixture();
 try{
  const stmt=f.sqlite.prepare('INSERT INTO pdf_admin_audit(id,actor_id,target_id,action,details,created_at) VALUES(?,?,?,?,?,?)');
  stmt.run('audit1','admin1','user2','change_role','new role: user',1790000000);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM pdf_admin_audit').get().count,1);
  assert.throws(()=>stmt.run('audit2','admin1','user2','read_pdf','forbidden',1790000000));
 }finally{f.sqlite.close()}
});

test('profile username edit is authenticated, password-protected, unique and preserves account ID',()=>withMail(async f=>{
 const registered=await register(f),cookie=registered.cookie,original=registered.body.user.id;
 assert.equal((await f.call('profile-username',{username:'reader_new',password})).status,401);
 assert.equal((await f.call('profile-username',{username:'reader_new',password:'wrong'},cookie)).status,401);
 const updated=await f.call('profile-username',{username:'reader_new',password},cookie);
 assert.equal(updated.status,200);
 assert.equal(updated.body.user.id,original);
 assert.equal(updated.body.user.username,'reader_new');
 assert.equal((await f.call('session',undefined,cookie)).body.user.username,'reader_new');
 assert.equal((await f.call('login',{identifier:'reader_new',password})).status,200);
 assert.equal((await f.call('login',{identifier:username,password})).status,401);
 assert.equal((await f.call('profile-username',{username:'abc*?',password},cookie)).status,400);
 const already=await f.call('signup',{email:'second@example.com',username:'secondname',password});
 assert.equal((await f.call('verify',{challengeId:already.body.challengeId,code:code(f)})).status,200);
 assert.equal((await f.call('profile-username',{username:'secondname',password},cookie)).status,409);
}));
test('changing email requires password and OTP at new mailbox; old sessions revoked',()=>withMail(async f=>{
 const reg=await register(f),cookie=reg.cookie,newEmail='new-reader@example.com';
 assert.equal((await f.call('profile-email-start',{email:newEmail,password})).status,401);
 assert.equal((await f.call('profile-email-start',{email:newEmail,password:'wrong'},cookie)).status,401);
 const started=await f.call('profile-email-start',{email:newEmail,password},cookie);
 assert.equal(started.status,200);assert.equal(f.mail.at(-1).to[0],newEmail);
 assert.equal((await f.call('session',undefined,cookie)).body.user.email,email);
 assert.equal((await f.call('profile-email-confirm',{challengeId:started.body.challengeId,code:'999999'},cookie)).status,400);
 const confirm=await f.call('profile-email-confirm',{challengeId:started.body.challengeId,code:code(f)},cookie);
 assert.equal(confirm.status,200);assert.match(confirm.headers.get('Set-Cookie'),/Max-Age=0/);
 assert.equal((await f.call('session',undefined,cookie)).body.user,null);
 assert.equal(f.sqlite.prepare('SELECT email FROM pdf_email_users WHERE id=?').get(reg.body.user.id).email,newEmail);
 assert.equal((await f.call('login',{email,password})).status,401);
 const logged=await f.call('login',{email:newEmail,password});
 assert.equal(logged.status,200);assert.equal(logged.body.user.id,reg.body.user.id);
 assert.equal((await f.call('profile-email-confirm',{challengeId:started.body.challengeId,code:code(f)},logged.cookie)).status,403);
}));
test('admin changing email retains role and moves approved admin email',()=>withMail(async f=>{
 const reg=await register(f);
 f.sqlite.prepare("UPDATE pdf_email_users SET role='admin' WHERE id=?").run(reg.body.user.id);
 f.sqlite.prepare('INSERT INTO pdf_admin_allowed_emails(email) VALUES(?)').run(email);
 const target='admin-new@example.com';
 const start=await f.call('profile-email-start',{email:target,password},reg.cookie);
 assert.equal(start.status,200);
 const confirm=await f.call('profile-email-confirm',{challengeId:start.body.challengeId,code:code(f)},reg.cookie);
 assert.equal(confirm.status,200);
 const row=f.sqlite.prepare('SELECT email,role FROM pdf_email_users WHERE id=?').get(reg.body.user.id);
 assert.equal(row.email,target);assert.equal(row.role,'admin');
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM pdf_admin_allowed_emails WHERE email=?').get(email).count,0);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM pdf_admin_allowed_emails WHERE email=?').get(target).count,1);
}));
test('account deletion requires confirmation and password, revokes sessions, leaves local PDF storage untouched',()=>withMail(async f=>{
 const reg=await register(f),cookie=reg.cookie,id=reg.body.user.id;
 const stamp=Math.floor(Date.now()/1000);
 f.sqlite.prepare('INSERT INTO pdf_sync_peers(user_id,device_id,device_name,last_seen) VALUES(?,?,?,?)').run(id,'device1','Test device',stamp);
 f.sqlite.prepare("INSERT INTO pdf_sync_signals(id,user_id,from_device,to_device,kind,payload,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)")
 .run('sig1',id,'device1','device2','offer','{"type":"offer","sdp":"test"}',stamp,stamp+120);
 assert.equal((await f.call('profile-delete',{password,confirmation:'حذف حسابي',acknowledge:true})).status,401);
 assert.equal((await f.call('profile-delete',{password,confirmation:'حذف',acknowledge:true},cookie)).status,400);
 assert.equal((await f.call('profile-delete',{password:'wrong',confirmation:'حذف حسابي',acknowledge:true},cookie)).status,401);
 const deleted=await f.call('profile-delete',{password,confirmation:'حذف حسابي',acknowledge:true},cookie);
 assert.equal(deleted.status,200);assert.match(deleted.headers.get('Set-Cookie'),/Max-Age=0/);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM pdf_email_users').get().count,0);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM pdf_email_sessions').get().count,0);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM pdf_sync_signals').get().count,0);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM pdf_sync_peers').get().count,0);
 assert.equal((await f.call('session',undefined,cookie)).body.user,null);
 assert.equal((await f.call('login',{email,password})).status,401);
}));
test('self deletion of administrator is blocked until ownership transfers',()=>withMail(async f=>{
 const reg=await register(f);
 f.sqlite.prepare("UPDATE pdf_email_users SET role='admin' WHERE id=?").run(reg.body.user.id);
 const result=await f.call('profile-delete',{password,confirmation:'حذف حسابي',acknowledge:true},reg.cookie);
 assert.equal(result.status,403);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM pdf_email_users').get().count,1);
}));
