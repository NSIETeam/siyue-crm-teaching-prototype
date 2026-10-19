'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/remaining-http.cjs');
async function setup(t){const f=await fixture(t),academic=await f.employee({roleIds:['academic'],scope:{type:'campus',campusIds:['A']}}),sales=await f.employee({roleIds:['sales'],scope:{type:'own'}}),teacher=await f.employee(),course=await f.course(),klass=await f.klass(course,teacher),input={name:'试听登记验证',phone:'13900008666',campusId:'A',source:'前台咨询',ownerId:sales.user.id};return {f,academic,sales,teacher,klass,input};}
test('academic creates normal assigned lead then reserves; first communication is trial and retry is idempotent',async t=>{
 const {f,academic,sales,klass,input}=await setup(t);assert(!academic.user.permissions.includes('lead.follow'));
 const before=f.database(s=>s.snapshot());const p=await f.plan('lead.trialIntake',input,academic);assert.equal(p.response.status,200,JSON.stringify(p.response.body));assert.deepEqual(f.database(s=>s.snapshot()),before);
 const saved=await f.commit('lead.trialIntake',p,academic);assert.equal(saved.status,200,JSON.stringify(saved.body));const lead=saved.body.result.record;assert.equal(lead.ownerId,sales.user.id);assert.equal(lead.stage,'新线索');assert.equal(f.database(s=>s.snapshot().state.leads.find(r=>r.id===lead.id).nextFollowAt),null);await f.commit('lead.trialIntake',p,academic);
 const slots=await f.call(academic,'/v1/crm/trials/slots?leadId='+lead.id);assert.equal(slots.status,200);assert(slots.body.slots.length);
 const booking=await f.plan('trial.academicRequest',{leadId:lead.id,classId:klass.id,sessionId:klass.schedule[0].id},academic);assert.equal(booking.response.status,200,JSON.stringify(booking.response.body));assert.equal((await f.commit('trial.academicRequest',booking,academic)).status,200);await f.commit('trial.academicRequest',booking,academic);
 const s=f.database(s=>s.snapshot().state);assert.equal(s.leads.length,1);assert.equal(s.trialBookings.length,1);assert.equal(s.trialRequests[0].salesId,sales.user.id);assert.equal(s.trialRequests[0].requestedBy,academic.user.id);const notes=s.leads[0].history.filter(e=>e.kind==='跟进');assert.equal(notes.length,1);assert.equal(notes[0].detail.note,'预约了试课');assert.equal(notes[0].actorId,academic.user.id);
});
test('normalized exact match preserves owner/history; same phone different child creates a different lead',async t=>{
 const {f,academic,sales,input}=await setup(t);const original=(await f.execute('lead.create',input)).result.record;
 const second=await f.employee({roleIds:['sales'],scope:{type:'own'}}),before=f.database(s=>s.snapshot().state.leads[0]);
 const result=await f.execute('lead.trialIntake',{...input,name:'  '+input.name+' ',phone:'+86 139-0000-8666',ownerId:second.user.id,note:'不得覆盖已有资料'},academic);assert.equal(result.result.matched,true);assert.equal(result.result.record.id,original.id);assert.equal(result.result.record.ownerId,sales.user.id);assert.deepEqual(f.database(s=>s.snapshot().state.leads[0]),before);
 await f.execute('lead.trialIntake',{...input,name:'同家长另一位学生'},academic);assert.equal(f.database(s=>s.snapshot().state.leads.length),2);
});
test('intake rejects other roles, cross-campus matches and archived/pending leads without mutation',async t=>{
 const {f,academic,sales,teacher,input}=await setup(t);
 for(const actor of [sales,teacher])assert.equal((await f.plan('lead.trialIntake',input,actor)).response.status,403);
 for(const patch of [{campusId:'B'},{status:'cold'},{decisionStatus:'pending'}]){f.seed(s=>{s.leads=[{id:'existing',...input,contactPhone:input.phone,stage:'跟进中',status:'assigned',decisionStatus:'retained',history:[],...patch}];});const before=f.database(s=>s.snapshot());const r=await f.plan('lead.trialIntake',input,academic);assert.equal(r.response.status,409);assert.deepEqual(f.database(s=>s.snapshot()),before);assert(!JSON.stringify(r.response.body).includes('existing'));}
});
test('concurrent intake resolves to one lead and public lead can be assigned only once',async t=>{
 const {f,academic,input}=await setup(t);const [a,b]=await Promise.all([f.plan('lead.trialIntake',input,academic),f.plan('lead.trialIntake',input,academic)]);assert.equal(a.response.status,200);assert.equal(b.response.status,200);assert.equal((await f.commit('lead.trialIntake',a,academic)).status,200);assert.equal((await f.commit('lead.trialIntake',b,academic)).status,409);assert.equal((await f.execute('lead.trialIntake',input,academic)).result.matched,true);assert.equal(f.database(s=>s.snapshot().state.leads.length),1);
 f.seed(s=>{s.leads[0].ownerId=null;s.leads[0].decisionStatus='public';});await f.execute('lead.trialIntake',input,academic);assert.equal(f.database(s=>s.snapshot().state.leads[0].ownerId),input.ownerId);
});
test('full lesson writes pending communication; approval adds exactly one confirmed communication',async t=>{
 const {f,academic,klass,input}=await setup(t);const lead=(await f.execute('lead.trialIntake',input,academic)).result.record;
 f.seed(s=>{s.campuses.find(c=>c.id==='A').roomDetails[0].capacity=1;s.trialBookings=[{id:'other',classId:klass.id,sessionId:klass.schedule[0].id,name:'其他学员',phoneHash:'other',status:'confirmed'}];});
 const result=await f.execute('trial.academicRequest',{leadId:lead.id,classId:klass.id,sessionId:klass.schedule[0].id},academic);assert.equal(result.result.record.status,'pending');assert.deepEqual(f.database(s=>s.snapshot().state.leads[0].history.filter(e=>e.kind==='跟进').map(e=>e.detail.note)),['申请了试课，待教务复核']);
 const p=await f.plan('trial.review',{requestId:result.result.record.id,expectedVersion:1,decision:'approve',classId:klass.id,sessionId:klass.schedule[1].id,note:'选择另一节有余位的课程'},academic);assert.equal(p.response.status,200,JSON.stringify(p.response.body));await f.commit('trial.review',p,academic);await f.commit('trial.review',p,academic);assert.deepEqual(f.database(s=>s.snapshot().state.leads[0].history.filter(e=>e.kind==='跟进').map(e=>e.detail.note)),['申请了试课，待教务复核','预约了试课']);
});
