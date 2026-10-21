/* Final academic flow guards. Demo records only; no payment or server calls. */
function academicRepairTeacher(c){
 const assigned=(c.sessions||[]).find(s=>s.sessionId===workflowSessionKey(c)&&s.substitute);
 return assigned?.substitute||c.teacher;
}
function academicRepairOverlap(aClass,bClass){
 if(!aClass||!bClass||aClass.date!==bClass.date)return false;
 const aTime=scTimeParts(aClass),bTime=scTimeParts(bClass);
 return !!(aTime.start&&bTime.start&&scOverlap(aTime,bTime));
}
function academicRepairCandidateErrors(candidate,editing){
 const time=scTimeParts(candidate),errors=[];
 if(!time.start||time.end<=time.start)errors.push('请填写有效日期和时间，结束时间须晚于开始时间');
 if(errors.length)return errors;
 for(const other of a.classes){
  if(other===editing||!academicRepairOverlap(candidate,other))continue;
  if(academicRepairTeacher(other)===candidate.teacher)errors.push(`授课老师 ${candidate.teacher} 在 ${other.time} 已有排课`);
  if(candidate.campus===other.campus&&candidate.room===other.room)errors.push(`教室 ${candidate.room} 在 ${other.time} 已被占用`);
 }
 return [...new Set(errors)];
}

const academicRepairSaveClass=saveClass;
saveClass=function(){
 if(!workflowGuard('classes'))return;
 const editing=a.selectedClass===null?null:a.classes[a.selectedClass];
 const candidate={date:$('#class-date')?.value||'',time:$('#class-time')?.value||'',teacher:$('#class-teacher-form')?.value||editing?.teacher||'',campus:$('#class-campus-form')?.value||editing?.campus||'',room:$('#class-room')?.value||editing?.room||''};
 const errors=academicRepairCandidateErrors(candidate,editing);
 if(errors.length){toast(errors.join('；'));return}
 academicRepairSaveClass();
};

const academicRepairConfirmSubstitute=workflowConfirmSubstitute;
workflowConfirmSubstitute=function(){
 if(!workflowGuard('academic'))return;
 const index=workflowState.selectedSession?.classIndex,c=a.classes[index],teacher=$('#workflow-substitute')?.value;
 if(!c||!teacher){academicRepairConfirmSubstitute();return}
 const candidate={...c,teacher};
 const conflict=a.classes.find(x=>x!==c&&academicRepairTeacher(x)===teacher&&academicRepairOverlap(candidate,x));
 if(conflict){toast(`代课老师 ${teacher} 在 ${conflict.time} 已有重叠课程`);return}
 academicRepairConfirmSubstitute();
};

// A matching label or a guessed "第1讲" never establishes compatible course content.
function academicRepairCourseFor(c){const matches=a.courses.filter(x=>x.id&&x.id===c?.courseId);return matches.length===1?matches[0]:null}
function academicRepairGrade(value){const text=String(value||'').trim().replace(/\s/g,'');const numbers={'一':'1','二':'2','三':'3','四':'4','五':'5','六':'6'};return text.replace(/^(?:小学|小)?([一二三四五六1-6])(?:年级)?$/,(_,n)=>`${numbers[n]||n}年级`)}
function academicRepairCourseMatch(source,target){const from=academicRepairCourseFor(source),to=academicRepairCourseFor(target);return !!(from&&to&&academicRepairGrade(from.grade)&&academicRepairGrade(to.grade)&&String(from.subject||'').trim()&&String(to.subject||'').trim()&&academicRepairGrade(from.grade)===academicRepairGrade(to.grade)&&String(from.subject).trim()===String(to.subject).trim())}
function academicRepairMoveAllowed(){return permissionCanVisit('tempMove')&&workflowMay('academic')}
function academicRepairMoveConflict(source,target,studentId){return academicScheduledClasses().map(x=>x.c).find(c=>academicSessionActive(c)&&workflowSessionKey(c)!==workflowSessionKey(source)&&workflowSessionKey(c)!==workflowSessionKey(target)&&academicRepairOverlap(target,c)&&workflowSessionRoster(c).some(s=>s.id===studentId))}
function academicRepairTempMoveErrors(source,target,studentId){
 const errors=[],student=a.students.filter(s=>s.id===studentId),course=academicRepairCourseFor(source),targetCourse=academicRepairCourseFor(target);
 if(!academicRepairMoveAllowed())return ['当前身份没有临时转班权限'];
 if(!source||!target||source===target||source.id===target.id)return ['请选择不同的原课次和目标课次'];
 if(a.classes.filter(c=>c.id===source.id).length!==1||a.classes.filter(c=>c.id===target.id).length!==1)return ['课次标识重复，请先修正班级资料'];
 if(student.length!==1||!workflowSessionRoster(source).some(s=>s.id===studentId))errors.push('该学生不在原课次名单中，请重新选择');
 if(!course||!targetCourse||!academicRepairGrade(course.grade)||!academicRepairGrade(targetCourse.grade)||!String(course.subject||'').trim()||!String(targetCourse.subject||'').trim())errors.push('原课程或目标课程的年级、学科资料不完整，请先补全');
 else if(!academicRepairCourseMatch(source,target))errors.push('目标班级必须与原课程为相同年级、相同学科');
 if(course?.active===false||targetCourse?.active===false)errors.push('原课程或目标课程已停用');
 if(!source.courseId||source.courseId!==target.courseId)errors.push('临时转班只支持同一课程的对应课次，不能跨课程变更权益');
 const sourceLessons=(course?.lessons||[]).filter(x=>x.id===source.lessonId),targetLessons=(targetCourse?.lessons||[]).filter(x=>x.id===target.lessonId);
 if(!source.lessonId||sourceLessons.length!==1||targetLessons.length!==1)errors.push('原课次或目标课次尚未配置有效授课章节');
 else if(source.lessonId!==target.lessonId)errors.push('目标课次必须与原课次为同一授课章节');
 if(!String(source.lessonVersion??'').trim()||!String(target.lessonVersion??'').trim()||String(source.lessonVersion)!==String(target.lessonVersion))errors.push('原课次与目标课次的授课内容版本不一致');
 if(source.date!==target.date)errors.push('临时转班只支持同一天已排出的对应课次');
 if(!batchValidTime(source)||!batchValidTime(target))errors.push('原课次或目标课次的日期、时间无效');
 else if(scTimeParts(source).start<=Date.now()||scTimeParts(target).start<=Date.now())errors.push('已开始或已结束的课次不能临时转班');
 if([source,target].some(c=>['已结课','已取消','已停用'].includes(c.status)||c.active===false))errors.push('原班级或目标班级当前不可调课');
 const ruleError=sysMoveError(source,target);if(ruleError)errors.push(ruleError);
 if(workflowSessionRoster(target).some(s=>s.id===studentId))errors.push('该学生已在目标课次名单中');
 const occupied=Math.max(Number(target.students)||0,workflowSessionRoster(target).length),capacity=Number(target.capacity);
 if(!Number.isInteger(capacity)||capacity<1||occupied>=capacity)errors.push('目标班本节名额不足或未配置容量');
 if((a.sessionAdjustments||[]).some(m=>m.studentId===studentId&&m.sourceClassId===source.id&&(m.sourceSessionId?m.sourceSessionId===workflowSessionKey(source):m.date===source.date&&(!m.lessonId||m.lessonId===source.lessonId))&&m.status==='已确认'))errors.push('该学生本节已有调班安排');
 const sourceIndex=academicClassIndex(source),studentIndex=a.students.findIndex(s=>s.id===studentId);
 if(a.attendance.some(r=>(r.sessionId===workflowSessionKey(source)||!r.sessionId&&r.classIndex===sourceIndex&&r.date===source.date)&&(r.studentId===studentId||r.studentId==null&&r.studentIndex===studentIndex)&&(r.consumptionConfirmed===true||r.status==='已考勤'||r.attendance&&!['未考勤','本节调出'].includes(r.attendance))))errors.push('原课次已有考勤或课消记录，不能临时转班');
 const conflict=academicRepairMoveConflict(source,target,studentId);if(conflict)errors.push(`该学生在 ${conflict.name} 的 ${conflict.time} 已有重叠课次，未调班`);
 return [...new Set(errors)];
}
function academicRepairTempMoveTargets(source,studentId){return source&&studentId?academicScheduledClasses().map(x=>x.c).filter(c=>!academicRepairTempMoveErrors(source,c,studentId).length):[]}
function academicRepairMoveContext(){
 if(state.page==='tempMove'){const draft=workflowState.tempMoveDraft||{};return {source:academicResolveSession($('#flow-from')?.value||draft.sourceId),target:academicResolveSession($('#flow-to')?.value),studentId:$('#temp-move-student')?.value||draft.studentId}}
 const selected=workflowState.selectedSession,stableId=state.page==='sessionFlow'&&typeof workspaceUI!=='undefined'?workspaceUI.sessionClassId:null;
 return {source:academicSessionClass(stableId?a.classes.findIndex(c=>c.id===stableId):selected?.classIndex),target:academicResolveSession($('#workflow-move-target')?.value),studentId:$('#workflow-move-student')?.value||a.students[selected?.studentIndex]?.id};
}
workflowCommitMove=function(){
 const {source,target,studentId}=academicRepairMoveContext();
 if(!academicRepairMoveAllowed()){toast('当前身份没有临时转班权限');return}
 // Report a real timetable collision first, even for incomplete historical course metadata.
 const conflict=source&&target&&studentId&&academicRepairMoveConflict(source,target,studentId);
 if(conflict){toast(`该学生在 ${conflict.name} 的 ${conflict.time} 已有重叠课次，未调班`);return}
 const errors=academicRepairTempMoveErrors(source,target,studentId);if(errors.length){toast(errors[0]);return}
 const sourceIndex=academicClassIndex(source),studentIndex=a.students.findIndex(s=>s.id===studentId);
 a.sessionAdjustments=a.sessionAdjustments||[];
 a.sessionAdjustments.push({id:`MV-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,studentId,sourceClassId:source.id,targetClassId:target.id,date:source.date,courseId:source.courseId,lessonId:source.lessonId,lessonVersion:source.lessonVersion,sourceSessionId:workflowSessionKey(source),targetSessionId:workflowSessionKey(target),status:'已确认'});
 a.attendance.forEach(x=>{if(x.classIndex===sourceIndex&&(x.studentId===studentId||x.studentId==null&&x.studentIndex===studentIndex)&&(x.sessionId?x.sessionId===workflowSessionKey(source):x.date===source.date)&&x.status==='未考勤'){x.status='已撤销';x.attendance='本节调出'}});
 workflowPersist();workflowState.tempMoveDraft=null;if(permissionCanVisit('schedule'))workflowOpenSession(sourceIndex,studentIndex,source.scheduleId||'');else render();toast('本节名单已调整，班级长期归属保留');
};

function academicRepairLessonLabel(c){const course=academicRepairCourseFor(c),lesson=course?.lessons?.find(x=>x.id===c?.lessonId);return lesson?`${lesson.title||lesson.name||c.lessonId} · 版本 ${c.lessonVersion??'待配置'}`:'授课章节待配置'}
function academicRepairMoveOption(c){return `${c.name} · ${c.date} ${c.time} · ${c.campus||''} · ${academicRepairLessonLabel(c)}`}
function academicRepairRenderSessionMove(studentId){
 const selected=workflowState.selectedSession,c=academicSessionClass(selected?.classIndex),box=$('#workflow-session-action');if(!c||!box)return;
 if(!academicRepairMoveAllowed()){box.innerHTML='<p class="notice">当前身份没有临时转班权限。</p>';return}
 const roster=workflowSessionRoster(c),chosen=roster.find(s=>s.id===studentId)||roster.find(s=>s.id===a.students[selected?.studentIndex]?.id)||roster[0],targets=academicRepairTempMoveTargets(c,chosen?.id);
 if(studentId&&chosen){workflowState.selectedSession.studentIndex=a.students.indexOf(chosen);if(state.page==='sessionFlow'&&typeof workspaceUI!=='undefined')workspaceUI.sessionStudentId=chosen.id}
 box.innerHTML=`<div class="form-grid">${aField('学生',`<select id="workflow-move-student" class="select" onchange="academicRepairRenderSessionMove(this.value)">${roster.map(s=>`<option value="${esc(s.id)}" ${chosen?.id===s.id?'selected':''}>${esc(s.name)}</option>`).join('')}</select>`,true)}${aField('目标课次',`<select id="workflow-move-target" class="select"><option value="">${targets.length?'请选择对应课次':'暂无可调入的对应课次'}</option>${targets.map(x=>`<option value="${esc(academicSessionRef(x))}">${esc(academicRepairMoveOption(x))}</option>`).join('')}</select>`,true)}</div><p class="help">${esc(academicRepairLessonLabel(c))} · 同年级、同学科、同课程章节</p>${targets.length?'':academicRepairMoveEmpty(c,chosen?.id)}<div class="form-actions"><button class="btn primary" ${targets.length?'':'disabled'} onclick="workflowCommitMove()">确认本节调班</button></div>`;
}
function academicRepairMoveEmpty(source,studentId){const course=academicRepairCourseFor(source);let message=!source?'该学生暂无可调出的课次。':!course?.grade||!course?.subject?'请先补全原课程的年级和学科资料。':!(course.lessons||[]).some(x=>x.id===source.lessonId)?'请先为原课次配置授课章节。':'没有符合本节内容、时间和名额要求的目标班级。';return `<p class="notice">${esc(message)}</p>`}
const academicRepairSessionAction=workflowSessionAction;
workflowSessionAction=function(action){if(action==='move')return academicRepairRenderSessionMove();return academicRepairSessionAction(action)};

function academicRepairTempMoveStudent(id){if(!academicRepairMoveAllowed())return;const index=a.students.findIndex(s=>s.id===id);a.selectedStudent=index<0?null:index;workflowState.tempMoveDraft={studentId:id,sourceId:'',targetId:''};render()}
function academicRepairTempMoveSource(id){if(!academicRepairMoveAllowed())return;workflowState.tempMoveDraft={...(workflowState.tempMoveDraft||{}),sourceId:id,targetId:''};render()}
function academicRepairTempMoveTarget(id){if(!academicRepairMoveAllowed())return;workflowState.tempMoveDraft={...(workflowState.tempMoveDraft||{}),targetId:id}}
function academicRepairTempMovePage(){
 if(!academicRepairMoveAllowed())return '<div class="card pad">当前身份没有临时转班权限。</div>';
 const student=a.students[a.selectedStudent],prior=workflowState.tempMoveDraft||{},sources=student?academicScheduledClasses().map(x=>x.c).filter(c=>academicSessionActive(c)&&scTimeParts(c).start>Date.now()&&workflowSessionRoster(c).some(s=>s.id===student.id)):[],source=sources.find(c=>academicSessionRef(c)===(prior.studentId===student?.id?prior.sourceId:''))||sources[0],targets=academicRepairTempMoveTargets(source,student?.id),target=targets.find(c=>academicSessionRef(c)===prior.targetId);
 workflowState.tempMoveDraft={studentId:student?.id||'',sourceId:source?academicSessionRef(source):'',targetId:target?academicSessionRef(target):''};
 return `<section class="card pad"><div class="form-grid">${aField('学生',`<select id="temp-move-student" class="select" onchange="academicRepairTempMoveStudent(this.value)"><option value="">请选择学生</option>${a.students.map(s=>`<option value="${esc(s.id)}" ${student?.id===s.id?'selected':''}>${esc(s.name)} · ${esc(s.id)}</option>`).join('')}</select>`,true)}${aField('原课次',`<select id="flow-from" class="select" onchange="academicRepairTempMoveSource(this.value)">${sources.length?sources.map(c=>`<option value="${esc(academicSessionRef(c))}" ${source&&academicSessionRef(source)===academicSessionRef(c)?'selected':''}>${esc(academicRepairMoveOption(c))}</option>`).join(''):'<option value="">请先选择有在读课次的学生</option>'}</select>`,true)}${aField('目标课次',`<select id="flow-to" class="select" onchange="academicRepairTempMoveTarget(this.value)"><option value="">${targets.length?'请选择对应课次':'暂无可调入的对应课次'}</option>${targets.map(c=>`<option value="${esc(academicSessionRef(c))}" ${target&&academicSessionRef(target)===academicSessionRef(c)?'selected':''}>${esc(academicRepairMoveOption(c))}</option>`).join('')}</select>`,true)}${source?aField('授课章节',`<span>${esc(academicRepairLessonLabel(source))}</span>`):''}</div>${source?'<p class="help">目标课次保持相同年级、学科、课程章节和内容版本，仅调整本节名单。</p>':''}${student&&!targets.length?academicRepairMoveEmpty(source,student.id):''}<div class="form-actions"><button class="btn primary" ${student&&targets.length?'':'disabled'} onclick="finishFlow('tempMove')">确认本节调班</button></div></section>`;
}

function academicRepairResolveClass(value){return a.classes.find(c=>c.id===value||c.name===value)}
const academicRepairFlowPage=flowPage;
flowPage=function(type){
 if(type==='tempMove')return academicRepairTempMovePage();
 const html=academicRepairFlowPage(type);
 if(type==='supplement')return html.replace('<hr class="divider">','<div class="notice">补费订单、应收金额与到账核验尚未接入；此页面不会保存业务记录。</div><hr class="divider">').replace(`<button class="btn primary" onclick="finishFlow('supplement')">确定</button>`,`<button class="btn primary" disabled>待接入</button>`);
 if(type==='transfer')return html.replace('<p class="academic-note">参考图标注：直播与录播课程暂不支持转课／班。</p>','<p class="academic-note">同课程、同版本、同讲次的学生转班将进入批量预览；跨课程价差规则待接入。</p>');
 return html;
};
const academicRepairFinishFlow=finishFlow;
finishFlow=function(type){
 if(type==='tempMove')return workflowCommitMove();
 if(type==='supplement'){toast('补费订单、应收金额和收款确认流程尚未接入；未创建订单或登记收款');return}
 if(type==='transfer'){
  if(a.selectedStudent===null){toast('请先选择学生');return}
  const student=a.students[a.selectedStudent],source=academicRepairResolveClass($('#flow-from')?.value),target=academicRepairResolveClass($('#flow-to')?.value);
  if(!source||!target||source===target){toast('请选择不同的转出班与转入班');return}
  if(!batchAllowed('transfer')){toast('当前身份无学生转班权限');return}
  if(source.courseId!==target.courseId||source.lessonId!==target.lessonId||source.lessonVersion!==target.lessonVersion||!source.courseId||!source.lessonId||source.lessonVersion==null){toast('跨课程、跨版本或无法确认内容版本的转课价差与权益规则尚未接入；未办理');return}
  if(!batchRoster(source,student)){toast('该学生不在所选转出班；未办理');return}
  batchOpen('transfer');
  if(batchUI){batchUI.draft.sourceId=source.id;batchUI.draft.targetId=target.id;batchUI.ids=[student.id];batchRender();toast('已打开学生转班预览；核对后再确认办理')}
  return;
 }
 return academicRepairFinishFlow(type);
};

function academicRepairMakeupTargets(record){
 const source=academicRecordedSession(record),student=a.students[record.studentIndex];
 if(!source||!student||!source.courseId||!source.lessonId||source.lessonVersion==null)return [];
 const now=new Date(),today=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
 return academicScheduledClasses().map(x=>x.c).filter(c=>{const course=a.courses.find(x=>x.id===c.courseId),time=scTimeParts(c);return c.id!==source.id&&c.courseId===source.courseId&&c.lessonId===source.lessonId&&c.lessonVersion===source.lessonVersion&&c.date>=today&&time.end>Date.now()&&time.end>time.start&&!['已结课','已取消'].includes(c.status)&&course?.active!==false&&!workflowSessionRoster(c).some(s=>s.id===student.id)});
}
function academicRepairTargetSessionMatches(adjustment,target){
 if(adjustment.targetClassId!==target.id)return false;
 if(adjustment.targetSessionId)return adjustment.targetSessionId===workflowSessionKey(target);
 const matches=academicScheduledClasses().map(x=>x.c).filter(c=>c.id===target.id&&c.date===adjustment.date&&(!adjustment.lessonId||c.lessonId===adjustment.lessonId)&&(!adjustment.lessonVersion||String(c.lessonVersion)===String(adjustment.lessonVersion)));
 return matches.length===1&&workflowSessionKey(matches[0])===workflowSessionKey(target);
}
function academicRepairMakeupSourceSession(record,source){return record.sessionId||workflowSessionKey(source)}
function academicRepairOrderForClass(studentId,source){
 if(!source?.courseId||!source.lessonId)return null;
 const orders=a.orders.filter(o=>o.studentId===studentId&&o.classId===source.id&&o.paymentState==='已支付'&&o.entitlementState==='已生效'&&(o.lessonSnapshot||[]).some(x=>x.id===source.lessonId));
 return orders.length===1?orders[0]:null;
}
function academicRepairMakeupOrder(record){const source=academicRecordedSession(record),student=a.students[record.studentIndex];return source&&student?academicRepairOrderForClass(student.id,source):null}
const academicRepairModalPage=modalPage;
modalPage=function(){
 if(!String(a.modal||'').startsWith('makeup:'))return academicRepairModalPage();
 const i=Number(String(a.modal).split(':')[1]),record=a.attendance[i],student=record&&a.students[record.studentIndex],source=record&&academicRecordedSession(record),targets=record?academicRepairMakeupTargets(record):[],order=record?academicRepairMakeupOrder(record):null;
 if(!record||!student||!source)return `<div class="modal-backdrop"><div class="modal"><div class="modal-head"><h2>安排补课</h2><button class="btn" onclick="a.modal=null;academicRender()">关闭</button></div><p class="notice">原考勤记录或班级已不存在，无法安排补课。</p></div></div>`;
 return `<div class="modal-backdrop"><div class="modal"><div class="modal-head"><h2>安排补课</h2><button class="btn" onclick="a.modal=null;academicRender()">取消</button></div><p>${esc(student.name)} · ${esc(source.course)} · 原课次 ${esc(record.date||'')} ${esc(record.session||'')}</p><p class="help">只列出同课程、同讲次和同内容版本的未来课次；预约只加入目标名单。${order&&!order.transferHistory?.length?'确认目标课次课消时会关联这笔原订单及原课次。':'没有唯一有效原订单，或原订单存在转班历史；目标课次只记出勤，不允许重复扣课。'}</p>${targets.length?`<label for="makeup-target-class">目标课次</label><select id="makeup-target-class" class="select">${targets.map(c=>`<option value="${esc(academicSessionRef(c))}">${esc(c.name)} · ${esc(c.date)} ${esc(c.time)} · ${esc(c.campus)} / ${esc(c.room)}</option>`).join('')}</select>`:`<div class="profile-empty"><strong>没有可安排的目标课次</strong>需要先排出未来课次，并确保课程内容、讲次和版本一致。</div>`}<div class="modal-actions"><button class="btn" onclick="a.modal=null;academicRender()">取消</button><button class="btn primary" ${targets.length?'':'disabled'} onclick="saveMakeup(${i})">确认补课预约</button></div></div></div>`;
};
function saveMakeup(index){
 if(!workflowGuard('academic'))return;
 const record=a.attendance[index],student=record&&a.students[record.studentIndex],source=record&&academicRecordedSession(record),target=academicResolveSession($('#makeup-target-class')?.value);
 if(!record||!student||!source||!['请假','旷课'].includes(record.attendance)||record.consumptionConfirmed===true||['已安排','不补课'].includes(record.makeup)){toast('该考勤记录当前不能安排补课；已结案或确认课消的讲次不可重复预约');return}
 if(!target||!academicRepairMakeupTargets(record).some(c=>workflowSessionKey(c)===workflowSessionKey(target))){toast('目标课次不匹配或名额已变化，请重新选择');return}
 const roster=workflowSessionRoster(target),alreadyMember=batchRoster(target,student);
 if(!alreadyMember&&Math.max(Number(target.students)||0,roster.length)>=Number(target.capacity||0)){toast('目标课次名额不足');return}
 const conflict=academicScheduledClasses().map(x=>x.c).find(c=>academicSessionActive(c)&&workflowSessionKey(c)!==workflowSessionKey(source)&&workflowSessionKey(c)!==workflowSessionKey(target)&&c.date===target.date&&academicRepairOverlap(target,c)&&workflowSessionRoster(c).some(s=>s.id===student.id));
 if(conflict){toast(`学生在 ${conflict.name} 的 ${conflict.time} 已有重叠课次`);return}
 a.sessionAdjustments=a.sessionAdjustments||[];
 const sourceSessionId=academicRepairMakeupSourceSession(record,source);
 if(a.sessionAdjustments.some(x=>x.type==='补课'&&x.studentId===student.id&&x.sourceSessionId===sourceSessionId&&x.status==='已确认')){toast('该原课次已安排补课，请勿重复预约');return}
 if(a.sessionAdjustments.some(x=>x.type==='补课'&&x.studentId===student.id&&x.status==='已确认'&&academicRepairTargetSessionMatches(x,target))){toast('该学生已预约此目标课次');return}
 const order=academicRepairMakeupOrder(record),consumptionEnabled=!!order&&!order.transferHistory?.length;
 const appointment={id:`MU-${Date.now()}`,type:'补课',studentId:student.id,sourceClassId:source.id,targetClassId:target.id,date:target.date,courseId:source.courseId,lessonId:source.lessonId,lessonVersion:source.lessonVersion,sourceSessionId,targetSessionId:workflowSessionKey(target),orderId:consumptionEnabled?order.id:null,consumptionEnabled,consumptionState:consumptionEnabled?'待确认':'未绑定有效订单，禁止课消',status:'已确认',createdAt:new Date().toISOString()};
 a.sessionAdjustments.push(appointment);record.makeup='已安排';record.makeupAppointmentId=appointment.id;record.makeupClassId=target.id;record.makeupDate=target.date;workflowPersist();a.modal=null;academicRender();toast(consumptionEnabled?`已预约 ${target.name} ${target.date} ${target.time}；确认课消时将关联原订单与原讲次`:`已预约 ${target.name} ${target.date} ${target.time}；缺少唯一有效原订单，目标课次禁止重复扣课`);
}

const academicRepairSaveAttendance=workflowSaveSessionAttendance;
workflowSaveSessionAttendance=function(){
 if(!workflowGuard('academic'))return;
 const selected=workflowState.selectedSession,c=a.classes[selected?.classIndex];if(!c)return academicRepairSaveAttendance();
 for(const el of document.querySelectorAll('.wf-attendance')){const consume=[...document.querySelectorAll('.wf-consume')].find(x=>x.dataset.student===el.dataset.student)?.checked,error=sysAttendanceError(c,el.value,consume);if(error){toast(error);return}}
 const appointments=(a.sessionAdjustments||[]).filter(x=>x.status==='已确认'&&x.targetClassId===c?.id&&x.date===c?.date),links=appointments.map(x=>{
  const source=a.classes.find(y=>y.id===x.sourceClassId),sourceIndex=academicClassIndex(source),student=a.students.find(y=>y.id===x.studentId),studentIndex=a.students.indexOf(student),sourceSessionId=x.sourceSessionId||workflowSessionKey(source||{}),order=x.type==='补课'?a.orders.find(y=>y.id===x.orderId):academicRepairOrderForClass(x.studentId,source);
  const enabled=!!order&&!order.transferHistory?.length&&(x.type!=='补课'||x.consumptionEnabled);
  const prior=order&&a.attendance.some(y=>!(y.classIndex===selected?.classIndex&&y.studentId===x.studentId&&y.date===c?.date)&&y.consumptionConfirmed===true&&((y.orderId===order.id&&(y.consumptionSourceSessionId||y.sessionId)===sourceSessionId)||(y.classIndex===sourceIndex&&y.studentIndex===studentIndex&&(y.sessionId||workflowSessionKey(source||{}))===sourceSessionId)));
  return {appointment:x,sourceSessionId,order,enabled:enabled&&!prior,studentId:x.studentId};
 }),blocked=[];
 for(const link of links){
  const checkbox=[...document.querySelectorAll('.wf-consume')].find(x=>x.dataset.student===link.studentId);
  if(checkbox?.checked&&!link.enabled){checkbox.checked=false;blocked.push(link);}
 }
 const result=academicRepairSaveAttendance();
 for(const link of links){
  const {appointment}=link;
  const statusControl=[...document.querySelectorAll('.wf-attendance')].find(x=>x.dataset.student===appointment.studentId),consumeControl=[...document.querySelectorAll('.wf-consume')].find(x=>x.dataset.student===appointment.studentId);
  if(!statusControl||statusControl.value==='未考勤'&&!consumeControl?.checked)continue;
  const row=a.attendance.find(x=>x.sessionId===workflowSessionKey(c)&&x.studentId===appointment.studentId);
  if(!row)continue;
  if(appointment.type==='补课')row.makeupAppointmentId=appointment.id;
  row.sourceOrderId=link.order?.id||null;row.consumptionSourceSessionId=link.sourceSessionId;
  if(row.consumptionConfirmed&&link.enabled&&link.order){row.orderId=link.order.id;if(appointment.type==='补课')appointment.consumptionState='已确认课消'}
  else if(!row.consumptionConfirmed&&appointment.type==='补课')appointment.consumptionState='待确认';
 }
 if(blocked.length)toast('点名已保存；无法绑定唯一有效原订单，或原讲次已扣课，已阻止重复课消');
 return result;
};

const academicRepairRefundEstimate=workflowRefundEstimate;
workflowRefundEstimate=function(studentIndex,classIndex){
 const result=academicRepairRefundEstimate(studentIndex,classIndex),order=result.order;
 if(!order)return result;
 const student=result.student,sameStudent=x=>x.studentId===student?.id||x.studentId==null&&x.studentIndex===studentIndex;
 const sourceRows=a.attendance.filter(x=>x.consumptionConfirmed===true&&sameStudent(x)&&(x.orderId===order.id||x.classIndex===classIndex&&!x.orderId)),keys=new Set(sourceRows.map(x=>x.consumptionSourceSessionId||x.sessionId||`${x.date}|${x.session}`));
 a.attendance.filter(x=>x.orderId===order.id&&sameStudent(x)&&x.makeupAppointmentId&&x.consumptionConfirmed===true).forEach(x=>keys.add(x.consumptionSourceSessionId||x.sessionId||`${x.date}|${x.session}`));
 result.consumed=keys.size;result.refund=result.total?Math.max(0,Math.round((result.paid-result.unit*result.consumed)*100)/100):0;result.ready=!!result.order&&result.total>0&&result.consumed<=result.total;return result;
};

makeupPage=function(){
 const rows=a.attendance.map((r,i)=>({r,i,s:a.students[r.studentIndex],c:a.classes[r.classIndex]})).filter(x=>['请假','旷课'].includes(x.r.attendance)&&x.s&&x.c);
 return aHeading('补课管理','查看请假与旷课记录；预约只加入目标课次名单，不自动记出勤或课消')+`<div class="card pad">${rows.length?aTable(['学生','课程 / 原班','原课次','考勤','补课预约','操作'],rows.map(({r,i,s,c})=>{const target=a.classes.find(x=>x.id===r.makeupClassId);return `<tr><td>${esc(s.name)}<div class="muted">${esc(s.phone||'')}</div></td><td>${esc(c.course)}<div class="muted">${esc(c.name)}</div></td><td>${esc(r.date||'')} ${esc(r.time||'')} · ${esc(r.session||'')}</td><td>${esc(r.attendance)}</td><td>${r.makeup==='已安排'&&target?`已预约 ${esc(target.name)} · ${esc(r.makeupDate||target.date)}`:esc(r.makeup||'待安排')}</td><td>${r.makeup==='已安排'||r.makeup==='不补课'?'<span class="muted">已处理</span>':`<button class="btn small" onclick="a.modal='makeup:${i}';academicRender()">安排补课</button><button class="btn small" onclick="academicMarkNoMakeup(${i})">不补课</button>`}</td></tr>`}) ):`<div class="profile-empty"><strong>暂无待处理补课记录</strong>请假或旷课考勤后，记录会出现在这里。</div>`}<div class="data-bar">共 ${rows.length} 条请假或旷课记录；补课预约不自动确认出勤与课消。</div></div>`;
};
function academicMarkNoMakeup(index){if(!workflowGuard('academic'))return;const record=a.attendance[index];if(!record||!['请假','旷课'].includes(record.attendance)||record.makeup==='已安排'){toast('该考勤记录当前不能结案');return}record.makeup='不补课';workflowPersist();academicRender();toast('已登记不补课')}
