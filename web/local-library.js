// Local-only library picker for the login-free PDF.ATHAT web edition.
// Never send local database IDs, filenames, PDF bytes, or annotations to any server.
(()=>{
"use strict";
const key="pdf-athat-selected-local-library";
const prefix="pdf-athat-account-";
function current(){try{return localStorage.getItem(key)||""}catch{return ""}}
const saved=current();
if(/^[0-9a-f-]{36}$/i.test(saved))window.__pdfAccountId=saved;
function choose(id){try{if(id)localStorage.setItem(key,id);else localStorage.removeItem(key)}catch{}location.reload()}
function create(tag,textValue){const el=document.createElement(tag);if(textValue!==undefined)el.textContent=textValue;return el}
document.addEventListener("DOMContentLoaded",async()=>{
 const bar=document.querySelector(".header-actions");
 if(!bar)return;
 const b=create("button","مكتبات الجهاز");b.type="button";b.className="subtle-btn";b.style.cssText="font-size:12px;padding:8px;white-space:nowrap";b.title="الملفات محفوظة على هذا الجهاز فقط";
 bar.prepend(b);
 const dialog=create("dialog");dialog.dir="rtl";dialog.style.cssText="max-width:min(92vw,440px);border:1px solid #ae987e;border-radius:16px;padding:20px;background:#efe3d4;color:#352a21;box-shadow:0 14px 35px #0003";
 const title=create("h2","مكتبات PDF على هذا الجهاز");title.style.margin="0 0 10px";
 const notice=create("p","لا يلزم تسجيل الدخول. اختر مكتبتك القديمة إن كانت محفوظة هنا. لا تُنقل الملفات ولا تُحذف عند التبديل. بعد إلغاء تسجيل الدخول، يستطيع من يستخدم هذا الجهاز فتح مكتباته المحلية.");
 notice.style.cssText="font-size:13px;line-height:1.8";
 const list=create("div");list.style.cssText="display:grid;gap:8px;margin:12px 0";
 const close=create("button","إغلاق");close.type="button";close.onclick=()=>dialog.close();close.className="subtle-btn";
 dialog.append(title,notice,list,close);document.body.append(dialog);
 function item(label,id,isCurrent){
  const btn=create("button",label+(isCurrent?" ✓":""));btn.type="button";btn.className="subtle-btn";btn.style.cssText="padding:12px;text-align:right;width:100%;border:1px solid #b79f83;border-radius:9px";
  btn.disabled=!!isCurrent;
  btn.onclick=()=>choose(id);
  list.append(btn);
 }
 async function show(){
  list.replaceChildren();
  item("المكتبة المحلية العامة","",!current());
  try{
   if(typeof indexedDB.databases!=="function")throw Error("unsupported");
   const entries=await indexedDB.databases();
   const names=[...new Set(entries.map(x=>x.name).filter(n=>typeof n==="string"&&n.startsWith(prefix)&&/^[0-9a-f-]{36}$/i.test(n.slice(prefix.length))))];
   names.forEach((name,i)=>item("المكتبة السابقة "+(i+1),name.slice(prefix.length),current()===name.slice(prefix.length)));
   if(names.length&&!current()&&!sessionStorage.getItem("pdf-athat-local-picker-shown")){
    sessionStorage.setItem("pdf-athat-local-picker-shown","1");
    // Offer access to the existing PDFs rather than silently using a different library.
    dialog.showModal();
   }
  }catch{
   list.append(create("p","قد لا يدعم المتصفح عرض المكتبات السابقة. تستطيع فتح الملفات المحلية الجديدة أو استعادة نسخة احتياطية."));
  }
 }
 b.onclick=async()=>{await show();if(!dialog.open)dialog.showModal()};
 await show();
});
})();
