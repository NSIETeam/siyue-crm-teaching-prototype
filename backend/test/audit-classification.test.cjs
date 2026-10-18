'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {selectAuditPage}=require('../src/audit-query.cjs');
const {fixture}=require('./helpers/remaining-http.cjs');
const reads=['crm.query','crm.workbench','crm.reports','crm.trials.read','crm.leadOwners.read','crm.import.inspect','student.communications','attendance.query','read.workbench','read.crm/reception'];
test('successful navigation reads stay in all-records but never masquerade as committed daily business',()=>{
 const events=reads.map((action,i)=>({id:'read'+i,at:'2030-10-18T01:00:00Z',action,outcome:'success',actorId:'A'}));
 events.push({id:'write',at:'2030-10-18T01:00:00Z',action:'trial.request',outcome:'success',actorId:'A'},{id:'export',at:'2030-10-18T01:00:00Z',action:'attendance.export',outcome:'success',actorId:'A'});
 const activity=selectAuditPage(events,[],new URLSearchParams('view=activity'));assert.deepEqual(activity.events.map(e=>e.id),['write','export']);
 const all=selectAuditPage(events,[],new URLSearchParams('view=all'));assert.equal(all.events.length,events.length);assert(all.events.filter(e=>e.id.startsWith('read')).every(e=>e.category==='system'));assert.equal(selectAuditPage(events,[],new URLSearchParams('view=attention')).events.length,0);
});
test('denied reads remain visible in attention and unknown actions are not silently hidden',()=>{
 const events=reads.map((action,i)=>({id:'denied'+i,at:'2030-10-18T01:00:00Z',action,outcome:'denied',actorId:'A'}));
 events.push({id:'unknown',at:'2030-10-18T01:00:00Z',action:'future.operation',outcome:'success',actorId:'A'});
 assert.equal(selectAuditPage(events,[],new URLSearchParams('view=attention')).events.length,reads.length);assert.equal(selectAuditPage(events,[],new URLSearchParams('view=all')).events.length,events.length);assert.deepEqual(selectAuditPage(events,[],new URLSearchParams('view=activity')).events.map(e=>e.id),['unknown']);
});
test('real CRM reads do not pollute activity pagination and audit rows remain durably stored',async t=>{
 const f=await fixture(t);await f.execute('student.create',{name:'审计隔离学生',phone:'13900008666',campusId:'A'});
 for(const route of ['/v1/crm/query?resource=leads&scope=team','/v1/crm/reports','/v1/crm/trials/requests','/v1/attendance/query']){const r=await f.call(f.admin,route);assert.equal(r.status,200,route+' '+JSON.stringify(r.body));}
 const all=(await f.call(f.admin,'/v1/admin/audit?view=all')).body.events;for(const action of ['crm.query','crm.reports','crm.trials.read','attendance.query'])assert(all.some(e=>e.action===action),action);
 const activity=(await f.call(f.admin,'/v1/admin/audit?view=activity&limit=1&actionPrefix=student.')).body;assert.equal(activity.events[0].action,'student.create');assert.equal(activity.events[0].outcome,'success');
 const daily=(await f.call(f.admin,'/v1/admin/audit?view=activity')).body.events;assert(!daily.some(e=>reads.includes(e.action)));assert(f.database(s=>s.auditEvents()).some(e=>e.action==='crm.query'));
});
