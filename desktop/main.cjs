'use strict';
const {app,BrowserWindow,dialog,ipcMain}=require('electron');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
// The test profile is isolated from any real user's documents.
if(process.env.ATHAT_TEST_USER_DATA){fs.mkdirSync(process.env.ATHAT_TEST_USER_DATA,{recursive:true});app.setPath('userData',process.env.ATHAT_TEST_USER_DATA)}

function sanitizedFileName(name,kind){
 const extension=kind==='backup'?'.athatbackup':'.pdf';
 const safe=String(name||'PDF-ATHAT').replace(/[\\\\/:*?"<>|\\x00-\\x1f]/g,'_').slice(0,180);
 return safe.toLowerCase().endsWith(extension)?safe:safe+extension;
}
ipcMain.handle('athat:save-file',async(event,args)=>{
 if(!window||event.sender!==window.webContents)throw Error('Unauthorized save request');
 if(!args||!['pdf','backup'].includes(args.kind))throw Error('Unsupported file kind');
 const filename=sanitizedFileName(args.name,args.kind);
 let buffer;
 const value=args.bytes;
 if(value instanceof ArrayBuffer)buffer=Buffer.from(value);
 else if(ArrayBuffer.isView(value))buffer=Buffer.from(value.buffer,value.byteOffset,value.byteLength);
 else throw Error('Unsupported file data');
 if(buffer.length===0||buffer.length>800*1024*1024)throw Error('File size is outside the allowed range');
 let target;
 if(process.env.ATHAT_TEST_OUTPUT_DIR){
  const base=process.env.ATHAT_TEST_OUTPUT_DIR;
  fs.mkdirSync(base,{recursive:true});
  target=path.join(base,filename);
 }else{
  const selected=await dialog.showSaveDialog(window,{
   title:'حفظ ملف PDF.ATHAT',
   defaultPath:filename,
   filters:args.kind==='backup'?[{name:'نسخة احتياطية PDF.ATHAT',extensions:['athatbackup']}]:[{name:'ملف PDF',extensions:['pdf']}]
  });
  if(selected.canceled||!selected.filePath)return {saved:false};
  target=selected.filePath;
 }
 await fs.promises.writeFile(target,buffer);
 return {saved:true};
});
let server,window;
// Prevent concurrent instances from competing for the fixed local storage origin.
const hasLock=app.requestSingleInstanceLock();
if(!hasLock)app.quit();
app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.focus()}});
const root=path.join(__dirname,'dist');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json','.webmanifest':'application/manifest+json','.wasm':'application/wasm','.bcmap':'application/octet-stream','.bin':'application/octet-stream','.ttf':'font/ttf','.otf':'font/otf','.woff':'font/woff','.woff2':'font/woff2','.pdf':'application/pdf'};
function serve(req,res){
 try{
  const u=new URL(req.url,'http://localhost');const pathname=decodeURIComponent(u.pathname);
  if(pathname.includes('\\')||pathname.split('/').includes('..')){res.writeHead(403);return res.end()}
  let target=path.resolve(root,'.'+pathname);
  if(!target.startsWith(root+path.sep)&&target!==root){res.writeHead(403);return res.end()}
  if(fs.existsSync(target)&&fs.statSync(target).isDirectory())target=path.join(target,'index.html');
  if(!fs.existsSync(target)||!fs.statSync(target).isFile()){res.writeHead(404);return res.end('Not found')}
  res.setHeader('Content-Type',mime[path.extname(target)]||'application/octet-stream');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'self' blob: data:; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-src 'self' blob:;");
  fs.createReadStream(target).on('error',()=>res.destroy()).pipe(res);
 }catch{res.writeHead(400);res.end('Bad request')}
}
async function createWindow(){
 if(!fs.existsSync(path.join(root,'index.html'))){dialog.showErrorBox('PDF.ATHAT','Offline assets missing. Run npm run build:offline first.');app.quit();return}
 server=http.createServer(serve);
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(41753,'127.0.0.1',resolve)});
 // Keep a stable local origin so IndexedDB documents survive restarts.
 const port=server.address().port;
 const base='http://127.0.0.1:'+port;
 window=new BrowserWindow({width:1250,height:850,minWidth:730,minHeight:540,title:'PDF.ATHAT',backgroundColor:'#f8faf9',webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,devTools:false,preload:path.join(__dirname,'preload.cjs')}});
 window.setMenuBarVisibility(false);
 window.webContents.setWindowOpenHandler(({url})=>{if(url.startsWith('blob:'+base+'/'))return {action:'allow',overrideBrowserWindowOptions:{autoHideMenuBar:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}}};return {action:'deny'}});
 window.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(base+'/'))event.preventDefault()});
 window.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
 window.loadURL(base+'/');
}
if(hasLock)app.whenReady().then(createWindow).catch(error=>{dialog.showErrorBox('PDF.ATHAT',String(error.message||error));app.quit()});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{server?.close()});
