'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {emptyState,context}=require('../src/business-common.cjs');
const {operations}=require('../src/business-crm.cjs');
const query=require('../src/business-scrm-query.cjs');
const progress=require('../src/business-lead-stage.cjs');
function fixture(){
 let state=emptyState(),serial=0;
 const sales={id:'sales',name:'销售',roleIds:['sales'],scope:{type:'own'},permissions:['lead.create','lead.read','lead.follow','lead.transfer','lead.release']};
 const other={...sales,id:'other',name:'另一个销售'};
 const admin={id:'admin',name:'管理员',roleIds:['superadmin'],scope:{type:'all'},permissions:[...new Set(operations.map(op=>op.permission)),'lead.read','lead.follow']};
 const operator={id:'operator',name:'运营',roleIds:['operations'],scope:{type:'campus',campusIds:['a']},permissions:['lead.create','lead.read']};
 const directory=[sales,other,admin,operator];state.campuses=[{id:'a',name:'校区',active:true}];
 const now='2030-10-10T02:00:00Z';
 return {sales,other,admin,operator,directory,get state(){return state},run(id,input,actor=sales){const next=structuredClone(state),op=operations.find(op=>op.id===id),result=op.run(next,input,context(next,actor,directory,{now,id:p=>p+'-'+(++serial)}));state=next;return result.record;},rows(actor=sales,filters={}){return query.query({state,revision:1},actor,directory,{resource:'leads',...filters},undefined,Date.parse(now)).items;}};
}
const input={name:'昵称',phone:'13900001001',source:'测试',campusId:'a',ownerId:'sales'};
test('registration, retain, transfer and assignment do not start callback progress',()=>{
 const f=fixture(),lead=f.run('lead.create',input);
 assert.equal(lead.stage,'新线索');assert.equal(lead.status,'assigned');
 assert.equal(f.rows()[0].stage,'新线索');assert.equal(f.rows(f.sales,{queue:'active'}).length,1);
 f.run('lead.transfer',{leadId:lead.id,ownerId:'other'});
 assert.equal(f.rows(f.other)[0].stage,'新线索');
 f.run('lead.assign',{leadId:lead.id,ownerId:'sales'},f.admin);
 assert.equal(f.rows()[0].stage,'新线索');
 const pending=f.run('lead.create',{name:'待决策',phone:'13900001002',source:'测试',campusId:'a'});
 f.run('lead.retain',{leadId:pending.id});assert.equal(f.state.leads[1].stage,'新线索');
});
test('a note without callback stays new; first callback starts progress and cancellation does not undo it',()=>{
 const f=fixture(),lead=f.run('lead.create',input);
 f.run('lead.followup',{leadId:lead.id,note:'首次沟通',channel:'电话'});
 assert.equal(f.rows()[0].stage,'新线索');
 assert.throws(()=>f.run('lead.status.update',{leadId:lead.id,stage:'跟进中'}),{code:'INVALID_STATE'});
 f.run('lead.followup',{leadId:lead.id,note:'约定回访',channel:'电话',nextFollowAt:'2030-10-11T02:00:00Z'});
 assert.equal(f.rows()[0].stage,'跟进中');assert(f.state.leads[0].callbackStartedAt);
 f.run('lead.followup',{leadId:lead.id,note:'取消回访安排',channel:'电话',nextFollowAt:''});
 assert.equal(f.state.leads[0].nextFollowAt,null);assert.equal(f.rows()[0].stage,'跟进中');
 f.run('lead.transfer',{leadId:lead.id,ownerId:'other'});
 assert.equal(f.rows(f.other)[0].stage,'跟进中');
});
test('authorized inline callback editing advances progress and query filtering agrees with the record',()=>{
 const f=fixture(),lead=f.run('lead.create',input);
 assert.equal(f.rows(f.sales,{stage:'新线索'}).length,1);
 f.run('lead.update',{leadId:lead.id,patch:{nextFollowAt:'2030-10-11T02:00:00Z'}});
 assert.equal(f.state.leads[0].stage,'跟进中');assert.equal(f.rows(f.sales,{stage:'新线索'}).length,0);
 assert.equal(f.rows(f.sales,{stage:'跟进中'}).length,1);
 f.run('lead.update',{leadId:lead.id,patch:{nextFollowAt:''}});assert.equal(f.rows()[0].stage,'跟进中');
});
test('terminal states survive edits and cannot be overwritten through assignment or manual progress',()=>{
 const f=fixture(),lead=f.run('lead.create',input);Object.assign(f.state.leads[0],{stage:'已报名',status:'converted'});
 f.run('lead.update',{leadId:lead.id,patch:{note:'补充备注'}});assert.equal(f.rows()[0].stage,'已报名');
 f.run('lead.transfer',{leadId:lead.id,ownerId:'other'});assert.equal(f.state.leads[0].stage,'已报名');assert.equal(f.state.leads[0].status,'converted');
 const cold=f.run('lead.create',{...input,name:'流失记录',phone:'13900001003'});
 f.run('lead.followup',{leadId:cold.id,note:'明确当前不报名',channel:'电话',disposition:'lost_cold'});
 assert.throws(()=>f.run('lead.assign',{leadId:cold.id,ownerId:'other'},f.admin),{code:'INVALID_STATE'});
 assert.throws(()=>f.run('lead.status.update',{leadId:cold.id,stage:'跟进中'}),{code:'INVALID_STATE'});
 assert.equal(f.state.leads.find(r=>r.id===cold.id).stage,'已流失');
});
test('operations can hand off new leads or use public pool but cannot follow, edit, assign existing leads or enroll',()=>{
 const f=fixture(),lead=f.run('lead.create',input,f.operator);
 assert.equal(lead.ownerId,'sales');assert.equal(lead.registrarId,'operator');assert.equal(lead.stage,'新线索');
 assert.equal(f.rows(f.operator,{queue:'registered'}).length,1);
 const pool=f.run('lead.create',{...input,name:'公海记录',phone:'13900001004',ownerId:''},f.operator);assert.equal(pool.ownerId,null);
 for(const [id,i]of [['lead.followup',{leadId:lead.id,note:'越权',channel:'电话',nextFollowAt:'2030-10-11T02:00:00Z'}],['lead.update',{leadId:lead.id,patch:{nextFollowAt:'2030-10-11T02:00:00Z'}}],['lead.assign',{leadId:lead.id,ownerId:'other'}]])assert.throws(()=>f.run(id,i,f.operator),{code:'FORBIDDEN'});
 assert(!f.operator.permissions.includes('enrollment.create'));
 assert.throws(()=>f.run('lead.create',{...input,name:'无权本人',phone:'13900001005',ownerId:'operator'},f.operator),{code:'FORBIDDEN'});
 assert.equal(f.state.leads.length,2);
});
test('historical actual callbacks survive cancellation while owner-only legacy stages are corrected without mutation',()=>{
 const legacy={ownerId:'sales',stage:'跟进中',history:[]};assert.equal(progress.stage(legacy),'新线索');assert.equal(legacy.stage,'跟进中');
 const followed={...legacy,nextFollowAt:null,history:[{kind:'跟进',detail:{nextFollowAt:'2026-10-10T02:00:00Z'}},{kind:'跟进',detail:{nextFollowAt:null}}]};
 assert.equal(progress.stage(followed),'跟进中');
 followed.history.push({kind:'释放公海'});assert.equal(progress.stage(followed),'新线索');
 followed.history.push({kind:'跟进',detail:{automatic:true,trialEvent:'trial_confirmed'}});assert.equal(progress.stage(followed),'新线索');
});

test('legacy cold rows never enter active callbacks and lost-stage filters agree with display aliases',()=>{const f=fixture(),lead=f.run('lead.create',input);f.state.leads[0].stage='冷宫';assert.equal(f.rows(f.sales,{queue:'active'}).length,0);assert.equal(f.rows(f.sales,{stage:'已流失'})[0].id,lead.id);assert.equal(f.rows(f.sales,{queue:'cold'})[0].stage,'冷宫')});

test('explicit reactivation accepts closed legacy aliases but never turns a paid lead back into a new lead',()=>{for(const patch of [{stage:'冷宫',status:'assigned'},{stage:'已归档',status:'archived'}]){const f=fixture(),lead=f.run('lead.create',input);Object.assign(f.state.leads[0],patch);const record=f.run('lead.reactivate',{leadId:lead.id,reason:'授权显式恢复'},f.admin);assert.equal(record.stage,'新线索');assert.equal(record.ownerId,undefined);assert.equal(record.status,'new');assert.equal(record.history.at(-1).kind,'恢复')}const f=fixture(),lead=f.run('lead.create',input);Object.assign(f.state.leads[0],{stage:'冷宫',status:'assigned'});f.state.orders.push({id:'paid',originLeadId:lead.id,paidCents:100});assert.throws(()=>f.run('lead.reactivate',{leadId:lead.id,reason:'不得撤销已收款'},f.admin),{code:'INVALID_STATE'});assert.equal(f.state.leads[0].stage,'冷宫')});
test('automatic warning and recycle never bypass explicit recovery of any closed alias',()=>{for(const patch of [{stage:'冷宫',status:'assigned'},{stage:'已流失',status:'assigned'},{stage:'已归档',status:'archived'}]){const f=fixture();f.run('lead.create',input);Object.assign(f.state.leads[0],patch,{assignedAt:'2020-01-01T00:00:00Z',createdAt:'2020-01-01T00:00:00Z'});f.state.leadPolicy={reserveDays:14,reclaimDays:21,firstFollowHours:4,decisionHours:48};const before=structuredClone(f.state.leads[0]);f.run('lead.policy.run',{apply:true},f.admin);assert.deepEqual(f.state.leads[0],before)}});
