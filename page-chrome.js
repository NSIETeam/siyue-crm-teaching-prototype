/* Collapse duplicate page chrome only. Record titles, form labels and alerts are preserved. */
(function(){
 'use strict';
 const panel=document.getElementById('view'),tabs=document.getElementById('workspace-tabs');
 if(!panel||!tabs)return;
 const descriptions=new Map();
 const purposes={permissions:'配置岗位权限和员工单项授权，优先核对重要权限与数据范围。',permissionLogs:'按人员、操作类别、结果和日期检索日志，点击记录查看详情。',positions:'查看岗位职责、授权范围和在岗员工，为岗位分配现有员工或新建员工。',staff:'查找员工，按角色和状态筛选；点击员工行查看档案与账号操作。',home:'快捷办理、按紧急度安排今日工作；管理者查看授权范围仪表盘和最新操作。',myLeads:'查看本人线索，记录跟进；有管理权限时可切换团队范围、分配和导入线索。',leadManage:'查看授权范围内的线索，分配负责人并处理跟进。',leadTodo:'查看今日需要首次联系或回访的线索。',quickRegister:'登记新线索并跟进本人登记的客户。',crmCustomers:'查找客户档案，查看联系人、需求和业务记录。',crmCampaigns:'管理获客活动及参与记录。',crmTasks:'筛选并办理跟进任务，查看任务批次与截止时间。',crmOpportunities:'查看销售机会，跟进需求并推进销售阶段。',crmServices:'受理客户服务工单，跟踪处理进度和逾期事项。',crmAttribution:'查看与处理订单业绩归因申请。',crmImports:'查看名单导入记录和处理结果。',crmRouting:'管理转商与分配规则。',crmReception:'查看本校区今日试听及预约，核对学员、课次和销售负责人。',course:'管理课程资料、价格和关联班级。',classes:'管理班级、学员与授课安排。',students:'查看在读学生并按班级筛选，办理相关教务事项。',schedule:'查看和安排班级课程。',orders:'查询收费订单及收款状态。',campus:'管理校区、教室和关联班级。',teaching:'维护教学使用的基础配置。',marketingForms:'管理获客表单及收集内容。'};
 function updateScroll(strip){
  const row=strip.querySelector('.scrm-queue-tabs');if(!row)return;
  const max=row.scrollWidth-row.clientWidth;
  for(const button of strip.querySelectorAll('[data-status-scroll]')){
   const hidden=max<=1;if(button.hidden!==hidden)button.hidden=hidden;
   button.disabled=Number(button.dataset.statusScroll)<0?row.scrollLeft<=1:row.scrollLeft>=max-1;
  }
 }
 panel.addEventListener('click',event=>{
  const button=event.target.closest('[data-status-scroll]');if(!button)return;
  const row=button.parentElement.querySelector('.scrm-queue-tabs');
  row.scrollBy({left:Number(button.dataset.statusScroll)*row.clientWidth*.7,behavior:'smooth'});
 });
 panel.addEventListener('wheel',event=>{
  const row=event.target.closest('.scrm-queue-tabs');if(!row||event.ctrlKey)return;
  const delta=Math.abs(event.deltaX)>Math.abs(event.deltaY)?event.deltaX:event.deltaY;
  const amount=delta*(event.deltaMode===1?16:event.deltaMode===2?row.clientWidth:1);
  if((amount>0&&row.scrollLeft<row.scrollWidth-row.clientWidth-1)||(amount<0&&row.scrollLeft>1)){
   event.preventDefault();row.scrollLeft+=amount;
  }
 },{passive:false});
 panel.addEventListener('scroll',event=>{if(event.target.matches?.('.scrm-queue-tabs'))updateScroll(event.target.parentElement)},true);
 const scrollResize=new ResizeObserver(()=>panel.querySelectorAll('.scrm-status-strip').forEach(updateScroll));
 scrollResize.observe(panel);
 let queued=false;
 function sync(){
  queued=false;
  panel.querySelectorAll('.scrm-status-strip').forEach(updateScroll);
  const active=tabs.querySelector('.work-tab-label[aria-selected="true"]');
  if(!active)return;
  const key=active.getAttribute('data-work-tab')||'',page=typeof state!=='undefined'?state.page:'';
  const isList=key.startsWith('v1:page:')&&!['businessOperation','courseForm','classForm','enroll','quickEnroll','transfer','tempMove','withdraw','supplement'].includes(page)&&!panel.querySelector('.business-form,.workspace-form,.scrm-followup-workspace');
  let description=purposes[page]||descriptions.get(key)||'';
  if(isList){
   for(const heading of panel.querySelectorAll(':scope>.heading,:scope>.card>.heading')){
    const title=heading.querySelector('h1,h2');if(!title)continue;
    const subtitle=heading.querySelector('.subtitle');
    if(subtitle?.textContent.trim())description=subtitle.textContent.trim();
    title.classList.add('page-chrome-redundant');subtitle?.classList.add('page-chrome-redundant');
    if(!heading.querySelector('button,a,input,select,textarea'))heading.classList.add('page-chrome-empty');
   }
  }
  const duplicateTitles={crmReception:['前台接待'],attendance:['课程考勤'],crmReports:['CRM 经营报表'],learningData:['教学数据'],salesMetrics:['销售统计'],teacherMetrics:['教学数据统计'],permissionLogs:['操作日志']};
  if(isList)for(const toolbar of panel.querySelectorAll(':scope>.card>.toolbar')){
   for(const title of toolbar.querySelectorAll(':scope>strong,:scope>h2,:scope>div>strong'))if((duplicateTitles[page]||[]).includes(title.textContent.trim())){
    title.classList.add('page-chrome-redundant');
    const hint=title.parentElement===toolbar?null:title.parentElement.querySelector('.help,.muted');
    // Keep operational constraints such as attendance locking visible.
    if(hint&&page==='crmReception'){description=hint.textContent.trim();hint.classList.add('page-chrome-redundant')}
   }
   if(!toolbar.textContent.trim()&&!toolbar.querySelector('button,input,select'))toolbar.classList.add('page-chrome-empty');
  }
  if(description)descriptions.set(key,description);
  for(const tab of tabs.querySelectorAll('.work-tab-label')){
   const text=tab.querySelector('.work-tab-text')?.textContent||'',hint=descriptions.get(tab.getAttribute('data-work-tab'));
   const title=text+(tab.querySelector('.work-tab-dirty')?' · 未保存':'')+(hint?'\n'+hint:'');
   if(tab.title!==title)tab.title=title;
   if(hint&&tab.getAttribute('aria-description')!==hint)tab.setAttribute('aria-description',hint);
  }
 }
 function schedule(){if(!queued){queued=true;queueMicrotask(sync)}}
 const observer=new MutationObserver(schedule);observer.observe(panel,{childList:true,subtree:true,characterData:true});observer.observe(tabs,{childList:true,subtree:true});sync();
})();
