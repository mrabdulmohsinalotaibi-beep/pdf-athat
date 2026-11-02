'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('athatDesktop',Object.freeze({
 saveFile:(name,bytes,kind)=>ipcRenderer.invoke('athat:save-file',{name,bytes,kind})
}));
