/* Withdrawal eligibility is independent of whether a refund can be calculated automatically. */
function withdrawalMoney(value){
 if(value===null||value===undefined||String(value).trim()==='')return null;
 const raw=String(value).trim().replace(/^[¥￥]\s*/,'').replace(/,/g,'');
 if(!/^\d+(\.\d{1,2})?$/.test(raw))return null;
 const amount=Number(raw);return Number.isSafeInteger(Math.round(amount*100))?amount:null;
}
function withdrawalOrderMatches(order,student,c){
 const sameStudent=order.studentId?order.studentId===student.id:order.student===student.name&&a.students.filter(s=>s.name===student.name).length===1;
 const sameClass=order.classId?order.classId===c.id:order.product===c.course&&a.classes.filter(x=>x.course===c.course&&batchRoster(x,student)).length===1&&batchRoster(c,student);
 return sameStudent&&sameClass;
}
function withdrawalOrders(student,c){return a.orders.filter(o=>withdrawalOrderMatches(o,student,c)&&!['已退课','已取消'].includes(o.entitlementState)&&!['已取消','已关闭'].includes(o.status)&&!(a.refunds||[]).some(r=>r.orderId===o.id||(r.orderIds||[]).includes(o.id)))}
function withdrawalClasses(studentIndex){
 const student=a.students[studentIndex];if(!student)return [];
 return a.classes.map((c,index)=>({c,index,orders:withdrawalOrders(student,c)})).filter(x=>x.orders.length||batchRoster(x.c,student)&&!(a.refunds||[]).some(r=>r.studentId===student.id&&r.classId===x.c.id));
}
function withdrawalEstimate(studentIndex,classIndex){
 const student=a.students[studentIndex],option=withdrawalClasses(studentIndex).find(x=>x.index===classIndex);if(!student||!option)return null;
 const {c,orders}=option,base=workflowRefundEstimate(studentIndex,classIndex),paidValues=orders.map(o=>withdrawalMoney(o.paid)),paidKnown=orders.length>0&&paidValues.every(v=>v!==null),paid=paidKnown?paidValues.reduce((n,v)=>n+v,0):null;
 const previous=orders.reduce((n,o)=>n+(withdrawalMoney(o.refundedAmount)||0),0),limit=paidKnown?Math.max(0,Math.round((paid-previous)*100)/100):null;
 const automatic=paidKnown&&(paid===0||orders.length===1&&base.ready&&base.order?.id===orders[0].id);
 const amount=automatic?(paid===0?0:Math.max(0,Math.min(limit,Math.round((base.refund-previous)*100)/100))):null;
 return {student,c,orders,paidKnown,paid,limit,consumed:base.consumed,total:base.total,automatic,amount};
}
function withdrawalDraft(est){
 const key=JSON.stringify([est.student.id,est.c.id,est.orders.map(o=>[o.id,o.paid,o.refundedAmount||0]),est.total,est.consumed]);
 if(workflowState.withdrawDraft?.key!==key)workflowState.withdrawDraft={key,amount:'',reason:''};return workflowState.withdrawDraft;
}
function withdrawalChangeClass(value){workflowState.refundClass=Number(value);workflowState.withdrawDraft=null;academicRender()}
const withdrawalPreviousFlowPage=flowPage;
flowPage=function(type){
 if(type!=='withdraw')return withdrawalPreviousFlowPage(type);
 const student=a.students[a.selectedStudent],options=withdrawalClasses(a.selectedStudent);
 if(!options.some(x=>x.index===workflowState.refundClass))workflowState.refundClass=options[0]?.index;
 const est=withdrawalEstimate(a.selectedStudent,workflowState.refundClass),draft=est?withdrawalDraft(est):null;
 return `<div class="card pad"><div class="toolbar"><button class="btn" onclick="a.modal='selectStudent';academicRender()">${student?'重新选择学生':'选择学生'}</button>${student?`<strong>${esc(student.name)}</strong>`:''}</div>${est?`<div class="field"><label for="flow-from">退课班级</label><select id="flow-from" class="select" onchange="withdrawalChangeClass(this.value)">${options.map(x=>`<option value="${x.index}" ${x.index===workflowState.refundClass?'selected':''}>${esc(x.c.name)}</option>`).join('')}</select></div><div class="summary-box"><div class="summary-line"><span>已记录实收</span><strong>${est.paidKnown?'¥'+est.paid.toFixed(2):'未记录'}</strong></div><div class="summary-line"><span>已确认课消 / 总讲次</span><strong>${est.consumed} / ${est.total||'未配置'}</strong></div>${est.automatic?`<div class="summary-line"><span>本次退款</span><strong>¥${est.amount.toFixed(2)}</strong></div>`:''}</div>${est.automatic?'':`<div class="form-grid withdrawal-manual"><div class="field"><label class="required" for="withdraw-amount">本次退款金额（元）</label><input id="withdraw-amount" class="input" type="number" min="0" step="0.01" ${est.paidKnown?`max="${est.limit}"`:''} value="${esc(draft.amount)}" placeholder="无需退款请填 0" oninput="workflowState.withdrawDraft.amount=this.value"><div class="help">${est.paidKnown?`最多可退 ¥${est.limit.toFixed(2)}`:'按实际收款凭据核定金额'}</div></div><div class="field"><label class="required" for="withdraw-reason">退款核定依据</label><input id="withdraw-reason" class="input" value="${esc(draft.reason)}" placeholder="如收款凭据、剩余课次及退款约定" oninput="workflowState.withdrawDraft.reason=this.value"></div></div>`}<p class="help">${est.automatic?'退款已按实收和已确认课消计算。':'资料不完整可直接填写退款金额与依据。'}退课后撤销后续点名和补课预约，历史记录保留。</p><div class="form-actions"><button class="btn primary" onclick="finishFlow('withdraw')">确认退课${est.automatic&&est.amount===0?'':'并提交退款'}</button></div>`:`<div class="empty">${student?'该学生暂无可退课程，请重新选择。':'请选择需要退课的学生。'}</div>`}</div>`;
};
const withdrawalPreviousModalPage=modalPage;
modalPage=function(){
 if(state.page!=='withdraw'||a.modal!=='selectStudent')return withdrawalPreviousModalPage();
 const students=a.students.map((s,index)=>({s,index,options:withdrawalClasses(index)})).filter(x=>x.options.length);
 return `<div class="modal-backdrop"><div class="modal"><div class="modal-head"><h2>选择退课学生</h2><button class="btn small" onclick="a.modal=null;academicRender()">关闭</button></div><div class="filters"><input class="input" placeholder="搜索学生、电话或班级" oninput="filterRows(this.value)"></div>${students.length?aTable(['选择','学生','联系电话','可退班级'],students.map(({s,index,options})=>`<tr><td><input type="radio" name="modal-student" value="${index}" ${a.selectedStudent===index?'checked':''}></td><td>${esc(s.name)}</td><td>${esc(s.phone||'—')}</td><td>${options.map(x=>esc(x.c.name)).join('、')}</td></tr>`)):'<div class="empty">暂无可办理退课的学生</div>'}<div class="modal-actions"><button class="btn" onclick="a.modal=null;academicRender()">取消</button><button class="btn primary" ${students.length?'':'disabled'} onclick="selectModalStudent()">确定</button></div></div></div>`;
};
const withdrawalPreviousSelectStudent=selectModalStudent;
selectModalStudent=function(){
 if(state.page!=='withdraw')return withdrawalPreviousSelectStudent();
 const selected=document.querySelector('input[name="modal-student"]:checked'),index=selected?Number(selected.value):null;
 if(index===null||!withdrawalClasses(index).length){toast('请选择有可退课程的学生');return}
 a.selectedStudent=index;workflowState.refundClass=withdrawalClasses(index)[0].index;workflowState.withdrawDraft=null;a.modal=null;academicRender();
};
function withdrawalCancelFuture(est,studentIndex,classIndex,refund){
 const today=batchToday(),orderIds=new Set(est.orders.map(o=>o.id)),cancelled=new Set();
 (a.sessionAdjustments||[]).forEach(x=>{if(x.studentId===est.student.id&&x.status==='已确认'&&x.date>=today&&(x.sourceClassId===est.c.id||orderIds.has(x.orderId))){x.status='已撤销';x.cancelReason='学生退课';x.refundId=refund.id;if(x.id)cancelled.add(x.id)}});
 a.attendance.forEach(x=>{
  const sameStudent=x.studentId?x.studentId===est.student.id:x.studentIndex===studentIndex;if(!sameStudent)return;
  if(cancelled.has(x.makeupAppointmentId)&&!x.consumptionConfirmed){x.makeup='不补课';x.makeupCancelReason='学生退课';x.refundId=refund.id}
  const related=x.classId===est.c.id||x.classIndex===classIndex||orderIds.has(x.orderId)||orderIds.has(x.sourceOrderId)||cancelled.has(x.makeupAppointmentId);
  if(related&&x.date>=today&&!x.consumptionConfirmed&&!['已考勤','已消课'].includes(x.status)){x.previousStatus=x.attendance;x.attendance='退课后撤销';x.status='已撤销';x.refundId=refund.id}
 });
}
const withdrawalPreviousFinishFlow=finishFlow;
finishFlow=function(type){
 if(type!=='withdraw')return withdrawalPreviousFinishFlow(type);if(!workflowGuard('withdraw'))return;
 const si=a.selectedStudent,ci=workflowState.refundClass,est=withdrawalEstimate(si,ci);if(!est){toast('该学生的课程已退或不存在，请重新选择');return}
 const draft=withdrawalDraft(est),amount=est.automatic?est.amount:withdrawalMoney($('#withdraw-amount')?.value??draft.amount),reason=est.automatic?'':String($('#withdraw-reason')?.value??draft.reason).trim();
 if(amount===null||!Number.isFinite(amount)||amount<0){toast('请填写有效的退款金额，最多保留两位小数；无需退款请填 0');return}
 if(est.paidKnown&&amount>est.limit){toast('退款金额不能超过剩余可退实收');return}
 if(!est.automatic&&!reason){toast('请填写退款核定依据');return}
 const refund={id:auditId('RF'),withdrawalVersion:1,student:est.student.name,studentId:est.student.id,classId:est.c.id,className:est.c.name,course:est.c.course,orderId:est.orders.length===1?est.orders[0].id:null,orderIds:est.orders.map(o=>o.id),paid:est.paid,paidKnown:est.paidKnown,consumed:est.consumed,total:est.total||null,amount,calculation:est.automatic?'自动计算':'人工核定',reason,entitlementState:'已退课',status:amount===0?'无需退款':'待财务退款',createdAt:new Date().toISOString(),createdBy:workflowActor()};
 a.refunds=a.refunds||[];a.refunds.unshift(refund);
 est.orders.forEach(o=>{o.entitlementState='已退课';o.refundState=amount===0?'无需退款':'待退款';o.withdrawalId=refund.id;if(o.paymentState==='待支付'){o.paymentState='已取消';o.status='已取消'}});
 const wasMember=batchRoster(est.c,est.student),count=batchOccupied(est.c);est.c.studentIds=(est.c.studentIds||[]).filter(id=>id!==est.student.id);if(wasMember)est.c.students=Math.max(0,count-1);
 est.student.classIds=(est.student.classIds||[]).filter(id=>id!==est.c.id);if(est.student.className===est.c.name)est.student.className='—';
 const remaining=withdrawalClasses(si),enrolled=remaining.filter(x=>batchRoster(x.c,est.student)||x.orders.some(o=>o.entitlementState==='已生效'&&o.paymentState==='已支付'));
 if(enrolled.length){if(est.student.className==='—')est.student.className=enrolled[0].c.name;est.student.status='在读';est.student.enrollmentStatus='已生效'}
 else{est.student.status=remaining.length?'潜在':'历史';est.student.enrollmentStatus=remaining.length?'待支付':'已退课'}
 withdrawalCancelFuture(est,si,ci,refund);workflowPersist();workflowState.withdrawDraft=null;academicRender();toast(amount===0?'退课已完成，无需退款':`退课已完成，¥${amount.toFixed(2)} 已提交财务确认`);
};
function withdrawalConfirmRefund(id){
 if(!workflowGuard('refundPayment'))return;const r=(a.refunds||[]).find(x=>x.id===id);
 if(!r||r.withdrawalVersion!==1||r.status!=='待财务退款'||r.entitlementState!=='已退课'){toast('该退款已处理或不存在');return}
 const orders=(r.orderIds||[]).map(oid=>a.orders.find(o=>o.id===oid));
 if(orders.some(o=>!o||o.entitlementState!=='已退课'||o.withdrawalId!==r.id)||withdrawalMoney(r.amount)===null||r.calculation==='人工核定'&&!r.reason?.trim()){toast('退款依据或金额无效');return}
 const limits=orders.map(o=>{const paid=withdrawalMoney(o.paid);return paid===null?null:Math.max(0,paid-(withdrawalMoney(o.refundedAmount)||0))}),known=orders.length>0&&limits.every(v=>v!==null),limit=known?limits.reduce((n,v)=>n+v,0):null;
 if(known&&Math.round(r.amount*100)>Math.round(limit*100)){toast('退款金额超过剩余可退实收，请核对');return}
 r.status='已模拟退款';r.completedAt=new Date().toISOString();r.confirmedBy=workflowActor();
 let cents=Math.round(r.amount*100),remainingLimit=known?Math.round(limit*100):null;r.allocations=[];
 orders.forEach((o,i)=>{o.refundState='已退款';o.refundRecordId=r.id;if(known){const cap=Math.round(limits[i]*100),part=i===orders.length-1?cents:remainingLimit?Math.min(cap,Math.floor(cents*cap/remainingLimit)):0;cents-=part;remainingLimit-=cap;o.refundedAmount=Math.round(((withdrawalMoney(o.refundedAmount)||0)+part/100)*100)/100;r.allocations.push({orderId:o.id,amount:part/100})}else if(orders.length===1)o.refundedAmount=Math.round(((withdrawalMoney(o.refundedAmount)||0)+r.amount)*100)/100});
 workflowPersist();render();toast('模拟退款已确认，退课依据与历史记录已保留');
}
financeRefundsPage=function(){
 const items=a.refunds||[];
 return `<div class="data-summary"><div class="card"><strong>${items.length}</strong><span>退课记录</span></div><div class="card"><strong>${items.filter(x=>x.status==='待财务退款').length}</strong><span>待财务处理</span></div><div class="card"><strong>¥${items.reduce((n,x)=>n+Number(x.amount||0),0).toFixed(2)}</strong><span>退款申请金额</span></div></div><div class="card pad"><div class="toolbar"><h2 class="section-title" style="margin:0">退课与退款</h2><button class="btn primary" onclick="nav('withdraw')">办理退课</button></div>${items.length?aTable(['业务单号','学生','课程 / 班级','已记录实收','课消 / 总讲次','本次退款','计算依据','状态','操作'],items.map(x=>`<tr><td>${esc(x.id)}</td><td>${esc(x.student)}</td><td>${esc(x.course)}${x.className?`<div class="muted">${esc(x.className)}</div>`:''}</td><td>${x.paidKnown===false?'未记录':'¥'+Number(x.paid||0).toFixed(2)}</td><td>${Number(x.consumed||0)} / ${x.total||'未配置'}</td><td>¥${Number(x.amount||0).toFixed(2)}</td><td>${esc(x.calculation||'自动计算')}${x.reason?`<div class="withdrawal-reason">${esc(x.reason)}</div>`:''}</td><td>${esc(x.status)}</td><td>${workflowMay('refundPayment')&&x.status==='待财务退款'?`<button class="btn small" onclick="workflowConfirmRefund('${esc(x.id)}')">${x.calculation==='人工核定'?'确认核定并模拟退款':'模拟退款到账'}</button>`:'—'}</td></tr>`)):'<div class="empty">暂无退课记录</div>'}</div>`;
};
