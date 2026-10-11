'use strict';
const fs=require('node:fs'),path=require('node:path'),auth=require('./auth-client.cjs');
const permittedRoles={teacher:{scope:{type:'assigned',campusIds:[]}},sales:{scope:{type:'own',campusIds:[]}}};
function args(values,allowed){const out={};for(let i=0;i<values.length;i++){const key=values[i]?.slice(2),value=values[i+1];if(!values[i]?.startsWith('--')||!allowed.includes(key)||!value||value.startsWith('--')||Object.hasOwn(out,key))throw auth.failure('INVALID_ARGUMENT','账号命令参数无效');out[key]=value;i++;}return out;}
async function admin(){const me=await auth.authenticated('v1/auth/me');if(me.user?.mustChangePassword)throw auth.failure('PASSWORD_CHANGE_REQUIRED','请先运行 siyue-cli passwd 修改初始密码');if(!me.user?.roleIds?.includes('superadmin'))throw auth.failure('FORBIDDEN','仅超级管理员可以使用此账号命令');return me.user;}
function summary(user){return {id:user.id,name:user.name,username:user.username,employeeNo:user.employeeNo||'',roleIds:user.roleIds,additionalPermissions:user.additionalPermissions||[],deniedPermissions:user.deniedPermissions||[],scope:user.scope,mustChangePassword:!!user.mustChangePassword,disabled:!!user.disabled};}
function safeOutputPath(value){const target=path.resolve(value),base=path.basename(target);if(!base||base==='.'||base==='..')throw auth.failure('INVALID_OUTPUT','凭据文件路径无效');const directory=auth.configDirectory({SIYUE_CONFIG_DIR:path.dirname(target)});return path.join(directory,base);}
function reserve(file){let fd;try{fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);const stat=fs.fstatSync(fd);if(!stat.isFile()||(stat.mode&0o077)!==0)throw auth.failure('UNSAFE_OUTPUT','凭据文件必须为当前用户私有文件');return fd;}catch(error){if(fd!==undefined)fs.closeSync(fd);throw error;}}
 async function run(command,values=[]){
 const actor=await admin();
 if(command==='list'){
 if(values.length)throw auth.failure('INVALID_ARGUMENT','用法：siyue-cli accounts list');
  const result=await auth.authenticated('v1/admin/users');
  return {users:(result.users||[]).map(summary)};
 }
 if(command!=='create')throw auth.failure('INVALID_ARGUMENT','用法：siyue-cli accounts list 或 accounts create --name <姓名> --username <账号> --employee-no <工号> --role teacher|sales --out <私有凭据文件>');
 const input=args(values,['name','username','employee-no','role','out']);
 if(Object.keys(input).length!==5||!input.name.trim()||!input.username.trim()||!input['employee-no'].trim()||!input.out.trim()||!Object.hasOwn(permittedRoles,input.role))throw auth.failure('INVALID_ARGUMENT','创建测试账号须指定 --name、--username、--employee-no、--role teacher|sales 和 --out');
 const name=input.name.trim(),username=input.username.trim().toLowerCase(),employeeNo=input['employee-no'].trim(),targetScope=permittedRoles[input.role].scope;
 if(name.length>80||employeeNo.length>40||!/^[a-z0-9][a-z0-9_-]{2,47}$/.test(username))throw auth.failure('INVALID_ARGUMENT','姓名、账号或工号格式无效');
 const file=safeOutputPath(input.out);
 const directory=await auth.authenticated('v1/admin/users'),users=directory.users||[];
 const nameMatches=users.filter(u=>u.name===name),employeeMatches=users.filter(u=>u.employeeNo===employeeNo),usernameMatches=users.filter(u=>u.username===username);
 if(nameMatches.length||employeeMatches.length||usernameMatches.length){
  const match=nameMatches[0],exact=nameMatches.length===1&&employeeMatches.length===1&&usernameMatches.length===1&&match.id===employeeMatches[0].id&&match.id===usernameMatches[0].id&&match.username===username&&match.roleIds?.length===1&&match.roleIds[0]===input.role&&JSON.stringify(match.scope)===JSON.stringify(targetScope)&&!(match.additionalPermissions||[]).length&&!(match.deniedPermissions||[]).length&&!match.disabled;
  if(exact){
   if(fs.existsSync(file)){const st=fs.lstatSync(file);if(st.isSymbolicLink()||!st.isFile()||(st.mode&0o077)!==0)throw auth.failure('UNSAFE_OUTPUT','凭据文件必须为当前用户私有普通文件');let saved;try{saved=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw auth.failure('CREDENTIAL_DELIVERY_UNCERTAIN','账号已存在且凭据文件为空或无效；请核对账号与凭据，不要再次创建');}if(saved.user?.id!==match.id||typeof saved.initialPassword!=='string'||!saved.initialPassword)throw auth.failure('CREDENTIAL_DELIVERY_UNCERTAIN','凭据文件与已有账号不匹配；请核对账号与凭据，不要再次创建');}
   return {created:false,reused:true,user:summary(match),credentialFile:fs.existsSync(file)?file:null};
  }
  throw auth.failure('ACCOUNT_CONFLICT','姓名或工号已存在但与请求的角色/范围不完全一致；未修改任何账号');
 }
 const fd=reserve(file);let remoteUncertain=false,remoteCreated=false;
 try{
  const created=await auth.authenticated('v1/admin/users',{method:'POST',body:{name,username,employeeNo,roleIds:[input.role],scope:targetScope}});
  remoteCreated=true;
  if(!created.user||typeof created.initialPassword!=='string'||!created.initialPassword)throw auth.failure('INVALID_RESPONSE','服务器未返回创建账号所需的凭据；请先核对账号列表，不要重试创建');
  const record={user:summary(created.user),initialPassword:created.initialPassword};
  try{fs.writeFileSync(fd,JSON.stringify(record,null,2)+'\n');fs.fsyncSync(fd);}catch{fs.ftruncateSync(fd,0);throw auth.failure('CREDENTIAL_SAVE_FAILED','账号已创建，但一次性密码未能安全写入预留文件；请立即停止并核对凭据文件');}
  return {created:true,reused:false,user:summary(created.user),credentialFile:file};
 }catch(error){remoteUncertain=remoteCreated||['CONNECTION_FAILED','INVALID_RESPONSE'].includes(error.code);if(!remoteUncertain){try{fs.unlinkSync(file);}catch{}}throw error;}finally{fs.closeSync(fd);if(remoteUncertain){/* Keep the empty 0600 reservation as a no-retry marker. */}}
}
module.exports={run};
