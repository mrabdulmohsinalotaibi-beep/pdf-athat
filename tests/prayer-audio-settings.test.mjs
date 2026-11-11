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
