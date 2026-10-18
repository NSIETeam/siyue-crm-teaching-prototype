'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {emptyState,context,canAccess}=require('../src/business-common.cjs');
const {BusinessStore,validate}=require('../src/business-store.cjs');
const core=require('../src/business-scrm-core.cjs');
const leadOperations=require('../src/business-crm.cjs').operations;
function fixture(){
 let state=emptyState(),seq=0;state.campuses=[{id:'a',name:'甲校区',active:true},{id:'b',name:'乙校区',active:true}];
 const admin={id:'admin',name:'管理员',version:1,scope:{type:'all'},permissions:[...new Set([...core.operations,...leadOperations].map(x=>x.permission)),'student.read','student.update'],roleIds:['superadmin']};
 const sales={id:'sales',name:'销售甲',version:1,scope:{type:'own'},permissions:['lead.create','lead.read','lead.follow','student.read'],roleIds:['sales']};
 const peer={...sales,id:'peer',name:'销售乙'};
 const campusActor={...sales,id:'principal',name:'校长',scope:{type:'campus',campusIds:['a']},permissions:[...sales.permissions,'lead.assign']};
 const directory=[admin,sales,peer,campusActor],registry=new Map([...leadOperations,...core.operations].map(x=>[x.id,x]));
 const ctx=(data,actor=admin)=>context(data,actor,directory,{now:'2030-10-10T02:00:00Z',id:prefix=>`${prefix}-${++seq}`});
 return {admin,sales,peer,campusActor,directory,get state(){return state},ctx,run(id,input,actor=admin){const next=structuredClone(state),operation=registry.get(id);assert(operation);validate(input,operation.inputSchema);const result=operation.run(next,input,ctx(next,actor));state=next;return structuredClone(result);},helper(name,input,actor=admin){const next=structuredClone(state),result=core.helpers[name](next,input,ctx(next,actor));state=next;return structuredClone(result);}};
}
const draft=(extra={})=>({name:'学生甲',contacts:[{name:'家长',relationship:'母亲',phone:'13900001111',primary:true}],campusId:'a',...extra});
const batch=(ids,extra={})=>({title:'秋季回访',taskType:'marketing',customerIds:ids,ownerIds:['sales','peer'],strategy:'even',dueAt:'2030-10-12T10:00:00+08:00',subject:'数学',term:'秋季',...extra});
test('customers keep stable contact IDs, preserve siblings, reject cross-campus edits and stale versions',()=>{
 const f=fixture(),a=f.run('customer.create',draft(),f.sales).record;
 assert.throws(()=>f.run('customer.create',draft(),f.sales),{code:'CUSTOMER_DUPLICATE'});
 const sibling=f.run('customer.create',draft({name:'学生乙'}),f.sales).record;assert.notEqual(a.id,sibling.id);
 f.run('customer.update',{customerId:a.id,patch:{contacts:[{...a.contacts[0],name:'家长新称呼'}]},expectedVersion:a.version},f.sales);
 assert.equal(f.state.customers[0].contacts[0].id,a.contacts[0].id);
 assert.throws(()=>f.run('customer.update',{customerId:a.id,patch:{name:'旧页面'},expectedVersion:a.version},f.sales),{code:'VERSION_CONFLICT'});
 const other=f.run('customer.create',draft({name:'乙校学生',campusId:'b'})).record;
 assert.throws(()=>f.run('customer.update',{customerId:other.id,patch:{note:'越权'}},f.campusActor),{code:'NOT_FOUND'});
});
test('marketing tasks exclude duplicate open needs, scope batch projections, and grant read without customer edit',()=>{
 const f=fixture(),a=f.run('customer.create',draft()).record,b=f.run('customer.create',draft({name:'学生乙',contacts:[{phone:'13900002222'}]})).record;
 const result=f.run('crm.taskBatch.create',batch([a.id,b.id]));assert.equal(result.records.length,2);assert.deepEqual(result.record.assignmentCounts,{sales:1,peer:1});
 const salesTask=result.records.find(x=>x.ownerId==='sales');const customer=f.state.customers.find(x=>x.id===salesTask.customerId);
 assert.equal(canAccess(f.state,f.sales,customer,'customers',{access:'read'}),true);assert.equal(canAccess(f.state,f.sales,customer,'customers',{access:'write'}),false);
 const view=core.helpers.projectRecord(f.state,f.sales,f.state.crmTaskBatches[0],'crmTaskBatches');assert.deepEqual(view.taskIds,[salesTask.id]);assert.deepEqual(view.customerIds,[salesTask.customerId]);assert(!view.ownerIds.includes('peer'));
 const prior=customer.version;f.run('crm.consultation.register',{customerId:customer.id,channel:'phone',note:'客户要求本周联系'},f.sales);assert.equal(f.state.customers.find(x=>x.id===customer.id).version,prior);
 assert.throws(()=>f.run('customer.update',{customerId:customer.id,patch:{note:'不应修改'}},f.sales),{code:'NOT_FOUND'});
 assert.throws(()=>f.run('crm.taskBatch.create',batch([a.id,b.id])),{code:'NO_ELIGIBLE_CUSTOMERS'});
 assert.equal(f.state.orders.length,0);assert.equal(f.state.opportunities.length,0);
});
test('confirmed need reuses active opportunity and completing tasks never manufactures payment',()=>{
 const f=fixture(),customer=f.run('customer.create',draft(),f.sales).record;
 const task=f.run('crm.taskBatch.create',batch([customer.id],{ownerIds:['sales']})).records[0];
 const first=f.run('opportunity.create',{customerId:customer.id,subject:'数学',term:'秋季',skipQualification:true},f.sales);
 const repeat=f.run('opportunity.create',{customerId:customer.id,subject:'数学',term:'秋季',sourceTaskId:task.id},f.sales);
 assert.equal(repeat.reused,true);assert.equal(repeat.record.id,first.record.id);assert.equal(f.state.opportunities.length,1);assert.equal(f.state.crmTasks[0].status,'completed');assert.equal(f.state.crmTaskBatches[0].status,'completed');
 assert.equal(f.state.orders.length,0);assert.equal(f.state.receipts.length,0);
 assert.throws(()=>f.run('opportunity.advance',{opportunityId:first.record.id,stage:'won'},f.sales));
 const record=f.state.opportunities[0];core.helpers.markOpportunityWon(f.state,{id:'order',customerId:customer.id,opportunityId:record.id},{id:'receipt-zero',amountCents:0},f.ctx(f.state));assert.equal(record.stage,'qualified');
 core.helpers.markOpportunityWon(f.state,{id:'order',customerId:customer.id,opportunityId:record.id},{id:'receipt',amountCents:100},f.ctx(f.state));assert.equal(record.stage,'won');assert.equal(record.wonReceiptId,'receipt');
 core.helpers.markOpportunityWon(f.state,{id:'order',customerId:customer.id,opportunityId:record.id},{id:'receipt-later',amountCents:100},f.ctx(f.state));assert.equal(record.wonReceiptId,'receipt');
});
test('quota allocation validates effective deduplicated count and service completion cannot create a sale',()=>{
 const f=fixture(),a=f.run('customer.create',draft()).record,b=f.run('customer.create',draft({name:'学生乙'})).record;
 assert.throws(()=>f.run('crm.taskBatch.create',batch([a.id,b.id],{strategy:'quota',quotas:[{ownerId:'sales',count:2},{ownerId:'peer',count:1}]})));
 assert.equal(f.state.crmTasks.length,0);
 const result=f.run('crm.taskBatch.create',batch([a.id,b.id],{taskType:'service',serviceType:'学习资料回访',strategy:'quota',quotas:[{ownerId:'sales',count:2},{ownerId:'peer',count:0}]}));
 assert(result.records.every(x=>x.ownerId==='sales'));
 f.run('crm.task.complete',{taskId:result.records[0].id,result:'completed',note:'资料已确认收到'},f.sales);
 assert.equal(f.state.opportunities.length,0);assert.equal(f.state.orders.length,0);
 assert.throws(()=>f.run('crm.task.complete',{taskId:result.records[1].id,result:'qualified',note:'不属于服务结果'},f.sales));
});
test('explicit customer merge preserves provenance and rejects conflicting active opportunities atomically',()=>{
 const f=fixture(),a=f.run('customer.create',draft()).record,b=f.run('customer.create',draft({contacts:[{phone:'13900002222'}],grade:'四年级'})).record;
 f.run('touchpoint.create',{customerId:b.id,source:'线下活动'});
 const merged=f.run('customer.merge',{targetCustomerId:a.id,sourceCustomerId:b.id,confirmedSameStudent:true,reason:'与家长核对为同一学生',fieldChoices:{grade:'source'}});
 assert.equal(merged.record.contacts.length,2);assert.equal(merged.record.grade,'四年级');assert.equal(f.state.customers.find(x=>x.id===b.id).status,'merged');assert.equal(f.state.touchpoints[0].customerId,a.id);assert.equal(f.state.touchpoints[0].originalCustomerId,b.id);assert(merged.record.history.at(-1).detail.before);
 const c=f.run('customer.create',draft({name:'重复候选',contacts:[{phone:'13900003333'}]})).record;
 f.run('opportunity.create',{customerId:a.id,subject:'语文',term:'春季'});f.run('opportunity.create',{customerId:c.id,subject:'语文',term:'春季'});
 assert.throws(()=>f.run('customer.merge',{targetCustomerId:a.id,sourceCustomerId:c.id,confirmedSameStudent:true,reason:'冲突待核对'}),{code:'OPPORTUNITY_MERGE_CONFLICT'});assert.equal(f.state.customers.find(x=>x.id===c.id).status,'active');
});
test('legacy lead conversion is explicit and does not turn all historical leads into opportunities',()=>{
 const f=fixture(),known=f.run('customer.create',draft()).record,lead=f.run('lead.create',{name:'学生甲',phone:'13900001111',source:'旧数据',campusId:'a'}).record;
 assert.equal(lead.customerId,undefined);const converted=f.run('customer.fromLead',{leadId:lead.id}).record;
 assert.notEqual(converted.id,known.id);assert.equal(f.state.customers.length,2);assert.equal(f.state.opportunities.length,0);
});
test('repeat imports reuse only an exact student, append acquisition history, and never make opportunities',()=>{
 const f=fixture(),input={name:'学生甲',phone:'13900001111',guardian:'家长',campusId:'a',source:'学校活动',subject:'数学',term:'秋季',importBatchId:'batch-1'};
 const first=f.helper('importAcquisition',input);const second=f.helper('importAcquisition',{...input,importBatchId:'batch-2'});
 assert.equal(first.customer.id,second.customer.id);assert.equal(first.lead.id,second.lead.id);assert.equal(f.state.touchpoints.length,2);assert.deepEqual(f.state.touchpoints.map(x=>x.importBatchId),['batch-1','batch-2']);assert.equal(f.state.opportunities.length,0);
 f.helper('importAcquisition',{...input,name:'妹妹'});assert.equal(f.state.customers.length,2);
});
test('campaign participants can read but cannot edit; published form links are append-only',()=>{
 const f=fixture();f.state.forms.push({id:'form-a',campusId:'a',createdBy:'sales',published:true,version:1});
 const campaign=f.run('campaign.create',{name:'秋季活动',campusId:'a',formIds:['form-a'],participantIds:['peer']},f.sales).record;
 assert.equal(canAccess(f.state,f.peer,campaign,'campaigns',{access:'read'}),true);assert.equal(canAccess(f.state,f.peer,campaign,'campaigns',{access:'write'}),false);
 assert.throws(()=>f.run('campaign.update',{campaignId:campaign.id,patch:{name:'越权'}},f.peer),{code:'NOT_FOUND'});
 f.run('campaign.publish',{campaignId:campaign.id},f.sales);assert.throws(()=>f.run('campaign.update',{campaignId:campaign.id,patch:{formIds:[]}},f.sales),{code:'INVALID_STATE'});
 assert.equal(f.run('campaign.linkForm',{campaignId:campaign.id,formId:'form-a'},f.sales).reused,true);
});
test('customer-student linking records differences, rejects conflicts, and leaves names untouched',()=>{
 const f=fixture(),customer=f.run('customer.create',draft()).record;f.state.students.push({id:'student',name:'学籍姓名',phone:'13900002222',campusId:'a',ownerId:'admin',grade:'五年级',version:1});
 const result=f.run('customer.linkStudent',{customerId:customer.id,studentId:'student',reason:'家长核对后确认同一学生'});
 assert(result.differences.name);assert(result.differences.phone);assert.equal(f.state.customers[0].name,'学生甲');assert.equal(f.state.students[0].name,'学籍姓名');assert.equal(f.state.students[0].customerId,customer.id);
 const other=f.run('customer.create',draft({name:'另一学生'})).record;assert.throws(()=>f.run('customer.linkStudent',{customerId:other.id,studentId:'student',reason:'重复错误关联'}),{code:'CUSTOMER_LINK_CONFLICT'});
});
test('shared-store revision and idempotency prevent concurrent duplicate customer commits',()=>{
 const f=fixture(),store=new BusinessStore(':memory:'),operation=core.operations.find(x=>x.id==='customer.create'),input=draft();delete input.campusId;
 try{const one=store.preview(operation,input,f.admin,f.directory,0,'preview-one'),two=store.preview(operation,{...input,name:'第二学生'},f.admin,f.directory,0,'preview-two');
 const output=store.execute(operation,input,f.admin,f.directory,{revision:0,previewToken:one.previewToken,key:'customer-create-once-0001',requestId:'commit'});
 assert.equal(output.revision,1);assert.throws(()=>store.execute(operation,{...input,name:'第二学生'},f.admin,f.directory,{revision:0,previewToken:two.previewToken,key:'customer-create-once-0002'}),{code:'REVISION_CONFLICT'});
 const replay=store.execute(operation,input,f.admin,f.directory,{revision:0,previewToken:one.previewToken,key:'customer-create-once-0001'});assert.equal(replay.replayed,true);assert.equal(store.snapshot().state.customers.length,1);
 }finally{store.close();}
});
test('transferred service creators and attribution applicants retain read access without edit authority',()=>{
 const f=fixture(),customer=f.run('customer.create',draft(),f.sales).record;
 const ticket={id:'ticket',customerId:customer.id,campusId:'a',createdBy:'sales',ownerId:'peer',status:'open'};
 assert.equal(canAccess(f.state,f.sales,ticket,'serviceTickets',{access:'read'}),true);assert.equal(canAccess(f.state,f.sales,ticket,'serviceTickets',{access:'write'}),false);assert.equal(canAccess(f.state,f.peer,ticket,'serviceTickets',{access:'write'}),true);assert.equal(canAccess(f.state,f.campusActor,ticket,'serviceTickets',{access:'write'}),true);
 const request={id:'request',campusId:'a',createdBy:'sales',applicantId:'sales',ownerId:'peer',status:'pending'};
 assert.equal(canAccess(f.state,f.sales,request,'attributionRequests',{access:'read'}),true);assert.equal(canAccess(f.state,f.sales,request,'attributionRequests',{access:'write'}),false);assert.equal(canAccess(f.state,f.peer,request,'attributionRequests',{access:'write'}),false);assert.equal(canAccess(f.state,f.campusActor,request,'attributionRequests',{access:'write'}),true);
});
test('explicit opportunity financial scope overrides student ownership and historical credit grants read only',()=>{
 const f=fixture(),customer=f.run('customer.create',draft(),f.sales).record;
 f.state.students.push({id:'student',name:'学生甲',ownerId:'sales',customerId:customer.id,campusId:'a'});
 const opportunity={id:'opp',customerId:customer.id,ownerId:'peer',stage:'qualified',campusId:'a'};f.state.opportunities.push(opportunity);
 const order={id:'order',opportunityId:'opp',studentId:'student',ownerId:'peer',campusId:'a',attributionSnapshot:{ownerId:'sales'}};f.state.orders.push(order);
 assert.equal(canAccess(f.state,f.sales,order,'orders',{access:'read'}),true);assert.equal(canAccess(f.state,f.sales,order,'orders',{access:'write'}),false);assert.equal(canAccess(f.state,f.peer,order,'orders',{access:'write'}),true);
 const receipt={id:'receipt',orderId:'order',studentId:'student',ownerId:'sales',campusId:'a'};
 assert.equal(canAccess(f.state,f.sales,receipt,'receipts',{access:'write'}),false);assert.equal(canAccess(f.state,f.peer,receipt,'receipts',{access:'read'}),true);
 assert.equal(canAccess(f.state,f.peer,f.state.students[0],'students',{access:'read'}),true);assert.equal(canAccess(f.state,f.peer,f.state.students[0],'students',{access:'write'}),false);
});
test('form acquisition keeps teacher collection working and never changes another owner legacy identity link',()=>{
 const f=fixture(),teacher={id:'teacher',name:'教师',scope:{type:'assigned'},permissions:['lead.create','student.read'],roleIds:['teacher']};f.directory.push(teacher);f.state.classes.push({id:'class',campusId:'a',teacherId:'teacher'});
 const wrapped=require('../src/business-scrm-hooks.cjs').attachAcquisitionOperations(leadOperations).find(x=>x.id==='lead.create');
 const result=wrapped.run(f.state,{name:'教师收集学生',phone:'13900009999',source:'活动',campusId:'a'},f.ctx(f.state,teacher));assert(result.record.customerId);assert.equal(f.state.opportunities.length,0);
 const lead=f.run('lead.create',{name:'其他顾问学生',phone:'13900008888',source:'历史',campusId:'a',ownerId:'peer'}).record;const raw=f.state.leads.find(x=>x.id===lead.id);raw.collectedByIds=['teacher'];
 const acquired=core.helpers.attachLeadTouch(f.state,raw,{formId:'form',submissionId:'submission',kind:'form'},f.ctx(f.state,teacher));
 assert.equal(acquired.customer,null);assert.equal(acquired.identityLinkPending,true);assert.equal(raw.customerId,undefined);assert.equal(raw.ownerId,'peer');assert.equal(acquired.touchpoint.createdBy,'teacher');
});
test('mixed-campus import batch projection never exposes another campus row or counts',()=>{
 const f=fixture(),a=f.run('customer.create',draft()).record,b=f.run('customer.create',draft({name:'乙校学生',campusId:'b'})).record;
 const batch={id:'batch',createdBy:'admin',campusId:'a',items:[{category:'new_customer',customerId:a.id,data:{name:a.name,campusId:'a'}},{category:'new_customer',customerId:b.id,data:{name:b.name,campusId:'b'}},{category:'invalid',data:{name:'乙校无效行',campusId:'b'}}],summary:{new_customer:2,invalid:1}};
 const projected=core.helpers.projectRecord(f.state,f.campusActor,batch,'importBatches');assert.equal(projected.items.length,1);assert.equal(projected.items[0].customerId,a.id);assert.equal(projected.summary.new_customer,1);assert.equal(projected.summary.invalid,0);assert.equal(projected.total,1);
});
