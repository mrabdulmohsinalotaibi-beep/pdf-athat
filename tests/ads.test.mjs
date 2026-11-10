import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {onRequestGet} from '../functions/api/ads.js';
import {onRequest as adminHandler} from '../functions/api/admin/[[path]].js';
function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 for(const name of ['0001_email_auth','0002_admin_role','0003_admin_invites','0004_usernames','0005_admin_audit','0007_ads']){
  sqlite.exec(readFileSync(new URL('../migrations/'+name+'.sql',import.meta.url),'utf8'));
 }
 const stamp=Math.floor(Date.now()/1000);
 const token='e'.repeat(64);
 sqlite.prepare("INSERT INTO pdf_email_users(id,email,salt,password_hash,created_at,role,username) VALUES(?,?,?,?,?,'admin',?)").run('admin','admin@example.com','salt','hash',stamp,'adminuser');
 sqlite.prepare('INSERT INTO pdf_email_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),'admin',stamp+3600);
 const db={prepare(query){return {bind(...args){return {
  async first(){return sqlite.prepare(query).get(...args)||null},
  async all(){return {results:sqlite.prepare(query).all(...args)}},
  async run(){const result=sqlite.prepare(query).run(...args);return {meta:{changes:result.changes}}}
 }}}}};
 const request=(path,body,cookie=token)=>new Request('https://pdf.example/api/admin/'+path,{method:body===undefined?'GET':'POST',headers:{Origin:'https://pdf.example','Content-Type':'application/json',Cookie:'__Host-pdf_session='+cookie},body:body===undefined?undefined:JSON.stringify(body)});
 const call=async(path,body,cookie)=>{const r=await adminHandler({env:{PDF_AUTH_DB:db},request:request(path,body,cookie)});return {status:r.status,body:await r.json()}};
 const list=async()=>{const r=await onRequestGet({env:{PDF_AUTH_DB:db}});return (await r.json()).ads};
 return {sqlite,call,list};
}
test('admin can schedule, pause and delete ad; public only sees active within dates',async()=>{
 const f=fixture(),now=Math.floor(Date.now()/1000);
 try{
  const result=await f.call('ad-save',{title:'رسالة تجربة',body:'إعلان بسيط',link_url:'https://example.com',starts_at:now-20,ends_at:now+3600,duration_seconds:30,enabled:true});
  assert.equal(result.status,200);
  assert.equal((await f.list()).length,1);
  const id=result.body.id;
  assert.equal((await f.call('ad-toggle',{id})).status,200);
  assert.equal((await f.list()).length,0);
  assert.equal((await f.call('ad-toggle',{id})).status,200);
  assert.equal((await f.list()).length,1);
  assert.equal((await f.call('ad-delete',{id})).status,200);
  assert.equal((await f.list()).length,0);
 }finally{f.sqlite.close()}
});
test('ads reject XSS schemes, bad date windows, unauthenticated writes and keep text inert',async()=>{
 const f=fixture(),now=Math.floor(Date.now()/1000);
 try{
  const basic={title:'خبر',body:'نص',starts_at:now,ends_at:now+3600,duration_seconds:0,enabled:true};
  assert.equal((await f.call('ad-save',{...basic,link_url:'javascript:alert(1)'})).status,400);
  assert.equal((await f.call('ad-save',{...basic,starts_at:now+3600,ends_at:now})).status,400);
  assert.equal((await f.call('ad-save',{...basic,link_url:''},'x'.repeat(64))).status,403);
  const result=await f.call('ad-save',{...basic,title:'<script>alert(1)</script>',link_url:''});
  assert.equal(result.status,200);
  const records=await f.list();
  assert.equal(records.length,1);
  assert.equal(records[0].title,'<script>alert(1)</script>');
  const script=readFileSync(new URL('../site-ads.js',import.meta.url),'utf8');
  assert.match(script,/title\.textContent=ad\.title/);
  assert.doesNotMatch(script,/innerHTML\s*=/);
 }finally{f.sqlite.close()}
});
