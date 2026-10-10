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

const academicRepairCommitMove=workflowCommitMove;
workflowCommitMove=function(){
 const selected=workflowState.selectedSession,source=a.classes[selected?.classIndex],studentId=$('#workflow-move-student')?.value||a.students[selected?.studentIndex]?.id,target=a.classes.find(c=>c.id===$('#workflow-move-target')?.value);
 if(!source||!target||!studentId){academicRepairCommitMove();return}
 if(target.date!==source.date){academicRepairCommitMove();return}
 if(workflowSessionRoster(target).some(s=>s.id===studentId)){toast('该学生已在目标课次名单中');return}
 const movedSession={...target,date:source.date};
 const conflict=a.classes.find(c=>c!==source&&c!==target&&c.date===source.date&&academicRepairOverlap(movedSession,c)&&workflowSessionRoster(c).some(s=>s.id===studentId));
 if(conflict){toast(`该学生在 ${conflict.name} 的 ${conflict.time} 已有重叠课次，未调班`);return}
 academicRepairCommitMove();
};

function academicRepairResolveClass(value){return a.classes.find(c=>c.id===value||c.name===value)}
const academicRepairFlowPage=flowPage;
flowPage=function(type){
 const html=academicRepairFlowPage(type);
 if(type==='supplement')return html.replace('<hr class="divider">','<div class="notice">补费订单、应收金额与到账核验尚未接入；此页面不会保存业务记录。</div><hr class="divider">').replace(`<button class="btn primary" onclick="finishFlow('supplement')">确定</button>`,`<button class="btn primary" disabled>待接入</button>`);
 if(type==='transfer')return html.replace('<p class="academic-note">参考图标注：直播与录播课程暂不支持转课／班。</p>','<p class="academic-note">同课程、同版本、同讲次的学生转班将进入批量预览；跨课程价差规则待接入。</p>');
 return html;
};
const academicRepairFinishFlow=finishFlow;
finishFlow=function(type){
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
 const source=a.classes[record.classIndex],student=a.students[record.studentIndex];
 if(!source||!student||!source.courseId||!source.lessonId||source.lessonVersion==null)return [];
 const now=new Date(),today=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
 return a.classes.filter(c=>{const course=a.courses.find(x=>x.id===c.courseId),time=scTimeParts(c);return c.id!==source.id&&c.courseId===source.courseId&&c.lessonId===source.lessonId&&c.lessonVersion===source.lessonVersion&&c.date>=today&&time.end>Date.now()&&time.end>time.start&&!['已结课','已取消'].includes(c.status)&&course?.active!==false&&!workflowSessionRoster(c).some(s=>s.id===student.id)});
}
function academicRepairMakeupSourceSession(record,source){return record.sessionId||workflowSessionKey(source)}
function academicRepairOrderForClass(studentId,source){
 if(!source?.courseId||!source.lessonId)return null;
 const orders=a.orders.filter(o=>o.studentId===studentId&&o.classId===source.id&&o.paymentState==='已支付'&&o.entitlementState==='已生效'&&(o.lessonSnapshot||[]).some(x=>x.id===source.lessonId));
 return orders.length===1?orders[0]:null;
}
function academicRepairMakeupOrder(record){const source=a.classes[record.classIndex],student=a.students[record.studentIndex];return source&&student?academicRepairOrderForClass(student.id,source):null}
const academicRepairModalPage=modalPage;
modalPage=function(){
 if(!String(a.modal||'').startsWith('makeup:'))return academicRepairModalPage();
 const i=Number(String(a.modal).split(':')[1]),record=a.attendance[i],student=record&&a.students[record.studentIndex],source=record&&a.classes[record.classIndex],targets=record?academicRepairMakeupTargets(record):[],order=record?academicRepairMakeupOrder(record):null;
 if(!record||!student||!source)return `<div class="modal-backdrop"><div class="modal"><div class="modal-head"><h2>安排补课</h2><button class="btn" onclick="a.modal=null;academicRender()">关闭</button></div><p class="notice">原考勤记录或班级已不存在，无法安排补课。</p></div></div>`;
 return `<div class="modal-backdrop"><div class="modal"><div class="modal-head"><h2>安排补课</h2><button class="btn" onclick="a.modal=null;academicRender()">取消</button></div><p>${esc(student.name)} · ${esc(source.course)} · 原课次 ${esc(record.date||'')} ${esc(record.session||'')}</p><p class="help">只列出同课程、同讲次和同内容版本的未来课次；预约只加入目标名单。${order&&!order.transferHistory?.length?'确认目标课次课消时会关联这笔原订单及原课次。':'没有唯一有效原订单，或原订单存在转班历史；目标课次只记出勤，不允许重复扣课。'}</p>${targets.length?`<label for="makeup-target-class">目标课次</label><select id="makeup-target-class" class="select">${targets.map(c=>`<option value="${esc(c.id)}">${esc(c.name)} · ${esc(c.date)} ${esc(c.time)} · ${esc(c.campus)} / ${esc(c.room)}</option>`).join('')}</select>`:`<div class="profile-empty"><strong>没有可安排的目标课次</strong>需要先排出未来课次，并确保课程内容、讲次和版本一致。</div>`}<div class="modal-actions"><button class="btn" onclick="a.modal=null;academicRender()">取消</button><button class="btn primary" ${targets.length?'':'disabled'} onclick="saveMakeup(${i})">确认补课预约</button></div></div></div>`;
};
function saveMakeup(index){
 if(!workflowGuard('academic'))return;
 const record=a.attendance[index],student=record&&a.students[record.studentIndex],source=record&&a.classes[record.classIndex],target=a.classes.find(c=>c.id===$('#makeup-target-class')?.value);
 if(!record||!student||!source||!['请假','旷课'].includes(record.attendance)||record.consumptionConfirmed===true||['已安排','不补课'].includes(record.makeup)){toast('该考勤记录当前不能安排补课；已结案或确认课消的讲次不可重复预约');return}
 if(!target||!academicRepairMakeupTargets(record).some(c=>c.id===target.id)){toast('目标课次不匹配或名额已变化，请重新选择');return}
 const roster=workflowSessionRoster(target),alreadyMember=batchRoster(target,student);
 if(!alreadyMember&&Math.max(Number(target.students)||0,roster.length)>=Number(target.capacity||0)){toast('目标课次名额不足');return}
 const conflict=a.classes.find(c=>c!==source&&c!==target&&c.date===target.date&&academicRepairOverlap(target,c)&&workflowSessionRoster(c).some(s=>s.id===student.id));
 if(conflict){toast(`学生在 ${conflict.name} 的 ${conflict.time} 已有重叠课次`);return}
 a.sessionAdjustments=a.sessionAdjustments||[];
 const sourceSessionId=academicRepairMakeupSourceSession(record,source);
 if(a.sessionAdjustments.some(x=>x.type==='补课'&&x.studentId===student.id&&x.sourceSessionId===sourceSessionId&&x.status==='已确认')){toast('该原课次已安排补课，请勿重复预约');return}
 if(a.sessionAdjustments.some(x=>x.type==='补课'&&x.studentId===student.id&&x.targetClassId===target.id&&x.date===target.date&&x.status==='已确认')){toast('该学生已预约此目标课次');return}
 const order=academicRepairMakeupOrder(record),consumptionEnabled=!!order&&!order.transferHistory?.length;
 const appointment={id:`MU-${Date.now()}`,type:'补课',studentId:student.id,sourceClassId:source.id,targetClassId:target.id,date:target.date,courseId:source.courseId,lessonId:source.lessonId,lessonVersion:source.lessonVersion,sourceSessionId,orderId:consumptionEnabled?order.id:null,consumptionEnabled,consumptionState:consumptionEnabled?'待确认':'未绑定有效订单，禁止课消',status:'已确认',createdAt:new Date().toISOString()};
 a.sessionAdjustments.push(appointment);record.makeup='已安排';record.makeupAppointmentId=appointment.id;record.makeupClassId=target.id;record.makeupDate=target.date;workflowPersist();a.modal=null;academicRender();toast(consumptionEnabled?`已预约 ${target.name} ${target.date} ${target.time}；确认课消时将关联原订单与原讲次`:`已预约 ${target.name} ${target.date} ${target.time}；缺少唯一有效原订单，目标课次禁止重复扣课`);
}

const academicRepairSaveAttendance=workflowSaveSessionAttendance;
workflowSaveSessionAttendance=function(){
 if(!workflowGuard('academic'))return;
 const selected=workflowState.selectedSession,c=a.classes[selected?.classIndex];if(!c)return academicRepairSaveAttendance();
 for(const el of document.querySelectorAll('.wf-attendance')){const consume=[...document.querySelectorAll('.wf-consume')].find(x=>x.dataset.student===el.dataset.student)?.checked,error=sysAttendanceError(c,el.value,consume);if(error){toast(error);return}}
 const appointments=(a.sessionAdjustments||[]).filter(x=>x.status==='已确认'&&x.targetClassId===c?.id&&x.date===c?.date),links=appointments.map(x=>{
  const source=a.classes.find(y=>y.id===x.sourceClassId),sourceIndex=a.classes.indexOf(source),student=a.students.find(y=>y.id===x.studentId),studentIndex=a.students.indexOf(student),sourceSessionId=x.sourceSessionId||workflowSessionKey(source||{}),order=x.type==='补课'?a.orders.find(y=>y.id===x.orderId):academicRepairOrderForClass(x.studentId,source);
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
