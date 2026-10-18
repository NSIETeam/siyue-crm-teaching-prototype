'use strict';
const {assert}=require('./business-common.cjs');
function authorize(state,ctx,studentId,classId,permission){
 ctx.require(permission);assert(typeof studentId==='string'&&typeof classId==='string','需指定学生和班级');
 const student=ctx.get('students',studentId,{access:'read'}),klass=ctx.get('classes',classId,{access:'read'});
 assert(klass.active!==false&&!['ended','cancelled','inactive','已结束','已取消','已关闭'].includes(klass.status),'班级已结束');
 assert(state.enrollments.some(e=>e.studentId===studentId&&e.classId===classId&&e.status==='active'),'仅可沟通当前在读学生','NOT_ENROLLED',409);
 if(ctx.actor.scope.type==='assigned'||ctx.actor.roleIds?.includes('teacher')&&!ctx.actor.roleIds.some(r=>['superadmin','principal','academic'].includes(r)))assert(klass.teacherId===ctx.actor.id||(klass.schedule||[]).some(s=>(s.substituteTeacherId||s.teacherId)===ctx.actor.id),'仅可查看本人授课学生沟通','FORBIDDEN',403);
 return {student,klass};
}
function timeline(state,input,ctx){authorize(state,ctx,input.studentId,input.classId,'student.read');const records=(state.studentCommunications||[]).filter(r=>r.studentId===input.studentId&&r.classId===input.classId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id)).map(r=>structuredClone(r));return {records,total:records.length};}
function callbackTime(value,now){
 if(value===undefined||value==='')return null;
 const match=typeof value==='string'&&value.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/),time=Date.parse(value);
 assert(match&&Number.isFinite(time),'回访时间必须为带时区的有效时间');
 const offset=match[2]==='Z'?0:(match[3]==='-'?-1:1)*(Number(match[4])*60+Number(match[5]));
 assert(new Date(time+offset*60000).toISOString().slice(0,19)===match[1],'回访时间日期或时间无效');
 assert(time>Date.parse(now),'下次回访时间应晚于当前时间');
 return new Date(time).toISOString();
}
const operation={id:'student.communicate',label:'记录学生沟通',permission:'student.communicate',group:'student',inputSchema:{type:'object',additionalProperties:false,required:['studentId','classId','channel','note'],properties:{studentId:{type:'string',minLength:1,maxLength:120},classId:{type:'string',minLength:1,maxLength:120},channel:{type:'string',enum:['phone','wecom','text']},note:{type:'string',minLength:1,maxLength:5000},nextFollowAt:{type:'string',maxLength:40},expectedVersion:{type:'integer',minimum:1}}},run(state,input,ctx){const {student,klass}=authorize(state,ctx,input.studentId,input.classId,'student.communicate');assert(input.expectedVersion===undefined||input.expectedVersion===student.version,'学生资料版本已变化','VERSION_CONFLICT',409);assert(['phone','wecom','text'].includes(input.channel),'沟通渠道无效');assert(typeof input.note==='string'&&input.note.trim()&&input.note.length<=5000,'请填写有效沟通记录');const nextFollowAt=callbackTime(input.nextFollowAt,ctx.now);const record={id:ctx.id('communication'),studentId:student.id,classId:klass.id,campusId:klass.campusId,channel:input.channel,note:input.note.trim(),actorId:ctx.actor.id,actorName:ctx.actor.name||ctx.actor.id,createdAt:ctx.now,nextFollowAt};(state.studentCommunications||= []).push(record);return {record};}};
module.exports={operations:[operation],timeline};
