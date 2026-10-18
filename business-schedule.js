/* Server projection adapter for the mature scSchedulePage / scWormLane templates.
 * Only presentation state lives here; session writes remain in businessAPI. */
(function(root){
 'use strict';
 const modes=['time','teacher','room'],statuses=['active','ended','cancelled','all'];
 const today=()=>new Date(Date.now()+28800000).toISOString().slice(0,10);
 const isoDate=d=>{const offset=d.getTimezoneOffset()*60000;return new Date(d.getTime()-offset).toISOString().slice(0,10)};
 function weekRange(date){const d=new Date(`${date||today()}T12:00:00`),day=(d.getDay()+6)%7;d.setDate(d.getDate()-day);const from=isoDate(d);d.setDate(d.getDate()+6);return {from,to:isoDate(d)}}
 const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
 const modeLabel=value=>({onsite:'面授课',live:'直播课',online:'在线课',group:'面授班课',oneOnOne:'面授1对1',oneOnMany:'面授1对N'}[value]||value);
 const roleLabel=value=>({teacher:'老师',academic:'教务',sales:'销售',finance:'财务',principal:'校长',operations:'运营',auditor:'只读审计员',campusAdmin:'校区管理员',superadmin:'超级管理员'}[value]||value);
 const defaults=()=>({mode:'time',campus:'',course:'',teacher:'',student:'',room:'',role:'',teachingMode:'',status:'active',from:today(),to:today()});
 let view=defaults(),lastPage=null,lastContext=null;
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const rows=(ctx,key)=>Array.isArray(ctx.data?.[key])?ctx.data[key]:[];
 const same=(a,b)=>!!a&&!!b&&String(a)===String(b);
 const identity=(c,s)=>JSON.stringify([c.id,s.id]);
 const eventCall=e=>`businessAPI.selectSession(${esc(JSON.stringify(e.c.id))},${esc(JSON.stringify(e.s.id))})`;
 const isCancelled=value=>['cancelled','canceled','inactive','disabled','已取消','已停用','已禁用'].includes(value);
 const isEnded=value=>['completed','ended','closed','已结课','已结束','已关闭'].includes(value);
 function timeParts(date,time){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date)))return null;
  const midnight=Date.parse(date+'T00:00:00+08:00');
  if(!Number.isFinite(midnight)||new Date(midnight+28800000).toISOString().slice(0,10)!==date)return null;
  const m=String(time||'').match(/^\s*(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})\s*$/);
  if(!m)return null;
  const [sh,sm,eh,em]=m.slice(1).map(Number),from=sh*60+sm,to=eh*60+em;
  if(sh>23||sm>59||eh>24||em>59||(eh===24&&em!==0)||to<=from)return null;
  return {from,to,start:midnight+from*60000,end:midnight+to*60000};
 }
 function dateLabel(date){const time=Date.parse(date+'T00:00:00+08:00');return Number.isFinite(time)?date+' 周'+'日一二三四五六'[new Date(time+28800000).getUTCDay()]:String(date||'日期待完善')}
 function entries(ctx){
  const directory=rows(ctx,'directory'),students=new Map(rows(ctx,'students').map(s=>[s.id,s])),attendance=rows(ctx,'attendance');
  return rows(ctx,'classes').flatMap(c=>(Array.isArray(c.schedule)?c.schedule:[]).filter(s=>c.id&&s.id).map(s=>{
   const course=rows(ctx,'courses').find(x=>x.id===c.courseId),lesson=course?.lessons?.find(x=>x.id===s.lessonId),teacherId=s.substituteTeacherId||s.teacherId||c.teacherId||'',campusId=s.campusId||c.campusId||'',room=s.room??c.room??'';
   const teacherRecord=directory.find(t=>t.id===teacherId),teacher=teacherRecord?.name||s.teacher||c.teacher||'老师资料暂不可见',campus=rows(ctx,'campuses').find(x=>x.id===campusId)?.name||s.campus||c.campus||'校区资料暂不可见';
   const roleNames=Array.isArray(teacherRecord?.roleIds)?teacherRecord.roleIds:Array.isArray(teacherRecord?.roleNames)?teacherRecord.roleNames:Array.isArray(teacherRecord?.roles)?teacherRecord.roles:[];
   const roles=roleNames.map(r=>typeof r==='string'?r:r.id||r.name).filter(Boolean),role=roles.map(roleLabel).join('、')||teacherRecord?.roleName||teacherRecord?.role||'';
   const teachingMode=s.teachingMode||c.teachingMode||course?.teachingMode||course?.courseType||course?.type||'',courseType=s.courseType||c.courseType||course?.courseType||'';
   // The service projects the effective roster for this exact session, including transfers.
   const studentIds=Array.isArray(s.studentIds)?[...new Set(s.studentIds)]:[],roster=studentIds.map(id=>students.get(id)).filter(Boolean),cancelled=c.active===false||isCancelled(c.status)||isCancelled(s.status),ended=isEnded(c.status)||isEnded(s.status);
   const recorded=new Set(attendance.filter(a=>a.classId===c.id&&a.sessionId===s.id&&!['reversed','cancelled','已撤销'].includes(a.status)&&(a.attendanceStatus||['已考勤','已消课','已请假','缺勤'].includes(a.status))).map(a=>a.studentId));
   const count=studentIds.filter(id=>recorded.has(id)).length;
   const status=cancelled?{kind:'cancelled',label:'已取消 / 停用'}:ended?{kind:'done',label:'已结课'}:s.record?{kind:'done',label:'已录授课记录'}:studentIds.length&&count===studentIds.length?{kind:'done',label:'考勤已完成'}:count?{kind:'planned',label:`已点名 ${count}/${studentIds.length}`}:{kind:'planned',label:'待上课 / 待确认'};
   return {c,s,key:identity(c,s),course,lesson,teacherId,teacher,role,roles,campusId,campus,room,roomKey:JSON.stringify([campusId,room]),studentIds,roster,cancelled,ended,status,time:timeParts(s.date,s.time),substitute:!!teacherId&&!!c.teacherId&&teacherId!==c.teacherId,teachingMode,courseType,grade:c.grade||course?.grade||'',subject:c.subject||course?.subject||''};
  })).sort((a,b)=>String(a.s.date+' '+a.s.time).localeCompare(String(b.s.date+' '+b.s.time))||a.key.localeCompare(b.key));
 }
 function conflict(a,b){
  if(a.key===b.key||a.cancelled||b.cancelled||a.ended||b.ended||!a.time||!b.time||a.time.start>=b.time.end||b.time.start>=a.time.end)return false;
  return same(a.teacherId,b.teacherId)||(same(a.campusId,b.campusId)&&!!a.room&&a.room===b.room)||a.studentIds.some(id=>b.studentIds.includes(id));
 }
 function matches(e,dates=true){return (view.status==='all'||view.status==='cancelled'&&e.cancelled||view.status==='ended'&&e.ended&&!e.cancelled||view.status==='active'&&!e.cancelled&&!e.ended)&&(!dates||!view.from||e.s.date>=view.from)&&(!dates||!view.to||e.s.date<=view.to)&&(!view.campus||e.campusId===view.campus)&&(!view.course||e.c.courseId===view.course)&&(!view.teacher||e.teacherId===view.teacher)&&(!view.student||e.studentIds.includes(view.student))&&(!view.role||e.roles.includes(view.role))&&(!view.teachingMode||e.teachingMode===view.teachingMode)&&(!view.room||e.roomKey===view.room)}
 function filtered(all){return all.filter(e=>matches(e))}
 function select(key,label,options){
  const seen=new Set(),unique=options.filter(([id])=>id&&!seen.has(id)&&seen.add(id));
  return `<select class="select" aria-label="${label}" onchange="SiyueBusinessSchedule.filter('${key}',this.value)"><option value="">全部${label}</option>${unique.map(([id,name])=>`<option value="${esc(id)}" ${view[key]===id?'selected':''}>${esc(name)}</option>`).join('')}</select>`;
 }
 function statusControl(){return `<select class="select" aria-label="状态" onchange="SiyueBusinessSchedule.filter('status',this.value)">${[['active','未开课 / 开课中'],['ended','已结束'],['cancelled','已取消'],['all','全部状态']].map(([id,label])=>`<option value="${id}" ${view.status===id?'selected':''}>${label}</option>`).join('')}</select>`}
 function weekControls(){const range=weekRange(view.from);return `<div class="schedule-week-nav" aria-label="周次选择"><button type="button" class="btn small" aria-label="上一周" onclick="SiyueBusinessSchedule.filter('week','prev')">上一周</button><strong>${esc(range.from)} — ${esc(range.to)}</strong><button type="button" class="btn small" aria-label="下一周" onclick="SiyueBusinessSchedule.filter('week','next')">下一周</button><button type="button" class="btn small" onclick="SiyueBusinessSchedule.filter('week','today')">本周</button><label>选择周日期 <input class="input" type="date" aria-label="选择周日期" value="${esc(view.from)}" onchange="SiyueBusinessSchedule.filter('weekDate',this.value)"></label></div>`}
 function controls(all,personal){
  const mode=personal?'<div class="schedule-view-tabs" role="tablist" aria-label="我的课表视角"><button type="button" role="tab" aria-selected="true" class="btn primary">时间课表</button></div>':`<div class="schedule-view-tabs" role="tablist" aria-label="课表视角">${[['time','时间课表'],['teacher','老师课表'],['room','教室课表']].map(([key,label])=>`<button type="button" role="tab" aria-selected="${view.mode===key}" class="btn ${view.mode===key?'primary':''}" onclick="SiyueBusinessSchedule.filter('mode','${key}')">${label}</button>`).join('')}</div>`;
  const choices=all;
  const filters=select('campus','校区',all.map(e=>[e.campusId,e.campus]))+select('course','课程',choices.map(e=>[e.c.courseId,e.course?.name||e.c.course||e.c.courseId]))+(personal?'':select('teacher','老师',choices.map(e=>[e.teacherId,e.teacher])))+select('room','教室',choices.filter(e=>e.room).map(e=>[e.roomKey,e.campus+' · '+e.room]))+select('teachingMode','授课方式',choices.filter(e=>e.teachingMode).map(e=>[e.teachingMode,modeLabel(e.teachingMode)]))+(view.mode==='teacher'?select('role','角色',choices.flatMap(e=>e.roles.map(r=>[r,roleLabel(r)]))):'')+statusControl();
  const dates=view.mode==='time'?`<input class="input" type="date" aria-label="开始时间" value="${esc(view.from)}" onchange="SiyueBusinessSchedule.filter('from',this.value)"><span class="schedule-date-separator">至</span><input class="input" type="date" aria-label="结束时间" value="${esc(view.to)}" onchange="SiyueBusinessSchedule.filter('to',this.value)">`:'';
  return `${mode}${view.mode==='time'?'':weekControls()}<div class="filters schedule-filters">${filters}${dates}<button type="button" class="btn small" onclick="SiyueBusinessSchedule.filter('clear','')">重置筛选</button><button type="button" class="btn small" onclick="SiyueBusinessSchedule.filter('export','')">导出课表</button></div>`;
 }
 function weekDays(){const range=weekRange(view.from);return Array.from({length:7},(_,i)=>{const d=new Date(`${range.from}T12:00:00`);d.setDate(d.getDate()+i);const date=isoDate(d);return {date,label:dateLabel(date)}})}
 function timeTable(list,selected){return `<div class="data-bar">${list.length} 条已录入排课</div><div class="table-wrap"><table class="table schedule-time-table"><thead><tr>${['开课日期','开课时间','班级 / 课程 / 讲次','学科','年级','授课方式','老师','辅导老师','校区','教室','状态','操作'].map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${list.map(e=>{const active=selected?.classId===e.c.id&&selected?.sessionId===e.s.id;const tutor=e.s.tutorName||e.c.tutorName||e.s.assistantTeacherName||e.c.assistantTeacherName||'';return `<tr class="${active?'is-selected':''}" data-class-id="${esc(e.c.id)}" data-session-id="${esc(e.s.id)}"><td>${esc(e.s.date||'—')}</td><td>${esc(e.s.time||'—')}</td><td><strong>${esc(e.c.name||'—')}</strong><div class="muted">${esc(e.course?.name||e.c.course||'课程资料暂不可见')} · ${esc(e.lesson?.title||'讲次资料暂不可见')}</div></td><td>${esc(e.subject||'—')}</td><td>${esc(e.grade||'—')}</td><td>${esc(modeLabel(e.teachingMode)||'—')}</td><td>${esc(e.teacher)}${e.substitute?'（代课）':''}</td><td>${esc(tutor||'—')}</td><td>${esc(e.campus)}</td><td>${esc(e.room||'—')}</td><td>${esc(e.conflicts.length?'时间冲突':e.status.label)}</td><td><button type="button" class="btn small" onclick="${eventCall(e)}">课次操作</button></td></tr>`}).join('')||'<tr><td colspan="12" class="empty">当前筛选下没有已排课次</td></tr>'}</tbody></table></div>`}
 function weeklyGrid(list,all,selected){
  const days=weekDays(),entities=new Map();
  for(const e of all.filter(e=>matches(e,false))){const key=view.mode==='teacher'?e.teacherId:e.roomKey,name=view.mode==='teacher'?e.teacher:`${e.campus} · ${e.room||'教室待定'}`;if(!key)continue;if(!entities.has(key))entities.set(key,{name,days:new Map()});}
  for(const e of list){const key=view.mode==='teacher'?e.teacherId:e.roomKey;if(!key)continue;const entity=entities.get(key);if(!entity)continue;const date=e.s.date;if(!entity.days.has(date))entity.days.set(date,[]);entity.days.get(date).push(e)}
  const columns=days.map(d=>`<th>${esc(d.label)}</th>`).join('');
  const body=[...entities].map(([key,entity])=>`<tr><th scope="row" class="schedule-entity">${esc(entity.name)}</th>${days.map(day=>{const events=entity.days.get(day.date)||[];if(!events.length)return '<td><span class="schedule-free">空闲</span></td>';return `<td><div class="schedule-day-events">${events.map(e=>{const active=selected?.classId===e.c.id&&selected?.sessionId===e.s.id;return `<button type="button" class="schedule-event ${e.conflicts.length?'is-conflict':''} ${e.status.kind==='done'?'is-done':''} ${e.status.kind==='cancelled'?'is-cancelled':''} ${active?'is-selected':''}" aria-pressed="${active}" onclick="${eventCall(e)}"><strong>${esc(e.s.time||'时间待完善')}</strong><span>${esc(e.c.name||e.course?.name||'班级资料暂不可见')}</span><small>${esc(view.mode==='teacher'?`${e.room||'教室待定'} · ${e.campus}`:e.teacher)}${e.status.kind==='cancelled'?' · 已取消':''}</small>${e.conflicts.length?'<em>冲突</em>':''}</button>`}).join('')}</div></td>`}).join('')}</tr>`).join('');
  return `<div class="schedule-legend"><span><i class="is-conflict"></i>冲突</span><span><i class="is-occupied"></i>已占用</span><span><i class="is-free"></i>空闲</span></div><div class="table-wrap schedule-week-wrap"><table class="table schedule-week-table"><thead><tr><th>${view.mode==='teacher'?'老师':'校区 / 教室'}</th>${columns}</tr></thead><tbody>${body||`<tr><td colspan="8" class="empty">当前周没有可显示的${view.mode==='teacher'?'老师':'教室'}课次</td></tr>`}</tbody></table></div>`
 }
 function csvExport(list){const columns=['开课日期','开课时间','班级','课程','讲次','学科','年级','授课方式','老师','校区','教室','状态'];const values=list.map(e=>[e.s.date,e.s.time,e.c.name,e.course?.name||e.c.course,e.lesson?.title,e.subject,e.grade,modeLabel(e.teachingMode),e.teacher,e.campus,e.room,e.conflicts.length?'冲突':e.status.label]);const csv='\ufeff'+[columns,...values].map(row=>row.map(value=>{const text=String(value??''),safe=/^[=+@\-\t\r]/.test(text)?"'"+text:text;return '"'+safe.replace(/"/g,'""')+'"'}).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=`${view.mode==='teacher'?'老师':view.mode==='room'?'教室':'时间'}课表-${view.from||today()}.csv`;document.body.append(link);link.click();link.remove();URL.revokeObjectURL(url)}
 function render(ctx){
  if(!['schedule','teacherCourses'].includes(ctx?.page))return null;
  const personal=ctx.page==='teacherCourses';if(lastPage&&personal!==(lastPage==='teacherCourses'))view=defaults();if(personal)view.mode='time';lastPage=ctx.page;lastContext=ctx;
  if(!ctx.user?.permissions?.includes('schedule.read'))return '<section class="card pad"><p class="notice">当前账号没有查看课表权限。</p></section>';
  const all=entries(ctx).filter(e=>!personal||e.teacherId===ctx.user.id),list=filtered(all).map(e=>({...e,conflicts:all.filter(other=>conflict(e,other))})),start=`<section class="card pad schedule-panel business-schedule" id="schedule-workflow-controls">${controls(all,personal)}`;
  if(view.from&&view.to&&view.from>view.to)return start+'<p class="notice">开始日期不能晚于结束日期，请调整日期范围。</p></section>';
  let content;
  if(view.mode==='time')content=timeTable(list,ctx.selectedSession);else content=weeklyGrid(list,all,ctx.selectedSession);
  const requestLink=personal&&ctx.user.permissions.includes('session.reschedule.request')?'<div class="toolbar"><button class="btn" onclick="nav(\'rescheduleRequests\')">我的调课申请</button></div>':'';
  const selected=list.find(e=>e.c.id===ctx.selectedSession?.classId&&e.s.id===ctx.selectedSession?.sessionId),actions=selected&&typeof ctx.sessionActions==='function'?ctx.sessionActions({classId:selected.c.id,sessionId:selected.s.id}):'';
  const scheduleOperation=(ctx.operations||[]).find(op=>op.id==='class.schedule'),create=ctx.page==='schedule'&&scheduleOperation&&(typeof ctx.permitted==='function'?ctx.permitted(scheduleOperation):ctx.user.permissions.includes('class.create'))?'<div class="toolbar"><button type="button" class="btn primary" onclick="businessAPI.open(\'class.schedule\')">班级排课</button></div>':'';
  return start+create+requestLink+content+(selected?`<section class="business-session-actions" aria-label="课次操作"><strong>${esc(selected.c.name)} · ${esc(selected.s.date)} ${esc(selected.s.time)}</strong><div class="actions">${actions||'<span class="muted">当前课次没有可办理的操作</span>'}</div></section>`:'')+'</section>';
 }
 function busy(){const state=root.businessAPI?.status?.();return !!(state?.busy||state?.uncertain)}
 function filter(key,value){
  if(busy())return false;
  if(key==='export'){const ctx={...(lastContext||{}),data:root.businessAPI?.snapshot?.()||lastContext?.data||{}},all=entries(ctx).filter(e=>lastPage!=='teacherCourses'||e.teacherId===ctx.user?.id),list=filtered(all).map(e=>({...e,conflicts:all.filter(other=>conflict(e,other))}));csvExport(list);return true}
  if(key==='week'){const range=weekRange(view.from),d=new Date(`${range.from}T12:00:00`);if(value==='prev')d.setDate(d.getDate()-7);else if(value==='next')d.setDate(d.getDate()+7);else if(value==='today'){view.from=today();view.to=today();Object.assign(view,weekRange(today()));root.businessAPI?.redraw?.();return true}else return false;Object.assign(view,weekRange(isoDate(d)));root.businessAPI?.redraw?.();return true}
  if(key==='weekDate'){if(!validDate(value))return false;Object.assign(view,weekRange(value));root.businessAPI?.redraw?.();return true}
  if(key==='clear'){const mode=view.mode;view={...defaults(),mode};if(mode!=='time')Object.assign(view,weekRange(today()))}
  else if(!Object.hasOwn(view,key)||typeof value!=='string'||value.length>200||(key==='mode'&&!modes.includes(value))||(key==='status'&&!statuses.includes(value))||(['from','to'].includes(key)&&value&&!validDate(value)))return false;
  else {if(key==='mode'&&lastPage==='teacherCourses'&&value!=='time')return false;view[key]=value;if(key==='mode'){if(value!=='teacher')view.role='';if(value!=='time')Object.assign(view,weekRange(view.from||today()))}}
  root.businessAPI?.redraw?.();return true;
 }
 function reset(){view=defaults();lastPage=null;lastContext=null}
 function snapshot(){return {...view}}
 function restore(saved){view=defaults();if(!saved||typeof saved!=='object')return;for(const key of Object.keys(view)){const value=saved[key];if(typeof value!=='string'||value.length>200||(key==='mode'&&!modes.includes(value))||(key==='status'&&!statuses.includes(value))||(['from','to'].includes(key)&&value&&!validDate(value)))continue;view[key]=value}if(view.mode!=='time')Object.assign(view,weekRange(view.from||today()))}
 root.SiyueBusinessSchedule={render,reset,filter,snapshot,restore};
})(typeof window==='undefined'?globalThis:window);
