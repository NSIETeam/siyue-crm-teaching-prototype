/* One searchable registry for workflows and all permitted navigation pages. */
const commandEntitySearch=workflowSearchEntries;
function commandEnroll(){a.enrollStep=1;a.selectedClass=null;a.selectedStudent=null;a.enrollmentDraft=null;nav('enroll')}
function commandFlow(page){a.modal=null;a.selectedStudent=null;a.selectedClass=null;nav(page)}
function commandPick(kind,action){
 const lead=kind==='lead',guard=lead?(action==='assign'?'assign':'lead'):'academic';
 if(!workflowGuard(guard)||!lead&&!permissionCanVisit('schedule'))return;
 const title=lead?'选择要处理的线索':'选择要处理的课次';
 const rows=lead?leadState.leads.map((l,i)=>({label:l.name,meta:`${l.owner} · ${l.stage}`,i})).filter(x=>workflowCanReadLead(leadState.leads[x.i])&&workflowMay(guard,leadState.leads[x.i])):a.classes.map((c,i)=>({label:c.name,meta:`${c.date} ${c.time} · ${c.teacher} · ${c.campus}`,i}));
 document.querySelector('#command-picker')?.remove();
 document.body.insertAdjacentHTML('beforeend',`<div class="modal-backdrop" id="command-picker"><div class="modal"><div class="modal-head"><h2>${title}</h2><button class="btn small" onclick="document.querySelector('#command-picker').remove()">关闭</button></div><input class="input" aria-label="筛选办理对象" placeholder="输入姓名、班级或老师筛选" oninput="commandFilter(this.value)"><div class="command-options">${rows.map(x=>`<button class="global-result" data-command-option onclick="commandChoose('${kind}','${action}',${x.i})"><strong>${esc(x.label)}</strong><small>${esc(x.meta)}</small></button>`).join('')||'<p class="empty">暂无可处理的记录</p>'}</div></div></div>`);
}
function commandFilter(value){document.querySelectorAll('[data-command-option]').forEach(el=>{el.hidden=!el.textContent.toLowerCase().includes(value.trim().toLowerCase())})}
function commandChoose(kind,action,index){
 if(kind==='lead'){
  const lead=leadState.leads[index],guard=action==='assign'?'assign':'lead';if(!lead||!workflowCanReadLead(lead)||!workflowGuard(guard,lead))return;
  document.querySelector('#command-picker')?.remove();leadDetail(index,'myLeads');
  if(action==='transfer')workflowTransferLead();else if(action==='release')workflowReleaseLead();else{leadState.modal=action==='assign'?'assign':'follow';leadRender()}
 }else{if(!workflowGuard('academic')||!permissionCanVisit('schedule'))return;document.querySelector('#command-picker')?.remove();nav('schedule');workflowOpenSession(index);workflowSessionAction(action)}
}
const commandWorkflows=[
 ['为学生报名','报名 报课 新生报名 缴费报名 办理报名','enroll','enroll',commandEnroll],
 ['临时调课／调班','临时调课 临时调班 调课 调班 换班 单次调班','tempMove','academic',()=>commandFlow('tempMove'),'选择学生与原课次，再选择符合条件的目标课次'],
 ['转课／转班','转课 转班 长期调班 正式调班','transfer','transfer',()=>commandFlow('transfer')],
 ['安排代课老师','代课 换老师 替课 老师请假','schedule','academic',()=>commandPick('session','substitute')],
 ['为学生退课','退课 退班 退费 退款','withdraw','withdraw',()=>commandFlow('withdraw')],
 ['办理补费','补费 补缴 补交学费','supplement','supplement',()=>commandFlow('supplement')],
 ['课次点名／考勤','点名 考勤 签到 课消','schedule','academic',()=>commandPick('session','attendance')],
 ['填写授课记录','授课记录 课堂记录 课后记录','schedule','academic',()=>commandPick('session','record')],
 ['新建线索','新建线索 创建线索 登记线索 线索登记 录入客户','quickRegister','lead',()=>{leadState.modal='form';leadState.formMode='create';nav('quickRegister')}],
 ['转移线索','转移线索 转交线索 转交客户 转移客户 改负责人 改派线索','myLeads','lead',()=>commandPick('lead','transfer'),'选择线索，再指定接收同事'],
 ['分配线索','分配线索 线索分配 派发线索 分配客户','myLeads','assign',()=>commandPick('lead','assign')],
 ['释放线索到公海','释放线索 释放公海 放弃保留 退回公海 回收线索','myLeads','lead',()=>commandPick('lead','release')],
 ['添加线索跟进','跟进线索 客户跟进 沟通记录 下次跟进','myLeads','lead',()=>commandPick('lead','follow')],
 ['创建课程','新建课程 创建课程 添加课程','course','course',()=>{a.selectedClass=null;nav('courseForm')}],
 ['创建班级','建班 新建班级 创建班级 开班','classes','classes',()=>{a.selectedClass=null;nav('classForm')}],
 ['录入新学生','新生录入 添加学生 新建学生','students','academic',()=>{a.modal='newStudent';nav('students')}],
 ['创建优惠策略','创建优惠 优惠策略 营销策略 优惠券','mallCoupon','mallCoupon',()=>nav('mallCoupon')],
 ['创建员工','创建员工 新增员工 添加员工','staff','staff',()=>{nav('staff');state.mode='form';state.staffEdit=null;render()}]
].map(([label,words,page,guard,run,hint])=>({...(label==='临时调课／调班'?{id:'action.schedule.39f66947'}:{}),label,words:words.split(' '),page,guard,run,hint}));
function commandScore(q,label,words){const terms=[label,...words].map(x=>x.toLowerCase());if(terms.includes(q))return 100;if(terms.some(x=>x.startsWith(q)))return 80;if(terms.some(x=>x.includes(q)))return 60;if(terms.some(x=>x.length>=2&&q.includes(x)))return 40;return 0}
workflowSearchEntries=function(query){const q=String(query||'').trim().toLowerCase().replace(/\s+/g,'');if(!q)return [];
 const registry=[...commandWorkflows,...permissionGroups.flatMap(group=>group.items.map(([page,label])=>({label:`打开${label}`,words:[label],page,run:()=>nav(page),hint:group.name})))];
 const commands=registry.filter(x=>permissionCanVisit(x.page)&&(!x.guard||workflowMay(x.guard))).map((x,i)=>({x,i,score:commandScore(q,x.label,x.words)})).filter(x=>x.score).sort((a,b)=>b.score-a.score||a.i-b.i).map(({x})=>({label:x.label,meta:`快捷操作 · ${x.hint||'打开办理页面'}`,action:()=>{if(permissionCanVisit(x.page)&&(!x.guard||workflowMay(x.guard)))x.run();else toast('当前身份没有此操作权限')}}));
 const records=commandEntitySearch(query).filter(x=>x.meta!=='快捷操作');
 return [...commands,...records].slice(0,20);
};
const commandSearchInput=document.querySelector('#global-action-search');if(commandSearchInput)commandSearchInput.placeholder='使用搜索功能快速找到操作';

/* Search the current authenticated operation catalog. Search opens a workspace or form; it never commits. */
(function(root){
 'use strict';
 if(root.SIYUE_JAVA_AUTH_MODE)return;
 const normalize=v=>String(v??'').normalize('NFKC').toLowerCase().replace(/[\s\/／、·，,。！!？?：:（）()\-]+/g,'');
 const groups={course:'课程与排课',class:'课程与排课',student:'学员管理',enrollment:'报名与转退班',session:'课次与考勤',makeup:'调班与补课',order:'收款与退款',refund:'收款与退款',marketing:'获客与商城',commerce:'获客与商城',settings:'系统设置',archives:'档案管理',crm:'客户与线索',scrm:'客户与线索',trial:'试听接待'};
 const special={
  'class.schedule':{label:'班级排课',words:'排课 课程排期 周期排课 每周排课 批量排课 排课表',page:'classes',hint:'先选班级，再设置讲次、日期、教师和教室'},
  'class.batchCreate':{words:'批量建班 批量开班'},
  'class.relocate':{words:'班级搬迁 批量转校区 换校区'},
  'session.move':{label:'整班调课',words:'调课 调整课次时间 改上课时间 更改上课日期 整班改期',hint:'先选原课次，再调整日期与时间；保留冲突检查'},
  'session.substitute':{words:'代课 替课 换老师 更换教师'},
  'session.record':{words:'授课记录 课堂记录 课后记录'},
  'session.attendance':{label:'课次点名与考勤',words:'点名 签到 考勤 出勤 迟到 旷课',page:'attendance',hint:'先选课次，再核对当节名册与考勤'},
  'session.attendance.exceptions':{words:'异常考勤 请假 缺勤 漏点名',page:'teacherCourses',hint:'从本人课次登记当天异常'},
  'session.reschedule.request':{words:'申请调课 教师调课 调课申请',page:'teacherCourses',hint:'先选本人课次，再填写调课原因'},
  'session.reschedule.review':{words:'调课审批 审批调课 审核调课',page:'rescheduleApprovals'},
  'enrollment.create':{words:'报名 报课 续班 续费 续报 插班 新生报名 老生报名'},
  'enrollment.batchCreate':{words:'批量报名 批量续班'},
  'enrollment.transfer':{label:'永久转班',words:'转班 转课 正式调班 长期换班 永久换班',hint:'核对在读课程、目标班进度、余位和费用'},
  'enrollment.batchTransfer':{words:'批量转班 批量调班'},
  'enrollment.withdraw':{words:'退课 退班 退费申请',hint:'先核对在读课程与退课报价，再预览确认'},
  'enrollment.cancel':{words:'取消报名 取消未付款订单'},
  'order.confirmReceipt':{words:'收款 确认到账 补费 补缴 补交学费 线下收费'},
  'order.paymentLink':{words:'在线缴费 支付链接 收款链接'},
  'refund.approve':{words:'退款审批 审核退费'},
  'refund.submit':{words:'退款 退费 线下退款'},
  'lead.create':{words:'线索登记 新建线索 录入线索 咨询登记'},
  'lead.followup':{words:'销售跟进 沟通记录 回访 高意向 中意向 低意向',page:'myLeads',hint:'先选本人线索，再记录沟通与意向'},
  'lead.update':{page:'myLeads'},
  'lead.status.update':{words:'冷宫 不报名 已流失 销售状态',page:'myLeads',hint:'在线索跟进页填写结果与原因'},
  'lead.policy.update':{words:'线索保留与回收策略设置 保留策略 回收策略'},
  'lead.import':{words:'导入线索 批量导入 Excel导入',page:'myLeads',hint:'在线索页使用导入并核对预览'},
  'lead.batch.assign':{words:'批量分配线索 批量改派',page:'myLeads'},
  'lead.batch.release':{words:'批量释放公海',page:'myLeads'},
  'lead.reclaim.request':{label:'超时线索申请',words:'取回线索 超时线索申请',page:'myLeads'},
  'lead.reclaim.review':{page:'crmQueue',queue:{resource:'leadReclaimRequests',scope:'team',queue:'pending'}},
  'customer.fromLead':{page:'myLeads'},
  'customer.update':{page:'crmCustomers'},
  'customer.merge':{page:'crmCustomers'},
  'crm.import.commit':{words:'导入客户 导入获客触点',page:'crmImports'},
  'crm.view.save':{page:'myLeads'},
  'crm.view.archive':{page:'crmQueue',queue:{resource:'savedCrmViews',scope:'mine',queue:'all'}},
  'trial.request':{label:'预约试听',words:'试听 试听预约 安排试听 体验课',page:'myLeads',hint:'先选本人线索，再选校区、课程、日期与课次'},
  'trial.review':{label:'复核满员试听申请',words:'试听审批 满员试听 试听申请 教务复核',page:'crmReception',hint:'进入授权校区待复核申请'},
  'trial.cancel':{words:'取消试听 取消体验课',page:'crmReception'},
  'form.create':{words:'新建表单 创建报名表 获客表单'},
  'form.update':{page:'marketingForms'},'form.publish':{page:'marketingForms'},'form.unpublish':{page:'marketingForms'},'form.submit':{page:'marketingForms'},
  'form.submission.annotate':{page:'formSubmissions'},'form.submission.review':{words:'表单审核 提交审核',page:'formSubmissions'},
  'store.design.save':{page:'mallDecor'},'store.design.publish':{page:'mallDecor'},
  'settings.update':{words:'系统配置 收款设置',page:'system'},'dictionary.update':{page:'teaching'},
  'staff.profile.update':{page:'staffArchives'},
  'promotion.update':{page:'mallCoupon'},'promotion.publish':{page:'mallCoupon'},'promotion.unpublish':{page:'mallCoupon'},
  'commerce.checkout.accept':{page:'orders'},'commerce.checkout.confirmReceipt':{page:'orders'},'commerce.checkout.cancel':{page:'orders'},'commerce.checkout.paymentLink':{page:'orders'},
  'student.communicate':{words:'学生沟通 家校沟通 学情反馈'},
  'crm.taskBatch.create':{words:'营销任务 服务任务 批量派单 批量任务',page:'crmTasks'},'crm.task.update':{page:'crmTasks'},'crm.task.complete':{page:'crmTasks'},
  'campaign.create':{words:'新建活动 线下活动 获客活动'},'campaign.update':{page:'crmCampaigns'},'campaign.linkForm':{page:'crmCampaigns'},'campaign.publish':{page:'crmCampaigns'},'campaign.close':{page:'crmCampaigns'},'campaign.promotionLink.create':{page:'crmCampaigns'},
  'serviceTicket.followup':{page:'crmServices'},'serviceTicket.transfer':{page:'crmServices'},'serviceTicket.close':{page:'crmServices'},
  'order.attribution.review':{page:'crmAttribution'},
 };
 const pageWords={home:'工作台 我的工作',myLeads:'线索管理 今日待办 公海 待分配 跟进中 已成单 冷宫',crmReception:'今日试听 试听预约 前台接待',classes:'班级管理 班级排课',schedule:'课表 教师课表 班级课表 教室课表 校区课表',teacherCourses:'我的课程 我的课表',attendance:'考勤记录 出勤查询',financeConsumption:'课消 消课 扣课时 课时核对 课消记录',financeArrears:'欠费 待收款',marketingForms:'表单管理 营销表单 活动课报名 活动报名表 报名表',students:'学员管理 学生管理 学生档案',learningActive:'在读课程 在读学生',learningHistory:'历史学员 历史学生',transfer:'永久转班',tempMove:'临时调班 单次调班',makeup:'补课管理',orders:'订单 收费订单',financeRefunds:'退款记录 退费记录',crmAttribution:'业绩归因 归因纠错',crmReports:'经营报表 经营分析',salesMetrics:'销售统计 转化率',teacherMetrics:'教师统计 教师课时',campus:'校区 教室 座位 容量',teaching:'教学配置 年级 学科 学期 班型',staff:'账号管理 员工账号 账号权限 员工管理 初始密码 重置密码 停用员工 离职交接',positions:'职位管理 岗位管理',permissions:'权限管理 角色权限 岗位权限',permissionLogs:'操作日志 审计日志',accountSettings:'我的账号 修改密码 个人设置'};
 pageWords.studentArchives='学生归档 归档学生 恢复学生 历史学籍';pageWords.teacherArchives='老师归档 教师归档 恢复教师';pageWords.staffArchives='员工业务档案 员工归档';
 const excludedPages=new Set(['leadTodo','leadManage','quickEnroll','leadDetail','studentDetail','crmCustomerDetail','crmQueue','crmOpportunities','rescheduleRequests','learningData']);
 function score(query,label,words){
  const q=normalize(query),terms=[label,...words].map(normalize).filter(Boolean);if(!q)return 1;
  if(terms[0]===q)return 120;if(terms.includes(q))return 110;
  if(terms.some(t=>t.startsWith(q)))return 90;if(terms.some(t=>t.includes(q)))return 75;
  if(terms.some(t=>t.length>=2&&q.includes(t)))return 55;
  const bits=String(query).trim().split(/[\s，,、]+/).map(normalize).filter(Boolean);return bits.length>1&&bits.every(b=>terms.some(t=>t.includes(b)))?65:0;
 }
 function build(ctx){
  const actor=ctx.actor,valid=actor&&!actor.disabled&&!actor.mustChangePassword;if(!valid)return [];
  const identity=actor.id+':'+actor.version,live=()=>{const u=ctx.current();return u&&!u.disabled&&!u.mustChangePassword&&u.id+':'+u.version===identity;};
  const entries=[],seen=new Set();
  function add(entry,guard,run){if(seen.has(entry.id)||!guard())return;seen.add(entry.id);entries.push({...entry,action(){if(!live()||!guard())return ctx.denied();return run();}});}
  for(const op of ctx.operations||[]){
   const id=op.id,config=special[id]||{};
   if(id==='trial.migrateAutomatic'||id.startsWith('opportunity.')||id==='crm.communication.send'&&Object.values(ctx.capabilities?.communicationProviders||{}).length>0&&Object.values(ctx.capabilities.communicationProviders).every(v=>v===false)||id.endsWith('paymentLink')&&ctx.capabilities?.paymentProvider===false)continue;
   const guard=()=>ctx.permitted(op)&&(id!=='lead.policy.update'||ctx.current()?.scope?.type==='all')&&(id!=='trial.review'||ctx.current()?.roleIds?.some(r=>['academic','superadmin'].includes(r)));
   const page=config.page;
   if(page&&!ctx.canVisit(page))continue;
   const variants=id==='makeup.assign'?[{label:'安排缺勤补课',words:'补课 缺勤补课 请假补课 旷课补课',seed:{kind:'makeup'},hint:'选择缺勤讲次，再安排符合条件的目标课次'},{label:'学员临时调班',words:'临时调班 临时转班 单次换班 学员调课',seed:{kind:'temporary'},hint:'只调整选定讲次，原班其余课次不变'}]:[{label:config.label||op.label,words:config.words||'',seed:{},hint:config.hint}];
   for(const [index,variant]of variants.entries())add({id:'operation:'+id+(variants.length>1?':'+index:''),operationId:id,label:variant.label,words:[op.label,op.label.replace(/创建/g,'新建'),op.label.replace(/更新/g,'修改'),id,...op.aliases||[],...variant.words.split(' ')],group:groups[id.split('.')[0]]||groups[op.group]||'业务办理',kind:'办理',hint:variant.hint||(page?'先在列表选择办理对象':'打开办理表单，核对后预览确认')},guard,()=>ctx.run(op,{...config,...variant,page}));
  }
  for(const [page,info]of Object.entries(ctx.pages||{})){
   if(excludedPages.has(page))continue;
   const label=Array.isArray(info)?info[0]:info.title||info;
   add({id:'page:'+page,label,words:(pageWords[page]||'').split(' '),group:'功能页面',kind:'页面',hint:page==='financeConsumption'?'核对考勤、已确认课消和剩余课时':'打开'+label},()=>ctx.canVisit(page),()=>ctx.navigate(page));
  }
  for(const [page,label]of [['staff','员工账号与权限'],['positions','职位管理'],['permissions','角色权限'],['permissionLogs','操作日志'],['accountSettings','设置与账号']]){
   const admin=['staff','positions','permissions'].includes(page),guard=()=>ctx.canVisit(page)&&(!admin||ctx.current()?.roleIds?.includes('superadmin'));
   add({id:'page:'+page,label,words:(pageWords[page]||'').split(' '),group:page==='accountSettings'?'个人账号':'系统管理',kind:'页面',hint:'打开'+label},guard,()=>ctx.account(page));
  }
  return entries;
 }
 let context;
 function search(query,ctx){
  context=ctx;const all=build(ctx);if(['*','全部功能','全部操作','所有操作'].includes(query))return all.map((e,i)=>({...e,score:1,order:i}));
  const matches=all.map((e,i)=>{const match=score(query,e.label,[...e.words,e.group,...(['course','class','session','makeup','enrollment'].includes(e.operationId?.split('.')[0])?['教务']:[])]);return {...e,score:match?match+(e.kind==='办理'?15:0):0,order:i}}).filter(e=>e.score);
  const popular=['operation:lead.create','operation:enrollment.create','operation:class.schedule','operation:trial.request','operation:session.attendance','page:financeConsumption','page:myLeads','page:schedule'];
  if(!String(query).trim())for(const row of matches){const index=popular.indexOf(row.id);row.score=index<0?1:30-index;}
  matches.sort((a,b)=>b.score-a.score||(a.kind===b.kind?0:a.kind==='办理'?-1:1)||a.order-b.order);
  return matches;
 }
 let selected=0,visible=20,last='',results=[],input,box;
 const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function clear(){results=[];last='';selected=0;if(box){box.hidden=true;box.innerHTML='';}if(input){input.value='';input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');}}
 function hide(){if(box)box.hidden=true;if(input){input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');}}
 function choose(index){const row=results[index];if(!row)return;hide();input.value='';return row.action();}
 function paint(){
  if(!box||!input)return;
  const shown=results.slice(0,visible);selected=Math.min(Math.max(0,selected),Math.max(0,shown.length-1));
  box.hidden=false;input.setAttribute('aria-expanded','true');
  box.innerHTML=`<div class="operation-search-summary">${last?'找到 '+results.length+' 项':'可用功能 '+results.length+' 项'}<button type="button" data-operation-all>全部功能</button><span>↑↓ 选择 · Enter 打开 · Esc 关闭</span></div>`+(shown.length?shown.map((row,i)=>`<button type="button" role="option" aria-selected="${i===selected}" id="operation-search-option-${i}" data-operation-result="${i}" class="global-result operation-search-result ${i===selected?'is-selected':''}"><span><strong>${escape(row.label)}</strong><small>${escape(row.hint||'打开授权记录')}</small></span><span class="operation-search-category">${escape(row.kind||row.meta||'记录')} · ${escape(row.group||'授权数据')}</span></button>`).join(''):'<div class="global-empty" role="status">未找到当前账号可用的操作，请尝试“排课”“临时调班”“点名”或“课消”。</div>')+(results.length>visible?'<button type="button" class="operation-search-more" data-operation-more>显示更多（还有 '+(results.length-visible)+' 项）</button>':'');
  for(const button of box.querySelectorAll('[data-operation-result]'))button.onclick=()=>choose(Number(button.dataset.operationResult));
  const allButton=box.querySelector('[data-operation-all]');if(allButton)allButton.onclick=event=>{event?.stopPropagation?.();input.value='全部功能';render('全部功能');};
  const more=box.querySelector('[data-operation-more]');if(more)more.onclick=event=>{event?.stopPropagation?.();visible+=20;paint();};
  if(shown.length)input.setAttribute('aria-activedescendant','operation-search-option-'+selected);else input.removeAttribute('aria-activedescendant');
 }
 function render(query){install();if(!input||!box)return;const q=String(query||'');last=q;visible=20;selected=0;results=typeof workflowSearchEntries==='function'?workflowSearchEntries(q):[];paint();}
 function install(){
  const el=document.querySelector('#global-action-search'),panel=document.querySelector('#global-action-results');if(!el||!panel||el===input)return;
  input=el;box=panel;input.placeholder='搜索操作、页面，例如：排课、临时调班、课消';input.setAttribute('aria-label','搜索可用操作与页面');input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls','global-action-results');input.setAttribute('aria-expanded','false');input.setAttribute('autocomplete','off');box.setAttribute('role','listbox');
  input.addEventListener('input',()=>render(input.value),true);
  input.addEventListener('focus',()=>render(input.value));
  input.addEventListener('keydown',event=>{if(event.isComposing||event.keyCode===229)return;if(['ArrowDown','ArrowUp','Enter','Escape'].includes(event.key)){event.stopImmediatePropagation();if(event.key==='Escape'){event.preventDefault();hide();return;}if(box.hidden){if(event.key!=='Enter')render(input.value);else return;}if(event.key==='Enter'){event.preventDefault();choose(selected);return;}event.preventDefault();selected=Math.max(0,Math.min(Math.min(results.length,visible)-1,selected+(event.key==='ArrowDown'?1:-1)));paint();box.querySelector('[aria-selected="true"]')?.scrollIntoView?.({block:'nearest'});}},true);
  document.addEventListener('click',event=>{if(!input.contains(event.target)&&!box.contains(event.target))hide();});
  document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();input.focus();input.select();}});
 }
 function launch(id){if(!context)return;const entry=build(context).find(row=>row.id===id);if(entry)return entry.action();return context.denied();}
 function guide(ctx){context=ctx;const rows=build(ctx),byId=id=>rows.find(row=>row.id===id),page=ctx.page;
  if(!['classes','schedule','teacherCourses','attendance','tempMove','transfer','makeup','financeConsumption'].includes(page))return '';
  const steps={classes:'先选班级，设置讲次与课表，再核对教师、教室和时间冲突。',schedule:'整班改期调整课次时间；学员单次换班使用临时调班，长期换班使用永久转班。',teacherCourses:'先选本人课次，再登记考勤、授课记录或申请调课。',attendance:'先选课次、核对名册，再记录出勤和异常；课消按已确认考勤与原规则核对。',tempMove:'临时调班只调整选定讲次，核对目标课次进度、余位和学员冲突。',transfer:'永久转班先核对在读课程、目标班进度、余位和费用，再预览确认。',makeup:'从缺勤讲次安排补课，核对目标讲次、余位和冲突，保留原考勤记录。',financeConsumption:'核对学员、课次、考勤结果和课消记录；差异回到原课次按授权办理。'};
  const ids=['operation:class.schedule','operation:session.move','operation:makeup.assign:1','operation:enrollment.transfer','operation:makeup.assign:0','operation:session.attendance','page:financeConsumption'];
  return '<section class="card pad academic-task-guide" aria-label="教务办理导航"><nav aria-label="教务办理入口">'+ids.map(byId).filter(Boolean).map(row=>'<button type="button" class="btn small" onclick="SiyueOperationSearch.launch(\''+escape(row.id)+'\')">'+escape(row.label)+'</button>').join('')+'</nav><p>'+escape(steps[page])+'</p></section>';
 }
 root.SiyueOperationSearch={build,search,score,special,install,render,clear,guide,launch};
 if(typeof document!=='undefined'&&typeof document.createElement==='function'){
  const style=document.createElement('style');style.textContent='.academic-task-guide{margin-bottom:16px}.academic-task-guide nav{display:flex;flex-wrap:wrap;gap:8px}.academic-task-guide p{margin:12px 0 0;font-size:13px;color:#71839c;line-height:1.6}.operation-search-summary{display:flex;justify-content:space-between;gap:12px;padding:10px 12px;color:#71839c;font-size:12px}.operation-search-summary span{font-size:11px}.operation-search-summary button{background:none;border:0;color:#315deb;cursor:pointer}.operation-search-result{align-items:center;min-height:62px}.operation-search-result>span:first-child{display:grid;gap:4px;min-width:0}.operation-search-result strong{font-size:14px}.operation-search-result small{font-size:12px;line-height:1.5}.operation-search-category{flex-shrink:0;font-size:11px;color:#71839c}.operation-search-result.is-selected{background:#edf3ff;outline:1px solid #b9cbfb;outline-offset:-1px}.operation-search-more{display:block;width:100%;padding:12px;border:0;background:#f5f8fd;color:#315deb;cursor:pointer}.global-action-results{max-height:min(70vh,560px)}@media(max-width:700px){.operation-search-summary span{display:none}.operation-search-category{max-width:90px;white-space:normal}.global-action-results{position:fixed;left:12px;right:12px;top:110px}}';document.head?.appendChild(style);
  const prior=typeof workflowInstallSearch==='function'?workflowInstallSearch:null;
  if(prior)workflowInstallSearch=function(...args){const result=prior.apply(this,args);install();return result;};
  workflowSearch=render;install();
 }
})(window);
