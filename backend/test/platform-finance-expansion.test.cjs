'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {BusinessStore}=require('../src/business-store.cjs');
const operations=require('../src/business-academic.cjs').operations,index=new Map(operations.map(o=>[o.id,o]));
const {fixture}=require('./helpers/remaining-http.cjs');

// Real operation handlers and SQLite transactions; each combination owns a new database.
for(const total of [0,1,2,3,99,100,101,10001,99999])for(const lessons of [1,3,7,12])test(`P01 amount=${total} cents lessons=${lessons}: consumption plus refund equals receipts`,t=>{
 const s=new BusinessStore(':memory:');t.after(()=>s.close());
 const actor={id:'matrix-admin',name:'隔离财务测试',version:1,roleIds:['superadmin'],permissions:[...new Set(operations.map(o=>o.permission))],scope:{type:'all'}};
 const directory=[{id:'teacher',name:'隔离教师',roleIds:['teacher']}];let now='2030-01-01T00:00:00Z';
 const originalContext=s.operationContext.bind(s);s.operationContext=(state,a,d,seed,extra)=>originalContext(state,a,d,seed,{...extra,now});
 const state=s.snapshot().state;state.campuses=[{id:'A',name:'隔离校区',active:true,roomDetails:[{name:'教室1',capacity:20}]}];s.db.prepare('UPDATE business_state SET data=? WHERE id=1').run(JSON.stringify(state));
 function run(id,input){const op=index.get(id),revision=s.snapshot().revision,p=s.preview(op,input,actor,directory,revision);return s.execute(op,input,actor,directory,{revision,previewToken:p.previewToken,key:crypto.randomUUID()}).result;}
 const course=run('course.create',{name:'财务矩阵课程',grade:'小四',subject:'数学',priceCents:total,lessons:Array.from({length:lessons},(_,i)=>({title:'第'+(i+1)+'讲',durationMinutes:60}))}).course;
 const klass=run('class.create',{name:'财务矩阵班级',courseId:course.id,campusId:'A',room:'教室1',teacherId:'teacher',capacity:10,schedule:course.lessons.map((l,i)=>({lessonId:l.id,date:'2030-02-'+String(i+1).padStart(2,'0'),time:'09:00–10:00'}))}).class;
 const student=run('student.create',{name:'隔离金额学生',phone:'13900008222',campusId:'A',grade:'小四'}).student;
 const {order,enrollment}=run('enrollment.create',{studentId:student.id,classId:klass.id});
 const first=Math.floor(total/3);if(first>0)run('order.confirmReceipt',{orderId:order.id,amountCents:first,method:'bank',reference:'part-1'});
 run('order.confirmReceipt',{orderId:order.id,amountCents:total-first,method:'bank',reference:'part-2'});
 // Revisit every consumption twice on the same day; financial evidence stays single.
 const used=Math.floor(lessons/2);
 for(let i=0;i<used;i++){
  now=klass.schedule[i].date+'T04:00:00Z';const input={classId:klass.id,sessionId:klass.schedule[i].id,rows:[{studentId:student.id,status:i%2?'late':'attended'}]};run('session.attendance',input);run('session.attendance',input);
 }
 const refund=run('enrollment.withdraw',{enrollmentId:enrollment.id,reason:'隔离矩阵退课'}).refund;
 const consumed=s.snapshot().state.consumptions.reduce((n,r)=>n+r.amountCents,0);
 const expectedConsumed=used*Math.floor(total/lessons)+Math.min(used,total%lessons);
 assert.equal(consumed,expectedConsumed);assert.equal(refund.amountCents,total-consumed);
 if(refund.amountCents>0){run('refund.approve',{refundId:refund.id});run('refund.submit',{refundId:refund.id,reference:'refund-1',method:'bank'});}
 else assert.equal(refund.status,'no_refund');
 const final=s.snapshot().state,current=final.orders.find(o=>o.id===order.id),received=final.receipts.reduce((n,r)=>n+r.amountCents,0);
 assert.equal(received,total);assert.equal(current.paidCents,received);assert.equal(consumed+current.refundedCents,received);
 assert.equal(final.consumptions.length,used);assert.equal(new Set(final.consumptions.map(r=>r.orderId+'|'+r.lessonId)).size,used);
 assert(final.consumptions.every(r=>Number.isSafeInteger(r.amountCents)&&r.amountCents>=0));assert.deepEqual(final.classes[0].studentIds,[]);
});

async function pending(t){const f=await fixture(t),teacher=await f.employee(),course=await f.course(),klass=await f.klass(course,teacher);
 const student=(await f.execute('student.create',{name:'隔离链路学生',phone:'13900008333',campusId:'A',grade:'小四'})).result.student;
 const registration=(await f.execute('enrollment.create',{studentId:student.id,classId:klass.id})).result;return {f,teacher,course,klass,student,...registration};}
test('P02 HTTP partial payment withdrawal refunds only received cash and closes further collection',async t=>{
 const {f,order,enrollment}=await pending(t);await f.execute('order.confirmReceipt',{orderId:order.id,amountCents:1234,reference:'partial',method:'bank'});
 const refund=(await f.execute('enrollment.withdraw',{enrollmentId:enrollment.id,reason:'部分付款退课'})).result.refund;assert.equal(refund.amountCents,1234);
 await f.execute('refund.approve',{refundId:refund.id});await f.execute('refund.submit',{refundId:refund.id,reference:'partial-refund',method:'bank'});
 const before=f.database(s=>s.snapshot());const denied=await f.plan('order.confirmReceipt',{orderId:order.id,amountCents:1,reference:'late-payment',method:'bank'});assert.notEqual(denied.response.status,200);assert.match(denied.response.body.message,/关闭/);assert.deepEqual(f.database(s=>s.snapshot()),before);
 const current=before.state.orders.find(o=>o.id===order.id);assert.equal(current.paidCents,1234);assert.equal(current.refundedCents,1234);assert.equal(before.state.consumptions.length,0);
});
test('P03 HTTP course repricing invalidates old preview but cannot change an existing order price snapshot',async t=>{
 const {f,course,order}=await pending(t),input={orderId:order.id,amountCents:order.amountCents,reference:'fixed-price',method:'bank'},p=await f.plan('order.confirmReceipt',input);
 await f.execute('course.update',{courseId:course.id,priceCents:20000});const stale=await f.commit('order.confirmReceipt',p);assert.equal(stale.status,409);assert.equal(stale.body.code,'REVISION_CONFLICT');
 assert.equal(f.database(s=>s.snapshot().state.receipts.length),0);await f.execute('order.confirmReceipt',input);
 const state=f.database(s=>s.snapshot().state);assert.equal(state.courses[0].priceCents,20000);assert.equal(state.orders[0].amountCents,10001);assert.equal(state.orders[0].paidCents,10001);
});
test('P04 HTTP concurrent cross-order voucher reuse remains rejected after stale retry',async t=>{
 const {f,klass,order}=await pending(t),student=(await f.execute('student.create',{name:'另一位隔离学生',phone:'13900008334',grade:'小四',campusId:'A'})).result.student;
 const other=(await f.execute('enrollment.create',{studentId:student.id,classId:klass.id})).result.order;
 const inputs=[order,other].map(o=>({orderId:o.id,amountCents:o.amountCents,reference:'same-bank-voucher',method:'bank'})),plans=await Promise.all(inputs.map(i=>f.plan('order.confirmReceipt',i))),responses=await Promise.all(plans.map(p=>f.commit('order.confirmReceipt',p)));
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);const loser=responses.findIndex(r=>r.status===409),retry=await f.plan('order.confirmReceipt',inputs[loser]);assert.equal(retry.response.status,409);assert.equal(retry.response.body.code,'DUPLICATE_REFERENCE');
 const state=f.database(s=>s.snapshot().state);assert.equal(state.receipts.length,1);assert.equal(state.orders.reduce((n,o)=>n+o.paidCents,0),10001);assert.equal(state.enrollments.filter(e=>e.status==='active').length,1);
});
test('P05 HTTP approved refund cannot silently change amount or execute again under another voucher',async t=>{
 const {f,order,enrollment}=await pending(t);await f.execute('order.confirmReceipt',{orderId:order.id,amountCents:order.amountCents,reference:'paid',method:'bank'});
 const refund=(await f.execute('enrollment.withdraw',{enrollmentId:enrollment.id,reason:'隔离退款链路'})).result.refund;
 await f.execute('refund.approve',{refundId:refund.id,amountCents:9000,reason:'明确核准9000分'});await f.execute('refund.submit',{refundId:refund.id,reference:'refund-original',method:'bank'});
 const before=f.database(s=>s.snapshot());for(const [op,input] of [['refund.approve',{refundId:refund.id,amountCents:10001}],['refund.submit',{refundId:refund.id,reference:'refund-other',method:'bank'}]])assert.notEqual((await f.plan(op,input)).response.status,200);
 assert.deepEqual(f.database(s=>s.snapshot()),before);assert.equal(before.state.orders[0].refundedCents,9000);assert.equal(before.state.refunds[0].approvedAmountCents,9000);
});
