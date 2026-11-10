// Website-only optional admin navigation. Never grants permissions on the client.
(()=>{const actions=document.querySelector('.header-actions');if(!actions)return;
 const wrap=document.createElement('div');wrap.className='site-admin-menu';
 const button=document.createElement('button');button.hidden=true;button.type='button';button.className='icon-btn';button.textContent='⋮';button.title='قائمة الموقع';button.setAttribute('aria-label','قائمة الموقع');button.setAttribute('aria-expanded','false');
 const menu=document.createElement('div');menu.className='site-admin-dropdown';menu.hidden=true;
 const link=document.createElement('a');link.href='./admin.html';link.textContent='لوحة مدير النظام';link.hidden=true;menu.append(link);
 wrap.append(button,menu);actions.prepend(wrap);
 const close=()=>{menu.hidden=true;button.setAttribute('aria-expanded','false')};
 button.addEventListener('click',()=>{menu.hidden=!menu.hidden;button.setAttribute('aria-expanded',String(!menu.hidden))});
 document.addEventListener('click',event=>{if(!wrap.contains(event.target))close()});
 fetch('/api/auth/session',{credentials:'same-origin',cache:'no-store'}).then(r=>r.ok?r.json():null).then(data=>{link.hidden=data?.user?.role!=='admin';button.hidden=link.hidden}).catch(()=>{});
 const css=document.createElement('style');css.textContent='.site-admin-menu{position:relative}.site-admin-dropdown{position:absolute;z-index:2000;inset-inline-end:0;top:calc(100% + 8px);min-width:190px;border:1px solid var(--line,#b9a58c);border-radius:12px;background:var(--panel,#efe3d4);padding:8px;box-shadow:0 8px 25px #0002}.site-admin-dropdown[hidden]{display:none}.site-admin-dropdown a{display:block;padding:9px 12px;color:var(--green,#780000);text-decoration:none;font-size:14px;white-space:nowrap}';document.head.append(css);
})();
