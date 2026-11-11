import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css=readFileSync(new URL('../style.css',import.meta.url),'utf8');
const prayerCss=readFileSync(new URL('../prayer-bar.css',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('desktop navigation uses existing library tab buttons without changing PDF reading',()=>{
 assert.match(css,/@media\s*\(min-width:1200px\)/);
 assert.match(css,/#app \.library-page \.library-bottom-nav\{/);
 assert.match(css,/flex-direction:column/);
 for(const id of ['libraryTabAll','libraryTabRecent','libraryTabBookmarks','libraryTabFav','libraryTabManage'])assert.ok(html.includes('id="'+id+'"'),id);
 assert.match(css,/@media\(max-width:700px\)/);
 assert.doesNotMatch(css.slice(-3500),/\.viewer\b|\.reader-canvas\b/);
});

test('desktop content adapts and prayer actions remain accessible',()=>{
 assert.match(css,/max-width:min\(1540px,100%\)/);
 assert.match(css,/repeat\(auto-fill,minmax\(214px,1fr\)\)/);
 assert.match(prayerCss,/min-width:38px;min-height:38px/);
 assert.match(prayerCss,/min-width:34px;min-height:34px/);
});
