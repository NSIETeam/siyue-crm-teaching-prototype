'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const boot=require('./simulation-runtime.cjs');
const copy=value=>JSON.parse(JSON.stringify(value));
function simulate(options={}){
 const now=new Date(),runId='SIM-'+now.toISOString().replace(/[-:TZ.]/g,'').slice(0,14)+'-'+crypto.randomBytes(3).toString('hex'),tag=runId.slice(-6),runtime=boot();
 const checks=[];
 function check(id,label,fn){const observed=fn();checks.push({id,label,status:'passed',observed:observed||{}});}
 const stamp={simulationRunId:runId,simulation:true};
 const courseId=runId+'-COURSE',classId=runId+'-CLASS-A',targetId=runId+'-CLASS-B';
 const students=['甲','乙','丙'].map((name,i)=>({...stamp,id:runId+'-STUDENT-'+(i+1),name:`课消模拟${name}·${tag}`,phone:`模拟号码${i+1}`,grade:'小四',status:'在读',enrollmentStatus:'已生效',campus:'城中校区',className:`课消模拟原班·${tag}`,classIds:[classId]}));
 const lessons=['分数认识','分数比较','分数应用'].map((title,i)=>({...stamp,id:runId+'-LESSON-'+(i+1),title,content:title,version:1}));
 const date=new Date(now.getTime()-2*86400000).toISOString().slice(0,10);
 const course={...stamp,id:courseId,name:`课消模拟数学·${tag}`,subject:'数学',grade:'小四',fee:900,active:true,age:'9–11岁',lessons};
 const common={...stamp,course:course.name,courseId,lessonId:lessons[0].id,lessonVersion:1,campus:'城中校区',teacher:`模拟老师·${tag}`,date,capacity:20,status:'开课中',sessions:[]};
 const classes=[{...common,id:classId,name:students[0].className,room:'模拟教室A',time:'09:00–10:00',students:3,studentIds:students.map(s=>s.id)}, {...common,id:targetId,name:`课消模拟临时班·${tag}`,room:'模拟教室B',time:'11:00–12:00',students:0,studentIds:[]}];
 const orders=students.map((student,i)=>({...stamp,id:runId+'-ORDER-'+(i+1),studentId:student.id,student:student.name,courseId,classId,product:course.name,amount:'¥900.00',paid:'¥900.00',status:'交易成功',paymentState:'已支付',entitlementState:'已生效',lessonSnapshot:lessons.map(({id,title})=>({id,title})),quoteSnapshot:{base:900,discount:0,total:900}}));
 const sourceSessionId=`${classId}|${date}|${lessons[0].id}|1`;
 const academic={courses:[course],classes,students,orders,attendance:[],refunds:[],sessionAdjustments:[{...stamp,id:runId+'-MOVE-1',type:'临时转班',studentId:students[2].id,sourceClassId:classId,targetClassId:targetId,date,courseId,lessonId:lessons[0].id,lessonVersion:1,sourceSessionId,orderId:orders[2].id,status:'已确认'}]};
 runtime.context.simulationSeed=academic;
 runtime.run("Object.assign(a,JSON.parse(JSON.stringify(simulationSeed)));a.batchLogs=[];permissionState.identity='admin';sysRules.attendance={leaveConsume:false,absentConsume:false,lockDays:0};operationJournal=[];journalPersist();workflowPersist()");
 const sourceRows=[{studentId:students[0].id,attendance:'到课',consume:true},{studentId:students[1].id,attendance:'请假',consume:false}];
 const snapshot=()=>runtime.run('JSON.stringify(auditBusinessSnapshot())');
 const records=()=>copy(runtime.run('a.attendance'));
 check('attended-consumes','到课并确认课消，实际调用页面保存处理器',()=>{
  runtime.attendance(classId,sourceRows);const row=records().find(r=>r.studentId===students[0].id);
  assert.ok(row);assert.equal(row.consumptionConfirmed,true);assert.equal(row.orderId,orders[0].id);
  return {studentId:row.studentId,orderId:row.orderId,confirmed:true};
 });
 check('leave-does-not-consume','请假记录保留但不扣课',()=>{const row=records().find(r=>r.studentId===students[1].id);assert.equal(row.attendance,'请假');assert.equal(row.consumptionConfirmed,false);return {studentId:row.studentId,confirmed:false};});
 check('repeat-is-idempotent','重复保存不会生成第二条课消',()=>{
  const count=records().length;runtime.attendance(classId,sourceRows);assert.equal(records().length,count);assert.equal(records().filter(r=>r.studentId===students[0].id&&r.consumptionConfirmed).length,1);return {attendanceRecords:count,studentConfirmedLessons:1};
 });
 check('temporary-class-links-source','临时转班的课消关联原订单和原讲次',()=>{
  runtime.attendance(targetId,[{studentId:students[2].id,attendance:'到课',consume:true}]);const row=records().find(r=>r.studentId===students[2].id);
  assert.equal(row.consumptionConfirmed,true);assert.equal(row.orderId,orders[2].id);assert.equal(row.consumptionSourceSessionId,sourceSessionId);return {studentId:row.studentId,orderId:row.orderId,sourceSessionId:row.consumptionSourceSessionId};
 });
 check('denied-role','销售身份不能修改课消',()=>{
  const before=snapshot();runtime.run("permissionState.identity='sales'");const messages=runtime.attendance(classId,[{...sourceRows[0],consume:false}]);runtime.run("permissionState.identity='admin'");assert.equal(snapshot(),before);assert.ok(messages.some(x=>/权限/.test(x)));return {changed:false};
 });
 check('unknown-student','无效学生被拒绝且不留下半条记录',()=>{
  const before=snapshot(),messages=runtime.attendance(classId,[{studentId:runId+'-UNKNOWN',attendance:'到课',consume:true}]);assert.equal(snapshot(),before);assert.ok(messages.length);return {changed:false};
 });
 check('leave-rule','禁用请假消课时不能强行确认',()=>{
  const before=snapshot(),messages=runtime.attendance(classId,[{...sourceRows[1],consume:true}]);assert.equal(snapshot(),before);assert.ok(messages.some(x=>/请假/.test(x)));return {changed:false};
 });
 check('storage-failure','日志或存储失败时不修改业务记录',()=>{
  const before=snapshot();runtime.context.failStorage=true;let messages;try{messages=runtime.attendance(classId,[{...sourceRows[0],consume:false}]);}finally{runtime.context.failStorage=false;}assert.equal(snapshot(),before);assert.ok(messages.some(x=>/未保存|存储/.test(x)));return {changed:false};
 });
 const refundEstimates=[];
 check('financial-projection','课消与原订单退款试算一致，实收金额保持原值',()=>{
  for(let i=0;i<students.length;i++){const estimate=copy(runtime.run(`workflowRefundEstimate(${i},0)`));assert.equal(estimate.consumed,i===1?0:1);assert.equal(estimate.refund,i===1?900:600);refundEstimates.push({studentId:students[i].id,orderId:orders[i].id,confirmedLessons:estimate.consumed,remainingRefundMinor:Math.round(estimate.refund*100)});}
  assert.ok(runtime.run("a.orders.every(o=>o.paid==='¥900.00')"));assert.equal(runtime.run('consumptionLedger().reduce((sum,row)=>sum+(row.amountCents||0),0)'),60000);assert.ok(runtime.run("financeConsumptionPage().includes('课消金额 ¥600.00')"));return {confirmedLessons:2,consumedAmountMinor:60000,recordedPaidMinor:270000,refundEstimates};
 });
 check('persisted-reload','重新加载同一模拟存储后记录仍一致',()=>{
  const reloaded=boot(new Map(runtime.storage));assert.equal(reloaded.run('a.attendance.filter(r=>r.consumptionConfirmed===true).length'),2);assert.equal(reloaded.run('a.orders.length'),3);assert.equal(reloaded.run('workflowRefundEstimate(2,0).consumed'),1);return {confirmedLessons:2,orders:3};
 });
 const result=copy(runtime.run('({courses:a.courses,classes:a.classes,students:a.students,attendance:a.attendance,orders:a.orders,refunds:a.refunds||[],sessionAdjustments:a.sessionAdjustments||[]})'));
 result.attendance=result.attendance.map((row,index)=>({...row,...stamp,id:row.id||runId+'-ATTENDANCE-'+(index+1),classId:row.classId||result.classes[row.classIndex]?.id,studentId:row.studentId||result.students[row.studentIndex]?.id}));
 const journal=copy(runtime.run('operationJournal')).map((entry,index)=>({...entry,...stamp,id:runId+'-LOG-'+(index+1),source:'siyue-cli 模拟执行'}));
 assert.ok(Object.values(result).every(records=>records.every(record=>record.id?.startsWith(runId))),'Payload leaked non-simulation records');
 const report={status:'passed',checks,summary:{students:students.length,classes:classes.length,orders:orders.length,attendanceRecords:result.attendance.length,confirmedLessons:2,consumedAmountMinor:60000,recordedPaidMinor:270000,remainingRefundMinor:210000,journalEntries:journal.length},refundEstimates};
 const payload={schema:'siyue.lesson-consumption.simulation',schemaVersion:1,runId,generatedAt:now.toISOString(),source:{kind:'siyue-cli',mode:'simulation',operation:'lesson-consumption',version:'0.2.0'},academic:result,journal,report};
 if(options.out){
  const output=path.resolve(options.out),repo=path.resolve(__dirname,'..');if(output===repo||output.startsWith(repo+path.sep))throw Error('输出目录必须位于仓库之外，避免把模拟数据当成部署资源');
  fs.mkdirSync(output,{recursive:true});const payloadPath=path.join(output,'lesson-consumption.simulation.json'),reportPath=path.join(output,'simulation-report.json');
  if(fs.existsSync(payloadPath)||fs.existsSync(reportPath))throw Error('输出文件已存在，请使用新的目录');
  fs.writeFileSync(payloadPath,JSON.stringify(payload,null,2)+'\n',{flag:'wx'});fs.writeFileSync(reportPath,JSON.stringify({schema:payload.schema,runId,generatedAt:payload.generatedAt,...report},null,2)+'\n',{flag:'wx'});
  return {runId,status:report.status,checks:checks.length,payloadPath,reportPath,summary:report.summary};
 }
 return payload;
}
module.exports={simulate};
