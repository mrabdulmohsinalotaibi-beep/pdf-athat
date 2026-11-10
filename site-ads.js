// Site-managed messages. No tracking or access to files. Shown only in the library.
(()=>{
 const library=document.getElementById('libraryPage');
 const hero=library?.querySelector('.library-hero-modern');
 if(!hero)return;
 const wrap=document.createElement('section');wrap.className='site-ads';wrap.setAttribute('aria-label','إعلانات الموقع');
 hero.insertAdjacentElement('afterend',wrap);
 let timers=[];
 function clear(){timers.forEach(clearTimeout);timers=[];wrap.replaceChildren()}
 async function refresh(){
  try{
   const result=await fetch('/api/ads',{credentials:'same-origin',cache:'no-store'});
   if(!result.ok)return;
   const data=await result.json();
   clear();
   for(const ad of (data.ads||[]).slice(0,3)){
    const dismissKey='pdf-athat-ad-dismissed:'+ad.id;
    if(sessionStorage.getItem(dismissKey))continue;
    const card=document.createElement('article');card.className='site-ad-card';
    const details=document.createElement('div');details.className='site-ad-details';
    const tag=document.createElement('span');tag.className='site-ad-label';tag.textContent='إعلان';
    const title=document.createElement('strong');title.textContent=ad.title;
    details.append(tag,title);
    if(ad.body){const paragraph=document.createElement('p');paragraph.textContent=ad.body;details.append(paragraph)}
    const actions=document.createElement('div');actions.className='site-ad-actions';
    if(ad.link_url&&/^https:\/\//i.test(ad.link_url)){const link=document.createElement('a');link.href=ad.link_url;link.target='_blank';link.rel='noopener noreferrer sponsored';link.textContent='التفاصيل';actions.append(link)}
    const close=document.createElement('button');close.type='button';close.textContent='إخفاء';close.setAttribute('aria-label','إخفاء الإعلان');close.onclick=()=>{sessionStorage.setItem(dismissKey,'yes');card.remove()};actions.append(close);
    card.append(details,actions);wrap.append(card);
    const duration=Number(ad.duration_seconds);
    if(Number.isFinite(duration)&&duration>0)timers.push(setTimeout(()=>{sessionStorage.setItem(dismissKey,'yes');card.remove()},Math.min(3600,duration)*1000));
   }
  }catch(e){console.warn('site_ads_network',e?.name)}
 }
 refresh();
 window.addEventListener('online',refresh);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refresh()});
 setInterval(()=>{if(document.visibilityState==='visible')refresh()},60000);
})();
