const assert=require('node:assert/strict'),boot=require('./runtime.cjs');
let count=0;
function test(name,fn){fn();count++;console.log('PASS '+name)}
function data(b,code){return JSON.parse(b.run(`JSON.stringify(${code})`))}
function snapshot(b){return b.run('JSON.stringify(auditBusinessSnapshot())')}
function fixture(){
 const b=boot();
 b.run(`permissionState.identity='admin';state.page='withdraw';state.mode='list';
 const future=new Date(Date.now()+30*86400000).toISOString().slice(0,10),past=new Date(Date.now()-2*86400000).toISOString().slice(0,10);
 a.courses=[{id:'course',name:'测试课程',active:true,fee:1000,product:{price:1000},lessons:[{id:'l1',title:'第一讲'},{id:'l2',title:'第二讲'}]}];
 a.classes=[{id:'c1',name:'原班',course:'测试课程',courseId:'course',lessonId:'l1',lessonVersion:1,capacity:20,students:1,studentIds:['s1'],date:future,time:'09:00–10:00',teacher:'甲',campus:'城中校区',room:'A',status:'未开课'},{id:'c2',name:'目标班',course:'测试课程',courseId:'course',lessonId:'l1',lessonVersion:1,capacity:20,students:0,studentIds:[],date:future,time:'11:00–12:00',teacher:'乙',campus:'城中校区',room:'B',status:'未开课'},{id:'other',name:'另一学生班',course:'测试课程',courseId:'course',lessonId:'l1',lessonVersion:1,capacity:20,students:1,studentIds:['s2'],date:future,time:'14:00–15:00',teacher:'丙',campus:'城中校区',room:'C',status:'未开课'}];
 a.students=[{id:'s1',name:'退课学员',phone:'13900000001',status:'在读',enrollmentStatus:'已生效',className:'原班',classIds:['c1']},{id:'s2',name:'其他学员',phone:'13900000002',status:'在读',className:'另一学生班',classIds:['other']}];
 a.orders=[{id:'order1',studentId:'s1',student:'退课学员',classId:'c1',courseId:'course',product:'测试课程',amount:'¥1000.00',paid:'¥1000.00',paymentState:'已支付',entitlementState:'已生效',status:'交易成功',lessonSnapshot:[{id:'l1'},{id:'l2'}]}];
 a.refunds=[];a.attendance=[];a.sessionAdjustments=[];a.selectedStudent=0;a.selectedClass=null;a.enrollmentDraft=null;workflowState.refundClass=0;workflowState.withdrawDraft=null;mallState.activities.coupon=[];
 sysRules.entry.enabled=true;sysRules.entry.allowMidCourse=true;`);
 return b;
}
function manual(b,amount,reason='核对收款凭据及剩余课次，按退款约定核定'){
 b.run("flowPage('withdraw')");
 b.run(`$('#withdraw-amount').value=${JSON.stringify(String(amount))};$('#withdraw-reason').value=${JSON.stringify(reason)};`);
}

test('paid 1010 without lesson configuration can withdraw using a reviewed amount',()=>{
 const b=fixture();b.run("a.orders[0].paid='¥1,010.00';a.orders[0].amount='¥1,010.00';a.orders[0].lessonSnapshot=[];a.courses[0].lessons=[]");
 assert.equal(b.run('withdrawalEstimate(0,0).automatic'),false);
 assert(!b.run("flowPage('withdraw')").includes('disabled'));
 manual(b,500);b.run("finishFlow('withdraw')");
 assert.equal(b.run('a.refunds[0].amount'),500);assert.equal(b.run('a.refunds[0].calculation'),'人工核定');assert.equal(b.run('a.orders[0].paid'),'¥1,010.00');assert.equal(b.run('a.refunds[0].total'),null);
 b.run('workflowConfirmRefund(a.refunds[0].id)');assert.equal(b.run('a.refunds[0].status'),'已模拟退款');assert.equal(b.run('a.orders[0].refundedAmount'),500);
 const reloaded=boot(b.storage);assert.equal(reloaded.run('a.refunds[0].amount'),500);assert.equal(reloaded.run('a.orders[0].entitlementState'),'已退课');
});

test('automatic refund counts only this student and deduplicates original and makeup consumption',()=>{
 const b=fixture();b.run(`a.attendance=[{classIndex:0,studentIndex:0,studentId:'s1',date:past,orderId:'order1',lessonId:'l1',sessionId:'original',status:'已考勤',consumptionConfirmed:true},{classIndex:1,studentIndex:0,studentId:'s1',date:past,orderId:'order1',lessonId:'l1',sessionId:'makeup',consumptionSourceSessionId:'original',makeupAppointmentId:'mu-old',status:'已考勤',consumptionConfirmed:true},{classIndex:0,studentIndex:1,studentId:'s2',date:past,sessionId:'unrelated',status:'已考勤',consumptionConfirmed:true}];`);
 const history=data(b,'a.attendance');b.run("finishFlow('withdraw')");
 assert.equal(b.run('a.refunds[0].amount'),500);assert.equal(b.run('a.refunds[0].consumed'),1);assert.equal(b.run('a.refunds[0].calculation'),'自动计算');assert.deepEqual(data(b,'a.attendance'),history);
});

test('legacy roster without any order accepts manual refund and zero-refund withdrawal without fake receipts',()=>{
 for(const amount of [300,0]){const b=fixture();b.run('a.orders=[]');manual(b,amount);b.run("finishFlow('withdraw')");
  assert.equal(b.run('a.refunds.length'),1);assert.equal(b.run('a.orders.length'),0);assert.equal(b.run('a.refunds[0].paidKnown'),false);assert.equal(b.run('a.refunds[0].paid'),null);assert.equal(b.run('a.students[0].status'),'历史');assert(b.run('financeRefundsPage()').includes('未记录'));
  assert.equal(b.run('a.refunds[0].status'),amount?'待财务退款':'无需退款');
  if(amount){b.run('workflowConfirmRefund(a.refunds[0].id)');assert.equal(b.run('a.refunds[0].status'),'已模拟退款');assert.equal(b.run('a.orders.length'),0)}
 }
 const unpaid=fixture();unpaid.run("a.orders[0].paid='¥0.00';a.orders[0].paymentState='待支付';a.orders[0].entitlementState='未生效';a.orders[0].status='等待付款';finishFlow('withdraw')");
 assert.equal(unpaid.run('a.refunds[0].status'),'无需退款');assert.equal(unpaid.run('a.orders[0].paymentState'),'已取消');assert.equal(unpaid.run('workflowOrderOutstanding(a.orders[0])'),false);assert(!unpaid.run('financeArrearsPage()').includes('order1'));assert(!unpaid.run('ordersPage()').includes("workflowSimulatePayment('order1')"));
 unpaid.run('workflowHome()');assert.match(unpaid.elements.get('#view').innerHTML,/待收款订单<\/span><strong>0<\/strong>/);
});

test('students without an enrollment relation cannot be selected or submitted',()=>{
 const b=fixture();b.run("a.students.push({id:'none',name:'无报名学员',phone:'13900000003',className:'—',classIds:[]});a.modal='selectStudent'");
 assert(!b.run('modalPage()').includes('无报名学员'));assert.equal(b.run('withdrawalClasses(2).length'),0);
 const before=snapshot(b);b.run("a.selectedStudent=2;workflowState.refundClass=0;finishFlow('withdraw')");assert.equal(snapshot(b),before);
 b.run(`$('input[name="modal-student"]:checked').value='2';selectModalStudent()`);assert.equal(b.run('a.modal'),'selectStudent');assert.equal(b.run('a.refunds.length'),0);
});

test('duplicate withdrawal and financial confirmation cannot duplicate records or reduce counts twice',()=>{
 const b=fixture();b.run("finishFlow('withdraw')");const first=snapshot(b);b.run("finishFlow('withdraw')");assert.equal(snapshot(b),first);assert.equal(b.run('a.classes[0].students'),0);
 b.run('workflowConfirmRefund(a.refunds[0].id)');const paid=snapshot(b);b.run('workflowConfirmRefund(a.refunds[0].id)');assert.equal(snapshot(b),paid);assert.equal(b.run('a.orders[0].refundedAmount'),1000);
});

test('withdrawing one class preserves other active memberships and does not admit an unpaid class',()=>{
 const b=fixture();b.run("a.classes[1].studentIds=['s1'];a.classes[1].students=1;a.students[0].classIds.push('c2');finishFlow('withdraw')");
 assert.equal(b.run('a.students[0].status'),'在读');assert.equal(b.run('batchRoster(a.classes[1],a.students[0])'),true);assert.equal(b.run('a.classes[1].students'),1);
 const p=fixture();p.run("a.orders.push({id:'pending',studentId:'s1',classId:'c2',student:'退课学员',product:'测试课程',amount:'¥1000',paid:'¥0',paymentState:'待支付',entitlementState:'未生效',status:'等待付款'});finishFlow('withdraw')");
 assert.equal(p.run("workflowSessionRoster(a.classes[1]).some(s=>s.id==='s1')"),false);assert.equal(p.run('batchRoster(a.classes[1],a.students[0])'),false);assert.equal(p.run('a.orders[1].entitlementState'),'未生效');
});

test('withdrawal cancels future temporary-move and makeup attendance while preserving history and other students',()=>{
 const b=fixture();b.run(`a.sessionAdjustments=[{id:'move',studentId:'s1',sourceClassId:'c1',targetClassId:'c2',date:future,status:'已确认'},{id:'makeup',type:'补课',studentId:'s1',sourceClassId:'c1',targetClassId:'c2',date:future,orderId:'order1',status:'已确认'},{id:'other-move',studentId:'s2',sourceClassId:'c1',targetClassId:'c2',date:future,status:'已确认'}];a.attendance=[{classIndex:1,studentIndex:0,studentId:'s1',date:future,sourceOrderId:'order1',consumptionConfirmed:false,status:'未考勤',attendance:'未考勤'},{classIndex:0,studentIndex:0,studentId:'s1',date:past,consumptionConfirmed:false,status:'已考勤',attendance:'请假',makeup:'已安排',makeupAppointmentId:'makeup'},{classIndex:0,studentIndex:0,studentId:'s1',date:past,orderId:'order1',lessonId:'l1',sessionId:'history',consumptionConfirmed:true,status:'已考勤',attendance:'到课'},{classIndex:1,studentIndex:1,studentId:'s2',date:future,consumptionConfirmed:false,status:'未考勤',attendance:'未考勤'}]`);
 assert.equal(b.run('withdrawalEstimate(0,0).automatic'),true);assert.equal(b.run('withdrawalEstimate(0,0).consumed'),1);
 const historical=data(b,'a.attendance[2]'),other=data(b,'a.attendance[3]'),otherStudent=data(b,'a.students[1]');b.run("finishFlow('withdraw')");
 assert.equal(b.run('a.sessionAdjustments[0].status'),'已撤销');assert.equal(b.run('a.sessionAdjustments[1].status'),'已撤销');assert.equal(b.run('a.sessionAdjustments[2].status'),'已确认');assert.equal(b.run('a.attendance[0].status'),'已撤销');assert.notEqual(b.run('a.attendance[1].makeup'),'已安排');assert.deepEqual(data(b,'a.attendance[2]'),historical);assert.deepEqual(data(b,'a.attendance[3]'),other);assert.deepEqual(data(b,'a.students[1]'),otherStudent);
 assert.equal(b.run("workflowSessionRoster(a.classes[1]).some(s=>s.id==='s1')"),false);
});

test('ambiguous historical consumption requires reviewed refund evidence instead of inventing a lesson',()=>{
 const b=fixture();b.run("a.attendance=[{classIndex:0,studentIndex:0,studentId:'s1',date:past,orderId:'order1',sessionId:'legacy-unknown-session',consumptionConfirmed:true,status:'已考勤',attendance:'到课'}]");
 assert.equal(b.run('withdrawalEstimate(0,0).automatic'),false);const before=snapshot(b);b.run("finishFlow('withdraw')");assert.equal(snapshot(b),before);
 const history=data(b,'a.attendance');manual(b,500);b.run("finishFlow('withdraw')");assert.equal(b.run('a.refunds[0].amount'),500);assert.equal(b.run('a.refunds[0].calculation'),'人工核定');assert.deepEqual(data(b,'a.attendance'),history);assert.equal(b.run('a.attendance[0].lessonId'),undefined);
});

test('multiple orders close together and allocate only remaining recorded receipts on financial confirmation',()=>{
 const b=fixture();b.run("a.orders[0].refundedAmount=20;a.orders.push({...a.orders[0],id:'order2',paid:'¥200.00',amount:'¥200.00',refundedAmount:0})");
 assert.equal(b.run('withdrawalEstimate(0,0).limit'),1180);assert.equal(b.run('withdrawalEstimate(0,0).automatic'),false);manual(b,1100);b.run("finishFlow('withdraw');workflowConfirmRefund(a.refunds[0].id)");
 assert.deepEqual(data(b,'a.refunds[0].orderIds'),['order1','order2']);assert.equal(b.run('a.refunds[0].status'),'已模拟退款');assert.equal(b.run('a.refunds[0].allocations.reduce((n,x)=>n+x.amount,0)'),1100);assert.equal(b.run('a.orders.reduce((n,o)=>n+o.refundedAmount,0)'),1120);assert.equal(b.run('a.orders.every(o=>o.entitlementState==="已退课")'),true);assert(b.run('a.orders[0].refundedAmount')<=1000);assert(b.run('a.orders[1].refundedAmount')<=200);assert.deepEqual(data(b,'a.orders.map(o=>o.paid)'),['¥1000.00','¥200.00']);
});

test('invalid manual amounts, excessive refunds, and missing evidence cannot mutate business data',()=>{
 for(const [amount,reason] of [['','凭据'],['-1','凭据'],['1000.001','凭据'],['NaN','凭据'],['Infinity','凭据'],['1001','凭据'],['500','  ']]){
  const b=fixture();b.run('a.orders[0].lessonSnapshot=[];a.courses[0].lessons=[]');manual(b,amount,reason);const before=snapshot(b);b.run("finishFlow('withdraw')");assert.equal(snapshot(b),before,`${amount}/${reason}`);assert.equal(b.run('a.refunds.length'),0);
 }
});

test('storage failures roll back both withdrawal and financial confirmation without success feedback',()=>{
 for(const stage of ['withdrawal','payment']){const b=fixture();if(stage==='payment')b.run("finishFlow('withdraw')");const before=snapshot(b);b.ctx.failStorage=true;b.messages.length=0;b.run(stage==='withdrawal'?"finishFlow('withdraw')":'workflowConfirmRefund(a.refunds[0].id)');assert.equal(snapshot(b),before,stage);assert.equal(b.messages.length,1);assert(b.messages[0].includes('未保存'));}
});

test('withdrawal and refund confirmation enforce current role permissions',()=>{
 const b=fixture();b.run("permissionState.identity='sales'");const before=snapshot(b);b.run("finishFlow('withdraw')");assert.equal(snapshot(b),before);
 b.run("permissionState.identity='admin';finishFlow('withdraw');permissionState.identity='finance';permissionRole().grants=[]");const pending=snapshot(b);b.run('workflowConfirmRefund(a.refunds[0].id)');assert.equal(snapshot(b),pending);
});

test('a new paid enrollment after withdrawal can be withdrawn again without reviving the old order',()=>{
 const b=fixture();b.run("finishFlow('withdraw');workflowConfirmRefund(a.refunds[0].id);a.selectedStudent=0;a.selectedClass=0;a.enrollmentDraft=null;state.page='enroll';finishEnroll()");
 assert.equal(b.run('a.orders.length'),2);assert.notEqual(b.run('a.orders[0].id'),'order1');b.run("workflowSimulatePayment(a.orders[0].id);a.selectedStudent=0;workflowState.refundClass=0;state.page='withdraw';finishFlow('withdraw')");
 assert.equal(b.run('a.refunds.length'),2);assert.notEqual(b.run('a.refunds[0].orderId'),b.run('a.refunds[1].orderId'));assert.equal(b.run('a.refunds[0].amount'),1000);assert.equal(b.run('a.refunds[1].status'),'已模拟退款');assert.equal(b.run('a.classes[0].students'),0);
});

console.log(`Withdrawal checks: ${count} passed`);
