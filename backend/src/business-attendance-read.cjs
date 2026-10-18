'use strict';
// Read-only attendance query/export. Membership and lock rules come from the write domain.
const {attendanceRoster,classTeachingMode,teacherWorkflow}=require('./business-academic.cjs');
const {assert}=require('./business-common.cjs');
const statuses=['attended','late','left_early','leave','absent'];
const fields=new Set(['view','teachingMode','courseType','campusId','courseId','classId','sessionId','teacherId','grade','subject','from','to','search','status','page','pageSize']);
function filters(input,ctx,exportMode){
 const entries=input instanceof URLSearchParams?[...input.entries()]:Object.entries(input||{}),seen=new Set(),q={};
 for(const [key,value] of entries){assert(fields.has(key)&&!seen.has(key),'考勤查询条件无效','INVALID_QUERY',400);seen.add(key);assert(typeof value==='string'&&value.length<=200&&!/[\u0000-\u001f\u007f]/.test(value),'考勤查询条件无效','INVALID_QUERY',400);q[key]=value.trim();}
 const today=new Date(Date.parse(ctx.now)+28800000).toISOString().slice(0,10),result={view:q.view||'sessions',teachingMode:q.teachingMode||'group',courseType:q.courseType||'onsite',campusId:q.campusId||'',courseId:q.courseId||'',classId:q.classId||'',sessionId:q.sessionId||'',teacherId:q.teacherId||'',grade:q.grade||'',subject:q.subject||'',from:q.from||today,to:q.to||q.from||today,search:q.search||'',status:q.status||'all'};
 assert(['sessions','students'].includes(result.view)&&['all','group','oneOnOne','oneOnMany'].includes(result.teachingMode)&&['all','onsite','live'].includes(result.courseType),'考勤视图条件无效','INVALID_QUERY',400);
 assert(['all','unrecorded','partial','recorded',...statuses].includes(result.status)&&!(result.view==='students'&&result.status==='partial'),'考勤状态条件无效','INVALID_QUERY',400);
 const date=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
 assert(date(result.from)&&date(result.to)&&result.from<=result.to&&Date.parse(result.to)-Date.parse(result.from)<=366*86400000,'请选择不超过366天的有效考勤日期范围','INVALID_QUERY',400);
 if(exportMode)assert(!seen.has('page')&&!seen.has('pageSize'),'导出不能包含分页条件','INVALID_QUERY',400);
 const page=Number(q.page||1),pageSize=Number(q.pageSize||50);assert(Number.isSafeInteger(page)&&page>=1&&page<=100000&&Number.isSafeInteger(pageSize)&&pageSize>=1&&pageSize<=200,'考勤分页条件无效','INVALID_QUERY',400);
 return {filters:result,page,pageSize};
}
function attendanceQuery(state,input,ctx,{exportMode=false}={}){
 ctx.require('session.attendance');const query=filters(input,ctx,exportMode),f=query.filters,teacherOnly=teacherWorkflow.teacherRestricted(ctx.actor),today=new Date(Date.parse(ctx.now)+28800000).toISOString().slice(0,10),can=(r,k)=>!ctx.can||ctx.can(r,k,{access:'read'}),lookup=(rows,id)=>(rows||[]).find(r=>r.id===id),courseIds=new Set(),teacherIds=new Set(),campusIds=new Set(),grades=new Set(),subjects=new Set();
 const all=[];
 for(const c of state.classes||[]){
  if(ctx.actor.scope?.type!=='campus'&&!can(c,'classes'))continue;
  const course=lookup(state.courses,c.courseId)||{},teachingMode=classTeachingMode(c),courseType=c.courseType||course.courseType||'onsite';
  for(const session of teacherWorkflow.sessions(c)){
   if(teacherOnly&&session.teacherId!==ctx.actor.id)continue;
   if(ctx.actor.scope?.type==='campus'&&!ctx.actor.scope.campusIds?.includes(session.campusId))continue;
   courseIds.add(c.courseId);teacherIds.add(session.teacherId);campusIds.add(session.campusId);if(c.grade||course.grade)grades.add(c.grade||course.grade);if(c.subject||course.subject)subjects.add(c.subject||course.subject);
   if(session.date<f.from||session.date>f.to||f.teachingMode!=='all'&&teachingMode!==f.teachingMode||f.courseType!=='all'&&courseType!==f.courseType||f.campusId&&session.campusId!==f.campusId||f.courseId&&c.courseId!==f.courseId||f.classId&&c.id!==f.classId||f.sessionId&&session.id!==f.sessionId||f.teacherId&&session.teacherId!==f.teacherId||f.grade&&(c.grade||course.grade)!==f.grade||f.subject&&(c.subject||course.subject)!==f.subject)continue;
   const roster=attendanceRoster(state,c.id,session.id,ctx),records=roster.map(r=>({...r,attendanceStatus:r.recorded?r.attendanceStatus:'unrecorded',writable:!r.locked&&teacherWorkflow.activeClass(c)&&teacherWorkflow.activeSession(session)&&(!teacherOnly||session.date===today)&&teacherWorkflow.starts(session)<=Date.parse(ctx.now)}));
   const lesson=(course.lessons||[]).find(l=>l.id===session.lessonId),site=lookup(state.campuses,session.campusId),teacher=lookup(ctx.directory,session.teacherId),recordedCount=records.filter(r=>r.recorded).length;
   const common={classId:c.id,className:c.name,courseId:c.courseId,courseName:course.name||c.course||'',courseType,teachingMode,lessonId:session.lessonId||'',lessonName:lesson?.title||'',lessonSequence:lesson?.sequence||(course.lessons||[]).findIndex(l=>l.id===session.lessonId)+1,sessionId:session.id,date:session.date,time:session.time,campusId:session.campusId,campusName:site?.name||session.campus||'',teacherId:session.teacherId,teacherName:teacher?.name||session.teacher||c.teacher||'',grade:c.grade||course.grade||'',subject:c.subject||course.subject||'',term:c.term||course.term||'',room:session.room||'',sessionStatus:session.status||'scheduled'};
   const search=f.search.toLocaleLowerCase(),baseMatches=!search||[common.className,common.courseName,common.lessonName,common.teacherName].join(' ').toLocaleLowerCase().includes(search),studentMatches=r=>!search||baseMatches||[r.name,r.studentId,r.phone].join(' ').toLocaleLowerCase().includes(search),statusMatches=r=>f.status==='all'||f.status==='recorded'&&r.recorded||r.attendanceStatus===f.status;
   if(f.view==='students'){
    for(const r of records)if(studentMatches(r)&&statusMatches(r))all.push({...common,studentId:r.studentId,studentName:r.name,phone:r.phone,recorded:r.recorded,attendanceStatus:r.attendanceStatus,consumptionConfirmed:r.consumptionConfirmed,note:r.note,locked:r.locked,lockedAt:r.lockedAt,writable:r.writable});
   }else{
    const recordingStatus=!recordedCount?'unrecorded':recordedCount===records.length?'recorded':'partial',statusOk=f.status==='all'||f.status===recordingStatus||statuses.includes(f.status)&&records.some(r=>r.attendanceStatus===f.status);
    if(statusOk&&(baseMatches||records.some(studentMatches)))all.push({...common,studentCount:records.length,recordedCount,unrecordedCount:records.length-recordedCount,recordingStatus,statusCounts:Object.fromEntries(statuses.map(status=>[status,records.filter(r=>r.attendanceStatus===status).length])),consumedCount:records.filter(r=>r.consumptionConfirmed).length,writable:records.some(r=>r.writable)});
   }
  }
 }
 all.sort((a,b)=>b.date.localeCompare(a.date)||a.time.localeCompare(b.time)||a.classId.localeCompare(b.classId)||a.sessionId.localeCompare(b.sessionId)||(a.studentId||'').localeCompare(b.studentId||''));
 assert(!exportMode||all.length<=20000,'导出超过20000条，请缩小日期或筛选范围','EXPORT_TOO_LARGE',409);
 const options={campuses:[...campusIds].filter(Boolean).map(id=>({id,name:lookup(state.campuses,id)?.name||id})),courses:[...courseIds].filter(Boolean).map(id=>({id,name:lookup(state.courses,id)?.name||id})),teachers:[...teacherIds].filter(Boolean).map(id=>({id,name:lookup(ctx.directory,id)?.name||id})),grades:[...grades].sort(),subjects:[...subjects].sort()};
 return {view:f.view,filters:f,total:all.length,page:exportMode?1:query.page,pageSize:exportMode?all.length:query.pageSize,exported:exportMode,items:exportMode?all:all.slice((query.page-1)*query.pageSize,query.page*query.pageSize),options};
}
module.exports={attendanceQuery,filters};
