'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {once}=require('node:events');
const {bootstrap}=require('../src/bootstrap-auth.cjs');
const {createServer}=require('../src/server.cjs');
const origin='https://crm.example.test';
const adminPassword='Archive-Admin!5892Aa';
const employeePassword='Archive-Employee!6821Bb';
function request(server,pathname,method='GET',data,headers={}){return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:pathname,method,headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...headers}},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body),headers:res.headers}));});req.on('error',reject);req.end(data===undefined?undefined:JSON.stringify(data));});}
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'siyue-archive-test-')),file=path.join(dir,'auth.json'),out=path.join(dir,'credentials.json');bootstrap(file,out);const credentials=JSON.parse(fs.readFileSync(out,'utf8'));
 const server=createServer({auth:{storeFile:file,publicOrigin:origin,captchaOptions:{randomInt:()=>4}}});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});});
 const login=async(username,password,client='cli',headers={})=>{if(client==='cli')return request(server,'/v1/auth/login','POST',{username,password,client});const cap=await request(server,'/v1/auth/captcha');return request(server,'/v1/auth/login','POST',{username,password,client,captchaId:cap.body.id,captchaCode:'444444'},{Origin:origin,Cookie:cap.headers['set-cookie'][0].split(';')[0],...headers});};
 const call=(token,pathname,method='GET',body,headers={})=>request(server,pathname,method,body,{Authorization:'Bearer '+token,...headers});
 const first=await login(credentials.username,credentials.initialPassword);assert.equal(first.status,200);assert.equal((await call(first.body.token,'/v1/auth/password','POST',{currentPassword:credentials.initialPassword,newPassword:adminPassword})).status,200);const ready=await login(credentials.username,adminPassword);assert.equal(ready.status,200);
 return {dir,file,server,credentials,admin:ready.body.token,adminUser:ready.body.user,login,call};
}
async function employee(f,{name='离职测试员工',employeeNo='ARCH01',roleIds=['sales']}={}){const created=await f.call(f.admin,'/v1/admin/users','POST',{name,employeeNo,roleIds,scope:{type:roleIds.includes('superadmin')?'all':'own'}});assert.equal(created.status,201,JSON.stringify(created.body));const initial=await f.login(created.body.user.username,created.body.initialPassword);assert.equal(initial.status,200);assert.equal((await f.call(initial.body.token,'/v1/auth/password','POST',{currentPassword:created.body.initialPassword,newPassword:employeePassword})).status,200);const active=await f.login(created.body.user.username,employeePassword);assert.equal(active.status,200);return {user:created.body.user,token:active.body.token};}

test('archive soft-disables an employee, revokes sessions, retains the account and emits a safe audit summary',async t=>{
 const f=await fixture(t),staff=await employee(f),before=await f.call(f.admin,'/v1/admin/users');const saved=before.body.users.find(user=>user.id===staff.user.id);assert.equal(saved.archivedAt,null);assert.equal(saved.archivedBy,null);assert.equal(saved.archiveReason,null);
 const archived=await f.call(f.admin,'/v1/admin/users/'+staff.user.id+'/archive','POST',{reason:'离职交接完成'});assert.equal(archived.status,200,JSON.stringify(archived.body));assert.equal(archived.body.archived,true);assert.equal(archived.body.user.disabled,true);assert.equal(archived.body.user.archivedBy,f.adminUser.id);assert.equal(archived.body.user.archiveReason,'离职交接完成');assert.ok(Number.isFinite(Date.parse(archived.body.user.archivedAt)));assert.equal(archived.body.user.version,saved.version+1);
 assert.equal((await f.call(staff.token,'/v1/auth/me')).status,401);assert.equal((await f.login(staff.user.username,employeePassword)).status,401);
 const listed=await f.call(f.admin,'/v1/admin/users');const retained=listed.body.users.find(user=>user.id===staff.user.id);assert.ok(retained);assert.equal(retained.archivedAt,archived.body.user.archivedAt);assert.equal(retained.archiveReason,'离职交接完成');
 const audit=await f.call(f.admin,'/v1/admin/audit?action=account.archive&view=all');assert.equal(audit.status,200);const event=audit.body.events[0];assert.equal(event.targetId,staff.user.id);assert.equal(event.targetName,'离职测试员工');assert.equal(event.category,'account');assert.equal(event.attention,true);assert.equal(event.summary.archived,true);assert.equal(event.summary.archiveReason,'离职交接完成');assert.equal(event.details,undefined);assert.equal(event.ip,undefined);
 assert.equal((await f.call(f.admin,'/v1/admin/users/'+staff.user.id,'PATCH',{disabled:false})).body.code,'ACCOUNT_ARCHIVED');assert.equal((await f.call(f.admin,'/v1/admin/users/'+staff.user.id,'PATCH',{name:'不应修改归档姓名'})).body.code,'ACCOUNT_ARCHIVED');assert.equal((await f.call(f.admin,'/v1/admin/users/'+staff.user.id+'/reset-password','POST',{})).body.code,'ACCOUNT_ARCHIVED');
});

test('archive requires superadmin and CSRF, validates reason, protects self and rejects repeat archives',async t=>{
 const f=await fixture(t),staff=await employee(f);const nonAdmin=await employee(f,{name:'普通审计员工',employeeNo:'ARCH02'});assert.equal((await f.call(nonAdmin.token,'/v1/admin/users/'+staff.user.id+'/archive','POST',{})).status,403);
 const tooLong=await f.call(f.admin,'/v1/admin/users/'+staff.user.id+'/archive','POST',{reason:'x'.repeat(201)});assert.equal(tooLong.status,400);assert.equal(tooLong.body.code,'INVALID_INPUT');
 const nullReason=await f.call(f.admin,'/v1/admin/users/'+staff.user.id+'/archive','POST',{reason:null});assert.equal(nullReason.status,400);assert.equal(nullReason.body.code,'INVALID_INPUT');
 const control=await f.call(f.admin,'/v1/admin/users/'+staff.user.id+'/archive','POST',{reason:'离职\n原因'});assert.equal(control.status,400);
 const self=await f.call(f.admin,'/v1/admin/users/'+f.adminUser.id+'/archive','POST',{});assert.equal(self.status,409);assert.equal(self.body.code,'CANNOT_ARCHIVE_SELF');
 const browser=await f.login(f.credentials.username,adminPassword,'browser');assert.equal(browser.status,200);const cookie=browser.headers['set-cookie'].find(value=>value.startsWith('siyue_session=')).split(';')[0],url='/v1/admin/users/'+staff.user.id+'/archive';
 const missingCsrf=await request(f.server,url,'POST',{}, {Origin:origin,Cookie:cookie});assert.equal(missingCsrf.status,403);assert.equal(missingCsrf.body.code,'CSRF_REJECTED');
 const headers={Origin:origin,Cookie:cookie,'X-CSRF-Token':browser.body.csrfToken};assert.equal((await request(f.server,url,'POST',{},headers)).status,200);const duplicate=await request(f.server,url,'POST',{},headers);assert.equal(duplicate.status,409);assert.equal(duplicate.body.code,'ACCOUNT_ARCHIVED');
});

test('archive rejects unknown accounts and unknown request fields without mutating employees',async t=>{
 const f=await fixture(t),staff=await employee(f);const missing=await f.call(f.admin,'/v1/admin/users/no-such-user/archive','POST',{});assert.equal(missing.status,404);assert.equal(missing.body.code,'USER_NOT_FOUND');const unknownField=await f.call(f.admin,'/v1/admin/users/'+staff.user.id+'/archive','POST',{token:'should-not-be-accepted'});assert.equal(unknownField.status,400);assert.equal(unknownField.body.code,'UNKNOWN_FIELD');const listed=await f.call(f.admin,'/v1/admin/users');assert.equal(listed.body.users.find(user=>user.id===staff.user.id).archivedAt,null);
});
