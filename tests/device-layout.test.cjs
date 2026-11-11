const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=name=>fs.readFileSync(path.resolve(__dirname,'..',name),'utf8');
test('three device classes have stable content widths for personal account and administrator',()=>{
 const css=read('admin.css');
 assert.match(css,/@media\(max-width:640px\)/);
 assert.match(css,/@media\(min-width:641px\) and \(max-width:1024px\)/);
 assert.match(css,/@media\(min-width:1025px\)/);
 assert.match(css,/max-width:1180px/);
 assert.match(css,/max-width:920px/);
 assert.match(css,/\.container\.auth-layout/);
 assert.match(css,/\.account-profile/);
 assert.match(css,/\.traffic-stats/);
 assert.match(css,/\.tableWrap\{max-width:100%;overflow-x:auto/);
});
test('mobile text fields do not trigger iPhone input zoom and long account data can wrap',()=>{
 const css=read('admin.css');
 assert.match(css,/font-size:16px;line-height:1\.45/);
 assert.match(css,/\.account-field strong\{font-size:15px;line-height:1\.6;overflow-wrap:anywhere;word-break:break-word/);
 assert.doesNotMatch(read('account.html'),/user-scalable=no|maximum-scale=1/);
});
test('library uses phone, tablet and desktop spacing without stretching PDF rendering canvases',()=>{
 const css=read('style.css');
 for(const bp of ['max-width:640px','min-width:641px','max-width:1024px','min-width:1025px'])assert.ok(css.includes(bp));
 assert.match(css,/--athat-page-max:1180px/);
 assert.match(css,/--athat-page-max:920px/);
 assert.match(css,/--athat-content-gutter:12px/);
 assert.match(css,/\.library-content \.library-cards\.responsive-view\{grid-template-columns:minmax\(0,1fr\)/);
 assert.match(css,/\.reader-topbar\{max-width:100%;padding-inline:6px;overflow-x:auto/);
 const latest=css.slice(css.indexOf('/* Stable three-device layout. Panels'));
 assert.doesNotMatch(latest,/#app #pdfCanvas\{max-width:100%|#app \.viewer :is\(canvas,img\)/);
 const html=read('index.html');
 assert.doesNotMatch(html,/user-scalable=no|maximum-scale=1/);
});

test('personal profile is a single dedicated readable screen at every device width',()=>{
 const css=read('admin.css');
 const source=read('account.js');
 const rules=css.slice(css.indexOf('/* Signed-in account is a standalone dashboard'));
 assert.ok(rules.length>100);
 assert.match(rules,/body>\.container\.auth-layout\.profile-active\{/);
 assert.match(rules,/\.auth-layout\.profile-active>\.auth-info\{display:none\}/);
 assert.match(rules,/max-width:880px/);
 assert.match(rules,/max-width:780px/);
 assert.match(rules,/\.account-data\{[\s\S]*?grid-template-columns:minmax\(0,1fr\)/);
 assert.match(rules,/\.account-field strong\[dir="ltr"\]/);
 assert.match(source,/classList\.add\('profile-active'\)/);
 assert.match(source,/classList\.remove\('profile-active'\)/);
});
