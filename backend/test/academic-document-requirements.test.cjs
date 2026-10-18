'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const academic=require('../src/business-academic.cjs');const communication=require('../src/business-student-communication.cjs');const workflow=require('../src/business-teacher-workflow.cjs');const commerce=require('../src/business-commerce.cjs');const operations=[...academic.operations,...communication.operations,...workflow.operations,...commerce.operations];const {emptyState,context}=require('../src/business-common.cjs');
const index=new Map(operations.map(x=>[x.id,x]));
function fixture(){
 let state=emptyState(),n=0,at='2026-10-11T00:00:00.000Z';let actor={id:'admin',name:'管理员',scope:{type:'all'},permissions:[...new Set(operations.map(x=>x.permission))],version:1};
 const directory=[{id:'T',name:'教师甲',roleIds:['teacher']},{id:'U',name:'教师乙',roleIds:['teacher']},{id:'off',name:'离职教师',roleIds:['teacher'],disabled:true},{id:'sales',name:'销售',roleIds:['sales']}];
 state.campuses=[{id:'A',name:'甲校区',active:true,roomDetails:[{name:'教室01',capacity:3},{name:'教室02',capacity:3}]},{id:'B',name:'乙校区',active:true,roomDetails:[{name:'教室01',capacity:3},{name:'教室02',capacity:3}]}];
 const api={get state(){return state;},set actor(x){actor=x;},get actor(){return actor;},set now(x){at=x;},get now(){return at;},directory,
  run(name,input){const before=structuredClone(state);try{const result=index.get(name).run(state,input,context(state,actor,directory,{now:at,id:p=>p+'_'+(++n)}));JSON.stringify(result);return result;}catch(e){state=before;throw e;}},
  snapshot(){return JSON.stringify(state);},
  course(extra={}){return api.run('course.create',{name:'数学'+n,grade:'小四',subject:'数学',priceCents:10001,lessons:[1,2,3].map(i=>({title:'第'+i+'讲',durationMinutes:60})),...extra}).course;},
  klass(course,extra={}){return api.run('class.create',{name:'班级'+n,courseId:course.id,campusId:'A',room:'教室01',teacherId:'T',capacity:3,schedule:course.lessons.map((l,i)=>({lessonId:l.id,date:'2026-11-'+String(1+i*7).padStart(2,'0'),time:'09:00–10:00'})),...extra}).class;},
  student(extra={}){return api.run('student.create',{name:'学生'+n,phone:'139'+String(n).padStart(8,'0'),grade:'小四',campusId:'A',...extra}).student;},
  enroll(student,c,extra={}){return api.run('enrollment.create',{studentId:student.id,classId:c.id,...extra});},
  pay(order,amount=order.amountCents,reference='PAY'+n){return api.run('order.confirmReceipt',{orderId:order.id,amountCents:amount,reference,method:'bank'});}
 };return api;
}
function ready(){const b=fixture(),course=b.course(),c=b.klass(course),student=b.student(),{enrollment:e,order:o}=b.enroll(student,c);b.pay(o);return {b,course,c,student,e,o};}
function checkReject(b,name,input,pattern){const before=b.snapshot();assert.throws(()=>b.run(name,input),pattern);assert.equal(b.snapshot(),before);}
test('title-only live course schedules with class-owned duration including midnight end',()=>{
 const b=fixture(),course=b.course({courseType:'live',lessons:[{title:'数的认识'}]});assert.equal(course.courseType,'live');assert.equal(course.lessons[0].durationMinutes,undefined);
 checkReject(b,'class.create',{name:'缺时长',courseId:course.id,campusId:'A',room:'教室01',teacherId:'T',capacity:3},/班级每讲时长/);
 const c=b.klass(course,{durationMinutes:90,schedule:[{lessonId:course.lessons[0].id,date:'2026-11-01',time:'22:30–24:00'}]});assert.equal(c.durationMinutes,90);
 checkReject(b,'class.update',{classId:c.id,durationMinutes:60},/同时更新/);
 b.run('class.update',{classId:c.id,durationMinutes:60,schedule:[{...c.schedule[0],time:'23:00–24:00'}]});assert.equal(b.state.classes[0].durationMinutes,60);
});
test('five attendance states preserve consumed money, permit same-day edits and enforce exact midnight',()=>{
 const {b,c,student}=ready();b.now='2026-11-01T04:00:00Z';const input={classId:c.id,sessionId:c.schedule[0].id,rows:[{studentId:student.id,status:'late',note:'迟到5分钟'}]};b.run('session.attendance',input);const ledger=JSON.stringify(b.state.consumptions);
 b.now='2026-11-01T15:59:59Z';b.run('session.attendance',{...input,rows:[{studentId:student.id,status:'left_early',note:'提前离开'}]});assert.equal(JSON.stringify(b.state.consumptions),ledger);assert.equal(b.state.attendance[0].history.length,1);
 b.now='2026-11-01T16:00:00Z';checkReject(b,'session.attendance',input,/24点.*锁定/);const roster=academic.attendanceRoster(b.state,c.id,c.schedule[0].id,context(b.state,b.actor,b.directory,{now:b.now}));assert.equal(roster[0].locked,true);assert.equal(roster[0].recorded,true);assert.match(roster[0].phone,/\*{4}/);
});
test('attendance roster reads future sessions and administrators can register an unrecorded historical row',()=>{
 const {b,c,student}=ready();let roster=academic.attendanceRoster(b.state,c.id,c.schedule[0].id,context(b.state,b.actor,b.directory,{now:b.now}));assert.equal(roster[0].recorded,false);
 b.now='2026-11-02T04:00:00Z';b.run('session.attendance',{classId:c.id,sessionId:c.schedule[0].id,rows:[{studentId:student.id,status:'absent'}]});assert.equal(b.state.attendance[0].attendanceStatus,'absent');
});
test('communication records are class-scoped, immutable and authorized for enrolled students',()=>{
 const {b,c,course,student}=ready(),other=b.klass(course,{teacherId:'U',room:'教室02'});b.actor={id:'T',name:'甲老师',roleIds:['teacher'],scope:{type:'assigned'},permissions:['student.communicate','student.read']};
 const record=b.run('student.communicate',{studentId:student.id,classId:c.id,channel:'phone',note:'已沟通课堂表现',expectedVersion:student.version}).record;assert.equal(record.actorId,'T');
 const ctx=()=>context(b.state,b.actor,b.directory,{now:b.now});assert.equal(communication.timeline(b.state,{studentId:student.id,classId:c.id},ctx()).total,1);
 checkReject(b,'student.communicate',{studentId:student.id,classId:other.id,channel:'wecom',note:'越权'},/范围|在读/);
 b.actor={id:'U',roleIds:['teacher'],scope:{type:'all'},permissions:['student.communicate','student.read']};assert.throws(()=>communication.timeline(b.state,{studentId:student.id,classId:c.id},ctx()),/本人授课/);
});
test('communication SQLite preview is read-only, execute persists and idempotent replay does not duplicate',()=>{
 const {BusinessStore}=require('../src/business-store.cjs'),{b,c,student}=ready(),db=new BusinessStore(':memory:');try{db.db.prepare('UPDATE business_state SET data=? WHERE id=1').run(JSON.stringify(b.state));const op=index.get('student.communicate'),input={studentId:student.id,classId:c.id,channel:'text',note:'文字记录'};const preview=db.preview(op,input,b.actor,b.directory,0);assert.equal(db.snapshot().state.studentCommunications.length,0);const env={revision:0,previewToken:preview.previewToken,key:'communication-record-test'};db.execute(op,input,b.actor,b.directory,env);db.execute(op,input,b.actor,b.directory,env);assert.equal(db.snapshot().state.studentCommunications.length,1);}finally{db.close();}
});
test('monthly metrics use captured teacher and class/student counts with all five statuses',()=>{
 const {b,c,student}=ready();b.now='2026-11-01T04:00:00Z';b.run('session.attendance',{classId:c.id,sessionId:c.schedule[0].id,rows:[{studentId:student.id,status:'late'}]});
 b.actor={id:'T',scope:{type:'assigned'},permissions:['teacher.metrics.read']};const ctx=context(b.state,b.actor,b.directory,{now:b.now}),report=workflow.teacherMetrics(b.state,ctx,'T',{month:'2026-11'});assert.equal(report.current.classCount,1);assert.equal(report.current.studentCount,1);assert.equal(report.current.seatOccupancyRate,1/3);assert.equal(report.monthly.attendance.late,1);assert.equal(report.monthly.studentConsumptionCount,1);assert.equal(report.monthly.amountCents,3334);assert.equal(workflow.teacherMetrics(b.state,ctx,'T',{month:'2026-10'}).monthly.amountCents,0);assert.throws(()=>workflow.teacherMetrics(b.state,ctx,'T',{month:'2026-13'}),/月份/);
});
test('product and promotion class selection persists and rejects foreign, inactive and empty selections',()=>{
 const b=fixture(),course=b.course(),c=b.klass(course),other=b.course(),otherClass=b.klass(other,{teacherId:'U',room:'教室02'});b.run('course.publish',{courseId:course.id});b.run('product.publish',{courseId:course.id,classIds:[c.id]});assert.deepEqual(b.state.courses[0].storefront.classIds,[c.id]);
 for(const classIds of [[],[otherClass.id],[c.id,c.id]])checkReject(b,'product.publish',{courseId:course.id,classIds},/班级|重复/);
 const input={type:'group',name:'拼团',start:'2026-10-01',end:'2026-12-31',discountMinor:1000,courseIds:[course.id],selections:[{courseId:course.id,classIds:[c.id]}],groupSize:2,validHours:24};const activity=b.run('promotion.create',input).record;assert.deepEqual(activity.selections,input.selections);checkReject(b,'promotion.update',{type:'group',promotionId:activity.id,patch:{selections:[{courseId:course.id,classIds:[otherClass.id]}]}},/所选班级/);
});
test('title-only editor roundtrip preserves legacy duration metadata on referenced courses',()=>{const {b,course}=ready();b.run('course.update',{courseId:course.id,name:'更新展示名称',lessons:course.lessons.map(({id,title})=>({id,title}))});assert.equal(b.state.courses[0].lessons[0].durationMinutes,60);assert.equal(b.state.courses[0].curriculumVersion,course.curriculumVersion);});
test('historical closed-session roster permits only its actual teacher and exposes a minimal student view',()=>{
 const {b,c,student}=ready();b.now='2026-11-02T04:00:00Z';b.state.classes[0].active=false;b.state.classes[0].status='ended';b.state.classes[0].schedule[0].status='ended';b.state.classes[0].studentIds=[];b.state.enrollments[0].status='withdrawn';b.state.enrollments[0].withdrawnAt='2026-11-02T00:00:00Z';b.state.students[0].privateNote='NEVER EXPOSE';
 const actor={id:'T',roleIds:['teacher'],scope:{type:'assigned'},permissions:['session.attendance']},ctx=context(b.state,actor,b.directory,{now:b.now}),rows=academic.attendanceRoster(b.state,c.id,c.schedule[0].id,ctx);assert.equal(rows[0].studentId,student.id);assert.equal(rows[0].locked,true);assert(!JSON.stringify(rows).includes('NEVER EXPOSE'));assert.throws(()=>academic.attendanceRoster(b.state,c.id,c.schedule[0].id,context(b.state,{...actor,id:'U',scope:{type:'all'}},b.directory,{now:b.now})),/本人实际授课/);
});
