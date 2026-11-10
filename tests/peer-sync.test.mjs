import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {onRequest} from '../functions/api/sync/[[path]].js';

const deviceA='11111111-1111-4111-8111-111111111111';
const deviceB='22222222-2222-4222-8222-222222222222';
const deviceC='33333333-3333-4333-8333-333333333333';
const tokenA='a'.repeat(64),tokenB='b'.repeat(64);
function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 for(const number of ['0001_email_auth','0002_admin_role','0003_admin_invites','0004_usernames','0005_admin_audit','0006_p2p_sync'])
  sqlite.exec(readFileSync(new URL('../migrations/'+number+'.sql',import.meta.url),'utf8'));
 const now=Math.floor(Date.now()/1000);
 for(const [id,email,token] of [['owner','owner@example.com',tokenA],['other','other@example.com',tokenB]]){
  sqlite.prepare("INSERT INTO pdf_email_users(id,email,salt,password_hash,created_at,role,username) VALUES(?,?,?,?,?,'user',?)").run(id,email,'salt','hash',now,id);
  sqlite.prepare("INSERT INTO pdf_email_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)").run(createHash('sha256').update(token).digest('hex'),id,now+10000);
 }
 const db={prepare(query){return {bind(...args){
  return {async first(){return sqlite.prepare(query).get(...args)||null},
   async run(){const result=sqlite.prepare(query).run(...args);return {meta:{changes:result.changes}}},
   async all(){return {results:sqlite.prepare(query).all(...args)}}};
 }}}};
 const send=async(action,deviceId,extra={},token=tokenA,origin='https://pdf.example')=>{
  const url='https://pdf.example/api/sync/'+action;
  const response=await onRequest({env:{PDF_AUTH_DB:db},request:new Request(url,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:'__Host-pdf_session='+token},body:JSON.stringify({deviceId,...extra})})});
  return {status:response.status,body:await response.json()};
 };
 return {sqlite,send};
}
test('same-account devices see only their peers; other account is isolated',async()=>{
 const {sqlite,send}=fixture();
 try{
  assert.equal((await send('heartbeat',deviceA,{name:'Tablet'})).status,200);
  assert.equal((await send('heartbeat',deviceB,{name:'Laptop'})).body.peers.length,1);
  assert.equal((await send('heartbeat',deviceC,{name:'Other'},tokenB)).body.peers.length,0);
  assert.equal((await send('heartbeat',deviceA,{name:'Tablet'})).body.peers.length,1);
  assert.equal((await send('heartbeat',deviceA,{name:'Tablet'},tokenA,'https://attacker.example')).status,403);
  assert.equal((await send('heartbeat','not-uuid',{name:'x'})).status,400);
 }finally{sqlite.close()}
});
test('signaling works only between same account and is consumed once',async()=>{
 const {sqlite,send}=fixture();
 try{
  await send('heartbeat',deviceA,{name:'Tablet'});
  await send('heartbeat',deviceB,{name:'Laptop'});
  await send('heartbeat',deviceC,{name:'Other'},tokenB);
  const offer={type:'offer',sdp:'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=pdf-test\r\nt=0 0\r\n'};
  assert.equal((await send('signal',deviceA,{to:deviceC,kind:'offer',payload:offer})).status,404);
  assert.equal((await send('signal',deviceA,{to:deviceB,kind:'offer',payload:offer})).status,200);
  const first=await send('poll',deviceB);
  assert.equal(first.body.messages.length,1);
  assert.equal(first.body.messages[0].sender,deviceA);
  assert.deepEqual(JSON.parse(JSON.stringify(first.body.messages[0].payload)),offer);
  assert.equal((await send('poll',deviceB)).body.messages.length,0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM pdf_sync_signals').get().n,0);
 }finally{sqlite.close()}
});
test('server cannot accept or keep PDF bytes in signaling endpoint',async()=>{
 const {sqlite,send}=fixture();
 try{
  await send('heartbeat',deviceA,{name:'A'});await send('heartbeat',deviceB,{name:'B'});
  assert.equal((await send('signal',deviceA,{to:deviceB,kind:'document',payload:{type:'document',sdp:'%PDF-1.7'}})).status,400);
  assert.equal((await send('signal',deviceA,{to:deviceB,kind:'offer',payload:{type:'offer',sdp:'%PDF-1.7'}})).status,400);
  const columns=sqlite.prepare('PRAGMA table_info(pdf_sync_signals)').all().map(x=>x.name);
  assert.ok(!columns.includes('pdf')&&!columns.includes('filename')&&!columns.includes('file_content'));
  const peerColumns=sqlite.prepare('PRAGMA table_info(pdf_sync_peers)').all().map(x=>x.name);
  assert.ok(!peerColumns.includes('pdf'));
 }finally{sqlite.close()}
});
