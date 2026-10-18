'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {projected}=require('../src/business-service.cjs');
const {emptyState,context}=require('../src/business-common.cjs');
const {operations}=require('../src/business-crm.cjs');
function fixture(){
 const state=emptyState();state.classes=[{id:'class-teacher',campusId:'campus-a',teacherId:'teacher'}];state.campuses=[{id:'campus-a',name:'模拟校区',active:true}];
 const person=(id,permissions,extra={})=>({id,name:id,roleIds:['teacher'],version:1,scope:{type:'assigned',campusIds:[]},permissions,...extra});
 const admin=person('admin',['lead.create','lead.assign','lead.follow'],{roleIds:['superadmin'],scope:{type:'all',campusIds:[]}});
 const teacher=person('teacher',['lead.create']);
 const sales=person('sales',['lead.follow'],{roleIds:['sales'],scope:{type:'campus',campusIds:['campus-a']}});
 const reset=person('reset',['lead.follow'],{mustChangePassword:true,scope:{type:'all'}});
 const disabled=person('disabled',['lead.follow'],{disabled:true,scope:{type:'all'}});
 return {state,admin,teacher,sales,directory:[admin,teacher,sales,reset,disabled]};
}
test('lead owner choices expose only currently eligible follow-up staff and minimal campus choices',()=>{
 const f=fixture(),data=projected({state:f.state,revision:1},f.admin,f.directory).state;
 assert.deepEqual(data.leadOwnerOptions.map(row=>row.id),['admin','sales']);
 assert.deepEqual(data.leadOwnerOptions[1].campusIds,['campus-a']);
 assert.deepEqual(Object.keys(data.leadOwnerOptions[1]).sort(),['campusIds','employeeNo','id','name']);
});
test('ordinary teacher can register without an assignee and cannot assign sales ownership',()=>{
 const f=fixture(),ctx=context(f.state,f.teacher,f.directory,{now:'2030-10-10T02:00:00Z',id:prefix=>prefix+'-test'});
 const input={name:'模拟学员',phone:'13900001111',source:'模拟验收',campusId:'campus-a'};
 const record=operations.find(op=>op.id==='lead.create').run(f.state,input,ctx).record;
 assert.equal(record.registrarId,f.teacher.id);assert.equal(record.ownerId,null);assert.equal(record.decisionStatus,'public');
 const choices=projected({state:f.state,revision:1},f.teacher,f.directory).state.leadOwnerOptions;
 assert.deepEqual(choices,[]);
 assert.throws(()=>operations.find(op=>op.id==='lead.create').run(f.state,{...input,name:'第二模拟学员',ownerId:'sales'},ctx),{code:'FORBIDDEN'});
});
test('assignment validation still rejects a teacher who has registration but no follow-up permission',()=>{
 const f=fixture(),ctx=context(f.state,f.admin,f.directory,{now:'2030-10-10T02:00:00Z',id:prefix=>prefix+'-test'});
 assert.throws(()=>operations.find(op=>op.id==='lead.create').run(f.state,{name:'模拟学员',phone:'13900001111',source:'模拟验收',campusId:'campus-a',ownerId:'teacher'},ctx),/跟进权限/);
});
