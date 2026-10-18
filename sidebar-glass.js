/* Local display preference only; all existing navigation/authorization handlers remain. */
(function(){
 'use strict';
 const sidebar=document.querySelector('.sidebar');
 const menu=sidebar?.querySelector('.sidebar-menu');
 if(!menu||sidebar.querySelector('.sidebar-fold'))return;
 const key='siyue.sidebar.collapsed.v1';
 const header=document.createElement('div');header.className='sidebar-glass-header';
 const brand=sidebar.querySelector('.brand');sidebar.insertBefore(header,sidebar.firstChild);
 if(brand)header.append(brand);
 const toggle=document.createElement('button');toggle.type='button';toggle.className='sidebar-fold';
 toggle.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16m7-12-4 4 4 4"/></svg>';
 header.append(toggle);if(!menu.id)menu.id='sidebar-feature-menu';toggle.setAttribute('aria-controls',menu.id);
 for(const item of menu.querySelectorAll(':scope > .nav-level-1')){
  const label=item.querySelector('.nav-group-label')?.textContent.trim()||item.querySelector('span')?.textContent.trim();
  if(label){item.setAttribute('aria-label',label);item.title=label;}
 }
 function setCollapsed(on){
  sidebar.classList.toggle('is-collapsed',on);toggle.setAttribute('aria-expanded',String(!on));
  toggle.setAttribute('aria-label',on?'展开侧栏':'折叠侧栏');toggle.title=on?'展开侧栏':'折叠侧栏';
  try{localStorage.setItem(key,on?'1':'0')}catch(_){}
 }
 let initial=false;try{initial=localStorage.getItem(key)==='1'}catch(_){}const narrow=matchMedia('(max-width:760px)');setCollapsed(narrow.matches||initial);
 narrow.addEventListener('change',event=>setCollapsed(event.matches));
 toggle.addEventListener('click',()=>setCollapsed(!sidebar.classList.contains('is-collapsed')));
 menu.addEventListener('click',event=>{
  if(narrow.matches&&event.target.closest('[data-page]'))setCollapsed(true);
  const item=event.target.closest('[data-nav-toggle]');
  if(!item||item.parentElement!==menu||!sidebar.classList.contains('is-collapsed'))return;
  event.preventDefault();event.stopImmediatePropagation();setCollapsed(false);
  if(item.getAttribute('aria-expanded')!=='true')item.click();
 },true);
})();
