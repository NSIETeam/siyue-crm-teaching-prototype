/* One order/lesson projection shared by attendance, finance, refunds and CLI simulation. */
function consumptionCents(value){const text=String(value??'').replace(/[¥￥,\s]/g,'');return /^\d+(\.\d{1,2})?$/.test(text)&&Number.isSafeInteger(Math.round(Number(text)*100))?Math.round(Number(text)*100):null}
function consumptionValidLessons(lessons){return Array.isArray(lessons)&&lessons.length>0&&lessons.every(l=>l&&typeof l.id==='string'&&l.id.trim()===l.id&&l.id.length>0)&&new Set(lessons.map(l=>l.id)).size===lessons.length}
function consumptionAllocation(order,lessonId){const lessons=order?.lessonSnapshot,paid=consumptionCents(order?.paid);if(!consumptionValidLessons(lessons)||paid===null)return null;const index=lessons.findIndex(x=>x.id===lessonId);return index<0?null:Math.floor(paid/lessons.length)+(index<paid%lessons.length?1:0)}
function consumptionResolve(row){
 const student=row.studentId?a.students.find(s=>s.id===row.studentId):a.students[row.studentIndex],c=row.classId?a.classes.find(c=>c.id===row.classId):a.classes[row.classIndex];
 if(!student||!c)return {row,student,c,error:'关联档案缺失'};
 const explicit=row.orderId||row.sourceOrderId,orders=a.orders.filter(o=>o.studentId===student.id&&o.paymentState==='已支付'&&(explicit?o.id===explicit:o.classId===c.id));
 if(orders.length!==1)return {row,student,c,error:'实收订单无法唯一确定'};
 const order=orders[0],lessons=Array.isArray(order.lessonSnapshot)?order.lessonSnapshot:[],named=lessons.filter(l=>l?.title===row.session),lessonId=row.lessonId||(lessons.some(l=>l?.id===row.session)?row.session:null)||(named.length===1?named[0].id:null)||(row.sessionId===workflowSessionKey(c)?c.lessonId:null),amountCents=consumptionAllocation(order,lessonId);
 if(row.orderId&&row.sourceOrderId&&row.orderId!==row.sourceOrderId)return {row,student,c,order,lessonId,error:'订单关联字段不一致'};
 return {row,student,c,order,lessonId,amountCents,key:order.id+'|'+lessonId,error:amountCents===null?'讲次或实收依据缺失':null};
}
function consumptionLedger(){const seen=new Set();return a.attendance.filter(r=>r.consumptionConfirmed===true).map(consumptionResolve).filter(x=>{if(x.error)return true;if(seen.has(x.key))return false;seen.add(x.key);return true})}
const consumptionSaveAttendance=workflowSaveSessionAttendance;
workflowSaveSessionAttendance=function(){
 if(!workflowGuard('academic'))return;
 const c=a.classes[workflowState.selectedSession?.classIndex];if(!c){toast('课次不存在，请重新选择');return}
 const roster=new Set(workflowSessionRoster(c).map(s=>s.id)),controls=[...document.querySelectorAll('.wf-attendance')],boxes=[...document.querySelectorAll('.wf-consume')],seen=new Set(),links=[];
 for(const el of controls){
  const id=el.dataset.student;if(!roster.has(id)||seen.has(id)||!['未考勤','到课','请假','旷课'].includes(el.value)){toast('点名对象不在本节名单或记录重复，请刷新后重试');return}seen.add(id);
  const consume=boxes.find(e=>e.dataset.student===id)?.checked;
  const ruleError=sysAttendanceError(c,el.value,consume);if(ruleError){toast(ruleError);return}
  const adjustment=(a.sessionAdjustments||[]).find(x=>x.studentId===id&&x.targetClassId===c.id&&x.date===c.date&&x.status==='已确认');
  // The adjustment handler binds makeup/temporary lessons to their original entitlement.
  if(adjustment)continue;
  if(!consume)continue;
  const orders=a.orders.filter(o=>o.studentId===id&&o.classId===c.id&&o.paymentState==='已支付'&&o.entitlementState==='已生效');
  const order=orders.length===1?orders[0]:null,amountCents=consumptionAllocation(order,c.lessonId);
  if(!order||amountCents===null){toast('缺少唯一有效实收订单或报名讲次，不能确认课消；可以取消课消勾选后保存出勤');return}
  if(consumptionLedger().some(x=>!x.error&&x.order.id===order.id&&x.lessonId===c.lessonId&&x.row.sessionId!==workflowSessionKey(c))){toast('该订单的本讲已经确认课消，不能重复扣课');return}
  links.push({id,order,amountCents});
 }
 const result=consumptionSaveAttendance();
 for(const {id,order} of links){const row=a.attendance.find(r=>r.studentId===id&&r.sessionId===workflowSessionKey(c));if(row?.consumptionConfirmed){row.orderId=order.id;row.sourceOrderId=order.id;row.consumptionSourceSessionId=workflowSessionKey(c)}}
 for(const row of a.attendance.filter(r=>r.sessionId===workflowSessionKey(c))){row.classId=c.id;row.lessonId=c.lessonId;if(row.consumptionConfirmed){const resolved=consumptionResolve(row);if(!resolved.error)row.consumptionAmountCents=resolved.amountCents}}
 workflowPersist();return result;
};
const consumptionRefundEstimate=workflowRefundEstimate;
function consumptionRelatedError(entry,order,si,ci){
 if(!entry.error)return false;const row=entry.row;
 if(row.orderId===order.id||row.sourceOrderId===order.id)return true;
 const sameStudent=row.studentId?row.studentId===order.studentId:row.studentIndex===si;if(!sameStudent)return false;
 if((row.classId?row.classId===order.classId:row.classIndex===ci)||entry.c?.id===order.classId)return true;
 if([row.consumptionSourceSessionId,row.sourceSessionId].some(id=>typeof id==='string'&&id.startsWith(order.classId+'|')))return true;
 return (a.sessionAdjustments||[]).some(x=>x.studentId===order.studentId&&(x.orderId===order.id||x.sourceClassId===order.classId)&&(row.makeupAppointmentId===x.id||x.targetClassId===(row.classId||entry.c?.id)&&x.date===row.date));
}
workflowRefundEstimate=function(si,ci){const est=consumptionRefundEstimate(si,ci);if(!est.order)return est;const entries=consumptionLedger().filter(x=>x.order?.id===est.order.id||consumptionRelatedError(x,est.order,si,ci)),invalid=entries.some(x=>x.error);est.consumed=entries.length;est.consumedCents=entries.reduce((n,x)=>n+(x.error?0:x.amountCents||0),0);est.ready=est.ready&&!invalid&&consumptionValidLessons(est.order.lessonSnapshot);est.refund=est.ready?Math.max(0,(consumptionCents(est.order.paid)-est.consumedCents)/100):0;return est};
financeConsumptionPage=function(){
 const rows=consumptionLedger(),total=rows.reduce((n,x)=>n+(x.error?0:x.amountCents),0),invalid=rows.filter(x=>x.error).length;
 return `<div class="card consumption-summary" aria-label="课消记录"><div class="consumption-metrics"><strong>已确认课次 ${rows.length}</strong><strong>课消金额 ¥${(total/100).toFixed(2)}</strong>${invalid?`<span class="muted">${invalid} 条待核对</span>`:''}</div></div><div class="card pad"><div class="toolbar consumption-toolbar"><input class="input" placeholder="搜索学生、课程或订单" oninput="filterRows(this.value)"><div class="actions">${permissionState.identity==='admin'?'<button class="btn" onclick="consumptionDemoOpen()">CLI 课消演示</button>':''}<button class="btn" onclick="nav('attendance')">前往考勤</button></div></div>${rows.length?aTable(['学生','课程 / 班级','讲次','日期时间','关联订单','课消金额'],rows.map(x=>`<tr><td>${esc(x.student?.name||'档案缺失')}<div class="muted">${esc(x.student?.id||x.row.studentId||'')}</div></td><td>${esc(x.c?.course||'—')}<div class="muted">${esc(x.c?.name||'—')}</div></td><td>${esc(x.order?.lessonSnapshot?.find(l=>l.id===x.lessonId)?.title||x.row.session||'—')}</td><td>${esc(x.row.date||'')} ${esc(x.row.time||'')}</td><td>${esc(x.order?.id||'待核对')}${x.row.simulationRunId?'<div class="muted">CLI 演示数据</div>':''}</td><td>${x.error?esc(x.error):'¥'+(x.amountCents/100).toFixed(2)}</td></tr>`)):'<div class="empty">暂无已确认课消</div>'}</div>`;
};
