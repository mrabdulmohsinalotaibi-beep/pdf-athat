// Account dialog and explicit permission. Never synchronize without opting in.
export function setupAccountUI({getAll,save,refresh,notesRefresh}){
 const el=id=>document.getElementById(id);
 let account=null,busy=false,mode="register";
 const message=t=>{el("accountFeedback").textContent=t||""};
 const call=async(path,options={})=>{
  const response=await fetch("/api/"+path,{credentials:"same-origin",cache:"no-store",...options});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(result.error||"تعذر الاتصال بالخدمة.");
  return result;
 };
 const consentKey=()=>"pdf-athat-sync-consent:"+(account?.email||"");
 const approved=()=>account&&localStorage.getItem(consentKey())==="yes";
 const draw=()=>{
  el("accountGuest").hidden=!!account;el("accountMember").hidden=!account;
  el("accountButton").textContent=account?"◉":"♙";
  if(!account)return;
  el("accountIdentity").textContent=account.email;
  el("accountDevices").textContent="أجهزتك المرتبطة: "+(account.devices?.length||1);
  el("accountConsent").hidden=!!approved()||localStorage.getItem(consentKey())==="no";
  el("accountSyncControls").hidden=!approved();
 };
 async function session(){
  try{const info=await call("auth/session");account=info.signedIn?info:null;draw()}
  catch(error){account=null;draw();message("تعذر الوصول للحساب؛ ملفاتك المحلية متاحة.")}
 }
 async function run(action){
  if(busy)return;busy=true;message("");
  try{await action()}catch(err){console.warn("PDF account",err);message(err.message||"تعذر إكمال العملية")}finally{busy=false}
 }
 el("accountButton").onclick=()=>run(async()=>{
  el("accountDialog").showModal();await session();
  if(!account){const h=await call("health");if(!h.otpReady)message("خدمة إرسال رموز البريد لم تُفعّل بعد. يمكنك استخدام الملفات محليًا.")}
 });
 el("accountClose").onclick=()=>el("accountDialog").close();
 el("welcomeAccount").onclick=()=>el("accountButton").click();
 const setMode=next=>{
  mode=next;el("accountModeRegister").classList.toggle("selected",next==="register");
  el("accountModeLogin").classList.toggle("selected",next==="login");
  el("accountSendCode").textContent="إرسال رمز التحقق";
  el("accountPasswordSubmit").textContent=next==="register"?"إنشاء حساب":"تسجيل الدخول";
  el("accountPassword").setAttribute("autocomplete",next==="register"?"new-password":"current-password");
  el("accountHeading").textContent=next==="register"?"إنشاء حساب جديد":"تسجيل الدخول";
  el("accountOtpArea").hidden=true;el("accountOtp").value="";message("");
 };
 el("accountModeRegister").onclick=()=>setMode("register");
 el("accountModeLogin").onclick=()=>setMode("login");
 el("accountPasswordSubmit").onclick=()=>run(async()=>{
  const email=el("accountEmail").value.trim().toLowerCase(),password=el("accountPassword").value;
  if(password.length<12)throw Error("كلمة المرور يجب أن تكون 12 حرفًا على الأقل.");
  const deviceName=/Android/i.test(navigator.userAgent)?"Android":/iPhone|iPad/i.test(navigator.userAgent)?"iPhone / iPad":"حاسوب";
  await call("auth/password/"+mode,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password,deviceName})});
  el("accountPassword").value="";
  await session();message(mode==="register"?"تم إنشاء حسابك المستقل بنجاح.":"تم تسجيل الدخول بنجاح.");
 });
 el("accountSendCode").onclick=()=>run(async()=>{
  const email=el("accountEmail").value.trim().toLowerCase();
  const res=await call("auth/request",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,mode})});
  el("accountOtpArea").hidden=false;message(res.message||"أُرسل الرمز")
 });
 el("accountVerify").onclick=()=>run(async()=>{
  const email=el("accountEmail").value.trim().toLowerCase(),code=el("accountOtp").value.trim();
  const deviceName=/Android/i.test(navigator.userAgent)?"Android":/iPhone|iPad/i.test(navigator.userAgent)?"iPhone / iPad":"حاسوب";
  await call("auth/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,code,deviceName,mode})});
  await session();message(mode==="register"?"تم إنشاء حسابك بنجاح. اختر طريقة استخدام ملفاتك.":"تم تسجيل دخولك بنجاح. اختر طريقة استخدام ملفاتك.")
 });
 el("accountEnableSync").onclick=()=>{if(!account)return;localStorage.setItem(consentKey(),"yes");draw();message("المزامنة مفعّلة على هذا الجهاز. ابدأها يدويًا من الزر.")};
 el("accountLocalOnly").onclick=()=>{if(!account)return;localStorage.setItem(consentKey(),"no");draw();message("ستبقى الملفات محلية فقط.")};
 el("accountDisableSync").onclick=()=>{if(!account)return;localStorage.setItem(consentKey(),"no");draw();message("توقفت المزامنة على هذا الجهاز.")};
 el("accountLogout").onclick=()=>run(async()=>{await call("auth/logout",{method:"POST"});account=null;draw();message("تم الخروج، وملفات هذا الجهاز باقية.")});
 el("accountSyncNow").onclick=()=>run(async()=>{
  if(!approved())throw Error("يجب تفعيل المزامنة أولًا.");
  message("جارٍ مزامنة الملفات...");
  const result=await sync();message("اكتملت المزامنة: رُفع "+result.up+"، ونُزّل "+result.down+"، وتُرك "+result.skip+" ملفًا كبيرًا محليًا.")
 });
 async function sync(){
  let up=0,down=0,skip=0;
  const remote=await call("sync/list");
  const remoteIds=new Map(remote.documents.map(d=>[d.id,d]));
  const local=await getAll("documents"),notes=await getAll("strokes");
  for(const d of local){
   if(d.deleted||remoteIds.has(d.id))continue;
   if(d.file.size>15*1024*1024){skip++;continue}
   const response=await fetch("/api/sync/document/"+encodeURIComponent(d.id),{method:"PUT",credentials:"same-origin",headers:{"Content-Type":"application/pdf","X-PDF-Name":encodeURIComponent(d.name),"X-PDF-Page":String(d.lastPage||1)},body:d.file});
   const result=await response.json().catch(()=>({}));
   if(response.status===409)continue;
   if(!response.ok)throw Error(result.error||"فشل رفع "+d.name);
   remoteIds.set(d.id,{id:d.id,name:d.name});up++
  }
  for(const item of remote.documents){
   if(local.some(d=>d.id===item.id))continue;
   const response=await fetch("/api/sync/document/"+encodeURIComponent(item.id),{credentials:"same-origin",cache:"no-store"});
   if(!response.ok)throw Error("تعذر استعادة "+item.name);
   const blob=await response.blob();
   const bytes=await blob.arrayBuffer();
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map(b=>b.toString(16).padStart(2,"0")).join("");
   if(hash!==item.sha256)throw Error("لم تنجح مراجعة سلامة المستند "+item.name);
   const file=new File([blob],item.name,{type:"application/pdf"});
   await save("documents",{id:item.id,name:item.name,file,updated:Date.now(),lastPage:item.page||1,deleted:false,favorite:false});down++
  }
  for(const id of remoteIds.keys()){
   const own=notes.filter(n=>n.documentId===id);
   const merged=await call("sync/notes/"+encodeURIComponent(id),{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(own)});
   const known=new Set(own.map(n=>n.id));
   for(const note of merged.notes||[]){if(known.has(note.id))continue;await save("strokes",note);known.add(note.id)}
  }
  await notesRefresh();await refresh();return {up,down,skip}
 }
 // When a device already has an active email session, offer consent once.
 void session().then(()=>{
  if(account&&localStorage.getItem(consentKey())===null&&!el("accountDialog").open){
   el("accountDialog").showModal();
   message("هذا الجهاز مرتبط ببريدك. اختر هل تريد مزامنة ملفاتك أم إبقاءها محلية.");
  }
 }).catch(()=>{});
}
