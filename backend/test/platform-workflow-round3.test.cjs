'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/remaining-http.cjs');
async function paid(t){const f=await fixture(t),teacher=await f.employee(),academic=await f.employee({roleIds:['academic'],scope:{type:'campus',campusIds:['A']}}),course=await f.course(),klass=await f.klass(course,teacher),students=await f.enroll(klass);return {f,teacher,academic,course,klass,...students};}
for(const winner of ['attendance','withdrawal'])test('X03 '+winner+' wins over concurrent withdrawal/attendance without over-refund',async t=>{
 const {f,teacher,academic,klass,students,enrollments,orders}=await paid(t);f.clock='2026-10-31T04:00:00Z';await f.refresh(f.admin);await f.refresh(teacher);await f.refresh(academic);
 const attendance={classId:klass.id,sessionId:klass.schedule[0].id,rows:[{studentId:students[0].id,status:'attended'}]},withdrawal={enrollmentId:enrollments[0].id,reason:'并发顺序验证'};
 const pa=await f.plan('session.attendance',attendance,teacher),pw=await f.plan('enrollment.withdraw',withdrawal,academic);assert.equal(pa.response.status,200);assert.equal(pw.response.status,200);
 if(winner==='attendance'){
  assert.equal((await f.commit('session.attendance',pa,teacher)).status,200);const stale=await f.commit('enrollment.withdraw',pw,academic);assert.equal(stale.status,409);assert.equal(stale.body.code,'REVISION_CONFLICT');
  await f.execute('enrollment.withdraw',withdrawal,academic);
 }else{
  assert.equal((await f.commit('enrollment.withdraw',pw,academic)).status,200);assert.equal((await f.commit('session.attendance',pa,teacher)).status,409);
  assert.notEqual((await f.plan('session.attendance',attendance,teacher)).response.status,200);
 }
 const state=f.database(s=>s.snapshot().state),spent=state.consumptions.reduce((n,r)=>n+r.amountCents,0);assert.equal(spent+state.refunds[0].amountCents,orders[0].amountCents);assert.equal(state.consumptions.length,winner==='attendance'?1:0);assert.equal(state.enrollments[0].status,'withdrawn');assert.deepEqual(state.classes[0].studentIds,[]);
 const events=f.database(s=>s.auditEvents().filter(e=>e.outcome==='success'));assert.equal(events.filter(e=>e.action==='enrollment.withdraw'&&e.actorId===academic.user.id).length,1);assert.equal(events.filter(e=>e.action==='session.attendance'&&e.actorId===teacher.user.id).length,winner==='attendance'?1:0);
});

for(const roleIds of [['teacher','sales'],['sales','teacher'],['academic','finance'],['finance','academic'],['auditor','finance'],['finance','auditor']])test('X06 '+roleIds.join('+')+' respects explicit denial, campus scope and admin separation',async t=>{
 const f=await fixture(t),permission=roleIds.includes('sales')?'lead.follow':'order.confirmReceipt',operation=roleIds.includes('sales')?'lead.followup':'order.confirmReceipt';
 const actor=await f.employee({roleIds,scope:{type:'campus',campusIds:['A']},additionalPermissions:[permission],deniedPermissions:[permission]});
 f.seed(s=>{s.students=[{id:'scope-a',name:'VISIBLE_A',campusId:'A'},{id:'scope-b',name:'PRIVATE_B',phone:'13900008888',campusId:'B'}];});
 assert(!actor.user.permissions.includes(permission));assert.deepEqual(actor.user.scope.campusIds,['A']);
 const catalog=await f.call(actor,'/v1/catalog');assert.equal(catalog.status,200);assert(!catalog.body.operations.some(o=>o.id===operation));
 const before=f.database(s=>s.snapshot());for(const phase of ['preview','execute']){
  const response=await f.call(actor,'/v1/operations/'+operation+'/'+phase,'POST',{input:{},expectedRevision:before.revision,previewToken:'x'.repeat(43)},{'Idempotency-Key':'multi-role-denied-request'});assert.equal(response.status,403);
 }
 const state=await f.state(actor);assert(!JSON.stringify(state).includes('PRIVATE_B'));assert(!JSON.stringify(state).includes('13900008888'));
 for(const url of ['/v1/admin/users','/v1/admin/ui-annotations','/v1/admin/audit'])assert.equal((await f.call(actor,url)).status,403,url);
 assert.deepEqual(f.database(s=>s.snapshot()),before);
});

async function trialReady(t){const f=await fixture(t),teacher=await f.employee(),academic=await f.employee({roleIds:['academic'],scope:{type:'campus',campusIds:['A']}}),sales=await f.employee({roleIds:['sales'],scope:{type:'own'}}),course=await f.course(),klass=await f.klass(course,teacher);
 const lead=(await f.execute('lead.create',{name:'隔离试听学员',phone:'13900008666',grade:'小四',subject:'数学',campusId:'A',source:'销售自拓'},sales)).result.record;await f.execute('lead.retain',{leadId:lead.id},sales);
 return {f,teacher,academic,sales,course,klass,lead};}
for(const winner of ['move','trial'])test('X04 '+winner+' wins over concurrent rescheduling/reservation and retry uses current slot',async t=>{
 const {f,academic,sales,klass,lead}=await trialReady(t),request={leadId:lead.id,classId:klass.id,sessionId:klass.schedule[0].id},move={classId:klass.id,sessionId:klass.schedule[0].id,date:klass.schedule[0].date,time:'11:00–12:00',reason:'隔离改课并发'};
 const pt=await f.plan('trial.request',request,sales),pm=await f.plan('session.move',move,academic);assert.equal(pt.response.status,200);assert.equal(pm.response.status,200);
 if(winner==='move'){assert.equal((await f.commit('session.move',pm,academic)).status,200);assert.equal((await f.commit('trial.request',pt,sales)).status,409);await f.execute('trial.request',request,sales);}
 else{assert.equal((await f.commit('trial.request',pt,sales)).status,200);assert.equal((await f.commit('session.move',pm,academic)).status,409);await f.execute('session.move',move,academic);}
 const state=f.database(s=>s.snapshot().state);assert.equal(state.trialBookings.filter(b=>b.status==='confirmed').length,1);assert.equal(state.trialRequests.length,1);
 const rows=await f.call(sales,'/v1/crm/trials/requests');assert.equal(rows.status,200);assert.equal(rows.body.items[0].slot.time,'11:00–12:00');assert.equal(rows.body.items[0].slot.sessionId,klass.schedule[0].id);
});
for(const direction of ['later','earlier'])test('Y01 rescheduled '+direction+' trial cancellation follows actual current start time',async t=>{
 const {f,academic,sales,klass,lead}=await trialReady(t);const request=(await f.execute('trial.request',{leadId:lead.id,classId:klass.id,sessionId:klass.schedule[0].id},sales)).result.record;
 await f.execute('session.move',{classId:klass.id,sessionId:klass.schedule[0].id,date:klass.schedule[0].date,time:direction==='later'?'11:00–12:00':'07:00–08:00',reason:'验证改课取消边界'},academic);
 f.clock=direction==='later'?'2026-10-31T02:00:00Z':'2026-10-31T00:00:00Z';await f.refresh(sales);await f.refresh(f.admin);
 const list=await f.call(sales,'/v1/crm/trials/requests');assert.equal(list.status,200);assert.equal(list.body.items[0].canCancel,direction==='later');
 const p=await f.plan('trial.cancel',{requestId:request.id,expectedVersion:1,note:'按新时间取消'},sales);
 if(direction==='later'){assert.equal(p.response.status,200,JSON.stringify(p.response.body));assert.equal((await f.commit('trial.cancel',p,sales)).status,200);assert.equal(f.database(s=>s.snapshot().state.trialBookings[0].status),'cancelled');}
 else{assert.equal(p.response.status,409,JSON.stringify(p.response.body));assert.equal(f.database(s=>s.snapshot().state.trialBookings[0].status),'confirmed');}
});
test('Y02 cancellation preview before class starts cannot execute at the exact current start',async t=>{
 const {f,sales,klass,lead}=await trialReady(t),request=(await f.execute('trial.request',{leadId:lead.id,classId:klass.id,sessionId:klass.schedule[0].id},sales)).result.record;
 f.clock='2026-10-31T00:59:59Z';await f.refresh(sales);await f.refresh(f.admin);
 const p=await f.plan('trial.cancel',{requestId:request.id,expectedVersion:1,note:'开课边界'},sales);assert.equal(p.response.status,200);
 const before=f.database(s=>s.snapshot());f.clock='2026-10-31T01:00:00Z';const r=await f.commit('trial.cancel',p,sales);assert.equal(r.status,409);assert.equal(r.body.code,'INVALID_STATE');assert.deepEqual(f.database(s=>s.snapshot()),before);
 assert.equal(f.database(s=>s.auditEvents().filter(e=>e.action==='trial.cancel'&&e.outcome==='success').length),0);
 const rows=await f.call(sales,'/v1/crm/trials/requests');assert.equal(rows.body.items[0].canCancel,false);
});
for(const winner of ['enrollment','trial'])test('Y03 '+winner+' wins over last-seat formal/internal-trial competition',async t=>{
 const {f,sales,academic,klass,lead}=await trialReady(t);
 f.seed(s=>{s.classes.find(c=>c.id===klass.id).capacity=1;s.campuses.find(c=>c.id==='A').roomDetails.find(r=>r.name==='教室1').capacity=1;});
 const student=(await f.execute('student.create',{name:'隔离正式学生',phone:'13900008777',grade:'小四',campusId:'A'})).result.student;
 const inputE={studentId:student.id,classId:klass.id},inputT={leadId:lead.id,classId:klass.id,sessionId:klass.schedule[0].id};
 const pe=await f.plan('enrollment.create',inputE,academic),pt=await f.plan('trial.request',inputT,sales);assert.equal(pe.response.status,200);assert.equal(pt.response.status,200);
 if(winner==='enrollment'){
  assert.equal((await f.commit('enrollment.create',pe,academic)).status,200);assert.equal((await f.commit('trial.request',pt,sales)).status,409);
  const waiting=(await f.execute('trial.request',inputT,sales)).result.record;assert.equal(waiting.status,'pending');assert.equal(waiting.reviewRequired,true);
 }else{
  const booked=await f.commit('trial.request',pt,sales);assert.equal(booked.status,200);assert.equal((await f.commit('enrollment.create',pe,academic)).status,409);assert.notEqual((await f.plan('enrollment.create',inputE,academic)).response.status,200);
  const before=f.database(s=>s.snapshot().state);assert.equal(before.enrollments.length,0);assert.equal(before.trialBookings.filter(b=>b.status==='confirmed').length,1);
  await f.execute('trial.cancel',{requestId:booked.body.result.record.id,expectedVersion:1,note:'释放最后座位'},sales);await f.execute('enrollment.create',inputE,academic);
 }
 const state=f.database(s=>s.snapshot().state);assert.equal(state.enrollments.filter(e=>e.status==='pending').length,1);assert.equal(state.trialBookings.filter(b=>b.status==='confirmed').length,0);
});
