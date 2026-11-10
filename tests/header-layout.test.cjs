const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const file=name=>fs.readFileSync(path.join(root,name),'utf8');

test('original SVG logo replaces redundant hamburger and retains library shortcut',()=>{
 const html=file('index.html'),reader=file('app-v2.js');
 assert.match(html,/<button id="libraryToggle" class="brand-home-button"[^>]*>\s*<img src="\.\/icon\.svg"[^>]*><\/button>/);
 assert.doesNotMatch(html,/<button id="libraryToggle"[^>]*>\s*☷\s*<\/button>/);
 assert.match(reader,/\$\("libraryToggle"\)\.onclick=\(\)=>toggleSidebar\(true\)/);
 assert.match(reader,/if\(on\)\{if\(active\)closeDocument\(\);else showLibrary\(\)\}/);
});
test('mobile/tablet header has independent action row and prayer strip never overlaps content',()=>{
 const css=file('style.css'),prayer=file('prayer-bar.css');
 assert.match(css,/#app\{display:flex;flex-direction:column/);
 assert.match(css,/#app>\.workspace\{flex:1 1 auto;height:auto!important/);
 assert.match(css,/@media\(max-width:980px\)/);
 assert.match(css,/overflow-x:auto;overscroll-behavior-inline:contain/);
 assert.match(prayer,/grid-template-areas:"place settings close" "times times times"/);
 assert.match(prayer,/#app:has\(\.prayer-bar:not\(\[hidden\]\)\)>\.workspace\{height:auto!important\}/);
});
test('old-library import remains available in backup management; no extra admin dotted menu',()=>{
 const legacy=file('legacy-import.js');
 const builder=file('desktop/scripts/build-site.cjs');
 assert.match(legacy,/document\.querySelector\('#manageBackup \.manage-controls'\)/);
 assert.doesNotMatch(legacy,/document\.querySelector\('\.header-actions'\)/);
 assert.doesNotMatch(builder,/<script defer src=\\"\.\/admin-entry\.js/);
});
