'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const source=fs.readFileSync(path.resolve(__dirname,'../dist/app-v2.js'),'utf8');
const result=spawnSync(process.execPath,['--check','--input-type=module'],{input:source,encoding:'utf8'});
if(result.status!==0){process.stderr.write(result.stderr||'Module syntax validation failed\n');process.exit(result.status||1)}
console.log('PASS: browser module syntax checked without shell-specific redirection');
