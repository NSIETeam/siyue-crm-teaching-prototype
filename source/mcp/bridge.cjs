'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const auth=require('../cli/auth-client.cjs'),business=require('../cli/business-client.cjs');
const object=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
const string={type:'string'};
function record(value){if(!value||typeof value!=='object'||Array.isArray(value))throw auth.failure('INVALID_ARGUMENT','参数必须为 JSON 对象');return value;}
function exact(value,keys){record(value);if(Object.keys(value).some(k=>!keys.includes(k)))throw auth.failure('INVALID_ARGUMENT','包含不支持的参数');}
function opName(id){return 'siyue_preview_'+id.replaceAll('.','_');}
function result(data){return {content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data};}
function errorResult(error){return {content:[{type:'text',text:JSON.stringify({code:error.code||'TOOL_FAILED',message:error.code?error.message:'工具执行失败，请检查连接及参数'})}],isError:true};}
function createBridge({env=process.env}={}){
 function privateFile(folder,id){if(!/^[0-9a-f-]{36}$/.test(id))throw auth.failure('INVALID_PLAN','计划编号无效');const base=auth.configDirectory(env),directory=auth.configDirectory({SIYUE_CONFIG_DIR:path.join(base,folder)});return path.join(directory,id+'.json');}
 async function context(){const client=auth.sessionClient(env),me=await client.request('v1/auth/me');return {client,me};}
 async function catalog(client){const response=await client.request('v1/catalog');return (response.operations||[]).filter(o=>o.implemented===true);}
 const baseTools=[
  {name:'siyue_status',title:'当前员工身份',description:'检查 CLI 登录状态和当前权限。不返回会话令牌；先在终端运行 siyue-cli login。',inputSchema:object(),annotations:{readOnlyHint:true,openWorldHint:false}},
  {name:'siyue_operations',title:'查找平台操作',description:'实时查询当前员工有权执行的全部业务操作及输入字段；关键词可用中文。',inputSchema:object({keyword:string,operationId:string}),annotations:{readOnlyHint:true,openWorldHint:false}},
  {name:'siyue_query',title:'查询平台资料',description:'按授权范围查询档案、课程、班级、日志、报表、补课候选和考勤名单。使用 query 名称与其参数；不会取得额外权限。',inputSchema:object({query:{type:'string',enum:require('../cli/query-client.cjs').queries.map(q=>q.id)},input:{type:'object'}},['query']),annotations:{readOnlyHint:true,openWorldHint:false}},
  {name:'siyue_queries',title:'查询参数说明',description:'列出命名查询及 JSON 输入字段。数据查询在服务端执行权限隔离。',inputSchema:object(),annotations:{readOnlyHint:true,openWorldHint:false}},
  {name:'siyue_execute',title:'提交已预览的业务',description:'提交此前预览返回的 planId；需先核对预览与用户意图。超时只重试原 planId，不创建新计划。不能跨员工或跨服务器提交。',inputSchema:object({planId:string},['planId']),annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:true,openWorldHint:false}}
 ];
 async function tools(){
  let ctx;try{ctx=await context()}catch(error){if(['UNAUTHENTICATED','SESSION_EXPIRED','AUTH_REQUIRED','INVALID_SESSION'].includes(error.code))return [baseTools[0]];throw error;}
  if(ctx.me.user.mustChangePassword)return [baseTools[0]];
  const operations=await catalog(ctx.client),names=new Set(baseTools.map(t=>t.name));
  const generated=operations.map(op=>{const name=opName(op.id);if(names.has(name))throw auth.failure('INVALID_CATALOG','操作工具名称重复');names.add(name);return {name,title:op.label,description:`预览「${op.label}」（${op.id}），不会提交业务。返回 planId 和计算结果；确认后使用 siyue_execute 提交。`,inputSchema:op.inputSchema,annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}}});
  const admin=ctx.me.user.roleIds.includes('superadmin')?require('../cli/admin-service.cjs').operations.map(op=>({name:'siyue_admin_'+op.action,title:op.title,description:`${op.title}。立即提交账号/角色管理操作，仅超级管理员可用；初始密码只保存到本机私有凭据文件，不返回模型。未知结果请先核对账号和日志，勿自动重试。`,inputSchema:op.credentialFileRequired?{...op.inputSchema,properties:{...op.inputSchema.properties,requestId:{type:'string',format:'uuid',description:'本次请求的唯一 UUID；重试必须使用原值，不能换号重新签发密码'}},required:[...op.inputSchema.required,'requestId']}:op.inputSchema,annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:false}})):[];
  return [...baseTools,...generated,...admin];
 }
 async function call(name,input={}){
  record(input);
  if(name==='siyue_status'){
   exact(input,[]);try{const {me,client}=await context();return result({authenticated:true,server:client.server,user:me.user,expiresAt:me.expiresAt,...(me.user.mustChangePassword?{next:'运行 siyue-cli passwd 修改初始密码后重新登录'}:{})})}catch(error){if(['UNAUTHENTICATED','SESSION_EXPIRED','AUTH_REQUIRED'].includes(error.code))return result({authenticated:false,next:'请在终端运行 siyue-cli login --username <员工账号>'});throw error;}
  }
  const {client,me}=await context();if(me.user.mustChangePassword)throw auth.failure('PASSWORD_CHANGE_REQUIRED','请先运行 siyue-cli passwd 并重新登录');
  if(name==='siyue_queries'){exact(input,[]);return result({queries:require('../cli/query-client.cjs').queries});}
  if(name==='siyue_query'){exact(input,['query','input']);const data=await require('../cli/query-client.cjs').query(input.query,input.input||{},client.request);return result(record(data));}
  if(name==='siyue_operations'){exact(input,['keyword','operationId']);for(const key of Object.keys(input))if(typeof input[key]!=='string')throw auth.failure('INVALID_ARGUMENT','查询词必须为文本');const ops=await catalog(client);return result({operations:ops.filter(o=>(!input.operationId||o.id===input.operationId)&&(!input.keyword||[o.id,o.label,...o.aliases||[]].join(' ').includes(input.keyword)))});}
  if(name==='siyue_execute'){
   exact(input,['planId']);const p=business.read(privateFile('mcp-plans',input.planId));
   if(p.format!=='siyue-plan-v1'||p.server!==client.server||p.actorId!==me.user.id)throw auth.failure('WRONG_ACTOR','计划不属于当前员工或服务器');
   if(!/^[a-zA-Z][a-zA-Z0-9.]+$/.test(p.operationId))throw auth.failure('INVALID_PLAN','计划操作编号无效');
   const ops=await catalog(client);if(!ops.some(o=>o.id===p.operationId))throw auth.failure('FORBIDDEN','当前账号已无权提交此操作');
   return result(await client.request('v1/operations/'+p.operationId+'/execute',{method:'POST',idempotencyKey:p.idempotencyKey,body:{input:p.input,expectedRevision:p.expectedRevision,previewToken:p.previewToken}}));
  }
  if(name.startsWith('siyue_preview_')){
   const ops=await catalog(client),op=ops.find(o=>opName(o.id)===name);if(!op)throw auth.failure('FORBIDDEN','操作不存在或当前账号无此权限');
   const snapshot=await client.request('v1/state');const preview=await client.request('v1/operations/'+op.id+'/preview',{method:'POST',body:{input,expectedRevision:snapshot.revision}});
   const id=crypto.randomUUID();business.write(privateFile('mcp-plans',id),{format:'siyue-plan-v1',server:client.server,actorId:me.user.id,operationId:op.id,input,expectedRevision:preview.revision,previewToken:preview.previewToken,idempotencyKey:crypto.randomUUID(),expiresAt:preview.expiresAt});
   return result({operationId:op.id,preview:preview.result,planId:id,expiresAt:preview.expiresAt,commit:false,next:'核对预览后调用 siyue_execute，传入相同 planId'});
  }
  if(name.startsWith('siyue_admin_')){
   if(!me.user.roleIds.includes('superadmin'))throw auth.failure('FORBIDDEN','仅超级管理员可以管理账号与权限');
   const service=require('../cli/admin-service.cjs'),action=name.slice('siyue_admin_'.length);if(!service.operations.some(op=>op.action===action))throw auth.failure('INVALID_ARGUMENT','账号操作不存在');
   const credentials=['create','resetPassword'].includes(action),{requestId,...body}=input;
   const credentialFile=credentials?privateFile('credentials',requestId):undefined;
   if(!credentials&&requestId!==undefined)throw auth.failure('INVALID_ARGUMENT','此操作不接受 requestId');
   return result(await service.execute(action,credentials?body:input,{request:client.request,credentialFile}));
  }
  throw auth.failure('UNKNOWN_TOOL','工具不存在，请重新读取工具列表');
 }
 return {tools,call};
}
module.exports={createBridge,opName,errorResult};
