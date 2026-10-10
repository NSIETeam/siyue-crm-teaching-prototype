/* Validated single-course and single-class edits. Local prototype business data. */
function academicText(value){return String(value??'').trim()}
function academicHTML(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function academicValue(id){return academicText(document.querySelector('#'+id)?.value)}
function academicNameKey(value){return academicText(value).normalize('NFKC').replace(/\s+/g,' ').toLocaleLowerCase()}
let academicEntitySequence=0;
function academicEntityId(prefix,items){let id;do{id=`${auditId(prefix)}-${++academicEntitySequence}`}while(items.some(x=>x.id===id));return id}
function academicClassCourseVersion(course){const value=Number(course?.curriculumVersion||course?.version||1);return Number.isInteger(value)&&value>0?value:1}
function academicClassTeachers(){
 const staff=state.staff||[];
 return [...new Set(staff.filter(s=>s.active!==false&&!s.disabled&&academicText(s.name)&&staff.filter(t=>t.name===s.name).length===1&&(s.isTeacher===true||(s.roleIds||[]).includes('teacher')||/教师|老师|主讲|助教|教学/.test([s.roles,permissionRole(s.roleId)?.name].join(' '))||a.classes.some(c=>c.teacher===s.name||s.id&&c.teacherId===s.id))).map(s=>s.name))];
}
function academicCampus(value){const matches=state.campuses.filter(c=>c===value||c.name===value);return matches.length===1?matches[0]:null}
function academicRoomDetails(value){
 const campus=academicCampus(value);if(!campus)return [];
 const explicit=Array.isArray(campus.roomDetails)?campus.roomDetails:Array.isArray(campus.roomList)?campus.roomList:null;
 if(explicit)return explicit.map(r=>typeof r==='string'?{name:r}:{...r}).filter(r=>academicText(r.name)&&r.active!==false).map(r=>({...r,name:academicText(r.name)}));
 const count=Number(campus.rooms);if(!Number.isInteger(count)||count<0||count>500)return [];
 return Array.from({length:count},(_,i)=>({name:`教室${String(i+1).padStart(2,'0')}`,source:'legacy-count'}));
}
function academicClassRooms(value){return [...new Set(academicRoomDetails(value).map(r=>r.name))]}
function academicSelect(id,options,current='',extra=''){return `<select id="${academicHTML(id)}" class="select" ${extra}><option value="">请选择</option>${options.map(o=>{const [value,label]=Array.isArray(o)?o:[o,o];return `<option value="${academicHTML(value)}" ${String(value)===String(current)?'selected':''}>${academicHTML(label)}</option>`}).join('')}</select>`}
function academicReplaceSelect(html,id,options,current='',extra=''){return html.replace(new RegExp(`<select[^>]*id="${id}"[^>]*>[\\s\\S]*?</select>`),academicSelect(id,options,current,extra))}
function academicConfigOptions(type,current){return [...new Set([...(state.config[type]||[]).map(x=>x[2]||x[0]),current].filter(Boolean))]}
function academicRosterIds(c){return [...new Set([...(c.studentIds||[]),...a.students.filter(s=>s.classIds?.includes(c.id)||s.className===c.name).map(s=>s.id)])]}
function academicClassReferenced(c){return academicRosterIds(c).length>0||Number(c.students)>0||a.orders.some(o=>o.classId===c.id)||a.attendance.some(r=>r.classId===c.id||r.classIndex===a.classes.indexOf(c))||(c.sessions||[]).length>0||(c.schedule||[]).length>0||(a.sessionAdjustments||[]).some(r=>r.sourceClassId===c.id||r.targetClassId===c.id)}
function academicCourseReferences(course){
 const classes=a.classes.filter(c=>c.courseId===course.id||!c.courseId&&c.course===course.name),orders=a.orders.filter(o=>o.courseId===course.id||classes.some(c=>c.id===o.classId)),ids=new Set();
 classes.forEach(c=>{if(c.lessonId)ids.add(c.lessonId);(c.schedule||[]).forEach(p=>{if(p.lessonId)ids.add(p.lessonId)});(c.sessions||[]).forEach(p=>{if(p.lessonId)ids.add(p.lessonId)})});
 orders.forEach(o=>(o.lessonSnapshot||[]).forEach(l=>{if(l.id)ids.add(l.id)}));
 return {classes,orders,ids,used:classes.length>0||orders.length>0};
}
function academicLessonContent(l){return JSON.stringify({title:academicText(l.title),objective:academicText(l.objective),duration:Number(l.duration)||120,publicMaterials:l.publicMaterials||[],internalMaterials:l.internalMaterials||[]})}
const academicCourseFormBase=courseForm;
courseForm=function(){
 const c=a.selectedClass===null?null:a.courses[a.selectedClass];let html=academicCourseFormBase().replace('<div class="card pad">','<div class="card pad academic-edit-form">');
 const year=String(c?.year||new Date().getFullYear());html=academicReplaceSelect(html,'course-year',[...new Set([String(new Date().getFullYear()),String(new Date().getFullYear()+1),year])],year);
 for(const [id,key,type] of [['course-subject','subject','学科'],['course-grade','grade','年级'],['course-term','term','学期'],['course-class-type','classType','班型']])html=academicReplaceSelect(html,id,academicConfigOptions(type,c?.[key]),c?.[key]||'');
 html=academicReplaceSelect(html,'course-charge',['整期'],c?.chargeMode||'整期');
 html=html.replace('创建课程</button>',`${c?'保存课程':'创建课程'}</button>`);
 if(c&&academicCourseReferences(c).used)html=html.replace('<div id="session-list">','<p class="help">已排课或报名的讲次保留原内容；教学内容调整请创建新课程版本。</p><div id="session-list">');
 return html;
};
saveCourse=auditAtomic(function(){
 if(!workflowGuard('course'))return false;
 const index=a.selectedClass,old=index===null?null:a.courses[index],name=academicValue('course-name'),errors=[];
 if(index!==null&&!old){toast('课程已不存在，请重新选择');return false}
 const values={type:academicValue('course-type'),year:academicValue('course-year'),term:academicValue('course-term'),subject:academicValue('course-subject'),classType:academicValue('course-class-type'),grade:academicValue('course-grade'),chargeMode:academicValue('course-charge')};
 if(!name)errors.push('请输入课程名称');
 if(a.courses.some(c=>c!==old&&academicNameKey(c.name)===academicNameKey(name)))errors.push('课程名称已存在，请使用不同名称');
 if(!['长期班','短期班','体验课'].includes(values.type))errors.push('请选择课程类型');
 if(!/^20\d{2}$/.test(values.year))errors.push('请选择有效年份');
 for(const [key,type] of [['term','学期'],['subject','学科'],['grade','年级']])if(!values[key]||!academicConfigOptions(type,old?.[key]).includes(values[key]))errors.push(`请选择已配置的${type}`);
 if(values.classType&&!academicConfigOptions('班型',old?.classType).includes(values.classType))errors.push('请选择已配置班型');
 if(values.chargeMode!=='整期')errors.push('当前报名按整期总价结算，请选择整期收费');
 const feeText=academicValue('course-fee'),fee=Number(feeText),material=Number(academicValue('course-material')||0);
 if(!feeText||!Number.isFinite(fee)||fee<0||!Number.isFinite(material)||material<0)errors.push('请填写非负课程费和教辅费');
 const id=old?.id||academicEntityId('CRS',a.courses),rows=[...document.querySelectorAll('.workflow-lesson')],seen=new Set(),lessons=[];
 rows.forEach((row,i)=>{
  const read=key=>academicText(row.querySelector(key)?.value),lessonId=academicText(row.dataset.id)||academicEntityId('LESSON',lessons),title=read('.lesson-title'),duration=Number(read('.lesson-duration'));
  if(seen.has(lessonId)||a.courses.some(c=>c!==old&&(c.lessons||[]).some(l=>l.id===lessonId)))errors.push(`第${i+1}讲的标识重复，请重新添加该讲次`);seen.add(lessonId);
  if(!title)errors.push(`请填写第${i+1}讲标题`);if(!Number.isInteger(duration)||duration<=0||duration>1440)errors.push(`第${i+1}讲时长须为1至1440分钟的整数`);
  lessons.push({id:lessonId,sequence:i+1,title,objective:read('.lesson-objective'),duration,publicMaterials:read('.lesson-public').split(/[，,]/).map(academicText).filter(Boolean),internalMaterials:read('.lesson-internal').split(/[，,]/).map(academicText).filter(Boolean)});
 });
 if(!lessons.length)errors.push('请至少添加一讲教学内容');
 const refs=old?academicCourseReferences(old):null;
 if(refs?.used){
  if(values.subject!==old.subject||academicRepairGrade(values.grade)!==academicRepairGrade(old.grade))errors.push('已有班级或报名引用，不能改变课程学科、年级；请创建新课程版本');
  for(const l of old.lessons||[])if(refs.ids.has(l.id)){const next=lessons.find(x=>x.id===l.id);if(!next||academicLessonContent(l)!==academicLessonContent(next)||(old.lessons||[]).indexOf(l)!==lessons.indexOf(next))errors.push(`「${l.title}」已被排课或订单引用，不能删除、改写或重排；请创建新课程版本`)}
 }
 if(old?.id&&a.courses.filter(c=>c.id===old.id).length!==1)errors.push('课程标识重复，请先核对数据');
 if(errors.length){toast([...new Set(errors)].join('；'));return false}
 const curriculumChanged=old&&(old.subject!==values.subject||old.grade!==values.grade||(old.lessons||[]).length>0&&JSON.stringify(old.lessons.map(l=>[l.id,academicLessonContent(l)]))!==JSON.stringify(lessons.map(l=>[l.id,academicLessonContent(l)]))),curriculumVersion=old?academicClassCourseVersion(old)+(curriculumChanged?1:0):1,ageRange=academicValue('course-age-range');
 const course={...old,id,name,...values,fee,materialFee:material,ageRange,timeLabel:academicValue('course-time-label'),lessons,curriculumVersion,version:curriculumVersion,active:old?.active??true,product:{...old?.product,title:name,summary:`${ageRange||values.grade} · ${values.subject} · ${values.term}`,outline:lessons.map(l=>l.title),price:fee,chargeMode:values.chargeMode,version:(Number(old?.product?.version)||0)+1,publicMaterials:lessons.flatMap(l=>l.publicMaterials)}};
 if(old)a.courses[index]=course;else a.courses.push(course);
 (refs?.classes||[]).forEach(c=>{c.courseId=id;c.course=name});
 a.selectedClass=null;a.classDraftCourse=null;workflowPersist();nav('course');toast('课程与商城商品草稿已同步保存');return true;
});
function academicClassCourse(value){const byId=a.courses.filter(c=>c.id===value);if(byId.length===1)return byId[0];const byName=a.courses.filter(c=>c.name===value);return byId.length===0&&byName.length===1?byName[0]:null}
function academicClassChangeCampus(){const value=academicValue('class-campus-form');document.querySelector('#class-room').innerHTML=academicSelect('class-room',academicClassRooms(value)).replace(/^<select[^>]*>|<\/select>$/g,'')}
function academicClassPrice(){const course=academicClassCourse(academicValue('class-course')),el=document.querySelector('#class-course-price');if(el)el.textContent=course?`整期课程费 ¥${Number(course.product?.price??course.fee??0).toFixed(2)}，沿用课程设置`:'请先选择课程'}
classForm=function(){
 const c=a.selectedClass===null?null:a.classes[a.selectedClass],course=c?academicClassCourse(c.courseId||c.course):a.courses[a.classDraftCourse],campus=c?.campus||'',scheduled=!!c?.schedule?.length,input=(id,value,type='text',extra='')=>`<input class="input" id="${id}" type="${type}" value="${academicHTML(value??'')}" ${extra}>`;
 return `<section class="card pad academic-edit-form"><div class="form-grid">${aField('课程名称',academicSelect('class-course',a.courses.filter(x=>x.active!==false||x===course).map(x=>[x.id,x.name]),course?.id||'','onchange="academicClassPrice()"'),true)}${aField('班级名称',input('class-name',c?.name),true)}${aField('校区',academicSelect('class-campus-form',state.campuses.filter(x=>x.active!==false).map(x=>x.name),campus,'onchange="academicClassChangeCampus()"'),true)}${aField('教室',academicSelect('class-room',academicClassRooms(campus),c?.room||''),true)}${aField('学生人数上限',input('class-capacity',c?.capacity||20,'number','min="1" step="1"'),true)}${aField('面授老师',academicSelect('class-teacher-form',academicClassTeachers(),c?.teacher||''),true)}${aField(scheduled?'首讲日期（在排课页调整）':'首讲日期',input('class-date',c?.date,'date',scheduled?'readonly':''),true)}${aField(scheduled?'首讲时间（在排课页调整）':'首讲时间',input('class-time',c?.time||'','text',scheduled?'readonly':'placeholder="09:00–11:00"'),true)}</div><p id="class-course-price" class="help">${course?`整期课程费 ¥${Number(course.product?.price??course.fee??0).toFixed(2)}，沿用课程设置`:'请先选择课程'}</p><p class="help">保存班级后可按课程讲次批量排课。</p>${aActions('classes','saveClass()','保存班级')}</section>`;
};
function academicClassCandidateErrors(candidate,old){
 const errors=[],time=scTimeParts(candidate),roster=old?academicRosterIds(old):[];
 if(!time.start)errors.push('请填写有效日期和时间，结束时间须晚于开始时间');
 const views=typeof academicClassSessions==='function'?academicClassSessions(candidate):[candidate],others=typeof academicScheduledClasses==='function'?academicScheduledClasses().map(x=>x.c):a.classes;
 for(const view of views){
  if(!scScheduledClassActive(view))continue;
  const teacher=typeof scActualTeacher==='function'?scActualTeacher(view):view.teacher;
  for(const other of others){
   if(old&&other.id===old.id||!scScheduledClassActive(other)||!academicRepairOverlap(view,other))continue;
   if((typeof scActualTeacher==='function'?scActualTeacher(other):academicRepairTeacher(other))===teacher)errors.push(`授课老师 ${teacher} 在 ${other.time} 已有排课`);
   if(view.campus===other.campus&&view.room===other.room)errors.push(`教室 ${view.room} 在 ${other.time} 已被占用`);
   const actual=typeof workflowSessionRoster==='function'?workflowSessionRoster(view).map(s=>s.id):roster,otherIds=workflowSessionRoster(other).map(s=>s.id),shared=actual.filter(id=>otherIds.includes(id));
   if(shared.length)errors.push(`${shared.map(id=>a.students.find(s=>s.id===id)?.name||id).join('、')} 与「${other.name}」上课时间冲突`);
  }
 }
 return [...new Set(errors)];
}
saveClass=auditAtomic(function(){
 if(!workflowGuard('classes'))return false;
 const index=a.selectedClass,old=index===null?null:a.classes[index];if(index!==null&&!old){toast('班级已不存在，请重新选择');return false}
 const course=academicClassCourse(academicValue('class-course')),candidate={...old,name:academicValue('class-name'),course:course?.name||'',courseId:course?.id||'',teacher:academicValue('class-teacher-form'),campus:academicValue('class-campus-form'),room:academicValue('class-room'),date:academicValue('class-date'),time:academicValue('class-time'),capacity:Number(academicValue('class-capacity'))},locationChanged=old&&['campus','room'].some(k=>old[k]!==candidate[k]);
 // Project the actual scheduled locations before checking conflicts. A previous
 // campus move may have given every lesson its own location snapshot.
 if(locationChanged&&old.schedule?.length)candidate.schedule=batchCampusProjection(old,candidate.campus,candidate.room).schedule;
 const errors=academicClassCandidateErrors(candidate,old),campus=academicCampus(candidate.campus);
 if(!candidate.name)errors.push('请输入班级名称');if(a.classes.some(c=>c!==old&&academicNameKey(c.name)===academicNameKey(candidate.name)))errors.push('班级名称已存在，请使用不同名称');
 if(!course?.id||course.active===false)errors.push('请选择有效且已启用的课程');else if(!course.lessons?.length)errors.push('所选课程尚未配置讲次，请先编辑课程');
 if(!campus||campus.active===false)errors.push('请选择有效且已启用的校区');
 if(!academicClassTeachers().includes(candidate.teacher))errors.push(`请选择在职老师${candidate.teacher?'（'+candidate.teacher+' 无有效教师档案）':''}`);
 const rooms=academicRoomDetails(campus),matching=rooms.filter(r=>r.name===candidate.room);if(matching.length!==1)errors.push('请选择当前校区有效且唯一的教室');
 const enrolled=old?Math.max(Number(old.students)||0,academicRosterIds(old).length):0,pending=old?a.orders.filter(o=>o.classId===old.id&&o.paymentState==='待支付'&&!workflowOrderClosed(o)).length:0;
 if(!Number.isInteger(candidate.capacity)||candidate.capacity<Math.max(1,enrolled+pending))errors.push(`班级容量须为正整数，且不能少于现有 ${enrolled} 人与待支付 ${pending} 人`);
 if(matching[0]?.capacity!=null&&Number(matching[0].capacity)>0&&candidate.capacity>Number(matching[0].capacity))errors.push(`班级容量不能超过教室 ${matching[0].capacity} 个座位`);
 const courseChanged=old&&course?.id!==(old.courseId||academicClassCourse(old.course)?.id),resourceChanged=old&&['teacher','campus','room'].some(k=>old[k]!==candidate[k]),timeChanged=old&&['date','time'].some(k=>old[k]!==candidate[k]);
 if(courseChanged&&academicClassReferenced(old))errors.push('班级已有学生、订单或课次记录，不能直接换课程；请使用转班或新建班级');
 if(old?.schedule?.length&&timeChanged)errors.push('已有课次排期，请在班级排课页面修改日期和时间');
 const oldViews=old?(typeof academicClassSessions==='function'?academicClassSessions(old):[old]):[];
 if(old&&(timeChanged||resourceChanged)&&oldViews.some(c=>typeof academicHasSessionRecord==='function'?academicHasSessionRecord(c):a.attendance.some(r=>r.classIndex===index&&(r.consumptionConfirmed||r.status==='已考勤'))||(c.sessions||[]).length))errors.push(locationChanged?'已有考勤、代课或调班记录，请使用班级转校区流程调整未来上课地点':'已有考勤、代课或调班记录，请通过课次操作调整，不能改写历史排课');
 if(locationChanged&&oldViews.some(c=>!scTimeParts(c).start||scTimeParts(c).start<=Date.now()))errors.push('班级已有历史课次，请使用班级转校区流程调整未来上课地点');
 const pendingLocations=locationChanged&&old.schedule?.length?a.attendance.filter(r=>(r.classId?r.classId===old.id:r.classIndex===index)&&r.status==='未考勤'&&!r.consumptionConfirmed).map(record=>({record,source:academicMatchRecordedSession(record,old,oldViews)})):[];
 if(pendingLocations.some(x=>!x.source))errors.push('存在无法对应课次的待考勤记录，请先核对后再调整上课地点');
 if(!old&&scTimeParts(candidate).start&&scTimeParts(candidate).start<=Date.now())errors.push('新建班级的首讲时间须在未来');
 if(old?.id&&a.classes.filter(c=>c.id===old.id).length!==1)errors.push('班级标识重复，请先核对数据');
 if(errors.length){toast([...new Set(errors)].join('；'));return false}
 const item={...candidate,id:old?.id||academicEntityId('CLS',a.classes),teacherId:(state.staff||[]).find(s=>s.name===candidate.teacher)?.id||null,studentIds:old?academicRosterIds(old):[],students:enrolled,status:old?.status||'未开课',sessions:old?.sessions||[],lessonId:old&&!courseChanged?old.lessonId||course.lessons[0].id:course.lessons[0].id,lessonVersion:old&&!courseChanged?old.lessonVersion||academicClassCourseVersion(course):academicClassCourseVersion(course)};
 if(locationChanged){
  for(const {record,source} of pendingLocations){const planned=item.schedule?.find(p=>p.key===workflowSessionKey(source));if(planned&&batchCampusMovable(source)){record.campusSnapshot=planned.campus;record.roomSnapshot=planned.room}}
  item.locationHistory=[...(old.locationHistory||[]),{fromCampus:old.campus,fromRoom:old.room,campus:item.campus,room:item.room,source:'班级编辑',at:new Date().toISOString(),sessionIds:(item.schedule||[]).filter(p=>p.campus===item.campus&&p.room===item.room).map(p=>p.key)}];
 }
 if(old){a.classes[index]=item;if(old.name!==item.name)a.students.filter(s=>s.className===old.name).forEach(s=>{s.className=item.name})}else a.classes.push(item);
 a.selectedClass=null;a.classDraftCourse=null;workflowPersist();nav('classes');toast(old?'班级已更新，学生名单与既有排期已保留':'班级已创建，可继续按课程讲次排课');return true;
});

// Persist room names, not only their count, so later class forms can select them.
const academicCampusStorageKey='siyue-campus-directory-v1';
try{const campuses=JSON.parse(localStorage.getItem(academicCampusStorageKey));if(Array.isArray(campuses)&&campuses.every(c=>c&&typeof c.name==='string'))state.campuses=campuses}catch{}
const academicCampusFormBase=campusForm;
campusForm=function(){let html=academicCampusFormBase();const c=state.campusEdit===null?null:state.campuses[state.campusEdit];if(c){const rooms=academicRoomDetails(c);html=html.replace(`<div class="pill">现有教室 ${c.rooms} 间，坐席 ${c.seats} 个</div>`,`<div class="help">现有教室 ${rooms.length} 间：${rooms.map(r=>academicHTML(r.name)+(r.capacity?`（${r.capacity}座）`:r.source==='legacy-count'?'（按原数量编号）':'')).join('、')||'无'}</div>`)}return html};
saveCampus=function(){
 if(!workflowGuard('system'))return false;
 const name=academicValue('campus-name'),address=academicValue('campus-address'),old=state.campusEdit===null?null:state.campuses[state.campusEdit],errors=[];
 if(!name||!address)errors.push('请填写校区名称和详细地址');if(state.campuses.some(c=>c!==old&&academicNameKey(c.name)===academicNameKey(name)))errors.push('校区名称已存在');
 const rooms=old?academicRoomDetails(old).map(r=>({...r})):[];for(const row of document.querySelectorAll('.room')){const roomName=academicText(row.querySelector('.room-name')?.value),capacityText=academicText(row.querySelector('.room-capacity')?.value),capacity=Number(capacityText);if(!roomName&&!capacityText)continue;if(!roomName||!Number.isInteger(capacity)||capacity<=0){errors.push('请填写教室名称和正整数座位数');continue}if(rooms.some(r=>academicNameKey(r.name)===academicNameKey(roomName)))errors.push(`教室「${roomName}」已存在`);rooms.push({name:roomName,capacity,active:true})}
 // Existing name-based business references must retain a resolvable campus.
 if(old&&name!==old.name&&[...a.classes,...a.students,...state.staff,...leadState.leads].some(x=>x.campus===old.name))errors.push('校区已被业务资料引用，请保留现有名称；教室和地址仍可更新');
 if(errors.length){toast([...new Set(errors)].join('；'));return false}
 const addedSeats=rooms.slice(old?academicRoomDetails(old).length:0).reduce((sum,r)=>sum+r.capacity,0),next={...old,name,address:/^江苏省/.test(address)?address:'江苏省 苏州市 姑苏区 '+address,merchant:academicValue('campus-merchant'),active:old?.active??true,rooms:rooms.length,seats:(Number(old?.seats)||0)+addedSeats,roomDetails:rooms},campuses=state.campuses.map(c=>c===old?next:c);if(!old)campuses.push(next);
 try{localStorage.setItem(academicCampusStorageKey,JSON.stringify(campuses))}catch{toast('校区未保存，请检查浏览器存储空间');return false}state.campuses=campuses;state.mode='list';render();toast('校区和教室已保存');return true;
};
