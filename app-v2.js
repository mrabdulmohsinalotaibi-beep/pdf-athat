import * as pdfjs from "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.394/build/pdf.min.mjs";
import {PDFDocument,rgb,StandardFonts} from "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm";
pdfjs.GlobalWorkerOptions.workerSrc="https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.394/build/pdf.worker.min.mjs";
const $=id=>document.getElementById(id),c=$("pdfCanvas"),ink=$("inkCanvas"),ctx=ink.getContext("2d");
let readerMode="single",readerRTL=true,readerFlipBusy=false,readerZoom=1,continuousToken=0,readerQueue=[],readerWorking=false,readerObserver=null,readerNodes=[],readerSaveTimer=null,readerRenderKeys=new Set(),readerEditing=false,pdfiumDoc=null,pdfiumImport=null,inkVisible=true,db,pdf,active=null,page=1,scale=1,autoFit=true,tool="pointer",strokes=[],draft=null,renderTask=null,renderSeq=0,loadSeq=0,filter="all",libraryTab="all",libraryFolder="",libraryLayout="auto",librarySearch="",librarySort="date",libraryFoldersDefault=[],libraryCustomFolders=[],libraryThumbCache=new Map(),libraryThumbQueue=[],libraryThumbBusy=false,libraryThumbInFlight=new Set(),libraryThumbObserver=null,libraryDialogId=null,history=[],redo=[],nativeURL=null,searching=false,docBusy=false,fontMode="original",textRenderSeq=0;
const tell=t=>{$("message").textContent=t||"";$("message").hidden=!t},isMobile=()=>innerWidth<=700;
const desktopReaderKey="pdf-athat-desktop-reader-v1";
const desktopReaderDefaults={view:"single",fit:"page",autoHide:true,expanded:true};
let desktopReaderSettings={...desktopReaderDefaults};
try{
 const stored=JSON.parse(localStorage.getItem(desktopReaderKey)||"null");
 if(stored&&typeof stored==="object")desktopReaderSettings={...desktopReaderDefaults,...stored};
 localStorage.setItem(desktopReaderKey,JSON.stringify(desktopReaderSettings));
}catch(error){console.warn("Reader settings storage unavailable",error)}
const isDesktopReader=()=>matchMedia("(min-width: 900px) and (pointer: fine)").matches;
const desktopSingle=()=>isDesktopReader()&&readerMode==="single"&&desktopReaderSettings.fit==="page";
function applyDesktopReader(){
 const enabled=isDesktopReader()&&desktopReaderSettings.expanded;
 $("viewer").classList.toggle("desktop-expanded",enabled);
 $("viewer").classList.toggle("desktop-auto-hide",enabled&&desktopReaderSettings.autoHide);
 $("viewer").classList.toggle("desktop-single",enabled&&desktopSingle());
}
function openDB(){return new Promise((ok,no)=>{const r=indexedDB.open(window.__pdfAccountId?"pdf-athat-account-"+window.__pdfAccountId:"pdf-athat-v1",1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains("documents"))r.result.createObjectStore("documents",{keyPath:"id"});if(!r.result.objectStoreNames.contains("strokes"))r.result.createObjectStore("strokes",{keyPath:"id"})};r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)})}
function tx(stores,mode,fn){return new Promise((ok,no)=>{const t=db.transaction(stores,mode);let result;const r=fn(t);if(r&&"onsuccess"in r)r.onsuccess=()=>result=r.result;t.oncomplete=()=>ok(result);t.onerror=()=>no(t.error);t.onabort=()=>no(t.error||Error("Transaction aborted"))})}
const getAll=s=>tx(s,"readonly",t=>t.objectStore(s).getAll()),save=(s,v)=>tx(s,"readwrite",t=>t.objectStore(s).put(v)),remove=(s,id)=>tx(s,"readwrite",t=>t.objectStore(s).delete(id));
// The upload timestamp is immutable: reading, annotating or renaming a book must not
// change the user-selected upload-date ordering. Legacy data never stored this field;
// the initial migration records its oldest available timestamp (previous 'updated').
const uploadTimestamp=d=>Number.isFinite(d.uploadedAt)&&d.uploadedAt>0?d.uploadedAt:Number.isFinite(d.createdAt)&&d.createdAt>0?d.createdAt:Number.isFinite(d.updated)&&d.updated>0?d.updated:0;
const compareLibraryFiles=(a,b)=>librarySort==="name"?a.name.localeCompare(b.name,"ar",{numeric:true,sensitivity:"base"})||uploadTimestamp(b)-uploadTimestamp(a):uploadTimestamp(b)-uploadTimestamp(a)||a.name.localeCompare(b.name,"ar",{numeric:true,sensitivity:"base"});
async function backfillLegacyUploadDates(){
 return new Promise((resolve,reject)=>{
  const transaction=db.transaction("documents","readwrite");
  const cursorRequest=transaction.objectStore("documents").openCursor();
  cursorRequest.onsuccess=()=>{
   const cursor=cursorRequest.result;if(!cursor)return;
   const doc=cursor.value;
   if(!Number.isFinite(doc.uploadedAt)||doc.uploadedAt<=0){doc.uploadedAt=uploadTimestamp(doc)||Date.now();cursor.update(doc)}
   cursor.continue();
  };
  cursorRequest.onerror=()=>reject(cursorRequest.error);
  transaction.oncomplete=()=>resolve();
  transaction.onerror=()=>reject(transaction.error);
  transaction.onabort=()=>reject(transaction.error||Error("تعذر تجهيز ترتيب المكتبة"));
 });
}
// A portable backup contains original PDF bytes and the independent writing layer.
const digestHex=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map(b=>b.toString(16).padStart(2,"0")).join("");
const bytesToBase64=async blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(",")[1]);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob)});
const base64ToBytes=value=>{const raw=atob(value);const bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return bytes};
$("backupExport").onclick=async()=>{try{const docs=await getAll("documents"),notes=await getAll("strokes");const entries=[];for(const d of docs){entries.push({...d,file:{name:d.file.name,type:"application/pdf",base64:await bytesToBase64(d.file),sha256:await digestHex(await d.file.arrayBuffer())}})}const backup={format:"PDF.ATHAT.backup",version:3,folders:libraryCustomFolders,createdAt:new Date().toISOString(),documents:entries,strokes:notes};const blob=new Blob([JSON.stringify(backup)],{type:"application/json"});const saved=await saveBlob(blob,"PDF-ATHAT-"+new Date().toISOString().slice(0,10)+".athatbackup");tell(saved?"تم حفظ نسخة احتياطية للمكتبة والكتابات":"أُلغِي حفظ النسخة الاحتياطية")}catch(e){console.error(e);tell("تعذر إنشاء النسخة الاحتياطية: "+(e.message||"خطأ غير معروف"))}};
$("backupImport").onchange=async e=>{const file=e.target.files?.[0];e.target.value="";if(!file)return;try{if(file.size>600*1024*1024)throw Error("حجم النسخة كبير جدًا");const backup=JSON.parse(await file.text());if(backup.format!=="PDF.ATHAT.backup"||![1,2,3].includes(backup.version)||!Array.isArray(backup.documents)||!Array.isArray(backup.strokes))throw Error("ملف النسخة الاحتياطية غير صالح");if(backup.documents.length>5000||backup.strokes.length>300000)throw Error("النسخة تتجاوز الحدود المقبولة");const docs=[];for(const d of backup.documents){if(typeof d.id!=="string"||typeof d.name!=="string"||typeof d.file?.base64!=="string")throw Error("مستند غير صالح");const bytes=base64ToBytes(d.file.base64);if(bytes.length>75*1024*1024||!new TextDecoder("latin1").decode(bytes.slice(0,1024)).includes("%PDF-"))throw Error("مستند PDF غير صالح في النسخة");if(backup.version>=2&&typeof d.file.sha256!=="string")throw Error("النسخة الجديدة تفتقد بصمة حماية الملف: "+d.name);if(d.file.sha256!==undefined&&typeof d.file.sha256!=="string")throw Error("بصمة ملف غير صالحة: "+d.name);if(d.file.sha256&&(!/^[a-f0-9]{64}$/i.test(d.file.sha256)||(await digestHex(bytes)).toLowerCase()!==d.file.sha256.toLowerCase()))throw Error("فشل التحقق من سلامة الملف: "+d.name);docs.push({...d,uploadedAt:uploadTimestamp(d)||Date.now(),file:new File([bytes],d.file.name||d.name,{type:"application/pdf"})})}const ids=new Set(docs.map(d=>d.id));if(ids.size!==docs.length)throw Error("معرفات مستندات مكررة");const noteIds=new Set();for(const note of backup.strokes){if(!ids.has(note.documentId)||typeof note.id!=="string"||!Number.isInteger(note.page)||note.page<1||!Array.isArray(note.points)||noteIds.has(note.id)||note.points.length>200000||!note.points.every(p=>Array.isArray(p)&&p.length===2&&p.every(v=>Number.isFinite(v)&&v>=0&&v<=1)))throw Error("تعليق غير صالح أو مكرر في النسخة");noteIds.add(note.id)}const existingDocs=await getAll("documents"),existingNotes=await getAll("strokes");const takenDocs=new Set(existingDocs.map(d=>d.id)),takenNotes=new Set(existingNotes.map(n=>n.id));const originalIds=new Set(docs.map(d=>d.id));for(const note of backup.strokes){if(!originalIds.has(note.documentId))throw Error("تعليق بلا مستند مرتبط")};const remap=new Map();for(const d of docs){const old=d.id;while(takenDocs.has(d.id))d.id=crypto.randomUUID();remap.set(old,d.id);takenDocs.add(d.id)}const incomingNotes=backup.strokes.map(note=>{const copy={...note,documentId:remap.get(note.documentId)};while(takenNotes.has(copy.id))copy.id=crypto.randomUUID();takenNotes.add(copy.id);return copy});if(new Set(incomingNotes.map(n=>n.id)).size!==incomingNotes.length)throw Error("تعليقات مكررة في النسخة");if(!confirm("سيتم إضافة "+docs.length+" مستند و"+incomingNotes.length+" تعليق دون استبدال المستندات الحالية. هل تريد المتابعة؟"))return;await new Promise((resolve,reject)=>{const transaction=db.transaction(["documents","strokes"],"readwrite");transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error||Error("فشلت عملية الاستعادة"));for(const d of docs)transaction.objectStore("documents").add(d);for(const note of incomingNotes)transaction.objectStore("strokes").add(note)});strokes=await getAll("strokes");if(backup.version>=3&&Array.isArray(backup.folders)){libraryCustomFolders=Array.from(new Set([...libraryCustomFolders,...backup.folders.filter(n=>typeof n==="string"&&n.trim().length<=40).map(n=>n.trim())]));saveFolders()}await refresh();showLibrary();tell("اكتملت استعادة النسخة الاحتياطية. افتح مستندًا من المكتبة")}catch(error){console.error(error);tell("تعذرت الاستعادة: "+(error.message||"الملف غير صالح"))}};
function setImmersive(on){if(on){document.documentElement.classList.add("reader-open");$("viewer").classList.remove("immersive");closePanel();toggleSidebar(false)}else{$("viewer").classList.remove("immersive")}}
$("revealControls").onclick=()=>setImmersive(false);$("hideControls").onclick=()=>setImmersive(true);
function toggleSidebar(on){$("sidebar").classList.remove("open");$("backdrop").hidden=true;$("libraryToggle").setAttribute("aria-expanded","false");if(on){if(active)closeDocument();else showLibrary()}}
$("backdrop").onclick=()=>toggleSidebar(false);$("libraryToggle").onclick=()=>toggleSidebar(true);$("closeLibrary").onclick=()=>toggleSidebar(false);$("backToHome").onclick=()=>toggleSidebar(true);$("bottomFiles").onclick=()=>toggleSidebar(true);
$("themeToggle").onclick=()=>{document.documentElement.classList.toggle("dark");localStorage.setItem("athat-theme",document.documentElement.classList.contains("dark")?"dark":"light")};if(localStorage.getItem("athat-theme")==="dark")document.documentElement.classList.add("dark");
async function refresh(){let docs=await getAll("documents");$("count").textContent=docs.filter(d=>!d.deleted).length;docs=docs.filter(d=>filter==="trash"?d.deleted:!d.deleted&&(filter==="fav"?d.favorite:true)).sort(compareLibraryFiles);$("library").replaceChildren();for(const d of docs){const row=document.createElement("div");row.className="doc"+(active?.id===d.id?" selected":"");const open=document.createElement("button");open.className="open";open.textContent=d.name;open.title=d.name;open.onclick=async()=>{if(d.deleted){d.deleted=false;await save("documents",d);await refresh()}else{toggleSidebar(false);await activate(d)}};const fav=document.createElement("button");fav.className="mini-star";fav.textContent=d.favorite?"★":"☆";fav.title="المفضلة";fav.onclick=async()=>{d.favorite=!d.favorite;await save("documents",d);refresh()};const del=document.createElement("button");del.className="delete";del.textContent=d.deleted?"↶":"×";del.title=d.deleted?"استعادة":"نقل للمحذوفات";del.onclick=async()=>{d.deleted=!d.deleted;await save("documents",d);if(d.deleted&&active?.id===d.id)closeDocument();refresh()};row.append(open,fav,del);$("library").append(row)}await renderLibrary()}

/* IndexedDB is kept unchanged; folders are stored as per-document labels and portable backups. */
const folderStorageKey="pdfathat-folders"+(window.__pdfAccountId?":"+window.__pdfAccountId:"");
try{const f=JSON.parse(localStorage.getItem(folderStorageKey)||"[]");if(Array.isArray(f))libraryCustomFolders=f.filter(x=>typeof x==="string"&&x.trim()&&x.length<41)}catch(e){console.warn(e)}
const folderList=()=>[...new Set(libraryCustomFolders)];
const saveFolders=()=>{try{localStorage.setItem(folderStorageKey,JSON.stringify(libraryCustomFolders))}catch(e){console.warn(e)}};
function libNode(tag,cls,txt){const n=document.createElement(tag);if(cls)n.className=cls;if(txt!==undefined)n.textContent=txt;return n}
function showLibrary(){if(active){closeDocument();return}document.documentElement.classList.remove("reader-open");$("viewer").hidden=true;$("welcome").hidden=true;$("libraryPage").hidden=false;$("sidebar").classList.remove("open");$("backdrop").hidden=true;void renderLibrary()}
function librarySelect(tab,folder=""){libraryTab=tab;libraryFolder=folder;for(const [id,t]of [["libraryTabAll","all"],["libraryTabRecent","recent"],["libraryTabBookmarks","bookmarks"],["libraryTabFav","fav"],["libraryTabManage","manage"]])$(id).classList.toggle("selected",tab===t);void renderLibrary()}
for(const [id,t]of [["libraryTabAll","all"],["libraryTabRecent","recent"],["libraryTabBookmarks","bookmarks"],["libraryTabFav","fav"],["libraryTabManage","manage"]])$(id).onclick=()=>librarySelect(t);
$("libraryOpenTrash").onclick=()=>librarySelect("trash");
$("libraryBookmarksShortcut").onclick=()=>librarySelect("bookmarks");
$("librarySearch").oninput=e=>{librarySearch=e.target.value.trim().toLowerCase();void renderLibrary()};
const librarySortStorageKey="pdfathat-library-sort-v1"+(window.__pdfAccountId?":"+window.__pdfAccountId:"");
try{const savedSort=localStorage.getItem(librarySortStorageKey);if(savedSort==="date"||savedSort==="name")librarySort=savedSort}catch(_){}
$("librarySort").value=librarySort;
$("librarySort").onchange=e=>{
 librarySort=e.target.value==="name"?"name":"date";
 try{localStorage.setItem(librarySortStorageKey,librarySort)}catch(_){}
 void refresh();
};
$("libraryListView").onclick=()=>{libraryLayout="list";try{localStorage.setItem("pdfathat-library-layout-v1",libraryLayout)}catch(_){}void renderLibrary()};
$("libraryGridView").onclick=()=>{libraryLayout="grid";try{localStorage.setItem("pdfathat-library-layout-v1",libraryLayout)}catch(_){}void renderLibrary()};
try{const stored=localStorage.getItem("pdfathat-library-layout-v1");if(stored==="grid"||stored==="list")libraryLayout=stored}catch(_){};
$("libraryBackupExport").onclick=()=>$("backupExport").click();
$("libraryBackupImport").onclick=()=>$("backupImport").click();
const manageModeKey="pdfathat-default-reading";
const manageRTLKey="pdfathat-default-rtl";
const managementSelected=new Set();
const readableSize=n=>n<1024*1024?(n/1024).toFixed(1)+" ك.ب":(n/(1024*1024)).toFixed(1)+" م.ب";
const manageNames={files:"إدارة الملفات",backup:"النسخ الاحتياطي",reading:"إعدادات القراءة",storage:"المساحة والتخزين",appearance:"المظهر",privacy:"الخصوصية"};
function renderManageFiles(docs){
 const root=$("manageFileList");root.replaceChildren();
 const selected=docs.filter(d=>!d.deleted),ids=new Set(selected.map(d=>d.id));
 for(const id of managementSelected)if(!ids.has(id))managementSelected.delete(id);
 for(const d of selected){
  const label=libNode("label","manage-file-row"),input=document.createElement("input");
  input.type="checkbox";input.value=d.id;input.checked=managementSelected.has(d.id);
  input.onchange=()=>{if(input.checked)managementSelected.add(d.id);else managementSelected.delete(d.id);$("manageSelectedCount").textContent=managementSelected.size+" محدد"};
  label.append(input,libNode("span","",d.name),libNode("small","",readableSize(d.file?.size||0)));root.append(label);
 }
 $("manageSelectedCount").textContent=managementSelected.size+" محدد";
 const select=$("manageDestination");const previous=select.value;select.replaceChildren();
 const blank=document.createElement("option");blank.value="";blank.textContent="بدون مجلد";select.append(blank);
 for(const name of folderList()){const option=document.createElement("option");option.value=name;option.textContent=name;select.append(option)}
 if([...select.options].some(o=>o.value===previous))select.value=previous;
}
function openManagePanel(name){
 if(!(name in manageNames))return;
 $("manageDetail").hidden=false;$("manageDetailTitle").textContent=manageNames[name];
 for(const type of Object.keys(manageNames))$("manage"+type[0].toUpperCase()+type.slice(1)).hidden=type!==name;
 document.querySelectorAll("[data-manage]").forEach(button=>button.classList.toggle("selected",button.dataset.manage===name));
 if(name==="reading"){
  $("manageDefaultMode").value=localStorage.getItem(manageModeKey)||"single";
  $("manageDefaultRTL").checked=localStorage.getItem(manageRTLKey)!=="false";
  $("manageAutoHide").checked=desktopReaderSettings.autoHide;
 }
 if(name==="appearance")$("manageTheme").value=document.documentElement.classList.contains("dark")?"dark":"light";
 if(name==="storage")void updateStorageInfo();
 if(name==="files")void getAll("documents").then(renderManageFiles);
}
document.querySelectorAll("[data-manage]").forEach(button=>button.onclick=()=>openManagePanel(button.dataset.manage));
$("manageDetailClose").onclick=()=>{$("manageDetail").hidden=true;document.querySelectorAll("[data-manage]").forEach(b=>b.classList.remove("selected"))};
$("manageSelectAll").onclick=async()=>{for(const d of await getAll("documents"))if(!d.deleted)managementSelected.add(d.id);renderManageFiles(await getAll("documents"))};
$("manageClearSelection").onclick=async()=>{managementSelected.clear();renderManageFiles(await getAll("documents"))};
async function applyBulk(operation){
 if(!managementSelected.size){tell("اختر ملفًا واحدًا على الأقل");return}
 const docs=(await getAll("documents")).filter(d=>managementSelected.has(d.id)&&!d.deleted);
 if(!docs.length)return;
 if(operation==="delete"&&!confirm("نقل "+docs.length+" ملف إلى المحذوفات؟ ستبقى قابلة للاستعادة."))return;
 const folder=$("manageDestination").value;
 for(const d of docs){
  if(operation==="move")d.folders=folder?[folder]:[];
  if(operation==="favorite")d.favorite=true;
  if(operation==="delete")d.deleted=true;
  d.updated=Date.now();await save("documents",d);
 }
 managementSelected.clear();await refresh();renderManageFiles(await getAll("documents"));
 tell("تم تحديث "+docs.length+" ملف بنجاح");
}
$("manageMove").onclick=()=>void applyBulk("move");
$("manageFavorite").onclick=()=>void applyBulk("favorite");
$("manageDelete").onclick=()=>void applyBulk("delete");
$("manageDefaultMode").onchange=e=>{localStorage.setItem(manageModeKey,e.target.value)};
$("manageDefaultRTL").onchange=e=>{localStorage.setItem(manageRTLKey,String(e.target.checked))};
$("manageAutoHide").onchange=e=>{desktopReaderSettings.autoHide=e.target.checked;try{localStorage.setItem(desktopReaderKey,JSON.stringify(desktopReaderSettings))}catch(error){console.warn(error)}applyDesktopReader()};
$("manageTheme").onchange=e=>{document.documentElement.classList.toggle("dark",e.target.value==="dark");localStorage.setItem("athat-theme",e.target.value)};
$("managePrivacyBackup").onclick=()=>$("backupExport").click();
async function updateStorageInfo(){
 const docs=await getAll("documents");
 const total=docs.reduce((n,d)=>n+(d.file?.size||0),0);
 let extra="";
 try{const estimate=await navigator.storage?.estimate?.();if(estimate?.quota)extra=" · استخدام مساحة الموقع: "+readableSize(estimate.usage||0)+" من "+readableSize(estimate.quota)}catch(error){console.warn(error)}
 $("manageQuotaInfo").textContent="حجم ملفات PDF: "+readableSize(total)+extra;
}
$("manageRequestPersistence").onclick=async()=>{
 if(!navigator.storage?.persist){tell("المتصفح لا يدعم طلب التخزين المستمر");return}
 const granted=await navigator.storage.persist();
 tell(granted?"وافق المتصفح على طلب الحفاظ على بيانات الموقع":"لم يمنح المتصفح التخزين المستمر. احتفظ بنسخة احتياطية.");
};
$("manageCheckDuplicates").onclick=async()=>{
 const root=$("manageDuplicates");root.textContent="جارٍ فحص الملفات المتطابقة محليًا…";
 try{
  const docs=(await getAll("documents")).filter(d=>!d.deleted),groups=new Map();
  for(const d of docs){const hash=await digestHex(await d.file.arrayBuffer());if(!groups.has(hash))groups.set(hash,[]);groups.get(hash).push(d.name)}
  const duplicates=[...groups.values()].filter(g=>g.length>1);
  root.replaceChildren();
  if(!duplicates.length){root.textContent="لم أجد ملفات PDF متطابقة.";return}
  root.append(libNode("p","",duplicates.length+" مجموعة متطابقة — لن تُحذف أي ملفات تلقائيًا."));
  for(const group of duplicates)root.append(libNode("p","",group.join(" • ")));
 }catch(error){root.textContent="تعذر فحص الملفات: "+(error.message||"خطأ")}
};

let latestResumeDocument=null;
$("libraryQuickAdd").onclick=()=>$("file3").click();
$("libraryQuickFolder").onclick=()=>$("libraryNewFolder").click();
$("libraryQuickContinue").onclick=()=>{if(latestResumeDocument)openLibraryDocument(latestResumeDocument)};
$("libraryNewFolder").onclick=()=>{const raw=prompt("اسم المجلد الجديد");if(raw===null)return;const name=raw.trim().slice(0,40);if(!name)return;if(folderList().includes(name))return tell("اسم المجلد موجود");libraryCustomFolders.push(name);saveFolders();librarySelect("all",name)};
function libraryCover(d){
 const box=libNode("div","library-cover");box.append(libNode("span","library-cover-symbol","▤"),libNode("span","library-cover-label","PDF"));
 const img=document.createElement("img");img.className="library-cover-image";img.alt="غلاف "+d.name;img.hidden=true;box.append(img);
 const data=libraryThumbCache.get(d.id);
 if(data){img.src=data;img.hidden=false;box.classList.add("has-preview")}
 else {img.__doc=d;if(!libraryThumbObserver)libraryThumbObserver=new IntersectionObserver(entries=>{for(const item of entries)if(item.isIntersecting){libraryThumbObserver.unobserve(item.target);const target=item.target.querySelector("img");if(target?.__doc){libraryThumbQueue.push({doc:target.__doc,image:target,cover:item.target});void drawLibraryCovers()}}},{root:$("libraryPage").querySelector(".library-content"),rootMargin:"150px"});queueMicrotask(()=>{if(box.isConnected)libraryThumbObserver?.observe(box)})}
 return box
}
async function drawLibraryCovers(){
 if(libraryThumbBusy)return;libraryThumbBusy=true;
 try{while(libraryThumbQueue.length){const {doc,image,cover}=libraryThumbQueue.shift();if(!image.isConnected)continue;let src=libraryThumbCache.get(doc.id);if(!src){let pdfFile=null;try{pdfFile=await pdfjs.getDocument({data:new Uint8Array(await doc.file.arrayBuffer()),useSystemFonts:false}).promise;const p=await pdfFile.getPage(1);const base=p.getViewport({scale:1}),v=p.getViewport({scale:Math.min(1,150/base.width)});const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.ceil(v.width));canvas.height=Math.max(1,Math.ceil(v.height));await p.render({canvasContext:canvas.getContext("2d"),viewport:v}).promise;src=canvas.toDataURL("image/jpeg",.7);if(libraryThumbCache.size>=30)libraryThumbCache.delete(libraryThumbCache.keys().next().value);libraryThumbCache.set(doc.id,src)}catch(e){console.warn("PDF cover",e)}finally{if(pdfFile)try{await pdfFile.destroy()}catch(_){}}}if(src&&image.isConnected){image.src=src;image.hidden=false;cover.classList.add("has-preview")}}}finally{libraryThumbBusy=false}
}
function openLibraryDocument(d,atBookmark=false){$("libraryPage").hidden=true;void activate(d,atBookmark&&Number.isInteger(d.bookmarkPage)&&d.bookmarkPage>0?d.bookmarkPage:null)}
function docDialog(d){
 libraryDialogId=d.id;$("libraryDocTitle").textContent="تنظيم الملف";$("libraryRename").value=d.name;
 const box=$("libraryDocFolders");box.replaceChildren();
 for(const n of folderList()){const label=libNode("label","library-doc-folder-option"),input=document.createElement("input");input.type="checkbox";input.value=n;input.checked=d.folders?.includes(n)||false;label.append(input,document.createTextNode(n));box.append(label)}
 $("libraryDialogFavorite").textContent=d.favorite?"★ إزالة من المفضلة":"☆ إضافة للمفضلة";
 $("libraryDialogDelete").textContent=d.deleted?"↶ استعادة الملف":"نقل للمحذوفات";
 $("libraryDocDialog").showModal()
}
$("libraryDialogCancel").onclick=()=>$("libraryDocDialog").close();
$("libraryDialogFavorite").onclick=async()=>{const d=(await getAll("documents")).find(x=>x.id===libraryDialogId);if(!d)return;d.favorite=!d.favorite;d.updated=Date.now();await save("documents",d);$("libraryDialogFavorite").textContent=d.favorite?"★ إزالة من المفضلة":"☆ إضافة للمفضلة";await refresh()};
$("libraryDialogDelete").onclick=async()=>{const d=(await getAll("documents")).find(x=>x.id===libraryDialogId);if(!d)return;d.deleted=!d.deleted;d.updated=Date.now();await save("documents",d);$("libraryDocDialog").close();if(d.deleted&&active?.id===d.id)closeDocument();await refresh()};
$("libraryDialogSave").onclick=async()=>{const d=(await getAll("documents")).find(x=>x.id===libraryDialogId);if(!d)return;let n=$("libraryRename").value.trim();if(!n)return tell("اكتب اسم الملف");if(!/\.pdf$/i.test(n))n+=".pdf";d.name=n;d.folders=[...$("libraryDocFolders").querySelectorAll("input:checked")].map(x=>x.value);d.updated=Date.now();await save("documents",d);$("libraryDocDialog").close();await refresh()};
function libraryFileCard(d,comments){
 const article=libNode("article","library-book-card"),open=libNode("button","library-book-open");open.type="button";open.onclick=()=>d.deleted?docDialog(d):openLibraryDocument(d,libraryTab==="bookmarks");open.append(libraryCover(d));
 const info=libNode("div","library-book-details");info.append(libNode("strong","library-book-name",d.name),libNode("small","library-book-meta",(d.lastPage>1?"صفحة "+d.lastPage:"ملف PDF")+(comments?" · "+comments+" تعليق":"")+(d.bookmarkPage?" · 🔖 فاصل: "+d.bookmarkPage:"")));
 if(d.totalPages>1&&d.lastPage>1){const track=libNode("div","library-book-progress"),bar=libNode("span");bar.style.width=Math.min(100,Math.round(d.lastPage/d.totalPages*100))+"%";track.append(bar);info.append(track)}
 open.append(info);const more=libNode("button","library-book-menu","⋯");more.type="button";more.title="تنظيم "+d.name;more.onclick=()=>docDialog(d);article.append(open,more);return article
}
let librarySeq=0;
async function renderLibrary(){
 if(!db)return;const seq=++librarySeq,docs=await getAll("documents");if(seq!==librarySeq)return;const activeDocs=docs.filter(d=>!d.deleted),notes=await getAll("strokes");if(seq!==librarySeq)return;
 $("libraryPage").dataset.libraryTab=libraryTab;const noteCount=new Map();for(const n of notes)noteCount.set(n.documentId,(noteCount.get(n.documentId)||0)+1);
 $("manageFilesCount").textContent=String(activeDocs.length);
 $("manageFoldersCount").textContent=String(folderList().length);
 $("manageStorageSize").textContent=readableSize(docs.reduce((sum,d)=>sum+(d.file?.size||0),0));
 if(libraryTab==="manage"&&!$("manageFiles").hidden)renderManageFiles(docs);
 $("libraryStatsAll").textContent=String(activeDocs.length);
 $("libraryStatsFolders").textContent=String(folderList().length);
 $("libraryStatsBookmarks").textContent=String(activeDocs.filter(d=>Number.isInteger(d.bookmarkPage)&&d.bookmarkPage>0).length);
 $("libraryStatsFav").textContent=String(activeDocs.filter(d=>d.favorite).length);
 const folders=$("libraryFolders");folders.replaceChildren();
 const folderItems=[{name:"كل الملفات",key:"",icon:"▤",count:activeDocs.length},...folderList().map(n=>({name:n,key:n,icon:"▰",count:activeDocs.filter(d=>d.folders?.includes(n)).length}))];
 for(const f of folderItems){const card=libNode("div","library-folder-card"+(libraryTab==="all"&&libraryFolder===f.key?" selected":"")),button=libNode("button","library-folder-open");button.type="button";button.append(libNode("span","library-folder-icon",f.icon),libNode("span","library-folder-label",f.name),libNode("small","library-folder-count",String(f.count)));button.onclick=()=>librarySelect("all",f.key);card.append(button);
 if(libraryCustomFolders.includes(f.key)){const del=libNode("button","library-folder-delete","×");del.title="حذف مجلد مع إبقاء ملفاته";del.onclick=async()=>{if(!confirm("حذف المجلد دون حذف ملفاته؟"))return;libraryCustomFolders=libraryCustomFolders.filter(n=>n!==f.key);saveFolders();for(const d of activeDocs)if(d.folders?.includes(f.key)){d.folders=d.folders.filter(n=>n!==f.key);await save("documents",d)}if(libraryFolder===f.key)libraryFolder="";void renderLibrary()};card.append(del)}folders.append(card)}
 const managing=libraryTab==="manage";$("libraryManage").hidden=!managing;$("libraryFilesTitle").parentElement.hidden=managing;$("librarySearch").parentElement.hidden=managing;$("libraryCards").hidden=managing;$("libraryFolders").hidden=managing;$("libraryNewFolder").parentElement.hidden=managing;
 const resumeDoc=[...activeDocs].filter(d=>d.lastPage>1).sort((a,b)=>(b.updated||0)-(a.updated||0))[0];
 latestResumeDocument=resumeDoc||null;
 $("libraryQuickContinue").disabled=!resumeDoc;
 $("libraryResume").hidden=!(resumeDoc&&libraryTab==="all"&&!libraryFolder&&!librarySearch);
 if(!$("libraryResume").hidden){
  const root=$("libraryResumeCard");root.replaceChildren();
  const btn=libNode("button","library-resume-open");btn.type="button";btn.onclick=()=>openLibraryDocument(resumeDoc);btn.append(libraryCover(resumeDoc));
  const info=libNode("div","library-resume-details"),percent=resumeDoc.totalPages>0?Math.min(100,Math.round(resumeDoc.lastPage/resumeDoc.totalPages*100)):null;
  const title=libNode("strong","library-resume-name",resumeDoc.name);title.dir="auto";
  info.append(title,libNode("small","","آخر قراءة: صفحة "+resumeDoc.lastPage+(resumeDoc.totalPages?" من "+resumeDoc.totalPages:"")));
  if(percent!==null){const progress=libNode("div","library-resume-progress"),bar=libNode("span");bar.style.width=percent+"%";progress.append(bar);info.append(progress,libNode("small","library-resume-percent",percent+"% مكتمل"))}
  info.append(libNode("span","library-resume-link","متابعة القراءة ←"));btn.append(info);root.append(btn)
 }
 if(managing)return;
 let filtered=libraryTab==="trash"?docs.filter(d=>d.deleted):activeDocs;
 if(libraryTab==="fav")filtered=filtered.filter(d=>d.favorite);
 if(libraryTab==="bookmarks")filtered=filtered.filter(d=>Number.isInteger(d.bookmarkPage)&&d.bookmarkPage>0);
 if(libraryTab==="all"&&libraryFolder)filtered=filtered.filter(d=>libraryFolder==="__none"?!d.folders?.length:d.folders?.includes(libraryFolder));
 if(librarySearch)filtered=filtered.filter(d=>d.name.toLowerCase().includes(librarySearch));
 filtered.sort(libraryTab==="recent"?(a,b)=>(b.updated||0)-(a.updated||0):compareLibraryFiles);if(libraryTab==="recent")filtered=filtered.slice(0,20);
 $("libraryFilesTitle").textContent=(libraryTab==="fav"?"المفضلة":libraryTab==="bookmarks"?"الكتب ذات الفواصل":libraryTab==="recent"?"الملفات الأخيرة":libraryTab==="trash"?"المحذوفة":libraryFolder==="__none"?"غير مصنف":libraryFolder||"جميع الملفات")+" ("+filtered.length+")";
 const effectiveLayout=libraryLayout==="auto"?(matchMedia("(min-width: 701px)").matches?"grid":"list"):libraryLayout;
 $("libraryListView").classList.toggle("selected",effectiveLayout==="list");$("libraryGridView").classList.toggle("selected",effectiveLayout==="grid");
 const list=$("libraryCards");list.className="library-cards "+(libraryLayout==="auto"?"responsive-view":effectiveLayout+"-view");libraryThumbObserver?.disconnect();libraryThumbQueue.length=0;list.replaceChildren();
 const frag=document.createDocumentFragment();for(const d of filtered)frag.append(libraryFileCard(d,noteCount.get(d.id)||0));list.append(frag);$("libraryEmpty").hidden=filtered.length>0
}

for(const [id,name]of [["showAll","all"],["showFav","fav"],["showTrash","trash"]])$(id).onclick=()=>{filter=name;for(const x of ["showAll","showFav","showTrash"])$(x).classList.toggle("selected",x===id);refresh()};
function closeDocument(){history=[];redo=[];draft=null;stopContinuous();renderSeq++;loadSeq++;renderTask?.cancel();pdfiumDoc?.destroy();pdfiumDoc=null;active=null;pdf=null;document.documentElement.classList.remove("reader-open");$("viewer").classList.remove("immersive","native-reading");$("viewer").hidden=true;$("welcome").hidden=true;if(nativeURL){URL.revokeObjectURL(nativeURL);nativeURL=null}closePanel();toggleSidebar(false);showLibrary()}
// Compare the SHA-256 of the PDF bytes, not just the filename, so renamed copies
// are recognized. Never delete or overwrite an existing PDF or its annotations.
async function findMatchingPdf(file,sha256){
 const documents=await getAll("documents");
 for(const doc of documents){
  if(!doc.file||doc.file.size!==file.size)continue;
  const previousHash=typeof doc.sha256==="string"&&/^[a-f0-9]{64}$/i.test(doc.sha256)
   ? doc.sha256.toLowerCase():await digestHex(await doc.file.arrayBuffer());
  if(previousHash===sha256)return doc;
 }
 return null;
}
function confirmDuplicatePdf(existing,newName){
 return new Promise(resolve=>{
  const dialog=document.createElement("dialog");
  dialog.dir="rtl";dialog.setAttribute("aria-label","الملف موجود سابقًا");
  dialog.style.cssText="width:min(92vw,430px);max-width:430px;padding:20px;border:1px solid #b9a389;border-radius:18px;background:#efe3d4;color:#35271e;box-shadow:0 16px 50px #0005";
  const heading=document.createElement("h2");
  heading.textContent="هذا الملف موجود سابقًا";heading.style.cssText="margin:0 0 12px;font-size:19px";
  const details=document.createElement("p");
  details.textContent="وجدنا نسخة مطابقة داخل "+(existing.deleted?"المحذوفات":"مكتبتك")+" باسم «"+existing.name+"». الملف المختار «"+newName+"» يحتوي على نفس المحتوى. هل تريد إضافة نسخة أخرى؟";
  details.style.cssText="line-height:1.9;font-size:14px;overflow-wrap:anywhere";
  const actions=document.createElement("div");actions.style.cssText="display:flex;gap:10px;flex-wrap:wrap;margin-top:18px";
  const add=document.createElement("button");add.type="button";add.textContent="إضافة نسخة أخرى";
  add.style.cssText="flex:1;min-width:135px;background:#780000;color:white;border:0;padding:10px;border-radius:10px";
  const cancel=document.createElement("button");cancel.type="button";cancel.textContent="إلغاء التحميل";
  cancel.style.cssText="flex:1;min-width:135px;padding:10px;border-radius:10px";
  actions.append(add,cancel);dialog.append(heading,details,actions);document.body.append(dialog);
  let done=false;
  const finish=allow=>{if(done)return;done=true;dialog.close();dialog.remove();resolve(allow)};
  add.onclick=()=>finish(true);cancel.onclick=()=>finish(false);
  dialog.addEventListener("cancel",event=>{event.preventDefault();finish(false)});
  dialog.addEventListener("close",()=>finish(false));
  try{dialog.showModal()}catch{finish(false)}
 });
}
// Serialize uploads so two simultaneous selections cannot evade the duplicate check.
let pendingPdfUpload=Promise.resolve();
async function addFile(file){
 if(!file)return;
 try{
  if(file.size>75*1024*1024)throw Error("الحد الأقصى 75 ميجابايت");
  const head=new TextDecoder("latin1").decode(await file.slice(0,1024).arrayBuffer());
  if(!head.includes("%PDF-"))throw Error("الملف ليس PDF صالحًا");
  const sha256=await digestHex(await file.arrayBuffer());
  const existing=await findMatchingPdf(file,sha256);
  if(existing&&!await confirmDuplicatePdf(existing,file.name)){
   tell("أُلغيت إضافة النسخة المكررة، وملفك السابق محفوظ كما هو.");
   return;
  }
  const addedAt=Date.now();const d={id:crypto.randomUUID(),name:file.name,file,sha256,uploadedAt:addedAt,updated:addedAt,lastPage:1,deleted:false,favorite:false};
  await save("documents",d);
  await activate(d);
 }catch(e){console.error("PDF import failed",e);tell(e.message||"تعذر فتح المستند")}
}
for(const id of ["file","file2","file3"])$(id).onchange=e=>{
 const file=e.target.files?.[0];e.target.value="";
 pendingPdfUpload=pendingPdfUpload.then(()=>addFile(file)).catch(error=>{console.error("PDF import queue",error);tell("تعذر إضافة الملف")});
};
async function activate(d,openAtPage=null){history=[];redo=[];draft=null;chooseTool("pointer");const seq=++loadSeq;renderTask?.cancel();pdfiumDoc?.destroy();pdfiumDoc=null;active=d;pdf=null;$("libraryPage").hidden=true;page=Number.isInteger(openAtPage)&&openAtPage>0?openAtPage:(d.lastPage||1);readerMode=["single","spread","vertical","flip","horizontal","grid"].includes(d.readerMode)?d.readerMode:(localStorage.getItem(manageModeKey)||"single");readerRTL=d.readerRTL===undefined?localStorage.getItem(manageRTLKey)!=="false":d.readerRTL!==false;setImmersive(true);autoFit=true;readerEditing=false;readerZoom=1;applyDesktopReader();$("viewer").classList.add("reading-mode");$("viewer").classList.remove("editing-mode");$("readerOptions").hidden=true;fontMode="pdfjs";$("textReader").hidden=true;$("nativePreview").hidden=true;$("sheet").hidden=false;$("name").textContent=d.name;$("readerFileName").textContent=d.name;$("viewer").hidden=false;$("welcome").hidden=true;$("favorite").textContent=d.favorite?"★":"☆";$("nativePreview").hidden=true;$("sheet").hidden=false;if(nativeURL)URL.revokeObjectURL(nativeURL);nativeURL=URL.createObjectURL(d.file);$("nativeFrame").removeAttribute("src");tell("");try{const newpdf=await pdfjs.getDocument({data:new Uint8Array(await d.file.arrayBuffer()),useSystemFonts:false,disableFontFace:false,cMapUrl:"https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.394/cmaps/",cMapPacked:true,standardFontDataUrl:"https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.394/standard_fonts/",useWasm:true,wasmUrl:"https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.394/wasm/"}).promise;if(seq!==loadSeq){newpdf.destroy();return}pdf=newpdf;page=Math.min(Math.max(page,1),pdf.numPages);if(d.totalPages!==pdf.numPages){d.totalPages=pdf.numPages;await save("documents",d)}try{pdfiumImport??=import("./pdfium-adapter.js");const {createPdfiumDocument}=await pdfiumImport;const engine=await createPdfiumDocument(new Uint8Array(await d.file.arrayBuffer()));if(seq!==loadSeq){engine.destroy();return}if(engine.pages!==pdf.numPages){engine.destroy();throw Error("PDFium page count mismatch")}pdfiumDoc=engine;/* Keep the embedded Arabic text in its original PDF layout. PDF.js may reshape complex fonts. */fontMode="original"}catch(error){console.warn("PDFium unavailable, using PDF.js",error);fontMode="pdfjs";tell("تعذر تشغيل PDFium لهذا الملف؛ تم استخدام PDF.js بدلًا منه")}await startContinuous();refresh()}catch(e){console.error(e);tell("تعذر عرض المستند، جرب فتح الملف الأصلي من خيارات الخط") }}
function fitWidth(p){const width=$("desk").clientWidth-(isMobile()?16:48)-(isMobile()?44:0);return Math.min(3,Math.max(.3,width/p.getViewport({scale:1}).width))}
async function render(){if(!pdf)return;if(fontMode==="text"){await renderArabicText();return}const seq=++renderSeq;try{renderTask?.cancel();const p=await pdf.getPage(page);if(seq!==renderSeq)return;if(autoFit)scale=fitWidth(p);const v=p.getViewport({scale}),ratio=Math.min(devicePixelRatio||1,3,Math.sqrt(16000000/Math.max(1,v.width*v.height)));c.width=ink.width=Math.ceil(v.width*ratio);c.height=ink.height=Math.ceil(v.height*ratio);for(const el of [c,ink]){el.style.width=v.width+"px";el.style.height=v.height+"px"}$("sheet").style.width=v.width+"px";$("sheet").style.height=v.height+"px";if(fontMode==="original"&&pdfiumDoc&&v.rotation===0){try{
 const bitmap=await pdfiumDoc.renderPage(page,scale*ratio);
 if(seq!==renderSeq)return;
 if(Math.abs(bitmap.width-c.width)>c.width*.03||Math.abs(bitmap.height-c.height)>c.height*.03)throw Error("PDFium page size differs");
 c.width=bitmap.width;c.height=bitmap.height;ink.width=bitmap.width;ink.height=bitmap.height;
 c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(bitmap.data),bitmap.width,bitmap.height),0,0);
 }catch(error){console.warn("PDFium page rendering failed, using PDF.js",error);fontMode="pdfjs";tell("تم التحويل إلى PDF.js لهذه الصفحة");renderTask=p.render({canvasContext:c.getContext("2d"),viewport:v,transform:[ratio,0,0,ratio,0,0],intent:"display"});await renderTask.promise}
 }else{renderTask=p.render({canvasContext:c.getContext("2d"),viewport:v,transform:[ratio,0,0,ratio,0,0],intent:"display"});await renderTask.promise}if(seq!==renderSeq)return;$("pages").textContent=page+" / "+pdf.numPages;$("scale").textContent=Math.round(scale*100)+"%";$("prev").disabled=page===1;$("next").disabled=page===pdf.numPages;paint()}catch(e){if(e.name!=="RenderingCancelledException"){console.error(e);tell("تعذر عرض الصفحة؛ جرب العرض البديل")}}}
function annotationLines(value){return String(value||"").replace(/\r\n?/g,"\n").split("\n").slice(0,80)}
function drawAnnotationLines(context,lines,x,y,fontSize,color){
 context.save();context.direction="rtl";context.textAlign="right";context.textBaseline="alphabetic";
 context.fillStyle=color;context.font=`${fontSize}px sans-serif`;
 for(let i=0;i<lines.length;i++)context.fillText(lines[i],x,y+i*fontSize*1.4);
 context.restore()
}
function paint(){ctx.clearRect(0,0,ink.width,ink.height);if(!inkVisible)return;for(const s of [...strokes.filter(x=>x.documentId===active?.id&&x.page===page),...(draft?[draft]:[])]){ctx.strokeStyle=s.color||"#780000";ctx.fillStyle=s.color||"#780000";ctx.globalAlpha=s.tool==="highlight"?.4:1;ctx.lineWidth=(s.size||(s.tool==="highlight"?16:3))*ink.width/Math.max(1,ink.clientWidth);ctx.lineCap="round";ctx.lineJoin="round";if(s.tool==="text"||s.tool==="comment"){ctx.globalAlpha=1;drawAnnotationLines(ctx,annotationLines(s.text),s.points[0][0]*ink.width,s.points[0][1]*ink.height,Math.round((s.size||15)*ink.width/Math.max(1,ink.clientWidth)),s.color||"#780000");continue}if(s.tool==="rect"){const a=s.points[0],b=s.points.at(-1);if(a&&b)ctx.strokeRect(a[0]*ink.width,a[1]*ink.height,(b[0]-a[0])*ink.width,(b[1]-a[1])*ink.height);continue}if(s.points.length<2)continue;ctx.beginPath();s.points.forEach(([x,y],i)=>i?ctx.lineTo(x*ink.width,y*ink.height):ctx.moveTo(x*ink.width,y*ink.height));ctx.stroke()}ctx.globalAlpha=1}
function pos(e){const r=ink.getBoundingClientRect();return [Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))]}
function chooseTool(t){if(!inkVisible&&t!=="pointer"){tell("أظهر طبقة الكتابة أولًا");return}if(!["original","pdfjs"].includes(fontMode)&&t!=="pointer"){tell("للرسم على PDF، ارجع إلى العرض الأصلي");return}tool=t;ink.style.pointerEvents=t==="pointer"?"none":"auto";for(const b of document.querySelectorAll("[data-tool]"))b.classList.toggle("active",b.dataset.tool===t);$("toolSettings").hidden=t==="pointer";$("toolLabel").textContent=({pen:"القلم",signature:"التوقيع",highlight:"التظليل",eraser:"ممحاة",text:"إضافة نص",comment:"تعليق",rect:"مستطيل"})[t]||"التصفح";if(t!=="pointer")closePanel()}
for(const [id,t]of [["pointer","pointer"],["pen","pen"],["highlight","highlight"],["eraser","eraser"],["textTool","text"],["commentTool","comment"],["shapeTool","rect"],["signatureTool","signature"]])$(id).onclick=()=>chooseTool(t);chooseTool("pointer");
function askAnnotationText(kind){
 const dialog=$("annotationDialog"),field=$("annotationText");
 $("annotationHeading").textContent=kind==="comment"?"إضافة تعليق":"إضافة نص إلى الصفحة";
 field.value="";
 return new Promise(resolve=>{
  let settled=false;
  function finish(value){
   if(settled)return;settled=true;
   dialog.removeEventListener("cancel",cancel);
   dialog.removeEventListener("close",closed);
   field.onkeydown=null;$("annotationSave").onclick=null;$("annotationCancel").onclick=null;
   if(dialog.open)dialog.close();
   resolve(value&&value.trim()?value:null)
  }
  function cancel(event){event.preventDefault();finish(null)}
  function closed(){finish(null)}
  dialog.addEventListener("cancel",cancel);
  dialog.addEventListener("close",closed);
  $("annotationSave").onclick=()=>finish(field.value);
  $("annotationCancel").onclick=()=>finish(null);
  field.onkeydown=event=>{if((event.ctrlKey||event.metaKey)&&event.key==="Enter"){event.preventDefault();finish(field.value)}};
  dialog.showModal();field.focus()
 })
}
ink.onpointerdown=async e=>{if(!active||tool==="pointer"||$("nativePreview").hidden===false)return;e.preventDefault();const p=pos(e);if(tool==="eraser"){const candidates=strokes.filter(s=>s.documentId===active.id&&s.page===page);let best=null,dist=Infinity;for(const s of candidates){for(const [x,y]of s.points){const d=Math.hypot(x-p[0],y-p[1]);if(d<dist){dist=d;best=s}}}if(best&&dist<.045){strokes=strokes.filter(s=>s.id!==best.id);history.push({type:"remove",stroke:best});redo=[];await remove("strokes",best.id);paint()}return}if(tool==="text"||tool==="comment"){const docId=active.id,docPage=page,selectedTool=tool;const text=await askAnnotationText(selectedTool);if(!text||!active||active.id!==docId)return;const s={id:crypto.randomUUID(),documentId:docId,page:docPage,tool:selectedTool,text,color:$("color").value,size:tool==="text"?16:13,points:[p]};await persist(s);return}ink.setPointerCapture(e.pointerId);draft={id:crypto.randomUUID(),documentId:active.id,page,tool,color:$("color").value,size:tool==="highlight"?16:Number($("strokeSize").value),points:[p]};paint()};
ink.onpointermove=e=>{if(!draft||!active||draft.documentId!==active.id)return;draft.points.push(pos(e));paint()};
async function persist(s){if(!active||s.documentId!==active.id)return;try{await save("strokes",s);strokes.push(s);if(!active||active.id!==s.documentId)return;history.push({type:"add",stroke:s});redo=[];paint();updateNotes()}catch(e){console.error(e);tell("لم تُحفظ الكتابة. تحقق من مساحة التخزين وأعد المحاولة")}}
async function finish(){if(!draft)return;const s=draft;draft=null;if(!active||s.documentId!==active.id)return;if(s.points.length===1)s.points.push([...s.points[0]]);await persist(s)}ink.onpointerup=finish;ink.onpointercancel=finish;
let editing=false;
async function undo(){if(editing||!active)return;const h=history.at(-1);if(!h||h.stroke.documentId!==active.id)return;editing=true;try{if(h.type==="add")await remove("strokes",h.stroke.id);else await save("strokes",h.stroke);if(h.type==="add")strokes=strokes.filter(s=>s.id!==h.stroke.id);else strokes.push(h.stroke);if(!active||active.id!==h.stroke.documentId)return;history.pop();redo.push(h);paint();updateNotes()}catch(e){console.error(e);tell("تعذر التراجع؛ لم تتغير الكتابات المحفوظة")}finally{editing=false}}
async function redoOp(){if(editing||!active)return;const h=redo.at(-1);if(!h||h.stroke.documentId!==active.id)return;editing=true;try{if(h.type==="add")await save("strokes",h.stroke);else await remove("strokes",h.stroke.id);if(h.type==="add")strokes.push(h.stroke);else strokes=strokes.filter(s=>s.id!==h.stroke.id);if(!active||active.id!==h.stroke.documentId)return;redo.pop();history.push(h);paint();updateNotes()}catch(e){console.error(e);tell("تعذرت الإعادة؛ لم تتغير الكتابات المحفوظة")}finally{editing=false}}
$("undo").onclick=undo;$("redo").onclick=redoOp;
async function go(delta,turn=false){
 if(!pdf||!active)return;
 const previous=page;
 const step=readerMode==="spread"&&turn?(delta>=0?2:-2):delta;
 page=Math.min(pdf.numPages,Math.max(1,page+step));
 updateReaderBookmark();active.lastPage=page;active.updated=Date.now();await save("documents",active);
 if(!readerEditing&&fontMode==="native"){readerInfo();$("nativeFrame").src=nativeURL+"#view=Fit&page="+page}
 else if(!readerEditing&&["original","pdfjs"].includes(fontMode)){
  if(readerMode==="flip"&&page!==previous){
   const root=$("continuousReader");
   root.classList.remove("flip-next","flip-prev");void root.offsetWidth;
   root.classList.add(delta>0?"flip-next":"flip-prev");
   setTimeout(()=>root.classList.remove("flip-next","flip-prev"),520);
  }
  readerGoTo(page);
 }else render();
}
$("prev").onclick=()=>go(-1);$("next").onclick=()=>go(1);
$("pageJump").onclick=()=>{if(!pdf)return;const n=Number(prompt("رقم الصفحة (1 إلى "+pdf.numPages+")",page));if(Number.isInteger(n)&&n>=1&&n<=pdf.numPages)go(n-page)};
$("minus").onclick=()=>{autoFit=false;scale=Math.max(.3,scale-.15);render()};$("plus").onclick=()=>{autoFit=false;scale=Math.min(3,scale+.15);render()};$("fit").onclick=()=>{autoFit=true;render()};
let resizeTimer;addEventListener("resize",()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{applyDesktopReader();if(pdf&&autoFit){if(readerEditing)render();else if(["original","pdfjs"].includes(fontMode))startContinuous()}} ,220)});
$("favorite").onclick=async()=>{if(!active)return;active.favorite=!active.favorite;await save("documents",active);$("favorite").textContent=active.favorite?"★":"☆";refresh()};
async function saveBlob(blob,name){
 if(window.athatDesktop?.saveFile){
  const kind=name.toLowerCase().endsWith(".athatbackup")?"backup":"pdf";
  const result=await window.athatDesktop.saveFile(name,await blob.arrayBuffer(),kind);
  return Boolean(result?.saved)
 }
 const url=URL.createObjectURL(blob),a=document.createElement("a");
 a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),60000);
 return true
}
$("toggleInk").onclick=()=>{inkVisible=!inkVisible;if(!inkVisible&&tool!=="pointer")chooseTool("pointer");$("toggleInk").textContent=inkVisible?"◉":"◎";$("toggleInk").title=inkVisible?"إخفاء الكتابة":"إظهار الكتابة";$("toggleInk").setAttribute("aria-pressed",String(inkVisible));paint()};
$("downloadOriginal").onclick=async()=>{if(!active)return;const file=active.file;try{const saved=await saveBlob(file,active.name);tell(saved?"تم حفظ نسخة من الملف الأصلي":"أُلغِي حفظ الملف")}catch(e){console.error(e);tell("تعذر حفظ الملف الأصلي: "+(e.message||"خطأ غير معروف"))}};
async function download(){if(!active||docBusy)return;const selected=active;docBusy=true;tell("تجهيز الملف للتنزيل...");try{const doc=await PDFDocument.load(await selected.file.arrayBuffer());const maxPages=doc.getPageCount();const invalid=strokes.filter(x=>x.documentId===selected.id&&(!Number.isInteger(x.page)||x.page<1||x.page>maxPages));if(invalid.length)throw Error("تعليقات مرتبطة بصفحات غير صالحة: "+invalid.length);const baseFont=await doc.embedFont(StandardFonts.Helvetica);for(const s of strokes.filter(x=>x.documentId===selected.id)){const p=doc.getPage(s.page-1),{width,height}=p.getSize(),hex=(s.color||"#780000").replace("#",""),color=rgb(parseInt(hex.slice(0,2),16)/255,parseInt(hex.slice(2,4),16)/255,parseInt(hex.slice(4,6),16)/255);if(s.tool==="text"||s.tool==="comment"){
 const lines=annotationLines(s.text);
 if(!lines.some(line=>line.length))continue;
 const fontSize=s.size||13,ratio=3,pad=fontSize*.5;
 const canvas=document.createElement("canvas"),measure=canvas.getContext("2d");
 measure.font=`${fontSize*ratio}px sans-serif`;
 const measured=Math.max(...lines.map(line=>measure.measureText(line).width),1);
 canvas.width=Math.min(16000,Math.ceil(measured+2*pad*ratio));
 canvas.height=Math.min(16000,Math.ceil((fontSize*1.2+(lines.length-1)*fontSize*1.4+fontSize*.35+pad)*ratio));
 const cc=canvas.getContext("2d");
 drawAnnotationLines(cc,lines,canvas.width-pad*ratio,fontSize*1.2*ratio,fontSize*ratio,s.color||"#780000");
 const png=await doc.embedPng(canvas.toDataURL("image/png"));
 const imgW=canvas.width/ratio,imgH=canvas.height/ratio;
 const anchorX=s.points[0][0]*width,anchorY=(1-s.points[0][1])*height;
 p.drawImage(png,{x:anchorX-imgW+pad,y:anchorY+fontSize*1.2-imgH,width:imgW,height:imgH});
 continue
 }const n=s.points;const segments=s.tool==="rect"?[[n[0],[n.at(-1)[0],n[0][1]]],[[n.at(-1)[0],n[0][1]],n.at(-1)],[n.at(-1),[n[0][0],n.at(-1)[1]]],[[n[0][0],n.at(-1)[1]],n[0]]]:n.slice(1).map((v,i)=>[n[i],v]);for(const [a,b]of segments){p.drawLine({start:{x:a[0]*width,y:(1-a[1])*height},end:{x:b[0]*width,y:(1-b[1])*height},thickness:s.tool==="highlight"?12:s.size||2,color,opacity:s.tool==="highlight"?.36:1})}}const data=await doc.save();const saved=await saveBlob(new Blob([data],{type:"application/pdf"}),selected.name.replace(/\.pdf$/i,"")+"-ATHAT.pdf");tell(saved?"تم حفظ نسخة مشروحة من PDF":"أُلغِي تصدير النسخة المشروحة")}catch(e){console.error(e);tell("تعذر التصدير: "+(e.message||"قد يكون الملف محميًا أو غير مدعوم"))}finally{docBusy=false}}
$("download").onclick=download;$("share").onclick=()=>{if(navigator.share)navigator.share({title:active?.name||"PDF.ATHAT",url:location.href}).catch(()=>{});else tell("استخدم تنزيل PDF ثم شاركه من الجهاز")};
const panelModes=["searchPanel","notesPanel","toolsPanel"];function closePanel(){$("panel").hidden=true;for(const x of [...panelModes,"fontPanel"])$(x).hidden=true}function showPanel(mode){$("panel").hidden=false;for(const x of [...panelModes,"fontPanel"])$(x).hidden=x!==mode;$("panelTitle").textContent=({searchPanel:"البحث داخل المستند",notesPanel:"التعليقات",toolsPanel:"أدوات التحرير",fontPanel:"خيارات عرض الخط العربي"})[mode];for(const x of ["bottomSearch","bottomRead","bottomNotes","bottomTools"])$(x).classList.toggle("selected",x===({searchPanel:"bottomSearch",notesPanel:"bottomNotes",toolsPanel:"bottomTools"})[mode]);if(mode==="notesPanel")updateNotes()}
$("closePanel").onclick=closePanel;$("searchToggle").onclick=()=>showPanel("searchPanel");$("bottomSearch").onclick=()=>showPanel("searchPanel");$("bottomNotes").onclick=()=>showPanel("notesPanel");$("bottomTools").onclick=()=>showPanel("toolsPanel");$("bottomRead").onclick=()=>{closePanel();chooseTool("pointer");$("bottomRead").classList.add("selected")};
const tools=[["pointer","تصفح","↖"],["pen","قلم","✎"],["highlight","تظليل","◩"],["eraser","ممحاة","⌫"],["textTool","نص","T"],["commentTool","تعليق","▤"],["shapeTool","مستطيل","▢"],["signatureTool","توقيع","〰"]];for(const [id,label,icon]of tools){const b=document.createElement("button");b.innerHTML="<span>"+icon+"</span>"+label;b.onclick=()=>$(id).click();$("toolsGrid").append(b)}
function updateNotes(){if(!active)return;$("notesList").replaceChildren();const matching=strokes.filter(x=>x.documentId===active.id);for(const s of matching){const b=document.createElement("button");b.className="result";b.textContent="صفحة "+s.page+" — "+(s.text||({pen:"كتابة بالقلم",highlight:"تظليل",signature:"توقيع",rect:"مستطيل"})[s.tool]||"تعليق");b.onclick=()=>{go(s.page-page);closePanel()};$("notesList").append(b)}if(!matching.length)$("notesList").textContent="لم تُضف تعليقات بعد."}
const norm=t=>t.normalize("NFKC").replace(/[\u064B-\u065F\u0670\u0640]/g,"").toLowerCase();$("searchBtn").onclick=async()=>{if(!pdf||searching)return;const q=norm($("searchInput").value.trim());if(!q)return tell("اكتب كلمة للبحث");searching=true;$("searchBtn").disabled=true;$("searchResults").textContent="جاري البحث...";try{const results=[];for(let i=1;i<=pdf.numPages;i++){const text=norm((await(await pdf.getPage(i)).getTextContent()).items.map(x=>x.str||"").join(" "));if(text.includes(q))results.push(i)}$("searchResults").replaceChildren();if(!results.length)$("searchResults").textContent="لا توجد نتائج. قد يكون المستند مصورًا ويحتاج OCR.";for(const p of results){const b=document.createElement("button");b.className="result";b.textContent="الصفحة "+p;b.onclick=()=>{go(p-page);closePanel()};$("searchResults").append(b)}}catch(e){tell("تعذر البحث في هذا الملف")}finally{searching=false;$("searchBtn").disabled=false}};
$("searchInput").onkeydown=e=>{if(e.key==="Enter")$("searchBtn").click()};
$("nativeToggle").onclick=()=>setFontMode(fontMode==="native"?"original":"native");
$("thumbToggle").onclick=()=>toggleThumbs($("thumbs").hidden);$("closeThumbs").onclick=()=>toggleThumbs(false);
async function toggleThumbs(show){$("thumbs").hidden=!show;if(!show||!pdf)return;const holder=$("thumbList");holder.replaceChildren();for(let i=1;i<=Math.min(pdf.numPages,40);i++){const b=document.createElement("button");b.className="thumb-card"+(i===page?" selected":"");b.textContent="صفحة "+i;b.onclick=()=>{go(i-page);toggleThumbs(false)};holder.append(b)}}
window.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.key==="s"){e.preventDefault();download()}if(e.key==="Escape"){closePanel();chooseTool("pointer");toggleSidebar(false)}});
try{db=await openDB();await backfillLegacyUploadDates();strokes=await getAll("strokes");await refresh();if((await getAll("documents")).some(d=>!d.deleted))showLibrary();document.documentElement.dataset.ready="yes"}catch(e){console.error(e);tell("التخزين المحلي غير متاح في المتصفح");document.documentElement.dataset.ready="storage-error"}
if("serviceWorker"in navigator)navigator.serviceWorker.register("./sw.js").catch(()=>{});

function showNativeReader(){
 if(!active||!nativeURL)return;
 if(readerMode!=="single"){fontMode="pdfjs";void startContinuous();return}
 stopContinuous();
 readerEditing=false;
 fontMode="native";
 applyDesktopReader();
 $("viewer").classList.remove("editing-mode");
 $("viewer").classList.add("reading-mode","native-reading");
 $("continuousReader").hidden=true;
 $("sheet").hidden=true;
 $("textReader").hidden=true;
 $("nativePreview").hidden=false;
 $("nativeFrame").src=nativeURL+"#view=Fit&page="+page;
 $("readerFab").title="الانتقال إلى وضع التعليق على الملف";
 readerInfo();
}
function setFontMode(mode){
 if(mode==="native"){showNativeReader();closePanel();return}
 $("viewer").classList.remove("native-reading");
 fontMode=mode;
 if(mode==="original"&&!pdfiumDoc){mode="pdfjs";fontMode=mode}
 $("nativePreview").hidden=true;
 $("textReader").hidden=mode!=="text";
 $("sheet").hidden=mode==="text";
 chooseTool("pointer");closePanel();
 $("fontStatus").textContent=mode==="original"?"محرك PDFium نشط":mode==="pdfjs"?"محرك PDF.js نشط":"وضع القراءة النصية";
 if(mode==="text"){readerEditing=false;$("viewer").classList.remove("reading-mode");$("viewer").classList.add("editing-mode");renderArabicText()}
 else if(readerEditing)render();else startContinuous()
}
$("fontFix").onclick=()=>showPanel("fontPanel");
$("fontNormal").onclick=()=>setFontMode("original");$("fontPdfjs").onclick=()=>setFontMode("pdfjs");
$("fontText").onclick=()=>setFontMode("text");
$("fontNative").onclick=()=>setFontMode("native");
function normalizeArabic(t){return t.normalize("NFKC").replace(/[\u0640]/g,"")}
async function renderArabicText(){if(!pdf)return;const seq=++textRenderSeq;const root=$("textReader");root.replaceChildren();root.textContent="جاري استخراج النص العربي...";try{const p=await pdf.getPage(page),content=await p.getTextContent();if(seq!==textRenderSeq||fontMode!=="text")return;root.replaceChildren();const spans=content.items.filter(i=>i.str&&i.str.trim());if(!spans.length){root.textContent="لا يوجد نص قابل للاستخراج. قد يكون المستند صورة، أو يحتاج إلى OCR.";return}const groups=[];let lastY=null,line=[];for(const i of spans){const y=i.transform?.[5]??0;if(lastY!==null&&Math.abs(y-lastY)>4){groups.push(line);line=[]}line.push(i.str);lastY=y}if(line.length)groups.push(line);for(const line of groups){const p=document.createElement("p");p.textContent=normalizeArabic(line.join(" "));root.append(p)}$("pages").textContent=page+" / "+pdf.numPages;$("prev").disabled=page===1;$("next").disabled=page===pdf.numPages}catch(e){console.error(e);root.textContent="تعذر استخراج النص من الملف. جرّب العرض الأصلي أو عارض الجهاز."}}


/* Reader-first interface: continuous page rendering is independent from the edit canvas.
   Only the current viewport and a small page neighborhood hold pixel buffers. */
function stopContinuous(){
 continuousToken++;
 readerObserver?.disconnect();readerObserver=null;
 readerQueue=[];readerRenderKeys.clear();readerNodes=[];
 if(readerSaveTimer){clearTimeout(readerSaveTimer);readerSaveTimer=null}
 $("continuousReader").replaceChildren();
}
function readerViewportWidth(){const d=$("desk");return Math.max(200,d.clientWidth-(desktopSingle()?24:isMobile()?2:28))}
function isPagedLayout(){return readerMode!=="vertical"}
function activePagedNumbers(){
 if(readerMode==="spread")return [page,page+1].filter(n=>n<=pdf.numPages);
 if(readerMode==="grid")return Array.from({length:pdf.numPages},(_,i)=>i+1);
 return [page];
}
function readerViewportHeight(){return Math.max(120,$("desk").clientHeight-24)}
function readerDimensions(pdfPage){
 const v=pdfPage.getViewport({scale:1});
 const fitPage=desktopSingle()||isPagedLayout();
 const width=readerMode==="spread"?readerViewportWidth()/2-14:readerMode==="grid"?Math.min(180,readerViewportWidth()/4-12):readerViewportWidth();
 const height=readerMode==="grid"?240:readerViewportHeight();
 const cssScale=fitPage
  ? Math.min(3,Math.max(.08,Math.min(width/v.width,height/v.height)*readerZoom))
  : Math.min(3,Math.max(.25,readerViewportWidth()/v.width*readerZoom));
 const viewport=pdfPage.getViewport({scale:cssScale});
 // Full-page desktop reading needs a high-resolution backing buffer, even on 1x displays.
 // Limit total pixels and canvas edges to avoid out-of-memory failures on large PDF pages.
 const ratio=isPagedLayout()
  ? Math.max(.5,Math.min(3.5,Math.max(readerMode==="grid"?1.5:3,devicePixelRatio||1),Math.sqrt((readerMode==="grid"?1000000:24000000)/Math.max(1,viewport.width*viewport.height)),8192/Math.max(1,viewport.width),8192/Math.max(1,viewport.height)))
  : Math.min(devicePixelRatio||1,2.5,Math.sqrt(8500000/Math.max(1,viewport.width*viewport.height)));
 return {viewport,ratio};
}
function updateReaderBookmark(){
 const marked=Number.isInteger(active?.bookmarkPage)&&active.bookmarkPage>0;
 $("readerBookmark").textContent=marked&&active.bookmarkPage===page?"🔖 تحديث فاصل القراءة (الصفحة "+page+")":"🔖 وضع فاصل عند الصفحة "+page;
 $("readerBookmarkGo").hidden=!marked;
 $("readerBookmarkClear").hidden=!marked;
 if(marked)$("readerBookmarkGo").textContent="↩ العودة إلى فاصل القراءة: "+active.bookmarkPage;
}
function readerInfo(){
 $("readerPageInfo").textContent=page+" / "+(pdf?.numPages||1);
 $("readerModeSelect").value=readerMode;
 $("readerRTLToggle").checked=readerRTL;
 $("viewer").dataset.readerMode=readerMode;
 $("viewer").classList.toggle("reader-rtl",readerRTL);
 $("readerPagePrev").disabled=page<=1;
 $("readerPageNext").disabled=!pdf||(readerMode==="spread"?page+1>=pdf.numPages:page>=pdf.numPages);
 updateReaderBookmark();
 $("readerFab").textContent=readerEditing?"✓":"✎";
 $("readerFab").title=readerEditing?"إنهاء التعليق والعودة للقراءة":"الكتابة والتظليل على الصفحة";
 $("readerFab").setAttribute("aria-label",$("readerFab").title);
}
async function startContinuous(){
 if(!pdf||!active||readerEditing||!["original","pdfjs"].includes(fontMode))return;
 stopContinuous();
 applyDesktopReader();
 if(isPagedLayout()){await renderPagedMode();return}
 const token=continuousToken,root=$("continuousReader"),pdfPage=await pdf.getPage(1);
 if(token!==continuousToken)return;
 const basic=readerDimensions(pdfPage);
 const total=pdf.numPages;
 const nodes=document.createDocumentFragment();
 for(let n=1;n<=total;n++){
  const el=document.createElement("section");el.className="read-page";el.dataset.page=String(n);
  el.setAttribute("aria-label","صفحة "+n);
  el.style.width=Math.ceil(basic.viewport.width)+"px";
  el.style.height=Math.ceil(basic.viewport.height)+"px";
  readerNodes[n]=el;nodes.append(el)
 }
 root.replaceChildren(nodes);
 root.hidden=false;$("sheet").hidden=true;$("nativePreview").hidden=true;$("textReader").hidden=true;
 $("viewer").classList.remove("editing-mode");$("viewer").classList.add("reading-mode");
 readerInfo();
 readerObserver=new IntersectionObserver(entries=>{
  if(token!==continuousToken)return;
  for(const e of entries)if(e.isIntersecting)readerQueuePage(Number(e.target.dataset.page),token);
 },{root:$("desk"),rootMargin:"75% 0px 75% 0px",threshold:0});
 for(let n=1;n<=total;n++)readerObserver.observe(readerNodes[n]);
 $("desk").onscroll=onContinuousScroll;
 readerGoTo(page,false);
 readerQueuePage(page,token,true);
 readerQueuePage(Math.min(total,page+1),token);
}
async function renderPagedMode(){
 if(!pdf||!active||readerEditing)return;
 const token=continuousToken,root=$("continuousReader"),numbers=activePagedNumbers();
 $("desk").scrollTop=readerMode==="grid"?0:$("desk").scrollTop;
 const nodes=document.createDocumentFragment();
 const sample=readerMode==="grid"?await pdf.getPage(1):null;
 if(token!==continuousToken)return;
 const sampleViewport=sample?readerDimensions(sample).viewport:null;
 for(const n of numbers){
  const viewport=sampleViewport||(await pdf.getPage(n).then(p=>readerDimensions(p).viewport));
  if(token!==continuousToken)return;
  const node=document.createElement("section");
  node.className="read-page";node.dataset.page=String(n);
  node.setAttribute("aria-label","صفحة "+n);
  node.style.width=viewport.width+"px";node.style.height=viewport.height+"px";
  if(readerMode==="grid"){
   node.tabIndex=0;node.setAttribute("role","button");node.title="افتح الصفحة "+n;
   node.onclick=()=>{page=n;void setReaderMode("single")};
   node.onkeydown=event=>{if(event.key==="Enter"){event.preventDefault();page=n;void setReaderMode("single")}};
  }
  readerNodes[n]=node;nodes.append(node);
 }
 if(token!==continuousToken)return;
 root.replaceChildren(nodes);
 root.hidden=false;$("sheet").hidden=true;$("nativePreview").hidden=true;$("textReader").hidden=true;
 $("viewer").classList.remove("editing-mode","native-reading");$("viewer").classList.add("reading-mode");
 $("desk").onscroll=null;readerInfo();
 if(readerMode==="grid"){
  readerObserver=new IntersectionObserver(entries=>{
   if(token!==continuousToken)return;
   for(const entry of entries)if(entry.isIntersecting)readerQueuePage(Number(entry.target.dataset.page),token);
  },{root:$("desk"),rootMargin:"200px",threshold:0});
  for(const n of numbers)readerObserver.observe(readerNodes[n]);
  readerQueuePage(Math.max(1,Math.min(numbers.length,page)),token,true);
 }else for(const n of numbers)readerQueuePage(n,token,true);
}
async function setReaderMode(next){
 if(!pdf||!active||!["single","spread","vertical","flip","horizontal","grid"].includes(next))return;
 readerMode=next;active.readerMode=next;active.readerRTL=readerRTL;
 if(next==="spread"&&page%2===0)page=Math.max(1,page-1);
 active.lastPage=page;await save("documents",active);
 $("readerOptions").hidden=true;
 $("viewer").classList.remove("native-reading");
 applyDesktopReader();
 if(!readerEditing){
  if(fontMode==="native")fontMode=pdfiumDoc?"original":"pdfjs";
  await startContinuous()
 }
 readerInfo();
}
function readerGoTo(n,smooth=true){
 if(!pdf)return;
 page=Math.max(1,Math.min(pdf.numPages,n));readerInfo();
 if(!readerEditing){
  if(isPagedLayout()){
   stopContinuous();
   void renderPagedMode();
   return;
  }
  const el=readerNodes[page];
  if(el)el.scrollIntoView({behavior:smooth?"smooth":"instant",block:"start"});
  readerQueuePage(page,continuousToken,true);
 }
}
function readerQueuePage(n,token,urgent=false){
 if(token!==continuousToken||!pdf||!readerNodes[n]||readerNodes[n].classList.contains("rendered")||readerRenderKeys.has(n))return;
 readerRenderKeys.add(n);
 if(urgent)readerQueue.unshift(n);else readerQueue.push(n);
 if(!readerWorking)void pumpContinuous(token)
}
async function pumpContinuous(token){
 if(readerWorking)return;
 readerWorking=true;
 try{
  while(readerQueue.length&&token===continuousToken&&!readerEditing){
   const n=readerQueue.shift();readerRenderKeys.delete(n);
   const el=readerNodes[n];if(!el||el.classList.contains("rendered"))continue;
   try{await renderContinuousPage(n,token)}catch(err){console.error("Continuous reader page",n,err);el.dataset.error="true"}
  }
 }finally{
  readerWorking=false;
  if(readerQueue.length&&!readerEditing)void pumpContinuous(continuousToken)
 }
}
async function renderContinuousPage(n,token){
 const el=readerNodes[n],p=await pdf.getPage(n);
 if(token!==continuousToken||!el)return;
 const {viewport,ratio}=readerDimensions(p),width=Math.ceil(viewport.width*ratio),height=Math.ceil(viewport.height*ratio);
 const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;canvas.style.width=viewport.width+"px";canvas.style.height=viewport.height+"px";
 el.style.width=viewport.width+"px";el.style.height=viewport.height+"px";
 let ok=false;
 if(fontMode==="original"&&pdfiumDoc&&viewport.rotation===0){
  try{
   const bitmap=await pdfiumDoc.renderPage(n,viewport.scale*ratio);
   if(token!==continuousToken)return;
   if(Math.abs(bitmap.width-width)>width*.035||Math.abs(bitmap.height-height)>height*.035)throw Error("Unexpected PDFium bitmap size");
   canvas.width=bitmap.width;canvas.height=bitmap.height;
   canvas.getContext("2d",{alpha:false}).putImageData(new ImageData(new Uint8ClampedArray(bitmap.data),bitmap.width,bitmap.height),0,0);
   ok=true;
  }catch(err){console.warn("PDFium failed; PDF.js renders this page",n,err)}
 }
 if(!ok){
  const task=p.render({canvasContext:canvas.getContext("2d",{alpha:false}),viewport,transform:[ratio,0,0,ratio,0,0],intent:"display"});
  await task.promise;
 }
 if(token!==continuousToken||readerNodes[n]!==el)return;
 const overlay=document.createElement("canvas");
 overlay.className="read-annotation";overlay.width=canvas.width;overlay.height=canvas.height;
 overlay.style.width=viewport.width+"px";overlay.style.height=viewport.height+"px";
 el.replaceChildren(canvas,overlay);el.classList.add("rendered");delete el.dataset.error;
 paintReaderOverlay(overlay,n);
}
function paintReaderOverlay(canvas,n){
 const context=canvas.getContext("2d"),w=canvas.width,h=canvas.height;
 context.clearRect(0,0,w,h);if(!inkVisible)return;
 for(const s of strokes.filter(x=>x.documentId===active?.id&&x.page===n)){
  const points=s.points||[];if(!points.length)continue;
  context.save();context.strokeStyle=s.color||"#780000";context.fillStyle=s.color||"#780000";
  context.globalAlpha=s.tool==="highlight"?.36:1;
  context.lineWidth=(s.size||(s.tool==="highlight"?16:3))*w/Math.max(1,canvas.getBoundingClientRect().width);
  context.lineJoin="round";context.lineCap="round";
  if(s.tool==="text"||s.tool==="comment"){context.globalAlpha=1;drawAnnotationLines(context,annotationLines(s.text),points[0][0]*w,points[0][1]*h,Math.round((s.size||15)*w/Math.max(1,canvas.getBoundingClientRect().width)),s.color||"#780000")}
  else if(s.tool==="rect"){const a=points[0],b=points.at(-1);context.strokeRect(a[0]*w,a[1]*h,(b[0]-a[0])*w,(b[1]-a[1])*h)}
  else if(points.length>1){context.beginPath();points.forEach(([x,y],i)=>i?context.lineTo(x*w,y*h):context.moveTo(x*w,y*h));context.stroke()}
  context.restore()
 }
}
function refreshReaderOverlays(){for(let n=1;n<readerNodes.length;n++){const overlay=readerNodes[n]?.querySelector(".read-annotation");if(overlay)paintReaderOverlay(overlay,n)}}
function onContinuousScroll(){
 if(readerEditing||!pdf||!readerNodes.length)return;
 const desk=$("desk"),top=desk.getBoundingClientRect().top,threshold=top+Math.min(desk.clientHeight*.25,180);
 let selected=page,closest=Infinity;
 // Each placeholder has a fixed position even while its PDF pixels are unloaded.
 for(let n=1;n<readerNodes.length;n++){
  const rect=readerNodes[n]?.getBoundingClientRect();if(!rect)continue;
  const diff=rect.bottom>=threshold?Math.abs(rect.top-threshold):Math.abs(rect.bottom-threshold)+2000;
  if(diff<closest){closest=diff;selected=n}
 }
 if(selected!==page){
  page=selected;readerInfo();
  if(readerSaveTimer)clearTimeout(readerSaveTimer);
  const id=active?.id,number=selected;
  readerSaveTimer=setTimeout(async()=>{if(active?.id!==id||readerEditing)return;active.lastPage=number;active.updated=Date.now();try{await save("documents",active)}catch(e){console.error(e)}},600);
 }
 const low=Math.max(1,page-3),high=Math.min(pdf.numPages,page+3);
 for(let n=1;n<readerNodes.length;n++){
  if(n>=low&&n<=high){readerQueuePage(n,continuousToken);continue}
  const el=readerNodes[n];if(el?.classList.contains("rendered")){
   el.replaceChildren();el.classList.remove("rendered");
  }
 }
}
async function setReaderEditing(enabled){
 if(!pdf||!active)return;
 if(enabled&&fontMode==="native"){fontMode=pdfiumDoc?"original":"pdfjs";$("viewer").classList.remove("native-reading");$("nativePreview").hidden=true}
  // Ink must sit above the same faithful PDFium bitmap instead of re-typesetting Arabic via PDF.js.
  if(enabled&&pdfiumDoc&&fontMode!=="original")fontMode="original"
 if(enabled&&!["original","pdfjs"].includes(fontMode)){tell("اختر عرض PDFium أو PDF.js قبل التحرير");return}
 readerEditing=enabled;
 applyDesktopReader();
 $("readerOptions").hidden=true;closePanel();
 chooseTool("pointer");
 if(enabled){
  stopContinuous();
  $("desk").onscroll=null;
  $("viewer").classList.remove("reading-mode");$("viewer").classList.add("editing-mode");
  $("sheet").hidden=false;await render();
  $("desk").scrollTop=0;
 }else{
  $("viewer").classList.remove("editing-mode");$("viewer").classList.add("reading-mode");
  $("sheet").hidden=true;await startContinuous()
 }
 readerInfo();
}
$("readerFab").onclick=()=>setReaderEditing(!readerEditing);
$("readerBack").onclick=()=>{closeDocument();toggleSidebar(true)};
$("readerThumbnails").onclick=()=>toggleThumbs($("thumbs").hidden);
$("readerSearch").onclick=()=>showPanel("searchPanel");
$("readerNotes").onclick=()=>showPanel("notesPanel");
$("readerMenuBtn").onclick=()=>{$("readerOptions").hidden=!$("readerOptions").hidden};
$("readerLibrary").onclick=()=>{$("readerOptions").hidden=true;closeDocument()};
$("readerOpenFile").onclick=()=>{$("readerOptions").hidden=true;$("file").click()};
$("readerOriginal").onclick=()=>{$("readerOptions").hidden=true;$("downloadOriginal").click()};
$("readerExport").onclick=()=>{$("readerOptions").hidden=true;$("download").click()};
$("readerEngines").onclick=()=>{$("readerOptions").hidden=true;showPanel("fontPanel")};
$("readerToggleInk").onclick=()=>{$("readerOptions").hidden=true;$("toggleInk").click();refreshReaderOverlays()};
$("readerBookmark").onclick=async()=>{
 if(!active||!pdf)return;
 active.bookmarkPage=page;
 await save("documents",active);
 updateReaderBookmark();
 $("readerOptions").hidden=true;
 tell("حُفظ فاصل القراءة عند الصفحة "+page+" على هذا الجهاز");
};
$("readerBookmarkGo").onclick=async()=>{
 if(!active||!pdf||!Number.isInteger(active.bookmarkPage))return;
 $("readerOptions").hidden=true;
 await go(active.bookmarkPage-page);
};
$("readerBookmarkClear").onclick=async()=>{
 if(!active)return;
 delete active.bookmarkPage;
 await save("documents",active);
 updateReaderBookmark();
 $("readerOptions").hidden=true;
 tell("أُزيل فاصل القراءة");
};
$("readerZoomOut").onclick=()=>{$("readerOptions").hidden=true;if(readerEditing)$("minus").click();else{readerZoom=Math.max(.5,readerZoom-.15);startContinuous()}};
$("readerZoomIn").onclick=()=>{$("readerOptions").hidden=true;if(readerEditing)$("plus").click();else{readerZoom=Math.min(2.5,readerZoom+.15);startContinuous()}};
$("readerFit").onclick=()=>{$("readerOptions").hidden=true;readerZoom=1;if(readerEditing)$("fit").click();else startContinuous()};
$("readerPageInfo").onclick=()=>{$("pageJump").click()};
$("readerPagePrev").onclick=()=>void go(-1,true);
$("readerPageNext").onclick=()=>void go(1,true);
$("readerModeSelect").onchange=e=>void setReaderMode(e.target.value);
$("readerRTLToggle").onchange=async e=>{
 readerRTL=e.target.checked;
 if(active){active.readerRTL=readerRTL;await save("documents",active)}
 readerInfo();
 if(readerMode!=="single"&&readerMode!=="vertical"&&fontMode!=="native")await startContinuous();
};
let touchStart=null;
$("desk").addEventListener("touchstart",e=>{
 if(!active||readerEditing||!["horizontal","flip","single","spread"].includes(readerMode)||e.touches.length!==1)return;
 touchStart={x:e.touches[0].clientX,y:e.touches[0].clientY};
},{passive:true});
$("desk").addEventListener("touchend",e=>{
 if(!touchStart||!active||readerEditing)return;
 const deltaX=e.changedTouches[0].clientX-touchStart.x,deltaY=e.changedTouches[0].clientY-touchStart.y;
 touchStart=null;
 if(Math.abs(deltaX)<65||Math.abs(deltaX)<Math.abs(deltaY)*1.4)return;
 void go(deltaX*(readerRTL?1:-1)>0?1:-1,true);
},{passive:true});
$("readerOpenNativeTab").onclick=()=>{
 if(!nativeURL)return;
 const popup=window.open(nativeURL+"#view=Fit&page="+page,"_blank","noopener,noreferrer");
 if(!popup)tell("اسمح بفتح التبويبات المنبثقة أو نزّل الملف لفتحه في عارض المتصفح");
};
$("viewer").addEventListener("pointermove",event=>{
 if(!desktopSingle()||!desktopReaderSettings.autoHide)return;
 $("viewer").classList.toggle("desktop-controls-visible",event.clientY<=84);
});
$("viewer").addEventListener("pointerleave",()=>{$("viewer").classList.remove("desktop-controls-visible")});
document.addEventListener("keydown",event=>{
 if(!active||!isDesktopReader()||!isPagedLayout()||readerMode==="grid"||readerEditing||event.altKey||event.ctrlKey||event.metaKey)return;
 const target=event.target;
 if(target?.closest?.("input,textarea,select,[contenteditable],dialog[open]"))return;
 if(event.key==="ArrowRight"||event.key==="PageUp"){event.preventDefault();void go(-1,true)}
 else if(event.key==="ArrowLeft"||event.key==="PageDown"||event.key===" "){event.preventDefault();void go(1,true)}
 else if(event.key==="Home"){event.preventDefault();void go(1-page)}
 else if(event.key==="End"){event.preventDefault();void go(pdf.numPages-page)}
});
$("desk").addEventListener("wheel",event=>{
 if(!active||!isDesktopReader()||!isPagedLayout()||readerMode==="grid"||readerEditing||fontMode==="native"||Math.abs(event.deltaY)<4||event.ctrlKey)return;
 event.preventDefault();
 const stamp=performance.now();
 if(stamp-($("desk")._lastPageWheel||0)<450)return;
 $("desk")._lastPageWheel=stamp;
 void go(event.deltaY>0?1:-1,true);
},{passive:false});

// Original PDF viewing does not re-typeset the document or alter embedded fonts.
$("fontOpenOriginal").onclick=()=>{if(!active)return;const url=URL.createObjectURL(active.file);const win=window.open(url,"_blank","noopener,noreferrer");if(!win){const link=document.createElement("a");link.href=url;link.download=active.name;link.click();tell("إذا تعذر فتح الملف في تبويب جديد، سيتم تنزيل الأصل للقراءة بتطبيق PDF")}setTimeout(()=>URL.revokeObjectURL(url),120000)};
