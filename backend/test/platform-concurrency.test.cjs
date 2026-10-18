'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs');
const {fixture,request}=require('./helpers/remaining-http.cjs');
async function pending(t){const f=await fixture(t),teacher=await f.employee(),course=await f.course(),klass=await f.klass(course,teacher),student=(await f.execute('student.create',{name:'并发验证学生',phone:'13900008001',grade:'小四',campusId:'A'})).result.student,registered=(await f.execute('enrollment.create',{studentId:student.id,classId:klass.id})).result;return {f,teacher,course,klass,student,...registered};}
async function race(f,op,input,n=12){const plan=await f.plan(op,input);assert.equal(plan.response.status,200,JSON.stringify(plan.response.body));const before=f.database(s=>s.snapshot().revision),responses=await Promise.all(Array.from({length:n},()=>f.commit(op,plan)));assert(responses.every(r=>r.status===200),JSON.stringify(responses.map(r=>r.body)));assert.equal(responses.filter(r=>!r.body.replayed).length,1);assert.equal(f.database(s=>s.snapshot().revision),before+1);assert.equal(f.database(s=>s.db.prepare('SELECT count(*) AS n FROM business_audit WHERE action=? AND outcome=?').get(op,'success').n),1);return responses.find(r=>!r.body.replayed).body.result;}
test('12-way receipt, attendance, refund approval and refund confirmation each commit exactly once',async t=>{
 const {f,klass,student,order,enrollment}=await pending(t);
 await race(f,'order.confirmReceipt',{orderId:order.id,amountCents:order.amountCents,reference:'QA-RECEIPT',method:'bank'});
 assert.equal(f.database(s=>s.snapshot().state.receipts.length),1);
 f.clock='2026-10-31T04:00:00Z';await f.refresh(f.admin);
 await race(f,'session.attendance',{classId:klass.id,sessionId:klass.schedule[0].id,rows:[{studentId:student.id,status:'attended'}]});
 let state=f.database(s=>s.snapshot().state);assert.equal(state.attendance.length,1);assert.equal(state.consumptions.length,1);
 const refund=(await f.execute('enrollment.withdraw',{enrollmentId:enrollment.id,reason:'隔离并发退费'})).result.refund;
 await race(f,'refund.approve',{refundId:refund.id});await race(f,'refund.submit',{refundId:refund.id,reference:'QA-REFUND',method:'bank'});
 state=f.database(s=>s.snapshot().state);assert.equal(state.refunds.length,1);assert.equal(state.orders[0].refundedCents+state.consumptions.reduce((n,r)=>n+r.amountCents,0),order.amountCents);
});
test('two different receipt previews compete safely and a new preview cannot overpay',async t=>{
 const {f,order}=await pending(t),input={orderId:order.id,amountCents:order.amountCents,reference:'QA-A',method:'bank'};
 const a=await f.plan('order.confirmReceipt',input),b=await f.plan('order.confirmReceipt',{...input,reference:'QA-B'});
 const r=await Promise.all([f.commit('order.confirmReceipt',a),f.commit('order.confirmReceipt',b)]);assert.deepEqual(r.map(x=>x.status).sort(),[200,409]);
 const next=await f.plan('order.confirmReceipt',{...input,reference:'QA-C'});assert.notEqual(next.response.status,200);const state=f.database(s=>s.snapshot().state);assert.equal(state.receipts.length,1);assert.equal(state.orders[0].paidCents,order.amountCents);
});
test('parallel scheduling into the same teacher and room has one winner and retries detect actual conflict',async t=>{
 const f=await fixture(t),teacher=await f.employee(),course=await f.course(),a=await f.klass(course,teacher,{schedule:[]}),b=await f.klass(course,teacher,{schedule:[]});
 const sessions=course.lessons.map((l,i)=>({lessonId:l.id,date:i?'2026-11-01':'2026-10-31',time:'09:00–10:00'})),pa=await f.plan('class.schedule',{classId:a.id,sessions}),pb=await f.plan('class.schedule',{classId:b.id,sessions});
 assert.equal(pa.response.status,200);assert.equal(pb.response.status,200);const rs=await Promise.all([f.commit('class.schedule',pa),f.commit('class.schedule',pb)]);assert.deepEqual(rs.map(r=>r.status).sort(),[200,409]);
 const loser=rs[0].status===409?a:b;const retry=await f.plan('class.schedule',{classId:loser.id,sessions});assert.equal(retry.response.status,409);assert.match(retry.response.body.message,/冲突/);assert.equal(f.database(s=>s.snapshot().state.classes.filter(c=>c.schedule.length).length),1);
});
test('all registered operations reject unauthorized roles at the HTTP boundary without mutation',async t=>{
 let denied=0;
 for(const role of ['sales','academic','finance','teacher','operations','auditor','principal'])await t.test(role,async child=>{
  const f=await fixture(child),catalog=(await f.call(f.admin,'/v1/catalog')).body.operations;
  const scope=role==='sales'?{type:'own'}:role==='teacher'?{type:'assigned'}:{type:'campus',campusIds:['A']};
  const actor=await f.employee({roleIds:[role],scope}),visible=(await f.call(actor,'/v1/catalog')).body.operations;
  for(const op of catalog.filter(o=>!actor.user.permissions.includes(o.permission))){
   assert(!visible.some(v=>v.id===op.id),role+' exposed '+op.id);const res=await f.call(actor,'/v1/operations/'+op.id+'/preview','POST',{input:{},expectedRevision:0});assert.equal(res.status,403,role+' '+op.id+' '+JSON.stringify(res.body));denied++;
  }
  for(const endpoint of ['/v1/admin/users','/v1/admin/ui-annotations','/v1/admin/audit'])assert.equal((await f.call(actor,endpoint)).status,403,role+' '+endpoint);
  assert.equal(f.database(s=>s.snapshot().revision),0);
 });
 assert(denied>300);t.diagnostic('denied unauthorized operation probes='+denied+', roles=7');
});
test('100 isolated reads at concurrency 20 remain authorized and leave data unchanged',async t=>{
 const f=await fixture(t),before=f.database(s=>s.snapshot()),timings=[],codes={};
 for(let batch=0;batch<5;batch++)await Promise.all(Array.from({length:20},async(_,i)=>{const begin=performance.now(),r=await f.call(f.admin,i%2?'/v1/state':'/v1/catalog');timings.push(performance.now()-begin);codes[r.status]=(codes[r.status]||0)+1;assert.equal(r.status,200);}));
 assert.deepEqual(f.database(s=>s.snapshot()),before);timings.sort((a,b)=>a-b);t.diagnostic(JSON.stringify({requests:100,concurrency:20,codes,p50Ms:timings[49],p95Ms:timings[94],maxMs:timings[99],environment:'isolated localhost; not production capacity'}));
});
test('20 competing student writes are reconciled without lost records, duplicate IDs or audit gaps',async t=>{
 const f=await fixture(t),plans=[];for(let i=0;i<20;i++){const input={name:'隔离并发学生'+i,phone:'1390000'+String(i).padStart(4,'0'),campusId:'A'};plans.push({input,plan:await f.plan('student.create',input)});}
 const responses=await Promise.all(plans.map(p=>f.commit('student.create',p.plan)));assert.equal(responses.filter(r=>r.status===200).length,1);assert(responses.every(r=>[200,409].includes(r.status)));
 for(let i=0;i<plans.length;i++)if(responses[i].status===409)await f.execute('student.create',plans[i].input);
 const state=f.database(s=>s.snapshot());assert.equal(state.revision,20);assert.equal(state.state.students.length,20);assert.equal(new Set(state.state.students.map(r=>r.id)).size,20);assert.equal(f.database(s=>s.db.prepare("SELECT count(*) AS n FROM business_audit WHERE action='student.create' AND outcome='success'").get().n),20);
 await f.restart();assert.deepEqual(f.database(s=>s.snapshot()),state);await f.execute('student.create',{name:'重启后验证',phone:'13900009991',campusId:'A'});assert.equal(f.database(s=>s.snapshot().state.students.length),21);
});
