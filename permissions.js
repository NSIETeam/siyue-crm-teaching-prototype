// 员工权限原型。真实系统仍需服务端鉴权与持久化；此处演示职位授权、回显和访问体验。
const permissionGroups=[
  {id:'workspace',name:'登记与报名',items:[['quickRegister','线索登记'],['quickEnroll','报名']]},
  {id:'leads',name:'线索',items:[['leadTodo','今日待办'],['myLeads','我的线索'],['leadManage','线索管理']]},
  {id:'academic',name:'教务',items:[['course','课程管理'],['classes','班级管理'],['students','学生管理'],['attendance','考勤'],['makeup','补课'],['schedule','课表'],['enroll','报名'],['tempMove','临时调班'],['transfer','转课／班'],['withdraw','退课／退班'],['supplement','补费']]},
  {id:'learning',name:'教学',items:[['learningActive','在读学生'],['learningHistory','历史学生'],['learningData','数据管理']]},
  {id:'mall',name:'商城工具',items:[['mallDecor','商城装修'],['mallShelf','课程上架'],['mallGroup','拼团'],['mallJoint','联报'],['mallCoupon','优惠券'],['marketingForms','表单']]},
  {id:'finance',name:'财务中心',items:[['orders','收费订单'],['financeRefunds','退转记录'],['financeArrears','欠费记录'],['financeConsumption','课消记录'],['financeReceipts','收款设置']]},
  {id:'settings',name:'基础设置',items:[['system','系统配置'],['campus','校区配置'],['teaching','教学配置'],['staff','员工列表'],['positions','职位管理'],['permissions','权限管理'],['permissionLogs','权限变更日志']]}
];
const permissionAll=permissionGroups.flatMap(g=>g.items.map(x=>x[0]));
const permissionState={identity:'admin',roles:[
  {id:'finance',name:'财务岗',active:true,grants:['orders','financeRefunds','financeArrears','financeConsumption','financeReceipts']},
  {id:'sales',name:'招生综合岗',active:true,grants:['quickRegister','quickEnroll','leadTodo','myLeads','leadManage','enroll']},
  {id:'manager',name:'业务岗负责人',active:true,grants:['leadTodo','myLeads','learningActive','learningHistory','staff','permissions']}
],selected:'finance',working:new Set(),dirty:false,logs:[],positionMode:null,positionEdit:null,modal:null,pendingPage:null,pendingRole:null,pendingIdentity:null,currentPage:state.page};
// Persist only this browser prototype's account/authorization records. This is not server authentication.
const permissionStorageKey='siyue-permissions-v1';
let permissionHydrated=false;
try{const saved=JSON.parse(localStorage.getItem(permissionStorageKey));if(saved&&Array.isArray(saved.roles)&&saved.roles.every(r=>r&&typeof r.id==='string'&&Array.isArray(r.grants))&&Array.isArray(saved.staff)){permissionState.roles=saved.roles;permissionState.logs=Array.isArray(saved.logs)?saved.logs:[];state.staff=saved.staff;permissionHydrated=true}}catch{}
function permissionPersist(){try{localStorage.setItem(permissionStorageKey,JSON.stringify({roles:permissionState.roles,logs:permissionState.logs,staff:state.staff}));return true}catch{toast('保存失败：浏览器本地存储空间不足');return false}}
if(!permissionHydrated){state.staff[0].roleId='manager';state.staff[1].roleId='sales';state.staff.push(...[['孙倩','sunqian','城东校区',27,11],['李强','liqiang','城西校区',24,9],['赵磊','zhaolei','滨江校区',19,6],['陈静','chenjing','滨江校区',16,14],['周婷','zhouting','城西校区',13,4]].map(([name,account,campus,conversionRate,pendingLeads])=>({name,account,phone:'138****0000',gender:'女',campus,roleId:'sales',active:true,conversionRate,pendingLeads})))}
permissionState.working=new Set(permissionState.roles.find(r=>r.id===permissionState.selected)?.grants||[]);
const permissionPreviousRender=render;
render=function(){
  if(permissionState.currentPage==='permissions'&&permissionState.dirty&&state.page!=='permissions'){
    permissionState.pendingPage=state.page;state.page='permissions';permissionState.modal='unsaved';permissionRender();return;
  }
  if(!permissionCanVisit(state.page)){permissionDenied(state.page);return}
  permissionState.currentPage=state.page;
  if(['positions','permissions','permissionLogs'].includes(state.page))permissionRender();
  else{permissionPreviousRender();permissionRefreshNavigation()}
};
staffPage=function(){return permissionStaffPage()};
staffForm=function(){return permissionStaffForm()};
saveStaff=function(){return permissionSaveStaff()};
function permissionRole(id=permissionState.identity){return permissionState.roles.find(r=>r.id===id)}
function permissionCanVisit(page){
  if(permissionState.identity==='admin')return true;
  const role=permissionRole();if(!role||!role.active)return false;
  const aliases={leadDetail:['leadTodo','myLeads','leadManage','quickRegister'],studentDetail:['students','learningActive','learningHistory'],courseForm:['course'],classForm:['classes'],mallForm:['mallGroup','mallJoint','mallCoupon'],marketingFormBuilder:['marketingForms'],marketingFormPreview:['marketingForms'],marketingFormSubmissions:['marketingForms']};
  if(aliases[page])return aliases[page].some(p=>role.grants.includes(p));
  return role.grants.includes(page);
}
for(const name of ['academicRender','leadRender','shortcutRender','mallRender','structureRender','marketingFormRender']){
  const original=globalThis[name];
  if(typeof original==='function')globalThis[name]=function(...args){if(!permissionCanVisit(state.page)){permissionDenied(state.page);return}const result=original(...args);permissionRefreshNavigation();return result};
}
function permissionDenied(page){
  state.page=page;permissionState.currentPage=page;
  $('#crumb').textContent='无权限';
  $('#view').innerHTML=`<div class="card pad permission-denied"><h2>无权限</h2><p class="muted">当前职位未获授权访问此页面。</p><button class="back-control btn" onclick="permissionGoHome()"><svg class="back-icon" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#ui-back-arrow"></use></svg><span>返回可访问页面</span></button></div>`;
  permissionRefreshNavigation();
}
function permissionGoHome(){const role=permissionRole();state.page=role?.grants.find(p=>p!=='permissions')||'system';render()}
function permissionChangeIdentity(id){
  if(id!=='admin'&&!permissionRole(id)?.active){toast('该职位未启用，无法切换演示身份');return}
  if(permissionState.dirty){permissionState.pendingIdentity=id;permissionState.modal='unsaved';const select=$('#demo-role');if(select)select.value=permissionState.identity;permissionRender();return}
  permissionState.identity=id;
  const select=$('#demo-role');if(select)select.value=id;
  if(!permissionCanVisit(state.page))state.page=permissionRole()?.grants[0]||'system';
  render();
}
function permissionToggleStaffActive(index){if(permissionState.identity!=='admin')return;const staff=state.staff[index];if(!staff)return;staff.active=!staff.active;if(!permissionPersist()){staff.active=!staff.active;return}render()}
function permissionRefreshNavigation(){
  document.querySelectorAll('.menu-item[data-page]').forEach(e=>{e.hidden=!permissionCanVisit(e.dataset.page)});
  document.querySelectorAll('.nav-toggle').forEach(e=>{const panel=document.getElementById(e.getAttribute('aria-controls'));if(panel)e.hidden=!panel.querySelector('.menu-item:not([hidden])')});
  const basic=['system','campus','teaching','staff','positions','permissions','permissionLogs'].includes(state.page),staffArea=['staff','positions','permissions','permissionLogs'].includes(state.page);
  document.querySelector('[data-nav-toggle="basicSettings"]').classList.toggle('active-parent',basic);
  document.querySelector('[data-nav-toggle="staffManage"]').classList.toggle('active-parent',staffArea);
  if(['system','campus','teaching'].includes(state.page))$('#crumb').textContent='基础设置 / '+({system:'系统配置',campus:'校区配置',teaching:'教学配置'})[state.page];
  if(state.page==='staff')$('#crumb').textContent='基础设置 / 员工管理 / 员工列表';
  const select=$('#demo-role');if(select){const current=permissionState.identity;select.innerHTML=`<option value="admin">主管理员</option>`+permissionState.roles.filter(r=>r.active).map(r=>`<option value="${r.id}">${esc(r.name)}${r.id==='manager'?'（只读）':''}</option>`).join('');select.value=current}
}
function permissionRender(){
  const p=state.page,active=p==='positions'||p==='permissions'||p==='permissionLogs'?p:'permissions';
  document.querySelectorAll('.menu-item').forEach(e=>e.classList.toggle('active',e.dataset.page===active));
  document.querySelectorAll('[data-nav-toggle]').forEach(e=>e.classList.remove('active-parent'));
  document.querySelector('[data-nav-toggle="basicSettings"]').classList.add('active-parent');
  document.querySelector('[data-nav-toggle="staffManage"]').classList.add('active-parent');
  $('#crumb').textContent='基础设置 / 员工管理 / '+({positions:'职位管理',permissions:'权限管理',permissionLogs:'操作日志'}[p]||'权限管理');
  $('#view').innerHTML=(p==='positions'?permissionPositionsPage():p==='permissionLogs'?permissionLogsPage():permissionConfigPage())+(permissionState.modal?permissionModalPage():'');
  permissionRefreshNavigation();permissionSyncParents();
}
function permissionRoleName(id){return permissionState.roles.find(r=>r.id===id)?.name||'未配置'}
function permissionPositionsPage(){
  if(permissionState.positionMode)return permissionPositionForm();
  return heading('职位管理','按职位统一配置权限；主管理员为系统内置角色')+`<div class="card pad"><div class="toolbar"><h2 class="section-title" style="margin:0">自定义职位</h2>${permissionState.identity==='admin'?'<button class="btn primary" onclick="permissionState.positionMode=\'new\';permissionRender()">+ 新增职位</button>':''}</div>${aTable(['职位名称','在职人数','状态','操作'],permissionState.roles.map((r,i)=>`<tr><td><strong>${esc(r.name)}</strong></td><td>${state.staff.filter(s=>s.active&&s.roleId===r.id).length}</td><td><span class="badge ${r.active?'':'off'}">${r.active?'已启用':'已停用'}</span></td><td><div class="actions">${permissionState.identity==='admin'?`<a onclick="permissionState.positionMode='edit';permissionState.positionEdit='${r.id}';permissionRender()">编辑</a><a onclick="permissionToggleRole('${r.id}')">${r.active?'停用':'启用'}</a>`:'<span class="muted">仅可查看</span>'}</div></td></tr>`))}<p class="help">停用前需先将该职位下的在职员工调整到其他职位。</p></div>`
}
function permissionPositionForm(){const r=permissionRole(permissionState.positionEdit),editing=permissionState.positionMode==='edit';return heading(editing?'编辑职位':'新增职位','职位名称在全部自定义职位中必须唯一')+`<div class="card pad"><div class="form-grid">${aField('职位名称',`<input id="permission-role-name" class="input" maxlength="30" placeholder="例如：财务岗" value="${esc(editing?r?.name:'')}">`,true)}</div><div class="form-actions"><button class="btn" onclick="permissionState.positionMode=null;permissionState.positionEdit=null;permissionRender()">取消</button><button class="btn primary" onclick="permissionSavePosition()">保存</button></div></div>`}
function permissionSavePosition(){if(permissionState.identity!=='admin'){toast('无配置权限');return}const name=$('#permission-role-name').value.trim();if(!name){toast('请输入职位名称');return}if(permissionState.roles.some(r=>r.name===name&&r.id!==permissionState.positionEdit)){toast('职位名称不能重复');return}const old=permissionState.positionMode==='edit'?permissionRole(permissionState.positionEdit):null,previous=old?.name;if(old)old.name=name;else permissionState.roles.push({id:'role'+Date.now(),name,active:true,grants:[]});if(!permissionPersist()){if(old)old.name=previous;else permissionState.roles.pop();return}permissionState.positionMode=null;permissionState.positionEdit=null;permissionRender();toast('职位已保存')}
function permissionToggleRole(id){if(permissionState.identity!=='admin')return;const r=permissionRole(id);if(r.active&&state.staff.some(s=>s.active&&s.roleId===id)){toast('请先转移该职位下的在职员工');return}r.active=!r.active;if(!permissionPersist()){r.active=!r.active;return}permissionRender();toast(r.active?'职位已启用':'职位已停用')}
function permissionStaffPage(){
  if(state.mode==='form')return permissionStaffForm();
  const admin=permissionState.identity==='admin';
  return heading('员工管理','为员工选择所属职位，权限自动按职位生效')+`<div class="card pad"><div class="toolbar"><div class="toolbar-left">${admin?'<button class="btn primary" onclick="state.mode=\'form\';state.staffEdit=null;render()">+ 创建员工</button>':'<span class="permission-readonly">员工资料仅可查看</span>'}</div><div class="toolbar-right">${admin?'<button class="btn" onclick="toast(\'导入模板待业务确认\')">导入员工</button><button class="btn" onclick="toast(\'导出功能待业务确认\')">导出</button>':''}</div></div><div class="filters"><input class="input" placeholder="搜索姓名、电话或职位" oninput="filterRows(this.value)"></div>${aTable(['姓名','联系电话','性别','所属校区','所属职位','状态','操作'],state.staff.map((s,i)=>`<tr><td>${esc(s.name)}</td><td>${esc(s.phone)}</td><td>${esc(s.gender)}</td><td>${esc(s.campus)}</td><td>${esc(permissionRoleName(s.roleId))}</td><td><span class="badge ${s.active?'':'off'}">${s.active?'已启用':'已禁用'}</span></td><td>${admin?`<div class="actions"><a onclick="state.staffEdit=${i};state.mode='form';render()">详情 / 编辑</a><a onclick="permissionToggleStaffActive(${i})">${s.active?'禁用':'启用'}</a></div>`:'<span class="muted">查看</span>'}</td></tr>`))}</div>`
}
function permissionStaffForm(){if(permissionState.identity!=='admin'){state.mode='list';return permissionStaffPage()}const s=state.staffEdit===null?null:state.staff[state.staffEdit],roles=permissionState.roles.filter(r=>r.active||r.id===s?.roleId);return heading(s?'编辑员工':'创建员工','一个员工账号选择一个所属职位')+`<div class="card pad"><h2 class="section-title">基本信息</h2><div class="form-grid">${aField('姓名',`<input class="input" id="staff-name" value="${esc(s?.name||'')}" placeholder="请输入姓名">`,true)}${aField('手机号（用于登录）',`<input class="input" id="staff-phone" value="${esc(s?.phone||'')}" placeholder="请输入手机号">`,true)}${aField('性别',`<select class="select" id="staff-gender"><option ${s?.gender==='男'?'selected':''}>男</option><option ${s?.gender==='女'?'selected':''}>女</option></select>`)}${aField('所属校区',aSelect('staff-campus',['城中校区','园区校区','新区校区'],'请选择校区'),true)}${aField('所属职位',`<select class="select" id="staff-role"><option value="">请选择职位</option>${roles.map(r=>`<option value="${r.id}" ${s?.roleId===r.id?'selected':''}>${esc(r.name)}${r.active?'':'（已停用）'}</option>`).join('')}</select>`,true,'员工权限由所属职位统一决定。')}</div><div class="form-actions"><button class="btn" onclick="state.mode='list';render()">取消</button><button class="btn primary" onclick="saveStaff()">${s?'保存':'创建'}</button></div></div>`}
function permissionSaveStaff(){if(permissionState.identity!=='admin'){toast('无配置权限');return}const name=$('#staff-name').value.trim(),phone=$('#staff-phone').value.trim(),roleId=$('#staff-role').value;if(!name||!phone||!roleId){toast('请填写姓名、手机号并选择职位');return}const role=permissionRole(roleId),old=state.staffEdit===null?null:state.staff[state.staffEdit];if(!role?.active&&old?.roleId!==roleId){toast('停用的职位不能挂载新员工');return}const s={name,phone,gender:$('#staff-gender').value,campus:$('#staff-campus').value||old?.campus||'城中校区',roleId,active:old?.active??true};const before=old?{...old}:null;if(old)state.staff[state.staffEdit]={...old,...s};else state.staff.push(s);if(!permissionPersist()){if(old)state.staff[state.staffEdit]=before;else state.staff.pop();return}state.mode='list';render();toast('员工信息已保存')}
function permissionConfigPage(){
  const readonly=permissionState.identity!=='admin',selected=permissionRole(permissionState.selected);if(!selected)return heading('权限管理','暂无自定义职位');
  return heading('权限管理'+(readonly?'（权限仅可查看）':''),'按职位配置模块与功能点权限')+`<div class="card pad"><div class="permission-role-bar"><label for="permission-position">选择职位</label><select id="permission-position" class="select" onchange="permissionChooseRole(this.value)">${permissionState.roles.map(r=>`<option value="${r.id}" ${r.id===selected.id?'selected':''}>${esc(r.name)}${r.active?'':'（已停用）'}</option>`).join('')}</select><span class="permission-dirty" ${permissionState.dirty?'':'hidden'}>有未保存的修改</span>${readonly?'<span class="permission-readonly">权限仅可查看</span>':''}</div><div class="permission-tree">${permissionGroups.map(g=>`<div class="permission-group"><h3><label><input type="checkbox" class="permission-parent" data-group="${g.id}" onchange="permissionToggleGroup('${g.id}',this.checked)" ${readonly?'disabled':''}>${g.name}</label></h3><div class="permission-children">${g.items.map(([key,name])=>`<label><input type="checkbox" class="permission-child" data-key="${key}" ${permissionState.working.has(key)?'checked':''} onchange="permissionToggleChild('${key}',this.checked)" ${readonly?'disabled':''}>${name}</label>`).join('')}</div></div>`).join('')}</div>${readonly?'':`<div class="form-actions"><button class="btn" onclick="permissionDiscard()">取消修改</button><button class="btn primary" onclick="permissionSave()">保存权限</button></div>`}</div>`;
}
function permissionSyncParents(){document.querySelectorAll('.permission-parent').forEach(input=>{const group=permissionGroups.find(g=>g.id===input.dataset.group),count=group.items.filter(([key])=>permissionState.working.has(key)).length;input.checked=count===group.items.length;input.indeterminate=count>0&&count<group.items.length})}
function permissionSyncChildren(){document.querySelectorAll('.permission-child').forEach(input=>input.checked=permissionState.working.has(input.dataset.key));permissionSyncParents()}
function permissionToggleGroup(id,checked){if(permissionState.identity!=='admin')return;const group=permissionGroups.find(g=>g.id===id);group.items.forEach(([key])=>checked?permissionState.working.add(key):permissionState.working.delete(key));permissionMarkDirty();permissionSyncChildren()}
function permissionToggleChild(key,checked){if(permissionState.identity!=='admin')return;checked?permissionState.working.add(key):permissionState.working.delete(key);permissionMarkDirty();permissionSyncParents()}
function permissionMarkDirty(){const saved=new Set(permissionRole(permissionState.selected).grants);permissionState.dirty=permissionState.working.size!==saved.size||[...permissionState.working].some(x=>!saved.has(x));const marker=document.querySelector('.permission-dirty');if(marker)marker.hidden=!permissionState.dirty}
function permissionChooseRole(id){if(permissionState.dirty){permissionState.pendingRole=id;permissionState.modal='unsaved';permissionRender();return}permissionLoadRole(id)}
function permissionLoadRole(id){permissionState.selected=id;permissionState.working=new Set(permissionRole(id).grants);permissionState.dirty=false;permissionState.modal=null;permissionRender()}
function permissionSave(){if(permissionState.identity!=='admin'){toast('无配置权限');return false}const role=permissionRole(permissionState.selected),oldGrants=[...role.grants],oldLogs=[...permissionState.logs],before=new Set(role.grants),after=new Set(permissionState.working),added=[...after].filter(x=>!before.has(x)),removed=[...before].filter(x=>!after.has(x));if(added.length||removed.length){permissionState.logs.unshift({actor:'admin',when:new Date().toLocaleString('zh-CN'),role:role.name,added,removed});role.grants=[...after]}if(!permissionPersist()){role.grants=oldGrants;permissionState.logs=oldLogs;permissionState.dirty=true;return false}permissionState.dirty=false;permissionRender();toast('职位权限保存成功');return true}
function permissionDiscard(){permissionLoadRole(permissionState.selected);toast('未保存的修改已取消')}
function permissionResolve(action){const role=permissionState.pendingRole,page=permissionState.pendingPage,identity=permissionState.pendingIdentity;if(action==='cancel'){permissionState.modal=null;permissionState.pendingRole=null;permissionState.pendingPage=null;permissionState.pendingIdentity=null;permissionRender();return}if(action==='save'&&!permissionSave()){permissionState.modal='unsaved';permissionRender();return}permissionState.modal=null;permissionState.pendingRole=null;permissionState.pendingPage=null;permissionState.pendingIdentity=null;if(action==='discard'){permissionState.working=new Set(permissionRole(permissionState.selected).grants);permissionState.dirty=false}if(role)permissionLoadRole(role);if(identity){permissionState.identity=identity;const select=$('#demo-role');if(select)select.value=identity;if(!permissionCanVisit(state.page))state.page=permissionRole()?.grants[0]||'system';permissionState.currentPage=null;render();return}if(page){state.page=page;permissionState.currentPage=null;render()}else if(!role)permissionRender()}
function permissionModalPage(){return `<div class="modal-backdrop"><div class="modal permission-modal"><div class="modal-head"><h2>有未保存的权限修改</h2></div><p>切换职位或离开页面前，是否保存当前修改？</p><div class="modal-actions"><button class="btn" onclick="permissionResolve('cancel')">继续编辑</button><button class="btn" onclick="permissionResolve('discard')">不保存</button><button class="btn primary" onclick="permissionResolve('save')">保存并继续</button></div></div></div>`}
function permissionLogsPage(){if(permissionState.identity!=='admin')return `<div class="card pad permission-denied"><h2>无权限</h2><p>仅主管理员可查看权限变更日志。</p></div>`;return heading('权限变更日志','记录权限保存时的操作人、时间、职位与勾选前后差异')+`<div class="card pad">${aTable(['操作时间','操作账号','目标职位','变更内容'],permissionState.logs.map(l=>`<tr><td>${esc(l.when)}</td><td>${esc(l.actor)}</td><td>${esc(l.role)}</td><td class="permission-log-diff">${l.added.length?'新增：'+esc(l.added.map(permissionLabel).join('、')):''}${l.added.length&&l.removed.length?'<br>':''}${l.removed.length?'移除：'+esc(l.removed.map(permissionLabel).join('、')):''}</td></tr>`))}<div class="data-bar">共 ${permissionState.logs.length} 条记录</div></div>`}
function permissionLabel(key){return permissionGroups.flatMap(g=>g.items).find(([id])=>id===key)?.[1]||key}
permissionRefreshNavigation();
