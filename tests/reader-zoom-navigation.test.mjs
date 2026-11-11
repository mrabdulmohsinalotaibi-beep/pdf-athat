import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const css=readFileSync(new URL('../style.css',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../app-v2.js',import.meta.url),'utf8');

test('expanded PDF reader scrolls zoomed pages rather than clipping them',()=>{
 const ix=css.lastIndexOf('Reader fix: zoomed pages');
 assert.ok(ix>=0);
 const fix=css.slice(ix);
 for(const marker of ['overflow-y:auto!important','overflow-x:auto!important','height:max-content!important','max-height:none!important','max-width:none!important'])assert.ok(fix.includes(marker),marker);
 assert.match(fix,/\.reader-open \.viewer\.desktop-single\.reading-mode/);
});
test('desktop side navigation retains original page IDs and event handlers',()=>{
 assert.match(css,/#readerPagePrev\{/);
 assert.match(css,/#readerPageNext\{/);
 assert.match(html,/id="readerPagePrev"/);
 assert.match(html,/id="readerPageNext"/);
 assert.match(js,/\$\("readerPagePrev"\)\.onclick=/);
 assert.match(js,/\$\("readerPageNext"\)\.onclick=/);
 assert.match(css,/\.reader-page-info\{/);
});
