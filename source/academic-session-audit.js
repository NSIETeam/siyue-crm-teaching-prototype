/* Planned lessons have their own identity; attendance and teaching records stay on that lesson. */
function academicAuditSession(){
 const index=workflowState.selectedSession?.classIndex;
 return typeof academicSessionClass==='function'?academicSessionClass(index):a.classes[index];
}
function academicAuditEntries(){return typeof academicScheduledClasses==='function'?academicScheduledClasses():a.classes.map((c,index)=>({c,index,sessionId:workflowSessionKey(c)}))}
function academicAuditBase(c){return a.classes.find(x=>x.id===c?.id)}
function academicAuditOperable(c){return !!c&&[c,academicAuditBase(c)].filter(Boolean).every(x=>x.active!==false&&!['已取消','已停用'].includes(x.status))}
function academicAuditTeachers(){
 if(typeof academicClassTeachers==='function')return academicClassTeachers();
 const disabled=new Set((state.staff||[]).filter(x=>x.active===false).map(x=>x.name)),known=a.classes.map(x=>x.teacher);
 return [...new Set([...(state.staff||[]).filter(x=>x.active!==false&&(known.includes(x.name)||x.roleId==='teacher'||x.roleIds?.includes('teacher')||/老师|教师|主讲|授课/.test(String(x.roles||'')))).map(x=>x.name),...known])].filter(x=>x&&!disabled.has(x));
}
function academicAuditRowMatches(row,c,studentId){return row.sessionId===workflowSessionKey(c)&&(row.studentId===studentId||row.studentId==null&&a.students[row.studentIndex]?.id===studentId)}
function academicAuditAdjustmentMatches(adjustment,c){
 if(adjustment.status!=='已确认'||adjustment.targetClassId!==c.id)return false;
 if(adjustment.targetSessionId)return adjustment.targetSessionId===workflowSessionKey(c);
 // Legacy adjustments are usable only if their date/content identify exactly one planned lesson.
 const matches=academicAuditEntries().filter(({c:x})=>x.id===c.id&&x.date===adjustment.date&&(!adjustment.lessonId||x.lessonId===adjustment.lessonId)&&(!adjustment.lessonVersion||String(x.lessonVersion)===String(adjustment.lessonVersion)));
 return matches.length===1&&workflowSessionKey(matches[0].c)===workflowSessionKey(c);
}
function academicAuditAdjustmentOrder(adjustment,c,studentId){
 const sources=academicAuditEntries().filter(({c:x})=>x.id===adjustment.sourceClassId&&(adjustment.sourceSessionId?workflowSessionKey(x)===adjustment.sourceSessionId:x.lessonId===adjustment.lessonId&&String(x.lessonVersion)===String(adjustment.lessonVersion)));
 const source=sources.length===1?sources[0].c:null;
 if(!source||source.courseId!==c.courseId||source.lessonId!==c.lessonId||String(source.lessonVersion)!==String(c.lessonVersion))return null;
 const orders=a.orders.filter(o=>o.studentId===studentId&&o.classId===source.id&&o.paymentState==='已支付'&&o.entitlementState==='已生效'&&(!adjustment.orderId||o.id===adjustment.orderId));
 const order=orders.length===1?orders[0]:null;
 if(!order||order.transferHistory?.length||adjustment.type==='补课'&&!adjustment.consumptionEnabled)return null;
 return {order,sourceSessionId:workflowSessionKey(source),adjustment};
}

// Called by the page renderer after it resolves the selected scheduleId.
function academicSessionRenderAction(action){
 if(!workflowGuard('academic'))return;
 const c=academicAuditSession(),box=$('#workflow-session-action');if(!c||!box)return;
 if(!academicAuditOperable(c)){box.innerHTML='<p class="notice">该课次已取消或停用，不能办理教学操作。</p>';return}
 if(action==='move')return academicRepairRenderSessionMove();
 if(action==='attendance'){
  box.innerHTML=`${workflowSessionRoster(c).map(s=>{const prior=a.attendance.find(x=>academicAuditRowMatches(x,c,s.id));return `<div class="filters"><b>${esc(s.name)}</b><select class="select wf-attendance" aria-label="${esc(s.name)}的出勤" data-student="${esc(s.id)}">${['未考勤','到课','请假','旷课'].map(v=>`<option ${prior?.attendance===v?'selected':''}>${v}</option>`).join('')}</select><label><input class="wf-consume" type="checkbox" data-student="${esc(s.id)}" ${prior?.consumptionConfirmed?'checked':''}>确认本讲课消</label></div>`}).join('')}<button class="btn primary" onclick="workflowSaveSessionAttendance()">保存点名与课消</button>`;
  return;
 }
 if(action==='record'){
  const prior=(academicAuditBase(c)?.sessions||[]).find(x=>x.sessionId===workflowSessionKey(c)&&x.record);
  box.innerHTML=`<label for="workflow-teaching-note">本节实际授课内容与课堂情况</label><textarea id="workflow-teaching-note" class="textarea">${esc(prior?.record||'')}</textarea><button class="btn primary" onclick="workflowSaveTeachingRecord()">保存授课记录</button>`;
  return;
 }
 if(action==='substitute'){
  const names=academicAuditTeachers().filter(x=>x!==c.teacher);
  const current=academicRepairTeacher(c);
  box.innerHTML=`<select class="select" id="workflow-substitute" aria-label="本节代课老师"><option value="">请选择代课老师</option>${names.map(x=>`<option ${x===current?'selected':''}>${esc(x)}</option>`).join('')}</select><button class="btn primary" onclick="workflowConfirmSubstitute()">确认代课</button>`;
 }
}

const academicAuditPreviousAttendance=workflowSaveSessionAttendance;
workflowSaveSessionAttendance=auditAtomic(function(){
 if(!workflowGuard('academic'))return;
 const c=academicAuditSession();if(!c){toast('课次不存在，请重新选择');return}
 if(!academicAuditOperable(c)){toast('该课次已取消或停用，不能保存考勤');return}
 if(!c.scheduleId)return academicAuditPreviousAttendance();
 const index=academicClassIndex(c),sessionId=workflowSessionKey(c),roster=new Set(workflowSessionRoster(c).map(s=>s.id)),controls=[...document.querySelectorAll('.wf-attendance')],boxes=[...document.querySelectorAll('.wf-consume')],seen=new Set(),plan=[];
 for(const control of controls){
  const studentId=control.dataset.student,status=control.value;
  if(!roster.has(studentId)||seen.has(studentId)||!['未考勤','到课','请假','旷课'].includes(status)){toast('点名对象不在本节名单或记录重复，请刷新后重试');return}seen.add(studentId);
  const consume=!!boxes.find(x=>x.dataset.student===studentId)?.checked,error=sysAttendanceError(c,status,consume);if(error){toast(error);return}
  const matches=a.attendance.filter(row=>academicAuditRowMatches(row,c,studentId));if(matches.length>1){toast('本节考勤记录重复，请先核对历史记录');return}
  const adjustments=(a.sessionAdjustments||[]).filter(x=>x.studentId===studentId&&academicAuditAdjustmentMatches(x,c));
  if(adjustments.length>1){toast('本节调班或补课记录重复，请先核对');return}
  let link=null;
  if(adjustments.length)link=academicAuditAdjustmentOrder(adjustments[0],c,studentId);
  else {
   const orders=a.orders.filter(o=>o.studentId===studentId&&o.classId===c.id&&o.paymentState==='已支付'&&o.entitlementState==='已生效');
   if(orders.length===1)link={order:orders[0],sourceSessionId:sessionId};
  }
  if(consume){
   const amount=consumptionAllocation(link?.order,c.lessonId);
   if(!link||amount===null){toast('缺少唯一有效实收订单或报名讲次，不能确认课消；可以取消课消勾选后保存出勤');return}
   if(a.attendance.some(row=>{if(row===matches[0]||row.consumptionConfirmed!==true)return false;const resolved=consumptionResolve(row);return (resolved.order?.id===link.order.id||row.orderId===link.order.id||row.sourceOrderId===link.order.id)&&resolved.lessonId===c.lessonId})){toast('该订单的本讲已经确认课消，不能重复扣课');return}
   link.amountCents=amount;
  }
  plan.push({studentId,status,consume,prior:matches[0],link,adjustment:adjustments[0]});
 }
 for(const item of plan){
  const row=item.prior||{};if(!item.prior)a.attendance.push(row);
  Object.assign(row,{classId:c.id,classIndex:index,scheduleId:c.scheduleId,studentId:item.studentId,studentIndex:a.students.findIndex(s=>s.id===item.studentId),sessionId,date:c.date,time:c.time,session:c.lessonId,lessonId:c.lessonId,lessonVersion:c.lessonVersion,status:item.status==='未考勤'?'未考勤':'已考勤',attendance:item.status,consumptionConfirmed:item.consume});
  if(item.link){row.orderId=item.link.order.id;row.sourceOrderId=item.link.order.id;row.consumptionSourceSessionId=item.link.sourceSessionId}
  if(item.consume)row.consumptionAmountCents=item.link.amountCents;else delete row.consumptionAmountCents;
  if(item.adjustment?.type==='补课'){row.makeupAppointmentId=item.adjustment.id;item.adjustment.consumptionState=item.consume?'已确认课消':'待确认'}
 }
 workflowPersist();toast('本节点名与课消已保存');
});

const academicAuditPreviousRowAttendance=saveAttendance;
saveAttendance=auditAtomic(function(index){
 if(!workflowGuard('academic'))return;
 const row=a.attendance[index];if(!row?.scheduleId)return academicAuditPreviousRowAttendance(index);
 const base=row.classId?a.classes.find(c=>c.id===row.classId):a.classes[row.classIndex],value=$('#attendance-choice')?.value;
 if(!base){toast('考勤关联班级不存在');return}
 const planned=academicAuditEntries().find(x=>x.c.id===base.id&&workflowSessionKey(x.c)===row.sessionId)?.c||base;
 if(!academicAuditOperable(planned)){toast('该课次已取消或停用，不能保存考勤');return}
 if(!['出勤','到课','迟到','早退','请假','旷课'].includes(value)){toast('请选择出勤情况');return}
 const error=sysAttendanceError({...base,date:row.date,time:row.time},value,row.consumptionConfirmed);if(error){toast(error);return}
 row.attendance=value;row.status='已考勤';a.modal=null;workflowPersist();academicRender();toast('考勤已保存');
});

const academicAuditPreviousTeaching=workflowSaveTeachingRecord;
workflowSaveTeachingRecord=auditAtomic(function(){
 if(!workflowGuard('academic'))return;
 const c=academicAuditSession();if(!c){toast('课次不存在，请重新选择');return}
 if(!academicAuditOperable(c)){toast('该课次已取消或停用，不能保存授课记录');return}
 if(!c.scheduleId)return academicAuditPreviousTeaching();
 const record=$('#workflow-teaching-note')?.value.trim();if(!record){toast('请填写授课内容与课堂情况');return}
 const base=academicAuditBase(c),sessionId=workflowSessionKey(c);base.sessions=base.sessions||[];
 let row=base.sessions.find(x=>x.sessionId===sessionId&&x.record);if(!row){row={sessionId};base.sessions.push(row)}
 Object.assign(row,{scheduleId:c.scheduleId,date:c.date,time:c.time,lessonId:c.lessonId,lessonVersion:c.lessonVersion,actualTeacher:academicRepairTeacher(c),record,updatedAt:new Date().toISOString()});
 workflowPersist();toast('授课记录已保存');
});

workflowConfirmSubstitute=auditAtomic(function(){
 if(!workflowGuard('academic'))return;
 const c=academicAuditSession();if(!c){toast('课次不存在，请重新选择');return}
 if(!academicAuditOperable(c)){toast('该课次已取消或停用，不能安排代课');return}
 const teacher=$('#workflow-substitute')?.value;if(!teacher){toast('请选择代课老师');return}
 const sessionId=workflowSessionKey(c),conflict=academicAuditEntries().find(({c:x})=>workflowSessionKey(x)!==sessionId&&!['已取消','已停用'].includes(x.status)&&academicRepairTeacher(x)===teacher&&academicRepairOverlap(c,x));
 if(conflict){toast(`代课老师 ${teacher} 在 ${conflict.c.time} 已有重叠课程`);return}
 if(!academicAuditTeachers().includes(teacher)){toast('请选择已登记且在职的授课老师');return}
 const base=academicAuditBase(c);base.sessions=base.sessions||[];
 let row=base.sessions.find(x=>x.sessionId===sessionId&&x.substitute);if(!row){row={sessionId};base.sessions.push(row)}
 Object.assign(row,{scheduleId:c.scheduleId,date:c.date,time:c.time,lessonId:c.lessonId,lessonVersion:c.lessonVersion,substitute:teacher});
 workflowPersist();if(state.page==='sessionFlow')render();toast('本节代课已更新');
});
