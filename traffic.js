// First-party coarse analytics; no cookies, document names or browsing histories.
(()=>{
 const path=location.pathname;
 const page=path==='/'||path.endsWith('/index.html')?'home':
   path.endsWith('/account.html')?'account':path.endsWith('/admin.html')?'admin':null;
 if(!page||navigator.doNotTrack==='1'||navigator.globalPrivacyControl===true)return;
 try{
  fetch('/api/traffic/visit',{
   method:'POST',credentials:'omit',keepalive:true,cache:'no-store',
   headers:{'Content-Type':'application/json'},body:JSON.stringify({page})
  }).catch(()=>{});
 }catch{}
})();
