import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../prayer-bar.js',import.meta.url),'utf8');
const style=fs.readFileSync(new URL('../prayer-bar.css',import.meta.url),'utf8');

test('sound is opt in and settings stored locally',()=>{
 assert.match(source,/enabled:false,before:0/);
 assert.match(source,/pdf-athat-prayer-sound-v1/);
 assert.match(source,/localStorage.setItem\(soundKey/);
 assert.match(source,/if\(!soundOptions.enabled\|\|!visible\|\|document.visibilityState!=='visible'/);
});
test('adhan, iqama, pre-prayer controls and local recordings exist',()=>{
 for(const marker of ['beforeSelect','adhanSwitch','iqamaSwitch','iqamaSelect','soundRecord(mode,file)','indexedDB.open','▶ تجربة ','runAudioReminder'])assert.ok(source.includes(marker),marker);
 assert.match(source,/file.size>8\*1024\*1024/);
 assert.match(source,/prayer-dialog-actions/);
 assert.match(style,/prayer-sound-group/);
});

// Build verification for the prayer sound settings release.

test('prayer close persists hidden state and can be reopened',()=>{
 assert.match(source,/dismiss\.onclick=\(\)=>toggleOpen\(false\)/);
 assert.match(source,/toggle\.onclick=\(\)=>toggleOpen\(!visible\)/);
 assert.match(source,/bar\.hidden=!open/);
 assert.match(source,/localStorage\.setItem\(hiddenKey,open\?'no':'yes'\)/);
});
test('settings retains notification test without redundant bell',()=>{
 const pilot=fs.readFileSync(new URL('../admin-prayer-notification-pilot.js',import.meta.url),'utf8');
 assert.doesNotMatch(pilot,/createElement\('button'\)[\s\S]*dataset\.prayerNotifyTest/);
 assert.match(pilot,/testButton\.addEventListener\('click'/);
 assert.match(pilot,/registration\.showNotification/);
 assert.match(source,/settings\.onclick=cityButton\.onclick/);
 assert.match(style,/grid-template-areas:"place settings close" "times times times"!important/);
});

test('responsive CSS always honors the closed prayer strip',()=>{
 assert.ok(style.includes('#app>.prayer-bar[hidden]{display:none!important}'));
 const mobileGrid=style.lastIndexOf('display:grid!important');
 const hideRule=style.lastIndexOf('#app>.prayer-bar[hidden]{display:none!important}');
 assert.ok(hideRule>mobileGrid,'hidden rule must override the last mobile display declaration');
});
