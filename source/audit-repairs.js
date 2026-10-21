/* Final integration checks for the local prototype. No real payment or server auth. */
const auditBusinessKey='siyue-workflow-demo-v2';
let auditTransactionDepth=0;
function auditId(prefix){return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,10)}`}
function auditBusinessSnapshot(){return {courses:a.courses,classes:a.classes,students:a.students,attendance:a.attendance,orders:a.orders,refunds:a.refunds||[],sessionAdjustments:a.sessionAdjustments||[],batchLogs:a.batchLogs||[],shelved:mallState.shelved,hiddenShelved:mallState.hiddenShelved,groups:mallState.activities.group,joints:mallState.activities.joint,leads:leadState.leads,offers:mallState.activities.coupon}}
try{const saved=JSON.parse(localStorage.getItem(auditBusinessKey));if(saved){if(Array.isArray(saved.hiddenShelved))mallState.hiddenShelved=saved.hiddenShelved;if(Array.isArray(saved.groups))mallState.activities.group=saved.groups;if(Array.isArray(saved.joints))mallState.activities.joint=saved.joints}}catch{}
batchSavePayload=auditBusinessSnapshot;
workflowPersist=function(){if(auditTransactionDepth)return true;localStorage.setItem(auditBusinessKey,JSON.stringify(auditBusinessSnapshot()));return true};
// Defer the one authoritative write and success feedback until the whole operation succeeds.
function auditAtomic(fn){return function(...args){
 if(auditTransactionDepth)return fn.apply(this,args);
 const before=JSON.stringify(auditBusinessSnapshot()),ui={page:state.page,mode:state.mode,academic:JSON.parse(JSON.stringify(a)),lead:JSON.parse(JSON.stringify(leadState)),workflow:JSON.parse(JSON.stringify(workflowState))},messages=[],notify=toast;
 auditTransactionDepth++;toast=(...message)=>messages.push(message);
 let result,failure;
 try{result=fn.apply(this,args);const after=JSON.stringify(auditBusinessSnapshot());if(after!==before)localStorage.setItem(auditBusinessKey,after)}catch(error){failure=error;const snapshot=JSON.parse(before);Object.assign(a,ui.academic);Object.assign(leadState,ui.lead);Object.assign(workflowState,ui.workflow);mallState.shelved=snapshot.shelved;mallState.hiddenShelved=snapshot.hiddenShelved;mallState.activities.coupon=snapshot.offers;mallState.activities.group=snapshot.groups;mallState.activities.joint=snapshot.joints;state.page=ui.page;state.mode=ui.mode}finally{auditTransactionDepth--;toast=notify}
 if(failure){render();notify('本次操作未保存，数据已还原，请重试或联系管理员。');console.error('Prototype operation rolled back',failure);return false}
 messages.forEach(message=>notify(...message));return result;
}}
const auditMayBase=workflowMay;
workflowMay=function(action,record){if(permissionState.identity==='admin')return true;const role=permissionRole();if(!role?.active)return false;if(action==='payment')return permissionState.identity==='finance'&&permissionCanVisit('orders');if(action==='refundPayment')return permissionState.identity==='finance'&&permissionCanVisit('financeRefunds');if(action==='lead'&&!permissionCanVisit('quickRegister'))return false;return auditMayBase(action,record)};
const auditQuoteBase=workflowBuildQuote;
workflowBuildQuote=function(){const previous=a.selectedStudent;try{if(previous===null&&a.enrollmentDraft){const d=a.enrollmentDraft,i=a.students.findIndex(s=>s.name===d.name&&s.phone===d.phone);if(i>=0)a.selectedStudent=i}return auditQuoteBase()}finally{a.selectedStudent=previous}};
finishEnroll=function(){
 if(!workflowGuard('enroll'))return;if(!sysRules.entry.enabled){toast('系统配置已暂停新报名');return}const target=a.classes[a.selectedClass];if(target&&!sysRules.entry.allowMidCourse&&!sysFirstLesson(target)){toast('当前进班配置不允许中途插班');return}
 const q=workflowBuildQuote();if(!q.c||!q.course||q.course.active===false||!batchValidTime(q.c)||['已结课','已取消'].includes(q.c.status)){toast('请选择可报名的课程与班级');return}
 const student=q.student;if(!student?.name?.trim()||!student?.phone?.trim()){toast('请填写学生姓名和联系电话');return}
 if(!Number.isFinite(q.price)||q.price<0||!Number.isFinite(q.total)||q.total<0){toast('课程价格或优惠配置无效');return}
 if(student.id&&(batchRoster(q.c,student)||a.orders.some(o=>o.studentId===student.id&&o.classId===q.c.id&&o.entitlementState!=='已退课'))){toast('该学生已有本班名单或未关闭订单，请勿重复报名');return}
 const pending=a.orders.filter(o=>o.classId===q.c.id&&o.paymentState==='待支付'&&o.entitlementState!=='已退课').length;
 if(!Number.isInteger(Number(q.c.capacity))||Number(q.c.capacity)<=batchOccupied(q.c)+pending){toast('班级容量不足，待支付订单已占用预留名额');return}
 if(student.id&&a.classes.some(c=>c.id!==q.c.id&&workflowSessionRoster(c).some(s=>s.id===student.id)&&batchOverlap(c,q.c))){toast('学生上课时间冲突，请更换班级');return}
 const saved=student.id?student:{...student,id:auditId('ST'),status:'潜在',className:'—',classIds:[]};if(!student.id)a.students.push(saved);
 a.orders.unshift({id:auditId('ORD'),product:q.c.course,student:saved.name,studentId:saved.id,originLeadId:a.enrollmentDraft?.originLeadId||saved.originLeadId||null,courseId:q.course.id,quoteSnapshot:{base:q.price,discount:q.discount,total:q.total,offerId:q.offer?.id||null,offerName:q.offer?.name||'',offerVersion:q.offer?.version||null},lessonSnapshot:(q.course.lessons||[]).map(x=>({id:x.id,title:x.title})),amount:`¥${q.total.toFixed(2)}`,paid:'¥0.00',status:'等待付款',paymentState:'待支付',entitlementState:'未生效',classId:q.c.id});
 saved.enrollmentStatus='待支付';a.enrollmentDraft=null;a.enrollStep=1;a.selectedClass=null;a.selectedStudent=null;workflowPersist();nav('orders');toast('待支付订单已创建');
};
workflowSimulatePayment=function(id){
 if(!workflowGuard('payment'))return;const o=a.orders.find(x=>x.id===id),c=a.classes.find(x=>x.id===o?.classId),s=a.students.find(x=>x.id===o?.studentId);
 if(!o||!c||!s||workflowOrderClosed(o)){toast('订单或关联档案无效');return}
 const amount=withdrawalMoney(o.amount),received=withdrawalMoney(o.paid);if(amount===null||received===null||received>amount){toast('订单金额无效');return}if(o.paymentState==='已支付'&&received===amount){toast('该订单已确认到账，请勿重复操作');return}if(!batchRoster(c,s)&&batchOccupied(c)>=Number(c.capacity)){toast('班级已满，请先处理名额');return}
 o.paid=o.amount;o.status='交易成功';o.paymentState='已支付';o.entitlementState='已生效';s.status='在读';s.enrollmentStatus='已生效';const count=batchOccupied(c);if(!batchRoster(c,s))c.students=count+1;c.studentIds=[...new Set([...(c.studentIds||[]),s.id])];s.classIds=[...new Set([...(s.classIds||[]),c.id])];s.className=c.name;
 const lead=leadState.leads.find(l=>l.leadId===o.originLeadId);if(lead){lead.stage='已报名';lead.history=lead.history||[];lead.history.push(['支付确认','今天',`订单 ${o.id} 到账，课程权益已生效。`])}workflowPersist();render();toast('模拟到账成功，课程权益已生效');
};
const auditEstimateBase=workflowRefundEstimate;
workflowRefundEstimate=function(si,ci){const x=auditEstimateBase(si,ci);x.ready=x.ready&&Number.isFinite(x.paid)&&x.paid>=0&&Number.isFinite(x.refund)&&x.refund>=0&&x.refund<=x.paid;return x};
workflowConfirmRefund=function(id){if(!workflowGuard('refundPayment'))return;const r=(a.refunds||[]).find(x=>x.id===id),o=a.orders.find(x=>x.id===r?.orderId);if(!r||r.status!=='待财务退款'){toast('该退款已处理或不存在');return}if(r.withdrawalVersion===1)return withdrawalConfirmRefund(id);if(!o||o.entitlementState!=='已退课'||!Number.isFinite(r.amount)||r.amount<0||r.amount>money(o.paid)){toast('退款依据或金额无效');return}r.status='已模拟退款';r.completedAt=new Date().toISOString();o.refundState='已退款';o.refundedAmount=r.amount;workflowPersist();render();toast('模拟退款已确认，历史记录保留')};
const auditLegacyAttendance=saveAttendance;saveAttendance=function(...args){if(!workflowGuard('academic'))return;return auditLegacyAttendance(...args)};
for(const name of ['saveAttendance','finishEnroll','workflowSimulatePayment','finishFlow','workflowConfirmRefund','withdrawalConfirmRefund','saveLead','saveFollow','archiveLead','leadToEnrollment','assignLead','reactivateLead','workflowCommitTransfer','workflowCommitRelease','saveCourse','saveClass','workflowSaveSessionAttendance','workflowSaveTeachingRecord','workflowCommitMove','workflowConfirmSubstitute','academicConfirmMakeup','saveMakeup','academicMarkNoMakeup']){const fn=globalThis[name];if(typeof fn==='function')globalThis[name]=auditAtomic(fn)}

// Render once after all authoritative state and final handlers are restored.
render();
