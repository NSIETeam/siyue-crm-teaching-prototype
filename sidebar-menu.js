/* Navigation presentation only. Authorization remains in the existing page guards. */
(function () {
 'use strict';
 const sidebar=document.querySelector('.sidebar'),menu=sidebar?.querySelector('.sidebar-menu');
 if(!menu)return;
 const buttons=[...menu.querySelectorAll('[data-nav-toggle]')],items=[...menu.querySelectorAll('.menu-item[data-page]')];
 const aliases={leadManage:'myLeads',leadTodo:'myLeads',courseForm:'course',classForm:'classes',studentDetail:'students',rescheduleRequests:'teacherCourses',learningActive:'teacherStudents',learningHistory:'studentArchives',crmCustomerDetail:'crmCustomers',marketingFormBuilder:'marketingForms',marketingFormSubmissions:'marketingForms',marketingFormPreview:'marketingForms',productDetail:'mallShelf'};
 const resourcePages={leads:'myLeads',customers:'crmCustomers',campaigns:'crmCampaigns',touchpoints:'crmCampaigns',consultations:'crmReception',crmTasks:'crmTasks',crmTaskBatches:'crmTasks',opportunities:'crmOpportunities',serviceTickets:'crmServices',attributionRequests:'crmAttribution',importBatches:'crmImports',routingRules:'crmRouting',routingQueue:'crmRouting',formSubmissions:'formSubmissions',trialBookings:'myLeads',leadReclaimRequests:'myLeads',orders:'orders',receipts:'orders',refunds:'financeRefunds',enrollments:'students'};
 let selectedPage=null,route=null,queued=false;
 function panel(button){return document.getElementById(button.getAttribute('aria-controls'))}
 function expanded(button,on){const content=panel(button);if(!content)return;if(button.getAttribute('aria-expanded')!==String(on))button.setAttribute('aria-expanded',String(on));if(content.hidden===on)content.hidden=!on;}
 function close(button){expanded(button,false);for(const child of panel(button)?.querySelectorAll('[data-nav-toggle]')||[])expanded(child,false)}
 function open(button){for(const sibling of buttons)if(sibling!==button&&sibling.parentElement===button.parentElement)close(sibling);expanded(button,true)}
 function path(item){const result=[];for(let node=item?.parentElement;node&&node!==menu;node=node.parentElement)if(node.classList.contains('nav-children')){const button=buttons.find(b=>b.getAttribute('aria-controls')===node.id);if(button)result.unshift(button)}return result}
 function classFlag(element,name,on){if(element.classList.contains(name)!==on)element.classList.toggle(name,on)}
 function resolve(){let page=state.page;if(page==='studentDetail'&&selectedPage==='teacherStudents')return 'teacherStudents';if(page==='leadDetail')page=typeof leadState!=='undefined'?leadState.returnPage:'myLeads';if(page==='crmQueue'){const resource=window.SiyueBusinessCRM?.snapshot?.().queueQuery?.resource;page=resourcePages[resource]||selectedPage;}page=aliases[page]||page;return items.some(item=>item.dataset.page===page&&!item.hidden)?page:selectedPage}
 function sync(){
  let page=resolve();const changed=state.page!==route||page!==selectedPage;
  let selected=items.find(item=>item.dataset.page===page&&!item.hidden);
  if(!selected){page=null;selectedPage=null;}else selectedPage=page;
  const parents=path(selected);
  for(const button of buttons)classFlag(button,'active-parent',parents.includes(button));
  for(const item of items){const active=item===selected;classFlag(item,'active',active);if(active){if(item.getAttribute('aria-current')!=='page')item.setAttribute('aria-current','page')}else if(item.hasAttribute('aria-current'))item.removeAttribute('aria-current')}
  if(changed){if(page==='home')for(const button of buttons)close(button);else if(selected)for(const button of parents)open(button);route=state.page;}
 }
 for(const button of buttons)button.addEventListener('click',()=>{if(button.getAttribute('aria-expanded')==='true')close(button);else open(button)});
 function schedule(){if(queued)return;queued=true;queueMicrotask(()=>{queued=false;sync()})}
 // Existing business and account renderers update navigation directly as well as through render().
 if(typeof MutationObserver==='function')new MutationObserver(schedule).observe(menu,{subtree:true,attributes:true,attributeFilter:['class','hidden']});
 const previousRender=render;render=function(...args){const result=previousRender(...args);sync();return result};
 const previousNav=nav;nav=function(...args){const result=previousNav(...args);sync();return result};
 window.SiyueNavigation={sync,collapseAll(){for(const button of buttons)close(button)}};
 sync();
})();
