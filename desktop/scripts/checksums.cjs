'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const dir=path.resolve(__dirname,'../release');
if(!fs.existsSync(dir))throw Error('No release directory');
const files=fs.readdirSync(dir).filter(name=>{
 const file=path.join(dir,name);
 return fs.statSync(file).isFile()&&name!=='SHA256SUMS.txt'&&!name.endsWith('.blockmap');
}).sort();
if(!files.length)throw Error('No desktop installers to checksum');
const output=files.map(name=>{
 const hash=createHash('sha256');
 const buffer=fs.readFileSync(path.join(dir,name));
 hash.update(buffer);
 return hash.digest('hex')+'  '+name;
});
fs.writeFileSync(path.join(dir,'SHA256SUMS.txt'),output.join('\n')+'\n');
console.log('Created desktop SHA256SUMS.txt for '+files.length+' release files');
