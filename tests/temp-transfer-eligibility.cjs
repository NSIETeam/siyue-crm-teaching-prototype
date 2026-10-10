const assert=require('node:assert/strict');
const boot=require('./runtime.cjs');
function fixture(){const env=boot();env.run(`
 permissionState.identity='admin';state.page='schedule';
 const date=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
 a.courses=[
  {id:'math4',name:'四年级数学',grade:'4年级',subject:'数学',active:true,lessons:[{id:'fraction',title:'分数初步'},{id:'geometry',title:'几何初步'}]},
  {id:'math3',name:'三年级数学',grade:'3年级',subject:'数学',active:true,lessons:[{id:'fraction',title:'分数初步'}]},
  {id:'chinese4',name:'四年级语文',grade:'4年级',subject:'语文',active:true,lessons:[{id:'fraction',title:'分数初步'}]},
  {id:'math4-copy',name:'四年级数学另一课程',grade:'四年级',subject:'数学',active:true,lessons:[{id:'fraction',title:'分数初步'}]}
 ];
 a.students=[{id:'s1',name:'数学学生',className:'原数学班',campus:'城中校区'}];
 const base={courseId:'math4',course:'四年级数学',date,time:'10:00–11:00',campus:'城中校区',room:'101',teacher:'甲老师',lessonId:'fraction',lessonVersion:1,studentIds:[],students:0,capacity:20,status:'未开课'};
 a.classes=[{...base,id:'src',name:'原数学班',time:'08:00–09:00',studentIds:['s1'],students:1},
 {...base,id:'valid',name:'四年级数学同章班'},
 {...base,id:'grade',name:'三年级错误班',courseId:'math3'},
 {...base,id:'subject',name:'语文错误班',courseId:'chinese4'},
 {...base,id:'chapter',name:'几何错误章节班',lessonId:'geometry'},
 {...base,id:'version',name:'旧内容版本班',lessonVersion:2},
 {...base,id:'other-course',name:'另一课程班',courseId:'math4-copy'}];
 a.attendance=[];a.sessionAdjustments=[];a.orders=[];a.selectedStudent=0;
 sysRules.move.enabled=true;sysRules.move.crossCampus=true;sysRules.move.advanceHours=0;
 workflowState.selectedSession={classIndex:0,studentIndex:0};
 $('#workflow-move-student').value='s1';$('#workflow-move-target').value='valid';
 `);return env}
let count=0;
function check(label,fn){fn();count++;console.log('PASS '+label)}

check('only same grade, subject, course, chapter and version targets are offered',()=>{
 const e=fixture();assert.deepEqual(Array.from(e.run('academicRepairTempMoveTargets(a.classes[0],"s1").map(c=>c.id)')),['valid']);
 const page=e.run('flowPage("tempMove")');assert(page.includes('四年级数学同章班'));
 for(const label of ['三年级错误班','语文错误班','几何错误章节班','旧内容版本班','另一课程班'])assert(!page.includes(label),label);
 assert(!page.includes('flow-from-session'));assert(!page.includes('flow-to-session'));assert(page.includes('分数初步'));
 assert(e.run('academicRepairCourseMatch(a.classes[0],a.classes[6])'),'Chinese/numeric grade aliases match, but different course IDs still cannot transfer');
});
check('session entry uses the same eligible target list and chapter',()=>{
 const e=fixture();e.run('academicRepairRenderSessionMove("s1")');const html=e.elements.get('#workflow-session-action').innerHTML;
 assert(html.includes('四年级数学同章班'));assert(html.includes('分数初步'));assert(!html.includes('语文错误班'));assert(!html.includes('几何错误章节班'));
});
check('tampered target selections are rejected at submission with no write',()=>{
 for(const id of ['grade','subject','chapter','version','other-course']){const e=fixture();e.run(`$('#workflow-move-target').value='${id}';workflowCommitMove()`);assert.equal(e.run('a.sessionAdjustments.length'),0,id);assert.equal(e.run('workflowSessionRoster(a.classes[0]).length'),1,id)}
});
check('missing metadata, missing real lesson and inactive courses cannot guess eligibility',()=>{
 for(const mutation of ['delete a.courses[0].grade','delete a.courses[0].subject','a.courses[0].lessons=[]','a.courses[0].active=false','a.classes[1].lessonId="math4-PENDING-1"']){const e=fixture();e.run(mutation);assert.equal(e.run('academicRepairTempMoveTargets(a.classes[0],"s1").length'),0,mutation);e.run('workflowCommitMove()');assert.equal(e.run('a.sessionAdjustments.length'),0,mutation)}
});
check('revalidation checks live capacity, timing, conflicts, campus policy and attendance',()=>{
 for(const mutation of [
  'a.classes[1].students=20',
  'a.classes[1].capacity=0',
  'a.classes[1].date="2020-01-01"',
  'a.classes[0].date="2020-01-01";a.classes[1].date="2020-01-01"',
  'a.classes[1].time="12:00–10:00"',
  'a.classes[1].status="已取消"',
  'a.classes[1].campus="园区校区";sysRules.move.crossCampus=false',
  'sysRules.move.enabled=false',
  'sysRules.move.advanceHours=999999',
  'a.classes.push({...a.classes[1],id:"conflict",name:"重叠课",time:"10:30–11:30",studentIds:["s1"]})',
  'a.attendance.push({classIndex:0,studentIndex:0,date:a.classes[0].date,status:"已考勤",attendance:"到课"})'
 ]){const e=fixture();e.run(mutation);e.run('workflowCommitMove()');assert.equal(e.run('a.sessionAdjustments.length'),0,mutation)}
});
check('permissions must include tempMove and academic; revoked roles cannot submit',()=>{
 const e=fixture();e.run(`permissionState.roles.push({id:'academic-clerk',active:true,grants:['classes','attendance','schedule','tempMove']});permissionState.identity='academic-clerk'`);
 assert.equal(e.run('academicRepairTempMoveTargets(a.classes[0],"s1").length'),1);
 e.run('permissionRole().grants=permissionRole().grants.filter(x=>x!=="tempMove");workflowCommitMove()');assert.equal(e.run('a.sessionAdjustments.length'),0);assert(e.messages.at(-1).includes('权限'));
 e.run('permissionRole().grants.push("tempMove");permissionRole().active=false;workflowCommitMove()');assert.equal(e.run('a.sessionAdjustments.length'),0);
});
check('unrelated student and duplicate IDs cannot be committed',()=>{
 for(const mutation of ['$("#workflow-move-student").value="stranger"','a.students.push({...a.students[0]})','a.classes.push({...a.classes[1]})']){const e=fixture();e.run(mutation);e.run('workflowCommitMove()');assert.equal(e.run('a.sessionAdjustments.length'),0,mutation)}
});
check('valid move changes only the session roster and retains original student membership',()=>{
 const e=fixture();e.run('a.attendance.push({classIndex:0,studentIndex:0,date:a.classes[0].date,status:"未考勤",attendance:"未考勤"});workflowCommitMove()');
 assert.equal(e.run('a.sessionAdjustments.length'),1);assert.equal(e.run('a.students[0].className'),'原数学班');
 assert.equal(e.run('workflowSessionRoster(a.classes[0]).length'),0);assert.equal(e.run('workflowSessionRoster(a.classes[1])[0].id'),'s1');
 assert.equal(e.run('a.attendance[0].status'),'已撤销');assert.equal(e.run('a.sessionAdjustments[0].sourceSessionId'),e.run('workflowSessionKey(a.classes[0])'));
 e.run(`state.page='schedule';workflowState.selectedSession={classIndex:0,studentIndex:0};workflowCommitMove()`);assert.equal(e.run('a.sessionAdjustments.length'),1);
});
check('business entry commits selected real source and target, without schedule detour',()=>{
 const e=fixture();e.run(`state.page='tempMove';flowPage('tempMove');$('#temp-move-student').value='s1';$('#flow-from').value='src';$('#flow-to').value='valid';finishFlow('tempMove')`);
 assert.equal(e.run('a.sessionAdjustments.length'),1);assert.equal(e.run('a.sessionAdjustments[0].sourceClassId'),'src');assert.equal(e.run('a.sessionAdjustments[0].targetClassId'),'valid');
});
check('storage failure rolls back adjustment and pending attendance together',()=>{
 const e=fixture();e.run('a.attendance.push({classIndex:0,studentIndex:0,date:a.classes[0].date,status:"未考勤",attendance:"未考勤"})');const before=e.run('JSON.stringify([a.sessionAdjustments,a.attendance,a.students,a.classes])');const save=e.ctx.localStorage.setItem;e.ctx.localStorage.setItem=(key,value)=>{if(key==='siyue-workflow-demo-v2')throw Error('storage full');return save(key,value)};e.run('workflowCommitMove()');assert.equal(e.run('JSON.stringify([a.sessionAdjustments,a.attendance,a.students,a.classes])'),before);assert(e.messages.some(x=>x.includes('数据已还原')));
});
console.log(`${count} temporary-transfer eligibility checks passed.`);
