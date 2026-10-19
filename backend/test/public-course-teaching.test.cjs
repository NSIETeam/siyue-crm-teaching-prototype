'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {publicCatalog}=require('../src/business-commerce-checkout.cjs');
const {fixture,request,origin}=require('./helpers/remaining-http.cjs');
const now='2026-10-30T00:00:00Z';
function sample(){
 const course={id:'synthetic-course',active:true,version:1,published:true,publishedVersion:1,priceCents:10000,publishedSnapshot:{lessons:[{title:'第一讲'},{title:'第二讲'},{title:'第三讲'}]},storefront:{status:'上架',courseVersion:1,classIds:['synthetic-class'],content:{title:'合成课程',grade:'小四',subject:'数学',priceCents:10000}}};
 const klass={id:'synthetic-class',name:'合成班级',courseId:course.id,campusId:'A',room:'合成教室',status:'active',capacity:4,durationMinutes:60,teachingMode:'oneOnOne',teacher:'班级主讲老师',teacherId:'private-main-teacher-id',teacherPhone:'private-teacher-phone',teacherProfile:{salary:'private-salary'},schedule:[{id:'past',date:'2026-10-29',time:'09:00–10:00',status:'scheduled'},{id:'next',date:'2026-10-31',time:'09:00–10:00',status:'scheduled',teacher:'课次代课老师',teacherId:'private-substitute-id',substituteReason:'private-substitution-note'},{id:'cancelled',date:'2026-11-01',time:'09:00–10:00',status:'cancelled'}]};
 return {courses:[course],classes:[klass],shelved:[course.id],hiddenShelved:[],campuses:[{id:'A',name:'合成校区',active:true,roomDetails:[{name:'合成教室',capacity:4}]}],activities:{group:[],joint:[]},enrollments:[],sessionAdjustments:[],students:[],trialBookings:[],staff:[{id:klass.teacherId,name:'不能推断的目录名称',phone:'private-directory-phone'}]};
}
function read(state){return publicCatalog(state,now).products[0].classes[0]}
test('public class teaching details distinguish published total lessons from remaining future sessions',()=>{
 const state=sample(),before=structuredClone(state),klass=read(state);
 assert.equal(klass.totalLessons,3);assert.equal(klass.remainingLessons,1);assert.equal(klass.durationMinutes,60);assert.equal(klass.teachingMode,'oneOnOne');
 assert.deepEqual(klass.schedule.map(s=>s.id),['next']);assert.deepEqual(state,before,'public projection must not mutate teaching records');
});
test('public teacher names come only from explicit class and session snapshots without leaking profiles',()=>{
 const state=sample(),klass=read(state),raw=JSON.stringify(publicCatalog(state,now));
 assert.equal(klass.teacherName,'班级主讲老师');assert.equal(klass.schedule[0].teacherName,'课次代课老师');
 assert.deepEqual(Object.keys(klass).sort(),['id','courseId','name','campusId','campusName','durationMinutes','teacherName','totalLessons','remainingLessons','teachingMode','remainingSeats','schedule'].sort());
 assert.deepEqual(Object.keys(klass.schedule[0]).sort(),['id','date','time','room','status','teacherName'].sort());
 for(const privateValue of ['teacherId','teacherPhone','teacherProfile','salary','substituteReason','staff','private-main-teacher-id','private-substitute-id','private-teacher-phone','private-directory-phone','private-substitution-note','不能推断的目录名称'])assert(!raw.includes(privateValue),privateValue);
});
test('resetting a session to the current main teacher cannot retain a stale substitute name',()=>{
 const state=sample(),klass=state.classes[0],session=klass.schedule[1];
 session.teacherId=klass.teacherId;session.teacher='旧代课快照姓名';klass.teacher='当前班级主讲老师';
 assert.equal(read(state).schedule[0].teacherName,'当前班级主讲老师');
 delete klass.teacher;assert.equal(read(state).schedule[0].teacherName,null,'a stale session name cannot fill a missing current main teacher snapshot');
 session.teacherId='different-substitute-id';session.teacher='实际代课老师';assert.equal(read(state).schedule[0].teacherName,'实际代课老师');
 delete session.teacher;assert.equal(read(state).schedule[0].teacherName,null,'an unknown substitute is not inferred from an id');
});
test('missing teaching snapshots remain unknown instead of borrowing drafts, ids, or class teachers',()=>{
 const state=sample();delete state.courses[0].publishedSnapshot;state.courses[0].lessons=Array.from({length:12},()=>({title:'未发布草稿'}));delete state.classes[0].teacher;delete state.classes[0].schedule[1].teacher;state.classes[0].teachingMode='unsupported';
 let klass=read(state);assert.equal(klass.totalLessons,null);assert.equal(klass.remainingLessons,1);assert.equal(klass.teacherName,null);assert.equal(klass.schedule[0].teacherName,null);assert(!Object.hasOwn(klass,'teachingMode'));
 state.classes[0].teacher='班级主讲老师';klass=read(state);assert.equal(klass.teacherName,'班级主讲老师');assert.equal(klass.schedule[0].teacherName,null,'unknown session teacher must not inherit a guessed name');
 state.classes[0].teacher={name:'不可公开档案',phone:'private-object-phone'};state.classes[0].schedule[1].teacher=123;klass=read(state);assert.equal(klass.teacherName,null);assert.equal(klass.schedule[0].teacherName,null);
});
test('public teaching mode accepts only the existing canonical class types',()=>{
 for(const mode of ['group','oneOnOne','oneOnMany']){const state=sample();state.classes[0].teachingMode=mode;assert.equal(read(state).teachingMode,mode)}
 for(const value of [undefined,null,{},'advanced','private-type']){const state=sample();state.classes[0].teachingMode=value;assert(!Object.hasOwn(read(state),'teachingMode'))}
});
test('real public store HTTP exposes teaching snapshots and counts while keeping teacher ids and private fields out',async t=>{
 const f=await fixture(t),teacher=await f.employee({name:'公开主讲老师'}),course=await f.course(),published=(await f.execute('course.publish',{courseId:course.id})).result.course,klass=await f.klass(published,teacher,{teachingMode:'oneOnMany'});
 await f.execute('product.publish',{courseId:published.id,classIds:[klass.id],expectedVersion:published.version});
 f.seed(state=>{const row=state.classes.find(c=>c.id===klass.id);row.teacherPhone='private-http-phone';row.privateTeacherProfile={salary:'private-http-salary'};Object.assign(row.schedule[1],{teacher:'公开课次老师',teacherId:'private-http-session-teacher-id',substituteReason:'private-http-reason'})});f.clock='2026-10-31T10:00:00Z';
 const before=f.database(store=>store.snapshot()),response=await request(f.server,'/v1/public/store','GET',undefined,{Origin:origin});assert.equal(response.status,200);const product=response.body.products.find(p=>p.id===published.id),row=product.classes[0];
 assert.equal(row.teacherName,'公开主讲老师');assert.equal(row.totalLessons,2);assert.equal(row.remainingLessons,1);assert.equal(row.teachingMode,'oneOnMany');assert.equal(row.durationMinutes,60);assert.equal(row.schedule[0].teacherName,'公开课次老师');
 const raw=JSON.stringify(response.body);for(const privateValue of [teacher.user.id,'private-http-phone','private-http-salary','private-http-session-teacher-id','private-http-reason','teacherId','employeeNo','privateTeacherProfile'])assert(!raw.includes(privateValue),privateValue);
 assert.deepEqual(f.database(store=>store.snapshot()),before,'anonymous teaching metadata reads must not write business state');
});
