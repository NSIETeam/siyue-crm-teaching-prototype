'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createRequire}=require('node:module');

const authSource=fs.readFileSync(path.join(__dirname,'employee-auth.cjs'),'utf8').split('const user=')[0];
const authCreate=new Function('require','__dirname',authSource+';return create')(createRequire(path.join(__dirname,'employee-auth.cjs')),__dirname);
const businessApi=fs.readFileSync(path.join(__dirname,'../business-api.js'),'utf8');
const response=(body,status=200)=>({ok:status<400,status,json:async()=>body});
const baseUser={id:'search-user',name:'员工',username:'search-user',roleIds:['sales'],permissions:['dashboard.read','lead.read'],scope:{type:'own'},mustChangePassword:false,version:1};

const policyOperation={id:'lead.policy.update',label:'设置保留与回收策略',permission:'leadPolicy.publish',implemented:true,execution:'server',inputSchema:{type:'object',additionalProperties:false,properties:{reserveDays:{type:'integer'},reclaimDays:{type:'integer'},firstFollowHours:{type:'integer'},decisionHours:{type:'integer'}},required:['reserveDays','reclaimDays','firstFollowHours']}};
async function create(actor,operations=[]){
 const b=await authCreate(actor);
 const businessCalls=[];b.respond(async url=>{
  const endpoint=String(url);
  businessCalls.push(endpoint);
  if(endpoint.endsWith('/v1/state'))return response({revision:1,capabilities:{businessReady:true},state:{courses:[],classes:[],students:[],leads:[],orders:[],campuses:[],staff:[],dictionary:{},settings:{},leadPolicy:{reserveDays:10,reclaimDays:35,firstFollowHours:2,decisionHours:48},activities:{coupon:[],group:[],joint:[]},forms:[],decor:{},directory:[]}});
  if(endpoint.endsWith('/v1/catalog'))return response({operations:operations.filter(op=>actor.permissions.includes(op.permission))});
  if(endpoint.endsWith('/v1/roles'))return response({roles:[{id:'sales',label:'销售',defaultScope:'own',permissions:[],version:1,editable:true}],permissions:[]});
  if(endpoint.endsWith('/v1/admin/users'))return response({users:[]});
  return response({});
 });
 b.run(businessApi);
 await new Promise(resolve=>setImmediate(resolve));
 b.businessCalls=businessCalls;
 return b;
}

test('authenticated superadmin global search finds employee account, permission and departure actions',async()=>{
 const admin=await create({...baseUser,roleIds:['superadmin'],permissions:['dashboard.read','account.update','role.grant'],scope:{type:'all'}});
 for(const [query,label,page] of [['离职','员工离职归档','staff'],['账号管理','员工账号与权限','staff'],['修改员工权限','修改员工权限','staff'],['个人权限','修改员工权限','staff'],['修改角色权限','修改角色权限','permissions'],['角色权限','修改角色权限','permissions']]){
  const entry=admin.run(`workflowSearchEntries(${JSON.stringify(query)}).find(item=>item.label===${JSON.stringify(label)})`);
  assert.ok(entry,`search should expose ${label} for the authenticated superadmin`);
  assert.equal(entry.meta,'员工管理');
  entry.action();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(admin.run('state.page'),page,`${label} opens the authenticated employee workspace`);
  assert.doesNotMatch(admin.elements.get('#view').innerHTML,/id="business-form"/);
 }
});

test('employee management search actions stay hidden from non-superadmins even with account.update text grant',async()=>{
 const actor=await create({...baseUser,permissions:['dashboard.read','account.update','role.grant']});
 for(const query of ['离职','账号管理','修改员工权限','个人权限','修改角色权限','角色权限']){
  const entries=actor.run(`workflowSearchEntries(${JSON.stringify(query)})`);
  assert.equal(entries.some(item=>item.meta==='员工管理'),false,`${query} must not expose a superadmin-only route`);
 }
});

test('authorized global search opens the lead retention policy draft without running it and deduplicates aliases',async()=>{
 const admin=await create({...baseUser,roleIds:['superadmin'],permissions:['dashboard.read','leadPolicy.publish'],scope:{type:'all'}},[policyOperation]);
 for(const query of ['线索保留','线索保留与回收策略设置','回收策略设置','保留与回收策略设置']){
  const matches=admin.run(`workflowSearchEntries(${JSON.stringify(query)}).filter(item=>item.meta==='线索策略'||item.label==='设置保留与回收策略')`);
  assert.equal(matches.length,1,`${query} should produce one policy destination`);
  assert.equal(matches[0].label,'线索保留与回收策略设置');
  assert.equal(matches[0].meta,'线索策略');
  assert.equal(matches[0].action(),true);
  assert.equal(admin.run('businessAPI.status().operation'),'lead.policy.update');
  assert.deepEqual(JSON.parse(admin.run('JSON.stringify(businessAPI.academicDraft().draft)')),{reserveDays:10,reclaimDays:35,firstFollowHours:2,decisionHours:48});
  assert.equal(admin.run('businessAPI.status().busy'),false,'opening the settings form must not start a request');
  assert.equal(admin.businessCalls.some(url=>/operations\/lead\.policy\.update\/(preview|execute)$/.test(url)),false,'search navigation must not preview or execute');
  admin.run('businessAPI.back()');
 }
});

test('lead retention policy search respects both publish permission and global data scope',async()=>{
 const withoutGrant=await create({...baseUser,roleIds:['superadmin'],permissions:['dashboard.read'],scope:{type:'all'}},[policyOperation]);
 assert.equal(withoutGrant.run("workflowSearchEntries('线索保留').some(item=>item.meta==='线索策略')"),false);
 const scoped=await create({...baseUser,permissions:['dashboard.read','leadPolicy.publish'],scope:{type:'campus',campusIds:['campus-a']}},[policyOperation]);
 assert.equal(scoped.run("workflowSearchEntries('线索保留').some(item=>item.meta==='线索策略')"),false);
});
