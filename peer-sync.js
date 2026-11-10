/* PDF.ATHAT opt-in, account-scoped peer-to-peer library sync.
 * Only WebRTC SDP passes through D1 briefly; PDFs/annotations stay on devices,
 * crossing the network through an encrypted WebRTC DataChannel when both are online.
 * No server file storage, no deletion, no automatic cross-account migration.
 */
(()=>{
'use strict';
if(!window.__pdfAccountId||!('RTCPeerConnection' in window)||!('indexedDB' in window))return;
const account=window.__pdfAccountId;
const enabledKey='pdf-athat-peer-sync-enabled:'+account;
const peerKey='pdf-athat-peer-sync-device:'+account;
const deviceId=localStorage.getItem(peerKey)||crypto.randomUUID();
localStorage.setItem(peerKey,deviceId);
let enabled=localStorage.getItem(enabledKey)==='yes', live=false, working=false;
const connections=new Map(), nick='PDF.ATHAT '+(navigator.platform||'جهاز').slice(0,20);
let heartbeatTimer=null,pollTimer=null,onlineCount=0,lastStatus='',lastChange=0;
const status=(text)=>{
 if(text===lastStatus)return;lastStatus=text;
 statusLine.textContent=text;button.title=text;
};
const button=document.createElement('button');button.type='button';button.className='subtle-btn peer-sync-btn';button.textContent='⇄ مزامنة';
const actions=document.querySelector('.header-actions');if(!actions)return;
actions.prepend(button);
const dialog=document.createElement('dialog');dialog.className='peer-sync-dialog';dialog.dir='rtl';
const h=document.createElement('h2');h.textContent='مزامنة مكتبتي بين أجهزتي';
const intro=document.createElement('p');
intro.textContent='عندما تفتح PDF.ATHAT بحسابك نفسه على الجهازين وتكون المزامنة مفعلة فيهما، تنتقل الكتب والملاحظات بينهما مباشرة باتصال مشفّر. لا يخزن خادم الموقع الكتب أو الشروح.';
const statusLine=document.createElement('p');statusLine.setAttribute('role','status');statusLine.className='peer-sync-status';
const details=document.createElement('p');details.className='peer-sync-help';
details.textContent='يلزم أن يكون الجهازان متصلين بالإنترنت ويفتحان الموقع في الوقت نفسه. لا تعمل المزامنة أثناء إغلاق المتصفح أو في الخلفية المقيّدة. في بعض الشبكات قد يلزم خادم TURN غير متوفر حاليًا. بيانات الاتصال المؤقتة تحفظ لمدة قصيرة فقط.';
const hint=document.createElement('p');hint.className='peer-sync-help';
hint.textContent='تُضاف الملفات والشروح المفقودة فقط؛ لن تُحذف ملفات جهاز أو تُستبدل. احتفظ بنسخة احتياطية مشفرة قبل التجربة الأولى.';
const controls=document.createElement('div');controls.className='peer-sync-actions';
const activate=document.createElement('button');activate.type='button';activate.className='primary-btn';
const retry=document.createElement('button');retry.type='button';retry.textContent='إعادة محاولة الاتصال';retry.className='subtle-btn';
const close=document.createElement('button');close.type='button';close.textContent='إغلاق';close.className='subtle-btn';close.onclick=()=>dialog.close();
controls.append(activate,retry,close);dialog.append(h,intro,statusLine,details,hint,controls);document.body.append(dialog);
button.onclick=()=>dialog.showModal();
function updateToggle(){activate.textContent=enabled?'إيقاف المزامنة على هذا الجهاز':'تفعيل المزامنة على هذا الجهاز';button.textContent=enabled?'⇄ المزامنة مفعلة':'⇄ مزامنة'}
updateToggle();
async function request(action,body={}){
 const response=await fetch('/api/sync/'+action,{
  method:'POST',credentials:'same-origin',cache:'no-store',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId,...body})
 });
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(result.error||'تعذر الاتصال بالخادم');
 return result;
}
function openDB(){
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open('pdf-athat-account-'+account,1);
  request.onupgradeneeded=()=>{
   const db=request.result;
   if(!db.objectStoreNames.contains('documents'))db.createObjectStore('documents',{keyPath:'id'});
   if(!db.objectStoreNames.contains('strokes'))db.createObjectStore('strokes',{keyPath:'id'});
  };
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error);
 });
}
async function readAll(store){
 const db=await openDB();
 try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction(store,'readonly'),req=tx.objectStore(store).getAll();
  req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
 })}finally{db.close()}
}
async function writeItem(store,item,addOnly=true){
 const db=await openDB();
 try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction(store,'readwrite'),table=tx.objectStore(store);
  const req=addOnly?table.add(item):table.put(item);
  let inserted=false;
  req.onsuccess=()=>{inserted=true};
  req.onerror=event=>{
   if(addOnly&&req.error?.name==='ConstraintError'){
    event.preventDefault();event.stopPropagation();
   }else reject(req.error);
  };
  tx.oncomplete=()=>resolve(inserted);
  tx.onabort=()=>reject(tx.error||new Error('تعذر الحفظ على هذا الجهاز'));
  tx.onerror=()=>reject(tx.error);
 })}finally{db.close()}
}
async function getOne(store,id){
 const db=await openDB();
 try{return await new Promise((resolve,reject)=>{
  const req=db.transaction(store,'readonly').objectStore(store).get(id);
  req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);
 })}finally{db.close()}
}
function notifyLibrary(){window.dispatchEvent(new Event('pdf-athat-sync-update'))}
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
async function drain(channel){
 if(channel.readyState!=='open')throw Error('انقطع اتصال الجهاز الآخر');
 if(channel.bufferedAmount<=256000)return;
 await new Promise((resolve,reject)=>{
  let timeout;
  const done=err=>{clearTimeout(timeout);channel.removeEventListener('bufferedamountlow',ready);channel.removeEventListener('close',closed);err?reject(err):resolve()};
  const ready=()=>done(),closed=()=>done(new Error('انقطع الاتصال'));
  channel.addEventListener('bufferedamountlow',ready,{once:true});
  channel.addEventListener('close',closed,{once:true});
  timeout=setTimeout(()=>done(new Error('بطء نقل الملفات عبر الشبكة')),30000);
 });
}
function connection(remoteId){
 const previous=connections.get(remoteId);
 if(previous&&previous.pc.connectionState!=='closed'&&previous.pc.connectionState!=='failed')return previous;
 previous?.pc.close();
 const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});
 const state={id:remoteId,pc,channel:null,sendQueue:Promise.resolve(),receiveQueue:Promise.resolve(),parts:new Map(),incoming:null,pendingNotes:[],connected:false};
 connections.set(remoteId,state);
 pc.ondatachannel=event=>attach(state,event.channel);
 pc.onconnectionstatechange=()=>{
  if(['failed','closed','disconnected'].includes(pc.connectionState)){
   if(connections.get(remoteId)===state)connections.delete(remoteId);
   try{pc.close()}catch{}
   if(enabled)status('انقطع الاتصال بأحد الأجهزة؛ ستُعاد المحاولة عندما يتصل.');
  }
 };
 return state;
}
async function fullyGathered(pc){
 if(pc.iceGatheringState==='complete')return;
 await Promise.race([
  new Promise(resolve=>{const check=()=>{if(pc.iceGatheringState==='complete'){pc.removeEventListener('icegatheringstatechange',check);resolve()}};pc.addEventListener('icegatheringstatechange',check);check()}),
  new Promise(resolve=>setTimeout(resolve,9000))
 ]);
}
async function call(remoteId){
 if(!enabled||connections.has(remoteId))return;
 const state=connection(remoteId),channel=state.pc.createDataChannel('pdf-athat-documents',{ordered:true});
 attach(state,channel);
 try{
  await state.pc.setLocalDescription(await state.pc.createOffer());
  await fullyGathered(state.pc);
  if(!enabled)return;
  await request('signal',{to:remoteId,kind:'offer',payload:state.pc.localDescription.toJSON()});
 }catch(error){connections.delete(remoteId);state.pc.close();status('لم يكتمل اتصال الأجهزة: '+error.message)}
}
async function answer(remoteId,payload){
 const existing=connections.get(remoteId);
 if(existing){if(existing.connected)return;existing.pc.close();connections.delete(remoteId)}
 const state=connection(remoteId);
 try{
  await state.pc.setRemoteDescription(payload);
  await state.pc.setLocalDescription(await state.pc.createAnswer());
  await fullyGathered(state.pc);
  if(!enabled)return;
  await request('signal',{to:remoteId,kind:'answer',payload:state.pc.localDescription.toJSON()});
 }catch(error){connections.delete(remoteId);state.pc.close();status('تعذرت الإجابة عن اتصال الجهاز الآخر')}
}
function attach(state,channel){
 state.channel=channel;channel.binaryType='arraybuffer';channel.bufferedAmountLowThreshold=64000;
 channel.onopen=async()=>{
  state.connected=true;status('متصل بجهاز آخر: نقل الكتب والملاحظات الناقصة جارٍ…');
  try{
   const docs=(await readAll('documents')).filter(d=>!d.deleted);
   for(let i=0;i<docs.length;i+=75){
    const group=docs.slice(i,i+75).map(d=>({
     id:d.id,size:d.file?.size||0,updated:Number(d.updated)||0,
     lastPage:d.lastPage||1,bookmarkPage:d.bookmarkPage||null,
     favorite:!!d.favorite,folders:Array.isArray(d.folders)?d.folders.slice(0,30):[],
     readerMode:d.readerMode||'single',readerRTL:d.readerRTL!==false
    }));
    enqueue(state,()=>sendJSON(state,{type:'manifest',docs:group}));
   }
   const notes=await readAll('strokes');
   for(const note of notes)enqueue(state,()=>sendJSON(state,{type:'note',note}));
   enqueue(state,()=>sendJSON(state,{type:'ready'}));
  }catch(error){status('تعذر قراءة مكتبة هذا الجهاز: '+error.message)}
 };
 channel.onmessage=event=>{
  state.receiveQueue=state.receiveQueue.then(()=>receive(state,event.data)).catch(error=>{console.warn('peer_sync_receive',error?.name);status('تعذر استلام جزء من المزامنة؛ حاول إعادة الاتصال.')});
 };
 channel.onclose=()=>{state.connected=false};
}
function enqueue(state,job){
 state.sendQueue=state.sendQueue.then(job).catch(error=>{console.warn('peer_sync_send',error?.name);status('توقف النقل مؤقتًا: '+error.message)});
}
async function sendJSON(state,payload){
 const channel=state.channel;if(!channel||channel.readyState!=='open')throw Error('الجهاز الآخر غير متصل');
 const raw=JSON.stringify(payload);
 if(raw.length<12000){await drain(channel);channel.send(raw);return}
 const id=crypto.randomUUID(),count=Math.ceil(raw.length/10500);
 if(count>1000)throw Error('حجم الرسالة أكبر من المسموح');
 for(let index=0;index<count;index++){
  await drain(channel);
  channel.send(JSON.stringify({type:'part',id,index,total:count,value:raw.slice(index*10500,(index+1)*10500)}));
 }
}
async function sendFile(state,id){
 const doc=await getOne('documents',id);
 if(!doc||doc.deleted||!(doc.file instanceof Blob))return;
 if(doc.file.size>75*1024*1024){status('تخطيت ملفًا أكبر من 75 ميجابايت؛ استخدم النسخة الاحتياطية لنقله.');return}
 const content=await doc.file.arrayBuffer();
 if(!new TextDecoder().decode(content.slice(0,16)).includes('%PDF-'))return;
 const metadata={...doc};delete metadata.file;
 await sendJSON(state,{type:'doc-start',id:doc.id,name:doc.name,size:content.byteLength,sha256:await digest(content),metadata});
 const channel=state.channel;
 for(let offset=0;offset<content.byteLength;offset+=16384){
  await drain(channel);channel.send(content.slice(offset,offset+16384));
 }
 await sendJSON(state,{type:'doc-end',id:doc.id});
}
async function keepRemoteMetadata(remote){
 if(typeof remote.id!=='string'||remote.id.length>150)return;
 const local=await getOne('documents',remote.id);
 if(!local||local.deleted||!local.file||!(Number(remote.updated)>Number(local.updated||0)))return;
 const safe={...local};
 if(Number.isInteger(remote.lastPage)&&remote.lastPage>0)safe.lastPage=remote.lastPage;
 if(Number.isInteger(remote.bookmarkPage)&&remote.bookmarkPage>0)safe.bookmarkPage=remote.bookmarkPage;
 if(typeof remote.favorite==='boolean')safe.favorite=remote.favorite;
 if(Array.isArray(remote.folders))safe.folders=[...new Set([...(local.folders||[]),...remote.folders.filter(x=>typeof x==='string'&&x.length<=40)])];
 if(['single','spread','vertical','flip','horizontal','grid'].includes(remote.readerMode))safe.readerMode=remote.readerMode;
 if(typeof remote.readerRTL==='boolean')safe.readerRTL=remote.readerRTL;
 safe.updated=remote.updated;
 await writeItem('documents',safe,false);notifyLibrary();
}
function validNote(n){
 return n&&typeof n.id==='string'&&n.id.length<=150&&typeof n.documentId==='string'&&n.documentId.length<=150&&
 Number.isInteger(n.page)&&n.page>=1&&Array.isArray(n.points)&&n.points.length<=200000&&
 n.points.every(p=>Array.isArray(p)&&p.length===2&&p.every(v=>Number.isFinite(v)&&v>=0&&v<=1)) &&
 (n.text===undefined||typeof n.text==='string'&&n.text.length<=50000);
}
async function addNote(state,n){
 if(!validNote(n))return;
 const doc=await getOne('documents',n.documentId);
 if(!doc){if(state.pendingNotes.length<10000)state.pendingNotes.push(n);return}
 const old=await getOne('strokes',n.id);
 if(old){
  if(JSON.stringify(old)===JSON.stringify(n))return;
  // Never overwrite independent local edits to an annotation with the same ID.
  const conflictId=(n.id+':peer:'+state.id).slice(0,240);
  if(await getOne('strokes',conflictId))return;
  n={...n,id:conflictId};
 }
 if(await writeItem('strokes',n,true))notifyLibrary();
}
async function receive(state,data){
 if(typeof data!=='string'){
  if(!state.incoming)return;
  if(!(data instanceof ArrayBuffer))return;
  const next=state.incoming;
  next.size+=data.byteLength;
  if(next.size>next.expected||next.size>75*1024*1024){state.incoming=null;throw Error('حجم ملف غير صالح')}
  next.chunks.push(data);
  return;
 }
 const msg=JSON.parse(data);
 if(msg.type==='part'){
  if(typeof msg.id!=='string'||msg.total>1000||msg.total<1||msg.index<0||msg.index>=msg.total||typeof msg.value!=='string')return;
  let entry=state.parts.get(msg.id);
  if(!entry){if(state.parts.size>=4)return;entry={pieces:Array(msg.total),total:msg.total,received:0};state.parts.set(msg.id,entry)}
  if(entry.total!==msg.total)return;
  if(entry.pieces[msg.index]===undefined){entry.pieces[msg.index]=msg.value;entry.received++}
  if(entry.received===entry.total){
   state.parts.delete(msg.id);
   if(entry.pieces.join('').length<11000000)await handle(state,JSON.parse(entry.pieces.join('')));
  }
  return;
 }
 await handle(state,msg);
}
async function handle(state,msg){
 if(msg.type==='manifest'){
  if(!Array.isArray(msg.docs)||msg.docs.length>100)return;
  const missing=[];
  for(const doc of msg.docs){
   if(typeof doc.id!=='string'||doc.id.length>150||!Number.isInteger(doc.size)||doc.size<0)continue;
   const local=await getOne('documents',doc.id);
   if(!local)missing.push(doc.id);
   else await keepRemoteMetadata(doc);
  }
  for(let i=0;i<missing.length;i+=20)enqueue(state,()=>sendJSON(state,{type:'want',ids:missing.slice(i,i+20)}));
 }else if(msg.type==='want'){
  if(!Array.isArray(msg.ids)||msg.ids.length>20)return;
  for(const id of msg.ids)if(typeof id==='string'&&id.length<150)enqueue(state,()=>sendFile(state,id));
 }else if(msg.type==='doc-start'){
  if(state.incoming||typeof msg.id!=='string'||msg.id.length>150||!Number.isInteger(msg.size)||msg.size>75*1024*1024||msg.size<=0||! /^[a-f0-9]{64}$/.test(msg.sha256||''))return;
  state.incoming={id:msg.id,name:String(msg.name||'').slice(0,250),metadata:msg.metadata,expected:msg.size,hash:msg.sha256,size:0,chunks:[]};
 }else if(msg.type==='doc-end'){
  const item=state.incoming;state.incoming=null;
  if(!item||msg.id!==item.id||item.size!==item.expected)return;
  const bytes=await new Blob(item.chunks).arrayBuffer();
  const header=new TextDecoder().decode(bytes.slice(0,1024));
  if(!header.includes('%PDF-')||await digest(bytes)!==item.hash)throw Error('بصمة ملف غير صحيحة');
  const meta=item.metadata&&typeof item.metadata==='object'&&!Array.isArray(item.metadata)?item.metadata:{};
  const doc={...meta,id:item.id,name:item.name||'مستند.pdf',file:new File([bytes],item.name||'مستند.pdf',{type:'application/pdf'})};
  // Add-only: never replace or delete the local file, even on a collision.
  if(await writeItem('documents',doc,true)){
   notifyLibrary();status('وصل ملف جديد إلى المكتبة المحلية من جهازك الآخر.');
  }
  const pending=state.pendingNotes;state.pendingNotes=[];
  for(const note of pending)await addNote(state,note);
 }else if(msg.type==='note'){
  await addNote(state,msg.note);
 }else if(msg.type==='ready'){
  status('الأجهزة متصلة. اكتملت مراجعة المكتبات، وستنتقل الإضافات عند الاتصال.');
 }
}
async function heartbeat(){
 if(!enabled||!navigator.onLine)return;
 try{
  const data=await request('heartbeat',{name:nick});
  onlineCount=data.peers.length;
  if(!onlineCount)status('المزامنة مفعلة. افتح الموقع بالحساب نفسه على الجهاز الثاني.');
  for(const peer of data.peers)if(deviceId<peer.id&&!connections.has(peer.id))void call(peer.id);
 }catch(error){status('خدمة ربط الأجهزة غير متاحة: '+error.message)}
}
async function poll(){
 if(!enabled||!navigator.onLine)return;
 try{
  const data=await request('poll');
  for(const m of data.messages||[]){
   if(m.kind==='offer'&&validPeer(m.sender)){
    // Deterministic caller election stops simultaneous connection glare.
    if(deviceId>m.sender)await answer(m.sender,m.payload);
   }else if(m.kind==='answer'&&validPeer(m.sender)){
    const peer=connections.get(m.sender);
    if(peer&&!peer.pc.currentRemoteDescription)await peer.pc.setRemoteDescription(m.payload);
   }
  }
 }catch(error){if(!/سجّل الجهاز/.test(error.message))status('تعذر استكمال المزامنة: '+error.message)}
}
function validPeer(id){return typeof id==='string'&&/^[0-9a-f-]{36}$/i.test(id)&&id!==deviceId}
async function start(){
 if(live||!enabled)return;
 live=true;status('التحقق من الأجهزة المتصلة…');
 await heartbeat();await poll();
 heartbeatTimer=setInterval(()=>{void heartbeat()},25000);
 pollTimer=setInterval(()=>{void poll()},4500);
}
function stop(){
 if(!live)return;live=false;
 clearInterval(heartbeatTimer);clearInterval(pollTimer);
 for(const peer of connections.values()){try{peer.pc.close()}catch{}}
 connections.clear();
 void request('leave').catch(()=>{});
 status('المزامنة متوقفة على هذا الجهاز. ملفاتك المحلية محفوظة.');
}
activate.onclick=()=>{
 enabled=!enabled;localStorage.setItem(enabledKey,enabled?'yes':'no');updateToggle();
 enabled?void start():stop();
};
retry.onclick=async()=>{stop();if(enabled)await start()};
window.addEventListener('online',()=>{if(enabled)void start()});
window.addEventListener('offline',()=>{if(enabled)status('لا يوجد اتصال بالإنترنت؛ ستتابع المزامنة عند عودته.')});
window.addEventListener('pagehide',()=>{
 clearInterval(heartbeatTimer);clearInterval(pollTimer);
 for(const state of connections.values())state.pc.close();
});
status(enabled?'التحقق من الأجهزة المتصلة…':'المزامنة متوقفة حتى تفعّلها على الجهازين.');
if(enabled)void start();
})();
