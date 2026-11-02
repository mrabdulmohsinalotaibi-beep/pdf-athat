'use strict';
const {app,BrowserWindow,shell,dialog}=require('electron');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {randomBytes}=require('node:crypto');
let server,window;
const root=path.join(__dirname,'dist');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json','.webmanifest':'application/manifest+json','.wasm':'application/wasm','.bcmap':'application/octet-stream','.bin':'application/octet-stream','.ttf':'font/ttf','.otf':'font/otf','.woff':'font/woff','.woff2':'font/woff2','.pdf':'application/pdf'};
function serve(req,res){
 try{
  const u=new URL(req.url,'http://localhost');const pathname=decodeURIComponent(u.pathname);
  if(pathname.includes('\\')||pathname.split('/').includes('..')){res.writeHead(403);return res.end()}
  let target=path.resolve(root,'.'+pathname);
  if(!target.startsWith(root+path.sep)&&target!==root){res.writeHead(403);return res.end()}
  if(fs.existsSync(target)&&fs.statSync(target).isDirectory())target=path.join(target,'index.html');
  fs.createReadStream(target).on('error',()=>{if(!res.headersSent)res.writeHead(404);res.end('Not found')}).pipe(res);
  res.setHeader('Content-Type',mime[path.extname(target)]||'application/octet-stream');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'self' blob: data:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-src 'self' blob:;");
 }catch{res.writeHead(400);res.end('Bad request')}
}
async function createWindow(){
 if(!fs.existsSync(path.join(root,'index.html'))){dialog.showErrorBox('PDF.ATHAT','Offline assets missing. Run npm run build:offline first.');app.quit();return}
 server=http.createServer(serve);
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(41753,'127.0.0.1',resolve)});
 // Keep a stable local origin so IndexedDB documents survive restarts.
 const port=server.address().port;
 const base='http://127.0.0.1:'+port;
 window=new BrowserWindow({width:1250,height:850,minWidth:730,minHeight:540,title:'PDF.ATHAT',backgroundColor:'#f8faf9',webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,devTools:false}});
 window.setMenuBarVisibility(false);
 window.webContents.setWindowOpenHandler(({url})=>{if(/^https?:/.test(url))shell.openExternal(url);return {action:'deny'}});
 window.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(base+'/'))event.preventDefault()});
 window.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
 window.loadURL(base+'/');
}
app.whenReady().then(createWindow);
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{server?.close()});
