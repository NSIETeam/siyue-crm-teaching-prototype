const assert=require('node:assert/strict'),boot=require('./runtime.cjs');
const r=boot();let count=0;const check=(name,fn)=>{fn();count++;console.log('PASS '+name)};
check('CLI payload previews without changing business state',()=>{const before=r.run('JSON.stringify(a)');r.run('consumptionDemoPreview(siyueConsumptionExample)');assert.equal(r.run('JSON.stringify(a)'),before)});
check('CLI import remaps IDs and synchronizes finance/refund projection',()=>{r.run('consumptionDemoImport()');assert.equal(r.run('consumptionLedger().reduce((n,x)=>n+(x.amountCents||0),0)'),60000);assert.equal(r.run('a.attendance.filter(x=>x.simulationRunId).every(x=>a.classes[x.classIndex].id===x.classId&&a.students[x.studentIndex].id===x.studentId)'),true);assert.equal(r.run('workflowRefundEstimate(a.students.findIndex(x=>x.id===siyueConsumptionExample.academic.students[0].id),a.classes.findIndex(x=>x.id===siyueConsumptionExample.academic.classes[0].id)).refund'),600)});
check('reimport does not duplicate data',()=>{const n=r.run('a.attendance.length');r.run('consumptionDemoImport()');assert.equal(r.run('a.attendance.length'),n)});
check('same names cannot hijack order matching',()=>{r.run("a.orders.unshift({id:'unrelated',student:a.students.at(-1).name,studentId:'other',classId:a.classes.at(-1).id,paid:'¥999999',paymentState:'已支付',lessonSnapshot:[{id:a.classes.at(-1).lessonId}]})");assert.equal(r.run('consumptionLedger().reduce((n,x)=>n+(x.amountCents||0),0)'),60000)});
check('integer cent allocation adds up exactly',()=>{r.run("a.orders.push({id:'rounding',paid:'¥10.00',lessonSnapshot:[{id:'a'},{id:'b'},{id:'c'}]})");assert.equal(r.run("['a','b','c'].reduce((n,id)=>n+consumptionAllocation(a.orders.at(-1),id),0)"),1000)});
check('ordinary consumption without paid order is rejected',()=>{r.run("workflowState.selectedSession={classIndex:a.classes.findIndex(c=>c.id===siyueConsumptionExample.academic.classes[0].id)};a.orders=a.orders.filter(o=>o.studentId!==siyueConsumptionExample.academic.students[0].id)");const id=r.run('siyueConsumptionExample.academic.students[0].id');r.lists.set('.wf-attendance',[{value:'到课',dataset:{student:id}}]);r.lists.set('.wf-consume',[{checked:true,dataset:{student:id}}]);const before=r.run('JSON.stringify(a.attendance)');r.run('workflowSaveSessionAttendance()');assert.equal(r.run('JSON.stringify(a.attendance)'),before);assert(r.messages.at(-1).includes('实收订单'))});
check('nonadmin cannot import synthetic business orders',()=>{const z=boot(),before=z.run('JSON.stringify(a)');z.run("permissionState.identity='sales';consumptionDemoUI.payload=siyueConsumptionExample;consumptionDemoImport()");assert.equal(z.run('JSON.stringify(a)'),before)});
check('import persistence failure rolls back all business arrays',()=>{const z=boot(),before=z.run('JSON.stringify(auditBusinessSnapshot())');z.run('consumptionDemoUI.payload=siyueConsumptionExample');z.ctx.failStorage=true;z.run('consumptionDemoImport()');assert.equal(z.run('JSON.stringify(auditBusinessSnapshot())'),before)});
check('mixed real IDs and invalid order references cannot import',()=>{const z=boot();assert.throws(()=>z.run("const bad=JSON.parse(JSON.stringify(siyueConsumptionExample));bad.academic.students[0].id='real-student';consumptionDemoValidate(bad)"));assert.throws(()=>z.run("const bad2=JSON.parse(JSON.stringify(siyueConsumptionExample));bad2.academic.attendance[0].orderId='wrong-order';consumptionDemoValidate(bad2)"))});
function imported(){const z=boot();z.run(`consumptionDemoUI.payload=siyueConsumptionExample;consumptionDemoImport();a.selectedStudent=a.students.findIndex(s=>s.id===siyueConsumptionExample.academic.students[0].id);workflowState.refundClass=a.classes.findIndex(c=>c.id===siyueConsumptionExample.academic.classes[0].id)`);return z}
function invalidPayload(mutation){const z=boot();assert.throws(()=>z.run(`(()=>{const bad=JSON.parse(JSON.stringify(siyueConsumptionExample));${mutation};return consumptionDemoValidate(bad)})()`),mutation)}
check('an unresolved consumption order prevents automatic full refund',()=>{
 for(const mutation of [`row.orderId='missing-order'`,`row.orderId='missing-order';row.sourceOrderId='missing-order'`,`delete row.orderId;delete row.sourceOrderId;a.orders.push({...a.orders.find(o=>o.studentId===row.studentId),id:'ambiguous-order'})`]){
  const z=imported();z.run(`{const row=a.attendance.find(r=>r.studentId===siyueConsumptionExample.academic.students[0].id);${mutation}}`);
  assert.equal(z.run('workflowRefundEstimate(a.selectedStudent,workflowState.refundClass).ready'),false,mutation);assert.equal(z.run('withdrawalEstimate(a.selectedStudent,workflowState.refundClass).automatic'),false,mutation);
 }
});
check('an unresolved moved lesson is attributed back to its source for refund review',()=>{
 const z=imported();z.run(`a.selectedStudent=a.students.findIndex(s=>s.id===siyueConsumptionExample.academic.students[2].id);const moved=a.attendance.find(r=>r.studentId===siyueConsumptionExample.academic.students[2].id);moved.orderId='missing-order';moved.sourceOrderId='missing-order';delete moved.consumptionSourceSessionId`);
 assert.equal(z.run('workflowRefundEstimate(a.selectedStudent,workflowState.refundClass).ready'),false);assert.equal(z.run('withdrawalEstimate(a.selectedStudent,workflowState.refundClass).automatic'),false);
});
check('unrelated student errors do not block a valid order refund projection',()=>{
 const z=imported();z.run(`const other=a.attendance.find(r=>r.studentId===siyueConsumptionExample.academic.students[2].id);other.orderId='missing-order';other.sourceOrderId='missing-order'`);assert.equal(z.run('withdrawalEstimate(a.selectedStudent,workflowState.refundClass).amount'),600);assert.equal(z.run('withdrawalEstimate(a.selectedStudent,workflowState.refundClass).automatic'),true);
});
check('manual withdrawal with amount and evidence remains available for unresolved consumption',()=>{
 const z=imported();z.run(`const row=a.attendance.find(r=>r.studentId===siyueConsumptionExample.academic.students[0].id);row.orderId='missing-order';state.page='withdraw';$('#withdraw-amount').value='500';$('#withdraw-reason').value='已核对原始收款与课消凭据';finishFlow('withdraw')`);
 assert.equal(z.run('a.refunds.at(0).calculation'),'人工核定');assert.equal(z.run('a.refunds.at(0).amount'),500);assert.equal(z.run('a.refunds.at(0).status'),'待财务退款');
});
check('duplicate, empty and malformed lesson snapshots cannot allocate money or auto-refund',()=>{
 for(const mutation of [`order.lessonSnapshot.push({...order.lessonSnapshot[0]})`,`order.lessonSnapshot[1].id=''`,`order.lessonSnapshot[1].id=' '`,`order.lessonSnapshot=[]`,`order.lessonSnapshot='invalid'`]){const z=imported();z.run(`{const order=a.orders.find(o=>o.id===siyueConsumptionExample.academic.orders[0].id);${mutation}}`);assert.equal(z.run('consumptionAllocation(a.orders.find(o=>o.id===siyueConsumptionExample.academic.orders[0].id),siyueConsumptionExample.academic.courses[0].lessons[0].id)'),null,mutation);assert.equal(z.run('workflowRefundEstimate(a.selectedStudent,workflowState.refundClass).ready'),false,mutation)}
 for(const mutation of [`bad.academic.orders[0].lessonSnapshot.push({...bad.academic.orders[0].lessonSnapshot[0]})`,`bad.academic.orders[0].lessonSnapshot[0].id=''`,`bad.academic.courses[0].lessons.push({...bad.academic.courses[0].lessons[0]})`,`bad.academic.courses[0].lessons[0].id=''`])invalidPayload(mutation);
});
check('all adjustment references must belong to the current simulation',()=>{
 for(const key of ['studentId','sourceClassId','targetClassId','courseId','lessonId','orderId','sourceOrderId','sourceSessionId','targetSessionId','sessionId','consumptionSourceSessionId','makeupAppointmentId','refundId','otherRecordId'])invalidPayload(`bad.academic.sessionAdjustments[0][${JSON.stringify(key)}]='REAL-EXISTING-RECORD'`);
 invalidPayload(`bad.academic.sessionAdjustments[0].orderId=bad.runId+'-MISSING-ORDER'`);
 invalidPayload(`bad.academic.sessionAdjustments[0].type='补课';bad.academic.sessionAdjustments[0].consumptionEnabled=true;bad.academic.sessionAdjustments[0].orderId='REAL-EXISTING-ORDER'`);
});
check('valid simulation IDs still must identify the correct student and source session',()=>{
 invalidPayload(`bad.academic.sessionAdjustments[0].orderId=bad.academic.orders[0].id`);
 invalidPayload(`bad.academic.sessionAdjustments[0].sourceSessionId=workflowSessionKey(bad.academic.classes[1])`);
 invalidPayload(`bad.academic.attendance[0].consumptionSourceSessionId=workflowSessionKey(bad.academic.classes[1])`);
 invalidPayload(`bad.academic.attendance[0].sourceOrderId=bad.academic.orders[1].id`);
 invalidPayload(`bad.academic.attendance[0].classId=bad.academic.classes[1].id;bad.academic.attendance[0].sessionId=workflowSessionKey(bad.academic.classes[1])`);
});
check('attendance references and duplicate record IDs are also validated',()=>{
 invalidPayload(`bad.academic.attendance[0].id='REAL-ATTENDANCE'`);
 invalidPayload(`bad.academic.attendance.push({...bad.academic.attendance[0]})`);
 invalidPayload(`bad.academic.attendance[1].sourceOrderId='REAL-ORDER'`);
 invalidPayload(`bad.academic.attendance[0].consumptionConfirmed='true'`);
 const z=boot();z.run(`a.sessionAdjustments=[{...siyueConsumptionExample.academic.sessionAdjustments[0]}];consumptionDemoUI.payload=siyueConsumptionExample`);const before=z.run('JSON.stringify(auditBusinessSnapshot())');z.run('consumptionDemoImport()');assert.equal(z.run('JSON.stringify(auditBusinessSnapshot())'),before);assert(z.messages.at(-1).includes('标识冲突'));
});
check('attendance policy failure returns before any metadata or consumption backfill',()=>{
 const z=imported(),id=z.run('siyueConsumptionExample.academic.students[0].id');z.run(`workflowState.selectedSession={classIndex:workflowState.refundClass};sysRules.attendance.leaveConsume=false;const row=a.attendance.find(r=>r.studentId===siyueConsumptionExample.academic.students[0].id);delete row.classId;delete row.lessonId;delete row.consumptionAmountCents`);
 z.lists.set('.wf-attendance',[{value:'请假',dataset:{student:id}}]);z.lists.set('.wf-consume',[{checked:true,dataset:{student:id}}]);const before=z.run('JSON.stringify(a.attendance)');z.run('workflowSaveSessionAttendance()');assert.equal(z.run('JSON.stringify(a.attendance)'),before);assert(z.messages.at(-1).includes('不允许请假消课'));
});
console.log(`Lesson consumption checks: ${count} passed`);
