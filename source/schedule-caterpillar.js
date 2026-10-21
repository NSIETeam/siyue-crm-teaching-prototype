// Teacher and student schedules are shown as a chronological caterpillar;
// campus and room views remain tables for operational scanning.
function scTimeParts(c){
 const date=String(c.date||''),m=String(c.time||'').match(/^\s*(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})\s*$/);
 if(!m||!/^\d{4}-\d{2}-\d{2}$/.test(date))return {start:0,end:0};
 const [,sh,sm,eh,em]=m.map(Number),day=Date.parse(`${date}T00:00:00`),check=new Date(`${date}T12:00:00`);
 if(!Number.isFinite(day)||check.getFullYear()!==Number(date.slice(0,4))||check.getMonth()+1!==Number(date.slice(5,7))||check.getDate()!==Number(date.slice(8,10))||sh>23||eh>23||sm>59||em>59)return {start:0,end:0};
 const start=day+sh*3600000+sm*60000,end=day+eh*3600000+em*60000;
 return end>start?{start,end}:{start:0,end:0};
}
function scDateLabel(date){const d=new Date(`${date}T00:00:00`);return `${date} 周${'日一二三四五六'[d.getDay()]}`}
function scClassCancelled(c){return !c||c.active===false||['已取消','已停用'].includes(c.status)}
function scClassEnded(c){return ['已结课','已结束'].includes(c?.status)}
function scScheduledClassActive(c){return !!c&&!scClassCancelled(c)&&!scClassEnded(c)}
function scActualTeacher(c){return (c.sessions||[]).find(s=>s.sessionId===workflowSessionKey(c)&&s.substitute)?.substitute||c.teacher||'待安排老师'}
function scEventStatus(c){
 if(scClassCancelled(c))return {label:c.status==='已取消'?'已取消':'已停用',kind:'cancelled'};
 if(scClassEnded(c))return {label:'已结课',kind:'done'};
 const key=workflowSessionKey(c),index=typeof academicClassIndex==='function'?academicClassIndex(c):a.classes.indexOf(c),record=(c.sessions||[]).find(s=>s.sessionId===key&&s.record),roster=workflowSessionRoster(c);
 if(record)return {label:'已录授课记录',kind:'done'};
 const att=a.attendance.filter(x=>x.status!=='已撤销'&&(x.sessionId?x.sessionId===key:x.classIndex===index&&x.date===c.date&&(!x.time||x.time===c.time)));
 const done=roster.filter(student=>att.some(x=>(x.studentId?x.studentId===student.id:a.students[x.studentIndex]?.id===student.id)&&['已考勤','已消课'].includes(x.status))).length;
 if(roster.length&&done===roster.length)return {label:'考勤已完成',kind:'done'};
 if(done)return {label:`已点名 ${done}/${roster.length}`,kind:'planned'};
 return {label:'待上课 / 待确认',kind:'planned'};
}
function scCourseLesson(c){const course=a.courses.find(x=>c.courseId?x.id===c.courseId:x.name===c.course),lesson=(course?.lessons||[]).find(x=>x.id===c.lessonId);return {course,lesson}}
function scBuildEntries(classes,view){const entries=[];classes.forEach(({c,index,sessionId})=>{const actual=scActualTeacher(c),roster=workflowSessionRoster(c),status=scEventStatus(c),{course,lesson}=scCourseLesson(c),time=scTimeParts(c),base={c,index,scheduleId:c.scheduleId||sessionId||'',actual,roster,status,course,lesson,...time};if(view==='teacher')entries.push({...base,person:actual,detail:actual!==c.teacher?'代课':'主讲'});else roster.forEach(student=>entries.push({...base,person:student.name,student,detail:'学生课表'}))});return entries.sort((x,y)=>x.start-y.start||String(x.c.name||'').localeCompare(String(y.c.name||''),'zh-CN'))}
function scEntryConflict(x,y){return scScheduledClassActive(x.c)&&scScheduledClassActive(y.c)&&scOverlap(x,y)}
function scOpenSessionCall(index,studentIndex,scheduleId){return `workflowOpenSession(${index},${studentIndex===null?'null':studentIndex},${esc(JSON.stringify(scheduleId||''))})`}
function scOverlap(x,y){return x.start&&y.start&&x.start<y.end&&y.start<x.end}
function scGapLabel(previous,next){if(!previous.end||!next.start)return '间隔';const ms=next.start-previous.end;if(ms<0)return '时间重叠';const days=Math.floor(ms/86400000);if(days>0)return `空 ${days} 天`;const hours=Math.floor(ms/3600000),minutes=Math.floor(ms%3600000/60000);return hours?`空 ${hours} 小时`:`空 ${Math.max(1,minutes)} 分钟`}
function scSwitchView(view){workflowState.scheduleView=view;['teacher','student','room'].forEach(k=>workflowState[k]='');render()}
function scAxis(entries){const hours=entries.filter(e=>e.start&&e.end>e.start).map(e=>{const day=Date.parse(`${e.c.date}T00:00:00`);return [(e.start-day)/3600000,(e.end-day)/3600000]});return {from:Math.floor(Math.min(7,...hours.map(x=>x[0]))),to:Math.ceil(Math.max(21,...hours.map(x=>x[1])))}}
function scWormLane(name,entries,view,axis=scAxis(entries)){
 const days=new Map();entries.forEach(e=>{if(!days.has(e.c.date))days.set(e.c.date,[]);days.get(e.c.date).push(e)});
 return [...days].map(([date,events])=>{
  const valid=events.filter(e=>e.start&&e.end>e.start),invalid=events.filter(e=>!e.start||e.end<=e.start),laneEnds=[];
  const segments=valid.map(e=>{let lane=laneEnds.findIndex(end=>end<=e.start);if(lane<0)lane=laneEnds.length;laneEnds[lane]=e.end;return {...e,lane,conflict:valid.some(other=>other!==e&&scEntryConflict(e,other))}});
  const midnight=Date.parse(`${date}T00:00:00`),height=Math.max(96,laneEnds.length*96);
  return `<section class="caterpillar-lane"><div class="caterpillar-label"><strong>${esc(name)}</strong><span>${esc(scDateLabel(date))}</span><span>${events.length} 节课</span></div><div class="caterpillar-track" style="height:${height}px;--tick:${100/(axis.to-axis.from)}%">${segments.map(e=>{const left=((e.start-midnight)/3600000-axis.from)/(axis.to-axis.from)*100,width=(e.end-e.start)/3600000/(axis.to-axis.from)*100;return `<button class="worm-segment ${e.status.kind==='done'?'is-done':e.status.kind==='cancelled'?'is-cancelled':'is-planned'} ${e.conflict?'is-conflict':''}" style="left:${left}%;width:${width}%;top:${e.lane*96}px" onclick="${scOpenSessionCall(e.index,e.student?a.students.indexOf(e.student):null,e.scheduleId)}" title="${esc([e.c.time,e.c.name,e.lesson?.title,e.actual,e.c.room,e.conflict?'时间冲突':e.status.label].filter(Boolean).join(' · '))}"><b>${esc(e.c.time)}</b><strong>${esc(e.c.course)}${e.lesson?'':' · 章节待配置'}</strong><span>${esc(e.actual)} · ${esc(e.c.room||'待定')}</span><small>${esc(e.conflict?'时间冲突':e.status.label)}</small></button>`}).join('')}${!valid.length?'<span class="timeline-no-time">时间格式待完善</span>':''}</div></section>${invalid.length?`<p class="help">${esc(name)} 有 ${invalid.length} 节课时间不完整，请到班级管理补齐。</p>`:''}`
 }).join('')
}
function scTimelineHeader(axis){return `<div class="timeline-header"><div>人员 / 日期</div><div class="timeline-hours">${Array.from({length:axis.to-axis.from+1},(_,i)=>`<span style="left:${i/(axis.to-axis.from)*100}%">${String(axis.from+i).padStart(2,'0')}:00</span>`).join('')}</div></div>`}
function scSchedulePage(){
 const v=workflowState.scheduleView||'teacher',selectedStudent=workflowState.student||'',statusFilter=workflowState.scheduleStatus||'active';
 const scheduled=typeof academicScheduledClasses==='function'?academicScheduledClasses():a.classes.map((c,index)=>({c,index}));
 const classes=scheduled.filter(({c})=>(statusFilter==='all'||statusFilter==='ended'&&scClassEnded(c)&&!scClassCancelled(c)||statusFilter==='cancelled'&&scClassCancelled(c)||statusFilter==='active'&&scScheduledClassActive(c))&&(!workflowState.from||c.date>=workflowState.from)&&(!workflowState.to||c.date<=workflowState.to)&&(!workflowState.campus||c.campus===workflowState.campus)&&(!workflowState.course||c.course===workflowState.course));
 const select=(key,label,values)=>`<select class="select" aria-label="${label}" onchange="workflowState.${key}=this.value;academicRender()"><option value="">全部${label}</option>${[...new Set(values.filter(Boolean))].map(x=>`<option value="${esc(x)}" ${workflowState[key]===x?'selected':''}>${esc(x)}</option>`).join('')}</select>`;
 const mode=`<div class="schedule-view-tabs" role="tablist" aria-label="课表视角">${[['teacher','老师'],['student','学生'],['room','教室'],['campus','校区']].map(([key,label])=>`<button role="tab" aria-selected="${v===key}" class="btn ${v===key?'primary':''}" onclick="scSwitchView('${key}')">${label}</button>`).join('')}</div>`;
 const allClasses=scheduled.map(x=>x.c),teacherValues=allClasses.map(scActualTeacher),roomValues=allClasses.map(c=>c.room);
 const statuses=`<select class="select" aria-label="课次状态" onchange="workflowState.scheduleStatus=this.value;academicRender()">${[['active','进行中的班级'],['ended','已结课'],['cancelled','已取消 / 停用'],['all','全部状态']].map(([key,label])=>`<option value="${key}" ${statusFilter===key?'selected':''}>${label}</option>`).join('')}</select>`;
 const filters=`${mode}<div class="filters schedule-filters">${select('campus','校区',allClasses.map(x=>x.campus))}${select('course','课程',allClasses.map(x=>x.course))}${v==='teacher'?select('teacher','老师',teacherValues):''}${v==='room'?select('room','教室',roomValues):''}${v==='student'?`<select class="select" aria-label="学生" onchange="workflowState.student=this.value;academicRender()"><option value="">全部学生</option>${a.students.map(s=>`<option value="${esc(s.id)}" ${selectedStudent===s.id?'selected':''}>${esc(s.name)}</option>`).join('')}</select>`:''}${statuses}<input class="input" type="date" aria-label="开始日期" value="${esc(workflowState.from||'')}" onchange="workflowState.from=this.value;academicRender()"><input class="input" type="date" aria-label="结束日期" value="${esc(workflowState.to||'')}" onchange="workflowState.to=this.value;academicRender()"><button class="btn" onclick="['from','to','campus','teacher','course','student','room'].forEach(k=>workflowState[k]='');workflowState.scheduleStatus='active';academicRender()">清除筛选</button></div>`;
 if(workflowState.from&&workflowState.to&&workflowState.from>workflowState.to)return `<div class="card pad schedule-panel" id="schedule-workflow-controls">${filters}<p class="notice">开始日期不能晚于结束日期，请调整日期范围。</p></div>`;
 if(v==='teacher'||v==='student'){
  let entries=scBuildEntries(classes,v);
  if(v==='teacher'&&workflowState.teacher)entries=entries.filter(e=>e.person===workflowState.teacher);
  if(v==='student'&&selectedStudent)entries=entries.filter(e=>e.student?.id===selectedStudent);
  const groups=new Map();entries.forEach(e=>{const key=e.student?.id||e.person;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(e)});
  const conflictCount=[...groups.values()].reduce((n,list)=>n+list.reduce((count,e,i)=>count+list.slice(i+1).filter(x=>scEntryConflict(e,x)).length,0),0),invalidCount=new Set(entries.filter(e=>!e.start||e.end<=e.start).map(e=>e.scheduleId||e.c.id)).size;
  const axis=scAxis(entries),summary=[conflictCount?`检测到 ${conflictCount} 处时间冲突`:'',invalidCount?`${invalidCount} 节时间待完善，暂不能完整判断冲突`:''].filter(Boolean).join('；')||'当前无时间冲突';
  const body=groups.size?[...groups.values()].map(list=>scWormLane(list[0].person,list,v,axis)).join(''):'<div class="caterpillar-empty"><strong>当前筛选下没有已排课次</strong></div>';
  return `<div class="card pad schedule-panel" id="schedule-workflow-controls">${filters}<div class="caterpillar-legend"><span class="badge ${conflictCount||invalidCount?'off':''}">${esc(summary)}</span><span><i class="done"></i>已记录课次</span><span><i></i>待上课 / 待确认</span><span><i class="conflict"></i>时间冲突</span></div><div class="timeline-scroll"><div class="caterpillar-board">${scTimelineHeader(axis)}${body}</div></div></div>`;
 }
 const viewClasses=classes.filter(({c})=>v!=='room'||!workflowState.room||c.room===workflowState.room).sort((x,y)=>scTimeParts(x.c).start-scTimeParts(y.c).start);
 const rows=viewClasses.map(({c,index,sessionId})=>{
  const actual=scActualTeacher(c),roster=workflowSessionRoster(c),{course,lesson}=scCourseLesson(c),status=scEventStatus(c),time=scTimeParts(c),invalid=!time.start||time.end<=time.start,conflict=scScheduledClassActive(c)&&scheduled.some(({c:other})=>other!==c&&scScheduledClassActive(other)&&scOverlap(time,scTimeParts(other))&&(scActualTeacher(other)===actual||other.campus===c.campus&&other.room===c.room));
  const label=invalid?'日期 / 时间待完善':conflict?'老师或教室时间冲突':status.label;
  return `<tr><td>${esc(c.date)}<div class="muted">${esc(c.time)}</div></td><td>${esc(c.campus)}</td><td>${esc(c.name)}</td><td>${esc(course?.name||c.course)}<div class="muted">${esc(lesson?.title||'授课章节待配置')}</div></td><td>${esc(actual)}${actual!==c.teacher?'（代课）':''}</td><td>${esc(c.room||'—')}</td><td>${roster.length}</td><td><span class="badge ${invalid||conflict||status.kind!=='done'?'off':''}">${esc(label)}</span></td><td><button class="btn small" onclick="${scOpenSessionCall(index,null,c.scheduleId||sessionId)}">课次操作</button></td></tr>`;
 });
 return `<div class="card pad schedule-panel" id="schedule-workflow-controls">${filters}<div class="data-bar">${viewClasses.length} 条已录入排课</div>${aTable(['日期','校区','班级','课程 / 讲次','实际授课老师','教室','本节人数','状态','操作'],rows)}</div>`;
}

schedulePage=scSchedulePage;

// The previous annotator inserted a second, non-rendering schedule selector.
workflowAnnotateDemo=function(){};
workflowState.scheduleView='teacher';
if(state.page==='schedule')render();
