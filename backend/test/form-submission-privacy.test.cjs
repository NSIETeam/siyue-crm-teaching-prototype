'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {emptyState,context}=require('../src/business-common.cjs');
const {operations}=require('../src/business-commerce.cjs');
const {projected}=require('../src/business-service.cjs');

test('approved survey answers stay with the publisher and form owner, not other employees who can see the form',()=>{
 const state=emptyState(),publisher={id:'publisher',name:'发布者',roleIds:[],scope:{type:'own'},permissions:['lead.create']};
 state.campuses=[{id:'A',name:'甲校区',active:true}];
 const form={id:'form-a',title:'家长问卷',kind:'survey',collectLead:false,campusId:'A',createdBy:'creator',publishedBy:'publisher',published:true,status:'已发布',version:1,fields:[],settings:{quantity:10,maxPerIdentity:1},submissions:[{id:'approved-a',publisherId:'publisher',status:'approved',answersById:{name:'试课孩子',phone:'13900001111',note:'家庭的问卷回答'}}]};
 state.forms=[form];
 const actors=[
  {id:'campus-sales',name:'校区销售',roleIds:['sales'],scope:{type:'campus',campusIds:['A']},permissions:['lead.create']},
  {id:'other-manager',name:'其他管理人员',roleIds:[],scope:{type:'all'},permissions:['lead.create']},
  {id:'other-teacher',name:'其他教师',roleIds:['teacher'],scope:{type:'assigned'},permissions:['lead.create']}
 ];
 for(const actor of actors){
  const view=projected({revision:1,state},actor,[actor]).state;
  assert.equal(view.forms.length,1);
  assert.equal(view.forms[0].submissions.length,0);
  assert(!JSON.stringify(view).includes('13900001111'));
  assert(!JSON.stringify(view).includes('家庭的问卷回答'));
 }
 for(const actor of [publisher,{...publisher,id:'creator'},{...publisher,id:'admin',scope:{type:'all'},roleIds:['superadmin']}]){
  assert.equal(projected({revision:1,state},actor,[actor]).state.forms[0].submissions[0].answersById.phone,'13900001111');
 }
 const editor=actors[1],result=operations.find(op=>op.id==='form.update').run(state,{formId:form.id,patch:{title:'问卷新标题'}},context(state,editor,[editor]));
 assert.equal(result.record.submissions.length,0);
 assert.equal(state.forms[0].submissions[0].answersById.phone,'13900001111');
});
