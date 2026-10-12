'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {emptyState,canAccess,context}=require('../src/business-common.cjs');
const {projected}=require('../src/business-service.cjs');
function fixture(){
 const state=emptyState(),actor={id:'teacher-a',version:1,roleIds:['teacher'],permissions:['student.read','class.read','course.read','schedule.read','session.attendance','session.record','consumption.read'],scope:{type:'assigned'}};
 state.students=[{id:'child',name:'Shared student'}];
 state.courses=[{id:'course-a'},{id:'course-b'}];
 state.classes=[{id:'a',teacherId:actor.id,courseId:'course-a',studentIds:['child'],schedule:[{id:'sa',teacherId:actor.id,date:'2026-10-12',time:'09:00–10:00'}]},{id:'b',teacherId:'teacher-b',courseId:'course-b',studentIds:['child'],schedule:[{id:'sb',teacherId:'teacher-b',date:'2026-10-12',time:'11:00–12:00'}]}];
 for(const [classId,teacherId,sessionId] of [['a',actor.id,'sa'],['b','teacher-b','sb']]){
  state.enrollments.push({id:'enroll-'+classId,classId,studentId:'child',status:'active'});
  state.orders.push({id:'order-'+classId,classId,enrollmentId:'enroll-'+classId,studentId:'child'});
  state.attendance.push({id:'attendance-'+classId,classId,sessionId,teacherId,studentId:'child',note:'private-'+classId});
  state.consumptions.push({id:'consumption-'+classId,classId,sessionId,teacherId,studentId:'child',amountCents:classId==='a'?100:900});
 }
 return {state,actor};
}
test('teacher projection does not expose another class records through a shared student',()=>{
 const {state,actor}=fixture(),v=projected({state,revision:1},actor,[]).state;
 assert.deepEqual(v.students.map(x=>x.id),['child']);
 for(const key of ['classes','enrollments','attendance','consumptions'])assert.deepEqual(v[key].map(x=>x.id),[key==='classes'?'a':({'enrollments':'enroll','attendance':'attendance','consumptions':'consumption'}[key]+'-a')]);
 assert(!JSON.stringify(v).includes('private-b'));
 assert.equal(v.consumptions.reduce((n,x)=>n+x.amountCents,0),100);
 for(const key of ['enrollments','orders','attendance','consumptions']){
  const row=state[key][1];
  for(const access of ['read','write'])assert.throws(()=>context(state,actor).get(key,row.id,{access}),{code:'NOT_FOUND'});
 }
});
test('attendance and consumption use the actual teacher even in a shared class',()=>{
 const {state,actor}=fixture();state.classes[0].schedule.push({id:'other',teacherId:'teacher-b'});
 for(const key of ['attendance','consumptions']){
  const foreign={id:'foreign',classId:'a',sessionId:'other',studentId:'child',teacherId:'teacher-b'};
  assert.equal(canAccess(state,actor,foreign,key,{access:'read'}),false);
  const historical={...foreign,id:'historic',classId:'b',teacherId:actor.id};
  assert.equal(canAccess(state,actor,historical,key,{access:'read'}),true);
  delete foreign.teacherId;assert.equal(canAccess(state,actor,foreign,key,{access:'read'}),false);
 }
});
test('makeup visibility follows the target session without opening unrelated enrollments',()=>{
 const {state,actor}=fixture();state.classes[0].studentIds=[];state.enrollments[0].status='withdrawn';
 state.sessionAdjustments=[{id:'adjust',status:'active',studentId:'child',enrollmentId:'enroll-b',sourceClassId:'b',sourceSessionId:'sb',targetClassId:'a',targetSessionId:'sa'}];
 assert.equal(canAccess(state,actor,state.students[0],'students',{access:'read'}),true);
 assert.equal(canAccess(state,actor,state.sessionAdjustments[0],'sessionAdjustments',{access:'read'}),true);
 assert.equal(canAccess(state,actor,state.enrollments[1],'enrollments',{access:'read'}),false);
 assert.equal(canAccess(state,actor,{...state.sessionAdjustments[0],targetClassId:'b',targetSessionId:'sb'},'sessionAdjustments',{access:'read'}),false);
});
test('linked financial records require their own authorized class and missing relations fail closed',()=>{
 const {state,actor}=fixture();
 for(const kind of ['receipts','refunds']){
  assert.equal(canAccess(state,actor,{studentId:'child',orderId:'order-a'},kind,{access:'read'}),true);
  assert.equal(canAccess(state,actor,{studentId:'child',orderId:'order-b'},kind,{access:'read'}),false);
  assert.equal(canAccess(state,actor,{studentId:'child',orderId:'missing'},kind,{access:'read'}),false);
 }
 actor.scope={type:'all'};assert.equal(canAccess(state,actor,state.enrollments[1],'enrollments',{access:'read'}),true);
 actor.scope={type:'campus',campusIds:['campus-a']};state.classes[0].campusId='campus-a';state.classes[1].campusId='campus-b';
 assert.equal(canAccess(state,actor,state.enrollments[0],'enrollments',{access:'read'}),true);
 assert.equal(canAccess(state,actor,state.enrollments[1],'enrollments',{access:'read'}),false);
});
