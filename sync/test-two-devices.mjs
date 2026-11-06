// Two independent mobile-sized Chromium sessions exercise the actual client WebRTC
// protocol with a mocked account/signaling API; no personal files or cloud storage.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';

const root=path.resolve('desktop/dist');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.mjs':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.wasm':'application/wasm','.webmanifest':'application/manifest+json'};
const server=http.createServer((req,res)=>{
 const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 const file=path.resolve(root,'.'+(relative==='/'?'/index.html':relative));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}
 fs.readFile(file,(e,body)=>{if(e){res.writeHead(404).end();return}res.setHeader('content-type',mime[path.extname(file)]||'application/octet-stream');res.end(body)})
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url='http://127.0.0.1:'+server.address().port;
const idA='11111111-1111-4111-8111-111111111111',idB='22222222-2222-4222-8222-222222222222';
const inbox=new Map([[idA,[]],[idB,[]]]);
let browser,contextA,contextB;
const failures=[];
async function pageFor(name,id,other,viewport){
 const context=await browser.newContext({viewport,isMobile:viewport.width<500,serviceWorkers:'block',permissions:[]});
 await context.route('**/api/**',async route=>{
  const request=route.request(),endpoint=new URL(request.url()).pathname.slice(4),method=request.method();
  let result={ok:true},status=200;
  const input=method==='POST'?request.postDataJSON()||{}:{};
  if(endpoint==='/health')result={ok:true,otpReady:false};
  else if(endpoint==='/auth/session')result={signedIn:true,email:'test@example.invalid',deviceId:id};
  else if(endpoint==='/devices')result={devices:[{device_id:other,device_name:name==='iPhone'?'Tablet':'iPhone',online:true}]};
  else if(endpoint==='/signals'){result={signals:inbox.get(id).splice(0)}}
  else if(endpoint==='/signal'){
   if(!inbox.has(input.recipient)){status=404;result={error:'unknown_device'}}
   else inbox.get(input.recipient).push({id:Date.now(),sender:id,kind:input.kind,payload:input.payload});
  } else if(endpoint==='/presence'){result={ok:true}}
  else {status=404;result={error:'not_found'}}
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
 });
 const page=await context.newPage();
 page.on('dialog',dialog=>dialog.accept().catch(()=>{}));
 page.on('pageerror',e=>failures.push(name+': '+e.message));
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.locator('#peerOpen').waitFor({state:'attached',timeout:20000});
 await page.waitForFunction(()=>document.querySelector('#peerAccount')?.hidden===false,{timeout:15000});
 return {context,page};
}
try{
 browser=await chromium.launch({headless:true,args:['--use-fake-ui-for-media-stream','--no-sandbox']});
 ({context:contextA,page:globalThis.pageA}=await pageFor('iPhone',idA,idB,{width:390,height:844}));
 ({context:contextB,page:globalThis.pageB}=await pageFor('Tablet',idB,idA,{width:900,height:1200}));
 await pageA.evaluate(async()=>{
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('pdf-athat-v1',1);r.onupgradeneeded=()=>{for(const n of ['documents','strokes'])if(!r.result.objectStoreNames.contains(n))r.result.createObjectStore(n,{keyPath:'id'})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
  const bytes=new TextEncoder().encode('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n');
  await new Promise((resolve,reject)=>{const tx=db.transaction('documents','readwrite');tx.objectStore('documents').put({id:'test-mobile-pdf',name:'اختبار-النقل.pdf',file:new File([bytes],'اختبار-النقل.pdf',{type:'application/pdf'}),lastPage:2,updated:Date.now(),deleted:false,favorite:true});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close();
 });
 await pageA.evaluate(()=>document.querySelector('#peerOpen').click());
 await pageB.evaluate(()=>document.querySelector('#peerOpen').click());
 await pageA.locator('#peerDevices button').first().click();
 await pageB.getByRole('button',{name:/اختبار-النقل.pdf/}).waitFor({timeout:45000});
 await pageB.getByRole('button',{name:/اختبار-النقل.pdf/}).click();
 await pageB.waitForFunction(async()=>{
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('pdf-athat-v1',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
  const found=await new Promise(resolve=>{const tx=db.transaction('documents');const r=tx.objectStore('documents').getAll();r.onsuccess=()=>resolve(r.result.find(d=>d.name==='اختبار-النقل.pdf'))});
  db.close();return Boolean(found?.file?.size>10&&found.favorite===true&&found.lastPage===2);
 },{timeout:45000});
 assert.equal(failures.length,0,failures.join('\n'));
 console.log('PASS: two simulated mobile Chromium contexts transferred and locally saved PDF + reading metadata');
}finally{
 await contextA?.close().catch(()=>{});await contextB?.close().catch(()=>{});await browser?.close().catch(()=>{});await new Promise(resolve=>server.close(resolve))
}
