const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const file=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
test('one visible mobile/desktop appearance button cycles three saved themes',()=>{
 const index=file('index.html'),reader=file('app-v2.js'),css=file('style.css');
 assert.match(index,/id="themeToggle" class="icon-btn theme-cycle-btn"/);
 assert.match(index,/<option value="sketch">المرسمة — رصاصي وورقي<\/option>/);
 assert.match(reader,/const appearanceModes=\["light","dark","ocean"\]/);
 assert.match(reader,/\$\("themeToggle"\)\.onclick=/);
 assert.match(reader,/localStorage\.setItem\("athat-theme",mode\)/);
 assert.match(reader,/\$\("manageTheme"\)\.onchange=e=>applyAppearance\(e\.target\.value\)/);
 assert.match(css,/#themeToggle\.theme-cycle-btn\{/);
 assert.match(css,/display:grid!important/);
 assert.match(css,/:root\.ocean\{/);
});
test('admin visit dashboard contains only aggregated statistics and guards server access',()=>{
 const html=file('admin.html'),admin=file('admin.js'),api=file('functions/api/admin/[[path]].js');
 assert.match(html,/id="traffic"/);
 assert.match(html,/id="trafficCountries"/);
 assert.match(html,/id="trafficDevices"/);
 assert.match(html,/id="trafficBrowsers"/);
 assert.match(html,/id="trafficYear"/);
 assert.match(admin,/loadTraffic\(\)/);
 assert.match(admin,/textContent=trafficNum\(/);
 assert.match(api,/if \(user\?\.role !== 'admin'\)/);
 assert.match(api,/action==='traffic'/);
 assert.doesNotMatch(html,/value="abdulmohsinalkhalidi@gmail.com"/);
});
