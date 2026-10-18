'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/remaining-http.cjs');
test('student communication three channels and callback persist via HTTP preview execute replay restart history',async t=>{
 const f=await fixture(t),teacher=await f.employee(),course=await f.course(),klass=await f.klass(course,teacher),{students}=await f.enroll(klass),student=students[0];
 let first;
 for(const channel of ['phone','wecom','text']){
  const p=await f.plan('student.communicate',{studentId:student.id,classId:klass.id,channel,note:'课堂沟通 '+channel,nextFollowAt:channel==='phone'?'2026-11-02T09:00:00+08:00':'',expectedVersion:student.version},teacher);assert.equal(p.response.status,200,JSON.stringify(p.response.body));
  const before=f.database(db=>db.snapshot().state.studentCommunications.length);assert.equal((await f.commit('student.communicate',p,teacher)).status,200);assert.equal((await f.commit('student.communicate',p,teacher)).status,200);assert.equal(f.database(db=>db.snapshot().state.studentCommunications.length),before+1);first??=p;
 }
 await f.restart();const read=await f.call(teacher,'/v1/students/communications?'+new URLSearchParams({studentId:student.id,classId:klass.id}));assert.equal(read.status,200);assert.equal(read.body.total,3);assert.equal(read.body.records.find(r=>r.channel==='phone').nextFollowAt,'2026-11-02T01:00:00.000Z');assert.equal(read.body.records.find(r=>r.channel==='text').nextFollowAt,null);assert.equal(read.body.records.every(r=>r.actorId===teacher.user.id),true);assert.equal((await f.commit('student.communicate',first,teacher)).status,200);assert.equal(f.database(db=>db.snapshot().state.studentCommunications.length),3);
});
test('invalid callback and stale student version reject without writing; other teacher cannot read or append',async t=>{
 const f=await fixture(t),teacher=await f.employee(),other=await f.employee(),course=await f.course(),klass=await f.klass(course,teacher),{students}=await f.enroll(klass),base={studentId:students[0].id,classId:klass.id,channel:'text',note:'沟通'};
 for(const nextFollowAt of ['not-a-date','2026-10-29T01:00:00Z','2026-11-02T09:00','2026-11-02T25:00:00Z','2027-02-30T09:00:00Z']){const p=await f.plan('student.communicate',{...base,nextFollowAt},teacher);assert.notEqual(p.response.status,200,nextFollowAt);}
 assert.notEqual((await f.plan('student.communicate',{...base,expectedVersion:999},teacher)).response.status,200);
 assert.notEqual((await f.plan('student.communicate',base,other)).response.status,200);
 assert.notEqual((await f.call(other,'/v1/students/communications?'+new URLSearchParams({studentId:base.studentId,classId:base.classId}))).status,200);
 assert.equal(f.database(db=>db.snapshot().state.studentCommunications.length),0);
});
