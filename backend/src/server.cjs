'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const catalog = require('../contracts/operations.json');
const contract = require('../contracts/openapi.json');

const routeDefinitions = Object.entries(contract.paths).flatMap(([pathname, methods]) => {
 const expression = '^' + pathname.split('/').map(part => /^\{.+\}$/.test(part) ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/') + '$';
 return Object.keys(methods).map(method=>({method:method.toUpperCase(),pathname,regex:new RegExp(expression)}));
});
function createServer(options={}) {
 const storeFile=options.auth?.storeFile||process.env.SIYUE_AUTH_STORE;
 const qaLoadMode=options.business?.qaLoadMode??process.env.SIYUE_QA_LOAD_MODE==='1';
 const auth=storeFile?require('./auth-service.cjs').createAuthService({...options.auth,storeFile,qaLoadMode,publicOrigin:options.auth?.publicOrigin||process.env.SIYUE_PUBLIC_ORIGIN,cookiePath:options.auth?.cookiePath||process.env.SIYUE_COOKIE_PATH||'/crm-api/',trustProxy:options.auth?.trustProxy??process.env.SIYUE_TRUST_PROXY==='loopback'}):null;
 const businessFile=options.business?.storeFile||process.env.SIYUE_BUSINESS_STORE;
 let business=null;
 try{if(businessFile){if(!auth)throw new Error('业务服务必须启用账号认证');business=require('./business-service.cjs').createBusinessService({...options.business,qaLoadMode,storeFile:businessFile,auth,enableWorker:options.business?.enableWorker??process.env.SIYUE_POLICY_WORKER==='1',publicOrigin:options.auth?.publicOrigin||process.env.SIYUE_PUBLIC_ORIGIN,trustProxy:options.auth?.trustProxy??process.env.SIYUE_TRUST_PROXY==='loopback'});}}catch(error){auth?.close();throw error;}
 const server=http.createServer({maxHeaderSize:16384,headersTimeout:10000,requestTimeout:15000}, async (req,res) => {
   const requestId=crypto.randomUUID();req.requestId=requestId;
   const respond=(status,data)=>{
     res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Request-Id':requestId,'Connection':'close'});
     res.end(JSON.stringify(data));
   };
   let pathname;
   try { pathname=new URL(req.url,'http://127.0.0.1').pathname; } catch { return respond(400,{requestId,code:'BAD_REQUEST',message:'请求路径无效',implemented:false}); }
   if(auth&&pathname==='/healthz'&&req.method==='GET'){try{business?.store.snapshot();return respond(200,{service:'siyue-backend',mode:business?'business-ready':'authentication-ready',authenticationReady:true,businessReady:!!business,paymentProviderReady:false,qaLoadMode:!!business?.qaLoadMode});}catch{return respond(503,{service:'siyue-backend',businessReady:false,code:'STORAGE_UNAVAILABLE'});}}
   if(business){const result=await business.handle(req,res,pathname,respond);if(result!==false)return;}
   if(auth&&pathname!=='/openapi.json'){const result=await auth.handle(req,res,pathname,respond);if(result!==false)return;}
   const known=routeDefinitions.filter(r=>r.regex.test(pathname));
   const route=known.find(r=>r.method===req.method);
   if(!route) return respond(known.length?405:404,{requestId,code:known.length?'METHOD_NOT_ALLOWED':'NOT_FOUND',message:'骨架没有此接口',implemented:false});
   if(pathname==='/healthz') return respond(200,{service:'siyue-backend-blueprint',mode:'design-only',businessReady:false});
   if(pathname==='/v1/catalog') return respond(200,catalog);
   if(pathname==='/openapi.json') return respond(200,contract);
   // Intentionally no identity parsing, body parsing, storage, financial side effects or fake business success.
   return respond(501,{requestId,code:'NOT_IMPLEMENTED',message:'这是后端设计骨架，此业务尚未实现或接入。',implemented:false});
 });
 if(auth){server.on('close',()=>{business?.close();auth.close();});server.on('error',()=>{business?.close();auth.close();});}
 return server;
}
if(require.main===module) {
 const port=Number(process.env.SIYUE_BACKEND_PORT||8787);
 if(!Number.isInteger(port)||port<1||port>65535) throw new Error('SIYUE_BACKEND_PORT 必须为 1–65535');
 const server=createServer();
 for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>server.close(()=>process.exit(0)));
 server.listen(port,'127.0.0.1',()=>process.stdout.write(`思跃后端：http://127.0.0.1:${port}（${process.env.SIYUE_BUSINESS_STORE?'共享业务服务':'账号认证服务'}）\n`));
}
module.exports={createServer,routeDefinitions};
