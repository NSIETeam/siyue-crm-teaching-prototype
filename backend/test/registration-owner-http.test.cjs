'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/remaining-http.cjs');
test('real role authentication, registration preview/commit/replay and campus routing enforce the same ownership policy',async t=>{
 const f=await fixture(t),sales=await f.employee({roleIds:['sales'],scope:{type:'own'}}),operator=await f.employee({roleIds:['operations'],scope:{type:'campus',campusIds:['A']}});
 assert(!sales.user.permissions.includes('lead.assign'));assert(!operator.user.permissions.includes('lead.assign'));
 const own=await f.execute('lead.create',{name:'HTTP昵称',phone:'13900001301',source:'隔离验证',campusId:'A',ownerId:sales.user.id},sales);assert.equal(own.result.record.ownerId,sales.user.id);assert.equal(own.result.record.stage,'新线索');assert.equal(own.result.record.nextFollowAt,null);
 const replay=await f.commit('lead.create',own.plan,sales);assert.equal(replay.status,200);
 const unassigned=await f.execute('lead.create',{name:'HTTP公海',phone:'13900001302',source:'隔离验证',campusId:'A',ownerId:''},sales);assert.equal(unassigned.result.record.decisionStatus,'public');assert.equal(unassigned.result.record.ownerId,null);
 const state=await f.state(operator);assert(state.state.leadOwnerOptions.some(row=>row.id===sales.user.id));
 const handoff=await f.execute('lead.create',{name:'HTTP运营指定',phone:'13900001303',source:'隔离验证',campusId:'A',ownerId:sales.user.id},operator);assert.equal(handoff.result.record.ownerId,sales.user.id);assert.equal(handoff.result.record.registrarId,operator.user.id);
 const denied=await f.plan('lead.assign',{leadId:handoff.result.record.id,ownerId:operator.user.id},operator);assert.equal(denied.response.status,403);
 const cross=await f.plan('lead.create',{name:'越界不得保存',phone:'13900001304',source:'隔离验证',campusId:'B',ownerId:sales.user.id},operator);assert.notEqual(cross.response.status,200);
 const saved=await f.state(f.admin);assert.equal(saved.state.leads.length,3);assert.equal(saved.state.leads.find(r=>r.id===unassigned.result.record.id).ownerId,null);
});
