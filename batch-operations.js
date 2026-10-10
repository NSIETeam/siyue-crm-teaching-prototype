/* Bulk workflows: preview, revalidate, commit atomically to local prototype storage. */
const batchNames={create:'批量创建班级',enroll:'批量报名',transfer:'批量学生转班',campus:'批量班级转校区'};
let batchUI=null;
function batchAllowed(kind){if(!Object.hasOwn(batchNames,kind))return false;return kind==='enroll'?workflowMay('enroll'):kind==='transfer'?workflowMay('transfer')&&workflowMay('academic'):workflowMay('classes')&&workflowMay('academic')}
function batchToday(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function batchId(){return `BATCH-${Date.now()}-${Math.random().toString(36).slice(2,9)}`}
function batchOpen(kind){if(!batchAllowed(kind)){toast('当前身份无此批量办理权限');return}batchUI={kind,token:batchId(),ids:[],excludedIds:[],enrollDirty:false,draft:{sourceId:'',targetId:'',campus:state.campuses.find(c=>c.active)?.name||'',rows:[],enrollOverrides:{}},plan:null};nav('batchFlow')}
function batchSelect(field,options,value){return `<select class="select" data-batch-field="${field}" onchange="batchCapture();${field==='sourceId'?"batchUI.ids=[];batchRender()":''}"><option value="">请选择</option>${options.map(([id,label])=>`<option value="${esc(id)}" ${id===value?'selected':''}>${esc(label)}</option>`).join('')}</select>`}
function batchCapture(){if(!batchUI)return;document.querySelectorAll('[data-batch-field]').forEach(el=>batchUI.draft[el.dataset.batchField]=el.value);document.querySelectorAll('[data-batch-row]').forEach(el=>batchUI.draft.rows[Number(el.dataset.batchRow)][el.dataset.key]=el.value)}
function batchToggle(id,checked){const set=new Set(batchUI.ids);checked?set.add(id):set.delete(id);batchUI.ids=[...set];const el=$('#batch-count');if(el)el.textContent=`已选 ${set.size} 项`}
function batchRoster(c,s){return !!c&&(c.studentIds?.includes(s.id)||s.className===c.name||s.classIds?.includes(c.id))}
function batchCandidates(){if(batchUI.kind==='campus')return a.classes.map(c=>({id:c.id,name:c.name,detail:`${c.campus} · ${c.room} · ${c.teacher}`}));const source=a.classes.find(c=>c.id===batchUI.draft.sourceId);return a.students.filter(s=>batchUI.kind==='enroll'||batchRoster(source,s)).map(s=>({id:s.id,name:s.name,detail:`${s.phone||'未填电话'} · ${s.className||'未分班'}`}))}
function batchAll(checked){document.querySelectorAll('#batch-candidates input[type=checkbox]').forEach(el=>{if(!el.closest('label').hidden){el.checked=checked;batchToggle(el.value,checked)}})}
function batchFilter(q){document.querySelectorAll('#batch-candidates label').forEach(el=>el.hidden=!el.textContent.includes(q.trim()))}
function batchGenerate(){batchCapture();const count=Number($('#batch-quantity').value),course=a.courses.find(x=>x.id===$('#batch-course').value);if(!course||!Number.isInteger(count)||count<1||count>100){toast('请选择课程，数量为 1–100');return}batchUI.draft.rows=Array.from({length:count},(_,i)=>({name:`${course.name}（${i+1}班）`,courseId:course.id,campus:batchUI.draft.campus,teacher:a.classes[0]?.teacher||'',room:'',date:batchToday(),time:'09:00–11:00',capacity:20}));batchRender()}
function batchEditor(){const d=batchUI.draft,k=batchUI.kind,classes=a.classes.map(c=>[c.id,`${c.name} · ${c.campus}`]),campuses=state.campuses.filter(c=>c.active).map(c=>[c.name,c.name]);if(k==='create')return `<div class="form-grid">${aField('统一校区',batchSelect('campus',campuses,d.campus))}<div class="field"><label>选择课程</label><select class="select" id="batch-course">${a.courses.filter(c=>c.active).map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></div><div class="field"><label>建班数量（1–100）</label><input id="batch-quantity" type="number" class="input" min="1" max="100" value="3"></div></div><div class="form-actions"><button class="btn" onclick="batchGenerate()">生成待建班列表</button></div>${d.rows.length?`<p class="help">逐行调整班名、老师、教室和时间；同一老师或同校区教室时间重叠会阻止提交。生成列表本身不创建班级。</p>${aTable(['班名','老师','教室','日期','时段','容量'],d.rows.map((r,i)=>`<tr>${['name','teacher','room','date','time','capacity'].map(key=>`<td><input class="input" aria-label="第${i+1}行${key}" data-batch-row="${i}" data-key="${key}" type="${key==='date'?'date':key==='capacity'?'number':'text'}" value="${esc(r[key])}"></td>`).join('')}</tr>`))}`:''}`;
const fields=k==='transfer'?aField('原班级',batchSelect('sourceId',classes,d.sourceId))+aField('目标班级',batchSelect('targetId',classes,d.targetId)):k==='enroll'?aField('报名班级',batchSelect('targetId',classes,d.targetId)):aField('目标校区',batchSelect('campus',campuses,d.campus));const candidates=batchCandidates();
return `<div class="form-grid">${fields}</div><p class="help">${k==='enroll'?'每名学生独立报价并生成待支付订单，支付前不加入正式班级名单。':k==='transfer'?'可全选原班学生；仅支持同课程、同版本、同讲次转班。历史考勤与收款快照保留。':'班级名单与课程进度保留；学生档案所属校区不随班级自动改写。请为每个班填写目标教室。'}</p><div class="toolbar"><input class="input" placeholder="筛选姓名或班级" oninput="batchFilter(this.value)"><div class="toolbar-right"><button class="btn small" onclick="batchAll(true)">全选筛选结果</button><button class="btn small" onclick="batchAll(false)">取消筛选结果</button><span id="batch-count">已选 ${batchUI.ids.length} 项</span></div></div><div id="batch-candidates">${candidates.map(x=>`<div class="batch-candidate"><label><input type="checkbox" value="${esc(x.id)}" ${batchUI.ids.includes(x.id)?'checked':''} onchange="batchToggle(this.value,this.checked)"><span><strong>${esc(x.name)}</strong><small>${esc(x.detail)}</small></span></label>${k==='campus'?`<input class="input" aria-label="${esc(x.name)}的目标教室" placeholder="目标教室" data-batch-field="room:${esc(x.id)}" value="${esc(d['room:'+x.id]||'')}">`:''}</div>`).join('')||'<p class="empty">请先选择原班级，或当前没有可选择的记录。</p>'}</div>`}
function batchPage(){const b=batchUI;if(!b||!batchAllowed(b.kind))return '<div class="card pad">当前批量办理已结束或无权访问。</div>';return `<section class="card pad batch-page"><div class="toolbar"><strong>${batchNames[b.kind]}</strong><span class="muted">${b.plan?'核对并确认':'选择办理对象'}</span></div>${b.plan?batchPreviewHtml(b.plan):batchEditor()}<div class="form-actions">${b.plan?`<button class="btn back-control" onclick="batchUI.plan=null;batchRender()"><svg class="back-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ui-back-arrow"></use></svg>返回修改</button>${b.kind==='enroll'?'<button class="btn" onclick="batchRecheckEnrollment()">重新校验全部</button>':''}<button id="batch-confirm" class="btn primary" ${batchHasErrors(b.plan)||b.enrollDirty?'disabled':''} onclick="batchCommit()">确认办理 ${b.plan.rows.length} 项</button>`:'<button class="btn primary" onclick="batchPreview()">预览并校验</button>'}</div></section>`}
function batchRender(){if(state.page!=='batchFlow')nav('batchFlow');else render()}

function batchHasErrors(plan){return plan.errors.length||plan.rows.some(r=>r.errors.length)}
function batchPreviewHtml(plan){if(batchUI?.kind==='enroll')return batchEnrollmentPreviewHtml(plan);return `${plan.errors.map(x=>`<p class="notice">${esc(x)}</p>`).join('')}${aTable(['对象','办理内容 / 金额','校验结果'],plan.rows.map(r=>`<tr><td>${esc(r.label)}</td><td>${esc(r.detail)}</td><td>${r.errors.length?r.errors.map(esc).join('<br>'):'<span class="badge">可办理</span>'}</td></tr>`))}<p class="help">${batchHasErrors(plan)?'请返回修正错误；当前批次不会部分提交。':'确认时会再次校验数据与报价，全部通过后一次保存。'}</p>`}
function batchEnrollmentRequests(draft,ids){return [...new Set(ids)].map(key=>{const patch=draft.enrollOverrides?.[key]||{},studentId=patch.studentId??key,classId=patch.classId??draft.targetId,student=a.students.find(s=>s.id===studentId),target=a.classes.find(c=>c.id===classId);return {key,studentId,classId,student,target,phone:String(Object.hasOwn(patch,'phone')?patch.phone:student?.phone||'').trim()}})}
function batchEnrollmentTargets(draft,ids){return [...new Set(batchEnrollmentRequests(draft,ids).map(x=>x.target).filter(Boolean))]}
function batchEnrollmentPending(c){return a.orders.filter(o=>o.classId===c.id&&o.paymentState==='待支付'&&!workflowOrderClosed(o)).length}
function batchEnrollmentDuplicate(s,c){return batchRoster(c,s)||a.orders.some(o=>o.studentId===s.id&&o.classId===c.id&&!workflowOrderClosed(o))}
function batchEnrollmentConflicts(s,c){return a.classes.some(other=>other.id!==c.id&&workflowSessionRoster(other).some(x=>x.id===s.id)&&batchOverlap(other,c))}
function batchEnrollmentPlan(draft,ids){
 const requests=batchEnrollmentRequests(draft,ids),plan={errors:[],rows:[]};if(!requests.length||requests.length>500)plan.errors.push('请选择 1–500 项');
 plan.rows=requests.map(r=>{
  const {student:s,target:c}=r,errors=[];let course=null,quote=null;
  if(!s)errors.push('学生已移除，请在本行重新选择');else if(!r.phone)errors.push('学生联系电话缺失，请在本行补齐');
  if(!c)errors.push('请选择本行报名班级');else{
   course=batchCourse(c);if(!batchValidTime(c)||['已结课','已取消'].includes(c.status))errors.push('班级已结束或排课时间无效，请更换班级');
   if(typeof sysRules!=='undefined'&&!sysRules.entry.allowMidCourse&&!sysFirstLesson(c))errors.push('当前配置不允许中途插班，请选择首讲班级');
   const reserved=requests.filter(x=>x.target?.id===c.id).length,pending=batchEnrollmentPending(c),capacity=Number(c.capacity);
   if(!Number.isInteger(capacity)||batchOccupied(c)+pending+reserved>capacity)errors.push(`班级容量不足：现有 ${batchOccupied(c)}、待支付 ${pending}、本批 ${reserved}，上限 ${c.capacity}`);
   if(s){if(batchEnrollmentDuplicate(s,c))errors.push('已有本班名单或未关闭订单，请改选学生或班级');if(batchEnrollmentConflicts(s,c))errors.push('与学生其他课次时间冲突，请更换班级');quote=batchPrice(s,c);if(!course||course.active===false||!Number.isFinite(quote.base)||quote.base<0||!Number.isFinite(quote.total)||quote.total<0)errors.push('课程价格未正确配置，请更换课程或修正课程价格')}
  }
  const others=requests.filter(x=>x.key!==r.key&&x.studentId===r.studentId);
  if(others.some(x=>x.classId===r.classId))errors.push('本批重复选择了同一学生与班级');
  if(c&&others.some(x=>x.target&&x.classId!==r.classId&&batchOverlap(x.target,c)))errors.push('本批为该学生选择的班级时间冲突');
  if(others.some(x=>x.phone!==r.phone))errors.push('本批同一学生的联系电话不一致');
  const phoneUpdate=s&&r.phone!==String(s.phone||'').trim()?{before:s.phone||'',after:r.phone}:null;
  return {key:r.key,label:s?.name||String(r.studentId),detail:c?`${c.name} · ${quote&&Number.isFinite(quote.total)?'应付 ¥'+quote.total.toFixed(2):'报价待配置'} · ${quote?.offerName||'无适用优惠'}`:'未选报名班级',errors,data:{studentId:r.studentId,classId:r.classId,courseId:course?.id,quote,lessons:(course?.lessons||[]).map(x=>({id:x.id,title:x.title})),phoneUpdate}};
 });return plan;
}
function batchEnrollmentSuggestions(row){
 const b=batchUI,request=batchEnrollmentRequests(b.draft,b.ids).find(x=>x.key===row.key);if(!request?.student)return [];
 const selectedCourse=batchCourse(request.target)||batchCourse(a.classes.find(c=>c.id===b.draft.targetId)),others=batchEnrollmentRequests(b.draft,b.ids).filter(x=>x.key!==row.key),s=request.student;
 return a.classes.filter(c=>{
  const course=batchCourse(c);if(c.id===request.classId||!course||course.active===false||selectedCourse&&course.id!==selectedCourse.id||!batchValidTime(c)||['已结课','已取消'].includes(c.status))return false;
  if(typeof sysRules!=='undefined'&&(!sysRules.entry.enabled||!sysRules.entry.allowMidCourse&&!sysFirstLesson(c)))return false;
  if(batchEnrollmentDuplicate(s,c)||batchEnrollmentConflicts(s,c)||others.some(x=>x.studentId===s.id&&x.target&&(x.classId===c.id||batchOverlap(x.target,c))))return false;
  const needed=1+others.filter(x=>x.classId===c.id).length,quote=batchPrice(s,c);return batchOccupied(c)+batchEnrollmentPending(c)+needed<=Number(c.capacity)&&Number.isFinite(quote.base)&&quote.base>=0&&Number.isFinite(quote.total)&&quote.total>=0;
 }).sort((x,y)=>Number(y.campus===request.target?.campus)-Number(x.campus===request.target?.campus)).slice(0,3);
}
function batchEnrollmentEdit(key,field,value,recheck=true){
 if(!batchUI||batchUI.kind!=='enroll'||!batchAllowed('enroll')){toast('当前身份无批量报名权限');return}
 if(!batchUI.ids.includes(key)||!['studentId','classId','phone'].includes(field))return;
 const d=batchUI.draft;d.enrollOverrides=d.enrollOverrides||{};const patch=d.enrollOverrides[key]=d.enrollOverrides[key]||{};if(field==='studentId'&&patch.studentId!==value)delete patch.phone;patch[field]=String(value);
 batchUI.enrollDirty=true;batchUI.signature=null;const confirm=$('#batch-confirm');if(confirm)confirm.disabled=true;const notice=$('#batch-validation-state');if(notice)notice.textContent='本行已修改，请重新校验后确认';if(recheck)batchRecheckEnrollment();
}
function batchRecheckEnrollment(){if(!batchUI||batchUI.kind!=='enroll'||!batchAllowed('enroll')){toast('当前身份无批量报名权限');return}batchUI.plan=batchPlan('enroll',batchUI.draft,batchUI.ids);batchUI.signature=JSON.stringify(batchUI.plan);batchUI.enrollDirty=false;batchRender()}
function batchRemoveEnrollmentRow(key){if(!batchUI||batchUI.kind!=='enroll'||!batchAllowed('enroll')||!batchUI.ids.includes(key))return;batchUI.excludedIds=[...new Set([...(batchUI.excludedIds||[]),key])];batchUI.ids=batchUI.ids.filter(x=>x!==key);batchRecheckEnrollment()}
function batchRestoreEnrollmentRow(key){if(!batchUI||batchUI.kind!=='enroll'||!batchAllowed('enroll')||!(batchUI.excludedIds||[]).includes(key))return;batchUI.ids=[...new Set([...batchUI.ids,key])];batchUI.excludedIds=batchUI.excludedIds.filter(x=>x!==key);batchRecheckEnrollment()}
function batchEnrollmentPreviewHtml(plan){
 const requests=batchEnrollmentRequests(batchUI.draft,batchUI.ids),cell=(row)=>{
  const r=requests.find(x=>x.key===row.key),key=esc(JSON.stringify(row.key)),options=items=>items.map(([value,label,selected])=>`<option value="${esc(value)}" ${selected?'selected':''}>${esc(label)}</option>`).join('');
  const suggestions=row.errors.length?batchEnrollmentSuggestions(row):[];
  return `<tr class="batch-enrollment-row ${row.errors.length?'has-errors':''}"><td><label class="batch-row-label">学生</label><select class="select" aria-label="${esc(row.label)}的报名学生" onchange="batchEnrollmentEdit(${key},'studentId',this.value)"><option value="">请选择学生</option>${options(a.students.map(s=>[s.id,s.name+' · '+(s.phone||'未填电话'),s.id===r.studentId]))}</select><label class="batch-row-label">联系电话</label><input class="input" aria-label="${esc(row.label)}的联系电话" value="${esc(r.phone)}" placeholder="补齐联系电话" oninput="batchEnrollmentEdit(${key},'phone',this.value,false)" onchange="batchRecheckEnrollment()">${row.data.phoneUpdate?'<small class="batch-staged-note">确认本批时同步学生档案</small>':''}</td><td><label class="batch-row-label">报名班级</label><select class="select" aria-label="${esc(row.label)}的报名班级" onchange="batchEnrollmentEdit(${key},'classId',this.value)"><option value="">请选择班级</option>${options(a.classes.map(c=>[c.id,c.name+' · '+c.campus+' · '+c.date+' '+c.time,c.id===r.classId]))}</select><div class="batch-row-quote">${esc(row.detail)}</div>${suggestions.length?`<div class="batch-suggestions"><span>可选同课程班级</span>${suggestions.map(c=>`<button class="btn small" onclick="batchEnrollmentEdit(${key},'classId',${esc(JSON.stringify(c.id))})">改选 ${esc(c.name)}</button>`).join('')}</div>`:''}</td><td>${row.errors.length?`<ul class="batch-row-errors">${row.errors.map(e=>`<li>${esc(e)}</li>`).join('')}</ul>`:'<span class="badge">可办理</span>'}</td><td><div class="batch-row-actions"><button class="btn small" onclick="batchRecheckEnrollment()">重新校验</button><button class="btn small" onclick="batchRemoveEnrollmentRow(${key})">移出本次</button></div></td></tr>`;
 };
 const removed=(batchUI.excludedIds||[]).filter(key=>!batchUI.ids.includes(key));
 return `${plan.errors.map(e=>`<p class="notice">${esc(e)}</p>`).join('')}<p class="help" id="batch-validation-state" role="status">可逐行修改并重新校验；确认本批后才会同步档案、创建待支付订单。</p><div class="batch-enrollment-preview">${aTable(['学生 / 联系方式','报名班级 / 报价','校验结果','处理'],plan.rows.map(cell))}</div>${removed.length?`<div class="batch-removed"><span>已移出本次（档案保留）</span>${removed.map(key=>`<button class="btn small" onclick="batchRestoreEnrollmentRow(${esc(JSON.stringify(key))})">恢复 ${esc(a.students.find(s=>s.id===(batchUI.draft.enrollOverrides?.[key]?.studentId||key))?.name||key)}</button>`).join('')}</div>`:''}`;
}
function batchCourse(c){return a.courses.find(x=>x.id===c?.courseId||x.name===c?.course)}
function batchOccupied(c){return Math.max(Number(c.students)||0,a.students.filter(s=>batchRoster(c,s)).length)}
function batchValidTime(c){const m=String(c.time).match(/^(\d{2}):(\d{2})[–—-](\d{2}):(\d{2})$/);if(!m||+m[1]>23||+m[3]>23||+m[2]>59||+m[4]>59||!/^\d{4}-\d{2}-\d{2}$/.test(c.date))return false;const d=new Date(c.date+'T12:00:00');return !isNaN(d)&&d.getFullYear()===+c.date.slice(0,4)&&d.getMonth()+1===+c.date.slice(5,7)&&d.getDate()===+c.date.slice(8,10)&&scTimeParts(c).end>scTimeParts(c).start}
function batchOverlap(c,d){const x=scTimeParts(c),y=scTimeParts(d);return scOverlap(x,y)}
function batchTeacherConflict(c,d){if(!batchOverlap(c,d))return false;const serving=(x,teacher)=>x.teacher===teacher||(x.sessions||[]).some(s=>s.date===x.date&&s.substitute===teacher&&(!s.sessionId||s.sessionId===workflowSessionKey(x)));return serving(c,d.teacher)||serving(d,c.teacher)}
function batchPrice(student,c){const old=[a.selectedStudent,a.selectedClass,a.enrollmentDraft];try{a.selectedStudent=a.students.indexOf(student);a.selectedClass=a.classes.indexOf(c);a.enrollmentDraft=null;const q=workflowBuildQuote();return {base:q.price,discount:q.discount,total:q.total,offerId:q.offer?.id||null,offerName:q.offer?.name||'',offerVersion:q.offer?.version||null}}finally{[a.selectedStudent,a.selectedClass,a.enrollmentDraft]=old}}
function batchPlan(kind,draft,ids){
 const plan={errors:[],rows:[]};if(!batchAllowed(kind)){plan.errors.push('当前身份无此操作权限');return plan}
 if(kind==='enroll')return batchEnrollmentPlan(draft,ids);
 if(kind==='create'){
  if(!draft.rows.length||draft.rows.length>100)plan.errors.push('请先生成 1–100 行班级');
  const candidates=draft.rows.map(r=>{const course=a.courses.find(x=>x.id===r.courseId);return {...r,campus:draft.campus,capacity:Number(r.capacity),course:course?.name,courseId:course?.id,lessonId:course?.lessons?.[0]?.id||`${course?.id}-PENDING-1`,lessonVersion:course?.product?.version||1}});
  plan.rows=candidates.map((c,i)=>{const errors=[];if(!c.name.trim()||!c.teacher.trim()||!c.room.trim())errors.push('班名、老师、教室必填');if(!state.campuses.some(x=>x.active&&x.name===c.campus))errors.push('请选择有效校区');if(!a.courses.some(x=>x.active&&x.id===c.courseId))errors.push('课程不存在或已停用');if(!Number.isInteger(c.capacity)||c.capacity<1)errors.push('容量须为正整数');if(!batchValidTime(c))errors.push('日期或时段无效，请用 09:00–11:00');const others=[...a.classes,...candidates.filter((_,j)=>j!==i)];if(others.some(x=>x.name.trim()===c.name.trim()))errors.push('班名重复');if(others.some(x=>batchOverlap(c,x)&&(batchTeacherConflict(c,x)||x.campus===c.campus&&x.room===c.room)))errors.push('老师或教室时段冲突');return {label:c.name,detail:`${c.campus} ${c.room} · ${c.date} ${c.time}`,errors,data:c}});return plan;
 }
 const selected=[...new Set(ids)],target=a.classes.find(c=>c.id===draft.targetId),source=a.classes.find(c=>c.id===draft.sourceId);
 if(!selected.length||selected.length>500)plan.errors.push('请选择 1–500 项');
 if(kind==='campus'){
  if(!state.campuses.some(c=>c.active&&c.name===draft.campus))plan.errors.push('请选择有效目标校区');
  const moved=selected.map(id=>{const c=a.classes.find(x=>x.id===id);return c?{...c,campus:draft.campus,room:String(draft['room:'+id]||'').trim()}:null});
  plan.rows=selected.map((id,i)=>{const old=a.classes.find(c=>c.id===id),next=moved[i],errors=[];if(!old)return {label:id,detail:'班级不存在',errors:['班级已移除']};if(!next.room)errors.push('请填写目标教室');if(!batchValidTime(next))errors.push('原班排课时间无效，请先修正');if(old.campus===next.campus&&old.room===next.room)errors.push('校区与教室均未变化');const others=[...a.classes.filter(c=>!selected.includes(c.id)),...moved.filter((c,j)=>c&&i!==j)];if(others.some(c=>batchOverlap(next,c)&&(batchTeacherConflict(next,c)||c.campus===next.campus&&c.room===next.room)))errors.push('目标老师或教室有排课冲突');return {label:old.name,detail:`${old.campus}/${old.room} → ${next.campus}/${next.room}`,errors,data:{classId:id,campus:next.campus,room:next.room,fromCampus:old.campus,fromRoom:old.room}}});return plan;
 }
 if(!target)plan.errors.push('请选择目标班级');else if(!batchValidTime(target)||['已结课','已取消'].includes(target.status))plan.errors.push('目标班已结束或排课时间无效');
 if(kind==='transfer'){
  if(!source||source===target)plan.errors.push('请选择不同的原班与目标班');
  if(source&&target&&(source.courseId!==target.courseId||!source.courseId||source.lessonVersion!==target.lessonVersion||!source.lessonId||source.lessonId!==target.lessonId))plan.errors.push('原班与目标班必须为同课程、同版本、同讲次');
 }
 if(target){const pending=a.orders.filter(o=>o.classId===target.id&&o.paymentState==='待支付'&&o.entitlementState!=='已退课').length;if(batchOccupied(target)+pending+selected.length>target.capacity)plan.errors.push(`目标班容量不足：当前 ${batchOccupied(target)} 人，待支付 ${pending} 人，上限 ${target.capacity}`)}
 plan.rows=selected.map(id=>{const s=a.students.find(x=>x.id===id),errors=[];if(!s)return {label:id,detail:'学生不存在',errors:['学生已移除']};if(!target)return {label:s.name,detail:'未选目标班',errors:['目标班缺失']};if(batchRoster(target,s)||a.orders.some(o=>o.studentId===id&&o.classId===target.id&&o.entitlementState!=='已退课'))errors.push('已有目标班名单或未关闭订单');if(a.classes.some(c=>c.id!==source?.id&&c.id!==target.id&&batchRoster(c,s)&&batchOverlap(c,target)))errors.push('学生与其他班级上课时间冲突');
  if(!batchRoster(source,s))errors.push('学生不在原班');
  const orders=a.orders.filter(o=>o.studentId===id&&o.classId===source?.id&&o.entitlementState!=='已退课');if(orders.length>1)errors.push('原班存在多笔未关闭订单，需先核对');
  if((a.sessionAdjustments||[]).some(x=>x.studentId===id&&x.status==='已确认'&&x.date>=batchToday()&&[x.sourceClassId,x.targetClassId].includes(source?.id)))errors.push('存在尚未结束的临时调班，请先处理');
  return {label:s.name,detail:`${source?.name||'未选原班'} → ${target.name}${orders.length?'；保留原价与已消课':'；仅迁移名册，未关联财务订单'}`,errors,data:{studentId:id,sourceId:source?.id,targetId:target.id,orderId:orders[0]?.id||null,effectiveDate:batchToday()}};
 });return plan;
}
function batchPreview(){batchCapture();batchUI.plan=batchPlan(batchUI.kind,batchUI.draft,batchUI.ids);batchUI.signature=JSON.stringify(batchUI.plan);batchUI.enrollDirty=false;batchRender()}
function batchSavePayload(){return {courses:a.courses,classes:a.classes,students:a.students,attendance:a.attendance,orders:a.orders,refunds:a.refunds||[],sessionAdjustments:a.sessionAdjustments||[],batchLogs:a.batchLogs||[],shelved:mallState.shelved,leads:leadState.leads,offers:mallState.activities.coupon}}
function batchExecute(kind,draft,ids,token,signature){
 if((a.batchLogs||[]).some(x=>x.id===token))throw Error('该批次已办理，请勿重复提交');
 const plan=batchPlan(kind,draft,ids);if(batchHasErrors(plan))throw Error('数据校验未通过，请重新预览');if(JSON.stringify(plan)!==signature)throw Error('数据或优惠已变化，请重新预览');
 const keys=['classes','students','attendance','orders','batchLogs'],before=Object.fromEntries(keys.map(k=>[k,JSON.parse(JSON.stringify(a[k]||[]))]));
 try{
  plan.rows.forEach((row,i)=>{const d=row.data;
   if(kind==='create'){a.classes.push({...d,id:`${token}-C${i}`,students:0,studentIds:[],status:'未开课',sessions:[]});return}
   if(kind==='campus'){const c=a.classes.find(x=>x.id===d.classId),ci=a.classes.indexOf(c);a.attendance.filter(r=>r.classIndex===ci).forEach(r=>{r.campusSnapshot=r.campusSnapshot||c.campus;r.roomSnapshot=r.roomSnapshot||c.room});c.campus=d.campus;c.room=d.room;c.locationHistory=[...(c.locationHistory||[]),{...d,batchId:token,at:new Date().toISOString()}];return}
   const s=a.students.find(x=>x.id===d.studentId);
   if(kind==='enroll'){const c=a.classes.find(x=>x.id===d.classId);if(d.phoneUpdate)s.phone=d.phoneUpdate.after;a.orders.push({id:`${token}-O${i}`,batchId:token,studentId:s.id,student:s.name,originLeadId:s.originLeadId||null,classId:c.id,courseId:d.courseId,product:c.course,quoteSnapshot:d.quote,lessonSnapshot:d.lessons,amount:`¥${d.quote.total.toFixed(2)}`,paid:'¥0.00',status:'等待付款',paymentState:'待支付',entitlementState:'未生效'});s.enrollmentStatus='待支付';return}
   const from=a.classes.find(c=>c.id===d.sourceId),to=a.classes.find(c=>c.id===d.targetId),fi=a.classes.indexOf(from),ti=a.classes.indexOf(to),si=a.students.indexOf(s);
   a.attendance.filter(r=>r.classIndex===fi&&r.studentIndex===si).forEach(r=>{if(d.orderId&&!r.orderId)r.orderId=d.orderId;if(r.date>=d.effectiveDate&&!r.consumptionConfirmed&&r.status==='未考勤'){r.previousStatus=r.attendance;r.attendance='转班后撤销';r.status='已撤销';r.batchId=token}});
   const oldCount=batchOccupied(from);from.studentIds=(from.studentIds||[]).filter(id=>id!==s.id);from.students=Math.max(0,oldCount-1);to.students=batchOccupied(to)+1;to.studentIds=[...new Set([...(to.studentIds||[]),s.id])];s.classIds=[...new Set([...(s.classIds||[]).filter(id=>id!==from.id),to.id])];if(s.className===from.name)s.className=to.name;
   const order=a.orders.find(o=>o.id===d.orderId);if(order){order.originalClassId=order.originalClassId||from.id;order.classId=to.id;order.transferHistory=[...(order.transferHistory||[]),{...d,batchId:token}]}
   if(to.date>=d.effectiveDate&&!a.attendance.some(r=>r.classIndex===ti&&r.studentIndex===si&&r.date===to.date&&r.status!=='已撤销'))a.attendance.push({classIndex:ti,studentIndex:si,studentId:s.id,sessionId:workflowSessionKey(to),session:to.lessonId,date:to.date,time:to.time,status:'未考勤',attendance:'未考勤',orderId:d.orderId,batchId:token});
  });
  a.batchLogs=a.batchLogs||[];a.batchLogs.push({id:token,kind,title:batchNames[kind],at:new Date().toISOString(),actor:workflowActor(),count:plan.rows.length,details:plan.rows.map(r=>({label:r.label,...r.data}))});
  localStorage.setItem('siyue-workflow-demo-v2',JSON.stringify(batchSavePayload()));
 }catch(error){keys.forEach(k=>a[k]=before[k]);throw error}
 return plan.rows.length;
}
function batchCommit(){if(!batchUI||!batchUI.plan)return;const b=batchUI;if(!batchAllowed(b.kind)){toast('当前身份无此批量办理权限');return}if(b.kind==='enroll'&&b.enrollDirty){batchRecheckEnrollment();toast('修改已重新校验，请核对报价后确认');return}try{const n=batchExecute(b.kind,b.draft,b.ids,b.token,b.signature);document.querySelector('#batch-modal')?.remove();batchUI=null;nav(b.kind==='enroll'?'orders':'classes');toast(`${batchNames[b.kind]}完成，共 ${n} 项`)}catch(e){toast(e.message);b.plan=batchPlan(b.kind,b.draft,b.ids);b.signature=JSON.stringify(b.plan);b.enrollDirty=false;batchRender()}}
// Carry old confirmed consumption forward when fulfillment moves to another class.
const batchOriginalRefundEstimate=workflowRefundEstimate;
workflowRefundEstimate=function(si,ci){const result=batchOriginalRefundEstimate(si,ci);if(!result.order?.transferHistory?.length)return result;const rows=a.attendance.filter(r=>r.studentIndex===si&&r.consumptionConfirmed===true&&(r.orderId===result.order.id||r.classIndex===ci&&!r.orderId));result.consumed=new Set(rows.map(r=>r.sessionId||`${r.classIndex}|${r.date}|${r.session}`)).size;result.refund=result.total?Math.max(0,Math.round((result.paid-result.unit*result.consumed)*100)/100):0;result.ready=!!result.order&&result.total>0&&result.consumed<=result.total;return result};
const batchClassesPage=classesPage;
classesPage=function(){let html=batchClassesPage().replace(/onclick="toast\('批量建班规则待确认'\)"/g,'onclick="batchOpen(\'create\')"');if(batchAllowed('transfer'))html=html.replace('</div><span class="count">','<button class="btn" onclick="batchOpen(\'transfer\')">批量学生转班</button><button class="btn" onclick="batchOpen(\'campus\')">批量班级转校区</button></div><span class="count">');return html};
const batchStudentsPage=studentsPage;
studentsPage=function(){let html=batchStudentsPage();if(batchAllowed('enroll'))html=html.replace('<div class="toolbar-left">','<div class="toolbar-left"><button class="btn" onclick="batchOpen(\'enroll\')">批量报名</button>');if(batchAllowed('transfer'))html=html.replace('<div class="toolbar-left">','<div class="toolbar-left"><button class="btn" onclick="batchOpen(\'transfer\')">批量转班</button>');return html};
// Reuse the existing enrollment tab instead of adding a duplicate action.
enrollTab=function(t){if(t==='批量报名')batchOpen('enroll')};
[['create','classes','classes','批量创建班级 批量建班'],['enroll','enroll','enroll','批量报名 批量报课'],['transfer','transfer','transfer','批量转移班级 批量转班 批量学生转班 整班学生转班'],['campus','classes','classes','批量班级转校区 批量转校区 批量搬迁班级']].forEach(([kind,page,guard,aliases])=>commandWorkflows.unshift({label:batchNames[kind],words:aliases.split(' '),page,guard,run:()=>batchOpen(kind),hint:'批量选择 → 预览校验 → 确认办理'}));
