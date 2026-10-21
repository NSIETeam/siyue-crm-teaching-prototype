'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const client=require('./auth-client.cjs');
function response(ok,status=200,data={ok:true}){return{ok,status,json:async()=>data}}
test('CLI authentication pins each command to one server and isolated config session',async t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'siyue-cli-isolation-'))),envA={SIYUE_CONFIG_DIR:path.join(root,'account-a')},envB={SIYUE_CONFIG_DIR:path.join(root,'account-b')},calls=[],originalFetch=global.fetch;t.after(()=>{global.fetch=originalFetch;fs.rmSync(root,{recursive:true,force:true})});
 client.writeSession({server:'https://crm-a.example.test/api/',token:'TEST-TOKEN-A',user:{id:'user-a'}},envA);client.writeSession({server:'https://crm-b.example.test/tenant/',token:'TEST-TOKEN-B',user:{id:'user-b'}},envB);
 global.fetch=async(url,options)=>{calls.push({url:String(url),authorization:options.headers.Authorization});return response(true)};
 await client.authenticated('v1/auth/me',{},envA);await client.authenticated('v1/auth/me',{},envB);
 assert.equal(calls.length,2);assert.match(calls[0].url,/crm-a\.example\.test\/api\/v1\/auth\/me$/);assert.equal(calls[0].authorization,'Bearer TEST-TOKEN-A');assert.match(calls[1].url,/crm-b\.example\.test\/tenant\/v1\/auth\/me$/);assert.equal(calls[1].authorization,'Bearer TEST-TOKEN-B');
 client.writeSession({server:'https://crm-c.example.test/api/',token:'TEST-TOKEN-C',user:{id:'user-c'}},envA);
 await assert.rejects(client.authenticated('v1/catalog',{},envA),e=>e.code==='SESSION_CHANGED');assert.equal(calls.length,2);
});
test('an old CLI request cannot clear a newer account session when its response is 401',async t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'siyue-cli-stale-auth-'))),env={SIYUE_CONFIG_DIR:path.join(root,'config')},originalFetch=global.fetch;t.after(()=>{global.fetch=originalFetch;fs.rmSync(root,{recursive:true,force:true})});
 client.writeSession({server:'https://crm-old.example.test/api/',token:'TEST-OLD-TOKEN',user:{id:'old-user'}},env);let finish;
 global.fetch=()=>new Promise(resolve=>{finish=resolve});const pending=client.authenticated('v1/auth/me',{},env);await new Promise(resolve=>setImmediate(resolve));
 client.writeSession({server:'https://crm-new.example.test/api/',token:'TEST-NEW-TOKEN',user:{id:'new-user'}},env);finish(response(false,401,{error:'UNAUTHENTICATED'}));
 await assert.rejects(pending,e=>e.status===401);const current=client.readSession(env);assert.equal(current.server,'https://crm-new.example.test/api/');assert.equal(current.user.id,'new-user');
});

test('a successful response from the previous CLI account is discarded after login changes',async t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'siyue-cli-stale-success-'))),env={SIYUE_CONFIG_DIR:path.join(root,'config')},originalFetch=global.fetch;t.after(()=>{global.fetch=originalFetch;fs.rmSync(root,{recursive:true,force:true})});
 client.writeSession({server:'https://crm.example.test/api/',token:'TEST-OLD-TOKEN',user:{id:'old-user'}},env);let finish;
 global.fetch=()=>new Promise(resolve=>{finish=resolve});const pending=client.authenticated('v1/state',{},env);await new Promise(resolve=>setImmediate(resolve));
 client.writeSession({server:'https://crm.example.test/api/',token:'TEST-NEW-TOKEN',user:{id:'new-user'}},env);finish(response(true,200,{private:'previous account records'}));
 await assert.rejects(pending,e=>e.code==='SESSION_CHANGED');assert.equal(client.readSession(env).user.id,'new-user');
});

test('real CLI logout never removes a newer session created while the old logout was pending',t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'siyue-cli-logout-race-'))),env={SIYUE_CONFIG_DIR:path.join(root,'config')};t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 client.writeSession({server:'https://crm.example.test/api/',token:'TEST-OLD-TOKEN'},env);
 const preload=path.join(root,'fetch.cjs');fs.writeFileSync(preload,`const client=require(${JSON.stringify(path.join(__dirname,'auth-client.cjs'))});global.fetch=async()=>{client.writeSession({server:'https://crm.example.test/api/',token:'TEST-NEW-TOKEN',user:{id:'new-user'}});return {ok:false,status:401,json:async()=>({code:'UNAUTHENTICATED'})}};`);
 const result=require('node:child_process').spawnSync(process.execPath,['--require',preload,path.join(__dirname,'siyue-cli.cjs'),'logout'],{encoding:'utf8',env:{...process.env,...env}});
 assert.equal(result.status,0,result.stderr);assert.equal(client.readSession(env).user.id,'new-user');assert(!result.stdout.includes('TOKEN'));
});
