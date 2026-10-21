/* Server projection adapter for the mature scSchedulePage / scWormLane templates.
 * Only presentation state lives here; session writes remain in businessAPI. */
(function(root){
 'use strict';
 const modes=['teacher','student','room','campus'],statuses=['active','ended','cancelled','all'];
 const defaults=()=>({mode:'teacher',campus:'',course:'',teacher:'',student:'',room:'',status:'active',from:'',to:''});
 let view=defaults();
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
   const teacher=directory.find(t=>t.id===teacherId)?.name||s.teacher||c.teacher||'老师资料暂不可见',campus=rows(ctx,'campuses').find(x=>x.id===campusId)?.name||s.campus||c.campus||'校区资料暂不可见';
   // The service projects the effective roster for this exact session, including transfers.
   const studentIds=Array.isArray(s.studentIds)?[...new Set(s.studentIds)]:[],roster=studentIds.map(id=>students.get(id)).filter(Boolean),cancelled=c.active===false||isCancelled(c.status)||isCancelled(s.status),ended=isEnded(c.status)||isEnded(s.status);
   const recorded=new Set(attendance.filter(a=>a.classId===c.id&&a.sessionId===s.id&&!['reversed','cancelled','已撤销'].includes(a.status)&&(a.attendanceStatus||['已考勤','已消课','已请假','缺勤'].includes(a.status))).map(a=>a.studentId));
   const count=studentIds.filter(id=>recorded.has(id)).length;
   const status=cancelled?{kind:'cancelled',label:'已取消 / 停用'}:ended?{kind:'done',label:'已结课'}:s.record?{kind:'done',label:'已录授课记录'}:studentIds.length&&count===studentIds.length?{kind:'done',label:'考勤已完成'}:count?{kind:'planned',label:`已点名 ${count}/${studentIds.length}`}:{kind:'planned',label:'待上课 / 待确认'};
   return {c,s,key:identity(c,s),course,lesson,teacherId,teacher,campusId,campus,room,roomKey:JSON.stringify([campusId,room]),studentIds,roster,cancelled,ended,status,time:timeParts(s.date,s.time),substitute:!!teacherId&&!!c.teacherId&&teacherId!==c.teacherId};
  })).sort((a,b)=>String(a.s.date+' '+a.s.time).localeCompare(String(b.s.date+' '+b.s.time))||a.key.localeCompare(b.key));
 }
 function conflict(a,b){
  if(a.key===b.key||a.cancelled||b.cancelled||a.ended||b.ended||!a.time||!b.time||a.time.start>=b.time.end||b.time.start>=a.time.end)return false;
  return same(a.teacherId,b.teacherId)||(same(a.campusId,b.campusId)&&!!a.room&&a.room===b.room)||a.studentIds.some(id=>b.studentIds.includes(id));
 }
 function filtered(all){return all.filter(e=>(view.status==='all'||view.status==='cancelled'&&e.cancelled||view.status==='ended'&&e.ended&&!e.cancelled||view.status==='active'&&!e.cancelled&&!e.ended)&&(!view.from||e.s.date>=view.from)&&(!view.to||e.s.date<=view.to)&&(!view.campus||e.campusId===view.campus)&&(!view.course||e.c.courseId===view.course)&&(!(view.mode==='teacher'&&view.teacher)||e.teacherId===view.teacher)&&(!(view.mode==='room'&&view.room)||e.roomKey===view.room)&&(!(view.mode==='student'&&view.student)||e.studentIds.includes(view.student)))}
 function select(key,label,options){
  const seen=new Set(),unique=options.filter(([id])=>id&&!seen.has(id)&&seen.add(id));
  return `<select class="select" aria-label="${label}" onchange="SiyueBusinessSchedule.filter('${key}',this.value)"><option value="">全部${label}</option>${unique.map(([id,name])=>`<option value="${esc(id)}" ${view[key]===id?'selected':''}>${esc(name)}</option>`).join('')}</select>`;
 }
 function controls(all){
  const mode=`<div class="schedule-view-tabs" role="tablist" aria-label="课表视角">${[['teacher','老师'],['student','学生'],['room','教室'],['campus','校区']].map(([key,label])=>`<button type="button" role="tab" aria-selected="${view.mode===key}" class="btn ${view.mode===key?'primary':''}" onclick="SiyueBusinessSchedule.filter('mode','${key}')">${label}</button>`).join('')}</div>`;
  const people=view.mode==='teacher'?select('teacher','老师',all.map(e=>[e.teacherId,e.teacher])):view.mode==='student'?select('student','学生',all.flatMap(e=>e.roster.map(s=>[s.id,s.name]))):view.mode==='room'?select('room','教室',all.filter(e=>e.room).map(e=>[e.roomKey,e.campus+' · '+e.room])):'';
  return `${mode}<div class="filters schedule-filters">${select('campus','校区',all.map(e=>[e.campusId,e.campus]))}${select('course','课程',all.map(e=>[e.c.courseId,e.course?.name||e.c.course||'课程资料暂不可见']))}${people}<select class="select" aria-label="课次状态" onchange="SiyueBusinessSchedule.filter('status',this.value)">${[['active','进行中的班级'],['ended','已结课'],['cancelled','已取消 / 停用'],['all','全部状态']].map(([key,label])=>`<option value="${key}" ${view.status===key?'selected':''}>${label}</option>`).join('')}</select><input class="input" type="date" aria-label="开始日期" value="${esc(view.from)}" onchange="SiyueBusinessSchedule.filter('from',this.value)"><input class="input" type="date" aria-label="结束日期" value="${esc(view.to)}" onchange="SiyueBusinessSchedule.filter('to',this.value)"><button type="button" class="btn" onclick="SiyueBusinessSchedule.filter('clear','')">清除筛选</button></div>`;
 }
 function axisFor(list){const valid=list.filter(e=>e.time);return {from:Math.floor(Math.min(7,...valid.map(e=>e.time.from/60))),to:Math.ceil(Math.max(21,...valid.map(e=>e.time.to/60)))}}
 function timelineHeader(axis){return `<div class="timeline-header"><div>人员 / 日期</div><div class="timeline-hours">${Array.from({length:axis.to-axis.from+1},(_,i)=>`<span style="left:${i/(axis.to-axis.from)*100}%">${String(axis.from+i).padStart(2,'0')}:00</span>`).join('')}</div></div>`}
 function wormLane(name,list,axis,selected){
  const days=new Map();for(const e of list){if(!days.has(e.s.date))days.set(e.s.date,[]);days.get(e.s.date).push(e)}
  return [...days].map(([date,events])=>{
   const valid=events.filter(e=>e.time),invalid=events.filter(e=>!e.time),ends=[];
   const segments=valid.map(e=>{let lane=ends.findIndex(end=>end<=e.time.start);if(lane<0)lane=ends.length;ends[lane]=e.time.end;return {e,lane}});
   return `<section class="caterpillar-lane"><div class="caterpillar-label"><strong>${esc(name)}</strong><span>${esc(dateLabel(date))}</span><span>${events.length} 节课</span></div><div class="caterpillar-track" style="height:${Math.max(1,ends.length)*96}px;--tick:${100/(axis.to-axis.from)}%">${segments.map(({e,lane})=>{
    const left=(e.time.from/60-axis.from)/(axis.to-axis.from)*100,width=(e.time.to-e.time.from)/60/(axis.to-axis.from)*100,isSelected=selected?.classId===e.c.id&&selected?.sessionId===e.s.id;
    return `<button type="button" class="worm-segment is-${e.status.kind} ${e.conflicts.length?'is-conflict':''} ${isSelected?'is-selected':''}" aria-pressed="${isSelected}" data-class-id="${esc(e.c.id)}" data-session-id="${esc(e.s.id)}" style="left:${left}%;width:${width}%;top:${lane*96}px" onclick="${eventCall(e)}" title="${esc([e.s.time,e.c.name,e.lesson?.title,e.teacher,e.room,e.conflicts.length?'时间冲突':e.status.label].filter(Boolean).join(' · '))}"><b>${esc(e.s.time)}</b><strong>${esc(e.course?.name||e.c.course||e.c.name)}</strong><span>${esc(e.lesson?.title||'讲次资料暂不可见')}</span><small>${esc(e.teacher)} · ${esc(e.room||'教室待定')} · ${esc(e.conflicts.length?'时间冲突':e.status.label)}</small></button>`;
   }).join('')}${!valid.length?'<span class="timeline-no-time">时间格式待完善</span>':''}</div></section>${invalid.length?`<div class="business-schedule-invalid">${invalid.map(e=>`<button type="button" class="btn small" onclick="${eventCall(e)}">${esc(e.c.name)} · 日期 / 时间待完善</button>`).join('')}</div>`:''}`;
  }).join('');
 }
 function table(list,selected){return `<div class="data-bar">${list.length} 条已录入排课</div><div class="table-wrap"><table class="table"><thead><tr>${['日期','校区','班级','课程 / 讲次','实际授课老师','教室','本节人数','状态','操作'].map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${list.map(e=>{const active=selected?.classId===e.c.id&&selected?.sessionId===e.s.id;return `<tr class="${active?'is-selected':''}" data-class-id="${esc(e.c.id)}" data-session-id="${esc(e.s.id)}"><td>${esc(e.s.date)}<div class="muted">${esc(e.s.time)}</div></td><td>${esc(e.campus)}</td><td>${esc(e.c.name)}</td><td>${esc(e.course?.name||e.c.course||'课程资料暂不可见')}<div class="muted">${esc(e.lesson?.title||'讲次资料暂不可见')}</div></td><td>${esc(e.teacher)}${e.substitute?'（代课）':''}</td><td>${esc(e.room||'—')}</td><td>${e.studentIds.length}</td><td><span class="badge ${!e.time||e.conflicts.length||e.status.kind!=='done'?'off':''}">${esc(!e.time?'日期 / 时间待完善':e.conflicts.length?'资源或学生时间冲突':e.status.label)}</span></td><td><button type="button" class="btn small" onclick="${eventCall(e)}">课次操作</button></td></tr>`}).join('')||'<tr><td colspan="9" class="empty">当前筛选下没有已排课次</td></tr>'}</tbody></table></div>`}
 function render(ctx){
  if(ctx?.page!=='schedule')return null;
  if(!ctx.user?.permissions?.includes('schedule.read'))return '<section class="card pad"><p class="notice">当前账号没有查看课表权限。</p></section>';
  const all=entries(ctx),list=filtered(all).map(e=>({...e,conflicts:all.filter(other=>conflict(e,other))})),start=`<section class="card pad schedule-panel business-schedule" id="schedule-workflow-controls">${controls(all)}`;
  if(view.from&&view.to&&view.from>view.to)return start+'<p class="notice">开始日期不能晚于结束日期，请调整日期范围。</p></section>';
  let content;
  if(view.mode==='teacher'||view.mode==='student'){
   const groups=new Map();for(const e of list){const people=view.mode==='teacher'?[[e.teacherId||e.key,e.teacher]]:e.roster.filter(s=>!view.student||s.id===view.student).map(s=>[s.id,s.name]);for(const [id,name]of people){if(!groups.has(id))groups.set(id,{name,entries:[]});groups.get(id).entries.push(e)}}
   const visible=[...groups.values()].flatMap(g=>g.entries),pairs=new Set(visible.flatMap(e=>e.conflicts.map(o=>[e.key,o.key].sort().join('|')))),invalid=new Set(visible.filter(e=>!e.time).map(e=>e.key)).size,axis=axisFor(visible),summary=[pairs.size?`检测到 ${pairs.size} 处时间冲突`:'',invalid?`${invalid} 节时间待完善，暂不能完整判断冲突`:''].filter(Boolean).join('；')||'当前无时间冲突';
   content=`<div class="caterpillar-legend"><span class="badge ${pairs.size||invalid?'off':''}">${summary}</span><span><i class="done"></i>已记录课次</span><span><i></i>待上课 / 待确认</span><span><i class="conflict"></i>时间冲突</span></div><div class="timeline-scroll"><div class="caterpillar-board">${timelineHeader(axis)}${groups.size?[...groups.values()].map(g=>wormLane(g.name,g.entries,axis,ctx.selectedSession)).join(''):'<div class="caterpillar-empty"><strong>当前筛选下没有已排课次</strong></div>'}</div></div>`;
  }else content=table(list,ctx.selectedSession);
  const selected=list.find(e=>e.c.id===ctx.selectedSession?.classId&&e.s.id===ctx.selectedSession?.sessionId),actions=selected&&typeof ctx.sessionActions==='function'?ctx.sessionActions({classId:selected.c.id,sessionId:selected.s.id}):'';
  return start+content+(selected?`<section class="business-session-actions" aria-label="课次操作"><strong>${esc(selected.c.name)} · ${esc(selected.s.date)} ${esc(selected.s.time)}</strong><div class="actions">${actions||'<span class="muted">当前课次没有可办理的操作</span>'}</div></section>`:'')+'</section>';
 }
 function busy(){const state=root.businessAPI?.status?.();return !!(state?.busy||state?.uncertain)}
 function filter(key,value){
  if(busy())return false;
  if(key==='clear')view={...defaults(),mode:view.mode};
  else if(!Object.hasOwn(view,key)||typeof value!=='string'||value.length>200||(key==='mode'&&!modes.includes(value))||(key==='status'&&!statuses.includes(value))||(['from','to'].includes(key)&&value&&!/^\d{4}-\d{2}-\d{2}$/.test(value)))return false;
  else {view[key]=value;if(key==='mode'){view.teacher='';view.student='';view.room=''}}
  root.businessAPI?.redraw?.();return true;
 }
 function reset(){view=defaults()}
 function snapshot(){return {...view}}
 function restore(saved){view=defaults();if(!saved||typeof saved!=='object')return;for(const key of Object.keys(view)){const value=saved[key];if(typeof value!=='string'||value.length>200||(key==='mode'&&!modes.includes(value))||(key==='status'&&!statuses.includes(value))||(['from','to'].includes(key)&&value&&!/^\d{4}-\d{2}-\d{2}$/.test(value)))continue;view[key]=value}}
 root.SiyueBusinessSchedule={render,reset,filter,snapshot,restore};
})(typeof window==='undefined'?globalThis:window);
