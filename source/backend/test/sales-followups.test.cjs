'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {emptyState}=require('../src/business-common.cjs');
const {followupRows}=require('../src/business-lead-reports.cjs');
const {BusinessStore}=require('../src/business-store.cjs');
const {createBusinessService}=require('../src/business-service.cjs');
const admin={id:'admin',name:'管理员',roleIds:['superadmin'],permissions:['audit.read'],scope:{type:'all'},version:1};
const sales={id:'sales',name:'销售甲',roleIds:['sales'],permissions:['sales.activity.read','lead.follow'],scope:{type:'own'},version:1};
function fixture(){
 const state=emptyState(),history=[
  {id:'old',at:'2025-01-01T09:00:00+08:00',actorId:'sales',actor:'当时的销售姓名',kind:'跟进',detail:{note:'历史沟通',channel:'电话',nextFollowAt:'2025-01-02T09:00:00+08:00',privateField:'DO_NOT_PROJECT'}},
  {id:'new',at:'2026-10-11T10:00:00+08:00',actorId:'sales',kind:'跟进',detail:{note:'最新沟通',channel:'现场沟通',nextFollowAt:null}},
  {id:'other',at:'2026-10-11T11:00:00+08:00',actorId:'other',kind:'跟进',detail:{note:'其他销售沟通',channel:'电话'}},
  {id:'transfer',at:'2026-10-11T12:00:00+08:00',actorId:'sales',kind:'转移',detail:{note:'不是跟进'}},
  {id:'invalid',at:'invalid',actorId:'sales',kind:'跟进',detail:{note:'无效时间'}}
 ];
 state.leads.push({id:'lead-a',name:'测试学员',ownerId:'sales',campusId:'campus-a',history});
 return state;
}
test('followup records include all historical notes, sort newest first, and page without non-followup events',()=>{
 const state=fixture(),first=followupRows(state,admin,[sales],{employeeId:'sales',limit:1});
 assert.equal(first.items[0].note,'最新沟通');assert.equal(first.items[0].at,'2026-10-11T02:00:00.000Z');assert(first.hasMore);
 const next=followupRows(state,admin,[sales],{employeeId:'sales',limit:1,cursor:first.nextCursor});
 assert.equal(next.items[0].note,'历史沟通');assert.equal(next.items[0].actorName,'当时的销售姓名');assert.equal(next.items[0].nextFollowAt,'2025-01-02T01:00:00.000Z');assert.equal(next.hasMore,false);
 assert(!JSON.stringify(next).includes('DO_NOT_PROJECT'));assert.equal(followupRows(state,admin,[sales],{employeeId:'sales'}).items.length,2);
 assert.throws(()=>followupRows(state,admin,[sales],{employeeId:'sales',cursor:'missing'}),{code:'INVALID_CURSOR'});
});
test('followup rows respect current campus and personal record scope',()=>{
 const state=fixture();state.leads.push({...state.leads[0],id:'lead-outside',campusId:'campus-b',ownerId:'other',history:[{id:'outside',at:'2026-10-11T00:00:00Z',actorId:'sales',kind:'跟进',detail:{note:'外校区内容'}}]});
 const campus={...admin,roleIds:['principal'],scope:{type:'campus',campusIds:['campus-a']}};
 assert.equal(followupRows(state,campus,[sales],{employeeId:'sales'}).items.length,2);
 assert.equal(followupRows(state,sales,[sales],{employeeId:'sales'}).items.length,2);
 assert.equal(followupRows(state,admin,[sales],{employeeId:'sales'}).items.length,3);
});
test('followup API ignores statistical dates, enforces self-only authority, and validates pagination',async t=>{
 const store=new BusinessStore(':memory:'),state=fixture();store.snapshot=()=>({state,revision:0});let actor=admin;
 const service=createBusinessService({store,publicOrigin:'https://crm.example.test',auth:{authorize:()=>actor,directory:()=>[admin,sales],store:{state:{audit:[]}}}});t.after(()=>service.close());
 async function get(query){let result;const req={url:'/v1/sales/activity?'+query,method:'GET',headers:{},requestId:'followup-test',socket:{remoteAddress:'127.0.0.1'}};await service.handle(req,{setHeader(){}},'/v1/sales/activity',(status,payload)=>{result={status,payload};return true});return result;}
 const all=await get('view=followups&employeeId=sales&from=2026-10-11&to=2026-10-11');assert.equal(all.status,200);assert.equal(all.payload.view,'followups');assert.equal(all.payload.items.length,2);
 const first=await get('view=followups&employeeId=sales&limit=1');assert.equal(first.payload.items[0].note,'最新沟通');
 assert.equal((await get('view=followups&employeeId=sales&limit=0')).status,400);
 assert.equal((await get('view=invalid&employeeId=sales')).status,400);
 actor={...sales,scope:{type:'all'}};assert.equal((await get('view=followups&employeeId=other')).status,403);assert.equal((await get('view=followups&employeeId=sales')).status,200);
 actor={...sales,permissions:[]};assert.equal((await get('view=followups&employeeId=sales')).status,403);
});
