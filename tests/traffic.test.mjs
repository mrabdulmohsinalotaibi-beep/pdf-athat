import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {classifyAgent,safeCountry,dayRiyadh,onRequest} from '../functions/api/traffic/visit.js';
import {onRequest as adminRequest} from '../functions/api/admin/[[path]].js';

function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 for(const name of ['0001_email_auth','0002_admin_role','0003_admin_invites','0004_usernames','0005_admin_audit','0009_traffic_analytics']){
  sqlite.exec(readFileSync(new URL('../migrations/'+name+'.sql',import.meta.url),'utf8'));
 }
 const token='b'.repeat(64),now=Math.floor(Date.now()/1000);
 sqlite.prepare("INSERT INTO pdf_email_users(id,email,salt,password_hash,created_at,role,username) VALUES(?,?,?,?,?,'admin',?)")
  .run('admin-id','admin@example.com','salt','hash',now,'adminname');
 sqlite.prepare('INSERT INTO pdf_email_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)')
  .run(createHash('sha256').update(token).digest('hex'),'admin-id',now+3600);
 const db={prepare(query){return{bind(...args){return{
  async first(){return sqlite.prepare(query).get(...args)||null},
  async all(){return{results:sqlite.prepare(query).all(...args)}},
  async run(){const r=sqlite.prepare(query).run(...args);return{meta:{changes:r.changes}}}
 }}}}};
 const env={PDF_AUTH_DB:db,OTP_SECRET:'test-secret-for-hash-never-publish'};
 const track=async({ip='198.51.100.1',country='SA',page='home',agent='Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 Chrome/130.0',origin='https://pdf.example'}={})=>{
  const request=new Request('https://pdf.example/api/traffic/visit',{method:'POST',headers:{
   Origin:origin,'Content-Type':'application/json','User-Agent':agent,'CF-Connecting-IP':ip
  },body:JSON.stringify({page})});
  Object.defineProperty(request,'cf',{value:{country}});
  const result=await onRequest({request,env});
  return {status:result.status,body:await result.json()};
 };
 const admin=async(cookie=token)=>{
  const request=new Request('https://pdf.example/api/admin/traffic',{headers:{Cookie:'__Host-pdf_session='+cookie}});
  const response=await adminRequest({request,env});
  return {status:response.status,body:await response.json()};
 };
 return {sqlite,env,track,admin};
}
test('coarse visitor agent and country classification',()=>{
 assert.deepEqual(classifyAgent('Mozilla/5.0 iPhone AppleWebKit Safari/605'),{device:'mobile',browser:'Safari'});
 assert.equal(classifyAgent('Mozilla/5.0 iPad Chrome/130').device,'tablet');
 assert.equal(classifyAgent('Googlebot').device,'bot');
 assert.equal(safeCountry('SA'),'SA');
 assert.equal(safeCountry('Saudi Arabia'),'ZZ');
 assert.equal(safeCountry(''),'ZZ');
});
test('local analytics date transitions at Saudi midnight, not UTC midnight',()=>{
 assert.equal(dayRiyadh(Date.parse('2026-11-10T20:59:59Z')),'2026-11-10');
 assert.equal(dayRiyadh(Date.parse('2026-11-10T21:00:00Z')),'2026-11-11');
});
test('visits are aggregated by private rotating hash and admin only sees coarse statistics',async()=>{
 const f=fixture();
 try{
  assert.equal((await f.track()).status,200);
  assert.equal((await f.track()).status,200);
  assert.equal((await f.track({ip:'198.51.100.2',country:'US',page:'account'})).status,200);
  assert.equal((await f.track({agent:'Googlebot',ip:'198.51.100.3'})).body.recorded,false);
  const rows=f.sqlite.prepare('SELECT * FROM pdf_traffic_visits').all();
  assert.equal(rows.length,2);
  assert.equal(rows.reduce((n,row)=>n+row.visits,0),3);
  assert.equal(rows[0].visitor_hash.length,64);
  assert.ok(!JSON.stringify(rows).includes('198.51.100.'));
  assert.ok(!JSON.stringify(rows).includes('Android 14'));
  const data=await f.admin();
  assert.equal(data.status,200);
  assert.equal(data.body.daily.views,3);
  assert.equal(data.body.daily.visitors,2);
  assert.equal(data.body.countries.length,2);
  assert.equal((await f.admin('wrong')).status,403);
  assert.equal((await f.track({origin:'https://evil.example'})).status,403);
 }finally{f.sqlite.close()}
});
test('no identifiable page path, book names, referrer or personal email is sent by tracking script',()=>{
 const script=readFileSync(new URL('../traffic.js',import.meta.url),'utf8');
 const source=readFileSync(new URL('../functions/api/traffic/visit.js',import.meta.url),'utf8');
 assert.match(script,/body:JSON.stringify\(\{page\}\)/);
 assert.match(script,/navigator\.doNotTrack/);
 assert.match(source,/visitorDigest/);
 assert.doesNotMatch(source,/INSERT INTO.*(?:email|referrer|filename)/);
 const headers=readFileSync(new URL('../_headers',import.meta.url),'utf8');
 assert.match(headers,/X-Frame-Options: DENY/);
 assert.match(headers,/Strict-Transport-Security:/);
 assert.match(headers,/Content-Security-Policy:/);
});
