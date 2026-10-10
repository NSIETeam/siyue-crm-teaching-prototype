const assert=require('node:assert/strict'),boot=require('./runtime.cjs');
let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS '+name)};
function setup(){const e=boot();e.run(`
 permissionState.identity='admin';state.page='schedule';
 state.campuses=[{name:'甲校区',active:true,roomDetails:[{name:'A1',capacity:30},{name:'A2',capacity:20}]},{name:'乙校区',active:true,roomDetails:[{name:'B1',capacity:30},{name:'B2',capacity:10}]}];
 state.staff=[{id:'T1',name:'甲老师',active:true,roles:'面授主讲'},{id:'T2',name:'乙老师',active:true,roles:'面授主讲'},{id:'T3',name:'丙老师',active:true,roles:'面授主讲'}];
 a.courses=[{id:'C',name:'数学',active:true,grade:'4年级',subject:'数学',curriculumVersion:2,product:{version:9},lessons:[{id:'L1',title:'第一讲'},{id:'L2',title:'第二讲'}]}];
 a.classes=[];a.students=[];a.attendance=[];a.orders=[];a.sessionAdjustments=[];a.batchLogs=[];
 globalThis.draft={campus:'甲校区',rows:[{name:'一班',courseId:'C',teacher:'甲老师',room:'A1',date:'2099-01-01',time:'09:00–10:00',capacity:20}]};
 globalThis.base={id:'old',name:'原班',courseId:'C',course:'数学',teacher:'乙老师',campus:'甲校区',room:'A2',date:'2099-01-01',time:'11:00–12:00',capacity:20,students:0,studentIds:[],lessonId:'L1',lessonVersion:2,status:'未开课',sessions:[]};
 workflowState.scheduleView='teacher';for(const k of ['from','to','campus','teacher','student','course','room'])workflowState[k]='';workflowState.scheduleStatus='active';
 `);return e}
function snapshot(e){return e.run('JSON.stringify(batchSavePayload())')}
check('batch creation validates live entities, lesson identity and integer capacity',()=>{
 for(const mutation of ["draft.rows[0].teacher='不存在'","state.staff[0].active=false","draft.campus='不存在'","state.campuses[0].active=false","draft.rows[0].room='不存在'","draft.rows[0].capacity=1.5","draft.rows[0].capacity=31","draft.rows[0].courseId='不存在'","a.courses[0].active=false","a.courses[0].lessons=[]","a.courses.push({...a.courses[0]})"]){const e=setup();e.run(mutation);assert(e.run("batchHasErrors(batchPlan('create',draft,[]))"),mutation);}
 const e=setup();assert.equal(e.run("batchHasErrors(batchPlan('create',draft,[]))"),false);assert.equal(e.run("batchPlan('create',draft,[]).rows[0].data.lessonVersion"),2);
});
check('trimmed duplicate class names are rejected within the batch and against existing records',()=>{
 const e=setup();e.run("draft.rows.push({...draft.rows[0],name:' 一班 ',time:'10:00–11:00'})");assert(e.run("batchPlan('create',draft,[]).rows.every(r=>r.errors.includes('班名重复'))"));
 const f=setup();f.run("a.classes=[{...base,name:' 一班 '}] ");assert(f.run("batchPlan('create',draft,[]).rows[0].errors.includes('班名重复')"));
});
check('cancelled classes free resources while overlapping live and in-batch schedules conflict',()=>{
 const e=setup();e.run("a.classes=[{...base,name:'取消班',teacher:'甲老师',room:'A1',time:'09:00–10:00',status:'已取消'}]");assert.equal(e.run("batchHasErrors(batchPlan('create',draft,[]))"),false);
 e.run("a.classes[0].status='未开课'");assert(e.run("batchHasErrors(batchPlan('create',draft,[]))"));
 e.run("a.classes=[];draft.rows.push({...draft.rows[0],name:'二班',time:'09:30–10:30'})");assert(e.run("batchPlan('create',draft,[]).rows.every(r=>r.errors.includes('老师或教室时段冲突'))"));
});
check('resource conflict follows actual substitute rather than the released main teacher',()=>{
 const e=setup();e.run("a.classes=[{...base,teacher:'甲老师',room:'A2',time:'09:00–10:00'}];a.classes[0].sessions=[{sessionId:workflowSessionKey(a.classes[0]),substitute:'乙老师'}]");assert.equal(e.run("batchHasErrors(batchPlan('create',draft,[]))"),false);
 e.run("draft.rows[0].teacher='乙老师'");assert(e.run("batchHasErrors(batchPlan('create',draft,[]))"));
});
check('creation is atomic, preserves data after storage failure, and persists exactly once',()=>{
 const e=setup();e.run("draft.rows.push({...draft.rows[0],name:'二班',time:'10:00–11:00'});globalThis.plan=batchPlan('create',draft,[]);globalThis.originalSet=localStorage.setItem;localStorage.setItem=(key,value)=>{if(key==='siyue-workflow-demo-v2')throw Error('disk full');originalSet(key,value)}");const before=snapshot(e);assert.throws(()=>e.run("batchExecute('create',draft,[],'AUDIT-CREATE',JSON.stringify(plan))"));assert.equal(snapshot(e),before);
 e.run("localStorage.setItem=originalSet;batchExecute('create',draft,[],'AUDIT-CREATE',JSON.stringify(plan))");assert.equal(e.run('a.classes.length'),2);assert.equal(e.run('a.batchLogs.length'),1);assert.equal(boot(e.storage).run("a.classes.filter(c=>c.id.startsWith('AUDIT-CREATE')).length"),2);
 assert.throws(()=>e.run("batchExecute('create',draft,[],'AUDIT-CREATE',JSON.stringify(plan))"));
});
check('revalidation catches withdrawn staff, while a marketing version does not change curriculum identity',()=>{
 const e=setup();e.run("globalThis.plan=batchPlan('create',draft,[]);a.courses[0].product.version=100");assert.equal(e.run("JSON.stringify(batchPlan('create',draft,[]))===JSON.stringify(plan)"),true);
 e.run('state.staff[0].active=false');const before=snapshot(e);assert.throws(()=>e.run("batchExecute('create',draft,[],'STALE',JSON.stringify(plan))"));assert.equal(snapshot(e),before);
});
check('campus transfer validates destination, capacity, records and actual resource conflicts',()=>{
 for(const mutate of ["move.campus='缺失校区'","move['room:old']='缺失教室'","move['room:old']='B2'","a.classes[0].capacity=1.5","a.classes[0].status='已结课'","a.classes.push({...base})","state.staff[1].active=false"]){const e=setup();e.run("a.classes=[{...base}];globalThis.move={campus:'乙校区','room:old':'B1'};"+mutate);assert(e.run("batchHasErrors(batchPlan('campus',move,['old']))"),mutate);}
 const e=setup();e.run("a.classes=[{...base},{...base,id:'other',name:'另一班',campus:'乙校区',room:'B1',teacher:'丙老师'}];globalThis.move={campus:'乙校区','room:old':'B1'}");assert(e.run("batchHasErrors(batchPlan('campus',move,['old']))"));e.run("a.classes[1].status='已取消'");assert.equal(e.run("batchHasErrors(batchPlan('campus',move,['old']))"),false);
});
check('campus transfer saves historical place by stable class ID and rolls the whole batch back on failure',()=>{
 const e=setup();e.run("a.classes=[{...base}];a.attendance=[{id:'H',classId:'old',classIndex:99,date:'2090-01-01',status:'已考勤'}];globalThis.move={campus:'乙校区','room:old':'B1'};globalThis.plan=batchPlan('campus',move,['old']);globalThis.originalSet=localStorage.setItem;localStorage.setItem=(key,value)=>{if(key==='siyue-workflow-demo-v2')throw Error('disk full');originalSet(key,value)}");const before=snapshot(e);assert.throws(()=>e.run("batchExecute('campus',move,['old'],'MOVE',JSON.stringify(plan))"));assert.equal(snapshot(e),before);
 e.run("localStorage.setItem=originalSet;batchExecute('campus',move,['old'],'MOVE',JSON.stringify(plan))");assert.equal(e.run('a.classes[0].campus'),'乙校区');assert.equal(e.run('a.attendance[0].campusSnapshot'),'甲校区');assert.equal(e.run('a.attendance[0].roomSnapshot'),'A2');assert.equal(e.run('a.classes[0].locationHistory.length'),1);
});
check('schedule state filter separates live, ended and cancelled lessons',()=>{
 const e=setup();e.run("a.classes=[{...base,name:'进行班'},{...base,id:'end',name:'结束班',status:'已结课'},{...base,id:'cancel',name:'取消班',status:'已取消'}]");let html=e.run('scSchedulePage()');assert(html.includes('进行班'));assert(!html.includes('结束班'));assert(!html.includes('取消班'));
 e.run("workflowState.scheduleStatus='cancelled'");html=e.run('scSchedulePage()');assert(html.includes('取消班'));assert(!html.includes('进行班'));assert(!html.includes('结束班'));assert.equal(e.run('scEventStatus(a.classes[2]).label'),'已取消');
 e.run("workflowState.scheduleStatus='all'");html=e.run('scSchedulePage()');assert(!html.includes('检测到 3 处时间冲突'));
});
check('invalid schedule times never report a clean conflict check and room view exposes overlaps',()=>{
 const e=setup();e.run("a.classes=[{...base,time:'25:00–26:00'}]");let html=e.run('scSchedulePage()');assert(html.includes('暂不能完整判断冲突'));assert(!html.includes('当前无时间冲突'));
 e.run("workflowState.scheduleView='room';a.classes=[{...base},{...base,id:'another',name:'另一班',teacher:'丙老师'}]");html=e.run('scSchedulePage()');assert(html.includes('老师或教室时间冲突'));
});
check('attendance only completes when each roster student is marked and unknown lessons stay unknown',()=>{
 const e=setup();e.run("a.classes=[{...base,studentIds:['S1','S2'],students:2}];a.students=[{id:'S1',name:'甲'},{id:'S2',name:'乙'}];a.attendance=[{sessionId:workflowSessionKey(a.classes[0]),studentId:'S1',status:'已考勤'}]");assert.equal(e.run('scEventStatus(a.classes[0]).label'),'已点名 1/2');
 e.run("a.attendance.push({sessionId:workflowSessionKey(a.classes[0]),studentId:'S2',status:'已考勤'})");assert.equal(e.run('scEventStatus(a.classes[0]).label'),'考勤已完成');e.run("a.classes[0].lessonId='unknown'");assert.equal(e.run('scCourseLesson(a.classes[0]).lesson'),undefined);
});
check('teacher filter uses the substitute and date bounds filter the actual scheduled date',()=>{
 const e=setup();e.run("a.classes=[{...base}];a.classes[0].sessions=[{sessionId:workflowSessionKey(a.classes[0]),substitute:'甲老师'}];workflowState.teacher='乙老师'");assert(!e.run('scSchedulePage()').includes('原班'));
 e.run("workflowState.teacher='甲老师'");assert(e.run('scSchedulePage()').includes('原班'));e.run("workflowState.from='2099-01-02'");assert(!e.run('scSchedulePage()').includes('原班'));
});
check('batch conflict checks include later scheduled lessons and their actual substitutes',()=>{
 const e=setup();e.run("a.classes=[{...base,teacher:'丙老师',schedule:[{id:'P1',key:'old|SESSION|P1',lessonId:'L1',lessonVersion:2,date:'2099-01-01',time:'11:00–12:00'},{id:'P2',key:'old|SESSION|P2',lessonId:'L2',lessonVersion:2,date:'2099-01-02',time:'09:00–10:00'}],sessions:[{sessionId:'old|SESSION|P2',date:'2099-01-02',substitute:'甲老师'}]}];draft.rows[0].date='2099-01-02'");assert(e.run("batchPlan('create',draft,[]).rows[0].errors.includes('老师或教室时段冲突')"));
 e.run("draft.rows[0].teacher='丙老师'");assert.equal(e.run("batchHasErrors(batchPlan('create',draft,[]))"),false);
});
check('multi-session adapter preserves parent class index and stable session ID in actions',()=>{
 const e=setup();e.run("a.classes=[{...base}];globalThis.academicScheduledClasses=()=>[{c:{...a.classes[0],scheduleId:'SCHEDULE-2',date:'2099-02-02',lessonId:'L2'},index:0,sessionId:'SCHEDULE-2'}]");const html=e.run('scSchedulePage()');assert(html.includes('2099-02-02'));assert(html.includes('workflowOpenSession(0,null,&quot;SCHEDULE-2&quot;)'));assert(html.includes('第二讲'));
});
console.log(`Academic schedule audit checks: ${checks} passed`);
