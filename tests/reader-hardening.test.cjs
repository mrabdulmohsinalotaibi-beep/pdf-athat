const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {webcrypto}=require('node:crypto');

// Exercise the actual backup helpers from the application, not a reimplementation.
const source=fs.readFileSync(path.join(__dirname,'..','app-v2.js'),'utf8');
const begin=source.indexOf('const backupToB64=');
const end=source.indexOf('$("backupExport").onclick=',begin);
assert.ok(begin>0&&end>begin,'encrypted backup helpers must remain present');
const b64='const base64ToBytes=value=>{const raw=atob(value);const bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return bytes};';
function helpers(password){
 const script='(()=>{const backupCryptoVersion=1;'+b64+'const backupPasswordDialog=async()=>'+JSON.stringify(password)+';'+source.slice(begin,end)+';return {encryptBackupText,decodeBackupText}})()';
 return vm.runInNewContext(script,{crypto:webcrypto,TextEncoder,TextDecoder,atob,btoa,Uint8Array,JSON,Error},{timeout:5000});
}
test('encrypted backup round trip and no plaintext leak',async()=>{
 const h=helpers('correct secret password');
 const plaintext=JSON.stringify({format:'PDF.ATHAT.backup',version:3,documents:[{name:'private-file.pdf',id:'abcd'}],strokes:[]});
 const encrypted=await h.encryptBackupText(plaintext,'correct secret password');
 assert.doesNotMatch(encrypted,/private-file.pdf|abcd/);
 const result=await h.decodeBackupText(encrypted);
 assert.equal(result.documents[0].name,'private-file.pdf');
});
test('wrong backup password and tampering are rejected',async()=>{
 const secret='another secret password';
 const encrypted=await helpers(secret).encryptBackupText(JSON.stringify({format:'PDF.ATHAT.backup',version:3,documents:[],strokes:[]}),secret);
 await assert.rejects(()=>helpers('wrong password here').decodeBackupText(encrypted),/كلمة المرور/);
 const tampered=JSON.parse(encrypted),body=tampered.ciphertext;
 tampered.ciphertext=(body[0]==='A'?'B':'A')+body.slice(1);
 await assert.rejects(()=>helpers(secret).decodeBackupText(JSON.stringify(tampered)),/كلمة المرور/);
});
test('older unencrypted backups remain readable without a password',async()=>{
 const legacy={format:'PDF.ATHAT.backup',version:3,documents:[],strokes:[]};
 const restored=await helpers(null).decodeBackupText(JSON.stringify(legacy));
 assert.equal(restored.version,3);
});
test('reader and account files preserve local-only storage boundaries',()=>{
 assert.match(source,/indexedDB\.open\(window\.__pdfAccountId/);
 assert.match(source,/const existingDocs=await getAll\("documents"\)/);
 assert.match(source,/function installNotesHub\(\)/);
 assert.match(source,/const norm=t=>/);
 const prayer=fs.readFileSync(path.join(__dirname,'..','prayer-bar.js'),'utf8');
 assert.match(prayer,/islamic-umalqura/);
 assert.match(prayer,/30000/);
 assert.match(prayer,/navigator\.geolocation\.getCurrentPosition/);
 assert.match(prayer,/prayer-alerts/);
});
