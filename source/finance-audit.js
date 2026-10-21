/* Enrollment/finance invariants for the browser prototype. No payment gateway is connected. */
function financeCents(value){const amount=withdrawalMoney(value);return amount===null?null:Math.round(amount*100)}
function financeUnique(items,id){if(id===null||id===undefined||String(id).trim()==='')return null;const matches=items.filter(x=>x.id===id);return matches.length===1?matches[0]:null}
function financeActor(){return typeof workflowCurrentActor==='function'?workflowCurrentActor():null}
function financeScopeRecord(student,c,order){const lead=leadState.leads.find(l=>l.leadId===(student?.originLeadId||order?.originLeadId));return {campusId:c?.campusId||order?.campusId||student?.campusId,campus:c?.campus||order?.campus||student?.campus,ownerId:student?.ownerId||order?.ownerId||lead?.ownerId,assigneeId:student?.assigneeId||order?.assigneeId||lead?.assigneeId}}
function financeRecordAllowed(student,c,order){
 const actor=financeActor();if(!actor)return !window.SIYUE_AUTH_API;
 if(actor.scope?.type==='all')return true;const record=financeScopeRecord(student,c,order);
 if(actor.scope?.type==='campus')return (actor.scope.campusIds||[]).includes(record.campusId||record.campus);
 return !!actor.id&&[record.ownerId,record.assigneeId].includes(actor.id);
}
function financeEnrollmentAllowed(student,c){const actor=financeActor();if(!student?.id&&actor){const lead=leadState.leads.find(l=>l.leadId===student?.originLeadId);return financeRecordAllowed({...student,ownerId:lead?.ownerId||(!student?.originLeadId?actor.id:undefined),assigneeId:lead?.assigneeId},c)}return financeRecordAllowed(student,c)}
function financeCanReadOrder(order){return financeRecordAllowed(a.students.find(s=>s.id===order?.studentId),a.classes.find(c=>c.id===order?.classId),order)}
function financeCanReadRefund(refund){const order=a.orders.find(o=>o.id===(refund?.orderId||refund?.orderIds?.[0]));return financeRecordAllowed(a.students.find(s=>s.id===(refund?.studentId||order?.studentId)),a.classes.find(c=>c.id===(refund?.classId||order?.classId)),order)}
function financeScopeDenied(){toast('无此数据范围的操作权限，或档案缺少校区与负责人授权关联，请联系管理员核对')}
function financeCourseForClass(c){if(!c)return null;const rows=a.courses.filter(x=>c.courseId?x.id===c.courseId:x.name===c.course);return rows.length===1?rows[0]:null}
batchCourse=financeCourseForClass;
function financeClassError(c){
 if(!c||!financeUnique(a.classes,c.id)||!scScheduledClassActive(c))return '班级已结束、停用或不存在，请重新选班';
 if(!batchValidTime(c))return '班级排课时间无效，请先修正排课';
 const course=financeCourseForClass(c);if(!course||course.active===false)return '关联课程不存在、不唯一或已停用';
 return '';
}
function financeStudentConflict(student,c,excludeOrderId){
 if(!student?.id)return false;
 const sessions=typeof academicScheduledClasses==='function'?academicScheduledClasses().map(x=>x.c):a.classes;
 if(sessions.some(other=>other.id!==c.id&&workflowSessionRoster(other).some(s=>s.id===student.id)&&batchOverlap(other,c)))return true;
 return a.orders.some(o=>o.id!==excludeOrderId&&o.studentId===student.id&&o.classId!==c.id&&!workflowOrderClosed(o)&&o.paymentState==='待支付'&&batchOverlap(a.classes.find(x=>x.id===o.classId)||{},c));
}
function financeEnrollmentStudent(){
 if(a.selectedStudent!==null)return a.students[a.selectedStudent];
 const draft=a.enrollmentDraft;if(!draft)return draft;
 const name=String(draft.name||'').trim(),phone=String(draft.phone||'').trim(),matches=a.students.filter(s=>s.name===name&&s.phone===phone);
 return matches.length===1?matches[0]:{...draft,name,phone,ambiguous:matches.length>1};
}
function financeOfferDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return false;const d=new Date(value+'T12:00:00');return !isNaN(d)&&d.getFullYear()===+value.slice(0,4)&&d.getMonth()+1===+value.slice(5,7)&&d.getDate()===+value.slice(8,10)}
let financeQuoteReservations=null;
function financeOfferEligible(offer,student,course,price){
 const today=batchToday(),cut=financeCents(offer.discount??String(offer.offer||'').match(/减([\d.]+)/)?.[1]),threshold=financeCents(offer.threshold??String(offer.offer||'').match(/满([\d.]+)/)?.[1]??0),kind=offer.template||'通用优惠';
 if(offer.status!=='进行中'||offer.published===false||!financeOfferDate(offer.start)||!financeOfferDate(offer.end)||offer.start>today||offer.end<today||cut===null||cut<=0||threshold===null||price<threshold)return false;
 if(!['通用优惠','续费','老带新','双人同行','多科联报'].includes(kind)||offer.scope&&!['全部商品','全部课程','指定课程'].includes(offer.scope))return false;
 if(offer.scope==='指定课程'&&!offer.courseId||offer.courseId&&offer.courseId!==course?.id)return false;
 const orders=a.orders.filter(o=>!workflowOrderClosed(o)&&o.quoteSnapshot?.offerId===offer.id),reservations=(financeQuoteReservations||[]).filter(x=>x.offerId===offer.id);
 const used=Math.max(Number.isInteger(Number(offer.used))?Number(offer.used):0,orders.length),limit=offer.total==null?null:Number(offer.total),per=offer.maxPerUser??offer.perUser;
 if(limit!==null&&(!Number.isInteger(limit)||limit<1||used+reservations.length>=limit))return false;
 if(per!=null&&(!Number.isInteger(Number(per))||Number(per)<1||orders.filter(o=>o.studentId===student?.id).length+reservations.filter(x=>x.studentId===student?.id).length>=Number(per)))return false;
 const paid=a.orders.some(o=>o.studentId===student?.id&&o.paymentState==='已支付'&&o.entitlementState==='已生效'&&!workflowOrderClosed(o));
 if(kind==='续费')return !!student?.id&&paid;
 // The prototype has no verified referral register. An arbitrary ID is not eligibility evidence.
 if(kind==='老带新')return false;
 if(kind==='双人同行'){const joined=[...new Set(offer.joinedStudentIds||[])].filter(id=>financeUnique(a.students,id));return !!student?.id&&joined.includes(student.id)&&joined.length>=2}
 if(kind==='多科联报'){const ids=[...new Set(a.enrollmentDraft?.courseIds||[])],courses=ids.map(id=>financeUnique(a.courses,id));return ids.includes(course?.id)&&courses.length>=2&&courses.every(x=>x&&x.active!==false&&x.subject)&&new Set(courses.map(x=>x.subject)).size>=2}
 return true;
}
workflowBuildQuote=function(){
 const student=financeEnrollmentStudent(),c=a.classes[a.selectedClass],course=financeCourseForClass(c),priceCents=financeCents(course?.product?.price??course?.fee);let offer=null,discountCents=0;
 if(priceCents!==null)for(const candidate of mallState.activities.coupon){if(!financeOfferEligible(candidate,student,course,priceCents))continue;const cut=Math.min(priceCents,financeCents(candidate.discount??String(candidate.offer||'').match(/减([\d.]+)/)?.[1]));if(cut>discountCents){offer=candidate;discountCents=cut}}
 return {student,c,course,price:priceCents===null?NaN:priceCents/100,offer,discount:discountCents/100,total:priceCents===null?NaN:(priceCents-discountCents)/100,why:offer?`已匹配「${offer.name}」：${offer.qualification||'满足当前优惠条件'}`:'当前没有符合条件且在有效期内的优惠'};
};
const financeBatchPrice=batchPrice;
batchPrice=function(student,c){const quote=financeBatchPrice(student,c);if(financeQuoteReservations&&quote.offerId)financeQuoteReservations.push({offerId:quote.offerId,studentId:student.id});return quote};
const financeBatchEnrollmentPlan=batchEnrollmentPlan;
batchEnrollmentPlan=function(draft,ids){
 const previous=financeQuoteReservations;financeQuoteReservations=[];
 try{const plan=financeBatchEnrollmentPlan(draft,ids);for(const row of plan.rows){const c=financeUnique(a.classes,row.data.classId),s=financeUnique(a.students,row.data.studentId),problem=financeClassError(c);if(problem)row.errors.push(problem);if(!s)row.errors.push('学生档案不存在或编号不唯一，请重新选择');if(!financeEnrollmentAllowed(s,c))row.errors.push('学生不在授权范围，或档案缺少负责人关联');if(s&&c&&financeStudentConflict(s,c))row.errors.push('与学生已有课次或待支付报名时段冲突');}return plan}
 finally{financeQuoteReservations=previous}
};
const financeBatchSuggestions=batchEnrollmentSuggestions;
batchEnrollmentSuggestions=function(row){return financeBatchSuggestions(row).filter(c=>!financeClassError(c))};
finishEnroll=auditAtomic(function(){
 if(!workflowGuard('enroll'))return;if(!sysRules.entry.enabled){toast('系统配置已暂停新报名');return}
 const q=workflowBuildQuote(),error=financeClassError(q.c);if(error){toast(error);return}
 if(!sysRules.entry.allowMidCourse&&!sysFirstLesson(q.c)){toast('当前进班配置不允许中途插班');return}
 const student=q.student;if(!student?.name?.trim()||!student?.phone?.trim()){toast('请填写学生姓名和联系电话');return}
 if(!financeEnrollmentAllowed(student,q.c)){financeScopeDenied();return}
 if(student.ambiguous||a.selectedStudent!==null&&!student.id||student.id&&!financeUnique(a.students,student.id)){toast('学生档案无法唯一确定，请选择明确的已有学生');return}
 if(!Number.isFinite(q.price)||!Number.isFinite(q.total)){toast('课程价格无效，请填写最多两位小数的非负金额');return}
 if(student.id&&batchEnrollmentDuplicate(student,q.c)){toast('该学生已有本班名单或未关闭订单，请勿重复报名');return}
 const capacity=Number(q.c.capacity);if(!Number.isInteger(capacity)||capacity<=batchOccupied(q.c)+batchEnrollmentPending(q.c)){toast('班级容量不足，待支付订单已占用预留名额');return}
 if(financeStudentConflict(student,q.c)){toast('与学生已有课次或待支付报名时段冲突，请更换班级');return}
 const saved=student.id?student:{...student,...(financeActor()?.id?{ownerId:financeActor().id}:{}),id:auditId('ST'),status:'潜在',className:'—',classIds:[]};if(!student.id)a.students.push(saved);
 a.orders.unshift({id:auditId('ORD'),product:q.c.course,student:saved.name,studentId:saved.id,ownerId:saved.ownerId,assigneeId:saved.assigneeId,campus:q.c.campus,campusId:q.c.campusId,originLeadId:a.enrollmentDraft?.originLeadId||saved.originLeadId||null,courseId:q.course.id,quoteSnapshot:{base:q.price,discount:q.discount,total:q.total,offerId:q.offer?.id||null,offerName:q.offer?.name||'',offerVersion:q.offer?.version||null},lessonSnapshot:(q.course.lessons||[]).map(x=>({id:x.id,title:x.title})),amount:`¥${q.total.toFixed(2)}`,paid:'¥0.00',status:'等待付款',paymentState:'待支付',entitlementState:'未生效',classId:q.c.id});
 saved.enrollmentStatus='待支付';a.enrollmentDraft=null;a.enrollStep=1;a.selectedClass=null;a.selectedStudent=null;workflowPersist();nav('orders');toast('待支付订单已创建');
});
let financeEnrollmentReview=null;
function financeQuoteSignature(q){return JSON.stringify([q.student?.id||q.student?.name,q.c?.id,q.course?.id,q.price,q.discount,q.total,q.offer?.id,q.offer?.version])}
const financeEnrollmentQuote=siyueEnrollmentQuote;
siyueEnrollmentQuote=function(){financeEnrollmentReview=a.selectedClass===null?null:financeQuoteSignature(workflowBuildQuote());const q=workflowBuildQuote();return a.selectedClass!==null&&!Number.isFinite(q.total)?'<p class="notice">课程价格无效，请先修正价格后报名。</p>':financeEnrollmentQuote()};
const financeEnrollmentSubmit=siyueEnrollmentSubmit;
siyueEnrollmentSubmit=function(){if(financeEnrollmentReview&&financeEnrollmentReview!==financeQuoteSignature(workflowBuildQuote())){$('#single-enroll-quote').innerHTML=siyueEnrollmentQuote();toast('课程价格或优惠已变化，请核对新报价后再次提交');return}return financeEnrollmentSubmit()};
const financePreviousPayment=workflowSimulatePayment;
workflowSimulatePayment=function(id){
 if(!workflowGuard('payment'))return;const o=financeUnique(a.orders,id);if(!o){toast('订单不存在或编号不唯一');return}
 if(!financeCanReadOrder(o)){financeScopeDenied();return}
 const amount=financeCents(o.amount),paid=financeCents(o.paid);if(amount===null||paid===null||paid>amount){toast('订单金额无效，请先核对');return}
 if(o.entitlementState!=='已生效'&&!workflowOrderClosed(o)){
  const c=financeUnique(a.classes,o.classId),s=financeUnique(a.students,o.studentId),error=financeClassError(c);if(error||!s){toast(error||'学生档案不存在或编号不唯一');return}
  if(!Number.isInteger(Number(c.capacity))||Number(c.capacity)<1){toast('班级已满或容量无效，请先处理名额');return}
  if(financeStudentConflict(s,c,id)){toast('学生已有课次或待支付报名时间冲突，请先调整班级再确认到账');return}
 }
 return financePreviousPayment(id);
};
// Invalid money is never converted into a fictitious zero or a collectable debt.
workflowOrderOutstanding=function(o){const due=financeCents(o.amount),paid=financeCents(o.paid);return !workflowOrderClosed(o)&&due!==null&&paid!==null&&paid<due};
const financePreviousRefund=workflowConfirmRefund;
workflowConfirmRefund=auditAtomic(function(id){
 if(!workflowGuard('refundPayment'))return;const r=financeUnique(a.refunds||[],id);if(!r){toast('退款记录不存在或编号不唯一');return}
 if(!financeCanReadRefund(r)){financeScopeDenied();return}
 if(r.withdrawalVersion!==1){const o=financeUnique(a.orders,r.orderId),amount=financeCents(r.amount),paid=financeCents(o?.paid),previous=financeCents(o?.refundedAmount??0);if(!o||amount===null||paid===null||previous===null||amount>paid-previous){toast('退款金额超过剩余可退实收，或关联订单无效');return}}
 const order=r.withdrawalVersion!==1?financeUnique(a.orders,r.orderId):null,previous=order?financeCents(order.refundedAmount??0):null,pending=r.status==='待财务退款',result=financePreviousRefund(id);
 if(order&&pending&&r.status==='已模拟退款'){order.refundedAmount=(previous+financeCents(r.amount))/100;r.allocations=[{orderId:order.id,amount:Number(r.amount),paidKnown:true}];workflowPersist()}
 return result;
});
const financePreviousArrears=financeArrearsPage;
financeArrearsPage=function(){const invalid=a.orders.filter(o=>financeCanReadOrder(o)&&!workflowOrderClosed(o)&&(financeCents(o.amount)===null||financeCents(o.paid)===null||financeCents(o.paid)>financeCents(o.amount)));return (invalid.length?`<div class="finance-invalid-records">${invalid.length} 笔订单金额待核对，未计入可收欠费：${invalid.map(o=>esc(o.id)).join('、')}。请在收费订单中核对原始金额。</div>`:'')+financePreviousArrears()};
ordersPage=function(){
 const rows=a.orders.filter(financeCanReadOrder).map(o=>{const amount=financeCents(o.amount),paid=financeCents(o.paid),invalid=amount===null||paid===null||paid>amount,closed=workflowOrderClosed(o),due=!invalid?Math.max(0,amount-paid):null;return `<tr><td><strong>${esc(o.product)}</strong><div class="muted">${esc(o.id)}</div></td><td>${esc(o.student)}</td><td>${esc(o.amount)}</td><td>${esc(o.paid)}</td><td>${due===null?'金额待核对':'¥'+(due/100).toFixed(2)}</td><td><span class="badge">${esc(closed?'已关闭':invalid?'金额待核对':due>0?'待收款':o.paymentState||o.status)}</span><div class="help">权益：${esc(o.entitlementState||'待核验')}</div></td><td>${closed?'已关闭':invalid?'核对原始记录':financeQuickCollectable(o)?workflowMay('payment')?`<button class="btn small primary" onclick="financeOpenOrderPayment(${esc(JSON.stringify(o.id))})">${amount===0?'核对零元报名':'核对并模拟到账'}</button>`:'待财务核对':'已确认'}</td></tr>`});
 return `<div class="card pad"><div class="toolbar"><input class="input" placeholder="搜索商品或学生" oninput="filterRows(this.value)"><span class="notice">原型支付模拟，不连接真实支付渠道</span></div>${aTable(['商品 / 订单','学生','应收','实收','待收','支付与权益状态','操作'],rows)}</div>`;
};
const financePreviousFlow=flowPage;
const financePreviousFinishFlow=finishFlow;
finishFlow=function(type){if(type==='withdraw'&&!financeRecordAllowed(a.students[a.selectedStudent],a.classes[workflowState.refundClass])){financeScopeDenied();return}return financePreviousFinishFlow(type)};
flowPage=function(type){
 if(type!=='supplement')return financePreviousFlow(type);
 const selected=a.students[a.selectedStudent],items=a.orders.filter(o=>financeCanReadOrder(o)&&workflowOrderOutstanding(o)&&(!selected||o.studentId===selected.id));
 return `<div class="card pad"><div class="toolbar"><h2 class="section-title">补齐已有欠费</h2>${selected?`<span>${esc(selected.name)}</span><button class="btn" onclick="a.selectedStudent=null;academicRender()">查看全部</button>`:''}</div>${items.length?aTable(['订单','学生 / 课程','待补金额','操作'],items.map(o=>`<tr><td>${esc(o.id)}</td><td>${esc(o.student)} · ${esc(o.product)}</td><td>¥${((financeCents(o.amount)-financeCents(o.paid))/100).toFixed(2)}</td><td>${permissionCanVisit('financeArrears')?`<button class="btn small" onclick="financeOpenQuickActions(${esc(JSON.stringify(o.id))})">办理补齐欠费</button>`:'待财务办理'}</td></tr>`)):'<div class="empty">暂无待补齐的欠费</div>'}<p class="notice">额外加收费用的订单与收费规则尚未接入。此处只补齐已有订单，不创建额外收费。</p><button class="btn" disabled>额外加收待接入</button></div>`;
};
