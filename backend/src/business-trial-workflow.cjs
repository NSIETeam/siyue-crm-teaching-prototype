'use strict';
const {assert,canAccess}=require('./business-common.cjs');
const academic=require('./business-academic.cjs');
const crm=require('./business-crm.cjs');
const academicDictionary=require('../../academic-dictionary.js');
const {hash}=require('./business-form-rewards.cjs');
const {scrub}=require('./business-reception.cjs');
const active=u=>u&&!u.disabled&&!u.mustChangePassword&&!u.archivedAt;
const campusAllowed=(actor,campusId)=>actor.scope?.type==='all'||actor.scope?.type==='own'&&actor.permissions?.includes('lead.follow')||actor.scope?.type==='campus'&&actor.scope.campusIds?.includes(campusId);
const manages=(actor,campusId)=>active(actor)&&(actor.roleIds||[]).some(r=>['academic','superadmin'].includes(r))&&actor.permissions?.includes('class.create')&&['all','campus'].includes(actor.scope?.type)&&campusAllowed(actor,campusId);
function leadFor(s,actor,id){const lead=(s.leads||[]).find(l=>l.id===id);assert(active(actor)&&actor.permissions?.includes('lead.follow')&&lead?.ownerId===actor.id&&canAccess(s,actor,lead,'leads',{access:'write'}),'只能为本人负责的线索预约试听','FORBIDDEN',403);assert(lead.decisionStatus!=='pending'&&!['cold','archived'].includes(lead.status)&&!['已流失','已归档'].includes(lead.stage),'该线索当前不能预约试听','INVALID_STATE',409);return lead;}
function academicLead(s,actor,id){
 const lead=(s.leads||[]).find(l=>l.id===id);
 assert(lead&&manages(actor,lead.campusId)&&actor.permissions?.includes('lead.create'),'线索不存在或不在授权校区','NOT_FOUND',404);
 assert(lead.ownerId&&lead.decisionStatus!=='pending'&&!['cold','archived'].includes(lead.status)&&!['已流失','已归档'].includes(lead.stage),'请先确定跟进负责人并完成线索去向，归档线索须先恢复','INVALID_STATE',409);
 return lead;
}
function communication(lead,r,c,pending=false){
 const kind=pending?'trial_pending':'trial_confirmed';
 if((lead.history||[]).some(e=>e.detail?.trialRequestId===r.id&&e.detail?.trialEvent===kind))return;
 lead.firstFollowAt=lead.firstFollowAt||c.now;lead.lastFollowAt=c.now;lead.assignmentFollowAt=c.now;
 if(!['已报名','待报名'].includes(lead.stage)){lead.stage='跟进中';lead.status='assigned';}
 crm.helpers.event(lead,c,'跟进',{note:pending?'申请了试课，待教务复核':'预约了试课',channel:'系统记录',trialRequestId:r.id,trialEvent:kind,classId:r.classId,sessionId:r.sessionId,automatic:true});
}
function clock(session){const match=String(session.time||'').match(/^(\d{2}):(\d{2})\s*[-–—~至]\s*(\d{2}):(\d{2})$/);assert(/^\d{4}-\d{2}-\d{2}$/.test(session.date)&&match,'课次时间无效','TRIAL_SLOT_UNAVAILABLE',409);const [h,m,eh,em]=match.slice(1).map(Number);assert(h<24&&eh<24&&m<60&&em<60,'课次时间无效','TRIAL_SLOT_UNAVAILABLE',409);const start=Date.parse(session.date+'T'+match[1]+':'+match[2]+':00+08:00'),end=Date.parse(session.date+'T'+match[3]+':'+match[4]+':00+08:00');assert(Number.isFinite(start)&&Number.isFinite(end)&&new Date(start+8*3600000).toISOString().slice(0,10)===session.date&&end>start,'课次时间无效','TRIAL_SLOT_UNAVAILABLE',409);return {start,end};}
const overlap=(a,b)=>a.start<b.end&&b.start<a.end;
const liveClass=c=>c&&c.active!==false&&!['ended','cancelled','inactive','已结束','已结课','已取消','已关闭','closed'].includes(c.status);
const liveSession=s=>s&&!['ended','cancelled','completed','已结束','已取消','已完成'].includes(s.status);
function roomFor(s,klass,session){const campus=(s.campuses||[]).find(c=>c.id===(session.campusId||klass.campusId));const roomId=session.roomId||(session.room?null:klass.roomId),roomName=session.room||klass.room;const room=roomId?campus?.roomDetails?.find(r=>r.id===roomId):campus?.roomDetails?.find(r=>r.name===roomName);assert(campus?.active!==false&&campus&&room&&room.active!==false&&Number.isSafeInteger(room.capacity)&&room.capacity>0,'该课次缺少有效的教室实际容量','TRIAL_SLOT_UNAVAILABLE',409);return {campus,room};}
function slot(s,classId,sessionId,now,future=true){
 const klass=(s.classes||[]).find(c=>c.id===classId),session=klass?.schedule?.find(x=>x.id===sessionId),course=(s.courses||[]).find(c=>c.id===klass?.courseId);
 assert(liveClass(klass)&&liveSession(session)&&course&&course.active!==false,'班级、课程或课次已停用','TRIAL_SLOT_UNAVAILABLE',409);const when=clock(session);if(future)assert(when.start>Date.parse(now),'该试听课次已开始或已过期','TRIAL_SLOT_UNAVAILABLE',409);
 const {campus,room}=roomFor(s,klass,session),occupants=new Set(),trials=new Set();
 // Count everybody occupying this physical room during the requested interval,
 // including temporary rosters and already confirmed public-form trial bookings.
 for(const c of s.classes||[])if(liveClass(c))for(const ss of c.schedule||[]){
  if(!liveSession(ss))continue;let info,t;try{info=roomFor(s,c,ss);t=clock(ss);}catch{continue;}
  if(info.campus.id!==campus.id||(info.room.id?info.room.id!==room.id:info.room.name!==room.name)||!overlap(when,t))continue;
  const roster=academic.sessionRoster(s,c.id,ss.id,now,true);
  for(const id of roster){const student=(s.students||[]).find(x=>x.id===id);occupants.add(student?.name&&student?.phone?String(student.name).trim().toLocaleLowerCase()+'|'+hash(student.phone):'student:'+id);}
  for(const booking of s.trialBookings||[])if(booking.status==='confirmed'&&booking.classId===c.id&&booking.sessionId===ss.id)trials.add(booking.name&&booking.phoneHash?String(booking.name).trim().toLocaleLowerCase()+'|'+booking.phoneHash:'booking:'+booking.id);
 }
 for(const identity of occupants)trials.delete(identity);
 const physicalCapacity=room.capacity,virtualSeats=Number.isSafeInteger(room.virtualSeats)&&room.virtualSeats>0?room.virtualSeats:0,capacity=physicalCapacity+virtualSeats,occupied=occupants.size+trials.size;
 return {classId:klass.id,sessionId:session.id,courseId:course.id,courseName:scrub(course.name),className:scrub(klass.name),grade:scrub(course.grade||klass.grade),subject:scrub(course.subject||klass.subject),campusId:campus.id,campusName:scrub(campus.name),roomId:room.id||null,roomName:scrub(room.name),capacity,physicalCapacity,virtualSeats,formalStudents:occupants.size,confirmedTrials:trials.size,remaining:Math.max(0,capacity-occupied),date:session.date,time:session.time,teacherId:session.substituteTeacherId||session.teacherId||klass.teacherId||null,start:when.start,end:when.end};
}
function ensureCapacity(s,lead,chosen,now,allowFull=false){
 const identity=lead.name&&lead.phone?String(lead.name).trim().toLocaleLowerCase()+'|'+hash(lead.phone):null;
 const students=(s.students||[]).filter(x=>x.id===lead.studentId||x.originLeadId===lead.id||identity&&x.name&&x.phone&&String(x.name).trim().toLocaleLowerCase()+'|'+hash(x.phone)===identity);
 for(const c of s.classes||[])if(liveClass(c))for(const ss of c.schedule||[]){if(!liveSession(ss))continue;let t;try{t=clock(ss);}catch{continue;}if(!overlap(chosen,t))continue;const roster=academic.sessionRoster(s,c.id,ss.id,now,true);assert(!students.some(x=>roster.includes(x.id)),'学员该时间已有正式上课安排','STUDENT_CONFLICT',409);for(const b of s.trialBookings||[])if(b.status==='confirmed'&&b.classId===c.id&&b.sessionId===ss.id)assert(!(b.leadId===lead.id||identity&&b.name&&b.phoneHash&&String(b.name).trim().toLocaleLowerCase()+'|'+b.phoneHash===identity),'学员该时间已有试听预约','STUDENT_CONFLICT',409);}
 assert(allowFull||chosen.remaining>0,'该教室实体及虚拟座位均已满，请重新选择课次','TRIAL_CAPACITY_FULL',409);
}
function notification(s,c,ownerId,kind,requestId,campusId,text){if(!ownerId)return;const rows=s.inbox||= [];if(rows.some(n=>n.ownerId===ownerId&&n.trialRequestId===requestId&&n.kind===kind))return;rows.push({id:c.id('NOTICE'),ownerId,kind,trialRequestId:requestId,campusId,title:kind==='trial.review.required'?'试听申请待教务复核':kind==='trial.requested'?'新的试听预约':kind.startsWith('trial.task.assigned')?'试听准备任务':'试听申请状态更新',text:scrub(text),createdAt:c.now,read:false});}
function recipients(c,campusId){return (c.directory||[]).filter(u=>active(u)&&u.roleIds?.includes('academic')&&manages(u,campusId));}
function personName(c,id){return scrub((c.directory||[]).find(u=>u.id===id)?.name||'未指定');}
function basic(lead){return {name:scrub(lead.name),grade:scrub(lead.grade),subject:scrub(lead.subject),studentNo:scrub(lead.studentNo||'')};}
function version(row,i){assert(i.expectedVersion===row.version,'申请或任务已更新，请刷新后重试','VERSION_CONFLICT',409);}
function requestFor(s,c,id){const request=(s.trialRequests||[]).find(r=>r.id===id);assert(request&&(manages(c.actor,request.campusId)||request.salesId===c.actor.id||(s.leads||[]).some(l=>l.id===request.leadId&&l.ownerId===c.actor.id)),'申请不存在或不在授权范围','NOT_FOUND',404);return request;}
const string=title=>({type:'string',minLength:1,maxLength:120,title});
function operation(id,label,permission,properties,required,run){return {id,label,permission,group:'crm',inputSchema:{type:'object',additionalProperties:false,properties,required},run(s,i,c){c.require(permission);return run(s,i,c);}};}
const ver={type:'integer',minimum:1,title:'记录版本'},note={type:'string',minLength:1,maxLength:2000,title:'说明'};
const operations=[
 operation('lead.trialIntake','预约试听 · 登记或匹配线索','lead.create',crm.operations.find(o=>o.id==='lead.create').inputSchema.properties,['name','phone','source','campusId'],(s,i,c)=>{
  assert(manages(c.actor,i.campusId),'仅授权校区教务可以登记试听','FORBIDDEN',403);
  assert(i.followChoice===undefined,'请通过负责人选择确定跟进人员');
  const name=crm.helpers.text(i.name,'学生姓名',100),number=crm.helpers.phone(i.phone),key=crm.helpers.leadKey(name,number);
  const matches=(s.leads||[]).filter(l=>crm.helpers.leadKey(l.name,l.contactPhone||l.phone)===key);
  assert(matches.length<=1,'存在重复档案，请联系管理员核对','DUPLICATE_LEAD',409);
  let lead=matches[0];const matched=!!lead;
  if(lead){
   assert(manages(c.actor,lead.campusId)&&lead.campusId===i.campusId,'已有档案不在所选授权校区，请联系负责人处理','LEAD_SCOPE_CONFLICT',409);
   assert(lead.decisionStatus!=='pending'&&!['cold','archived'].includes(lead.status)&&!['已流失','已归档'].includes(lead.stage),'线索须先完成去向决策或恢复归档','INVALID_STATE',409);
   if(!lead.ownerId){assert(i.ownerId,'请为未分配线索选择跟进负责人');crm.helpers.assign(lead,crm.helpers.owner(c,i.ownerId,lead.campusId),c,'教务试听登记');lead.decisionStatus='retained';lead.decisionDeadline=null;crm.helpers.event(lead,c,'分配',{reason:'教务试听登记',ownerId:lead.ownerId});}
  }else{assert(i.ownerId,'请为新线索选择跟进负责人');lead=crm.helpers.createLead(s,i,c,false,{academicTrial:true});}
  return {matched,record:{id:lead.id,name:lead.name,phone:number,campusId:lead.campusId,ownerId:lead.ownerId,owner:lead.owner,grade:lead.grade,stage:lead.stage,source:lead.source}};
 }),
 operation('trial.request','预约试听','lead.follow',{leadId:string('本人线索'),classId:string('班级'),sessionId:string('上课时间'),note},['leadId','classId','sessionId'],(s,i,c)=>requestTrial(s,i,c,false)),
 operation('trial.academicRequest','教务预约试听','class.create',{leadId:string('线索'),classId:string('班级'),sessionId:string('上课时间'),note},['leadId','classId','sessionId'],(s,i,c)=>requestTrial(s,i,c,true)),
 operation('trial.review','复核满员试听申请','class.create',{requestId:string('申请'),decision:{type:'string',enum:['approve','reject']},expectedVersion:ver,classId:string('安排班级'),sessionId:string('安排课次'),note},['requestId','decision','expectedVersion','note'],(s,i,c)=>{
  const r=requestFor(s,c,i.requestId);assert(manages(c.actor,r.campusId),'仅对应校区教务可以复核','FORBIDDEN',403);version(r,i);assert(r.status==='pending'&&r.reviewRequired===true,'申请已处理或不需要复核','INVALID_STATE',409);assert(['approve','reject'].includes(i.decision),'复核结果无效');const reason=String(i.note||'').trim();assert(reason,'请填写复核说明');assert(!!i.classId===!!i.sessionId,'安排班级和课次须同时填写');
  if(i.decision==='approve'){
   const lead=(s.leads||[]).find(l=>l.id===r.leadId);assert(lead&&lead.ownerId===r.salesId&&lead.decisionStatus!=='pending'&&!['cold','archived'].includes(lead.status)&&!['已流失','已归档'].includes(lead.stage),'线索归属或状态已变化','LEAD_OWNER_CHANGED',409);
   const chosen=slot(s,i.classId||r.classId,i.sessionId||r.sessionId,c.now);assert(chosen.campusId===r.campusId,'仅能安排原申请校区课次','FORBIDDEN',403);assert(chosen.courseId===r.requestedSlotSnapshot?.courseId||chosen.courseId===r.slotSnapshot?.courseId,'安排课程须与申请课程一致','TRIAL_SLOT_UNAVAILABLE',409);ensureCapacity(s,lead,chosen,c.now);
   const from={classId:r.classId,sessionId:r.sessionId};r.classId=chosen.classId;r.sessionId=chosen.sessionId;confirm(s,r,lead,chosen,c);r.confirmationMode='academic_review';r.history.push({at:c.now,actorId:c.actor.id,kind:'reviewed',decision:'approve',note:scrub(reason),from,to:{classId:r.classId,sessionId:r.sessionId}});
  }else{r.status='rejected';r.history.push({at:c.now,actorId:c.actor.id,kind:'reviewed',decision:'reject',note:scrub(reason)});}
  r.reviewedBy=c.actor.id;r.reviewedAt=c.now;r.reviewNote=scrub(reason);r.version++;r.updatedAt=c.now;notification(s,c,r.salesId,'trial.reviewed',r.id,r.campusId,`${r.name} 的试听申请${r.status==='approved'?'已通过并安排课次':'未通过'}。`);return {record:projectRequest(s,c.actor,c.directory,r,c.now)};
 }),
 operation('trial.cancel','取消试听预约','lead.create',{requestId:string('申请'),expectedVersion:ver,note},['requestId','expectedVersion','note'],(s,i,c)=>{
  const r=requestFor(s,c,i.requestId);version(r,i);assert(['pending','approved'].includes(r.status),'该申请不能取消','INVALID_STATE',409);if(!manages(c.actor,r.campusId))leadFor(s,c.actor,r.leadId);const currentSession=(s.classes||[]).find(klass=>klass.id===r.classId)?.schedule?.find(session=>session.id===r.sessionId);assert(clock(currentSession||r.slotSnapshot).start>Date.parse(c.now),'已开始的试听不能取消','INVALID_STATE',409);
  r.status='cancelled';r.version++;r.updatedAt=c.now;r.history.push({at:c.now,actorId:c.actor.id,kind:'cancelled',note:scrub(i.note)});const booking=(s.trialBookings||[]).find(b=>b.id===r.bookingId);if(booking)booking.status='cancelled';for(const task of s.trialTasks||[])if(task.requestId===r.id&&!task.retiredAt){if(task.status!=='completed'){task.status='cancelled';task.version++;task.updatedAt=c.now;}notification(s,c,task.assigneeId,'trial.cancelled',r.id,r.campusId,`${r.name} 的试听申请已取消，请停止该试听安排。`);}
  for(const u of recipients(c,r.campusId))notification(s,c,u.id,'trial.cancelled',r.id,r.campusId,`${r.name} 的试听申请已取消。`);notification(s,c,r.salesId,'trial.cancelled',r.id,r.campusId,`${r.name} 的试听申请已取消。`);return {record:projectRequest(s,c.actor,c.directory,r,c.now)};
 }),
 operation('trial.migrateAutomatic','同步历史试听预约','class.create',{note},['note'],(s,i,c)=>{
  assert(c.actor.roleIds?.includes('superadmin'),'仅超级管理员可以同步历史试听','FORBIDDEN',403);const converted=[],blocked=[];
  for(const r of s.trialRequests||[])if(r.status==='pending'){
   if(r.reviewRequired){blocked.push({id:r.id,code:'ACADEMIC_REVIEW_REQUIRED'});continue;}
   try{const lead=(s.leads||[]).find(l=>l.id===r.leadId);assert(lead&&lead.ownerId===r.salesId&&!['cold','archived'].includes(lead.status),'线索归属或状态已变化','LEAD_OWNER_CHANGED',409);const chosen=slot(s,r.classId,r.sessionId,c.now);assert(chosen.campusId===r.campusId,'课次校区已变化','TRIAL_SLOT_UNAVAILABLE',409);ensureCapacity(s,lead,chosen,c.now);confirm(s,r,lead,chosen,c);r.version++;r.updatedAt=c.now;r.history.push({at:c.now,actorId:c.actor.id,kind:'auto_confirmed',note:scrub(i.note)});converted.push(r.id);
   }catch(e){if(!e.code)throw e;blocked.push({id:r.id,code:e.code});r.status='cancelled';r.version++;r.updatedAt=c.now;r.reviewNote='历史待审批预约未能自动确认：'+scrub(e.message);r.history.push({at:c.now,actorId:c.actor.id,kind:'automatic_confirmation_unavailable',code:e.code,note:scrub(i.note)});}
  }
  let retiredTasks=0;for(const t of s.trialTasks||[])if(!t.retiredAt){t.retiredAt=c.now;t.retiredReason='试听准备任务已取消';if(t.status==='pending'){t.status='cancelled';t.version++;t.updatedAt=c.now;}retiredTasks++;}
  return {record:{id:'trial-automatic-migration',converted,blocked,retiredTasks}};
 })
];
function requestTrial(s,i,c,academicBooking){
  const lead=academicBooking?academicLead(s,c.actor,i.leadId):leadFor(s,c.actor,i.leadId),chosen=slot(s,i.classId,i.sessionId,c.now);assert(campusAllowed(c.actor,chosen.campusId),'试听校区不在授权范围','FORBIDDEN',403);if(academicBooking)assert(chosen.campusId===lead.campusId,'请选择线索所属校区的课次','FORBIDDEN',403);ensureCapacity(s,lead,chosen,c.now,true);
  const rows=s.trialRequests||= [];assert(!rows.some(r=>r.leadId===lead.id&&r.classId===chosen.classId&&r.sessionId===chosen.sessionId&&['pending','approved'].includes(r.status)),'该线索已申请相同试听课次','TRIAL_DUPLICATE',409);
  const receivers=recipients(c,chosen.campusId),record={id:c.id('TRIAL_REQUEST'),leadId:lead.id,salesId:lead.ownerId,salesName:personName(c,lead.ownerId),requestedBy:c.actor.id,...basic(lead),subject:chosen.subject,campusId:chosen.campusId,classId:chosen.classId,sessionId:chosen.sessionId,slotSnapshot:chosen,note:scrub(i.note||''),status:'pending',version:1,createdAt:c.now,updatedAt:c.now,notifiedAcademicIds:receivers.map(u=>u.id),history:[{at:c.now,actorId:c.actor.id,kind:'requested'}]};record.requestedSlotSnapshot=structuredClone(chosen);record.reviewRequired=chosen.remaining<=0;rows.push(record);if(record.reviewRequired){record.confirmationMode='academic_review_required';communication(lead,record,c,true);}else{confirm(s,record,lead,chosen,c);record.history.push({at:c.now,actorId:c.actor.id,kind:'auto_confirmed'});}
  for(const u of receivers)notification(s,c,u.id,record.reviewRequired?'trial.review.required':'trial.requested',record.id,chosen.campusId,`${record.name} · ${chosen.courseName} · ${chosen.date} ${chosen.time}，${record.reviewRequired?'原课次满员，等待校区教务复核安排，不占位。':'已自动预约，可在前台接待查看。'}`);
  return {record:projectRequest(s,c.actor,c.directory,record,c.now),notificationCount:receivers.length};
}
function confirm(s,r,lead,chosen,c){
 const booking={id:c.id('TRIAL'),requestId:r.id,leadId:r.leadId,classId:r.classId,sessionId:r.sessionId,campusId:r.campusId,name:lead.name,grade:lead.grade,subject:chosen.subject,phoneHash:hash(lead.phone||lead.contactPhone||''),publisherId:r.salesId,status:'confirmed',bookedAt:c.now,createdAt:c.now,slotSnapshot:chosen};(s.trialBookings||=[]).push(booking);r.bookingId=booking.id;r.slotSnapshot=chosen;r.status='approved';r.confirmationMode='automatic';r.confirmedAt=c.now;communication(lead,r,c);
}
// Display the linked lead's current name without rewriting booking or audit snapshots.
function currentName(s,row){const lead=(s.leads||[]).find(l=>l.id===row.leadId);return scrub(typeof lead?.name==='string'&&lead.name.trim()?lead.name:row.name);}
function projectRequest(s,actor,directory,r,now){let current;try{current=slot(s,r.classId,r.sessionId,now,false);}catch{current={...r.slotSnapshot,unavailable:true};}return {id:r.id,leadId:r.leadId,name:currentName(s,r),grade:scrub(r.grade),subject:scrub(r.subject),studentNo:scrub(r.studentNo),salesId:r.salesId,salesName:scrub(r.salesName),campusId:r.campusId,status:r.status,confirmationMode:r.confirmationMode||'historical',version:r.version,note:scrub(r.note),reviewNote:scrub(r.reviewNote||''),createdAt:r.createdAt,updatedAt:r.updatedAt,slot:current,reviewRequired:r.reviewRequired===true,requestedSlot:r.requestedSlotSnapshot||null,canReview:r.status==='pending'&&r.reviewRequired===true&&manages(actor,r.campusId),canCancel:['pending','approved'].includes(r.status)&&current.start>Date.parse(now)&&(manages(actor,r.campusId)||actor.permissions?.includes('lead.follow')&&(s.leads||[]).some(l=>l.id===r.leadId&&l.ownerId===actor.id))};}
function publicRequest(s,actor,directory,b,now){let chosen;try{chosen=slot(s,b.classId,b.sessionId,now,false);}catch{return null;}const sales=(directory||[]).find(u=>u.id===b.publisherId);return {id:'booking:'+b.id,leadId:b.leadId||null,name:currentName(s,b),grade:scrub(b.grade),subject:scrub(b.subject||chosen.subject),studentNo:'',salesId:b.publisherId,salesName:scrub(sales?.name||'未指定'),campusId:chosen.campusId,status:b.status==='confirmed'?'approved':'cancelled',version:1,note:'',reviewNote:'',createdAt:b.createdAt||b.bookedAt||'',slot:chosen,canReview:false,canCancel:false,confirmationMode:'automatic'};}
// Only minimal, campus-authorized fields are returned for choosing a trial lead.
function searchLeads(snapshot,actor,directory,input){
 assert(active(actor)&&actor.permissions?.includes('lead.create')&&actor.permissions?.includes('class.create')&&actor.roleIds?.some(r=>['academic','superadmin'].includes(r))&&['all','campus'].includes(actor.scope?.type),'仅授权校区教务可以搜索试听线索','FORBIDDEN',403);
 assert(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).every(k=>k==='search')&&typeof input.search==='string'&&input.search.length<=100&&!/[\u0000-\u001f]/.test(input.search),'搜索条件无效','INVALID_QUERY',400);
 const query=input.search.normalize('NFKC').trim().toLocaleLowerCase(),digits=query.replace(/[\s()+-]/g,'').replace(/^(?:\+?86|0086)(?=1[3-9]\d{9}$)/,''),phoneQuery=/^\d+$/.test(digits);
 if(phoneQuery&&digits.length<4)return {items:[],hasMore:false,hint:'请输入至少四位电话号码，或按姓名搜索',revision:snapshot.revision};
 const s=snapshot.state,rows=(s.leads||[]).filter(l=>(s.campuses||[]).some(c=>c.id===l.campusId&&c.active!==false)&&manages(actor,l.campusId)).filter(l=>!query||String(l.name||'').normalize('NFKC').toLocaleLowerCase().includes(query)||phoneQuery&&String(l.contactPhone||l.phone||'').replace(/\D/g,'').includes(digits)).sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||''))||String(a.id).localeCompare(String(b.id)));
 return {items:rows.slice(0,20).map(l=>{let reason='';try{academicLead(s,actor,l.id);}catch{reason=!l.ownerId?'请先在线索登记中指定跟进负责人':l.decisionStatus==='pending'?'请先完成线索去向决策':'该线索当前不可预约，请先处理线索状态';}const number=String(l.contactPhone||l.phone||'').replace(/\D/g,'');return {id:l.id,name:scrub(l.name),grade:scrub(l.grade),subject:scrub(l.subject),campusName:scrub((s.campuses||[]).find(c=>c.id===l.campusId)?.name),ownerName:personName({directory},l.ownerId),phoneMasked:number.length>=7?number.slice(0,3)+'****'+number.slice(-4):'未提供',canBook:!reason,reason};}),hasMore:rows.length>20,revision:snapshot.revision};
}
function read(snapshot,actor,directory,path,params,now=new Date().toISOString()){
 assert(active(actor),'账号当前不可用','FORBIDDEN',403);for(const k of params.keys())assert((path.endsWith('/slots')?['leadId','requestId','campusId','courseId','grade','subject','teacherId','date','from','to']:['leadId','status','page','pageSize','date','subject']).includes(k)&&params.getAll(k).length===1&&params.get(k).length<=120&&!/[\u0000-\u001f]/.test(params.get(k)),'查询参数无效','INVALID_QUERY',400);
 const s=snapshot.state;
 if(path.endsWith('/slots')){
  const review=params.get('requestId')?requestFor(s,{actor},params.get('requestId')):null;if(review)assert(manages(actor,review.campusId)&&review.status==='pending'&&review.reviewRequired,'仅对应校区教务可以安排待复核申请','FORBIDDEN',403);assert(!review||!params.get('leadId'),'安排查询不得混用线索和申请');const lead=review?(s.leads||[]).find(l=>l.id===review.leadId):(actor.roleIds?.some(r=>['academic','superadmin'].includes(r))&&actor.permissions?.includes('class.create')?academicLead(s,actor,params.get('leadId')):leadFor(s,actor,params.get('leadId'))),slots=[];assert(lead,'关联线索已不存在','NOT_FOUND',404);const date=params.get('date'),from=params.get('from'),to=params.get('to');
  const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
  assert((!params.has('date')||validDate(date))&&(!params.has('from')||validDate(from))&&(!params.has('to')||validDate(to)),'日期无效','INVALID_QUERY',400);
  assert(!!from===!!to&&!(date&&(from||to))&&(!from||from<=to&&Date.parse(to)-Date.parse(from)<=6*86400000),'课表范围须为连续七天以内，且不能混用单日筛选','INVALID_QUERY',400);
  for(const klass of s.classes||[])if(liveClass(klass))for(const session of klass.schedule||[])try{const item=slot(s,klass.id,session.id,now);if(campusAllowed(actor,item.campusId)&&(!manages(actor,lead.campusId)||item.campusId===lead.campusId)&&(!review||item.campusId===review.campusId&&item.courseId===(review.requestedSlotSnapshot?.courseId||review.slotSnapshot?.courseId)))slots.push(item);}catch{}
  const candidates=slots.map(item=>({...item,grade:academicDictionary.normalizeGrade(item.grade),teacherName:scrub((directory||[]).find(user=>user.id===item.teacherId)?.name||'')}));
  const filters={grade:params.get('grade')?academicDictionary.normalizeGrade(params.get('grade')):'',subject:params.get('subject')||'',campusId:params.get('campusId')||'',courseId:params.get('courseId')||'',teacherId:params.get('teacherId')||''};
  const matches=(item,except)=>Object.entries(filters).every(([key,value])=>key===except||!value||item[key]===value);
  const choices=(key,build)=>[...new Map(candidates.filter(item=>matches(item,key)).filter(item=>item[key]).map(item=>[item[key],build(item)])).values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')||a.id.localeCompare(b.id));
  const grades=choices('grade',x=>({id:x.grade,name:x.grade})),subjects=choices('subject',x=>({id:x.subject,name:x.subject})),campuses=choices('campusId',x=>({id:x.campusId,name:x.campusName})),courses=choices('courseId',x=>({id:x.courseId,name:x.courseName,grade:x.grade,subject:x.subject})),teachers=choices('teacherId',x=>({id:x.teacherId,name:x.teacherName||'授课老师'}));
  const matching=candidates.filter(item=>matches(item)).sort((a,b)=>a.start-b.start||a.classId.localeCompare(b.classId));
  const filtered=matching.filter(x=>(!date||x.date===date)&&(!from||x.date>=from&&x.date<=to));
  return {lead:basic(lead),grades,subjects,campuses,courses,teachers,slots:filtered.slice(0,200),total:filtered.length,matchingTotal:matching.length,nextAvailableDate:matching[0]?.date||null,hasMore:filtered.length>200,revision:snapshot.revision};
 }
 assert(path.endsWith('/requests'),'不存在此接口','NOT_FOUND',404);
 const status=params.get('status')||'all';assert(['all','pending','approved','rejected','cancelled'].includes(status),'状态无效');const page=Number(params.get('page')||1),pageSize=Number(params.get('pageSize')||25);assert(Number.isSafeInteger(page)&&page>=1&&page<=1000000&&Number.isSafeInteger(pageSize)&&pageSize>=1&&pageSize<=50,'分页参数无效');
 const isManager=(s.campuses||[]).some(c=>manages(actor,c.id)),canReadSales=actor.permissions?.includes('lead.follow'),canReadAssigned=actor.roleIds?.includes('teacher')&&actor.permissions?.includes('lead.create');assert(isManager||canReadSales||canReadAssigned,'没有试听待办查看权限','FORBIDDEN',403);
 const today=new Date(Date.parse(now)+8*3600000).toISOString().slice(0,10),date=params.get('date')==='today'?today:params.get('date');if(date)assert(/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+'T00:00:00Z'))&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date,'日期无效','INVALID_QUERY',400);
 let rows=(s.trialRequests||[]).filter(r=>(manages(actor,r.campusId)||canReadSales&&(r.salesId===actor.id||(s.leads||[]).some(l=>l.id===r.leadId&&l.ownerId===actor.id)))&&(!params.get('leadId')||r.leadId===params.get('leadId'))&&(status==='all'||r.status===status)).map(r=>projectRequest(s,actor,directory,r,now));
 if(!params.get('leadId'))for(const b of s.trialBookings||[]){if(b.requestId||(s.trialRequests||[]).some(r=>r.bookingId===b.id)||!['confirmed','cancelled'].includes(b.status))continue;const row=publicRequest(s,actor,directory,b,now);if(row&&(manages(actor,row.campusId)||canReadSales&&b.publisherId===actor.id)&&(status==='all'||row.status===status))rows.push(row);}
 rows=rows.filter(r=>!date||r.slot?.date===date);
 // Derive choices only after authorization, status and date filters, never from global courses.
 const subjects=[...new Set(rows.map(r=>r.subject||r.slot?.subject).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN')).map(name=>({id:name,name}));
 const subject=params.get('subject')||'';rows=rows.filter(r=>!subject||(r.subject||r.slot?.subject)===subject).sort((a,b)=>(a.slot?.start||0)-(b.slot?.start||0)||a.id.localeCompare(b.id));
 return {items:rows.slice((page-1)*pageSize,page*pageSize),total:rows.length,page,pageSize,today,subjects,tasks:[],taskTotal:0,notifications:[],isAcademicManager:isManager,revision:snapshot.revision};
}
module.exports={operations,read,searchLeads,slot,clock,manages,projectRequest};
