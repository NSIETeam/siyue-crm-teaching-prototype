'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../business-presenter.js'),'utf8');
function setup(data={},options={}){
 const sandbox={console,JSON,Set,Map,Array,Object,String,Number,Math,Date};
 sandbox.window=sandbox;
 let redraws=0;
 sandbox.businessAPI={redraw(){redraws++},search(){},reload(){},expand(){},showStudent(){},open(){},openRow(){}};
 vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(__dirname,'../page-layouts.js'),'utf8'),sandbox);vm.runInContext(source,sandbox,{filename:'business-presenter.js'});
 const ctx={page:'course',user:{permissions:['course.read']},data,operations:options.operations||[],expanded:null,query:'',
  html:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  human:(key,value)=>({active:'启用',inactive:'停用',leave:'请假',absent:'旷课',partial:'部分付款',cancelled:'已取消',小学四年级:'小学四年级',activeEnrollment:'在读'}[value]||String(value??'—')),
  nameOf(kind,id){const collection=kind==='courses'?data.courses:kind==='classes'?data.classes:kind==='campuses'?data.campuses:kind==='staff'?data.staff:[];return collection?.find(x=>x.id===id)?.name||''},
  dataRows(kind){return data[kind]||data.activities?.[kind]||[]},pageRows(kind){return this.dataRows(kind)},
  permitted:options.permitted||(()=>false),operationsFor(kind){return this.operations.filter(op=>({courses:'course',classes:'class',students:'student',campuses:'campus'}[kind]&&op.id.startsWith(({courses:'course',classes:'class',students:'student',campuses:'campus'}[kind])+'.')))},
  rowActions:options.rowActions||(()=>''),resultHtml:row=>`<pre>${String(row.name||'')}</pre>`,recordLabel:(kind,row)=>row.name||row.id};
 return {sandbox,ctx,get redraws(){return redraws},render(page='course'){ctx.page=page;return sandbox.SiyueBusinessPresenter.render(ctx)}};
}

const courseOps=[{id:'course.create',label:'创建课程'},{id:'course.update',label:'编辑课程'},{id:'class.create',label:'创建班级'}];
const campus='campus-a';
const dataset={courses:[
 {id:'c1',name:'语文春季班',grade:'小学四年级',subject:'语文',priceCents:120050,active:true,lessons:[{},{}]},
 {id:'c2',name:'数学秋季班',grade:'小学五年级',subject:'数学',priceCents:90000,active:false}
],classes:[{id:'cl1',name:'语文一班',courseId:'c1',campusId:campus,teacherId:'t1',capacity:20,status:'active',schedule:[{date:'2026-11-01',time:'09:00–10:30'}]}],campuses:[{id:campus,name:'城中校区'}],staff:[{id:'t1',name:'陈老师'}],students:[],enrollments:[],orders:[],attendance:[],consumptions:[]};

test('course tab filtering preserves original server row index for expand and row operations',()=>{
 const app=setup(dataset,{operations:courseOps,permitted:()=>true,rowActions:(kind,row,index)=>`<button data-row="${index}">${row.name}</button>`});
 let html=app.render();assert.match(html,/语文春季班/);assert.match(html,/1200\.50 元/);assert.match(html,/onchange="businessAPI\.search\(this\.value\)"/);assert.doesNotMatch(html,/oninput="businessAPI\.search/);
 app.sandbox.SiyueBusinessPresenter.tab('course','disabled');app.ctx.expanded='courses:1';html=app.render();
 assert.match(html,/数学秋季班/);assert.doesNotMatch(html,/语文春季班/);assert.match(html,/businessAPI\.expand\('courses',1\)/);
 assert.match(html,/businessAPI\.open\('class\.create',\{&quot;courseId&quot;:&quot;c2&quot;\}\)/);
 assert.equal(app.redraws,1);
});

test('courses without explicit active flag remain in enabled tab and class teacher uses authorized directory',()=>{
 const data={...dataset,courses:[{id:'legacy',name:'兼容课程',grade:'小学四年级',subject:'语文'}],directory:[{id:'t2',name:'授权老师'}],classes:[{id:'cl2',name:'兼容班级',courseId:'legacy',teacherId:'t2',status:'running'}]};
 const app=setup(data);app.sandbox.SiyueBusinessPresenter.tab('course','enabled');let html=app.render('course');assert.match(html,/兼容课程/);assert.match(html,/启用 1/);
 html=app.render('classes');assert.match(html,/授权老师/);assert.doesNotMatch(html,/t2/);
});

test('campus, grade, subject and status filters rerender without changing server data',()=>{
 const app=setup(dataset,{operations:courseOps,permitted:()=>true});app.sandbox.SiyueBusinessPresenter.filter('classes','campus','城中校区');
 app.ctx.page='classes';app.ctx.nameOf=(kind,id)=>kind==='campuses'&&id===campus?'城中校区':kind==='courses'&&id==='c1'?'语文春季班':kind==='staff'&&id==='t1'?'陈老师':'';
 let html=app.render('classes');assert.match(html,/语文一班/);assert.match(html,/09:00–10:30/);assert.match(html,/0 \/ 20/);assert.equal(app.redraws,1);
 app.sandbox.SiyueBusinessPresenter.filter('classes','status','closed');html=app.render('classes');assert.match(html,/暂无班级/);assert.doesNotMatch(html,/语文一班/);
});

test('students show only authorized rows and real active/history enrollment classifications',()=>{
 const data={...dataset,students:[{id:'s1',name:'在读学生',phone:'13800000001',grade:'小学四年级',campusId:campus},{id:'s2',name:'历史学生',phone:'13800000002'},{id:'s3',name:'未报名学生'}],enrollments:[{id:'e1',studentId:'s1',status:'active',classId:'cl1'},{id:'e2',studentId:'s1',status:'withdrawn',activatedAt:'2026-01-01'},{id:'e3',studentId:'s2',status:'withdrawn',activatedAt:'2026-02-01'},{id:'e4',studentId:'s3',status:'cancelled'}]};
 const app=setup(data,{operations:[{id:'student.create'}],permitted:()=>false});let html=app.render('students');
 assert.match(html,/在读学生/);assert.match(html,/历史学生/);assert.match(html,/未报名学生/);assert.doesNotMatch(html,/登记学生/);
 app.sandbox.SiyueBusinessPresenter.tab('students','history');html=app.render('students');assert.match(html,/<strong>历史学生<\/strong>/);assert.doesNotMatch(html,/<strong>在读学生<\/strong>/);assert.doesNotMatch(html,/<strong>未报名学生<\/strong>/);
 app.sandbox.SiyueBusinessPresenter.tab('students','all');app.sandbox.SiyueBusinessPresenter.filter('students','status','在读');html=app.render('students');assert.match(html,/<strong>在读学生<\/strong>/);assert.doesNotMatch(html,/<strong>历史学生<\/strong>/);
});

test('student detail renders only related projected records and refuses missing students',()=>{
 const data={...dataset,students:[{id:'s1',name:'档案学生',phone:'13800000001'}],enrollments:[{id:'e1',studentId:'s1',classId:'cl1',status:'active'}],orders:[{id:'o1',studentId:'s1',classId:'cl1',amountCents:120050,paidCents:50000,status:'partial'},{id:'o2',studentId:'s2',amountCents:999999}],attendance:[{id:'a1',studentId:'s1',classId:'cl1',date:'2026-10-01',status:'leave'}],consumptions:[{id:'c1',studentId:'s1',classId:'cl1',amountCents:10000,status:'confirmed'}]};
 const app=setup(data);app.ctx.studentId='s1';let html=app.render('studentDetail');assert.match(html,/档案学生/);assert.doesNotMatch(html,/1200\.50 元/);app.sandbox.SiyueBusinessPresenter.studentTab('s1','orders');html=app.render('studentDetail');assert.match(html,/1200\.50 元/);assert.match(html,/500\.00 元/);assert.doesNotMatch(html,/999999/);app.sandbox.SiyueBusinessPresenter.studentTab('s1','attendance');html=app.render('studentDetail');assert.match(html,/请假/);assert.match(html,/100\.00 元/);assert.doesNotMatch(html,/999999/);
 app.ctx.studentId='missing';html=app.render('studentDetail');assert.match(html,/无法查看此学生档案/);assert.doesNotMatch(html,/档案学生/);
});

test('empty lists are explicit and all user-controlled text is escaped',()=>{
 const app=setup({...dataset,courses:[{id:'x',name:'<img src=x onerror=alert(1)>',grade:'小学四年级',subject:'数学',active:true}]});
 let html=app.render('course');assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);assert.doesNotMatch(html,/<img src=x/);
 app.ctx.data.courses=[];html=app.render('course');assert.match(html,/暂无课程/);
});

test('view state resets without retaining business records',()=>{
 const app=setup(dataset);app.sandbox.SiyueBusinessPresenter.filter('course','subject','数学');let html=app.render('course');assert.doesNotMatch(html,/语文春季班/);app.sandbox.SiyueBusinessPresenter.reset();html=app.render('course');assert.match(html,/语文春季班/);
});


test('student profile uses the mature header and underline tabs with only the selected real-data panel',()=>{
 const data={...dataset,students:[{id:'profile-a',name:'甲同学',phone:'13800000001',grade:'小学四年级',campusId:campus,note:'需提前通知家长',createdAt:'2026-10-10T08:15:00.000Z'}],enrollments:[{id:'e1',studentId:'profile-a',classId:'cl1',status:'active'},{id:'e2',studentId:'profile-a',classId:'hidden-class',status:'withdrawn'}],orders:[{id:'PRIVATE_ORDER',reference:'收款2026-01',studentId:'profile-a',classId:'cl1',amountCents:12550,paidCents:10000,status:'partial'}],attendance:[{studentId:'profile-a',classId:'cl1',date:'2026-10-10',attendanceStatus:'leave',note:'病假'}],consumptions:[{studentId:'profile-a',classId:'cl1',amountCents:5000,status:'confirmed'}]};
 const before=structuredClone(data),app=setup(data);app.ctx.studentId='profile-a';let html=app.render('studentDetail');assert.match(html,/page-block/);assert.match(html,/profile-quick-fields/);assert.match(html,/tabs bp-profile-tabs/);assert.match(html,/基础档案/);assert.match(html,/在读班级/);assert.match(html,/报名订单/);assert.match(html,/考勤课消/);assert.match(html,/需提前通知家长/);assert.match(html,/2026-10-10 16:15/);assert.doesNotMatch(html,/病假|125\.50 元|PRIVATE_ORDER|账户余额|活动|测评/);
 const handler=html.match(/onclick="(SiyueBusinessPresenter\.studentTab\([^"]*?'classes'\))"/)?.[1];assert.ok(handler);vm.runInContext(handler.replace(/&quot;/g,'"'),app.sandbox);html=app.render('studentDetail');assert.match(html,/aria-labelledby="bp-profile-tab-classes"/);assert.match(html,/语文一班/);assert.doesNotMatch(html,/hidden-class|收款2026-01|病假/);
 app.sandbox.SiyueBusinessPresenter.studentTab('profile-a','orders');html=app.render('studentDetail');assert.match(html,/收款2026-01/);assert.match(html,/125\.50 元/);assert.match(html,/100\.00 元/);assert.doesNotMatch(html,/PRIVATE_ORDER|hidden-class|病假/);assert.match(html,/>—<\/td>/,'missing refunded amount is not made up as zero');
 app.sandbox.SiyueBusinessPresenter.studentTab('profile-a','attendance');html=app.render('studentDetail');assert.match(html,/病假/);assert.match(html,/50\.00 元/);assert.doesNotMatch(html,/收款2026-01/);assert.deepEqual(data,before);
 const css=fs.readFileSync(path.join(__dirname,'../business-presenter.css'),'utf8');assert.match(css,/transform-origin:center/);assert.match(css,/\.bp-profile-tabs \.tab\.active::after\{transform:scaleX\(1\)/);
});

test('student tabs are per stable student ID, reset on logout, and never retain old projected records',()=>{
 const data={...dataset,students:[{id:'s1',name:'学生甲'},{id:'s2',name:'学生乙'}],orders:[{studentId:'s1',amountCents:10000,reference:'甲订单'},{studentId:'s2',amountCents:20000,reference:'乙订单'}]},app=setup(data);app.ctx.studentId='s1';app.render('studentDetail');app.sandbox.SiyueBusinessPresenter.studentTab('s1','orders');assert.match(app.render('studentDetail'),/甲订单/);app.ctx.studentId='s2';let html=app.render('studentDetail');assert.match(html,/aria-labelledby="bp-profile-tab-profile"/);assert.doesNotMatch(html,/甲订单|乙订单/);app.sandbox.SiyueBusinessPresenter.studentTab('s2','orders');assert.match(app.render('studentDetail'),/乙订单/);app.ctx.studentId='s1';assert.match(app.render('studentDetail'),/甲订单/);data.orders=[];html=app.render('studentDetail');assert.match(html,/aria-labelledby="bp-profile-tab-profile"/);assert.doesNotMatch(html,/甲订单|乙订单|报名订单/);data.orders=[{studentId:'s1',reference:'新记录'}];app.sandbox.SiyueBusinessPresenter.reset();assert.doesNotMatch(app.render('studentDetail'),/新记录/);assert.equal(app.sandbox.SiyueBusinessPresenter.studentTab('s1','balance'),false);
});

test('student edit is independently authorized and scoped; original registrar access does not grant writes',()=>{
 const op={id:'student.update',permission:'student.update'},data={...dataset,students:[{id:'s1',name:'可读档案',ownerId:'someone-else',registrarId:'me',createdBy:'me',campusId:'other-campus'}]},app=setup(data,{operations:[op],permitted:()=>true});app.ctx.studentId='s1';app.ctx.user={id:'me',permissions:['student.read','student.create'],scope:{type:'all'}};assert.doesNotMatch(app.render('studentDetail'),/编辑档案/);app.ctx.user.permissions.push('student.update');assert.match(app.render('studentDetail'),/编辑档案/);app.ctx.user.scope={type:'own'};assert.doesNotMatch(app.render('studentDetail'),/编辑档案/);data.students[0].ownerId='me';let html=app.render('studentDetail');assert.match(html,/businessAPI\.open\('student\.update',\{&quot;studentId&quot;:&quot;s1&quot;\}\)/);app.ctx.permitted=()=>false;assert.doesNotMatch(app.render('studentDetail'),/编辑档案/);app.ctx.permitted=()=>true;app.ctx.user.disabled=true;assert.doesNotMatch(app.render('studentDetail'),/编辑档案/);
});

test('campus and assigned-teacher student editing follows projected enrollment and lesson identities',()=>{
 const data={...dataset,students:[{id:'s1',name:'跨校区学生',ownerId:'sales',campusId:'other-campus'}],enrollments:[{id:'e1',studentId:'s1',classId:'cl1',status:'pending'}],directory:[{id:'teacher-2',name:'真实老师'}],classes:[{id:'cl1',name:'在读班',campusId:campus,teacherId:'teacher-1',schedule:[{id:'session-1',substituteTeacherId:'teacher-2'}]}]},app=setup(data,{operations:[{id:'student.update'}],permitted:()=>true});app.ctx.studentId='s1';app.ctx.user={id:'manager',permissions:['student.update'],scope:{type:'campus',campusIds:[campus]}};assert.match(app.render('studentDetail'),/编辑档案/);app.ctx.user.scope.campusIds=['unrelated-campus'];assert.doesNotMatch(app.render('studentDetail'),/编辑档案/);app.ctx.user={id:'teacher-2',permissions:['student.update'],scope:{type:'assigned'}};assert.match(app.render('studentDetail'),/编辑档案/);app.ctx.user.id='same-display-name';assert.doesNotMatch(app.render('studentDetail'),/编辑档案/);data.enrollments=[];app.ctx.user.id='teacher-2';data.sessionAdjustments=[{studentId:'s1',targetClassId:'cl1',targetSessionId:'session-1',status:'active'}];assert.match(app.render('studentDetail'),/编辑档案/);data.sessionAdjustments[0].status='cancelled';assert.doesNotMatch(app.render('studentDetail'),/编辑档案/);
});

test('empty student archives show only real profile fields and escape user content and student IDs',()=>{
 const id='s"\'<>',data={...dataset,students:[{id,name:'<script>姓名</script>',phone:'13800000001',note:'<img src=x onerror=1>'}]},app=setup(data,{operations:[{id:'student.update'}],permitted:()=>true});app.ctx.studentId=id;app.ctx.user={id:'admin',permissions:['student.update'],scope:{type:'all'}};const html=app.render('studentDetail');assert.match(html,/&lt;script&gt;姓名/);assert.match(html,/&lt;img src=x onerror=1&gt;/);assert.doesNotMatch(html,/<script>|<img src=x|账户余额|报名订单|考勤课消|在读班级|¥0\.00/);const handler=html.match(/onclick="(businessAPI\.open\('student\.update'[^\n]*?)"/)[1];let args;app.sandbox.businessAPI.open=(...value)=>{args=value};vm.runInContext(handler.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&'),app.sandbox);assert.equal(args[0],'student.update');assert.equal(args[1].studentId,id);
});
