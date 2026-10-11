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

async function preview(f,token){
 return f.call(token,'/v1/operations/lead.create/preview','POST',{input:{name:'权限变化测试学生',phone:'13900001234',source:'销售自拓'},expectedRevision:0});
}

test('role policy changes take effect on active business sessions and preserve individual allow/deny overrides',async t=>{
 const f=await fixture(t),normal=await f.employee({name:'普通销售',employeeNo:'RB001'}),denied=await f.employee({name:'个人拒绝销售',employeeNo:'RB002',deniedPermissions:['lead.create']}),allowed=await f.employee({name:'个人补充销售',employeeNo:'RB003',additionalPermissions:['lead.create']});
 const original=await f.call(f.admin.token,'/v1/roles');assert.equal(original.status,200);
 const sales=original.body.roles.find(role=>role.id==='sales');assert.equal(sales.version,1);assert.equal(sales.editable,true);
 for(const employee of [normal,denied,allowed])assert.equal((await f.call(employee.token,'/v1/auth/me')).status,200);
 assert.equal((await preview(f,normal.token)).status,200);
 assert.equal((await preview(f,allowed.token)).status,200);

 const removed=sales.permissions.filter(permission=>permission!=='lead.create');
 const revoke=await f.call(f.admin.token,'/v1/admin/roles/sales','PATCH',{permissions:removed,expectedVersion:1});
 assert.equal(revoke.status,200,JSON.stringify(revoke.body));assert.equal(revoke.body.role.version,2);assert.equal(revoke.body.affectedUsers,3);
 for(const employee of [normal,denied,allowed])assert.equal((await f.call(employee.token,'/v1/auth/me')).status,200,'role edits keep an active token signed in');
 assert.equal((await preview(f,normal.token)).status,403,'role removal immediately blocks the business operation');
 assert.equal((await preview(f,denied.token)).status,403,'a personal deny continues to win');
 assert.equal((await preview(f,allowed.token)).status,200,'an allowed personal override continues to grant the permission');
 const directory=await f.call(f.admin.token,'/v1/admin/users');assert.equal(directory.status,200);
 const current=Object.fromEntries(directory.body.users.map(user=>[user.id,user]));
 assert(!current[normal.user.id].permissions.includes('lead.create'));
 assert(!current[denied.user.id].permissions.includes('lead.create'));
 assert(current[allowed.user.id].permissions.includes('lead.create'));
 assert.equal((await f.call(normal.token,'/v1/catalog')).body.operations.some(operation=>operation.id==='lead.create'),false);

 const granted=await f.call(f.admin.token,'/v1/admin/roles/sales','PATCH',{permissions:sales.permissions,expectedVersion:2});
 assert.equal(granted.status,200,JSON.stringify(granted.body));assert.equal(granted.body.role.version,3);
 for(const employee of [normal,denied,allowed])assert.equal((await f.call(employee.token,'/v1/auth/me')).status,200);
 assert.equal((await preview(f,normal.token)).status,200,'a later grant reaches the existing session without re-login');
 assert.equal((await preview(f,denied.token)).status,403,'role grants cannot override an individual deny');
 assert.equal((await preview(f,allowed.token)).status,200);
 const rolesAfter=await f.call(normal.token,'/v1/roles');assert.equal(rolesAfter.body.roles.find(role=>role.id==='sales').version,3);
});

test('role updates do not revive old-version or expired sessions',async t=>{
 const f=await fixture(t,'role-session');
 const employee=await f.employee({name:'会话边界销售',employeeNo:'RB004'});
 await f.reopen();
 const state=JSON.parse(fs.readFileSync(f.authFile,'utf8'));
 const user=state.users.find(item=>item.id===employee.user.id),active=state.sessions.find(item=>item.userId===user.id);
 assert(active);const oldVersion=user.version;
 const staleToken='S'.repeat(43),expiredToken='E'.repeat(43);
 const stale={...active,tokenHash:tokenHash(staleToken),version:oldVersion-1,expiresAt:'2099-01-01T00:00:00.000Z'};
 const expired={...active,tokenHash:tokenHash(expiredToken),version:oldVersion,expiresAt:'2000-01-01T00:00:00.000Z'};
 state.sessions.push(stale,expired);fs.writeFileSync(f.authFile,JSON.stringify(state),{mode:0o600});
 await f.reopen();
 const roleList=await f.call(f.admin.token,'/v1/roles'),sales=roleList.body.roles.find(role=>role.id==='sales');
 const permissions=sales.permissions.filter(permission=>permission!=='lead.create');
 const changed=await f.call(f.admin.token,'/v1/admin/roles/sales','PATCH',{permissions,expectedVersion:sales.version});
 assert.equal(changed.status,200,JSON.stringify(changed.body));
 assert.equal((await f.call(employee.token,'/v1/auth/me')).status,200,'the genuinely active session is synchronized');
 assert.equal((await f.call(staleToken,'/v1/auth/me')).status,401);
 assert.equal((await f.call(expiredToken,'/v1/auth/me')).status,401);
 const saved=JSON.parse(fs.readFileSync(f.authFile,'utf8'));
 const keptStale=saved.sessions.find(item=>item.tokenHash===stale.tokenHash),keptExpired=saved.sessions.find(item=>item.tokenHash===expired.tokenHash);
 assert.equal(keptStale.version,oldVersion-1,'an already stale session version is not advanced');
 assert.equal(keptStale.expiresAt,stale.expiresAt);
 assert.equal(keptExpired.version,oldVersion,'an expired session version is not advanced');
 assert.equal(keptExpired.expiresAt,expired.expiresAt,'the role update never extends expiration');
});

test('role policy persistence is isolated between independent auth stores',async t=>{
 const first=await fixture(t,'role-isolation-a'),second=await fixture(t,'role-isolation-b');
 const before=(await second.call(second.admin.token,'/v1/roles')).body.roles.find(role=>role.id==='sales');
 const roles=(await first.call(first.admin.token,'/v1/roles')).body.roles,sales=roles.find(role=>role.id==='sales');
 const permissions=sales.permissions.filter(permission=>permission!=='lead.create');
 const update=await first.call(first.admin.token,'/v1/admin/roles/sales','PATCH',{permissions,expectedVersion:sales.version});
 assert.equal(update.status,200,JSON.stringify(update.body));
 const afterFirst=(await first.call(first.admin.token,'/v1/roles')).body.roles.find(role=>role.id==='sales');
 const afterSecond=(await second.call(second.admin.token,'/v1/roles')).body.roles.find(role=>role.id==='sales');
 assert.equal(afterFirst.version,before.version+1);assert(!afterFirst.permissions.includes('lead.create'));
 assert.equal(afterSecond.version,before.version);assert.deepEqual(afterSecond.permissions,before.permissions);
});
