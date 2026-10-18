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
const {AuthStore}=require('../src/auth-store.cjs');
const origin='https://crm.example.test';
const newPassword='New-Password!83742AA';
function request(server,pathname,method='GET',data,headers={}){return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:pathname,method,headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...headers}},res=>{let body='';res.on('data',x=>body+=x);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body),headers:res.headers}));});req.on('error',reject);req.end(data===undefined?undefined:JSON.stringify(data));});}
async function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'siyue-auth-test-'));const file=path.join(dir,'auth.json'),out=path.join(dir,'credentials.json');bootstrap(file,out);const credentials=JSON.parse(fs.readFileSync(out));const server=createServer({auth:{storeFile:file,publicOrigin:origin,captchaOptions:{randomInt:()=>4}}});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});});const login=async(username,password,client='cli',headers={})=>{if(client!=='browser')return request(server,'/v1/auth/login','POST',{username,password,client},headers);const challenge=await request(server,'/v1/auth/captcha');const cookie=challenge.headers['set-cookie'][0].split(';')[0];return request(server,'/v1/auth/login','POST',{username,password,client,captchaId:challenge.body.id,captchaCode:'444444'},{Cookie:cookie,...headers});};const initial=await login(credentials.username,credentials.initialPassword);assert.equal(initial.status,200);const call=(token,p,m='GET',d,h={})=>request(server,p,m,d,{Authorization:'Bearer '+token,...h});return {dir,file,out,server,credentials,login,call,initial};}
async function adminReady(f){assert.equal((await f.call(f.initial.body.token,'/v1/auth/password','POST',{currentPassword:f.credentials.initialPassword,newPassword})).status,200);const login=await f.login(f.credentials.username,newPassword);assert.equal(login.status,200);return login.body.token;}
async function employee(f,admin,extra={}){const res=await f.call(admin,'/v1/admin/users','POST',{name:'测试销售',employeeNo:'E010',roleIds:['sales'],scope:{type:'own'},...extra});assert.equal(res.status,201,JSON.stringify(res.body));return res.body;}
async function activate(f,user,password='Employee-Password!938AA'){const login=await f.login(user.user.username,user.initialPassword);assert.equal(login.status,200);const changed=await f.call(login.body.token,'/v1/auth/password','POST',{currentPassword:user.initialPassword,newPassword:password});assert.equal(changed.status,200);const final=await f.login(user.user.username,password);assert.equal(final.status,200);return final.body.token;}
test('class scheduling command follows class.create grants and remains a browser-only design entry',async t=>{
 const f=await fixture(t),admin=await adminReady(f),created=await employee(f,admin,{name:'排课教务',employeeNo:'SCH01',roleIds:['academic'],scope:{type:'campus',campusIds:['城中校区']}}),token=await activate(f,created);
 const first=await f.call(token,'/v1/catalog');assert.equal(first.status,200);
 const command=first.body.frontendOperations.find(x=>x.id==='action.classes.schedule');assert.equal(command?.label,'班级排课');assert.equal(command.execution,'browser-only');
 assert.ok(first.body.operations.find(x=>x.id==='class.create').frontendAliases.includes(command.id));
 assert.equal((await f.call(token,'/v1/operations/class.create/execute','POST',{})).status,501);
 assert.equal((await f.call(admin,'/v1/admin/users/'+created.user.id,'PATCH',{deniedPermissions:['class.create']})).status,200);
 const relogin=await f.login(created.user.username,'Employee-Password!938AA'),next=await f.call(relogin.body.token,'/v1/catalog');assert.equal(next.status,200);
 assert.ok(!next.body.frontendOperations.some(x=>x.id==='action.classes.schedule'));assert.ok(!next.body.operations.some(x=>x.id==='class.create'));
 assert.equal((await f.call(relogin.body.token,'/v1/operations/class.create/execute','POST',{})).status,403);
});
test('bootstrap writes one-time private credentials; store hashes passwords and rejects a second writer',async t=>{const f=await fixture(t);const state=JSON.parse(fs.readFileSync(f.file));assert.equal(fs.statSync(f.file).mode&0o777,0o600);assert.equal(fs.statSync(f.out).mode&0o777,0o600);assert.equal(state.users[0].passwordHash.algorithm,'scrypt');const raw=fs.readFileSync(f.file,'utf8');assert.ok(!raw.includes(f.credentials.initialPassword));assert.ok(!raw.includes(f.initial.body.token));assert.throws(()=>new AuthStore(f.file),/已有写入进程/);assert.throws(()=>bootstrap(f.file,path.join(f.dir,'again.json')),/已有写入进程/);assert.equal(state.sessions[0].client,'cli');assert.equal(f.initial.body.user.mustChangePassword,true);});
test('initial password cannot access catalog or account management; password change revokes every session',async t=>{const f=await fixture(t);assert.equal((await f.call(f.initial.body.token,'/v1/catalog')).body.code,'PASSWORD_CHANGE_REQUIRED');assert.equal((await f.call(f.initial.body.token,'/v1/admin/users')).status,403);assert.equal((await f.call(f.initial.body.token,'/v1/auth/password','POST',{currentPassword:f.credentials.initialPassword,newPassword:'short'})).body.code,'WEAK_PASSWORD');const second=await f.login(f.credentials.username,f.credentials.initialPassword);const admin=await adminReady(f);assert.equal((await f.call(second.body.token,'/v1/auth/me')).status,401);assert.equal((await f.call(f.initial.body.token,'/v1/auth/me')).status,401);assert.equal((await f.call(admin,'/v1/auth/me')).body.user.mustChangePassword,false);});
test('browser cookie has mandatory flags, token is not returned, and origin plus CSRF are enforced',async t=>{const f=await fixture(t);const admin=await adminReady(f);const badOrigin=await f.login(f.credentials.username,newPassword,'browser',{Origin:'https://evil.test'});assert.equal(badOrigin.status,403);const browser=await f.login(f.credentials.username,newPassword,'browser',{Origin:origin});assert.equal(browser.status,200);assert.equal(browser.body.token,undefined);const set=browser.headers['set-cookie'].find(x=>x.startsWith('siyue_session='));assert.match(set,/HttpOnly; Secure; SameSite=Strict/);assert.match(set,/Path=\/crm-api\//);const cookie=set.split(';')[0];assert.equal((await request(f.server,'/v1/auth/logout','POST',{}, {Cookie:cookie,Origin:origin})).body.code,'CSRF_REJECTED');assert.equal((await request(f.server,'/v1/auth/logout','POST',{}, {Cookie:cookie,'X-CSRF-Token':browser.body.csrfToken,Origin:'https://evil.test'})).body.code,'ORIGIN_REJECTED');assert.equal((await request(f.server,'/v1/auth/logout','POST',{}, {Cookie:cookie,'X-CSRF-Token':browser.body.csrfToken,Origin:origin})).status,200);assert.equal((await request(f.server,'/v1/auth/me','GET',undefined,{Cookie:cookie})).status,401);assert.equal((await request(f.server,'/v1/auth/me','GET',undefined,{Cookie:'siyue_session='+admin})).status,401);});
test('sales cannot self-promote, read other accounts or financial commands; catalog is permission-filtered',async t=>{const f=await fixture(t),admin=await adminReady(f),created=await employee(f,admin),token=await activate(f,created);assert.match(created.user.username,/^sy-e010/);assert.ok(created.initialPassword.length>=20);const catalog=await f.call(token,'/v1/catalog');assert.equal(catalog.body.authorizationFiltered,true);assert.ok(catalog.body.operations.some(x=>x.id==='lead.follow'));assert.ok(!catalog.body.operations.some(x=>x.id==='order.confirmReceipt'));assert.equal((await f.call(token,'/v1/admin/users')).status,403);assert.equal((await f.call(token,'/v1/admin/users/'+created.user.id,'PATCH',{roleIds:['superadmin']})).status,403);assert.equal((await f.call(token,'/v1/operations/order.confirmReceipt/execute','POST',{})).status,403);assert.equal((await f.call(token,'/v1/operations/lead.follow/execute','POST',{})).status,501);assert.equal((await f.call(token,'/v1/employees')).status,403);assert.equal((await request(f.server,'/v1/catalog','GET',undefined,{'X-Role':'superadmin'})).status,401);});
test('permission edits, disable and resets revoke old credentials; last superadmin is protected',async t=>{const f=await fixture(t),admin=await adminReady(f),created=await employee(f,admin),token=await activate(f,created);let result=await f.call(admin,'/v1/admin/users/'+created.user.id,'PATCH',{deniedPermissions:['lead.follow'],additionalPermissions:['report.read']});assert.equal(result.status,200);assert.ok(!result.body.user.permissions.includes('lead.follow'));assert.ok(result.body.user.permissions.includes('report.read'));assert.equal((await f.call(token,'/v1/auth/me')).status,401);assert.equal((await f.call(admin,'/v1/admin/users/'+created.user.id,'PATCH',{additionalPermissions:['role.grant']})).status,400);assert.equal((await f.call(admin,'/v1/admin/users/'+created.user.id,'PATCH',{additionalPermissions:['invented']})).status,400);assert.equal((await f.call(admin,'/v1/admin/users/'+f.initial.body.user.id,'PATCH',{disabled:true})).body.code,'LAST_SUPERADMIN');assert.equal((await f.call(admin,'/v1/admin/users/'+f.initial.body.user.id,'PATCH',{roleIds:['sales'],scope:{type:'own'}})).body.code,'LAST_SUPERADMIN');const beforeReset=await f.login(created.user.username,'Employee-Password!938AA');const reset=await f.call(admin,'/v1/admin/users/'+created.user.id+'/reset-password','POST',{});assert.equal(reset.status,200);assert.equal((await f.call(beforeReset.body.token,'/v1/auth/me')).status,401);assert.equal((await f.login(created.user.username,'Employee-Password!938AA')).status,401);const relogin=await f.login(created.user.username,reset.body.initialPassword);assert.equal(relogin.status,200);assert.equal(relogin.body.user.mustChangePassword,true);assert.equal((await f.call(admin,'/v1/admin/users/'+created.user.id,'PATCH',{disabled:true})).status,200);assert.equal((await f.login(created.user.username,reset.body.initialPassword)).status,401);});
test('failed writes do not mutate live state; audit is searchable and contains no passwords or bearer tokens',async t=>{const f=await fixture(t),admin=await adminReady(f);const original=fs.renameSync;fs.renameSync=()=>{throw new Error('simulated disk failure');};try{const bad=await f.call(admin,'/v1/admin/users','POST',{name:'测试失败',employeeNo:'ERR01',roleIds:['sales']});assert.equal(bad.status,503);}finally{fs.renameSync=original;}const list=await f.call(admin,'/v1/admin/users');assert.equal(list.body.users.length,1);await f.login(f.credentials.username,'Wrong-Pass!3387Aa');const audits=await f.call(admin,'/v1/admin/audit?action=auth.login&outcome=denied');assert.equal(audits.status,200);assert.ok(audits.body.events.length>=1);assert.ok(audits.body.events.every(x=>x.action==='auth.login'&&x.outcome==='denied'));const raw=fs.readFileSync(f.file,'utf8');for(const secret of [f.credentials.initialPassword,newPassword,admin,'Wrong-Pass!3387Aa'])assert.ok(!raw.includes(secret));});
test('unknown and disabled users have same login response and repeated attempts are rate limited',async t=>{const f=await fixture(t);const unknown=await f.login('unknown-user','Some-Wrong!839Aa');const known=await f.login(f.credentials.username,'Some-Wrong!839Aa');assert.equal(unknown.status,known.status);assert.equal(unknown.body.code,known.body.code);assert.equal(unknown.body.message,known.body.message);let last;for(let i=0;i<10;i++)last=await f.login('unknown-user','Some-Wrong!839Aa');assert.equal(last.status,429);assert.equal(last.body.code,'RATE_LIMITED');});
test('store rejects symlink files and credentials are not overwritten',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'siyue-auth-file-'));try{const real=path.join(dir,'real');fs.writeFileSync(real,'{}',{mode:0o600});const link=path.join(dir,'link');fs.symlinkSync(real,link);assert.throws(()=>new AuthStore(link),/0600 普通文件/);assert.equal(fs.readFileSync(real,'utf8'),'{}');const store=path.join(dir,'auth.json'),out=path.join(dir,'initial.json');bootstrap(store,out);const first=fs.readFileSync(out,'utf8');assert.throws(()=>bootstrap(store,out),/已有账号/);assert.equal(fs.readFileSync(out,'utf8'),first);}finally{fs.rmSync(dir,{recursive:true,force:true});}});

test('automatic account names are valid for short Latin, punctuation, Chinese and collisions',()=>{const {generateUsername}=require('../src/auth-credentials.cjs');for(const [name,employeeNo]of [['Al',''],['A',''],['!!!',''],['王小明',''],['张老师','E03']]){const first=generateUsername(name,employeeNo,[]);assert.match(first,/^[a-z0-9][a-z0-9_-]{2,47}$/);const next=generateUsername(name,employeeNo,[{username:first}]);assert.match(next,/^[a-z0-9][a-z0-9_-]{2,47}$/);assert.notEqual(next,first);}});
test('sessions survive a clean restart, expire server-side and release the single-writer lock',async t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'siyue-auth-restart-'));const file=path.join(dir,'auth.json'),out=path.join(dir,'credentials.json');bootstrap(file,out);const credentials=JSON.parse(fs.readFileSync(out));let server;const start=async()=>{server=createServer({auth:{storeFile:file,publicOrigin:origin,captchaOptions:{randomInt:()=>4}}});server.listen(0,'127.0.0.1');await once(server,'listening');};const close=()=>new Promise(resolve=>server.close(resolve));t.after(async()=>{if(server?.listening)await close();fs.rmSync(dir,{recursive:true,force:true});});await start();const first=await request(server,'/v1/auth/login','POST',{...credentials,password:credentials.initialPassword,initialPassword:undefined,mustChangePassword:undefined,client:'cli'});assert.equal(first.status,200);assert.ok(Date.parse(first.body.expiresAt)-Date.now()<=10*60000);const headers={Authorization:'Bearer '+first.body.token};await request(server,'/v1/auth/password','POST',{currentPassword:credentials.initialPassword,newPassword},headers);const login=await request(server,'/v1/auth/login','POST',{username:credentials.username,password:newPassword,client:'cli'});await close();assert.ok(!fs.existsSync(file+'.lock'));await start();assert.equal((await request(server,'/v1/auth/me','GET',undefined,{Authorization:'Bearer '+login.body.token})).status,200);const now=Date.now;Date.now=()=>now()+9*3600000;try{assert.equal((await request(server,'/v1/auth/me','GET',undefined,{Authorization:'Bearer '+login.body.token})).status,401);}finally{Date.now=now;}});
test('audit permission requires explicit grant and pagination does not lose same-timestamp records',async t=>{const f=await fixture(t),admin=await adminReady(f),created=await employee(f,admin),token=await activate(f,created);assert.equal((await f.call(token,'/v1/admin/audit')).status,403);assert.equal((await f.call(admin,'/v1/admin/users/'+created.user.id,'PATCH',{additionalPermissions:['audit.read']})).status,200);const login=await f.login(created.user.username,'Employee-Password!938AA');const first=await f.call(login.body.token,'/v1/admin/audit?action=auth.login&limit=1');assert.equal(first.status,200);assert.equal(first.body.hasMore,true);assert.ok(first.body.nextBefore);const next=await f.call(login.body.token,'/v1/admin/audit?action=auth.login&limit=1&before='+first.body.nextBefore);assert.equal(next.status,200);assert.notEqual(next.body.events[0].id,first.body.events[0].id);const unknown=await f.call(login.body.token,'/v1/admin/audit?before=invalid');assert.equal(unknown.status,400);});
test('audit supports bounded actor and action-prefix search with safe projection and existing filters',async t=>{
 const f=await fixture(t),admin=await adminReady(f),created=await employee(f,admin,{name:'审计姓名检索',employeeNo:'AuditFind03'});
 await activate(f,created);
 assert.equal((await f.call(admin,'/v1/admin/users/'+created.user.id,'PATCH',{additionalPermissions:['audit.read']})).status,200);
 const login=await f.login(created.user.username,'Employee-Password!938AA');
 const call=(query)=>f.call(login.body.token,'/v1/admin/audit?'+query);
 const first=await call(new URLSearchParams({actorQuery:'审计姓名检索',actionPrefix:'AUTH.',limit:'1'}).toString());
 assert.equal(first.status,200);assert.equal(first.body.events.length,1);assert.equal(first.body.hasMore,true);
 assert.equal(first.body.events[0].actorName,'审计姓名检索');assert.match(first.body.events[0].action,/^auth\./);
 const second=await call(new URLSearchParams({actorQuery:'审计姓名检索',actionPrefix:'auth.',limit:'1',before:first.body.nextBefore}).toString());
 assert.equal(second.status,200);assert.equal(second.body.events.length,1);assert.notEqual(second.body.events[0].id,first.body.events[0].id);
 const byEmployeeNo=await call(new URLSearchParams({actorQuery:'AUDITFIND03',action:'auth.login',outcome:'success',from:'2020-01-01',to:'2030-01-01'}).toString());
 assert.equal(byEmployeeNo.status,200);assert.ok(byEmployeeNo.body.events.length>=2);assert.ok(byEmployeeNo.body.events.every(e=>e.actorId===created.user.id&&e.action==='auth.login'&&e.outcome==='success'));
 const byActorAlias=await call(new URLSearchParams({actor:created.user.id,action:'auth.login'}).toString());
 assert.equal(byActorAlias.status,200);assert.ok(byActorAlias.body.events.length>=2);assert.ok(byActorAlias.body.events.every(e=>e.actorId===created.user.id));
 const accountPrefix=await call(new URLSearchParams({actorQuery:'超级管理员',actionPrefix:'ACCOUNT.'}).toString());
 assert.equal(accountPrefix.status,200);assert.ok(accountPrefix.body.events.some(e=>e.action==='account.create'));
 const attentionUpdate=await call(new URLSearchParams({view:'attention',action:'account.update'}).toString());
 assert.equal(attentionUpdate.status,200);assert.ok(attentionUpdate.body.events.length>=1);assert.ok(attentionUpdate.body.events.every(e=>e.attention&&e.category==='account'&&e.outcomeLabel==='成功'));
 assert.equal((await f.call(admin,'/v1/admin/users')).status,200);
 const listAll=await call(new URLSearchParams({view:'all',action:'account.list'}).toString());
 const listActivity=await call(new URLSearchParams({view:'activity',action:'account.list'}).toString());
 const listAttention=await call(new URLSearchParams({view:'attention',action:'account.list'}).toString());
 assert.equal(listAll.body.events.length,0);assert.equal(listActivity.body.events.length,0);assert.equal(listAttention.body.events.length,0);
 const adminList=await f.call(admin,'/v1/admin/audit?view=all&action=account.list');assert.ok(adminList.body.events.length>=1);
 const accountUpdate=accountPrefix.body.events.find(e=>e.action==='account.update'&&e.targetId===created.user.id);
 assert.ok(accountUpdate);assert.equal(accountUpdate.targetName,'审计姓名检索');
 const event=first.body.events[0];assert.deepEqual(Object.keys(event).sort(),['action','actorId','actorName','at','attention','category','id','outcome','outcomeLabel','requestId','summary','targetId','targetName'].sort());
 assert.equal(event.targetId,created.user.id);assert.equal(event.targetName,'审计姓名检索');
 assert.equal(event.category,'security');assert.equal(event.attention,false);assert.equal(event.outcomeLabel,'成功');
 assert.equal(event.details,undefined);assert.equal(event.ip,undefined);
 assert(!JSON.stringify(first.body).includes('passwordHash'));assert(!JSON.stringify(first.body).includes(login.body.token));
 const stored=JSON.parse(fs.readFileSync(f.file,'utf8')).audit.find(e=>e.actorId===created.user.id&&e.action==='auth.login');
 assert.ok(stored);assert.ok(Object.hasOwn(stored,'ip'));assert.ok(Object.hasOwn(stored,'details'));assert.equal(stored.summary,undefined);
});
test('audit validates new search lengths and date bounds',async t=>{
 const f=await fixture(t),admin=await adminReady(f);
 const tooLongActor=await f.call(admin,'/v1/admin/audit?actorQuery='+encodeURIComponent('a'.repeat(121)));
 assert.equal(tooLongActor.status,400);assert.equal(tooLongActor.body.code,'INVALID_INPUT');
 const tooLongPrefix=await f.call(admin,'/v1/admin/audit?actionPrefix='+encodeURIComponent('a'.repeat(121)));
 assert.equal(tooLongPrefix.status,400);assert.equal(tooLongPrefix.body.code,'INVALID_INPUT');
 const tooLongDate=await f.call(admin,'/v1/admin/audit?from='+encodeURIComponent('2026-10-11'.repeat(5)));
 assert.equal(tooLongDate.status,400);assert.equal(tooLongDate.body.code,'INVALID_DATE');
});
test('audit fills a missing actor name from the current directory without exposing raw event fields',()=>{
 const {selectAuditPage}=require('../src/audit-query.cjs');
 const page=selectAuditPage([{id:'legacy-event',at:'2026-10-11T00:00:00.000Z',actorId:'user-1',action:'auth.login',outcome:'success',ip:'PRIVATE-IP',details:{token:'PRIVATE-TOKEN'}}],[{id:'user-1',name:'目录当前姓名',username:'loginname',employeeNo:'EMP-1'}],new URLSearchParams('actorQuery=LOGINNAME'));
 assert.equal(page.events.length,1);assert.equal(page.events[0].actorName,'目录当前姓名');
 assert.equal(page.events[0].ip,undefined);assert.equal(page.events[0].details,undefined);
 assert(!JSON.stringify(page).includes('PRIVATE-IP'));assert(!JSON.stringify(page).includes('PRIVATE-TOKEN'));
});
test('audit views keep previews in all, suppress read noise, and flag relevant actions without calling them anomalies',()=>{
 const {selectAuditPage}=require('../src/audit-query.cjs');
 const rows=[
  {id:'read-ok',at:'2026-10-11T00:00:10.000Z',action:'read.state',outcome:'success'},
  {id:'list-ok',at:'2026-10-11T00:00:09.000Z',action:'account.list',outcome:'success'},
  {id:'report-ok',at:'2026-10-11T00:00:08.000Z',action:'report.sales',outcome:'success'},
  {id:'activity-ok',at:'2026-10-11T00:00:07.000Z',action:'sales.activity',outcome:'success'},
  {id:'followups-ok',at:'2026-10-11T00:00:06.500Z',action:'sales.followups',outcome:'success'},
  {id:'roster-ok',at:'2026-10-11T00:00:06.000Z',action:'session.attendance.roster',outcome:'success'},
  {id:'makeup-ok',at:'2026-10-11T00:00:05.500Z',action:'makeup.candidates',outcome:'success'},
  {id:'refund-preview',at:'2026-10-11T00:00:05.000Z',action:'refund.submit',outcome:'preview'},
  {id:'refund-ok',at:'2026-10-11T00:00:04.000Z',action:'refund.submit',outcome:'success'},
  {id:'login-failure',at:'2026-10-11T00:00:03.000Z',action:'auth.login',outcome:'failure'},
  {id:'account-change',at:'2026-10-11T00:00:02.000Z',action:'account.update',outcome:'success'},
  {id:'account-reset',at:'2026-10-11T00:00:01.000Z',action:'account.resetPassword',outcome:'success'},
 ];
 const all=selectAuditPage(rows,[],new URLSearchParams('view=all')).events;
 const activity=selectAuditPage(rows,[],new URLSearchParams('view=activity')).events;
 const attention=selectAuditPage(rows,[],new URLSearchParams('view=attention')).events;
 assert.deepEqual(all.map(e=>e.id),rows.map(e=>e.id));
 assert.deepEqual(activity.map(e=>e.id),['refund-ok','login-failure','account-change','account-reset']);
 assert.deepEqual(attention.map(e=>e.id),['refund-ok','login-failure','account-change','account-reset']);
 assert.equal(all.find(e=>e.id==='refund-preview').outcomeLabel,'预览 · 未提交');
 assert.equal(all.find(e=>e.id==='refund-preview').attention,false);
 assert.equal(all.find(e=>e.id==='refund-ok').category,'finance');
 assert.equal(all.find(e=>e.id==='login-failure').attention,true);
 assert.equal(all.find(e=>e.id==='login-failure').category,'security');
 assert.equal(all.find(e=>e.id==='account-change').attention,true);
 assert.equal(all.find(e=>e.id==='account-change').category,'account');
 assert.equal(all.find(e=>e.id==='list-ok').attention,false);
 assert.equal(all.find(e=>e.id==='list-ok').category,'system');assert.equal(all.find(e=>e.id==='followups-ok').attention,false);assert.equal(all.find(e=>e.id==='followups-ok').category,'system');
 for(const id of ['report-ok','activity-ok','roster-ok','makeup-ok']){assert.equal(all.find(e=>e.id===id).attention,false);assert.equal(all.find(e=>e.id===id).category,'system');}
});
test('audit business summaries expose historical names and order student name without other changed fields',()=>{
 const {selectAuditPage}=require('../src/audit-query.cjs');
 const changes=[
  {collection:'courses',id:'course-1',before:{name:'旧课程',internalMaterial:'PRIVATE-MATERIAL'},after:{name:'新课程',internalMaterial:'PRIVATE-MATERIAL'}},
  {collection:'classes',id:'class-1',after:{title:'四年级数学 A 班',phone:'PRIVATE-PHONE'}},
  {collection:'leads',id:'lead-1',after:{name:'王同学线索',phone:'PRIVATE-PHONE'}},
  {collection:'orders',id:'order-1',after:{studentId:'student-1',phone:'PRIVATE-PHONE'}},
 ];
 const page=selectAuditPage([{id:'event-1',at:'2026-10-11T00:00:00.000Z',action:'enrollment.transfer',outcome:'success',details:{changes}}],[],new URLSearchParams(),{students:[{id:'student-1',name:'王同学'}],classes:{id:'malformed'} });
 const summary=page.events[0].summary.changes;
 assert.deepEqual(summary.map(({collection,name,relatedStudentName})=>({collection,name,relatedStudentName})),[
  {collection:'courses',name:'新课程',relatedStudentName:undefined},
  {collection:'classes',name:'四年级数学 A 班',relatedStudentName:undefined},
  {collection:'leads',name:'王同学线索',relatedStudentName:undefined},
  {collection:'orders',name:undefined,relatedStudentName:'王同学'},
 ]);
 const output=JSON.stringify(page);for(const privateValue of ['PRIVATE-MATERIAL','PRIVATE-PHONE','details','before','after'])assert.equal(output.includes(privateValue),false);
 assert.equal(page.events[0].category,'enrollment');assert.equal(page.events[0].attention,true);
});
// Synchronize on the server receiving the first JSON byte; no sleep-based races.
async function heldJson(server,pathname,token,body,method='POST'){
 const marker=require('node:crypto').randomUUID();let startedResolve;const started=new Promise(resolve=>startedResolve=resolve);
 function observe(req){if(req.headers['x-held-test']===marker){req.once('data',()=>{server.off('request',observe);startedResolve();});}}
 server.prependListener('request',observe);let req;const response=new Promise((resolve,reject)=>{req=http.request({hostname:'127.0.0.1',port:server.address().port,path:pathname,method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,'X-Held-Test':marker}},res=>{let data='';res.on('data',x=>data+=x);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(data)}))});req.on('error',reject)});const data=JSON.stringify(body);req.write(data.slice(0,1));await started;return{finish:()=>{req.end(data.slice(1));return response},cancel:()=>req.destroy()};
}
test('in-flight admin create is rejected when its session is revoked before JSON completes',async t=>{const f=await fixture(t),admin=await adminReady(f);const second=await employee(f,admin,{name:'并发管理员',employeeNo:'ADM02',roleIds:['superadmin'],scope:{type:'all'}}),token=await activate(f,second);const held=await heldJson(f.server,'/v1/admin/users',token,{name:'越权创建',employeeNo:'NOPE01',roleIds:['superadmin'],scope:{type:'all'}});const revoked=await f.call(admin,'/v1/admin/users/'+second.user.id,'PATCH',{roleIds:['sales'],scope:{type:'own'}});assert.equal(revoked.status,200);const result=await held.finish();assert.equal(result.status,401);assert.equal(result.body.code,'SESSION_EXPIRED');const users=await f.call(admin,'/v1/admin/users');assert.ok(!users.body.users.some(u=>u.employeeNo==='NOPE01'));});
test('in-flight admin update and password reset cannot use a revoked administrator reference',async t=>{for(const kind of ['update','reset']){const f=await fixture(t),admin=await adminReady(f);const second=await employee(f,admin,{name:'并发管理员',employeeNo:'ADM03',roleIds:['superadmin'],scope:{type:'all'}}),token=await activate(f,second);const target=await employee(f,admin,{name:'目标员工',employeeNo:'TARGET01'});const before=(await f.call(admin,'/v1/admin/users')).body.users.find(x=>x.id===target.user.id);const held=await heldJson(f.server,'/v1/admin/users/'+target.user.id+(kind==='reset'?'/reset-password':''),token,kind==='reset'?{}:{roleIds:['superadmin'],scope:{type:'all'}},kind==='reset'?'POST':'PATCH');assert.equal((await f.call(admin,'/v1/admin/users/'+second.user.id,'PATCH',{disabled:true})).status,200);const result=await held.finish();assert.equal(result.status,401);const after=(await f.call(admin,'/v1/admin/users')).body.users.find(x=>x.id===target.user.id);assert.equal(after.version,before.version);assert.deepEqual(after.roleIds,['sales']);}});
test('in-flight self password change cannot override a concurrent administrator reset',async t=>{const f=await fixture(t),admin=await adminReady(f),created=await employee(f,admin),token=await activate(f,created);const held=await heldJson(f.server,'/v1/auth/password',token,{currentPassword:'Employee-Password!938AA',newPassword:'Stale-Change!9234AA'});const reset=await f.call(admin,'/v1/admin/users/'+created.user.id+'/reset-password','POST',{});assert.equal(reset.status,200);const result=await held.finish();assert.equal(result.status,401);assert.equal((await f.login(created.user.username,'Stale-Change!9234AA')).status,401);const login=await f.login(created.user.username,reset.body.initialPassword);assert.equal(login.status,200);assert.equal(login.body.user.mustChangePassword,true);});
test('slow PATCH merges policy with the latest target rather than restoring a stale snapshot',async t=>{const f=await fixture(t),admin=await adminReady(f),created=await employee(f,admin);const held=await heldJson(f.server,'/v1/admin/users/'+created.user.id,admin,{name:'新姓名'},'PATCH');assert.equal((await f.call(admin,'/v1/admin/users/'+created.user.id,'PATCH',{deniedPermissions:['lead.follow']})).status,200);const result=await held.finish();assert.equal(result.status,200);assert.equal(result.body.user.name,'新姓名');assert.deepEqual(result.body.user.deniedPermissions,['lead.follow']);assert.ok(!result.body.user.permissions.includes('lead.follow'));});

test('Chinese employee names survive arbitrary UTF-8 request chunk boundaries',async t=>{const f=await fixture(t),admin=await adminReady(f);const payload=Buffer.from(JSON.stringify({name:'陈老师',employeeNo:'UTF01',roleIds:['sales']}));const firstByte=payload.indexOf(Buffer.from('陈'));let sendRest;const response=new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:f.server.address().port,path:'/v1/admin/users',method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+admin}},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body)}))});req.on('error',reject);req.write(payload.subarray(0,firstByte+1),()=>{sendRest=()=>req.end(payload.subarray(firstByte+1));});f.server.once('request',request=>request.once('data',()=>setImmediate(()=>sendRest())));});const result=await response;assert.equal(result.status,201);assert.equal(result.body.user.name,'陈老师');});
test('audit rejects reversed date ranges instead of returning a misleading empty result',async t=>{const f=await fixture(t),admin=await adminReady(f);const r=await f.call(admin,'/v1/admin/audit?from=2026-11-01&to=2026-10-01');assert.equal(r.status,400);assert.equal(r.body.code,'INVALID_DATE')});
test('authenticated CLI includes settings and browser commands only under their declared grants',async t=>{const f=await fixture(t),admin=await adminReady(f),created=await employee(f,admin),token=await activate(f,created);const sales=await f.call(token,'/v1/catalog');assert.equal(sales.status,200);assert.ok(sales.body.frontendOperations.some(x=>x.label==='办理补费'));assert.ok(!sales.body.frontendOperations.some(x=>x.label==='收款渠道设置'));assert.ok(!sales.body.frontendOperations.some(x=>x.label==='创建校区'));const all=await f.call(admin,'/v1/catalog');assert.ok(all.body.frontendOperations.some(x=>x.label==='收款渠道设置'));assert.ok(all.body.frontendOperations.some(x=>x.label==='创建校区'))});

test('publish-only marketing permission includes page discovery without creating activities',async t=>{const f=await fixture(t),admin=await adminReady(f),created=await employee(f,admin,{additionalPermissions:['promotion.publish'],deniedPermissions:['promotion.create']}),token=await activate(f,created);const response=await f.call(token,'/v1/catalog');assert.equal(response.status,200);for(const page of ['mallGroup','mallJoint','mallCoupon'])assert.ok(response.body.frontendOperations.some(x=>x.id==='page.'+page));assert.ok(!response.body.frontendOperations.some(x=>x.label==='创建拼团'));});


test('password minimum accepts ten characters while preserving complexity and username checks',()=>{
 const {strongPassword}=require('../src/auth-credentials.cjs');
 const accepted='Abcdef12!3';assert.equal(accepted.length,10);assert.equal(strongPassword(accepted,'employee01'),true);
 for(const rejected of ['Abcde12!3','abcdef12!3','ABCDEF12!3','Abcdefgh!?','Abcdef1234'])assert.equal(strongPassword(rejected,'employee01'),false,rejected);
 assert.equal(strongPassword(accepted,'ABC'),false);
});
test('nine-character password is rejected, ten-character password can be saved and used to log in',async t=>{
 const f=await fixture(t),password='Abcdef12!3';
 const short=await f.call(f.initial.body.token,'/v1/auth/password','POST',{currentPassword:f.credentials.initialPassword,newPassword:'Abcde12!3'});
 assert.equal(short.status,400);assert.equal(short.body.code,'WEAK_PASSWORD');assert.match(short.body.message,/至少 10 位/);
 const changed=await f.call(f.initial.body.token,'/v1/auth/password','POST',{currentPassword:f.credentials.initialPassword,newPassword:password});
 assert.equal(changed.status,200);assert.equal(changed.body.reauthenticate,true);
 assert.equal((await f.call(f.initial.body.token,'/v1/auth/me')).status,401);
 const login=await f.login(f.credentials.username,password);assert.equal(login.status,200);assert.equal(login.body.user.mustChangePassword,false);
 const same=await f.call(login.body.token,'/v1/auth/password','POST',{currentPassword:password,newPassword:password});assert.equal(same.status,400);assert.equal(same.body.code,'PASSWORD_UNCHANGED');
 const wrongCurrent=await f.call(login.body.token,'/v1/auth/password','POST',{currentPassword:'Wrong123!X',newPassword:'Newpass34!'});assert.equal(wrongCurrent.status,403);assert.equal(wrongCurrent.body.code,'CURRENT_PASSWORD_INVALID');
});
async function browserChallenge(f){const challenge=await request(f.server,'/v1/auth/captcha');assert.equal(challenge.status,200);return {...challenge.body,cookie:challenge.headers['set-cookie'][0].split(';')[0]};}
async function browserSignIn(f,password,remember=false){const challenge=await browserChallenge(f);return request(f.server,'/v1/auth/login','POST',{username:f.credentials.username,password,client:'browser',remember,captchaId:challenge.id,captchaCode:'444444'},{Origin:origin,Cookie:challenge.cookie});}
const browserHeaders=response=>({Origin:origin,Cookie:response.headers['set-cookie'].find(x=>x.startsWith('siyue_session=')).split(';')[0],'X-CSRF-Token':response.body.csrfToken});
test('browser first password change atomically rotates sessions and preserves the remembered thirty-day lifetime',async t=>{
 const f=await fixture(t),login=await browserSignIn(f,f.credentials.initialPassword,true);assert.equal(login.status,200);assert.ok(Date.parse(login.body.expiresAt)-Date.now()<=600000);
 const before=browserHeaders(login);assert.match(login.headers['set-cookie'].find(x=>x.startsWith('siyue_session=')),/Max-Age=59\d|Max-Age=600/);
 const changed=await request(f.server,'/v1/auth/password','POST',{currentPassword:f.credentials.initialPassword,newPassword},before);assert.equal(changed.status,200);assert.equal(changed.body.reauthenticate,false);assert.equal(changed.body.user.mustChangePassword,false);assert.equal(changed.body.token,undefined);assert.notEqual(changed.body.csrfToken,login.body.csrfToken);
 const after=browserHeaders(changed);assert.notEqual(after.Cookie,before.Cookie);assert.ok(Date.parse(changed.body.expiresAt)-Date.now()>29*86400000);assert.ok(Date.parse(changed.body.expiresAt)-Date.now()<=30*86400000);
 assert.match(changed.headers['set-cookie'][0],/Max-Age=259199\d|Max-Age=2592000/);assert.equal((await request(f.server,'/v1/auth/me','GET',undefined,before)).status,401);assert.equal((await f.call(f.initial.body.token,'/v1/auth/me')).status,401);assert.equal((await request(f.server,'/v1/catalog','GET',undefined,after)).status,200);
 assert.equal((await request(f.server,'/v1/auth/logout','POST',{},after)).status,200);assert.equal((await request(f.server,'/v1/auth/me','GET',undefined,after)).status,401);
});
test('unremembered browser sessions are session cookies capped at eight hours, CLI never receives a thirty-day token',async t=>{
 const f=await fixture(t),login=await browserSignIn(f,f.credentials.initialPassword);assert.equal(login.status,200);assert.doesNotMatch(login.headers['set-cookie'].find(x=>x.startsWith('siyue_session=')),/Max-Age|Expires/);
 const changed=await request(f.server,'/v1/auth/password','POST',{currentPassword:f.credentials.initialPassword,newPassword},browserHeaders(login));assert.equal(changed.body.reauthenticate,false);assert.doesNotMatch(changed.headers['set-cookie'][0],/Max-Age|Expires/);assert.ok(Date.parse(changed.body.expiresAt)-Date.now()<=8*3600000);assert.ok(Date.parse(changed.body.expiresAt)-Date.now()>7*3600000);
 const cli=await f.login(f.credentials.username,newPassword);assert.equal(cli.status,200);assert.ok(Date.parse(cli.body.expiresAt)-Date.now()<=8*3600000);
 const invalid=await request(f.server,'/v1/auth/login','POST',{username:f.credentials.username,password:newPassword,client:'cli',remember:true});assert.equal(invalid.status,400);assert.equal(invalid.body.code,'INVALID_CLIENT_OPTIONS');
 const adminChange=await request(f.server,'/v1/auth/password','POST',{currentPassword:newPassword,newPassword:'NextPass!30'},browserHeaders(changed));assert.equal(adminChange.body.reauthenticate,true);assert.match(adminChange.headers['set-cookie'][0],/Max-Age=0/);
});
test('browser cannot bypass captcha using cli and missing, incorrect, reused or unbound captcha challenges fail',async t=>{
 const f=await fixture(t),base={username:f.credentials.username,password:f.credentials.initialPassword};
 for(const headers of [{Origin:origin},{'Sec-Fetch-Site':'same-origin'}]){const res=await request(f.server,'/v1/auth/login','POST',{...base,client:'cli'},headers);assert.equal(res.status,403);assert.equal(res.body.code,'BROWSER_CLIENT_REQUIRED');}
 const missing=await request(f.server,'/v1/auth/login','POST',{...base,client:'browser'},{Origin:origin});assert.equal(missing.body.code,'CAPTCHA_REQUIRED');
 let cap=await browserChallenge(f);const body={...base,client:'browser',captchaId:cap.id,captchaCode:'111111'};const headers={Origin:origin,Cookie:cap.cookie};
 const incorrect=await request(f.server,'/v1/auth/login','POST',body,headers);assert.equal(incorrect.body.code,'CAPTCHA_INVALID');assert.match(incorrect.headers['set-cookie'][0],/Max-Age=0/);
 const replay=await request(f.server,'/v1/auth/login','POST',{...body,captchaCode:'444444'},headers);assert.equal(replay.body.code,'CAPTCHA_INVALID');
 cap=await browserChallenge(f);const unbound=await request(f.server,'/v1/auth/login','POST',{...base,client:'browser',captchaId:cap.id,captchaCode:'444444'},{Origin:origin});assert.equal(unbound.body.code,'CAPTCHA_INVALID');
 const logged=await f.login(f.credentials.username,f.credentials.initialPassword);assert.equal(logged.status,200);
 const raw=fs.readFileSync(f.file,'utf8');for(const secret of [body.captchaId,cap.id,'111111','444444'])assert.ok(!raw.includes(secret));
});
test('captcha endpoint is no-store, constrained by origin and rate limit, and does not append audit data',async t=>{
 const f=await fixture(t);const count=JSON.parse(fs.readFileSync(f.file)).audit.length;
 const cross=await request(f.server,'/v1/auth/captcha','GET',undefined,{Origin:'https://evil.example'});assert.equal(cross.status,403);
 let last;for(let i=0;i<21;i++)last=await request(f.server,'/v1/auth/captcha');assert.equal(last.status,429);assert.equal(last.body.code,'RATE_LIMITED');assert.equal(last.headers['cache-control'],'no-store');assert.equal(JSON.parse(fs.readFileSync(f.file)).audit.length,count);
});
test('failed first browser password transaction does not issue a new cookie or revoke existing sessions',async t=>{
 const f=await fixture(t),login=await browserSignIn(f,f.credentials.initialPassword,true),headers=browserHeaders(login),rename=fs.renameSync;
 fs.renameSync=()=>{throw new Error('simulated storage unavailable');};let result;try{result=await request(f.server,'/v1/auth/password','POST',{currentPassword:f.credentials.initialPassword,newPassword},headers);}finally{fs.renameSync=rename;}
 assert.equal(result.status,503);assert.equal(result.headers['set-cookie'],undefined);const me=await request(f.server,'/v1/auth/me','GET',undefined,headers);assert.equal(me.status,200);assert.equal(me.body.user.mustChangePassword,true);assert.equal((await f.call(f.initial.body.token,'/v1/auth/me')).status,200);
});
test('remembered browser sessions are invalidated by administrator resets and permission edits',async t=>{
 for(const action of ['reset','permission']){const f=await fixture(t),admin=await adminReady(f),login=await browserSignIn(f,newPassword,true);assert.equal(login.status,200);const headers=browserHeaders(login);assert.ok(Date.parse(login.body.expiresAt)-Date.now()>29*86400000);
  const changed=action==='reset'?await f.call(admin,'/v1/admin/users/'+login.body.user.id+'/reset-password','POST',{}):await f.call(admin,'/v1/admin/users/'+login.body.user.id,'PATCH',{name:'修改后的管理员'});assert.equal(changed.status,200);assert.equal((await request(f.server,'/v1/auth/me','GET',undefined,headers)).status,401);
 }
});
test('a solved captcha cannot be reused after the password was wrong',async t=>{
 const f=await fixture(t),cap=await browserChallenge(f),headers={Origin:origin,Cookie:cap.cookie},body={username:f.credentials.username,password:'WrongPass!30',client:'browser',captchaId:cap.id,captchaCode:'444444'};
 assert.equal((await request(f.server,'/v1/auth/login','POST',body,headers)).body.code,'INVALID_CREDENTIALS');assert.equal((await request(f.server,'/v1/auth/login','POST',{...body,password:f.credentials.initialPassword},headers)).body.code,'CAPTCHA_INVALID');
});
test('role permission edits immediately affect live sessions and preserve user overrides',async t=>{
 const f=await fixture(t),admin=await adminReady(f),created=await employee(f,admin,{additionalPermissions:['report.read'],deniedPermissions:['class.create','order.confirmReceipt']}),token=await activate(f,created),plain=await employee(f,admin,{name:'普通角色成员',employeeNo:'E011'}),plainToken=await activate(f,plain);
 const rolesResponse=await f.call(token,'/v1/roles');assert.equal(rolesResponse.status,200);const role=rolesResponse.body.roles.find(item=>item.id==='sales');assert.equal(role.editable,true);assert.equal(role.version,1);assert.ok(role.permissions.includes('lead.follow'));assert.ok(rolesResponse.body.reservedPermissions.includes('role.grant'));const beforeMe=await f.call(token,'/v1/auth/me');
 const adminRoles=await f.call(admin,'/v1/roles');const superadmin=adminRoles.body.roles.find(item=>item.id==='superadmin');assert.equal(superadmin.editable,false);assert.ok(superadmin.permissions.includes('role.grant'));
 const nextPermissions=role.permissions.filter(value=>value!=='lead.follow').concat('order.confirmReceipt');
 const updated=await f.call(admin,'/v1/admin/roles/sales','PATCH',{permissions:nextPermissions,expectedVersion:1});assert.equal(updated.status,200,JSON.stringify(updated.body));assert.equal(updated.body.changed,true);assert.equal(updated.body.affectedUsers,2);assert.equal(updated.body.role.version,2);
 const me=await f.call(token,'/v1/auth/me');assert.equal(me.status,200);assert.equal(me.body.user.version,beforeMe.body.user.version+1);assert.ok(!me.body.user.permissions.includes('lead.follow'));assert.ok(!me.body.user.permissions.includes('order.confirmReceipt'));assert.ok(me.body.user.permissions.includes('report.read'));assert.ok(me.body.user.deniedPermissions.includes('class.create'));
 const plainMe=await f.call(plainToken,'/v1/auth/me');assert.equal(plainMe.status,200);assert.ok(!plainMe.body.user.permissions.includes('lead.follow'));assert.ok(plainMe.body.user.permissions.includes('order.confirmReceipt'));
 assert.equal((await f.call(token,'/v1/operations/lead.follow/execute','POST',{})).status,403);assert.equal((await f.call(plainToken,'/v1/operations/order.confirmReceipt/execute','POST',{})).status,501);
 const audit=await f.call(admin,'/v1/admin/audit?action=role.update&view=all');assert.equal(audit.status,200);const event=audit.body.events[0];assert.equal(event.targetId,'role:sales');assert.equal(event.targetName,'销售');assert.equal(event.attention,true);assert.deepEqual(event.summary.permissionsAdded,['order.confirmReceipt']);assert.deepEqual(event.summary.permissionsRemoved,['lead.follow']);assert.equal(event.summary.affectedUsers,2);assert.equal(event.details,undefined);assert.equal(event.ip,undefined);
});
test('role edits do not revive an expired session by advancing its version',async t=>{
 const f=await fixture(t),admin=await adminReady(f);
 const remembered=await browserSignIn(f,newPassword,true);assert.equal(remembered.status,200);
 const adminHeaders=browserHeaders(remembered),created=await employee(f,admin),token=await activate(f,created);
 const tokenHash=require('../src/auth-credentials.cjs').tokenHash;
 const before=JSON.parse(fs.readFileSync(f.file,'utf8'));
 const originalSession=before.sessions.find(session=>session.tokenHash===tokenHash(token));assert.ok(originalSession);
 const now=Date.now;
 try{
  Date.now=()=>now()+9*60*60*1000;
  const roles=await request(f.server,'/v1/roles','GET',undefined,adminHeaders);assert.equal(roles.status,200);
  const sales=roles.body.roles.find(role=>role.id==='sales');
  const updated=await request(f.server,'/v1/admin/roles/sales','PATCH',{permissions:sales.permissions.filter(value=>value!=='lead.follow'),expectedVersion:sales.version},adminHeaders);
  assert.equal(updated.status,200,JSON.stringify(updated.body));
  const after=JSON.parse(fs.readFileSync(f.file,'utf8'));
  const storedSession=after.sessions.find(session=>session.tokenHash===tokenHash(token));
  assert.equal(storedSession.version,originalSession.version);assert.equal(storedSession.expiresAt,originalSession.expiresAt);
 }finally{Date.now=now;}
 assert.equal((await f.call(token,'/v1/auth/me')).status,401);
});
test('role edits enforce admin and CSRF, reserved permission and version checks, and no-op writes nothing',async t=>{
 const f=await fixture(t),admin=await adminReady(f),created=await employee(f,admin),token=await activate(f,created),rolesResponse=await f.call(admin,'/v1/roles'),sales=rolesResponse.body.roles.find(item=>item.id==='sales');
 const denied=await f.call(token,'/v1/admin/roles/sales','PATCH',{permissions:sales.permissions,expectedVersion:1});assert.equal(denied.status,403);
 const reservedResult=await f.call(admin,'/v1/admin/roles/sales','PATCH',{permissions:sales.permissions.concat('role.grant'),expectedVersion:1});assert.equal(reservedResult.status,400);
 const duplicate=await f.call(admin,'/v1/admin/roles/sales','PATCH',{permissions:sales.permissions.concat(sales.permissions[0]),expectedVersion:1});assert.equal(duplicate.status,400);
 const unknown=await f.call(admin,'/v1/admin/roles/sales','PATCH',{permissions:sales.permissions.concat('made.up'),expectedVersion:1});assert.equal(unknown.status,400);
 const protectedResult=await f.call(admin,'/v1/admin/roles/superadmin','PATCH',{permissions:[],expectedVersion:1});assert.equal(protectedResult.status,403);assert.equal(protectedResult.body.code,'ROLE_PROTECTED');
 const browser=await f.login(f.credentials.username,newPassword,'browser',{Origin:origin});assert.equal(browser.status,200);const cookie=browser.headers['set-cookie'].find(value=>value.startsWith('siyue_session=')).split(';')[0];
 const noCsrf=await request(f.server,'/v1/admin/roles/sales','PATCH',{permissions:sales.permissions.filter(value=>value!=='lead.follow'),expectedVersion:1},{Cookie:cookie,Origin:origin});assert.equal(noCsrf.status,403);assert.equal(noCsrf.body.code,'CSRF_REJECTED');
 const headers={Cookie:cookie,Origin:origin,'X-CSRF-Token':browser.body.csrfToken};
 const noOpBefore=JSON.parse(fs.readFileSync(f.file,'utf8'));const noOp=await request(f.server,'/v1/admin/roles/sales','PATCH',{permissions:sales.permissions,expectedVersion:1},headers);assert.equal(noOp.status,200);assert.equal(noOp.body.changed,false);assert.equal(noOp.body.role.version,1);const noOpAfter=JSON.parse(fs.readFileSync(f.file,'utf8'));assert.equal(noOpAfter.rolePolicies.sales.version,1);assert.equal(noOpAfter.users.find(user=>user.id===created.user.id).version,noOpBefore.users.find(user=>user.id===created.user.id).version);assert.equal(noOpAfter.audit.length,noOpBefore.audit.length);
 const changed=await request(f.server,'/v1/admin/roles/sales','PATCH',{permissions:sales.permissions.filter(value=>value!=='lead.follow'),expectedVersion:1},headers);assert.equal(changed.status,200);const stale=await request(f.server,'/v1/admin/roles/sales','PATCH',{permissions:sales.permissions,expectedVersion:1},headers);assert.equal(stale.status,409);assert.equal(stale.body.code,'ROLE_VERSION_CONFLICT');
});
test('role policies are persisted independently and old auth storage receives defaults',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'siyue-role-policy-'));try{const file=path.join(dir,'auth.json'),out=path.join(dir,'credentials.json');bootstrap(file,out);const state=JSON.parse(fs.readFileSync(file,'utf8'));delete state.rolePolicies;fs.writeFileSync(file,JSON.stringify(state),{mode:0o600});const store=new AuthStore(file);assert.equal(store.state.rolePolicies.sales.version,1);store.transact(candidate=>{candidate.rolePolicies.sales={permissions:['dashboard.read'],version:2};});store.close();const restarted=new AuthStore(file);assert.deepEqual(restarted.state.rolePolicies.sales,{permissions:['dashboard.read'],version:2});restarted.close();}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('persistent CLI pairing requires browser approval, binds current policy, stores only token hash, and supports revocation',async t=>{const f=await fixture(t),admin=await adminReady(f);const start=await request(f.server,'/v1/auth/cli-pair/start','POST',{name:'测试 Mac'});assert.equal(start.status,201);const proof={deviceCode:start.body.deviceCode};assert.equal((await request(f.server,'/v1/auth/cli-pair/poll','POST',proof)).status,202);assert.equal((await f.call(admin,'/v1/auth/cli-pair/approve','POST',{userCode:start.body.userCode})).status,403);const browser=await f.login(f.credentials.username,newPassword,'browser',{Origin:origin});assert.equal(browser.status,200);const headers={Cookie:browser.headers['set-cookie'].find(x=>x.startsWith('siyue_session=')).split(';')[0],Origin:origin,'X-CSRF-Token':browser.body.csrfToken};assert.equal((await request(f.server,'/v1/auth/cli-pair/approve','POST',{userCode:start.body.userCode},{...headers,'X-CSRF-Token':'bad'})).status,403);assert.equal((await request(f.server,'/v1/auth/cli-pair/approve','POST',{userCode:start.body.userCode},headers)).status,200);const paired=await request(f.server,'/v1/auth/cli-pair/poll','POST',proof);assert.equal(paired.status,200);assert.equal(paired.body.expiresAt,null);assert.equal((await f.call(paired.body.token,'/v1/auth/me')).status,200);const repeated=await request(f.server,'/v1/auth/cli-pair/poll','POST',proof);assert.equal(repeated.body.token,paired.body.token);assert(!fs.readFileSync(f.file,'utf8').includes(paired.body.token));assert.equal((await f.call(admin,'/v1/auth/cli-connections/revoke','POST',{id:paired.body.connectionId})).status,200);assert.equal((await f.call(paired.body.token,'/v1/auth/me')).status,401);});
test('pairing rejects browser start and wrong proof; account password change invalidates persistent device',async t=>{const f=await fixture(t),admin=await adminReady(f);assert.equal((await request(f.server,'/v1/auth/cli-pair/start','POST',{name:'Mac'},{Origin:origin})).status,403);assert.equal((await request(f.server,'/v1/auth/cli-pair/poll','POST',{deviceCode:'unknown'})).status,410);const start=await request(f.server,'/v1/auth/cli-pair/start','POST',{name:'Mac'});const browser=await f.login(f.credentials.username,newPassword,'browser',{Origin:origin});const headers={Cookie:browser.headers['set-cookie'].find(x=>x.startsWith('siyue_session=')).split(';')[0],Origin:origin,'X-CSRF-Token':browser.body.csrfToken};assert.equal((await request(f.server,'/v1/auth/cli-pair/approve','POST',{userCode:start.body.userCode},headers)).status,200);const paired=await request(f.server,'/v1/auth/cli-pair/poll','POST',{deviceCode:start.body.deviceCode});assert.equal(paired.status,200);assert.equal((await f.call(admin,'/v1/auth/password','POST',{currentPassword:newPassword,newPassword:'Changed-Password!8482AA'})).status,200);assert.equal((await f.call(paired.body.token,'/v1/auth/me')).status,401);assert.equal((await request(f.server,'/v1/auth/cli-pair/poll','POST',{deviceCode:start.body.deviceCode})).status,403);});
test('persistent device survives storage reload, cannot become a browser cookie, and logout revokes it',async t=>{const f=await fixture(t);await adminReady(f);const start=await request(f.server,'/v1/auth/cli-pair/start','POST',{name:'持久设备'});const browser=await f.login(f.credentials.username,newPassword,'browser',{Origin:origin});const headers={Cookie:browser.headers['set-cookie'].find(x=>x.startsWith('siyue_session=')).split(';')[0],Origin:origin,'X-CSRF-Token':browser.body.csrfToken};assert.equal((await request(f.server,'/v1/auth/cli-pair/approve','POST',{userCode:start.body.userCode},headers)).status,200);const paired=await request(f.server,'/v1/auth/cli-pair/poll','POST',{deviceCode:start.body.deviceCode});assert.equal(paired.status,200);await new Promise(resolve=>f.server.close(resolve));const server=createServer({auth:{storeFile:f.file,publicOrigin:origin}});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));const call=(p,m='GET',body)=>request(server,p,m,body,{Authorization:'Bearer '+paired.body.token});assert.equal((await call('/v1/auth/me')).status,200);assert.equal((await request(server,'/v1/auth/me','GET',undefined,{Cookie:'siyue_session='+paired.body.token})).status,401);assert.equal((await call('/v1/auth/logout','POST',{})).status,200);assert.equal((await call('/v1/auth/me')).status,401);});
