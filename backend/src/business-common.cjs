'use strict';
const crypto=require('node:crypto');
function fail(message,code='VALIDATION_ERROR',status=400){throw Object.assign(new Error(message),{code,status});}
function assert(condition,message,code,status){if(!condition)fail(message,code,status);}
function id(prefix='row'){return prefix+'_'+crypto.randomUUID();}
function requirePermission(actor,permission){assert(actor&&!actor.disabled&&actor.permissions?.includes(permission),'没有此操作权限','FORBIDDEN',403);}
function emptyState(){return {schemaVersion:1,courses:[],classes:[],students:[],orders:[],attendance:[],refunds:[],sessionAdjustments:[],enrollments:[],receipts:[],consumptions:[],campuses:[],staff:[],leads:[],forms:[],rewardClaims:[],trialBookings:[],leadReclaimRequests:[],rescheduleRequests:[],dictionary:{},settings:{},leadPolicy:{reserveDays:14,firstFollowHours:4,reclaimDays:21,decisionHours:48},activities:{coupon:[],group:[],joint:[]},shelved:[],hiddenShelved:[],decor:{},inbox:[]};}
function moneyMinor(value,label='金额'){assert(Number.isSafeInteger(value)&&value>=0&&value<=100000000000,label+'须为有效的整数分');return value;}
const kinds={course:'courses',class:'classes',student:'students',lead:'leads',campus:'campuses',order:'orders',refund:'refunds',enrollment:'enrollments',session:'sessions',staff:'staff',teacher:'staff',receipt:'receipts',consumption:'consumptions',form:'forms'};
function canAccess(state,actor,record,kind,options={}){
 if(!actor||actor.disabled||!record)return false;
 const scope=actor.scope||{type:'own'},k=kinds[kind]||kind,read=options.access==='read';
 if(scope.type==='all')return true;
 if(['settings','dictionary','leadPolicy'].includes(k))return read;
 // Record relationships are resolved by stable IDs; display names are never authority.
 const klass=k==='classes'?record:state.classes.find(c=>c.id===(record.classId||record.activeClassId));
 const order=record.orderId&&state.orders.find(o=>o.id===record.orderId);
 const campus=record.campusId||(k==='campuses'?record.id:null)||klass?.campusId||order?.campusId;
 if(scope.type==='campus'){
  if(k==='forms'&&campus)return scope.campusIds.includes(campus)&&(record.createdBy===actor.id||record.publishedBy===actor.id||read&&record.published===true);
  if(k==='students'&&state.enrollments.some(e=>e.studentId===record.id&&['active','pending'].includes(e.status)&&state.classes.some(c=>c.id===e.classId&&scope.campusIds.includes(c.campusId))))return true;
  if(campus)return scope.campusIds.includes(campus);
  // Global course/catalog metadata may be read, never edited by a campus-only account.
  return read&&['courses','dictionary','settings','leadPolicy','activities'].includes(k);
 }
 if(read&&k==='courses'&&scope.type==='assigned')return state.classes.some(c=>c.courseId===record.id&&(c.teacherId===actor.id||c.schedule?.some(s=>(s.substituteTeacherId||s.teacherId)===actor.id)));
 if(read&&['courses','campuses','dictionary','settings','leadPolicy'].includes(k))return true;
 if(read&&scope.type==='own'&&['classes','activities','decor'].includes(k))return true;
 if(scope.type==='own'){
  if(k==='leads'){
   const owner=record.ownerId===actor.id,decision=record.decisionStatus==='pending'&&record.decisionById===actor.id;
   if(!read)return owner||decision;
   return owner||decision||record.registrarId===actor.id||record.collectedByIds?.includes(actor.id)||record.decisionById===actor.id||record.createdBy===actor.id||!record.ownerId&&record.decisionStatus==='timed_out'&&actor.permissions?.includes('lead.follow');
  }
  if(k==='forms'&&(record.createdBy===actor.id||record.publishedBy===actor.id))return true;
  if(record.ownerId===actor.id||read&&(record.registrantId===actor.id||record.registrarId===actor.id||record.decisionById===actor.id))return true;
  if(['leads','students'].includes(k)&&!record.ownerId&&record.createdBy===actor.id)return true;
  const studentId=k==='students'?record.id:record.studentId;
  if(studentId){const student=state.students.find(s=>s.id===studentId);return !!(student?.ownerId===actor.id||state.leads.some(l=>l.studentId===studentId&&l.ownerId===actor.id));}
  return !['classes','campuses','courses'].includes(k)&&record.createdBy===actor.id;
 }
 if(scope.type==='assigned'){
  if(k==='leads'){
   const owner=record.ownerId===actor.id,decision=record.decisionStatus==='pending'&&record.decisionById===actor.id;
   if(!read)return owner||decision;
   return owner||decision||record.registrarId===actor.id||record.collectedByIds?.includes(actor.id)||record.decisionById===actor.id||record.createdBy===actor.id;
  }
  if(k==='forms')return record.createdBy===actor.id||record.publishedBy===actor.id||read&&record.published===true;
  const assigned=c=>c&&(c.teacherId===actor.id||c.teacherIds?.includes(actor.id)||c.schedule?.some(s=>s.teacherId===actor.id||s.substituteTeacherId===actor.id));
  if(k==='staff')return record.id===actor.id;
  if(assigned(klass)||record.teacherId===actor.id||record.substituteTeacherId===actor.id)return true;
  const studentId=k==='students'?record.id:record.studentId;
  if(studentId&&state.classes.some(c=>assigned(c)&&(c.studentIds?.includes(studentId)||state.enrollments.some(e=>e.studentId===studentId&&e.classId===c.id&&e.status!=='withdrawn'))))return true;
  return !!(studentId&&state.sessionAdjustments.some(a=>['active','completed'].includes(a.status)&&(a.studentId===studentId||state.enrollments.some(e=>e.id===a.enrollmentId&&e.studentId===studentId))&&state.classes.some(c=>c.id===a.targetClassId&&(c.schedule||[]).some(s=>s.id===a.targetSessionId&&(s.substituteTeacherId||s.teacherId||c.teacherId)===actor.id))));
 }
 return false;
}
function getRecord(state,actor,collection,recordId,options={}){
 const row=state[collection]?.find(x=>x.id===recordId||collection==='leads'&&x.leadId===recordId);
 assert(row&&canAccess(state,actor,row,collection,options),'记录不存在或不在授权范围','NOT_FOUND',404);return row;
}
function canReadFormSubmission(actor,form,submission){
 if(!actor||actor.disabled)return false;
 if(actor.roleIds?.includes('superadmin')||submission.publisherId===actor.id)return true;
 if(['pending','rejected'].includes(submission.status))return false;
 return form.createdBy===actor.id||form.publishedBy===actor.id||form.settings?.ownerId===actor.id;
}
function context(state,actor,directory=[],extra={}){return {actor,now:new Date().toISOString(),id,require:p=>requirePermission(actor,p),get:(c,i,o)=>getRecord(state,actor,c,i,o),can:(r,k,o)=>canAccess(state,actor,r,k,o),assert,directory,...extra};}
module.exports={fail,assert,id,requirePermission,emptyState,moneyMinor,canAccess,getRecord,context,canReadFormSubmission};
