import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');

test('notification test is opt-in for every account in prayer strip',()=>{
 const site=read('site-entry.js');
 const pilot=read('admin-prayer-notification-pilot.js');
 assert.match(site,/fetch\('\/api\/auth\/session'/);
 assert.match(site,/import\('\.\/prayer-bar\.js'\)\.then\(\(\)=>import\('\.\/admin-prayer-notification-pilot\.js'\)\)/);
 assert.match(pilot,/querySelector\('\.prayer-bar'\)/);
 assert.match(pilot,/button\.addEventListener\('click',async\(\)=>/);
 assert.match(pilot,/Notification\.requestPermission\(\)/);
 assert.match(pilot,/registration\.showNotification\(/);
 assert.doesNotMatch(pilot,/PushManager|subscribe\(|setInterval\(|scheduleNotification/);
 assert.doesNotMatch(pilot,/user\.role\s*!==\s*'admin'/);
});

test('site builder copies and version-busts notification module',()=>{
 const build=read('desktop/scripts/build-site.cjs');
 assert.match(build,/accountAssets=\[[^\n]*'admin-prayer-notification-pilot\.js'/);
 assert.match(build,/for\(const asset of \['app-v2\.js','prayer-bar\.js','admin-prayer-notification-pilot\.js'/);
 assert.match(build,/precache=\[[^\n]*admin-prayer-notification-pilot\.js/);
});
