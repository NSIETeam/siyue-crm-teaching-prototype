'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawn,execFile}=require('node:child_process'),exec=require('node:util').promisify(execFile);
const auth=require('../cli/auth-client.cjs'),{createServer}=require('../backend/src/server.cjs'),{bootstrap}=require('../backend/src/bootstrap-auth.cjs');
const {createBridge,opName}=require('./bridge.cjs');
async function fixture(t){
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'siyue-mcp-test-')));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const storeFile=path.join(dir,'auth.json'),delivery=path.join(dir,'delivery.json');bootstrap(storeFile,delivery);const initial=JSON.parse(fs.readFileSync(delivery));
 const server=createServer({auth:{storeFile,publicOrigin:'https://crm.example.test',allowInsecureTest:true},business:{storeFile:path.join(dir,'business.sqlite')}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const url='http://127.0.0.1:'+server.address().port+'/';
 const first=await auth.request(url,'v1/auth/login',{method:'POST',body:{username:initial.username,password:initial.initialPassword,client:'cli'}});
 const password='Isolated-MCP!Testing123';await auth.request(url,'v1/auth/password',{token:first.token,method:'POST',body:{currentPassword:initial.initialPassword,newPassword:password}});
 const login=await auth.request(url,'v1/auth/login',{method:'POST',body:{username:initial.username,password,client:'cli'}});
 const env={...process.env,SIYUE_CONFIG_DIR:path.join(dir,'cli')};auth.writeSession({server:url,token:login.token},env);
 const request=(endpoint,options={})=>auth.request(url,endpoint,{...options,token:login.token});
 return {dir,env,url,login,request,bridge:createBridge({env}),async employee(){const created=await request('v1/admin/users',{method:'POST',body:{name:'隔离测试销售',employeeNo:crypto.randomUUID(),roleIds:['sales'],scope:{type:'own'}}});const first=await auth.request(url,'v1/auth/login',{method:'POST',body:{username:created.user.username,password:created.initialPassword,client:'cli'}});await auth.request(url,'v1/auth/password',{token:first.token,method:'POST',body:{currentPassword:created.initialPassword,newPassword:password}});return auth.request(url,'v1/auth/login',{method:'POST',body:{username:created.user.username,password,client:'cli'}});}};
}
function rpcClient(t,env){
 const child=spawn(process.execPath,[path.join(__dirname,'server.cjs')],{env,stdio:['pipe','pipe','pipe']});let seq=0,buffer='',stderr='';const waiting=new Map();
 child.stdout.setEncoding('utf8'); // Keep Chinese characters intact across pipe chunk boundaries.
 child.stderr.on('data',b=>stderr+=b);child.stdout.on('data',b=>{buffer+=b;while(buffer.includes('\n')){const i=buffer.indexOf('\n'),line=buffer.slice(0,i);buffer=buffer.slice(i+1);let msg;try{msg=JSON.parse(line)}catch(e){for(const waiter of waiting.values())waiter.reject(e);waiting.clear();return;}const waiter=waiting.get(msg.id);if(waiter){waiting.delete(msg.id);waiter.resolve(msg);}}});
 child.on('exit',(code)=>{for(const waiter of waiting.values())waiter.reject(Error('MCP exited '+code+' '+stderr));waiting.clear();});
 t.after(()=>child.kill());
 return {request(method,params={}){const id=++seq;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{waiting.delete(id);reject(Error('MCP response timeout'))},10000);waiting.set(id,{resolve:v=>{clearTimeout(timer);resolve(v)},reject:e=>{clearTimeout(timer);reject(e)}});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});},notify(method){child.stdin.write(JSON.stringify({jsonrpc:'2.0',method})+'\n');},stderr:()=>stderr};
}
test('stdio lifecycle, live catalog schemas and preview/execute reach the real backend',async t=>{
 const f=await fixture(t),rpc=rpcClient(t,f.env);
 assert.equal((await rpc.request('tools/list')).error.code,-32002);
 const initialized=await rpc.request('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'integration',version:'1'}});assert.equal(initialized.result.protocolVersion,'2025-11-25');rpc.notify('notifications/initialized');
 assert.deepEqual((await rpc.request('ping')).result,{});
 const tools=(await rpc.request('tools/list')).result.tools,catalog=(await f.request('v1/catalog')).operations;
 for(const op of catalog){const tool=tools.find(x=>x.name===opName(op.id));assert(tool,op.id);assert.deepEqual(tool.inputSchema,op.inputSchema);}
 assert.equal(tools.filter(x=>x.name.startsWith('siyue_preview_')).length,catalog.length);
 const preview=(await rpc.request('tools/call',{name:'siyue_preview_campus_create',arguments:{name:'MCP 命令校区',rooms:[{name:'教室1',capacity:20,virtualSeats:2}]}})).result;
 assert.equal(preview.isError,undefined);const p=preview.structuredContent;assert.equal(p.commit,false);assert.equal((await f.request('v1/state')).state.campuses.length,0);assert(!JSON.stringify(preview).includes('previewToken'));
 const committed=(await rpc.request('tools/call',{name:'siyue_execute',arguments:{planId:p.planId}})).result;assert.equal(committed.structuredContent.revision,1);
 const replay=(await rpc.request('tools/call',{name:'siyue_execute',arguments:{planId:p.planId}})).result;assert.equal(replay.structuredContent.replayed,true);
 const list=(await rpc.request('tools/call',{name:'siyue_query',arguments:{query:'campuses'}})).result;assert(JSON.stringify(list).includes('MCP 命令校区'));
 assert.equal((await f.request('v1/state')).state.campuses.length,1);
 const file=path.join(f.env.SIYUE_CONFIG_DIR,'mcp-plans',p.planId+'.json');assert.equal(fs.statSync(file).mode&0o777,0o600);
 assert.equal(rpc.stderr().includes(f.login.token),false);
});
test('MCP identity changes reload tools and cannot execute another employee plan',async t=>{
 const f=await fixture(t);const preview=(await f.bridge.call('siyue_preview_campus_create',{name:'仅管理员草稿'})).structuredContent;
 const sales=await f.employee();auth.writeSession({server:f.url,token:sales.token},f.env);
 const tools=await f.bridge.tools();assert(!tools.some(x=>x.name.startsWith('siyue_admin_')));assert(!tools.some(x=>x.name==='siyue_preview_campus_create'));
 await assert.rejects(f.bridge.call('siyue_execute',{planId:preview.planId}),{code:'WRONG_ACTOR'});
 await assert.rejects(f.bridge.call('siyue_preview_campus_create',{name:'不应创建'}),{code:'FORBIDDEN'});
 await assert.rejects(f.bridge.call('siyue_admin_create',{name:'不应创建',roleIds:['superadmin']}),{code:'FORBIDDEN'});
 assert.equal((await f.request('v1/state')).state.campuses.length,0);
});
test('revocation is checked on every MCP call and an in-flight identity cannot switch',async t=>{
 const f=await fixture(t),sales=await f.employee();auth.writeSession({server:f.url,token:sales.token},f.env);
 const client=auth.sessionClient(f.env);auth.writeSession({server:f.url,token:f.login.token},f.env);await assert.rejects(client.request('v1/state'),{code:'SESSION_CHANGED'});
 auth.writeSession({server:f.url,token:sales.token},f.env);await f.request('v1/admin/users/'+sales.user.id,{method:'PATCH',body:{disabled:true}});
 assert.equal((await f.bridge.call('siyue_status')).structuredContent.authenticated,false);assert.deepEqual((await f.bridge.tools()).map(t=>t.name),['siyue_status']);
});
test('admin initial credentials stay in a private local file and query input cannot select arbitrary endpoints',async t=>{
 const f=await fixture(t),requestId=crypto.randomUUID(),input={requestId,name:'命令行测试教师',roleIds:['teacher'],scope:{type:'assigned'}},created=(await f.bridge.call('siyue_admin_create',input)).structuredContent;
 await assert.rejects(f.bridge.call('siyue_admin_create',input),{code:'OUTPUT_EXISTS'});
 assert.equal((await f.request('v1/admin/users')).users.filter(u=>u.name===input.name).length,1);
 assert(created.user.id);const file=created.credentialFile;assert(file.startsWith(path.join(f.env.SIYUE_CONFIG_DIR,'credentials')));const secret=JSON.parse(fs.readFileSync(file));assert(secret.initialPassword);assert(!JSON.stringify(created).includes(secret.initialPassword));assert.equal(fs.statSync(file).mode&0o777,0o600);
 await assert.rejects(f.bridge.call('siyue_query',{query:'../../admin/users'}));
 await assert.rejects(f.bridge.call('siyue_execute',{planId:'../../session'}),{code:'INVALID_PLAN'});
 const changed=(await f.bridge.call('siyue_admin_update',{id:created.user.id,disabled:true})).structuredContent;assert(changed.user.disabled);
 const archived=(await f.bridge.call('siyue_admin_archive',{id:created.user.id,reason:'隔离测试结束'})).structuredContent;assert(archived.user.archivedAt||archived.archived);
});
test('CLI query and role discovery use the same server and emit JSON',async t=>{
 const f=await fixture(t),cli=path.join(__dirname,'../cli/siyue-cli.cjs');
 for(const args of [['query','campuses'],['roles','list'],['capabilities']]){const response=await exec(process.execPath,[cli,...args],{env:f.env});assert.doesNotThrow(()=>JSON.parse(response.stdout));assert(!response.stdout.includes(f.login.token));}
 const inputFile=path.join(f.dir,'campus.json'),planFile=path.join(f.dir,'cli.plan.json');fs.writeFileSync(inputFile,JSON.stringify({name:'CLI 完整操作校区'}));
 await exec(process.execPath,[cli,'plan','campus.create','--input',inputFile,'--out',planFile],{env:f.env});await exec(process.execPath,[cli,'execute','--plan',planFile],{env:f.env});
 const list=JSON.parse((await exec(process.execPath,[cli,'get','campuses'],{env:f.env})).stdout);assert(JSON.stringify(list).includes('CLI 完整操作校区'));
});

test('stdio invalid input stays on protocol channel and notifications have no response',async t=>{
 const {PassThrough}=require('node:stream'),{serve}=require('./server.cjs'),input=new PassThrough(),output=new PassThrough();let received='';output.on('data',b=>received+=b);
 const server=serve({input,output,bridge:{tools:async()=>[],call:async()=>({content:[]})}});
 input.write('{invalid JSON}\n');input.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'unknown',capabilities:{},clientInfo:{name:'test'}}})+'\n');
 input.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');input.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list'})+'\n');input.write(JSON.stringify({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'x',arguments:[]}})+'\n');input.write(JSON.stringify({jsonrpc:'2.0',id:4,method:'arbitrary/request'})+'\n');
 await server.done();const messages=received.trim().split('\n').map(x=>JSON.parse(x));assert.equal(messages.length,5);assert.equal(messages[0].error.code,-32700);assert.equal(messages[1].result.protocolVersion,'2025-11-25');assert.deepEqual(messages[2].result.tools,[]);assert.equal(messages[3].error.code,-32602);assert.equal(messages[4].error.code,-32601);input.end();
});
