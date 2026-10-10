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
  document.querySelector('#command-picker')?.remove();leadDetail(index,permissionState.identity==='sales'?'myLeads':'leadManage');
  if(action==='transfer')workflowTransferLead();else if(action==='release')workflowReleaseLead();else{leadState.modal=action==='assign'?'assign':'follow';leadRender()}
 }else{if(!workflowGuard('academic')||!permissionCanVisit('schedule'))return;document.querySelector('#command-picker')?.remove();nav('schedule');workflowOpenSession(index);workflowSessionAction(action)}
}
const commandWorkflows=[
 ['为学生报名','报名 报课 新生报名 缴费报名 办理报名','enroll','enroll',commandEnroll],
 ['临时调课／调班','临时调课 临时调班 调课 调班 换班 单次调班','schedule','academic',()=>commandPick('session','move'),'选择课次，再调整该节学生的班级'],
 ['转课／转班','转课 转班 长期调班 正式调班','transfer','transfer',()=>commandFlow('transfer')],
 ['安排代课老师','代课 换老师 替课 老师请假','schedule','academic',()=>commandPick('session','substitute')],
 ['为学生退课','退课 退班 退费 退款','withdraw','withdraw',()=>commandFlow('withdraw')],
 ['办理补费','补费 补缴 补交学费','supplement','supplement',()=>commandFlow('supplement')],
 ['课次点名／考勤','点名 考勤 签到 课消','schedule','academic',()=>commandPick('session','attendance')],
 ['填写授课记录','授课记录 课堂记录 课后记录','schedule','academic',()=>commandPick('session','record')],
 ['新建线索','新建线索 创建线索 登记线索 线索登记 录入客户','quickRegister','lead',()=>{leadState.modal='form';leadState.formMode='create';nav('quickRegister')}],
 ['转移线索','转移线索 转交线索 转交客户 转移客户 改负责人 改派线索','myLeads','lead',()=>commandPick('lead','transfer'),'选择线索，再指定接收同事'],
 ['分配线索','分配线索 线索分配 派发线索 分配客户','leadManage','assign',()=>commandPick('lead','assign')],
 ['释放线索到公海','释放线索 释放公海 放弃保留 退回公海 回收线索','myLeads','lead',()=>commandPick('lead','release')],
 ['添加线索跟进','跟进线索 客户跟进 沟通记录 下次跟进','myLeads','lead',()=>commandPick('lead','follow')],
 ['创建课程','新建课程 创建课程 添加课程','course','course',()=>{a.selectedClass=null;nav('courseForm')}],
 ['创建班级','建班 新建班级 创建班级 开班','classes','classes',()=>{a.selectedClass=null;nav('classForm')}],
 ['录入新学生','新生录入 添加学生 新建学生','students','academic',()=>{a.modal='newStudent';nav('students')}],
 ['创建优惠策略','创建优惠 优惠策略 营销策略 优惠券','mallCoupon','mallCoupon',()=>nav('mallCoupon')],
 ['创建员工','创建员工 新增员工 添加员工','staff','staff',()=>{nav('staff');state.mode='form';state.staffEdit=null;render()}]
].map(([label,words,page,guard,run,hint])=>({label,words:words.split(' '),page,guard,run,hint}));
function commandScore(q,label,words){const terms=[label,...words].map(x=>x.toLowerCase());if(terms.includes(q))return 100;if(terms.some(x=>x.startsWith(q)))return 80;if(terms.some(x=>x.includes(q)))return 60;if(terms.some(x=>x.length>=2&&q.includes(x)))return 40;return 0}
workflowSearchEntries=function(query){const q=String(query||'').trim().toLowerCase().replace(/\s+/g,'');if(!q)return [];
 const registry=[...commandWorkflows,...permissionGroups.flatMap(group=>group.items.map(([page,label])=>({label:`打开${label}`,words:[label],page,run:()=>nav(page),hint:group.name})))];
 const commands=registry.filter(x=>permissionCanVisit(x.page)&&(!x.guard||workflowMay(x.guard))).map((x,i)=>({x,i,score:commandScore(q,x.label,x.words)})).filter(x=>x.score).sort((a,b)=>b.score-a.score||a.i-b.i).map(({x})=>({label:x.label,meta:`快捷操作 · ${x.hint||'打开办理页面'}`,action:()=>{if(permissionCanVisit(x.page)&&(!x.guard||workflowMay(x.guard)))x.run();else toast('当前身份没有此操作权限')}}));
 const records=commandEntitySearch(query).filter(x=>x.meta!=='快捷操作');
 return [...commands,...records].slice(0,20);
};
const commandSearchInput=document.querySelector('#global-action-search');if(commandSearchInput)commandSearchInput.placeholder='搜索线索、学员、课程，或查找办理操作';
