'use strict';
const fs=require('node:fs'),path=require('node:path');
// Apply only to the Pages website. The desktop build stays fully offline.
exports.injectAuth=({html,root,dist,version})=>{
 const entry='<script type="module" src="./app-v2.js?v='+version+'"></script>';
 if(!html.includes(entry)||!html.includes('<div id="app">'))throw Error('Website authentication entry point missing');
 for(const name of ['auth.js','auth.css'])fs.copyFileSync(path.join(root,'web',name),path.join(dist,name));
 html=html.replace('</head>','<link rel="stylesheet" href="./auth.css?v='+version+'"></head>');
 html=html.replace('<div id="app">',fs.readFileSync(path.join(root,'web/auth.html'),'utf8')+'\n<div id="app" hidden inert>');
 return html.replace(entry,'<script type="module" src="./auth.js?v='+version+'" data-app-module="./app-v2.js?v='+version+'"></script>');
};
