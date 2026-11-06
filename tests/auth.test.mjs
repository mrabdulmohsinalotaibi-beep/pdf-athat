import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleAuth } from '../server/auth.mjs';

// Exercise the real SQL and cryptography through a small SQLite-backed D1 adapter.
function fixture() {
 const sqlite = new DatabaseSync(':memory:');
 sqlite.exec(readFileSync(new URL('../migrations/0001_email_auth.sql', import.meta.url), 'utf8'));
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
const email='reader@example.com', password='a long private password';
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
 const signup=await f.call('signup',{email,password}); assert.equal(signup.status,200);
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
 const signup=await f.call('signup',{email,password}), correct=code(f);
 for(let i=0;i<5;i++) assert.equal((await f.call('verify',{challengeId:signup.body.challengeId,code:correct==='000000'?'111111':'000000'})).status,400);
 assert.equal((await f.call('verify',{challengeId:signup.body.challengeId,code:correct})).status,400);
 const second=await f.call('signup',{email,password});
 f.sqlite.prepare('UPDATE pdf_email_challenges SET expires_at=0').run();
 assert.equal((await f.call('verify',{challengeId:second.body.challengeId,code:code(f)})).status,400);
 const third=await f.call('signup',{email,password}), payload={challengeId:third.body.challengeId,code:code(f)};
 assert.equal((await f.call('verify',payload)).status,200);
 assert.equal((await f.call('verify',payload)).status,400);
}));
test('password reset verifies code, changes password and revokes all sessions',()=>withMail(async f=>{
 const original=await register(f), forgot=await f.call('forgot',{email});
 const next='a different long password';
 assert.equal((await f.call('reset',{challengeId:forgot.body.challengeId,code:code(f),password:next})).status,200);
 assert.equal((await f.call('session',undefined,original.cookie)).body.user,null);
 assert.equal((await f.call('login',{email,password})).status,401);
 assert.equal((await f.call('login',{email,password:next})).status,200);
}));
test('server enforces input validation, CSRF, mail readiness and rate limits',()=>withMail(async f=>{
 assert.equal((await f.call('signup',{email,password:'short'})).status,400);
 assert.equal((await f.call('signup',{email:'bad',password})).status,400);
 assert.equal((await f.call('login',{email,password},'',{headers:{Origin:'https://evil.example'}})).status,403);
 assert.equal((await f.call('signup',{email,password:'x'.repeat(9000)})).status,413);
 delete f.env.RESEND_API_KEY;
 assert.equal((await f.call('config')).body.signupReady,false);
 assert.equal((await f.call('signup',{email,password})).status,503);
 f.env.RESEND_API_KEY='mock';
 for(let i=0;i<3;i++) assert.equal((await f.call('forgot',{email})).status,200);
 assert.equal(f.mail.length,0); // Unknown email is not exposed and receives no mail.
 assert.equal((await f.call('forgot',{email})).status,429);
}));
test('provider delivery failure leaves no usable challenge',()=>withMail(async f=>{
 globalThis.fetch=async()=>new Response('unavailable',{status:503});
 assert.equal((await f.call('signup',{email,password})).status,503);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM pdf_email_challenges').get().n,0);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM pdf_email_users').get().n,0);
}));
