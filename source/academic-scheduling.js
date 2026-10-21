/* A class owns its roster; schedule entries own lesson dates and stable session keys. */
function academicClassIndex(c){return a.classes.findIndex(x=>x.id===c?.id)}
const academicLegacySessionKey=workflowSessionKey;
workflowSessionKey=function(c){return c?.scheduleKey||academicLegacySessionKey(c)};
function academicPlanView(c,p){return {...c,date:p.date,time:p.time,lessonId:p.lessonId,lessonVersion:p.lessonVersion,campus:p.campus??c.campus,room:p.room??c.room,scheduleId:p.id,scheduleKey:p.key,status:p.status||c.status,active:p.active??c.active,sessions:c.sessions||[]}}
function academicClassSessions(c){return c?.schedule?.length?c.schedule.map(p=>academicPlanView(c,p)):[c].filter(Boolean)}
function academicScheduledClasses(){return a.classes.flatMap((c,index)=>academicClassSessions(c).map(row=>({c:row,index,sessionId:row.scheduleId||''})))}
function academicSessionClass(index){const c=a.classes[index],id=workflowState.selectedSession?.scheduleId;if(!c)return null;return id?academicClassSessions(c).find(x=>x.scheduleId===id)||null:c.schedule?.length?academicPlanView(c,c.schedule[0]):c}
function academicSessionRef(c){return c.scheduleId?`${c.id}::${c.scheduleId}`:c.id}
function academicResolveSession(ref){return academicScheduledClasses().map(x=>x.c).find(c=>academicSessionRef(c)===ref)||a.classes.find(c=>c.id===ref)}
function academicSessionActive(c){return !!c&&!['已取消','已停用','已结课','已结束'].includes(c.status)&&c.active!==false}
function academicHasSessionRecord(c){const key=workflowSessionKey(c),ci=academicClassIndex(c);return a.attendance.some(r=>(r.sessionId===key||!r.sessionId&&r.classIndex===ci&&r.date===c.date)&&(['已考勤','已消课'].includes(r.status)||r.consumptionConfirmed||['到课','请假','旷课'].includes(r.attendance)))||(c.sessions||[]).some(r=>r.sessionId===key&&(r.record||r.substitute))||(a.sessionAdjustments||[]).some(r=>r.status==='已确认'&&(r.sourceSessionId===key||r.targetSessionId===key||!r.targetSessionId&&r.date===c.date&&[r.sourceClassId,r.targetClassId].includes(c.id)))}
const academicBatchOverlap= batchOverlap;
batchOverlap=function(x,y){return academicClassSessions(x).some(p=>academicSessionActive(p)&&academicClassSessions(y).some(q=>academicSessionActive(q)&&academicBatchOverlap(p,q)))};
// A projected session must not expand itself again when used by conflict checks.
const academicClassSessionsBase=academicClassSessions;
academicClassSessions=function(c){return c?.scheduleId?[c]:academicClassSessionsBase(c)};
const academicLegacyRoster=workflowSessionRoster;
workflowSessionRoster=function(c){if(!c)return [];const key=workflowSessionKey(c),base=a.students.filter(s=>c.studentIds?.includes(s.id)||s.classIds?.includes(c.id)||s.className===c.name).map(s=>s.id),moves=(a.sessionAdjustments||[]).filter(m=>m.status==='已确认');const from=m=>m.sourceClassId===c.id&&(m.sourceSessionId?m.sourceSessionId===key:m.date===c.date&&(!m.lessonId||m.lessonId===c.lessonId)),to=m=>m.targetClassId===c.id&&(m.targetSessionId?m.targetSessionId===key:m.date===c.date&&(!m.lessonId||m.lessonId===c.lessonId));return [...new Set([...base.filter(id=>!moves.some(m=>m.studentId===id&&from(m))),...moves.filter(to).map(m=>m.studentId)])].map(id=>a.students.find(s=>s.id===id)).filter(Boolean)};
let academicScheduleUI=null;
function academicScheduleAllowed(){return workflowMay('classes')&&permissionCanVisit('classes')}
function academicScheduleOpen(classId){if(!academicScheduleAllowed()){toast('当前身份没有排课权限');return}const c=a.classes.find(x=>x.id===classId);academicScheduleUI={classId:classId||'',rows:[],from:batchToday(),time:c?.time||'09:00–11:00',days:c?.date?[new Date(c.date+'T12:00:00').getDay()]:[6],preview:false};if(c)academicScheduleLoad(c);nav('classSchedule')}
function academicScheduleLoad(c){
 const course=batchCourse(c),existing=academicClassSessions(c);
 academicScheduleUI.classId=c.id;academicScheduleUI.from=c.date||batchToday();academicScheduleUI.time=c.time||'09:00–11:00';
 const weekday=new Date(academicScheduleUI.from+'T12:00:00').getDay();academicScheduleUI.days=[Number.isInteger(weekday)?weekday:6];
 academicScheduleUI.rows=(course?.lessons||[]).map(l=>{
  const current=existing.find(x=>x.lessonId===l.id),saved=(c.schedule||[]).find(x=>x.id===current?.scheduleId);
  return current?{...saved,id:current.scheduleId||auditId('SC'),key:workflowSessionKey(current),date:current.date,time:current.time,lessonId:l.id,lessonVersion:current.lessonVersion||course.curriculumVersion||course.version||1}:{id:auditId('SC'),key:'',date:'',time:c.time||'09:00–11:00',lessonId:l.id,lessonVersion:course.curriculumVersion||course.version||1};
 });
 academicScheduleUI.rows.forEach(p=>p.key=p.key||`${c.id}|SESSION|${p.id}`);
}
function academicScheduleSelect(value){const c=a.classes.find(x=>x.id===value);if(!c)return;academicScheduleLoad(c);academicScheduleUI.preview=false;render()}
function academicScheduleCapture(preservePreview=false){
 if(!academicScheduleUI)return;
 const draft=academicScheduleUI,before=JSON.stringify([draft.rows,draft.from,draft.time,draft.days]);
 for(const el of document.querySelectorAll('[data-plan-row]')){const r=draft.rows[Number(el.dataset.planRow)];if(r&&!el.disabled)r[el.dataset.planField]=el.value}
 const from=$('#plan-from'),time=$('#plan-time');if(from)draft.from=from.value;if(time)draft.time=time.value;
 const days=[...document.querySelectorAll('[data-plan-day]')];if(days.length)draft.days=days.filter(e=>e.checked).map(e=>Number(e.value));
 if(!preservePreview||before!==JSON.stringify([draft.rows,draft.from,draft.time,draft.days]))draft.preview=false;
}
function academicScheduleGenerate(){if(!academicScheduleAllowed())return;academicScheduleCapture();const d=academicScheduleUI,c=a.classes.find(x=>x.id===d?.classId);if(!c)return;const check=scTimeParts({date:d.from,time:d.time});if(!check.start||!d.days.length){toast('请选择有效的开始日期、上课时段和每周上课日');return}let cursor=new Date(d.from+'T12:00:00');const occupied=new Set(d.rows.filter(r=>r.date).map(r=>r.date));for(const row of d.rows){if(row.date)continue;let attempts=0;while((!d.days.includes(cursor.getDay())||occupied.has(academicLocalDate(cursor)))&&attempts++<740)cursor.setDate(cursor.getDate()+1);if(attempts>=740){toast('排期范围过长，请调整上课日');return}row.date=academicLocalDate(cursor);row.time=d.time;occupied.add(row.date);cursor.setDate(cursor.getDate()+1)}render()}
function academicLocalDate(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function academicScheduleCheck(c,rows){
 const errors=[],course=batchCourse(c),old=academicClassSessions(c),seen=new Set(),keys=new Set();
 if(!c||!course||course.active===false||!academicSessionActive(c))return ['班级或课程不可排课'];
 if(!rows.length)return ['请先为课程配置授课讲次'];
 if(Number(c.lessonVersion||1)!==Number(course.curriculumVersion||course.version||1))errors.push('班级教学内容版本与课程不一致，请核对课程版本后再排课');
 if(rows.length!==(course.lessons||[]).length)errors.push('课程讲次已变化，请重新打开排课');
 for(const r of rows){
  const lesson=course.lessons?.find(l=>l.id===r.lessonId),view=academicPlanView(c,r),label=lesson?.title||r.lessonId;
  if(!lesson||seen.has(r.lessonId)||!r.id||!r.key||keys.has(r.key))errors.push('课次或讲次标识无效/重复');
  seen.add(r.lessonId);keys.add(r.key);
  const prior=old.find(x=>workflowSessionKey(x)===r.key),changed=!prior||prior.date!==r.date||prior.time!==r.time||prior.lessonId!==r.lessonId;
  if(prior&&(prior.status!==view.status||prior.active!==view.active))errors.push(`${label} 的状态不能通过排课变更`);
  if(prior&&changed&&(academicHasSessionRecord(prior)||!academicSessionActive(prior)))errors.push(`${label} 已有记录或已取消/结束，不能改写排期`);
  if(!academicSessionActive(view))continue;
  if(!scTimeParts(view).start){errors.push(`${label} 请补齐有效日期、时间`);continue}
  if(changed&&scTimeParts(view).start<=Date.now())errors.push(`${label} 只能排在未来时间`);
  const others=[...academicScheduledClasses().filter(x=>x.c.id!==c.id).map(x=>x.c),...rows.filter(x=>x!==r).map(x=>academicPlanView(c,x))];
  for(const x of others){
   if(!academicSessionActive(x)||!academicRepairOverlap(view,x))continue;
   const people=workflowSessionRoster(view).filter(s=>workflowSessionRoster(x).some(t=>s.id===t.id));
   if(academicRepairTeacher(view)===academicRepairTeacher(x))errors.push(`${label}：${x.date} ${x.time} 老师与「${x.name}」冲突`);
   if(view.campus===x.campus&&view.room===x.room)errors.push(`${label}：${x.date} ${x.time} 教室与「${x.name}」冲突`);
   if(people.length)errors.push(`${label}：${people.map(s=>s.name).join('、')} 与「${x.name}」时间冲突`);
  }
 }
 return [...new Set(errors)];
}
function academicSchedulePreview(){academicScheduleCapture();academicScheduleUI.preview=true;render()}
function academicScheduleSave(){
 if(!academicScheduleAllowed()){toast('当前身份没有排课权限');return false}
 academicScheduleCapture();
 const d=academicScheduleUI,c=a.classes.find(x=>x.id===d?.classId),errors=academicScheduleCheck(c,d?.rows||[]);
 if(errors.length){d.preview=true;render();toast(errors[0]);return false}
 // Resolve legacy records before replacing the original date/content. Never guess among same-day lessons.
 const prior=academicClassSessions(c),links=a.attendance.map(record=>{const session=academicMatchRecordedSession(record,c,prior);return {record,key:session?workflowSessionKey(session):null}}).filter(x=>x.key);
 c.schedule=d.rows.map(r=>({...r}));c.sessions=c.sessions||[];
 const first=c.schedule[0];Object.assign(c,{date:first.date,time:first.time,lessonId:first.lessonId,lessonVersion:first.lessonVersion});
 for(const {record,key} of links){
  const p=c.schedule.find(x=>x.key===key);if(!p)continue;
  Object.assign(record,{classId:c.id,classIndex:academicClassIndex(c),scheduleId:p.id,sessionId:p.key,lessonId:p.lessonId,lessonVersion:p.lessonVersion});
  if(record.status==='未考勤'&&!record.consumptionConfirmed){record.date=p.date;record.time=p.time}
 }
 workflowPersist();workflowState.scheduleView='teacher';workflowState.course=c.course;workflowState.teacher='';workflowState.from='';workflowState.to='';nav('schedule');toast(`已保存 ${c.schedule.length} 节排课，课表与课次操作已同步`);return true;
}
academicScheduleSave=auditAtomic(academicScheduleSave);
function academicSchedulePage(){const d=academicScheduleUI,c=a.classes.find(x=>x.id===d?.classId),course=batchCourse(c);if(!d)return '<div class="card pad">请重新选择班级排课</div>';const errors=d.preview?academicScheduleCheck(c,d.rows):[];return `<section class="card pad" data-plan-draft="${esc(d.classId)}"><div class="toolbar"><strong>班级排课</strong><select class="select" aria-label="排课班级" onchange="academicScheduleSelect(this.value)"><option value="">选择班级</option>${a.classes.filter(academicSessionActive).map(x=>`<option value="${esc(x.id)}" ${x.id===c?.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div>${!c?'<div class="empty">请选择需要排课的班级</div>':`<p class="muted">${esc(c.teacher)} · ${esc(c.campus)} / ${esc(c.room)} · ${d.rows.length} 讲</p><div class="form-grid">${aField('开始日期',`<input id="plan-from" class="input" type="date" value="${esc(d.from)}">`)}${aField('统一时段',`<input id="plan-time" class="input" value="${esc(d.time)}" placeholder="09:00–11:00">`)}</div><div class="checkrow">${['日','一','二','三','四','五','六'].map((x,i)=>`<label><input type="checkbox" data-plan-day value="${i}" ${d.days.includes(i)?'checked':''}> 周${x}</label>`).join('')}<button class="btn small" onclick="academicScheduleGenerate()">生成未排讲次</button></div>${aTable(['讲次 / 内容','日期','时段','状态'],d.rows.map((r,i)=>{const prior=academicClassSessions(c).find(x=>workflowSessionKey(x)===r.key),locked=prior&&(academicHasSessionRecord(prior)||!academicSessionActive(prior));return `<tr><td>${esc(course?.lessons?.find(x=>x.id===r.lessonId)?.title||r.lessonId)}</td><td><input class="input" type="date" aria-label="第${i+1}讲日期" data-plan-row="${i}" data-plan-field="date" value="${esc(r.date)}" ${locked?'disabled':''}></td><td><input class="input" aria-label="第${i+1}讲时段" data-plan-row="${i}" data-plan-field="time" value="${esc(r.time)}" ${locked?'disabled':''}></td><td>${prior&&!academicSessionActive(prior)?esc(prior.status||'已停用'):locked?'已有记录，保留原排期':r.date?'待校验':'未排课'}</td></tr>`}))}${d.preview?`<div class="notice" role="status">${errors.length?errors.map(esc).join('<br>'):'校验通过，可以保存'}</div>`:''}<div class="form-actions"><button class="btn" onclick="academicSchedulePreview()">检查排课冲突</button><button class="btn primary" onclick="academicScheduleSave()">保存排课</button></div>`}</section>`}
const academicSchedulePermission=permissionCanVisit;
permissionCanVisit=function(page){return page==='classSchedule'?academicScheduleAllowed():academicSchedulePermission(page)};
const academicScheduleRender=render;
render=function(...args){if(state.page!=='classSchedule')return academicScheduleRender(...args);if(!academicScheduleAllowed())return permissionDenied(state.page);$('#crumb').textContent='教务 / 班级排课';$('#view').innerHTML=academicSchedulePage();permissionRefreshNavigation();workspaceObserve()};
const academicScheduleCapturePage=workspaceCapture;
workspaceCapture=function(){
 const surface=document.querySelector('[data-plan-draft]');
 if(state.page==='classSchedule'&&!workspaceHistory.restoring&&surface?.dataset.planDraft===academicScheduleUI?.classId)academicScheduleCapture(true);
 const result=academicScheduleCapturePage();result.scheduleDraft=workspaceClone(academicScheduleUI);return result;
};
const academicScheduleApplyPage=workspaceApply;
workspaceApply=function(s){academicScheduleUI=workspaceClone(s.scheduleDraft);return academicScheduleApplyPage(s)};
const academicScheduleClassesPage=classesPage;
classesPage=function(){return academicScheduleClassesPage().replace(/(<div class="actions">)(<a[^>]*onclick="a.selectedClass=(\d+);nav\('classForm'\)"[^>]*>)/g,(full,container,start,i)=>`${container}<button class="btn small" onclick="academicScheduleOpen('${esc(a.classes[Number(i)]?.id||'')}')">排课</button>${start}`)};
const academicScheduleForm=classForm;
classForm=function(){const html=academicScheduleForm(),c=a.selectedClass===null?null:a.classes[a.selectedClass];return c?html+`<div class="card pad"><button class="btn" onclick="academicScheduleOpen('${esc(c.id)}')">查看与调整全部课次</button></div>`:html};
commandWorkflows.unshift({id:'action.classes.schedule',label:'班级排课',words:['排课','课程排期','批量排课','每周排课','调整上课日期'],page:'classes',guard:'classes',run:()=>academicScheduleOpen(),hint:'按讲次生成排期并检查老师、教室与学生冲突'});

function academicMatchRecordedSession(record,c,entries=academicClassSessions(c)){
 if(!c||(record.classId?record.classId!==c.id:record.classIndex!==academicClassIndex(c)))return null;
 let matches;
 if(record.sessionId)matches=entries.filter(x=>workflowSessionKey(x)===record.sessionId);
 else if(record.scheduleId)matches=entries.filter(x=>x.scheduleId===record.scheduleId);
 else {
  const lessonId=record.lessonId||(batchCourse(c)?.lessons||[]).find(l=>l.id===record.session||l.title===record.session)?.id;
  matches=entries.filter(x=>(!record.date||x.date===record.date)&&(!record.time||x.time===record.time)&&(!lessonId||x.lessonId===lessonId));
 }
 return matches.length===1?matches[0]:null;
}
function academicRecordedSession(record){
 const c=record.classId?a.classes.find(x=>x.id===record.classId):a.classes[record.classIndex];
 return academicMatchRecordedSession(record,c);
}
