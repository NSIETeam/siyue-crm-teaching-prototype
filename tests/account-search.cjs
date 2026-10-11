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

async function create(actor){
 const b=await authCreate(actor);
 b.respond(async url=>{
  const endpoint=String(url);
  if(endpoint.endsWith('/v1/state'))return response({revision:1,capabilities:{businessReady:true},state:{courses:[],classes:[],students:[],leads:[],orders:[],campuses:[],staff:[],dictionary:{},settings:{},activities:{coupon:[],group:[],joint:[]},forms:[],decor:{},directory:[]}});
  if(endpoint.endsWith('/v1/catalog'))return response({operations:[]});
  if(endpoint.endsWith('/v1/roles'))return response({roles:[{id:'sales',label:'销售',defaultScope:'own',permissions:[],version:1,editable:true}],permissions:[]});
  if(endpoint.endsWith('/v1/admin/users'))return response({users:[]});
  return response({});
 });
 b.run(businessApi);
 await new Promise(resolve=>setImmediate(resolve));
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
