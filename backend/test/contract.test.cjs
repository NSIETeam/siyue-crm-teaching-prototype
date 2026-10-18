'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {once}=require('node:events');
const {spawnSync}=require('node:child_process');
const {createServer,routeDefinitions}=require('../src/server.cjs');
const catalog=require('../contracts/operations.json');
const openapi=require('../contracts/openapi.json');
const frontend=require('../../cli/operations.json');
const resolve=(root,pointer)=>pointer.slice(2).split('/').reduce((x,key)=>x?.[key.replace(/~1/g,'/').replace(/~0/g,'~')],root);
function walk(value,visit){if(value&&typeof value==='object'){visit(value);Object.values(value).forEach(child=>walk(child,visit));}}
function request(server,pathname,method='GET',headers={},body='') {
 return new Promise((resolveRequest,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:pathname,method,headers},res=>{
   let body='';res.setEncoding('utf8');res.on('data',x=>body+=x);res.on('end',()=>resolveRequest({status:res.statusCode,headers:res.headers,body:JSON.parse(body)}));
  });req.on('error',reject);req.end(body);
 });
}
test('all contract references resolve locally and required object fields are declared',()=>{
 for(const document of [catalog,openapi]) walk(document,node=>{
  if(node.$ref){assert.match(node.$ref,/^#\//);assert.notEqual(resolve(document,node.$ref),undefined,node.$ref);}
  if(Array.isArray(node.required))for(const field of node.required)assert.ok(node.properties?.[field],`undeclared required field ${field}`);
 });
 assert.equal(openapi.openapi,'3.1.0');
});
test('business IDs are stable, unique and frontend aliases refer to existing commands',()=>{
 const existing=new Set(frontend.operations.map(x=>x.id));
 assert.equal(new Set(catalog.operations.map(x=>x.id)).size,catalog.operations.length);
 assert.equal(catalog.authorizationFiltered,false);
 for(const operation of catalog.operations){assert.equal(operation.execution,'planned');assert.match(operation.id,/^[a-zA-Z]+\.[a-zA-Z]+$/);for(const alias of operation.frontendAliases)assert.ok(existing.has(alias),alias);}
 for(const id of ['enrollment.batchCreate','class.batchCreate','class.relocate','enrollment.batchTransfer','teacher.archive','staff.archive','audit.query'])assert.ok(catalog.operations.some(x=>x.id===id));
 const scheduling=frontend.operations.find(x=>x.id==='action.classes.schedule');assert.equal(scheduling?.label,'班级排课');assert.equal(scheduling.execution,'browser-only');
 const owners=catalog.operations.filter(x=>x.frontendAliases.includes(scheduling.id));assert.deepEqual(owners.map(x=>x.permission),['class.create']);
});
test('every planned operation is accepted by preview and execute contract with matching input schema',()=>{
 for(const mode of ['preview','execute']) {
  const route=openapi.paths[`/v1/operations/{operationId}/${mode}`].post;
  const variants=route.requestBody.content['application/json'].schema.oneOf;
  assert.equal(variants.length,catalog.operations.length);
  for(const operation of catalog.operations){const variant=variants.find(x=>x.properties.operationId.const===operation.id);assert.deepEqual(variant.properties.input,operation.inputSchema);assert.ok(variant.required.includes('expectedVersions'));if(mode==='execute')assert.ok(variant.required.includes('previewToken'));}
  if(mode==='execute')assert.ok(route.parameters.some(x=>x.in==='header'&&x.name==='Idempotency-Key'&&x.required));
 }
});
test('lead creation and follow-up contracts expose the current choice and disposition fields',()=>{
 const creation=resolve(catalog,catalog.operations.find(x=>x.id==='lead.create').inputSchema.$ref),follow=resolve(catalog,catalog.operations.find(x=>x.id==='lead.follow').inputSchema.$ref);
 assert.deepEqual(creation.required,['name','phone','source']);assert.deepEqual(creation.properties.followChoice.enum,['self','public']);assert.equal(creation.properties.retainForSelf,undefined);assert.equal(creation.properties.ownerId.type,'string');
 assert.deepEqual(follow.required,['leadId','note','channel']);assert.deepEqual(follow.properties.disposition.enum,['high','medium','low','lost_cold']);assert.deepEqual(follow.properties.channel.enum,['电话','线上会议','现场沟通']);assert.equal(follow.properties.intent,undefined);
 const createAction=frontend.operations.find(x=>x.id==='action.quickRegister.f299e5f6'),followAction=frontend.operations.find(x=>x.id==='action.myLeads.b7fe9ead');
 assert.equal(createAction.execution,'browser-only');assert.ok(createAction.sideEffects.includes('followChoice=self|public'));assert.equal(followAction.execution,'browser-only');assert.match(followAction.sideEffects,/lost_cold/);assert.match(followAction.sideEffects,/不自动提交/);
});
test('HTTP methods and path parameters exactly match contract',()=>{
 const operationIds=[];
 for(const [pathname,methods] of Object.entries(openapi.paths))for(const [method,operation] of Object.entries(methods)){
  operationIds.push(operation.operationId);assert.ok(routeDefinitions.some(x=>x.pathname===pathname&&x.method===method.toUpperCase()));
  for(const [,name] of pathname.matchAll(/\{([^}]+)\}/g))assert.ok(operation.parameters?.some(x=>x.name===name&&x.in==='path'&&x.required));
  if(operation['x-implementation']==='not-implemented')assert.deepEqual(Object.keys(operation.responses),['501']);
 }
 assert.equal(new Set(operationIds).size,operationIds.length);
});
test('generated contract is reproducible',()=>{
 const files=['operations.json','openapi.json'];const before=files.map(x=>fs.readFileSync(path.join(__dirname,'../contracts',x),'utf8'));
 const result=spawnSync(process.execPath,[path.join(__dirname,'../contracts/build.cjs')],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
 files.forEach((name,index)=>assert.equal(fs.readFileSync(path.join(__dirname,'../contracts',name),'utf8'),before[index]));
});
test('HTTP scaffold serves only explicit design data and refuses every business endpoint',async t=>{
 const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
 const health=await request(server,'/healthz');assert.equal(health.status,200);assert.equal(health.body.businessReady,false);assert.equal(health.body.mode,'design-only');
 const catalogResponse=await request(server,'/v1/catalog');assert.equal(catalogResponse.status,200);assert.equal(catalogResponse.body.authorizationFiltered,false);
 const contractResponse=await request(server,'/openapi.json');assert.deepEqual(contractResponse.body,openapi);
 for(const route of routeDefinitions.filter(x=>openapi.paths[x.pathname][x.method.toLowerCase()]['x-implementation'])){
  const pathname=route.pathname.replace('{operationId}','enrollment.create').replace('{jobId}','00000000-0000-4000-8000-000000000001').replace('{provider}','wechat');
  const result=await request(server,pathname,route.method,{'Authorization':'Bearer fabricated','X-Role':'superadmin','Content-Type':'application/json'},route.method==='POST'?'{}':'');
  assert.equal(result.status,501,pathname);assert.equal(result.body.code,'NOT_IMPLEMENTED');assert.equal(result.body.implemented,false);assert.match(result.body.requestId,/^[0-9a-f-]{36}$/);assert.equal(result.headers['cache-control'],'no-store');
 }
 assert.equal((await request(server,'/healthz','POST')).status,405);
 assert.equal((await request(server,'/not-a-route')).status,404);
 assert.equal((await request(server,'/openapiXjson')).status,404);
 assert.equal((await request(server,'/v1/operations/enrollment.create/execute/extra','POST')).status,404);
});
