import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {eventsFor} from '../workers/prayer-push-worker.mjs';

test('local Saudi prayer schedule includes before, adhan, iqama',()=>{
 const row={city:'Makkah',before_minutes:10,adhan:1,iqama:1,iqama_delay:15};
 const times={Fajr:310,Dhuhr:720,Asr:930,Maghrib:1060,Isha:1150};
 const at=(hour,minute)=>Date.UTC(2026,10,11,hour,minute)-3*3600000;
 assert.deepEqual(eventsFor(row,times,'2026-11-11',at(5,0)).map(x=>x.key),['2026-11-11:Fajr:before']);
 assert.deepEqual(eventsFor(row,times,'2026-11-11',at(5,10)).map(x=>x.key),['2026-11-11:Fajr:adhan']);
 assert.deepEqual(eventsFor(row,times,'2026-11-11',at(5,25)).map(x=>x.key),['2026-11-11:Fajr:iqama']);
 assert.equal(eventsFor(row,times,'2026-11-11',at(6,0)).length,0);
});

test('prayer push tables are independent of local PDF files',()=>{
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE pdf_email_users(id TEXT PRIMARY KEY);');
 db.exec(readFileSync(new URL('../migrations/0010_prayer_push.sql',import.meta.url),'utf8'));
 for(const name of ['pdf_prayer_push_subscriptions','pdf_prayer_push_deliveries','pdf_prayer_push_times']){
  assert.equal(db.prepare('SELECT name FROM sqlite_master WHERE type=? AND name=?').get('table',name).name,name);
 }
 assert.throws(()=>db.prepare('INSERT INTO pdf_prayer_push_subscriptions(id,user_id,endpoint,p256dh,auth,city,before_minutes,adhan,iqama,iqama_delay,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('x','u','https://web.push.apple.com/a','x','x','Makkah',9,1,0,10,1,1));
 db.close();
});
