'use strict';
const crypto=require('node:crypto');
function fail(message,code='VALIDATION_ERROR',status=400){throw Object.assign(new Error(message),{code,status});}
function assert(condition,message,code,status){if(!condition)fail(message,code,status);}
function id(prefix='row'){return prefix+'_'+crypto.randomUUID();}
function requirePermission(actor,permission){assert(actor&&!actor.disabled&&actor.permissions?.includes(permission),'没有此操作权限','FORBIDDEN',403);}
function emptyState(){return {schemaVersion:2,studentCommunications:[],serviceTickets:[],serviceTicketTypes:[],attributionRequests:[],attributionAdjustments:[],routingRules:[],routingQueue:[],importBatches:[],savedCrmViews:[],customers:[],campaigns:[],touchpoints:[],crmTaskBatches:[],crmTasks:[],opportunities:[],consultations:[],courses:[],classes:[],students:[],orders:[],attendance:[],refunds:[],sessionAdjustments:[],enrollments:[],receipts:[],consumptions:[],campuses:[],staff:[],leads:[],forms:[],rewardClaims:[],trialBookings:[],leadReclaimRequests:[],rescheduleRequests:[],dictionary:{},settings:{},leadPolicy:{reserveDays:14,firstFollowHours:4,reclaimDays:21,decisionHours:48},activities:{coupon:[],group:[],joint:[]},shelved:[],hiddenShelved:[],decor:{},inbox:[]};}
function moneyMinor(value,label='金额'){assert(Number.isSafeInteger(value)&&value>=0&&value<=100000000000,label+'须为有效的整数分');return value;}
const kinds={course:'courses',class:'classes',student:'students',lead:'leads',campus:'campuses',order:'orders',refund:'refunds',enrollment:'enrollments',session:'sessions',staff:'staff',teacher:'staff',receipt:'receipts',consumption:'consumptions',form:'forms'};
function canAccess(state,actor,record,kind,options={}){
 if(!actor||actor.disabled||!record)return false;
 const scope=actor.scope||{type:'own'},k=kinds[kind]||kind,read=options.access==='read';
 if(scope.type==='all')return true;
 const crmKinds=['customers','campaigns','touchpoints','crmTaskBatches','crmTasks','opportunities','consultations','serviceTickets','attributionRequests','attributionAdjustments','importBatches','routingRules','routingQueue','savedCrmViews'];
 if(crmKinds.includes(k))return canAccessCrm(state,actor,record,k,options);
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
 if(read&&k==='students'&&['own','assigned'].includes(scope.type)){
  const customerIds=new Set((state.customers||[]).filter(customer=>customer.status!=='merged'&&(customer.id===record.customerId||customer.studentId===record.id)).map(customer=>customer.id));
  if((state.opportunities||[]).some(opportunity=>customerIds.has(opportunity.customerId)&&opportunity.ownerId===actor.id)||(state.crmTasks||[]).some(task=>customerIds.has(task.customerId)&&(task.ownerId===actor.id||task.assigneeId===actor.id)&&['pending','in_progress'].includes(task.status)))return true;
 }
 if(scope.type==='own'){
  const boundOrder=k==='orders'?record:order;
  if(boundOrder?.opportunityId&&['orders','enrollments','receipts','refunds'].includes(k)){
   const opportunity=(state.opportunities||[]).find(x=>x.id===boundOrder.opportunityId),currentOwner=boundOrder.ownerId||opportunity?.ownerId;
   const historical=read&&(boundOrder.attributionSnapshot?.ownerId===actor.id||(state.attributionAdjustments||[]).some(x=>x.orderId===boundOrder.id&&(x.before?.ownerId===actor.id||x.after?.ownerId===actor.id)));
   return currentOwner===actor.id||!!historical;
  }
  if(k==='orders'&&read&&(record.attributionSnapshot?.ownerId===actor.id||(state.attributionAdjustments||[]).some(x=>x.orderId===record.id&&(x.before?.ownerId===actor.id||x.after?.ownerId===actor.id))))return true;
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
  // A shared student grants access to the student profile, not to every course
  // that student attends. Academic and financial records keep their own scope.
  if(k==='students'){
   const studentId=record.id;
   if(state.classes.some(c=>assigned(c)&&(c.studentIds?.includes(studentId)||state.enrollments.some(e=>e.studentId===studentId&&e.classId===c.id&&['active','pending'].includes(e.status)))))return true;
   return state.sessionAdjustments.some(a=>['active','completed'].includes(a.status)&&(a.studentId===studentId||state.enrollments.some(e=>e.id===a.enrollmentId&&e.studentId===studentId))&&state.classes.some(c=>c.id===a.targetClassId&&(c.schedule||[]).some(s=>s.id===a.targetSessionId&&(s.substituteTeacherId||s.teacherId||c.teacherId)===actor.id)));
  }
  const sessionAssigned=(classId,sessionId)=>{const c=state.classes.find(c=>c.id===classId),s=c?.schedule?.find(s=>s.id===sessionId);return !!(c&&(sessionId?s&&(s.substituteTeacherId||s.teacherId||c.teacherId)===actor.id:assigned(c)));};
  if(k==='sessionAdjustments')return sessionAssigned(record.sourceClassId,record.sourceSessionId)||sessionAssigned(record.targetClassId,record.targetSessionId);
  if(['attendance','consumptions'].includes(k)){
   // Preserve historical attribution when the teacher or class later changes.
   if(record.substituteTeacherId||record.teacherId)return (record.substituteTeacherId||record.teacherId)===actor.id;
   return sessionAssigned(record.classId,record.sessionId);
  }
  const enrollment=record.enrollmentId&&state.enrollments.find(e=>e.id===record.enrollmentId);
  const related=klass||(order&&state.classes.find(c=>c.id===order.classId))||(enrollment&&state.classes.find(c=>c.id===enrollment.classId));
  return !!assigned(related);
 }
 return false;
}

// CRM customer access is explicit or follows an authorized stable-ID relationship.
// It never follows a matching name or phone number.
function canAccessCrm(state,actor,record,kind,options={}){
 const read=options.access==='read',scope=actor.scope||{type:'own'};
 if(kind==='savedCrmViews')return record.ownerId===actor.id;
 const manager=actor.permissions?.includes('lead.assign');
 if(kind==='attributionRequests'&&!read&&!manager)return false;
 if(kind==='attributionAdjustments'&&!read)return false;
 if(['routingRules','routingQueue'].includes(kind)&&!manager)return false;

 if(scope.type==='campus'){
  const ids=Array.isArray(record.campusIds)?record.campusIds:[record.campusId].filter(Boolean);
  if(kind==='campaigns'&&!read&&record.createdBy!==actor.id&&record.ownerId!==actor.id&&!manager)return false;
  if(kind==='serviceTickets'&&!read&&record.ownerId!==actor.id&&!manager)return false;
  return ids.length>0&&(read?ids.some(id=>scope.campusIds?.includes(id)):ids.every(id=>scope.campusIds?.includes(id)));
 }
 if(!['own','assigned'].includes(scope.type))return false;
 const owns=record.ownerId===actor.id||record.assigneeId===actor.id;
 if(kind==='serviceTickets'){
  if(!read)return owns||manager&&record.createdBy===actor.id;
  if(owns||record.createdBy===actor.id)return true;
  const customer=(state.customers||[]).find(x=>x.id===record.customerId);return !!customer&&canAccess(state,actor,customer,'customers',{access:'read'});
 }
 if(kind==='attributionRequests')return read&&(record.applicantId===actor.id||record.ownerId===actor.id);
 if(kind==='attributionAdjustments')return read&&(record.before?.ownerId===actor.id||record.after?.ownerId===actor.id||record.reviewedBy===actor.id);
 if(kind==='importBatches')return record.createdBy===actor.id||record.ownerId===actor.id;
 if(kind==='routingRules'||kind==='routingQueue')return record.createdBy===actor.id;
 if(kind==='crmTaskBatches'){
  if(record.createdBy===actor.id)return true;
  return read&&(state.crmTasks||[]).some(task=>task.batchId===record.id&&(task.ownerId===actor.id||task.assigneeId===actor.id));
 }
 if(kind==='campaigns')return record.ownerId===actor.id||record.createdBy===actor.id||read&&(record.participantIds?.includes(actor.id)||record.promoterIds?.includes(actor.id));
 if(kind==='crmTasks')return owns||record.createdBy===actor.id&&actor.permissions?.includes('lead.assign');
 if(kind==='customers'){
  if(owns||!record.ownerId&&record.createdBy===actor.id)return true;
  if(!read)return (state.leads||[]).some(lead=>lead.customerId===record.id&&canAccess(state,actor,lead,'leads',{access:'write'}))||(state.opportunities||[]).some(op=>op.customerId===record.id&&op.ownerId===actor.id&&op.stage!=='closed');
  if(record.createdBy===actor.id)return true;
  if((state.leads||[]).some(lead=>lead.customerId===record.id&&canAccess(state,actor,lead,'leads',{access:'read'})))return true;
  if((state.opportunities||[]).some(op=>op.customerId===record.id&&op.ownerId===actor.id))return true;
  if((state.crmTasks||[]).some(task=>task.customerId===record.id&&task.ownerId===actor.id&&['pending','in_progress'].includes(task.status)))return true;
  const student=(state.students||[]).find(s=>s.id===record.studentId||s.customerId===record.id);
  return !!student&&canAccess(state,actor,student,'students',{access:'read'});
 }
 if(kind==='opportunities'){if(owns||read&&record.createdBy===actor.id)return true;if(!read)return false;const customer=(state.customers||[]).find(row=>row.id===record.customerId);return !!customer&&canAccess(state,actor,customer,'customers',{access:'read'});}
 if(kind==='consultations'||kind==='touchpoints'){
  if(owns||record.createdBy===actor.id)return true;
  if(!read)return false;
  const customer=(state.customers||[]).find(row=>row.id===record.customerId);
  return !!customer&&canAccess(state,actor,customer,'customers',{access:'read'});
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
