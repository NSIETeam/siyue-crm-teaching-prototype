'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {emptyState}=require('../src/business-common.cjs');
const {scopedAuditEvents,selectAuditPage}=require('../src/audit-query.cjs');
const {activityRows}=require('../src/business-lead-reports.cjs');
const {projected}=require('../src/business-service.cjs');
function fixture(){
 const state=emptyState(),actor={id:'manager-a',roleIds:['principal'],permissions:['audit.read'],scope:{type:'campus',campusIds:['A']}};
 state.leads=[{id:'a',campusId:'A',name:'可见线索'},{id:'b',campusId:'B',name:'不可见姓名'}];
 const directory=[actor,{id:'admin',name:'全域管理员',scope:{type:'all'}},{id:'multi',scope:{type:'campus',campusIds:['A','B']}},{id:'peer-a',scope:{type:'campus',campusIds:['A']}}];
 const events=[['mixed',['a','b']],['foreign',['b']],['visible',['a']]].map(([id,ids],i)=>({id,at:`2026-10-12T0${3-i}:00:00.000Z`,actorId:'admin',action:'lead.assign',outcome:'success',details:{resultCount:ids.length,changes:ids.map(id=>({id,collection:'leads',after:state.leads.find(x=>x.id===id)}))}}));
 events.push(...['admin','multi','peer-a'].map(id=>({id:'login-'+id,at:'2026-10-12T00:00:00.000Z',actorId:id,action:'auth.login',outcome:'success'})));
 return {state,actor,directory,events};
}
test('campus audit scopes individual changes before counts, search and pagination',()=>{
 const {state,actor,directory,events}=fixture();const scoped=scopedAuditEvents(events,actor,directory,state);
 assert.deepEqual(scoped.map(e=>e.id),['mixed','visible','login-peer-a']);
 assert.deepEqual(scoped[0].details.changes.map(x=>x.id),['a']);assert.equal(scoped[0].details.resultCount,undefined);
 const page=selectAuditPage(scoped,directory,new URLSearchParams('actorQuery=全域管理员&limit=1'),state);
 assert.equal(page.hasMore,true);assert.equal(page.nextBefore,'mixed');assert(!JSON.stringify(page).includes('不可见'));
 const next=selectAuditPage(scoped,directory,new URLSearchParams('actorId=admin&before=mixed&limit=1'),state);assert.equal(next.events[0].id,'visible');assert.equal(next.hasMore,false);
 assert.throws(()=>selectAuditPage(scoped,directory,new URLSearchParams('before=foreign'),state),{code:'INVALID_CURSOR'});
 assert.equal(scopedAuditEvents(events,{...actor,scope:{type:'all'}},directory,state).length,events.length);
});
test('sales activity follows the same campus filter even for global or multi-campus actors',()=>{
 const {state,actor,directory,events}=fixture();const result=activityRows(state,actor,directory,{employeeId:'admin',limit:50,auditEvents:events});
 assert.deepEqual(result.items.map(e=>e.id),['audit:mixed','audit:visible']);
 assert.deepEqual(result.items[0].summary.changes,[{collection:'leads',id:'a'}]);assert.equal(result.items[0].summary.resultCount,undefined);
});
test('own audit retains personal action metadata without revealing former or unknown targets',()=>{
 const {state,directory,events}=fixture(),actor={id:'admin',scope:{type:'own'}};
 const scoped=scopedAuditEvents(events,actor,directory,state),page=selectAuditPage(scoped,directory,new URLSearchParams(),state);
 assert(page.events.length>0);assert(page.events.every(e=>e.actorId==='admin'));
 assert(!JSON.stringify(page).includes('可见线索'));assert(!JSON.stringify(page).includes('不可见姓名'));
 assert(page.events.every(e=>!e.summary.changes?.length));
 assert.deepEqual(scopedAuditEvents(events,{...actor,disabled:true},directory,state),[]);
});
test('selection directory omits employee numbers and authorization configuration; staff profile remains separately gated',()=>{
 const state=emptyState(),actor={id:'teacher',scope:{type:'assigned'},permissions:['student.read'],roleIds:['teacher']},directory=[{id:'sales',name:'销售',employeeNo:'PRIVATE-EMP-NO',scope:{type:'own',campusIds:[]},roleIds:['sales'],disabled:false},{id:'off',name:'离职',disabled:true,scope:{type:'all'}}];
 const result=projected({state,revision:0},actor,directory).state;
 assert.deepEqual(result.directory,[{id:'sales',name:'销售',roleIds:['sales']}]);assert.deepEqual(result.staff,[]);
 assert(!JSON.stringify(result).includes('PRIVATE-EMP-NO'));
});
