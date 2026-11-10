const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'../account.js'),'utf8');
const html=fs.readFileSync(path.resolve(__dirname,'../account.html'),'utf8');
function fixture(user){
 const fields=new Map();
 const redirects=[];
 const requests=[];
 const node=id=>{
  if(!fields.has(id))fields.set(id,{
   id,hidden:false,textContent:'',disabled:false,onclick:null,value:'',
   style:{},children:[],elements:{email:{value:''}},
   append(...items){this.children.push(...items)},
   addEventListener(name,handler){this[name+'Handler']=handler},
   querySelector(){return {disabled:false}}
  });
  return fields.get(id);
 };
 const tabs=['login','signup','recover'].map(tab=>({dataset:{tab},setAttribute(){},onclick:null}));
 const doc={
  getElementById:node,
  querySelectorAll(){return tabs},
  createElement(name){const el=node('generated-'+name+'-'+fields.size);el.tagName=name;return el}
 };
 const fetch=async(url,options={})=>{
  requests.push({url,method:options.method||'GET'});
  if(url==='/api/auth/session')return {ok:true,async json(){return {user}}};
  if(url==='/api/auth/logout')return {ok:true,async json(){return {ok:true}}};
  throw Error('Unexpected request: '+url);
 };
 const sandbox={
  document:doc,fetch,location:{replace(value){redirects.push(value)}},
  indexedDB:{databases:async()=>[]},
  localStorage:{getItem(){return null}},
  console,FormData:class {},Promise
 };
 vm.runInNewContext(source,sandbox,{filename:'account.js'});
 const settle=async()=>{await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve))};
 return {node,redirects,requests,settle};
}
test('signed-in ordinary user gets personal account page, not login or redirect',async()=>{
 const user={id:'user-id-01',username:'reader5',email:'reader@example.com',role:'user'};
 const f=fixture(user);await f.settle();
 assert.equal(f.redirects.length,0);
 assert.equal(f.node('authPane').hidden,true);
 assert.equal(f.node('profilePane').hidden,false);
 assert.equal(f.node('profileUsername').textContent,'reader5');
 assert.equal(f.node('profileEmail').textContent,'reader@example.com');
 assert.equal(f.node('accountRole').textContent,'مستخدم');
 assert.equal(f.node('profileAdminLink').hidden,true);
 assert.equal(f.node('profileFiles').textContent,0);
 assert.equal(f.node('profileNotes').textContent,0);
});
test('signed-in admin has account page and separate admin link without redirect',async()=>{
 const user={id:'admin-id-01',username:'adminuser',email:'administrator@example.com',role:'admin'};
 const f=fixture(user);await f.settle();
 assert.equal(f.redirects.length,0);
 assert.equal(f.node('authPane').hidden,true);
 assert.equal(f.node('profilePane').hidden,false);
 assert.equal(f.node('accountRole').textContent,'مدير النظام');
 assert.equal(f.node('profileAdminLink').hidden,false);
});
test('guest sees shared login instead of a blank profile',async()=>{
 const f=fixture(null);await f.settle();
 assert.equal(f.redirects.length,0);
 assert.equal(f.node('authPane').hidden,false);
 assert.equal(f.node('profilePane').hidden,true);
});
test('profile logout calls authenticated endpoint and returns to login without touching local files',async()=>{
 const user={id:'user-id-01',username:'reader5',email:'reader@example.com',role:'user'};
 const f=fixture(user);await f.settle();
 await f.node('profileLogout').onclick();
 assert.ok(f.requests.some(r=>r.url==='/api/auth/logout'&&r.method==='POST'));
 assert.equal(f.node('authPane').hidden,false);
 assert.equal(f.node('profilePane').hidden,true);
 assert.equal(f.redirects.length,0);
 assert.doesNotMatch(source,/indexedDB\.deleteDatabase/);
});
test('profile uses authenticated session and account-scoped local database; no password displayed',()=>{
 assert.match(source,/fetch\('\/api\/auth\/session'/);
 assert.match(source,/pdf-athat-account-/);
 assert.match(source,/showProfile\(data\.user\)/);
 assert.doesNotMatch(source,/if\(d\?\.user\)forward\(d\.user\)/);
 assert.match(html,/id="profilePane"/);
 assert.match(html,/id="profileEmail"/);
 assert.match(html,/id="profileAdminLink"/);
});
