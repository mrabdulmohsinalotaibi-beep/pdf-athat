import assert from 'node:assert/strict';
import {onRequest} from '../functions/api/[[path]].js';
const phone='11111111-1111-4111-8111-111111111111';
const tablet='22222222-2222-4222-8222-222222222222';
const queries=[];
const fakeDb={
 prepare(sql){
  queries.push(sql);
  return {bind(...args){
   return {
    async first(){
     if(sql.includes('JOIN users'))return {user_id:'test-user',device_id:phone,device_name:'iPhone',email:'example.invalid'};
     if(sql.includes('SELECT 1 FROM sessions'))return {ok:1};
     if(sql.includes('FROM limits'))return null;
     return null;
    },
    async all(){
     if(sql.includes('FROM sessions s LEFT JOIN peer_presence'))return {results:[{device_id:phone,device_name:'iPhone',last_seen:0},{device_id:tablet,device_name:'Tablet',last_seen:Math.floor(Date.now()/1000)}]};
     return {results:[]};
    },
    async run(){return {success:true}}
   };
  }};
 }
};
async function call(route,method='GET',body=null,cookie=''){
 const url='https://pdf.athat.app/api/'+route;
 const headers=new Headers();
 if(method==='POST'){headers.set('origin','https://pdf.athat.app');headers.set('content-type','application/json')}
 if(cookie)headers.set('cookie','pdf_session='+cookie);
 const context={request:new Request(url,{method,headers,...(body!==null?{body:JSON.stringify(body)}:{})}),env:{PDF_AUTH_DB:fakeDb,OTP_SECRET:'test-only'},params:{path:route.split('/')}};
 const response=await onRequest(context);
 return {status:response.status,body:await response.json()};
}
const unauth=await call('auth/session');
assert.equal(unauth.status,200);assert.equal(unauth.body.signedIn,false);
const health=await call('health');
assert.equal(health.status,200);assert.equal(health.body.ok,true);assert.equal(health.body.otpReady,false);
const noMailer=await call('auth/request','POST',{email:'test@example.com',mode:'register'});
assert.equal(noMailer.status,503);
const forbidden=await call('sync/document/sensitive','POST',{file:'PRIVATE_BYTES'});
assert.equal(forbidden.status,401);
const sessionCookie='a'.repeat(64);
const devices=await call('devices','GET',null,sessionCookie);
assert.equal(devices.status,200);assert.equal(devices.body.devices.length,1);assert.equal(devices.body.devices[0].device_id,tablet);
const presence=await call('presence','POST',{},sessionCookie);
assert.equal(presence.status,200);
assert.ok(queries.some(x=>x.includes('INSERT INTO peer_presence')),'presence heartbeat must be handled');
const signal=await call('signal','POST',{recipient:tablet,kind:'offer',payload:'{"type":"offer","sdp":"synthetic"}'},sessionCookie);
assert.equal(signal.status,200);
assert.ok(queries.some(x=>x.includes('INSERT INTO peer_signals')),'missing ephemerally stored signaling');
assert.ok(!queries.some(x=>x.includes('INSERT INTO documents')||x.includes('PDF_SYNC_R2')),'PDF contents must not be uploaded');
console.log('Same-origin auth and peer API smoke tests passed');
