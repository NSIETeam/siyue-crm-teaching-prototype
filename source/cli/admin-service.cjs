'use strict';
const fs=require('node:fs');
const path=require('node:path');
const auth=require('./auth-client.cjs');
const string=(maxLength=80)=>({type:'string',minLength:1,maxLength});
const id={...string(100),pattern:'^[a-z0-9-]+$'};
const permissionList={type:'array',items:string(100),maxItems:100,uniqueItems:true};
const policy={
 roleIds:{type:'array',items:string(80),minItems:1,maxItems:8,uniqueItems:true},
 scope:{type:'object',properties:{type:{enum:['all','campus','own','assigned']},campusIds:{type:'array',items:string(80),maxItems:100,uniqueItems:true}},required:['type'],additionalProperties:false},
 additionalPermissions:permissionList,deniedPermissions:permissionList
};
const object=(properties,required,minProperties)=>({type:'object',properties,required,additionalProperties:false,...(minProperties?{minProperties}:{})});
const schemas={
 create:object({name:string(),username:{...string(48),pattern:'^[A-Za-z0-9][A-Za-z0-9_-]{2,47}$'},employeeNo:{type:'string',maxLength:40},...policy},['name','roleIds']),
 update:object({id,name:string(),...policy,disabled:{type:'boolean'}},['id'],2),
 resetPassword:object({id},['id']),
 archive:object({id,reason:{type:'string',maxLength:200}},['id']),
 updateRole:object({id,permissions:permissionList,expectedVersion:{type:'integer',minimum:1}},['id','permissions','expectedVersion'])
};
const operations=Object.entries({create:'创建员工账号',update:'修改员工账号与权限',resetPassword:'重置员工密码',archive:'离职注销并归档',updateRole:'修改角色权限'}).map(([action,title])=>({action,title,inputSchema:schemas[action],credentialFileRequired:['create','resetPassword'].includes(action)}));
function invalid(message){throw auth.failure('INVALID_ARGUMENT',message);}
function validate(value,schema,label='input'){
 if(schema.enum&&!schema.enum.includes(value))invalid(label+' 的取值无效');
 if(schema.type==='object'){
  if(!value||typeof value!=='object'||Array.isArray(value))invalid(label+' 必须是 JSON 对象');
  const keys=Object.keys(value);if(keys.some(key=>!Object.hasOwn(schema.properties,key)))invalid(label+' 包含未支持的字段');
  if(schema.required.some(key=>!Object.hasOwn(value,key))||schema.minProperties&&keys.length<schema.minProperties)invalid(label+' 缺少必要字段');
  keys.forEach(key=>validate(value[key],schema.properties[key],label+'.'+key));
 }else if(schema.type==='array'){
  if(!Array.isArray(value)||schema.minItems&&value.length<schema.minItems||schema.maxItems&&value.length>schema.maxItems||schema.uniqueItems&&new Set(value.map(v=>JSON.stringify(v))).size!==value.length)invalid(label+' 列表无效');
  value.forEach((item,index)=>validate(item,schema.items,label+'['+index+']'));
 }else if(schema.type==='string'){
  if(typeof value!=='string'||schema.minLength&&value.trim().length<schema.minLength||value.length>schema.maxLength||/[\u0000-\u001f\u007f]/.test(value)||schema.pattern&&!new RegExp(schema.pattern).test(value))invalid(label+' 文本无效');
 }else if(schema.type==='boolean'&&typeof value!=='boolean')invalid(label+' 必须是布尔值');
 else if(schema.type==='integer'&&(!Number.isInteger(value)||value<schema.minimum))invalid(label+' 必须是有效整数');
}
function summary(user){
 if(!user||typeof user!=='object'||typeof user.id!=='string')throw auth.failure('INVALID_RESPONSE','服务器未返回有效账号；请核对账号列表后再操作');
 const allowed=['id','name','username','employeeNo','roleIds','additionalPermissions','deniedPermissions','permissions','mustChangePassword','disabled','version','createdAt','updatedAt','archivedAt','archivedBy','archiveReason'];
 return {...Object.fromEntries(allowed.filter(key=>Object.hasOwn(user,key)).map(key=>[key,user[key]])),...(user.scope?{scope:{type:user.scope.type,campusIds:user.scope.campusIds||[]}}:{})};
}
function roleSummary(role){
 if(!role||typeof role.id!=='string')throw auth.failure('INVALID_RESPONSE','服务器未返回有效角色；请重新查看角色配置');
 return Object.fromEntries(['id','label','description','permissions','version','editable','defaultScope','allowedScopes','reservedPermissions'].filter(key=>Object.hasOwn(role,key)).map(key=>[key,role[key]]));
}
function safeOutputPath(value){
 if(typeof value!=='string'||!value.trim())throw auth.failure('CREDENTIAL_FILE_REQUIRED','创建账号或重置密码需要指定新的私有凭据文件');
 const target=path.resolve(value),base=path.basename(target);
 if(!base||base==='.'||base==='..')throw auth.failure('INVALID_OUTPUT','凭据文件路径无效');
 return path.join(auth.configDirectory({SIYUE_CONFIG_DIR:path.dirname(target)}),base);
}
function reserve(file){
 let fd;try{
  fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  const stat=fs.fstatSync(fd);
  if(!stat.isFile()||(stat.mode&0o077)!==0||process.getuid&&stat.uid!==process.getuid())throw auth.failure('UNSAFE_OUTPUT','凭据文件必须为当前用户私有文件');
  return fd;
 }catch(error){if(fd!==undefined)fs.closeSync(fd);if(error.code==='EEXIST')throw auth.failure('OUTPUT_EXISTS','凭据文件已经存在；不会覆盖或重新签发密码，请核对已有文件');throw error;}
}
async function deliver(action,input,request,credentialFile){
 const file=safeOutputPath(credentialFile),fd=reserve(file);
 let received=false;
 try{
  const response=await request(action==='create'?'v1/admin/users':'v1/admin/users/'+input.id+'/reset-password',{method:'POST',body:action==='create'?input:{}});
  received=true;
  if(!response||typeof response.initialPassword!=='string'||!response.initialPassword)throw auth.failure('INVALID_RESPONSE','服务器未返回一次性凭据；请核对账号，不要直接重复提交');
  const user=summary(response.user);
  try{fs.writeFileSync(fd,JSON.stringify({user,initialPassword:response.initialPassword},null,2)+'\n');fs.fsyncSync(fd);}
  catch{try{fs.ftruncateSync(fd,0);fs.fsyncSync(fd);}catch{}throw auth.failure('CREDENTIAL_SAVE_FAILED','账号操作已完成，但密码文件写入失败；已保留私有标记，请核对账号，不要重复提交');}
  return {user,credentialFile:file,...(action==='create'?{created:true,reused:false}:{reset:true})};
 }catch(error){
  // Only an explicit client-error response proves the server rejected the request.
  // Transport loss, 5xx and invalid responses keep the reservation to prevent blind retries.
  if(!received&&Number.isInteger(error.status)&&error.status>=400&&error.status<500){try{fs.unlinkSync(file);}catch{}}
  throw error;
 }finally{fs.closeSync(fd);}
}
async function execute(action,input,{request,credentialFile}={}){
 if(!Object.hasOwn(schemas,action))invalid('不支持的账号操作');
 validate(input,schemas[action]);
 if(typeof request!=='function')invalid('缺少已鉴权的请求方法');
 if(['create','resetPassword'].includes(action))return deliver(action,input,request,credentialFile);
 const {id:targetId,...body}=input;
 const endpoint=action==='updateRole'?'v1/admin/roles/'+targetId:'v1/admin/users/'+targetId+(action==='archive'?'/archive':'');
 const response=await request(endpoint,{method:action==='archive'?'POST':'PATCH',body});
 if(action==='updateRole')return {role:roleSummary(response.role),changed:!!response.changed,affectedUsers:response.affectedUsers};
 return {user:summary(response.user),...(action==='archive'?{archived:!!response.archived}:{updated:true})};
}
module.exports={execute,schemas,operations,summary,roleSummary,safeOutputPath};
