const assert=require('node:assert/strict'),boot=require('./runtime.cjs');
let count=0;function test(name,fn){fn();count++;console.log('PASS '+name)}
function fixture(){
 const b=boot();b.panels=[];b.ctx.document.body.insertAdjacentHTML=(_,html)=>b.panels.push(html);
 b.run(`permissionState.identity='admin';state.page='enroll';state.mode='list';sysRules.entry.enabled=true;sysRules.entry.allowMidCourse=true;
 a.courses=[{id:'course',name:'测试课程',active:true,fee:1000,product:{price:1000,version:1},lessons:[{id:'l1',title:'第一讲'},{id:'l2',title:'第二讲'}]},{id:'other-course',name:'另一课程',active:true,fee:1500,product:{price:1500,version:1},lessons:[{id:'m1',title:'第一讲'}]}];
 a.classes=[1,2,3,4].map(i=>({id:'c'+i,name:'测试班'+i,course:i===4?'另一课程':'测试课程',courseId:i===4?'other-course':'course',lessonId:i===4?'m1':'l1',lessonVersion:1,campus:i===3?'乙校区':'甲校区',room:String(i),teacher:'老师'+i,date:'2099-01-0'+i,time:'09:00–11:00',capacity:10,students:0,studentIds:[]}));
 a.students=[1,2,3,4].map(i=>({id:'s'+i,name:'学生'+i,phone:'1390000000'+i,status:'潜在',className:'—',classIds:[]}));
 a.orders=[];a.attendance=[];a.refunds=[];a.sessionAdjustments=[];a.makeups=[];a.batchLogs=[];mallState.activities.coupon=[];render();batchOpen('enroll');batchUI.token='correction-batch';batchUI.ids=['s1','s2'];batchUI.draft.targetId='c1';batchPreview();`);
 return b;
}
function snapshot(b){return b.run('JSON.stringify(auditBusinessSnapshot())')}
function view(b){return b.elements.get('#view').innerHTML}
function plain(b,code){return JSON.parse(b.run('JSON.stringify('+code+')'))}

test('invalid rows expose inline corrections and usable same-course choices without mutating business data',()=>{
 const b=fixture();b.run("a.students[0].phone='';a.classes[0].capacity=1;batchRecheckEnrollment()");const original=snapshot(b);
 assert(b.run('batchHasErrors(batchUI.plan)'));for(const label of ['学生1的报名学生','学生1的联系电话','学生1的报名班级','重新校验','移出本次','可选同课程班级'])assert(view(b).includes(label),label);
 assert.deepEqual(plain(b,'batchEnrollmentSuggestions(batchUI.plan.rows[0]).map(c=>c.id)'),['c2','c3']);assert.equal(b.run('state.page'),'batchFlow');assert(!view(b).includes('modal-backdrop'));assert.equal(b.panels.length,0);
 b.run("batchEnrollmentEdit('s1','classId','c2');batchEnrollmentEdit('s1','phone','13911111111')");assert.equal(snapshot(b),original);assert.equal(b.run('batchHasErrors(batchUI.plan)'),false);assert.equal(b.run('batchUI.plan.rows[0].data.classId'),'c2');assert.equal(b.run('batchUI.plan.rows[1].data.classId'),'c1');assert(view(b).includes('确认本批时同步学生档案'));
});

test('a correction recalculates that student’s real quote and only final confirmation writes pending orders',()=>{
 const b=fixture();b.run("a.students[0].phone='';a.orders.push({id:'prior',studentId:'s2',classId:'past',paymentState:'已支付',entitlementState:'已生效'});mallState.activities.coupon=[{id:'renewal',name:'续费优惠',template:'续费',status:'进行中',start:'2000-01-01',end:'2099-12-31',discount:100,threshold:0}];batchRecheckEnrollment()");const before=snapshot(b);
 b.run("batchEnrollmentEdit('s1','classId','c4');batchEnrollmentEdit('s1','phone','13911111111')");assert.equal(snapshot(b),before);assert.equal(b.run('batchUI.plan.rows[0].data.quote.total'),1500);assert.equal(b.run('batchUI.plan.rows[1].data.quote.total'),900);assert(view(b).includes('应付 ¥1500.00'));
 b.run('batchCommit()');assert.equal(b.run('a.students[0].phone'),'13911111111');assert.equal(b.run('a.orders.length'),3);assert.deepEqual(plain(b,"a.orders.filter(o=>o.batchId==='correction-batch').map(o=>[o.studentId,o.classId,o.amount,o.paid,o.paymentState,o.entitlementState])"),[['s1','c4','¥1500.00','¥0.00','待支付','未生效'],['s2','c1','¥900.00','¥0.00','待支付','未生效']]);assert(b.run('a.classes.every(c=>c.students===0&&c.studentIds.length===0)'));assert.equal(b.run('a.attendance.length'),0);assert.equal(b.run('state.page'),'orders');
 const reload=boot(b.storage);assert.equal(reload.run('a.students[0].phone'),'13911111111');assert.equal(reload.run("a.orders.filter(o=>o.batchId==='correction-batch').length"),2);
});

test('changing student clears the previous child’s staged phone and catches duplicate rows',()=>{
 const b=fixture();b.run("batchEnrollmentEdit('s1','phone','13911111111');batchEnrollmentEdit('s1','studentId','s2')");assert.equal(b.run("Object.hasOwn(batchUI.draft.enrollOverrides.s1,'phone')"),false);assert.equal(b.run('batchEnrollmentRequests(batchUI.draft,batchUI.ids)[0].phone'),'13900000002');assert(b.run("batchUI.plan.rows.every(r=>r.errors.some(e=>e.includes('本批重复')))"));const before=snapshot(b);b.run('batchCommit()');assert.equal(snapshot(b),before);
 b.run("batchEnrollmentEdit('s1','studentId','s3')");assert.equal(b.run('batchHasErrors(batchUI.plan)'),false);b.run('batchCommit()');assert.deepEqual(plain(b,'a.orders.map(o=>o.studentId)'),['s3','s2']);assert.equal(b.run('a.students[0].phone'),'13900000001');assert.equal(b.run('a.students[2].phone'),'13900000003');
});

test('removing an invalid row is explicit and restoration preserves its correction draft',()=>{
 const b=fixture();b.run("a.students[0].phone='';batchEnrollmentEdit('s1','classId','c2')");const before=snapshot(b);b.run('batchCommit()');assert.equal(snapshot(b),before);assert.equal(b.run('a.orders.length'),0);
 b.run("batchRemoveEnrollmentRow('s1')");assert.equal(snapshot(b),before);assert.equal(b.run('batchUI.ids.length'),1);assert.equal(b.run('batchHasErrors(batchUI.plan)'),false);assert(view(b).includes('恢复 学生1'));
 b.run("batchRestoreEnrollmentRow('s1')");assert.equal(b.run('batchUI.ids.length'),2);assert.equal(b.run("batchUI.plan.rows.find(r=>r.key==='s1').data.classId"),'c2');assert(b.run('batchHasErrors(batchUI.plan)'));assert.equal(snapshot(b),before);
 b.run("batchRemoveEnrollmentRow('s1');batchCommit()");assert.equal(b.run('a.orders.length'),1);assert.equal(b.run('a.orders[0].studentId'),'s2');assert.equal(b.run('a.students.length'),4);assert.equal(b.run('a.students[0].phone'),'');
});

test('suggestions exclude duplicates, full classes, pending reservations and overlapping lessons',()=>{
 const b=fixture();b.run("a.classes[0].studentIds=['s1'];a.classes[0].students=1;a.students[0].classIds=['c1'];a.classes[1].capacity=1;a.orders.push({id:'pending',studentId:'s4',classId:'c2',paymentState:'待支付',entitlementState:'未生效'});batchRecheckEnrollment()");
 assert.deepEqual(plain(b,'batchEnrollmentSuggestions(batchUI.plan.rows[0]).map(c=>c.id)'),['c3']);b.run("a.classes[2].date=a.classes[0].date;batchRecheckEnrollment()");assert.deepEqual(plain(b,'batchEnrollmentSuggestions(batchUI.plan.rows[0]).map(c=>c.id)'),[]);
 b.run("a.classes[2].date='2099-01-03';batchEnrollmentEdit('s1','classId','c2')");assert(b.run("batchUI.plan.rows[0].errors.some(e=>e.includes('容量不足'))"));b.run("a.orders[0].paymentState='已取消';a.orders[0].entitlementState='已取消';batchRecheckEnrollment()");assert.equal(b.run('batchHasErrors(batchUI.plan)'),false);
 b.run("batchEnrollmentEdit('s2','classId','c2')");assert(b.run("batchUI.plan.rows.every(r=>r.errors.some(e=>e.includes('容量不足')))"));const before=snapshot(b);b.run('batchCommit()');assert.equal(snapshot(b),before);
});

test('two rows cannot book the same student into overlapping classes or conflicting contact edits',()=>{
 const b=fixture();b.run("a.classes[1].date=a.classes[0].date;batchEnrollmentEdit('s2','classId','c2');batchEnrollmentEdit('s2','studentId','s1')");assert(b.run("batchUI.plan.rows.every(r=>r.errors.some(e=>e.includes('本批为该学生')) )"));
 b.run("a.classes[1].date='2099-01-02';batchEnrollmentEdit('s2','phone','13922222222')");assert(b.run("batchUI.plan.rows.every(r=>r.errors.some(e=>e.includes('联系电话不一致')))"));const before=snapshot(b);b.run('batchCommit()');assert.equal(snapshot(b),before);
});

test('editing without revalidation and changes to the underlying quote require another explicit confirmation',()=>{
 const b=fixture();b.run("batchEnrollmentEdit('s1','phone','13911111111',false)");assert.equal(b.run('batchUI.enrollDirty'),true);assert.equal(b.elements.get('#batch-confirm').disabled,true);assert.equal(b.run('batchUI.signature'),null);const before=snapshot(b);b.run('batchCommit()');assert.equal(snapshot(b),before);assert.equal(b.run('batchUI.enrollDirty'),false);assert(b.messages.at(-1).includes('核对报价'));
 b.run('a.courses[0].product.price=1200;batchCommit()');assert.equal(b.run('a.orders.length'),0);assert.equal(b.run('batchUI.plan.rows[0].data.quote.total'),1200);assert(b.messages.at(-1).includes('已变化'));b.run('batchCommit()');assert.equal(b.run('a.orders.length'),2);assert.equal(b.run('a.orders[0].amount'),'¥1200.00');
});

test('a changed capacity blocks final confirmation and corrected rows can then be revalidated',()=>{
 const b=fixture();b.run('a.classes[0].capacity=1');const before=snapshot(b);b.run('batchCommit()');assert.equal(snapshot(b),before);assert(b.run('batchHasErrors(batchUI.plan)'));b.run("batchEnrollmentEdit('s1','classId','c2');batchCommit()");assert.equal(b.run('a.orders.length'),2);
});

test('primary storage failure rolls back staged contact changes and every order',()=>{
 const b=fixture();b.run("batchEnrollmentEdit('s1','phone','13911111111');const savedSet=localStorage.setItem;localStorage.setItem=(key,value)=>{if(key==='siyue-workflow-demo-v2')throw Error('storage full');savedSet(key,value)}");const before=snapshot(b);b.run('batchCommit()');assert.equal(snapshot(b),before);assert.equal(b.run('state.page'),'batchFlow');assert.equal(b.run('batchUI.draft.enrollOverrides.s1.phone'),'13911111111');assert.equal(b.run('a.batchLogs.length'),0);
 b.run('localStorage.setItem=savedSet;batchCommit()');assert.equal(b.run('a.orders.length'),2);assert.equal(b.run('a.students[0].phone'),'13911111111');assert.equal(b.run('a.batchLogs.length'),1);
});

test('permissions, disabled enrollment and the original batch token remain authoritative',()=>{
 const b=fixture();b.run("permissionState.identity='manager'");const before=snapshot(b),draft=b.run('JSON.stringify(batchUI.draft)');b.run("batchEnrollmentEdit('s1','classId','c2');batchRemoveEnrollmentRow('s1');batchRecheckEnrollment();batchCommit()");assert.equal(snapshot(b),before);assert.equal(b.run('JSON.stringify(batchUI.draft)'),draft);
 const disabled=fixture();disabled.run('sysRules.entry.enabled=false;batchRecheckEnrollment()');assert(disabled.run("batchUI.plan.errors.includes('系统配置已暂停新报名')"));disabled.run('batchCommit()');assert.equal(disabled.run('a.orders.length'),0);
 const repeated=fixture();repeated.run('const draftCopy=JSON.parse(JSON.stringify(batchUI.draft)),idsCopy=[...batchUI.ids],sig=batchUI.signature;batchCommit()');const after=snapshot(repeated);assert.throws(()=>repeated.run("batchExecute('enroll',draftCopy,idsCopy,'correction-batch',sig)"),/已办理/);assert.equal(snapshot(repeated),after);
});

test('missing records are correctable and valid zero-price courses still create explicit pending orders',()=>{
 const b=fixture();b.run("a.students=a.students.filter(s=>s.id!=='s1');a.classes=a.classes.filter(c=>c.id!=='c1');batchRecheckEnrollment()");assert(b.run('batchHasErrors(batchUI.plan)'));assert(view(b).includes('学生已移除'));assert(view(b).includes('请选择本行报名班级'));
 b.run("batchEnrollmentEdit('s1','studentId','s3');batchEnrollmentEdit('s1','classId','c2');batchEnrollmentEdit('s2','classId','c3');a.courses[0].product.price=0;batchRecheckEnrollment()");assert.equal(b.run('batchHasErrors(batchUI.plan)'),false);b.run('batchCommit()');assert.equal(b.run('a.orders.length'),2);assert(b.run("a.orders.every(o=>o.amount==='¥0.00'&&o.paid==='¥0.00'&&o.entitlementState==='未生效')"));
});

test('mid-course admission rules follow each corrected target instead of the original shared selection',()=>{
 const b=fixture();b.run("sysRules.entry.allowMidCourse=false;a.classes[0].lessonId='l2';batchRecheckEnrollment()");assert(b.run('batchHasErrors(batchUI.plan)'));b.run("batchEnrollmentEdit('s1','classId','c2');batchEnrollmentEdit('s2','classId','c3')");assert.equal(b.run('batchHasErrors(batchUI.plan)'),false);assert.deepEqual(plain(b,'batchEnrollmentTargets(batchUI.draft,batchUI.ids).map(c=>c.id)'),['c2','c3']);
});

console.log(`Batch enrollment correction checks: ${count} passed`);
