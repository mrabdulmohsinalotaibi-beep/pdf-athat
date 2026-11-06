const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {injectAuth}=require('../desktop/scripts/build-auth.cjs');
test('site starts gated with auth bootstrap; desktop source remains offline',()=>{
 const root=path.resolve(__dirname,'..'),dist=fs.mkdtempSync(path.join(os.tmpdir(),'pdf-auth-'));
 try{
  const source=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const html=source.replace('src="./app-v2.js"','src="./app-v2.js?v=test"');
  const result=injectAuth({html,root,dist,version:'test'});
  assert.match(result,/<div id="app" hidden inert>/);
  assert.match(result,/id="authForm"/);
  assert.match(result,/src="\.\/auth.js\?v=test" data-app-module="\.\/app-v2.js\?v=test"/);
  assert.doesNotMatch(result,/<script[^>]*src="\.\/app-v2.js/);
  assert.match(fs.readFileSync(path.join(dist,'auth.js'),'utf8'),/await import\(/);
  assert.doesNotMatch(source,/authGate|auth.js/);
  assert.match(source,/<script type="module" src="\.\/app-v2.js"><\/script>/);
 }finally{fs.rmSync(dist,{recursive:true,force:true});}
});
