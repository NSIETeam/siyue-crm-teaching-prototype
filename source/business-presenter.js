/* Presentation-only renderers for authenticated business pages. */
(function(root){
 'use strict';
 const view={};
 const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const plural={course:'courses',classes:'classes',students:'students',learningActive:'students',learningHistory:'students',studentDetail:'students',studentArchives:'students',campus:'campuses'};
 const titles={course:'课程管理',classes:'班级管理',students:'学生管理',learningActive:'在读学生',learningHistory:'历史学生',studentDetail:'学生档案',studentArchives:'学生档案',campus:'校区管理'};
 const activeEnrollment=new Set(['active','在读','已生效']);
 const historicEnrollment=new Set(['withdrawn','completed','已退课','已完成']);
 const enrolled=rows=>(rows||[]).filter(row=>activeEnrollment.has(row.status));
 const quote=value=>escapeHtml(JSON.stringify(String(value??'')));
 const human=(ctx,key,value)=>value===null||value===undefined||value===''?'—':ctx.human?.(key,value)??String(value);
 const hasData=(ctx,kind)=>Array.isArray(ctx.data?.[kind])||Array.isArray(ctx.data?.activities?.[kind]);
 const isCourseOff=row=>row.active===false||['disabled','停用','已禁用'].includes(row.status);
 const directoryName=(ctx,id)=>{const person=(ctx.data?.directory||[]).find(x=>x.id===id);if(person?.name||person?.username)return person.name||person.username;for(const value of [ctx.human?.('teacherId',id),ctx.nameOf?.('staff',id)])if(value&&value!==id&&value!=='关联资料暂不可见'&&value!=='未知资料')return value;return ''};
 function rows(ctx,kind){const list=ctx.pageRows?.(kind);return Array.isArray(list)?list:(ctx.dataRows?.(kind)||[])}
 function rawRows(ctx,kind){const list=ctx.dataRows?.(kind);return Array.isArray(list)?list:[]}
 function operation(ctx,id){return (ctx.operations||[]).find(op=>op.id===id&&ctx.permitted?.(op))||null}
 function callOpen(id,seed={}){return `businessAPI.open('${escapeHtml(id)}',${escapeHtml(JSON.stringify(seed))})`}
 function stat(label,value){return `<span class="bp-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></span>`}
 function select(ctx,page,key,label,options,value=''){
  const unique=[...new Set(options.filter(x=>x!==null&&x!==undefined&&String(x)!=='' ).map(String))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
  return `<label class="bp-filter">${escapeHtml(label)}<select class="select" aria-label="${escapeHtml(label)}" onchange="SiyueBusinessPresenter.filter('${page}','${key}',this.value)"><option value="">全部${escapeHtml(label)}</option>${unique.map(item=>`<option value="${escapeHtml(item)}" ${item===String(value)?'selected':''}>${escapeHtml(human(ctx,key,item))}</option>`).join('')}</select></label>`;
 }
 function tabs(ctx,page,items,selected){return `<div class="tabs bp-tabs" role="tablist">${items.map(([key,label,count])=>`<button type="button" role="tab" aria-selected="${selected===key}" class="tab ${selected===key?'active':''}" onclick="SiyueBusinessPresenter.tab('${page}','${key}')">${escapeHtml(label)} <span>${escapeHtml(count)}</span></button>`).join('')}</div>`}
 function toolbar(ctx,page,kind,createLabel,seed={}){
  const createOps=(ctx.operationsFor?.(kind)||[]).filter(op=>ctx.permitted?.(op)&&/\.create$/.test(op.id));
  const create=createOps.find(op=>op.id===({courses:'course.create',classes:'class.create',students:'student.create',campuses:'campus.create'}[kind]));const extraIds={courses:[],classes:['class.batchCreate','enrollment.batchTransfer','class.relocate'],students:['enrollment.batchCreate','enrollment.batchTransfer'],campuses:[]}[kind]||[],extra=extraIds.map(id=>operation(ctx,id)).filter(Boolean).map(op=>`<button type="button" class="btn" onclick="${callOpen(op.id)}">${escapeHtml(op.id==='class.relocate'?'批量班级转校区':op.label)}</button>`).join('');
  const search=`<input class="input bp-search" aria-label="查找记录" placeholder="搜索${escapeHtml(titles[page]||'记录')}" value="${escapeHtml(ctx.query||'')}" onchange="businessAPI.search(this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();businessAPI.search(this.value)}">`;
  return `<div class="toolbar course-toolbar bp-toolbar"><div class="toolbar-left">${search}</div><div class="toolbar-right bp-toolbar-actions">${create?`<button type="button" class="btn primary" onclick="${callOpen(create.id,seed)}">${escapeHtml(createLabel)}</button>`:''}${extra}<button type="button" class="btn" onclick="businessAPI.reload()">刷新</button></div></div>`;
 }
 function filtered(ctx,page,kind,source){
  const state=view[page]||{},query=String(ctx.query||'').trim().toLocaleLowerCase();
  return source.map(row=>({row,index:rawRows(ctx,kind).findIndex(x=>String(x.id)===String(row.id))})).filter(({row})=>{
   const searchable=[...Object.values(row).filter(v=>['string','number'].includes(typeof v)),row.campusName,ctx.nameOf?.('campuses',row.campusId),row.courseName,ctx.nameOf?.('courses',row.courseId),row.teacherName,directoryName(ctx,row.teacherId)];
   if(page==='course'&&['mall','other'].includes(state.tab))return false;if(query&&!searchable.filter(Boolean).join(' ').toLocaleLowerCase().includes(query))return false;
   for(const key of ['campus','grade','subject','teacher','status','course'])if(state[key]){
    const value=key==='campus'?(row.campusName||ctx.nameOf?.('campuses',row.campusId)||row.campus||''):
     key==='course'?(row.courseName||ctx.nameOf?.('courses',row.courseId)||row.course||''):
     key==='teacher'?(row.teacherName||directoryName(ctx,row.teacherId)||row.teacher||''):
     key==='grade'&&kind==='classes'?(row.grade||ctx.dataRows?.('courses')?.find(c=>c.id===row.courseId)?.grade||''):
     key==='subject'&&kind==='classes'?(row.subject||ctx.dataRows?.('courses')?.find(c=>c.id===row.courseId)?.subject||''):
     key==='status'&&kind==='courses'?(isCourseOff(row)?'已停用':'启用'):
     key==='status'&&kind==='students'?(studentStatus(ctx,row)):(row[key]??'');
    if(String(value)!==state[key])return false;
   }
   return true;
  });
 }
 function studentStatus(ctx,row){const records=rawRows(ctx,'enrollments').filter(e=>e.studentId===row.id);if(enrolled(records).length)return '在读';if(records.some(e=>historicEnrollment.has(e.status)&&!!e.activatedAt))return '历史';return row.status||'未报名'}
 function expandCell(ctx,kind,index,colspan,row){
  const expanded=ctx.expanded===`${kind}:${index}`;
  if(!expanded)return '';
  const actions=ctx.rowActions?.(kind,row,index)||'';
  return `<tr class="business-expanded bp-expanded"><td colspan="${colspan}"><div class="bp-row-actions">${actions||'<span class="muted">当前记录没有可用操作</span>'}</div><details><summary>查看记录</summary>${ctx.resultHtml?.(row)||''}</details></td></tr>`;
 }
 function cellButton(kind,index,label){return `<button type="button" class="bp-row-toggle" aria-label="${escapeHtml(label)}的更多操作" onclick="event.stopPropagation();businessAPI.expand('${kind}',${index})">操作 <svg class="bp-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 19 19 5M8 5h11v11"/></svg></button>`}
 function table(headers,body,empty,colspan){return `<div class="table-wrap bp-table-wrap"><table class="table business-table bp-table"><thead><tr>${headers.map(h=>`<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${body||`<tr><td colspan="${colspan}" class="empty">${escapeHtml(empty)}</td></tr>`}</tbody></table></div>`}
 function createClassForCourse(ctx,row){const op=operation(ctx,'class.create');if(!op)return '';return `<button type="button" class="btn small" onclick="${callOpen('class.create',{courseId:row.id})}">从此课程建班</button>`}
 function coursePage(ctx,page){
  const all=rows(ctx,'courses'),state=view[page]||{tab:'all'},tab=state.tab||'all';
  const counts={all:all.length,enabled:all.filter(x=>!isCourseOff(x)).length,disabled:all.filter(isCourseOff).length};
  const data=all.filter(x=>tab==='all'||(tab==='enabled'?!isCourseOff(x):isCourseOff(x)));
  const list=filtered(ctx,page,'courses',data),classCreate=operation(ctx,'class.create');
  const body=list.map(({row,index})=>{const lessons=Array.isArray(row.lessons)?row.lessons.length:Number(row.lessonCount||row.lessonsCount||0);const classes=hasData(ctx,'classes')?rawRows(ctx,'classes').filter(c=>c.courseId===row.id).length:'—';const price=Number(row.priceCents??row.feeCents);const expanded=ctx.expanded===`courses:${index}`,off=isCourseOff(row);return `<tr class="bp-data-row" onclick="businessAPI.expand('courses',${index})"><td><strong>${escapeHtml(row.name||'未命名课程')}</strong><small>${escapeHtml(human(ctx,'type',row.type||row.classType||'面授课程'))}</small></td><td>${escapeHtml(human(ctx,'grade',row.grade))}</td><td>${escapeHtml(human(ctx,'subject',row.subject))}</td><td>${lessons||'—'}</td><td>${Number.isFinite(price)?`${(price/100).toFixed(2)} 元`:'—'}</td><td>${classes}</td><td><span class="bp-status ${off?'is-off':''}">${off?'已停用':'启用'}</span></td><td>${cellButton('courses',index,'课程')}</td></tr>${expanded?`<tr class="business-expanded bp-expanded"><td colspan="8"><div class="bp-row-actions">${ctx.rowActions?.('courses',row,index)||''}${classCreate?createClassForCourse(ctx,row):''}</div><details><summary>查看课程资料</summary>${ctx.resultHtml?.(row)||''}</details></td></tr>`:''}`}).join('');
  return SiyuePageLayouts.course({tabs:tabs(ctx,page,[['all','自建课程',counts.all],['mall','课程商城',0],['other','其他课程',0]],tab),toolbar:toolbar(ctx,page,'courses','创建面授课程'),filters:`<div class="filters bp-filters">${select(ctx,page,'grade','年级',all.map(x=>x.grade),state.grade)}${select(ctx,page,'subject','学科',all.map(x=>x.subject),state.subject)}${select(ctx,page,'status','状态',all.map(x=>isCourseOff(x)?'已停用':'启用'),state.status)}</div>`,table:table(['课程名称','年级','学科','讲次数','课程价格','关联班级','状态','操作'],body,'暂无课程',8),footer:`共 ${list.length} 条课程 · 启用 ${counts.enabled} · 停用 ${counts.disabled}`});
 }
 function classPage(ctx,page){
  const all=rows(ctx,'classes'),state=view[page]||{},statusValues=[...new Set(all.map(x=>x.status).filter(Boolean))];
  const list=filtered(ctx,page,'classes',all),body=list.map(({row,index})=>{
   const course=row.courseName||ctx.nameOf?.('courses',row.courseId)||'—',campus=row.campusName||ctx.nameOf?.('campuses',row.campusId)||row.campus||'—',teacher=row.teacherName||directoryName(ctx,row.teacherId)||row.teacher||'—';
   const sessions=Array.isArray(row.schedule)?row.schedule:[],first=sessions[0],schedule=first?[`${first.date||'日期待定'} ${first.time||''}`,sessions.length>1?`共 ${sessions.length} 次`:null].filter(Boolean).join(' · '):'未排课';
   const enrollmentCount=hasData(ctx,'enrollments')?enrolled(rawRows(ctx,'enrollments').filter(x=>x.classId===row.id)).length:Number(row.enrollmentCount??row.studentCount);
   const count=Number.isFinite(enrollmentCount)?enrollmentCount:'—',capacity=Number(row.capacity);
   const expanded=ctx.expanded===`classes:${index}`;
   return `<tr class="bp-data-row" onclick="businessAPI.expand('classes',${index})"><td><strong>${escapeHtml(row.name||'未命名班级')}</strong></td><td>${escapeHtml(course)}</td><td>${escapeHtml(campus)}</td><td>${escapeHtml(teacher)}</td><td>${escapeHtml(schedule)}</td><td>${count}${Number.isFinite(capacity)&&capacity>0?` / ${capacity}`:' / —'}</td><td><span class="bp-status">${escapeHtml(human(ctx,'status',row.status))}</span></td><td>${cellButton('classes',index,'班级')}</td></tr>${expandCell(ctx,'classes',index,8,row)}`;
  }).join('');
  const running=all.some(x=>x.status!==undefined)?all.filter(x=>['active','running','开课中'].includes(x.status)).length:'—',scheduled=all.some(x=>Array.isArray(x.schedule))?all.filter(x=>Array.isArray(x.schedule)&&x.schedule.length).length:'—';
  return SiyuePageLayouts.classes({toolbar:toolbar(ctx,page,'classes','创建班级'),filters:`<div class="filters bp-filters">${select(ctx,page,'campus','校区',all.map(x=>x.campusName||ctx.nameOf?.('campuses',x.campusId)||x.campus),state.campus)}${select(ctx,page,'grade','年级',all.map(x=>x.grade||ctx.dataRows?.('courses')?.find(c=>c.id===x.courseId)?.grade),state.grade)}${select(ctx,page,'subject','学科',all.map(x=>x.subject||ctx.dataRows?.('courses')?.find(c=>c.id===x.courseId)?.subject),state.subject)}${select(ctx,page,'teacher','老师',all.map(x=>x.teacherName||directoryName(ctx,x.teacherId)||x.teacher),state.teacher)}${select(ctx,page,'status','状态',statusValues,state.status)}</div>`,table:table(['班级名称','课程','校区','授课老师','排课时间','已报名 / 容量','状态','操作'],body,'暂无班级',8),footer:`共 ${list.length} 条班级 · 已排课 ${scheduled}`});
 }
 function studentKindFilter(ctx,page,all,state){
  if(page==='learningActive')return all.filter(s=>enrolled(rawRows(ctx,'enrollments').filter(e=>e.studentId===s.id)).length>0);
  if(page==='learningHistory')return all.filter(s=>{const records=rawRows(ctx,'enrollments').filter(e=>e.studentId===s.id);return !enrolled(records).length&&records.some(e=>historicEnrollment.has(e.status)&&!!e.activatedAt)});
  if(state.tab==='active')return all.filter(s=>enrolled(rawRows(ctx,'enrollments').filter(e=>e.studentId===s.id)).length>0);
  if(state.tab==='history')return all.filter(s=>{const records=rawRows(ctx,'enrollments').filter(e=>e.studentId===s.id);return !enrolled(records).length&&records.some(e=>historicEnrollment.has(e.status)&&!!e.activatedAt)});
  return all;
 }
 function studentPage(ctx,page){
  const all=rows(ctx,'students'),state=view[page]||{},canEnrollment=Array.isArray(ctx.data?.enrollments)||Array.isArray(ctx.data?.activities?.enrollments);
  const source=studentKindFilter(ctx,page,all,state),list=filtered(ctx,page,'students',source),body=list.map(({row,index})=>{
   const campus=row.campusName||ctx.nameOf?.('campuses',row.campusId)||row.campus||'—',records=rawRows(ctx,'enrollments').filter(e=>e.studentId===row.id),active=enrolled(records),status=studentStatus(ctx,row);
   const classNames=[...new Set(active.map(e=>{const cls=rawRows(ctx,'classes').find(c=>c.id===e.classId);return (cls&&ctx.nameOf?.('courses',cls.courseId))||ctx.nameOf?.('classes',e.classId)||''}).filter(Boolean))].join('、')||'—',expanded=ctx.expanded===`students:${index}`;
   const detail=typeof globalThis.businessAPI?.showStudent==='function'?`<button type="button" class="btn small" onclick="event.stopPropagation();businessAPI.showStudent(${quote(row.id)})">档案</button>`:'';
   return `<tr class="bp-data-row" onclick="businessAPI.expand('students',${index})"><td><strong>${escapeHtml(row.name||'未命名学生')}</strong><small>${escapeHtml(row.phone||'')}</small></td><td>${escapeHtml(human(ctx,'grade',row.grade))}</td><td>${escapeHtml(campus)}</td><td>${escapeHtml(classNames)}</td><td><span class="bp-status ${status==='历史'?'is-off':''}">${escapeHtml(human(ctx,'status',status))}</span></td><td>${escapeHtml(human(ctx,'followStatus',row.followStatus||row.follow))}</td><td>${detail} ${cellButton('students',index,'学生')}</td></tr>${expandCell(ctx,'students',index,7,row)}`;
  }).join('');
  const counts={all:all.length,active:canEnrollment?all.filter(s=>studentStatus(ctx,s)==='在读').length:0,history:canEnrollment?all.filter(s=>studentStatus(ctx,s)==='历史').length:0};
  const showTabs=page==='students'&&canEnrollment;
  return SiyuePageLayouts.students({tabs:showTabs?tabs(ctx,page,[['all','全部学生',counts.all],['active','在读学生',counts.active],['history','历史学生',counts.history]],state.tab||'all'):'',toolbar:toolbar(ctx,page,'students','登记学生'),filters:`<div class="filters bp-filters">${select(ctx,page,'campus','校区',all.map(x=>x.campusName||ctx.nameOf?.('campuses',x.campusId)||x.campus),state.campus)}${select(ctx,page,'grade','年级',all.map(x=>x.grade),state.grade)}${select(ctx,page,'status','状态',[...new Set(all.map(x=>studentStatus(ctx,x)))],state.status)}</div>`,table:table(['学生 / 联系方式','年级','校区','在读课程','状态','跟进状态','操作'],body,'暂无学生档案',7),footer:`共 ${list.length} 条学生档案`});
 }
 const studentDetailTabs=new Map();
 const detailTabKeys=['profile','classes','orders','attendance'];
 function studentWritable(ctx,student){
  const actor=ctx.user,scope=actor?.scope||{type:'own'};if(!actor||actor.disabled)return false;
  if(scope.type==='all')return true;
  const classes=rawRows(ctx,'classes'),enrollments=rawRows(ctx,'enrollments');
  if(scope.type==='campus')return (scope.campusIds||[]).includes(student.campusId)||enrollments.some(e=>e.studentId===student.id&&['active','pending'].includes(e.status)&&classes.some(c=>c.id===e.classId&&(scope.campusIds||[]).includes(c.campusId)));
  if(scope.type==='own')return student.ownerId===actor.id||!student.ownerId&&student.createdBy===actor.id||rawRows(ctx,'leads').some(l=>l.studentId===student.id&&l.ownerId===actor.id);
  if(scope.type==='assigned'){
   const assigned=c=>c&&(c.teacherId===actor.id||c.teacherIds?.includes(actor.id)||c.schedule?.some(s=>s.teacherId===actor.id||s.substituteTeacherId===actor.id));
   if(classes.some(c=>assigned(c)&&(c.studentIds?.includes(student.id)||enrollments.some(e=>e.studentId===student.id&&e.classId===c.id&&e.status!=='withdrawn'))))return true;
   return rawRows(ctx,'sessionAdjustments').some(a=>['active','completed'].includes(a.status)&&(a.studentId===student.id||enrollments.some(e=>e.id===a.enrollmentId&&e.studentId===student.id))&&classes.some(c=>c.id===a.targetClassId&&(c.schedule||[]).some(s=>s.id===a.targetSessionId&&(s.substituteTeacherId||s.teacherId||c.teacherId)===actor.id)));
  }
  return false;
 }
 function studentDetail(ctx){
  const id=ctx.studentId,student=rawRows(ctx,'students').find(x=>String(x.id)===String(id));
  if(!id||!student)return `<section class="card pad bp-page"><p class="notice">当前账号无法查看此学生档案，或档案已不可用。</p><button class="btn" onclick="nav('students')">返回学生管理</button></section>`;
  const related=(kind)=>rawRows(ctx,kind).filter(row=>row.studentId===student.id),enrollments=related('enrollments'),orders=related('orders'),attendance=related('attendance'),consumptions=related('consumptions'),active=enrolled(enrollments);
  const label=(kind,key)=>{const record=rawRows(ctx,kind).find(row=>row.id===key);return record?.name||'关联资料暂不可见'},classFor=row=>rawRows(ctx,'classes').find(c=>c.id===row.classId),fee=value=>value===null||value===undefined||value===''?'—':money(value);
  const when=(key,value)=>{const formatted=human(ctx,key,value);if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(value)&&formatted===value){const time=Date.parse(value);if(Number.isFinite(time))return new Date(time+28800000).toISOString().slice(0,16).replace('T',' ')}return formatted};
  const items=[['profile','基础档案',null],...(active.length?[['classes','在读班级',active.length]]:[]),...(enrollments.length||orders.length?[['orders','报名订单',orders.length||enrollments.length]]:[]),...(attendance.length||consumptions.length?[['attendance','考勤课消',attendance.length+consumptions.length]]:[])];
  const saved=studentDetailTabs.get(String(id)),current=items.some(([key])=>key===saved)?saved:'profile';
  const update=ctx.user?.permissions?.includes('student.update')&&operation(ctx,'student.update')&&studentWritable(ctx,student);
  const edit=update?`<button type="button" class="btn" onclick="${callOpen('student.update',{studentId:student.id})}">编辑档案</button>`:'';
  const fields=[['学生姓名',student.name],['联系电话',student.phone],['年级',human(ctx,'grade',student.grade)],['所属校区',student.campusName||rawRows(ctx,'campuses').find(c=>c.id===student.campusId)?.name||student.campus],['学生状态',studentStatus(ctx,student)],...(student.followStatus||student.follow?[['跟进状态',human(ctx,'followStatus',student.followStatus||student.follow)]]:[]),...(student.guardian?[['家长姓名',student.guardian]]:[]),...(student.createdAt?[['登记时间',when('createdAt',student.createdAt)]]:[]),...(student.note?[['备注',student.note]]:[])];
  const section=(title,headers,records,renderRow,empty)=>`<section class="bp-detail-section"><h3>${title}</h3>${table(headers,records.map(renderRow).join(''),empty,headers.length)}</section>`;
  let content;
  if(current==='profile')content=`<div class="profile-quick-fields academic-grid three bp-profile-fields">${fields.map(([key,value])=>`<div><span>${escapeHtml(key)}</span><strong>${escapeHtml(value===undefined||value===null||value===''?'未录入':value)}</strong></div>`).join('')}</div>`;
  else if(current==='classes')content=table(['班级','课程','授课老师','校区','排课','状态'],active.map(row=>{const c=classFor(row),sessions=c?.schedule||[],first=sessions.filter(s=>!['cancelled','canceled','已取消'].includes(s.status)).sort((a,b)=>String(a.date+' '+a.time).localeCompare(String(b.date+' '+b.time)))[0];return `<tr><td>${escapeHtml(c?.name||'班级资料暂不可见')}</td><td>${escapeHtml(label('courses',c?.courseId))}</td><td>${escapeHtml(c?directoryName(ctx,c.teacherId)||c.teacher||'老师资料暂不可见':'—')}</td><td>${escapeHtml(c?label('campuses',c.campusId):'—')}</td><td>${escapeHtml(first?`${first.date||''} ${first.time||''}`:'暂无可见排课')} ${sessions.length>1?`<small>共 ${sessions.length} 讲</small>`:''}</td><td>${escapeHtml(human(ctx,'status',row.status))}</td></tr>`}).join(''),'暂无在读班级',6);
  else if(current==='orders')content=(enrollments.length?section('报名记录',['课程 / 班级','报名状态','登记时间'],enrollments,row=>`<tr><td>${escapeHtml(label('classes',row.classId))}</td><td>${escapeHtml(human(ctx,'status',row.status))}</td><td>${escapeHtml(when('createdAt',row.createdAt))}</td></tr>`,'暂无报名记录'):'')+(orders.length?section('收费订单',['订单编号','课程 / 班级','应付','已收','已退','状态'],orders,row=>`<tr><td>${escapeHtml(row.reference||row.orderNo||row.receiptNo||'未编业务单号')}</td><td>${escapeHtml(label('classes',row.classId))}</td><td>${fee(row.totalCents??row.amountCents)}</td><td>${fee(row.paidCents)}</td><td>${fee(row.refundedCents)}</td><td>${escapeHtml(human(ctx,'status',row.status))}</td></tr>`,'暂无订单'):'');
  else content=(attendance.length?section('考勤记录',['日期','时间','班级','出勤','备注'],attendance,row=>`<tr><td>${escapeHtml(when('date',row.date))}</td><td>${escapeHtml(row.time||'—')}</td><td>${escapeHtml(label('classes',row.classId))}</td><td>${escapeHtml(human(ctx,'status',row.attendanceStatus||row.status))}</td><td>${escapeHtml(row.note||'—')}</td></tr>`,'暂无考勤记录'):'')+(consumptions.length?section('课消记录',['日期','班级','金额','状态'],consumptions,row=>`<tr><td>${escapeHtml(when('createdAt',row.createdAt||row.date))}</td><td>${escapeHtml(label('classes',row.classId))}</td><td>${fee(row.amountCents)}</td><td>${escapeHtml(human(ctx,'status',row.status))}</td></tr>`,'暂无课消记录'):'');
  return `<section class="bp-page bp-student-detail"><button type="button" class="back-control back-link bp-back" onclick="businessAPI.back()"><svg class="back-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ui-back-arrow"></use></svg><span>返回列表</span></button><div class="card pad page-block"><div class="toolbar bp-detail-heading"><div><h2 class="section-title">${escapeHtml(student.name||'学生')} · 学生档案</h2><p>${escapeHtml(student.phone||'未填写联系电话')} · ${escapeHtml(human(ctx,'grade',student.grade))}</p></div><div class="actions"><span class="bp-status">${escapeHtml(studentStatus(ctx,student))}</span>${edit}</div></div></div><div class="card"><div class="tabs bp-profile-tabs" role="tablist" aria-label="学生档案内容">${items.map(([key,title,count])=>`<button type="button" role="tab" id="bp-profile-tab-${key}" aria-controls="bp-profile-panel" aria-selected="${key===current}" class="tab ${key===current?'active':''}" onclick="SiyueBusinessPresenter.studentTab(${quote(student.id)},'${key}')">${title}${count!==null?` <span>${count}</span>`:''}</button>`).join('')}</div><div class="pad" id="bp-profile-panel" role="tabpanel" aria-labelledby="bp-profile-tab-${current}">${content}</div></div></section>`;
 }
 function studentTab(id,key){if(!id||!detailTabKeys.includes(key))return false;const status=root.businessAPI?.status?.();if(status?.busy||status?.uncertain)return false;studentDetailTabs.set(String(id),key);root.businessAPI?.redraw?.();return true}
 function money(cents){const value=Number(cents);return Number.isFinite(value)?`${(value/100).toFixed(2)} 元`:'—'}
 function campusPage(ctx,page){
  const all=rows(ctx,'campuses'),list=filtered(ctx,page,'campuses',all),body=list.map(({row,index})=>{const rooms=Array.isArray(row.roomDetails)?row.roomDetails.length:Array.isArray(row.rooms)?row.rooms.length:null;const classes=hasData(ctx,'classes')?rawRows(ctx,'classes').filter(c=>c.campusId===row.id).length:'—',expanded=ctx.expanded===`campuses:${index}`;return `<tr class="bp-data-row" onclick="businessAPI.expand('campuses',${index})"><td><strong>${escapeHtml(row.name||'未命名校区')}</strong></td><td>${escapeHtml(row.address||'—')}</td><td>${rooms===null?'—':rooms}</td><td>${classes}</td><td><span class="bp-status ${row.active===false?'is-off':''}">${row.active===false?'停用':'启用'}</span></td><td>${cellButton('campuses',index,'校区')}</td></tr>${expandCell(ctx,'campuses',index,6,row)}`}).join('');const classTotal=hasData(ctx,'classes')?rawRows(ctx,'classes').length:'—';return `<section class="card pad bp-page"><div class="bp-stats">${stat('校区总数',all.length)}${stat('启用中',all.filter(x=>x.active!==false).length)}${stat('关联班级',classTotal)}</div>${toolbar(ctx,page,'campuses','新增校区')}${table(['校区名称','地址','教室数','班级数','状态','操作'],body,'暂无校区',6)}</section>`;
 }
 function render(ctx){
  if(!ctx||!plural[ctx.page])return null;
  const page=ctx.page;
  if(page==='studentDetail')return studentDetail(ctx);
  if(page==='course')return coursePage(ctx,page);
  if(page==='classes')return classPage(ctx,page);
  if(['students','learningActive','learningHistory','studentArchives'].includes(page))return studentPage(ctx,page);
  if(page==='campus')return campusPage(ctx,page);
  return null;
 }
 function tab(page,value){if(!plural[page])return false;view[page]=view[page]||{};view[page].tab=value;root.businessAPI?.redraw?.();return true}
 function filter(page,key,value){if(!plural[page]||!['campus','grade','subject','teacher','status','course'].includes(key))return false;view[page]=view[page]||{};view[page][key]=String(value||'');root.businessAPI?.redraw?.();return true}
 function reset(){for(const key of Object.keys(view))delete view[key];studentDetailTabs.clear()}
 root.SiyueBusinessPresenter={render,reset,tab,filter,studentTab};
})(typeof window!=='undefined'?window:globalThis);
