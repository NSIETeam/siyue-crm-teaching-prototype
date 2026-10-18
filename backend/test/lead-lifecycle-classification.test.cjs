'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {emptyState,context}=require('../src/business-common.cjs');
const {BusinessStore,validate}=require('../src/business-store.cjs');
const {projected}=require('../src/business-service.cjs');
const query=require('../src/business-scrm-query.cjs'),{reports}=require('../src/business-scrm-reports.cjs'),imports=require('../src/business-scrm-import.cjs');
const operations=require('../src/business-scrm-hooks.cjs').attachAcquisitionOperations(['academic','crm','commerce','teacher-workflow','scrm-core','scrm-service','scrm-import','scrm-views'].flatMap(name=>require('../src/business-'+name+'.cjs').operations));
function fixture(){
 let state=emptyState(),counter=0;const all=[...new Set(operations.map(op=>op.permission)),'lead.read','student.read','order.read','refund.read','report.read','lead.conversion.read'];
 const admin={id:'admin',name:'管理员',version:1,permissions:all,scope:{type:'all'},roleIds:['superadmin']};
 const sales={id:'sales',name:'顾问甲',version:1,permissions:['lead.create','lead.read','lead.follow','student.read','order.read','enrollment.create','lead.conversion.read'],scope:{type:'own'},roleIds:['sales']},peer={...sales,id:'peer',name:'顾问乙'};
 const manager={...admin,id:'manager',name:'主管',roleIds:['principal'],scope:{type:'campus',campusIds:['a']},permissions:['lead.read','lead.create','lead.follow','lead.assign','order.read','student.read','report.read','lead.conversion.read']};
 const directory=[admin,sales,peer,manager],registry=new Map(operations.map(op=>[op.id,op]));
 state.campuses=[{id:'a',name:'甲校区',active:true,roomDetails:[{name:'101',capacity:20}]}];
 for(const [id,subject,price] of [['math','数学',1000],['english','英语',2000]]){state.courses.push({id,name:subject,grade:'小学四年级',subject,active:true,priceCents:price,lessons:[{id:id+'-lesson',title:'第一讲'}],version:1});state.classes.push({id:id+'-class',courseId:id,campusId:'a',campus:'甲校区',teacherId:'teacher',room:'101',capacity:20,active:true,status:'进行中',schedule:[],studentIds:[],version:1});}
 const now='2030-10-10T02:00:00Z',ctx=(data,actor=admin)=>context(data,actor,directory,{now,id:prefix=>prefix+'-'+(++counter)});
 return {admin,sales,peer,manager,directory,now,registry,ctx,get state(){return state},run(id,input,actor=admin){const candidate=structuredClone(state),operation=registry.get(id);assert(operation,id);validate(input,operation.inputSchema);const result=operation.run(candidate,input,ctx(candidate,actor));state=candidate;return structuredClone(result);},view(actor){return projected({state,revision:1},actor,directory).state},query(actor,input){return query.query({state,revision:1},actor,directory,input,projected({state,revision:1},actor,directory).state,Date.parse(now));},report(actor,input={}){return reports({state,revision:1},actor,directory,input,projected({state,revision:1},actor,directory).state,Date.parse(now));}};
}
function customer(f){return f.run('customer.create',{name:'学生甲',grade:'小学四年级',campusId:'a',contacts:[{phone:'13900001111',name:'家长',primary:true}]},f.sales).record;}
function twoOrders(f){const c=customer(f),math=f.run('opportunity.create',{customerId:c.id,subject:'数学',term:'秋季'},f.sales).record,english=f.run('opportunity.create',{customerId:c.id,subject:'英语',term:'秋季',ownerId:'peer'}).record;const first=f.run('enrollment.create',{classId:'math-class',opportunityId:math.id,studentDraft:{name:c.name,phone:c.phone}},f.sales);const second=f.run('enrollment.create',{classId:'english-class',opportunityId:english.id,studentId:first.student.id},f.peer);return {customer:c,math,english,first,second};}
test('unified lifecycle classifies historical rows and only assigned unconverted leads as active',()=>{
 const f=fixture();const first=f.run('lead.create',{name:'合成未分配',phone:'13900001001',source:'test'}).record;
 const second=f.run('lead.create',{name:'合成已分配',phone:'13900001002',source:'test',ownerId:f.sales.id}).record;
 assert.equal(first.intent,'未标记');assert.equal(second.stage,'跟进中');
 let all=f.query(f.admin,{resource:'leads',scope:'team'});assert.equal(all.items.find(r=>r.id===first.id).stage,'待分配');assert.equal(all.items.find(r=>r.id===second.id).stage,'跟进中');
 const active=f.query(f.admin,{resource:'leads',scope:'team',queue:'active'});assert.deepEqual(active.items.map(r=>r.id),[second.id]);assert.equal(active.total,1);
 const projected=f.view(f.admin);assert.equal(projected.leads.find(r=>r.id===first.id).stage,'待分配');assert.equal(projected.leads.find(r=>r.id===second.id).stage,'跟进中');
});
test('intent is explicitly recorded, audited and filterable without changing lifecycle',()=>{
 const f=fixture();const lead=f.run('lead.create',{name:'合成意向',phone:'13900001003',source:'test',ownerId:f.sales.id}).record;
 for(const [disposition,intent] of [['high','高意向'],['medium','中意向'],['low','低意向']]){
  const result=f.run('lead.followup',{leadId:lead.id,note:'合成沟通内容',channel:'电话',disposition,nextFollowAt:'2030-10-10T10:00:00Z'},f.sales).record;
  assert.equal(result.intent,intent);assert.equal(result.stage,'跟进中');assert.equal(result.history.at(-1).detail.disposition,disposition);
  const filtered=f.query(f.sales,{resource:'leads',queue:'active',intent,followupQueue:'today'});assert.equal(filtered.total,1);assert.equal(filtered.items[0].id,lead.id);
 }
 assert.equal(f.query(f.sales,{resource:'leads',queue:'active',intent:'高意向'}).total,0);
 assert.throws(()=>f.run('lead.followup',{leadId:lead.id,note:'合成',channel:'电话',disposition:'fake'},f.sales));
 assert.throws(()=>f.run('lead.followup',{leadId:lead.id,note:'无权修改',channel:'电话',disposition:'high'},f.peer));
});
test('timing filters intersect main categories and retain decision/authorization boundaries',()=>{
 const f=fixture();f.run('lead.create',{name:'合成待分配',phone:'13900001004',source:'test'});
 const lead=f.run('lead.create',{name:'合成待联系',phone:'13900001005',source:'test',ownerId:f.sales.id}).record;
 assert.equal(f.query(f.admin,{resource:'leads',scope:'team',queue:'active',followupQueue:'firstContact'}).total,1);
 assert.equal(f.query(f.admin,{resource:'leads',scope:'team',queue:'unassigned',followupQueue:'firstContact'}).total,0);
 assert.equal(f.query(f.peer,{resource:'leads',queue:'active'}).total,0);
 assert.throws(()=>f.query(f.sales,{resource:'leads',scope:'team'}));
 assert.throws(()=>f.query(f.admin,{resource:'leads',followupQueue:'invented'}));
 const pending=f.run('lead.create',{name:'合成待决策',phone:'13900001006',source:'test'},f.sales).record;
 assert.throws(()=>f.run('lead.followup',{leadId:pending.id,note:'合成',channel:'电话',disposition:'high'},f.sales));
 assert.equal(f.query(f.sales,{resource:'leads',queue:'decision'}).total,1);
});
test('pending order is not conversion and positive real receipt automatically converts; cannot manually mark won or lose a converted lead',()=>{
 const f=fixture();const lead=f.run('lead.create',{name:'合成报名',phone:'13900001007',source:'test',ownerId:f.sales.id}).record;
 const order=f.run('enrollment.create',{classId:'math-class',studentDraft:{name:lead.name,phone:lead.phone,originLeadId:lead.id}},f.sales).order;
 assert.equal(f.query(f.sales,{resource:'leads',queue:'converted'}).total,0);assert.equal(f.query(f.sales,{resource:'leads',queue:'active'}).total,1);
 f.run('order.confirmReceipt',{orderId:order.id,amountCents:100,method:'bank',reference:'synthetic-lifecycle-receipt'});
 const done=f.query(f.sales,{resource:'leads',queue:'converted'});assert.equal(done.total,1);assert.equal(done.items[0].stage,'已成单');assert.equal(done.items[0].canonicalConverted,true);assert.equal(f.query(f.sales,{resource:'leads',queue:'active'}).total,0);
 assert.equal(f.view(f.sales).leads[0].stage,'已成单');
 assert.throws(()=>f.run('lead.status.update',{leadId:lead.id,stage:'已成单'},f.sales));
 assert.throws(()=>f.run('lead.followup',{leadId:lead.id,note:'不允许流失',channel:'电话',disposition:'lost_cold'},f.sales));
 assert.throws(()=>f.run('lead.release',{leadId:lead.id},f.admin));
});
test('lost followup preserves evidence, clears the callback and exits active queues',()=>{
 const f=fixture();const lead=f.run('lead.create',{name:'合成流失',phone:'13900001008',source:'test',ownerId:f.sales.id}).record;
 f.run('lead.followup',{leadId:lead.id,note:'明确不再考虑',channel:'电话',disposition:'lost_cold',nextFollowAt:'2030-10-10T10:00:00Z'},f.sales);
 const row=f.query(f.sales,{resource:'leads',queue:'cold'}).items[0];assert(row);assert.equal(row.nextFollowAt,null);assert.equal(row.history.at(-1).detail.note,'明确不再考虑');assert.equal(f.query(f.sales,{resource:'leads',queue:'active'}).total,0);
});
