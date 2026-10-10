/* Presentation-only navigation. History never contains business records or authorization grants. */
const workspaceUI={picker:null,sessionAction:null,sessionClassId:null,sessionStudentId:null,leadAction:null,productId:null,journalId:null};
const workspaceHistory={stack:[],current:null,identity:permissionState.identity,restoring:false,depth:0,pendingBack:false};
const workspacePageNames={batchFlow:'批量办理',commandPicker:'选择办理对象',objectPicker:'选择资料',sessionFlow:'课次办理',leadAction:'线索办理',productDetail:'商品详情',journalDetail:'操作记录详情'};
const workspacePermissionBase=permissionCanVisit;
permissionCanVisit=function(page){
 if(page==='leadDetail')return workspacePermissionBase(page)&&!!leadState.leads[leadState.selected]&&workflowCanReadLead(leadState.leads[leadState.selected]);
 if(page==='batchFlow')return !!batchUI&&batchAllowed(batchUI.kind);
 if(page==='sessionFlow')return workspacePermissionBase('schedule');
 if(page==='leadAction')return !!leadState.leads[leadState.selected]&&workflowCanReadLead(leadState.leads[leadState.selected])&&workflowMay('lead',leadState.leads[leadState.selected]);
 if(page==='journalDetail')return journalAllowed();
 if(page==='productDetail')return workspacePermissionBase('mallShelf')||workspacePermissionBase('course');
 if(page==='commandPicker')return workspaceUI.picker?.kind==='lead'?workflowMay(workspaceUI.picker.action==='assign'?'assign':'lead'):workspacePermissionBase('schedule')&&workflowMay('academic');
 if(page==='objectPicker'){const kind=workspaceUI.picker?.kind,page={course:'course',classes:'classes',student:'studentArchives',staff:'staff'}[kind];return !!page&&workspacePermissionBase(page)&&(kind==='student'||workflowMay(page))}
 return workspacePermissionBase(page);
};
function workspaceLeadKey(x){return (x.leadId||x.id)?'id:'+(x.leadId||x.id):'legacy:'+JSON.stringify([x.name,x.phone,x.source,x.registeredBy,x.createdAt])}
function workspaceClone(x){return x===undefined?null:JSON.parse(JSON.stringify(x))}
function workspacePick(object,keys){return Object.fromEntries(keys.map(k=>[k,workspaceClone(object[k])]))}
function workspaceCapture(){return {
 page:state.page,mode:state.mode,staffKey:state.staff[state.staffEdit]?profileQuickStaffKey(state.staff[state.staffEdit]):null,campusEdit:state.campusEdit,
 leadId:leadState.leads[leadState.selected]?workspaceLeadKey(leadState.leads[leadState.selected]):null,courseId:state.page==='courseForm'?a.courses[a.selectedClass]?.id??null:null,
 studentId:a.students[a.selectedStudent]?.id??null,classId:a.classes[a.selectedClass]?.id??null,
 academic:workspacePick(a,['modal','filter','enrollStep','enrollmentDraft','enrollingLeadId']),
 lead:workspacePick(leadState,['selected','returnPage','modal','formMode','mineTab','manageTab','manageFilters']),
 workflow:workspacePick(workflowState,['scheduleView','campus','teacher','student','course','from','to','range','refundClass','withdrawDraft','selectedSession']),
 mall:workspacePick(mallState,['shelfTab','decorTab','formType','formStep','draft','picked','picker']),
 permission:workspacePick(permissionState,['positionMode','positionEdit','selected']),
 shortcut:workspaceClone(shortcutFilter),batch:workspaceClone(batchUI),profile:workspaceClone(profileQuickState),
 profilePage:typeof profileQuickPageState==='undefined'?null:workspaceClone(profileQuickPageState),finance:workspaceClone(financeQuickState),
 ui:workspaceClone(workspaceUI),journal:workspaceClone(journalUI),scroll:window.scrollY||0,fields:workspaceFields()
}}
function workspaceFields(){return [...document.querySelectorAll('#view input,#view select,#view textarea')].map((el,index)=>({el,index})).filter(({el})=>!['password','file','checkbox','radio'].includes(el.type)).map(({el,index})=>({id:el.id||null,index,value:el.value}))}
function workspaceKey(s){return JSON.stringify([s.page,s.mode,s.academic.modal,s.lead.modal,s.mall.picker,s.permission.positionMode,
 s.page==='studentDetail'?s.studentId:null,s.page==='leadDetail'?s.lead.selected:null,
 s.page==='batchFlow'?[s.batch?.kind,!!s.batch?.plan]:null,s.page==='profileAction'?s.profilePage:null,
 s.page==='financePayment'?[s.finance.orderId,s.finance.mode]:null,
 Object.hasOwn(workspacePageNames,s.page)?s.ui:null])}
function workspaceRemember(){const c=workspaceHistory.current;if(c&&workspaceKey(c)===workspaceKey(workspaceCapture()))workspaceHistory.current=workspaceCapture()}
function workspaceObserve(){
 if(workspaceHistory.identity!==permissionState.identity){workspaceHistory.identity=permissionState.identity;workspaceHistory.stack=[];workspaceHistory.current=null;workspaceHistory.pendingBack=false}
 const next=workspaceCapture(),prior=workspaceHistory.current;
 if(!workspaceHistory.restoring&&prior&&workspaceKey(prior)!==workspaceKey(next)){
  const last=workspaceHistory.stack.at(-1);
  // Closing a subform, or returning to its list, consumes the matching entry instead of creating a loop.
  if(last&&prior.page===next.page&&workspaceKey(last)===workspaceKey(next))workspaceHistory.stack.pop();
  else{workspaceHistory.stack.push(prior);if(workspaceHistory.stack.length>60)workspaceHistory.stack.shift()}
 }
 workspaceHistory.current=next;workspaceBackButton();workspaceEnhanceRows();workspaceInlineLegacy();
}
function workspaceBackButton(){const b=$('#workspace-back');if(!b)return;b.disabled=!workspaceHistory.stack.length;b.title=b.disabled?'已在起始页面':'返回上一页';b.setAttribute('aria-label',b.title)}
function workspaceApply(s){
 state.page=s.page;state.mode=s.mode;state.staffEdit=s.staffKey===null?null:state.staff.findIndex(x=>profileQuickStaffKey(x)===s.staffKey);if(state.staffEdit<0){state.staffEdit=null;if(state.page==='staff')state.mode='list'}state.campusEdit=s.campusEdit;
 Object.assign(a,s.academic);a.selectedStudent=s.studentId===null?null:a.students.findIndex(x=>x.id===s.studentId);if(a.selectedStudent<0)a.selectedStudent=null;
 a.selectedClass=s.classId===null?null:a.classes.findIndex(x=>x.id===s.classId);if(a.selectedClass<0)a.selectedClass=null;if(s.page==='courseForm'){a.selectedClass=s.courseId===null?null:a.courses.findIndex(x=>x.id===s.courseId);if(a.selectedClass<0){a.selectedClass=null;state.page='course'}}
 Object.assign(leadState,s.lead);if(s.leadId!==null){leadState.selected=leadState.leads.filter(x=>workspaceLeadKey(x)===s.leadId).length===1?leadState.leads.findIndex(x=>workspaceLeadKey(x)===s.leadId):-1;if(leadState.selected<0){leadState.modal=null;workspaceUI.leadAction=null;if(['leadDetail','leadAction'].includes(state.page))state.page='myLeads'}}Object.assign(workflowState,s.workflow);Object.assign(mallState,s.mall);
 Object.assign(permissionState,s.permission);if(!permissionState.dirty)permissionState.working=new Set(permissionRole(permissionState.selected)?.grants||[]);
 Object.assign(shortcutFilter,s.shortcut);batchUI=workspaceClone(s.batch);
 Object.assign(profileQuickState,s.profile);if(s.profilePage&&typeof profileQuickPageState!=='undefined')Object.assign(profileQuickPageState,s.profilePage);
 Object.assign(financeQuickState,s.finance);Object.assign(workspaceUI,s.ui);Object.assign(journalUI,s.journal);
}
function workspaceBack(){
 if(!workspaceHistory.stack.length)return;
 if(permissionState.dirty&&permissionState.currentPage==='permissions'){
  workspaceHistory.pendingBack=true;permissionState.modal='unsaved';permissionState.pendingPage=null;permissionRender();return;
 }
 workspaceRemember();workspaceHistory.restoring=true;
 try{let target;while(workspaceHistory.stack.length){target=workspaceHistory.stack.pop();workspaceApply(target);if(permissionCanVisit(state.page))break;target=null}
  if(!target){state.page='home';a.modal=null;leadState.modal=null;mallState.picker=false}
  render();
  if(target){for(const f of target.fields||[]){const el=f.id?document.getElementById(f.id):document.querySelectorAll('#view input,#view select,#view textarea')[f.index];if(el){el.value=f.value;const handler=el.getAttribute?.('oninput')||'';if(handler.includes('filterRows('))filterRows(f.value);else if(handler.includes('commandFilter('))commandFilter(f.value);else if(handler.includes('batchFilter('))batchFilter(f.value)}}window.scrollTo?.(0,target.scroll||0)}
  workspaceHistory.current=workspaceCapture();workspaceBackButton();
 }finally{workspaceHistory.restoring=false}
}
const workspaceResolveBase=permissionResolve;
permissionResolve=function(action){const pending=workspaceHistory.pendingBack;const result=workspaceResolveBase(action);if(pending&&action==='cancel')workspaceHistory.pendingBack=false;else if(pending&&!permissionState.dirty){workspaceHistory.pendingBack=false;workspaceBack()}return result};

// Legacy forms remain on their original route, but occupy the content area without a backdrop.
for(const name of ['modalPage','leadModalPage','mallPickerPage']){
 const original=globalThis[name];globalThis[name]=function(...args){return original(...args).replace('class="modal-backdrop"','class="workspace-form-page"').replace(/class="modal(?=[ "])/,'class="card pad workspace-form')};
}
function workspaceInlineLegacy(){const view=$('#view'),form=view?.querySelector?.('.workspace-form-page');if(!form)return;for(const el of view.children||[])el.hidden=el!==form;const title=form.querySelector('h2')?.textContent;if(title)$('#crumb').textContent+=' / '+title}

// Existing table actions become one adjacent action row. Selection controls keep their original behavior.
function workspaceEnhanceRows(){
 if(['batchFlow','profileAction','financePayment','permissions','sessionFlow','journalDetail'].includes(state.page)||a.modal||leadState.modal||mallState.picker)return;
 for(const row of document.querySelectorAll('#view .table tbody tr')){
  if(row.dataset.workspaceEnhanced||row.matches?.('.profile-action-row,.profile-quick-inline,.finance-action-row,.finance-quick-inline,.finance-inline-row,.workspace-action-row')||row.getAttribute('role')==='button')continue;
  if(row.querySelector('input,select,textarea'))continue;
  const actions=[...new Map([...row.querySelectorAll('a[onclick],button[onclick]')].map(action=>[action.getAttribute('onclick'),action])).values()];if(!actions.length)continue;
  row.dataset.workspaceEnhanced='true';row.tabIndex=0;row.setAttribute('aria-expanded','false');row.classList.add('workspace-record-row');
  const expand=event=>{if(event.type==='keydown'&&!['Enter',' '].includes(event.key))return;event.preventDefault();event.stopPropagation();
   const next=row.nextElementSibling,open=next?.classList.contains('workspace-action-row');document.querySelectorAll('.workspace-action-row').forEach(x=>x.remove());document.querySelectorAll('.workspace-record-row').forEach(x=>x.setAttribute('aria-expanded','false'));if(open)return;
   const tr=document.createElement('tr');tr.className='workspace-action-row';const td=document.createElement('td');td.colSpan=row.cells.length;const bar=document.createElement('div');bar.className='workspace-action-buttons';
   for(const action of actions){const b=document.createElement('button');b.type='button';b.className='btn small';b.innerHTML=action.innerHTML;b.setAttribute('onclick',action.getAttribute('onclick'));bar.append(b)}
   td.append(bar);tr.append(td);row.after(tr);row.setAttribute('aria-expanded','true');
  };row.addEventListener('click',expand,true);row.addEventListener('keydown',expand,true);
 }
}

function workspacePickerPage(){const p=workspaceUI.picker;if(!p)return '<div class="empty">请重新选择操作。</div>';let rows,title;
 if(state.page==='commandPicker'){
  const lead=p.kind==='lead',guard=p.action==='assign'?'assign':'lead';title=lead?'选择要处理的线索':'选择要处理的课次';
  rows=(lead?leadState.leads.map((x,i)=>({label:x.name,meta:`${x.owner} · ${x.stage}`,i})).filter(x=>workflowCanReadLead(leadState.leads[x.i])&&workflowMay(guard,leadState.leads[x.i])):a.classes.map((x,i)=>({label:x.name,meta:`${x.date} ${x.time} · ${x.teacher}`,i}))).map(x=>`<button class="global-result" data-command-option onclick="commandChoose('${p.kind}','${p.action}',${x.i})"><strong>${esc(x.label)}</strong><small>${esc(x.meta)}</small></button>`).join('');
 }else{
  const [label,records]={course:['课程',a.courses],classes:['班级',a.classes],student:['学生',a.students],staff:['员工',state.staff]}[p.kind];title='选择'+label;
  rows=records.map((x,i)=>`<button class="global-result" data-command-option onclick="siyueChooseEntity('${p.kind}',${i})"><strong>${esc(x.name)}</strong><small>${esc(x.id||x.campus||'')}</small></button>`).join('');
 }
 return `<section class="card pad"><div class="toolbar"><strong>${title}</strong></div><input class="input" aria-label="筛选办理对象" placeholder="输入名称查找" oninput="commandFilter(this.value)"><div class="command-options">${rows||'<div class="empty">暂无可办理记录</div>'}</div></section>`;
}
commandPick=function(kind,action){const guard=kind==='lead'?(action==='assign'?'assign':'lead'):'academic';if(!workflowGuard(guard)||kind!=='lead'&&!permissionCanVisit('schedule'))return;workspaceUI.picker={kind,action};nav('commandPicker')};
siyuePickEntity=function(kind){const page={course:'course',classes:'classes',student:'studentArchives',staff:'staff'}[kind];if(!page||!permissionCanVisit(page)||kind!=='student'&&!workflowMay(page))return;workspaceUI.picker={kind};nav('objectPicker')};
// Command selections already recheck permissions and use the shared business handlers.
const workspaceCommandChoose=commandChoose;
commandChoose=function(kind,action,index){if(kind!=='lead'){if(!workflowGuard('academic')||!permissionCanVisit('schedule'))return;workflowOpenSession(index);workflowSessionAction(action)}else return workspaceCommandChoose(kind,action,index)};

workflowOpenSession=function(classIndex,studentIndex=null){const c=a.classes[classIndex];if(!c||!permissionCanVisit('schedule'))return;workspaceUI.sessionClassId=c.id;workspaceUI.sessionStudentId=a.students[studentIndex]?.id||null;workspaceUI.sessionAction=null;workflowState.selectedSession={classIndex,studentIndex};nav('sessionFlow')};
const workspaceSessionAction=workflowSessionAction;
workflowSessionAction=function(action){if(!workflowGuard('academic')||!['attendance','move','substitute','record'].includes(action)||!workspaceSessionContext())return;workspaceUI.sessionAction=action;if(state.page!=='sessionFlow')nav('sessionFlow');else render()};
function workspaceSessionContext(){const index=a.classes.findIndex(c=>c.id===workspaceUI.sessionClassId);if(index<0)return null;const studentIndex=a.students.findIndex(s=>s.id===workspaceUI.sessionStudentId);workflowState.selectedSession={classIndex:index,studentIndex:studentIndex<0?null:studentIndex};return a.classes[index]}
function workspaceSessionPage(){const c=workspaceSessionContext();if(!c)return '<div class="card pad">该课次已不存在，请返回课表。</div>';const roster=workflowSessionRoster(c),course=a.courses.find(x=>x.id===c.courseId),lesson=course?.lessons?.find(x=>x.id===c.lessonId),actual=(c.sessions||[]).find(x=>x.sessionId===workflowSessionKey(c)&&x.substitute)?.substitute||c.teacher;return `<section class="card pad"><div class="toolbar"><strong>${esc(c.name)}</strong><span class="muted">${esc(c.date)} ${esc(c.time)}</span></div><p>${esc(lesson?.title||'授课内容待配置')} · 主讲 ${esc(c.teacher)} · 实际授课 ${esc(actual)}</p><p class="muted">本节名单：${roster.map(x=>esc(x.name)).join('、')||'暂无学生'}</p><div class="workspace-action-buttons">${workspaceActionButtons('session',a.classes.indexOf(c))}</div><div id="workflow-session-action"></div></section>`}
// The row's context is already selected when switching between actions on the session page.
function workspaceSessionSelect(action){workflowSessionAction(action)}
function workspaceActionButtons(kind,index){if(kind!=='session')return '';return [['attendance','点名'],['move','临时转班'],['substitute','安排代课'],['record','授课记录']].filter(()=>workflowMay('academic')).map(([key,label])=>`<button class="btn ${workspaceUI.sessionAction===key?'primary':''}" onclick="workspaceSessionSelect('${key}')">${label}</button>`).join('')||'<span class="muted">当前身份仅可查看</span>'};
workflowTransferLead=function(){const l=leadState.leads[leadState.selected];if(!l||!workflowCanReadLead(l)||!workflowGuard('lead',l))return;workspaceUI.leadAction='transfer';nav('leadAction')};
workflowReleaseLead=function(){const l=leadState.leads[leadState.selected];if(!l||!workflowCanReadLead(l)||!workflowGuard('lead',l))return;workspaceUI.leadAction='release';nav('leadAction')};
function workspaceLeadPage(){const l=leadState.leads[leadState.selected];if(!l)return '<div class="empty">线索不存在。</div>';const transfer=workspaceUI.leadAction==='transfer',eligible=leadEligibleStaff().filter(s=>s.name!==l.owner);return `<section class="card pad"><strong>${transfer?'转交线索':'释放到公海'} · ${esc(l.name)}</strong><p class="muted">来源 ${esc(l.source)} · 当前负责人 ${esc(l.owner)}</p>${transfer?`<label for="workflow-lead-owner">新负责人</label><select id="workflow-lead-owner" class="select">${eligible.map(x=>`<option>${esc(x.name)}</option>`).join('')}</select>`:'<p>确认后该线索进入待分配公海。</p>'}<div class="form-actions"><button class="btn primary" ${transfer&&!eligible.length?'disabled':''} onclick="workspaceLeadCommit()">${transfer?'确认转交':'确认释放'}</button></div></section>`}
function workspaceLeadCommit(){const l=leadState.leads[leadState.selected];if(!l||!workflowCanReadLead(l)||!workflowGuard('lead',l))return;const action=workspaceUI.leadAction;state.page='leadDetail';if(action==='transfer')workflowCommitTransfer();else workflowCommitRelease();render()}
mallProductDetail=function(i){const c=a.courses[i];if(!c)return;workspaceUI.productId=c.id;nav('productDetail')};
function workspaceProductPage(){const c=a.courses.find(x=>x.id===workspaceUI.productId);if(!c)return '<div class="empty">课程不存在。</div>';return `<section class="card pad"><strong>${esc(c.product?.title||c.name)}</strong><p>${esc(c.product?.summary||`${c.grade} · ${c.subject}`)}</p><p>适龄范围 ${esc(c.ageRange||c.grade)} · 价格 ¥${Number(c.product?.price??c.fee??1000).toFixed(2)}</p><h3>课程大纲</h3>${(c.lessons||[]).map((x,i)=>`<p>第 ${i+1} 讲：${esc(x.title)}</p>`).join('')||'<p class="muted">课程大纲待配置</p>'}</section>`}
// Each render family is wrapped because existing inline controls do not all call nav().
const workspaceRenderBase=render;
render=function(...args){
 if(permissionState.dirty&&permissionState.currentPage==='permissions'&&state.page!=='permissions'){permissionState.pendingPage=state.page;state.page='permissions';permissionState.modal='unsaved';permissionRender();return}
 if(!Object.hasOwn(workspacePageNames,state.page)||permissionState.dirty&&permissionState.currentPage==='permissions')return workspaceRenderBase(...args);
 if(!permissionCanVisit(state.page))return permissionDenied(state.page);
 permissionState.currentPage=state.page;$('#crumb').textContent=state.page==='batchFlow'?(batchNames[batchUI?.kind]||'批量办理'):workspacePageNames[state.page];
 $('#view').innerHTML=({batchFlow:batchPage,commandPicker:workspacePickerPage,objectPicker:workspacePickerPage,sessionFlow:workspaceSessionPage,leadAction:workspaceLeadPage,productDetail:workspaceProductPage,journalDetail:workspaceJournalPage})[state.page]();
 if(state.page==='sessionFlow'&&workspaceUI.sessionAction&&workspaceSessionContext()&&workflowMay('academic'))workspaceSessionAction(workspaceUI.sessionAction);
 permissionRefreshNavigation();
};
for(const name of ['render','academicRender','leadRender','shortcutRender','mallRender','structureRender','marketingFormRender','permissionRender','workflowHome']){
 const original=globalThis[name];globalThis[name]=function(...args){workspaceHistory.depth++;try{if(name!=='render'&&(Object.hasOwn(workspacePageNames,state.page)||['profileAction','financePayment'].includes(state.page)))return render(...args);return original(...args)}finally{if(--workspaceHistory.depth===0)workspaceObserve()}};
}
const workspaceNavBase=nav;
nav=function(page){workspaceRemember();return workspaceNavBase(page)};
document.addEventListener('click',workspaceRemember,true);
document.addEventListener('input',()=>{setTimeout(workspaceRemember,0)});
document.addEventListener('change',()=>{setTimeout(workspaceRemember,0)});
// Bulk entry controls reveal their next action locally; search/CLI can open the workflow directly.
function workspaceBatchEntry(kind,button){if(!batchAllowed(kind))return;const selector='[data-batch-entry]',old=document.querySelector(selector),same=old?.dataset.batchEntry===kind;old?.remove();if(same)return;const label={enroll:'选择学生并报名',create:'设置建班内容',transfer:'选择原班学生',campus:'选择待转班级'}[kind];const html=`<div class="workspace-batch-entry workspace-action-buttons" data-batch-entry="${kind}"><button class="btn small primary" onclick="batchOpen('${kind}')">${label}</button></div>`;const anchor=button.closest('.toolbar,.tabs')||button;anchor.insertAdjacentHTML('afterend',html)}
document.addEventListener('click',event=>{const button=event.target.closest?.('button,a');if(!button||button.closest('[data-batch-entry],.workspace-action-row'))return;const handler=button.getAttribute('onclick')||'',match=handler.match(/^batchOpen\(['"](enroll|create|transfer|campus)['"]\)/);const kind=match?.[1]||(/enrollTab\(['"]批量报名['"]\)/.test(handler)?'enroll':null);if(!kind)return;event.preventDefault();event.stopImmediatePropagation();workspaceBatchEntry(kind,button)},true);

const workspaceFilterRowsBase=filterRows;
filterRows=function(...args){const result=workspaceFilterRowsBase(...args);document.querySelectorAll('.workspace-action-row').forEach(row=>{const source=row.previousElementSibling;row.style.display=!source||source.hidden||source.style?.display==='none'?'none':''});return result};
