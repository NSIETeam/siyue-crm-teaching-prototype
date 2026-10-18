'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const crypto=require('node:crypto');
const {once}=require('node:events');
const {bootstrap}=require('../src/bootstrap-auth.cjs');
const {createServer}=require('../src/server.cjs');
const {tokenHash}=require('../src/auth-credentials.cjs');

const origin='https://crm.example.test';
const password='Role-Business!9362Aa';

function request(server,url,method='GET',data,headers={}){
 return new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:url,method,headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...headers}},res=>{
   let raw='';res.on('data',chunk=>raw+=chunk);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(raw)});}catch(error){reject(error);}});
  });
  req.on('error',reject);req.end(data===undefined?undefined:JSON.stringify(data));
 });
}

async function fixture(t,label='role-business'){
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),`siyue-${label}-`)));
 const authFile=path.join(dir,'auth.json'),delivery=path.join(dir,'initial.json');
 bootstrap(authFile,delivery);
 const initial=JSON.parse(fs.readFileSync(delivery,'utf8'));
 let server;
 const start=async()=>{server=createServer({auth:{storeFile:authFile,publicOrigin:origin,captchaOptions:{randomInt:()=>4}},business:{storeFile:path.join(dir,'business.sqlite')}});server.listen(0,'127.0.0.1');await once(server,'listening');};
 const stop=async()=>{if(server?.listening)await new Promise(resolve=>server.close(resolve));};
 await start();
 t.after(async()=>{await stop();fs.rmSync(dir,{recursive:true,force:true});});
 const call=(token,url,method='GET',data)=>request(server,url,method,data,{Authorization:'Bearer '+token});
 const login=(username,pw)=>request(server,'/v1/auth/login','POST',{username,password:pw,client:'cli'});
 const first=await login(initial.username,initial.initialPassword);assert.equal(first.status,200);
 assert.equal((await call(first.body.token,'/v1/auth/password','POST',{currentPassword:initial.initialPassword,newPassword:password})).status,200);
 const admin=(await login(initial.username,password)).body;assert.ok(admin.token);
 const employee=async({name,employeeNo,deniedPermissions=[],additionalPermissions=[]})=>{
  const created=await call(admin.token,'/v1/admin/users','POST',{name,employeeNo,roleIds:['sales'],scope:{type:'own'},deniedPermissions,additionalPermissions});
  assert.equal(created.status,201,JSON.stringify(created.body));
  const initialLogin=await login(created.body.user.username,created.body.initialPassword);assert.equal(initialLogin.status,200);
  assert.equal((await call(initialLogin.body.token,'/v1/auth/password','POST',{currentPassword:created.body.initialPassword,newPassword:password})).status,200);
  const active=await login(created.body.user.username,password);assert.equal(active.status,200);
  return {user:active.body.user,token:active.body.token};
 };
 const reopen=async()=>{await stop();await start();};
 return {dir,authFile,initial,admin,server:()=>server,call,login,employee,reopen};
}


const annotation={page:'/crm/',pageTitle:'模拟功能验收',elementKind:'button',elementLabel:'模拟按钮',selector:'button[data-action="acceptance"]',issue:'模拟验收建议，不含业务记录'};
test('acceptance registry contains every current catalog schema including trial approval without record data',async t=>{const f=await fixture(t,'registry-full-acceptance');const reg=await f.call(f.admin.token,'/v1/admin/feature-registry');assert.equal(reg.status,200);const catalog=await f.call(f.admin.token,'/v1/catalog');for(const op of catalog.body.operations){const item=reg.body.businessOperations.find(x=>x.id===op.id);assert(item,op.id);assert.deepEqual(item.inputSchema,op.inputSchema,op.id);assert.equal(item.preview.required,true);assert.equal(item.execute.requiresIdempotencyKey,true);}for(const id of ['trial.request','trial.cancel','trial.review'])assert(reg.body.businessOperations.some(x=>x.id===id));assert(!JSON.stringify(reg.body).includes(f.admin.token));const sales=await f.employee({name:'模拟注册表无权人员',employeeNo:'REG-QA'});assert.equal((await f.call(sales.token,'/v1/admin/feature-registry')).status,403);});
test('acceptance interface and workflow annotations persist, resolve and reopen with audit and admin-only access',async t=>{const f=await fixture(t,'annotation-full-acceptance');const created=await f.call(f.admin.token,'/v1/admin/ui-annotations','POST',annotation);assert.equal(created.status,201);const id=created.body.annotation.id;assert.equal(created.body.annotation.status,'open');const workflow=await f.call(f.admin.token,'/v1/admin/ui-annotations','POST',{...annotation,category:'workflow',workflowName:'模拟审核流程',flowDefinition:'提交 -> 复核',desiredFlowDefinition:'提交 -> 校区复核 -> 安排课次'});assert.equal(workflow.status,201);assert.equal(workflow.body.annotation.desiredFlowDefinition,'提交 -> 校区复核 -> 安排课次');const sales=await f.employee({name:'模拟无权人员',employeeNo:'ANN-QA'});for(const [url,method,input]of [['/v1/admin/ui-annotations','GET'],['/v1/admin/ui-annotations','POST',annotation],['/v1/admin/ui-annotations/'+id,'PATCH',{status:'resolved'}]])assert.equal((await f.call(sales.token,url,method,input)).status,403);assert.equal((await f.call(f.admin.token,'/v1/admin/ui-annotations/'+id,'PATCH',{status:'resolved'})).body.annotation.status,'resolved');await f.reopen();let list=(await f.call(f.admin.token,'/v1/admin/ui-annotations')).body.annotations;assert.equal(list.find(x=>x.id===id).status,'resolved');assert.equal(list.find(x=>x.id===workflow.body.annotation.id).flowDefinition,'提交 -> 复核');assert.equal((await f.call(f.admin.token,'/v1/admin/ui-annotations/'+id,'PATCH',{status:'open'})).body.annotation.status,'open');const events=(await f.call(f.admin.token,'/v1/admin/audit?action=ui.annotation.update')).body.events;assert(events.length>=2);});
test('acceptance annotation validation rejects incomplete flows, unknown fields, external routes and invalid state',async t=>{const f=await fixture(t,'annotation-invalid-acceptance');for(const input of [{...annotation,page:'/outside/'},{...annotation,extra:'not allowed'},{...annotation,category:'workflow',workflowName:'模拟缺定义'},{...annotation,category:'workflow',workflowName:'模拟控制字符',flowDefinition:'开始\u0001',desiredFlowDefinition:'结束'}])assert.equal((await f.call(f.admin.token,'/v1/admin/ui-annotations','POST',input)).status,400);assert.equal((await f.call(f.admin.token,'/v1/admin/ui-annotations')).body.annotations.length,0);const create=await f.call(f.admin.token,'/v1/admin/ui-annotations','POST',annotation);assert.equal((await f.call(f.admin.token,'/v1/admin/ui-annotations/'+create.body.annotation.id,'PATCH',{status:'done'})).status,400);});
