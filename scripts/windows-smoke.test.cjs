'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),readline=require('node:readline');
const {spawn,execFileSync}=require('node:child_process');
const root=process.env.SIYUE_TEST_PACKAGE||path.resolve(__dirname,'..'),auth=require(path.join(root,'cli/auth-client.cjs')),privateFiles=require(path.join(root,'cli/private-files.cjs'));
const cli=path.join(root,'cli/siyue-cli.cjs');
function command(args,env){return new Promise((resolve,reject)=>{const p=spawn(process.execPath,[cli,...args],{env:{...process.env,SIYUE_PASSWORD:'',SIYUE_NEW_PASSWORD:'',...env},windowsHide:true});let stdout='',stderr='';p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);p.on('error',reject);p.on('close',code=>resolve({code,stdout,stderr}));});}
async function ok(args,env){const r=await command(args,env);assert.equal(r.code,0,r.stderr);return JSON.parse(r.stdout);}
function mcp(env,t){
 const child=spawn(process.execPath,[path.join(root,'mcp/server.cjs')],{env:{...process.env,...env},windowsHide:true});let id=0,stderr='';const pending=new Map();
 child.stderr.on('data',b=>stderr+=b);const lines=readline.createInterface({input:child.stdout});
 lines.on('line',line=>{const response=JSON.parse(line);const item=pending.get(response.id);assert.ok(item,'Unexpected stdout: '+line);pending.delete(response.id);clearTimeout(item.timer);response.error?item.reject(Error(JSON.stringify(response.error))):item.resolve(response.result);});
 child.on('exit',code=>{for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error('MCP exited '+code+': '+stderr));}pending.clear();});
 t.after(()=>{child.kill();lines.close();});
 return {notify(method){child.stdin.write(JSON.stringify({jsonrpc:'2.0',method})+'\n');},call(method,params){return new Promise((resolve,reject)=>{const next=++id,timer=setTimeout(()=>{pending.delete(next);reject(Error('MCP request timeout: '+method));},180000);pending.set(next,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:next,method,params})+'\n');});}};
}
test('portable CLI and MCP: encrypted login, Unicode paths, private output, preview, retry and permission denial', {timeout:1200000},async t=>{
 const temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'siyue-windows-'))),config=path.join(temp,'私有 会话'),env={SIYUE_CONFIG_DIR:config};
 t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const token='FAKE_WINDOWS_SESSION_NEVER_PRINT',user={id:'windows-test-user',username:'windows-test',roleIds:['sales'],mustChangePassword:false};let active=false,denied=false,commits=0;const seen=new Set();
 const server=http.createServer(async(req,res)=>{
  if(process.platform==='win32')assert.equal(req.headers.connection,'close');
  let body='';for await(const chunk of req)body+=chunk;body=body?JSON.parse(body):{};
  const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  if(req.url==='/v1/auth/login'){if(body.password!=='Fake-Local-Only-123!')return send(401,{error:'INVALID_CREDENTIALS'});active=true;return send(200,{token,user});}
  if(!active||req.headers.authorization!=='Bearer '+token)return send(401,{error:'UNAUTHENTICATED'});
  if(req.url==='/v1/auth/me')return send(200,{user});
  if(req.url==='/v1/auth/logout'){active=false;return send(200,{loggedOut:true});}
  if(req.url==='/v1/catalog')return send(200,{operations:denied?[]:[{id:'lead.create',label:'登记线索',implemented:true,inputSchema:{type:'object',properties:{name:{type:'string'}},required:['name'],additionalProperties:false}}]});
  if(req.url==='/v1/state')return send(200,{revision:1});
  if(req.url==='/v1/operations/lead.create/preview'){assert.equal(body.input.name,'虚构测试');return send(200,{revision:1,previewToken:'fake-preview',expiresAt:'2099-01-01',result:{valid:true}});}
  if(req.url==='/v1/operations/lead.create/execute'){
   if(denied)return send(403,{error:'FORBIDDEN'});assert.equal(body.previewToken,'fake-preview');const key=req.headers['idempotency-key'];assert.ok(key);
   if(!seen.has(key)){seen.add(key);commits++;}return send(200,{commits});
  }
  send(404,{error:'NOT_FOUND'});
 });if(process.platform==='win32')server.keepAliveTimeout=1;await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
 const url='http://127.0.0.1:'+server.address().port+'/';
 assert.equal((await command(['--version'],env)).stdout.trim(),'1.2.0');
 const configuration=await ok(['mcp-config'],env);assert.equal(configuration.mcpServers.siyue.command,process.execPath);assert.equal(configuration.mcpServers.siyue.args[0],path.join(root,'mcp/server.cjs'));assert.equal(fs.existsSync(config),false);
 if(process.platform==='win32'){
  const launcher=path.join(root,'siyue-cli.cmd');
  const result=execFileSync(process.env.ComSpec||'C:\\Windows\\System32\\cmd.exe',['/d','/s','/c','""'+launcher+'" --version"'],{encoding:'utf8',windowsVerbatimArguments:true});
  assert.equal(result.trim(),'1.2.0');
 }
 auth.configDirectory(env); // Diagnose directory protection before protocol error sanitization.
 const rpc=mcp(env,t);const initialized=await rpc.call('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'windows-test',version:'1'}});assert.equal(initialized.serverInfo.version,'1.2.0');rpc.notify('notifications/initialized');
 assert.deepEqual((await rpc.call('tools/list',{})).tools.map(x=>x.name),['siyue_status']);
 assert.equal((await rpc.call('tools/call',{name:'siyue_status',arguments:{}})).structuredContent.authenticated,false);
 const rejected=await command(['login','--username','windows-test','--server',url],{...env,SIYUE_PASSWORD:'wrong'});assert.notEqual(rejected.code,0);
 const login=await command(['login','--username','windows-test','--server',url],{...env,SIYUE_PASSWORD:'Fake-Local-Only-123!'});assert.equal(login.code,0,login.stderr);assert.ok(!login.stdout.includes(token));
 const sessionPath=path.join(config,'session.json');privateFiles.check(sessionPath);assert.equal(auth.readSession(env).token,token);
 if(process.platform==='win32'){
  const stored=fs.readFileSync(sessionPath,'utf8');assert.ok(!stored.includes(token));assert.equal(JSON.parse(stored).format,'siyue-windows-dpapi-v1');
  const bad=JSON.parse(stored);bad.data=Buffer.from('invalid-dpapi').toString('base64');fs.writeFileSync(sessionPath,JSON.stringify(bad));assert.throws(()=>auth.readSession(env),/保护失败/);fs.writeFileSync(sessionPath,stored);
 }
 assert.equal((await ok(['whoami'],env)).user.id,user.id);
 const tools=(await rpc.call('tools/list',{})).tools;assert.ok(tools.some(x=>x.name==='siyue_preview_lead_create'));assert.ok(!tools.some(x=>x.name.startsWith('siyue_admin_')));
 assert.equal((await rpc.call('tools/call',{name:'siyue_status',arguments:{}})).structuredContent.user.id,user.id);
 const input=path.join(temp,'输入 文件.json'),plan=path.join(temp,'预览 文件.json');fs.writeFileSync(input,JSON.stringify({name:'虚构测试'}));
 const preview=await ok(['plan','lead.create','--input',input,'--out',plan],env);assert.equal(preview.commit,false);assert.equal(commits,0);privateFiles.check(plan);
 assert.equal((await ok(['execute','--plan',plan],env)).commits,1);assert.equal((await ok(['execute','--plan',plan],env)).commits,1);
 const mcpPreview=(await rpc.call('tools/call',{name:'siyue_preview_lead_create',arguments:{name:'虚构测试'}})).structuredContent;assert.equal(mcpPreview.commit,false);assert.equal(commits,1);
 const mcpPlan=path.join(config,'mcp-plans',mcpPreview.planId+'.json');privateFiles.check(mcpPlan);
 for(let i=0;i<2;i++){const executed=await rpc.call('tools/call',{name:'siyue_execute',arguments:{planId:mcpPreview.planId}});assert.equal(executed.isError,undefined,JSON.stringify(executed));assert.equal(executed.structuredContent.commits,2);}
 denied=true;const deniedCLI=await command(['execute','--plan',plan],env);assert.notEqual(deniedCLI.code,0);assert.match(deniedCLI.stderr,/FORBIDDEN/);
 assert.equal((await rpc.call('tools/call',{name:'siyue_execute',arguments:{planId:mcpPreview.planId}})).isError,true);assert.equal(commits,2);
 // The reserved credential output must be private BEFORE the remote request executes.
 const credential=path.join(temp,'密码 文件.json');const admin=require(path.join(root,'cli/admin-service.cjs'));
 await admin.execute('create',{name:'虚构账号',roleIds:['sales']},{credentialFile:credential,request:async()=>{assert.equal(fs.statSync(credential).size,0);privateFiles.check(credential);return {user:{id:'fake-user'},initialPassword:'FAKE-ONLY'};}});privateFiles.check(credential);
 await assert.rejects(()=>admin.execute('create',{name:'虚构账号',roleIds:['sales']},{credentialFile:credential,request:async()=>assert.fail('Must not create duplicate account')}),/已经存在/);
 if(process.platform==='win32'){
  // Grant Everyone read explicitly, then prove reads fail closed rather than silently accepting it.
  execFileSync('icacls.exe',[sessionPath,'/grant','*S-1-1-0:(R)'],{stdio:'pipe'});
  assert.throws(()=>auth.readSession(env),/保护失败/);privateFiles.secure(sessionPath);
  const link=path.join(temp,'联接');fs.symlinkSync(config,link,'junction');assert.throws(()=>auth.readSession({SIYUE_CONFIG_DIR:link}),/符号链接/);
 }
 const exited=await ok(['logout'],env);assert.equal(exited.loggedOut,true);assert.equal(fs.existsSync(sessionPath),false);
 assert.equal((await rpc.call('tools/call',{name:'siyue_status',arguments:{}})).structuredContent.authenticated,false);
 if(process.env.SIYUE_TEST_PACKAGE){
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  for(const file of manifest.files)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file.path))).digest('hex'),file.sha256);
  assert.equal(manifest.architecture,process.arch);
 }
});
