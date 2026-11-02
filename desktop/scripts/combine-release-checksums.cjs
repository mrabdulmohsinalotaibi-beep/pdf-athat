'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const root=path.resolve(process.cwd(),'release-assets');
const assets=[];
for(const folder of fs.readdirSync(root)){
 const dir=path.join(root,folder);
 if(!fs.statSync(dir).isDirectory())continue;
 for(const name of fs.readdirSync(dir)){
  const file=path.join(dir,name);
  if(!fs.statSync(file).isFile()||name==='SHA256SUMS.txt'||name.endsWith('.blockmap'))continue;
  assets.push({name,file});
 }
}
if(!assets.length)throw Error('No packaged artifacts found');
const seen=new Set();
for(const asset of assets){if(seen.has(asset.name))throw Error('Duplicate release asset: '+asset.name);seen.add(asset.name)}
const manifest=assets.sort((a,b)=>a.name.localeCompare(b.name)).map(item=>
 createHash('sha256').update(fs.readFileSync(item.file)).digest('hex')+'  '+item.name
).join('\n')+'\n';
fs.writeFileSync(path.join(root,'SHA256SUMS.txt'),manifest);
console.log('Combined checksums for '+assets.length+' release assets');
