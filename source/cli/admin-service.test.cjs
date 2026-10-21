'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Readable}=require('node:stream');
const service=require('./admin-service.cjs');
const {bootstrap}=require('../backend/src/bootstrap-auth.cjs');
const {createAuthService}=require('../backend/src/auth-service.cjs');
function temp(t){const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'siyue-admin-service-')));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function error(code,status){return Object.assign(new Error(code),{code,status});}
async function fixture(t){
 const dir=temp(t),storeFile=path.join(dir,'auth.json'),seedFile=path.join(dir,'seed.json');bootstrap(storeFile,seedFile);
 const seed=JSON.parse(fs.readFileSync(seedFile)),server=createAuthService({storeFile,publicOrigin:'https://fixture.test'});t.after(()=>server.close());
 const call=async(endpoint,{method='GET',body,token}={})=>{
  const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);Object.assign(req,{method,url:'/'+endpoint,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(token?{authorization:'Bearer '+token}:{})},socket:{remoteAddress:'127.0.0.1'}});
  let result,status;const res={getHeader:()=>undefined,setHeader:()=>{}};await server.handle(req,res,'/'+endpoint,(code,value)=>{status=code;result=value;});
  if(!(status>=200&&status<300))throw Object.assign(new Error(result?.message||'invalid response'),{code:result?.code||'INVALID_RESPONSE',status});return result;
 };
 const login=async(username,password)=>call('v1/auth/login',{method:'POST',body:{username,password,client:'cli'}});
 const initial=await login(seed.username,seed.initialPassword),password='Fixture-Admin-Password!2026';await call('v1/auth/password',{method:'POST',token:initial.token,body:{currentPassword:seed.initialPassword,newPassword:password}});
 const signed=await login(seed.username,password),request=(endpoint,options={})=>call(endpoint,{...options,token:signed.token});
 return {dir,server,request,call,login,admin:signed.user};
}
test('shared admin service manages all supported employee fields and uses real server permission rules',async t=>{
 const f=await fixture(t),credentialFile=path.join(f.dir,'academic.json');
 const created=await service.execute('create',{name:'测试教务',employeeNo:'QA-A01',roleIds:['academic','sales'],scope:{type:'campus',campusIds:['campus-1']},additionalPermissions:['report.read'],deniedPermissions:['lead.follow']},{request:f.request,credentialFile});
 assert.equal(created.created,true);assert.deepEqual(created.user.roleIds,['academic','sales']);assert.equal(created.initialPassword,undefined);assert.equal(fs.statSync(credentialFile).mode&0o777,0o600);
 const credentials=JSON.parse(fs.readFileSync(credentialFile));assert.ok(credentials.initialPassword);assert.ok(!JSON.stringify(created).includes(credentials.initialPassword));assert.ok(!JSON.stringify(created).includes('passwordHash'));
 const changed=await service.execute('update',{id:created.user.id,name:'教务兼销售',roleIds:['principal'],scope:{type:'campus',campusIds:['campus-2']},additionalPermissions:['audit.read'],deniedPermissions:['lead.transfer']},{request:f.request});
 assert.deepEqual(changed.user.roleIds,['principal']);assert.deepEqual(changed.user.scope.campusIds,['campus-2']);assert.ok(changed.user.permissions.includes('audit.read'));assert.ok(!changed.user.permissions.includes('lead.transfer'));
 const disabled=await service.execute('update',{id:created.user.id,disabled:true},{request:f.request});assert.equal(disabled.user.disabled,true);
 const enabled=await service.execute('update',{id:created.user.id,disabled:false},{request:f.request});assert.equal(enabled.user.disabled,false);
 const resetFile=path.join(f.dir,'reset.json'),reset=await service.execute('resetPassword',{id:created.user.id},{request:f.request,credentialFile:resetFile});assert.equal(reset.reset,true);assert.equal(reset.initialPassword,undefined);
 const resetCredentials=JSON.parse(fs.readFileSync(resetFile));assert.notEqual(resetCredentials.initialPassword,credentials.initialPassword);assert.equal(reset.user.mustChangePassword,true);
 await assert.rejects(f.login(created.user.username,credentials.initialPassword),{code:'INVALID_CREDENTIALS'});
 const initialEmployee=await f.login(created.user.username,resetCredentials.initialPassword);await assert.rejects(service.execute('update',{id:created.user.id,roleIds:['superadmin']},{request:(endpoint,options={})=>f.call(endpoint,{...options,token:initialEmployee.token})}),{code:'PASSWORD_CHANGE_REQUIRED'});
 const archived=await service.execute('archive',{id:created.user.id,reason:'测试离职归档'},{request:f.request});assert.equal(archived.archived,true);assert.equal(archived.user.disabled,true);assert.equal(archived.user.archiveReason,'测试离职归档');
 await assert.rejects(service.execute('update',{id:created.user.id,disabled:false},{request:f.request}),{code:'ACCOUNT_ARCHIVED'});
 await assert.rejects(service.execute('update',{id:f.admin.id,disabled:true},{request:f.request}),{code:'LAST_SUPERADMIN'});
});
test('shared role editor honors role version conflicts and server-protected permissions',async t=>{
 const f=await fixture(t),roles=await f.request('v1/roles'),sales=roles.roles.find(role=>role.id==='sales');
 const changed=await service.execute('updateRole',{id:'sales',permissions:['lead.create','lead.read'],expectedVersion:sales.version},{request:f.request});assert.equal(changed.changed,true);assert.equal(changed.role.version,sales.version+1);assert.deepEqual(changed.role.permissions,['lead.create','lead.read']);
 await assert.rejects(service.execute('updateRole',{id:'sales',permissions:['lead.create'],expectedVersion:sales.version},{request:f.request}),{code:'ROLE_VERSION_CONFLICT'});
 await assert.rejects(service.execute('updateRole',{id:'superadmin',permissions:[],expectedVersion:1},{request:f.request}),{code:'ROLE_PROTECTED'});
 await assert.rejects(service.execute('updateRole',{id:'sales',permissions:['account.update'],expectedVersion:changed.role.version},{request:f.request}),{code:'INVALID_ACCOUNT'});
});
test('shared admin service never substitutes local grants for server authorization',async t=>{
 const f=await fixture(t),file=path.join(f.dir,'sales.json'),created=await service.execute('create',{name:'测试销售',roleIds:['sales']},{request:f.request,credentialFile:file}),credentials=JSON.parse(fs.readFileSync(file));
 const initial=await f.login(created.user.username,credentials.initialPassword),password='Fixture-Sales-Password!2026';await f.call('v1/auth/password',{method:'POST',token:initial.token,body:{currentPassword:credentials.initialPassword,newPassword:password}});
 const logged=await f.login(created.user.username,password),request=(endpoint,options={})=>f.call(endpoint,{...options,token:logged.token});
 await assert.rejects(service.execute('update',{id:created.user.id,roleIds:['superadmin']},{request}),{code:'FORBIDDEN'});
 const deniedFile=path.join(f.dir,'denied.json');await assert.rejects(service.execute('create',{name:'不应创建',roleIds:['teacher']},{request,credentialFile:deniedFile}),{code:'FORBIDDEN'});assert.equal(fs.existsSync(deniedFile),false);
});
test('credential-producing commands reserve new private files before a request and never retry unknown responses',async t=>{
 const dir=temp(t);for(const action of ['create','resetPassword']){
  const input=action==='create'?{name:'测试教师',roleIds:['teacher']}:{id:'user-1'};
  for(const [code,status]of [['CONNECTION_FAILED',undefined],['INVALID_RESPONSE',undefined],['STORAGE_UNAVAILABLE',503],['SESSION_CHANGED',undefined]]){
   let calls=0;const file=path.join(dir,action+'-'+code+'.json'),request=async()=>{calls++;throw error(code,status);};
   await assert.rejects(service.execute(action,input,{request,credentialFile:file}),{code});assert.equal(calls,1);assert.equal(fs.statSync(file).mode&0o777,0o600);assert.equal(fs.readFileSync(file,'utf8'),'');
   await assert.rejects(service.execute(action,input,{request,credentialFile:file}),{code:'OUTPUT_EXISTS'});assert.equal(calls,1);
  }
  const existing=path.join(dir,action+'-exists.json');fs.writeFileSync(existing,'keep',{mode:0o600});let called=false;
  await assert.rejects(service.execute(action,input,{request:async()=>{called=true},credentialFile:existing}),{code:'OUTPUT_EXISTS'});assert.equal(called,false);assert.equal(fs.readFileSync(existing,'utf8'),'keep');
 }
});
test('invalid or incomplete credential responses retain the private uncertainty marker without secret output',async t=>{
 const dir=temp(t),file=path.join(dir,'missing-password.json');let calls=0;
 await assert.rejects(service.execute('create',{name:'测试',roleIds:['sales']},{request:async()=>{calls++;return {user:{id:'u1'}}},credentialFile:file}),{code:'INVALID_RESPONSE'});assert.equal(calls,1);assert.equal(fs.readFileSync(file,'utf8'),'');
 const target=path.join(dir,'target.json'),link=path.join(dir,'symlink.json');fs.writeFileSync(target,'keep',{mode:0o600});fs.symlinkSync(target,link);
 await assert.rejects(service.execute('resetPassword',{id:'user-1'},{request:async()=>{calls++;},credentialFile:link}),{code:'OUTPUT_EXISTS'});assert.equal(calls,1);assert.equal(fs.readFileSync(target,'utf8'),'keep');
});
test('admin schemas reject unsupported fields and invalid identifiers before making requests',async()=>{
 let calls=0;const request=async()=>{calls++;};
 for(const [action,input]of [['create',{name:'测试',roleIds:['sales'],password:'never-accept'}],['update',{id:'../users'}],['update',{id:'user-1'}],['update',{id:'user-1',disabled:'false'}],['create',{name:'测试',roleIds:['sales'],scope:{type:'unknown'}}],['archive',{id:'user-1',reason:1}],['updateRole',{id:'sales',permissions:[],expectedVersion:0}]])await assert.rejects(service.execute(action,input,{request}),{code:'INVALID_ARGUMENT'});
 assert.equal(calls,0);assert.equal(service.operations.length,5);assert.ok(service.operations.every(op=>op.inputSchema===service.schemas[op.action]));
});
