'use strict';
const fs=require('node:fs'),auth=require('./auth-client.cjs'),service=require('./admin-service.cjs');
const permittedRoles={teacher:{scope:{type:'assigned',campusIds:[]}},sales:{scope:{type:'own',campusIds:[]}}};
function args(values,allowed){const out={};for(let i=0;i<values.length;i++){const key=values[i]?.slice(2),value=values[i+1];if(!values[i]?.startsWith('--')||!allowed.includes(key)||!value||value.startsWith('--')||Object.hasOwn(out,key))throw auth.failure('INVALID_ARGUMENT','账号命令参数无效');out[key]=value;i++;}return out;}
async function admin(){const me=await auth.authenticated('v1/auth/me');if(me.user?.mustChangePassword)throw auth.failure('PASSWORD_CHANGE_REQUIRED','请先运行 siyue-cli passwd 修改初始密码');if(!me.user?.roleIds?.includes('superadmin'))throw auth.failure('FORBIDDEN','仅超级管理员可以使用此账号命令');return me.user;}
function readInput(file){
 const limit=16384;let fd,owned=false;
 try{
  if(file==='-')fd=0;
  else{
   fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);owned=true;
   const stat=fs.fstatSync(fd);
   if(!stat.isFile()||stat.size>limit)throw new Error();
  }
  // Bound the actual read too: a file can grow after fstat, and stdin can be unbounded.
  const chunks=[];let size=0;
  while(size<=limit){
   const chunk=Buffer.alloc(Math.min(4096,limit+1-size));
   const count=fs.readSync(fd,chunk,0,chunk.length,null);
   if(!count)break;
   size+=count;if(size>limit)throw new Error();chunks.push(chunk.subarray(0,count));
  }
  const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size)));
  if(!data||typeof data!=='object'||Array.isArray(data))throw new Error();
  return data;
 }catch{throw auth.failure('INVALID_INPUT','--input 需要有效的 JSON 普通文件（最多 16 KiB，不接受符号链接），或使用 - 从标准输入读取');}
 finally{if(owned)fs.closeSync(fd);}
}

async function legacyCreate(input){
 if(Object.keys(input).length!==5||!input.name?.trim()||!input.username?.trim()||!input['employee-no']?.trim()||!input.out?.trim()||!Object.hasOwn(permittedRoles,input.role))throw auth.failure('INVALID_ARGUMENT','创建账号须指定 --input JSON --out 私有凭据文件；兼容参数为 --name、--username、--employee-no、--role teacher|sales 和 --out');
 const name=input.name.trim(),username=input.username.trim().toLowerCase(),employeeNo=input['employee-no'].trim(),scope=permittedRoles[input.role].scope;
 if(name.length>80||employeeNo.length>40||!/^[a-z0-9][a-z0-9_-]{2,47}$/.test(username))throw auth.failure('INVALID_ARGUMENT','姓名、账号或工号格式无效');
 const file=service.safeOutputPath(input.out),directory=await auth.authenticated('v1/admin/users'),users=directory.users||[];
 const nameMatches=users.filter(u=>u.name===name),employeeMatches=users.filter(u=>u.employeeNo===employeeNo),usernameMatches=users.filter(u=>u.username===username);
 if(nameMatches.length||employeeMatches.length||usernameMatches.length){
  const match=nameMatches[0],exact=nameMatches.length===1&&employeeMatches.length===1&&usernameMatches.length===1&&match.id===employeeMatches[0].id&&match.id===usernameMatches[0].id&&match.username===username&&match.roleIds?.length===1&&match.roleIds[0]===input.role&&JSON.stringify(match.scope)===JSON.stringify(scope)&&!(match.additionalPermissions||[]).length&&!(match.deniedPermissions||[]).length&&!match.disabled;
  if(exact){
   if(fs.existsSync(file)){const st=fs.lstatSync(file);if(st.isSymbolicLink()||!st.isFile()||(st.mode&0o077)!==0||process.getuid&&st.uid!==process.getuid())throw auth.failure('UNSAFE_OUTPUT','凭据文件必须为当前用户私有普通文件');let saved;try{saved=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw auth.failure('CREDENTIAL_DELIVERY_UNCERTAIN','账号已存在且凭据文件为空或无效；请核对账号与凭据，不要再次创建');}if(saved.user?.id!==match.id||typeof saved.initialPassword!=='string'||!saved.initialPassword)throw auth.failure('CREDENTIAL_DELIVERY_UNCERTAIN','凭据文件与已有账号不匹配；请核对账号与凭据，不要再次创建');}
   return {created:false,reused:true,user:service.summary(match),credentialFile:fs.existsSync(file)?file:null};
  }
  throw auth.failure('ACCOUNT_CONFLICT','姓名或工号已存在但与请求的角色/范围不完全一致；未修改任何账号');
 }
 return service.execute('create',{name,username,employeeNo,roleIds:[input.role],scope},{request:auth.authenticated,credentialFile:file});
}
async function run(command,values=[]){
 await admin();
 if(command==='list'){
  if(values.length)throw auth.failure('INVALID_ARGUMENT','用法：siyue-cli accounts list');
  const result=await auth.authenticated('v1/admin/users');return {users:(result.users||[]).map(service.summary)};
 }
 if(command==='create'){
  const input=args(values,['name','username','employee-no','role','input','out']);
  if(!input.input)return legacyCreate(input);
  if(Object.keys(input).some(key=>!['input','out'].includes(key))||!input.out)throw auth.failure('INVALID_ARGUMENT','用法：siyue-cli accounts create --input <JSON文件或 -> --out <新私有凭据文件>');
  return service.execute('create',readInput(input.input),{request:auth.authenticated,credentialFile:input.out});
 }
 if(!['update','disable','enable','reset-password','archive'].includes(command))throw auth.failure('INVALID_ARGUMENT','账号命令：list/create/update/disable/enable/reset-password/archive');
 const input=args(values,command==='update'?['id','input']:command==='reset-password'?['id','input','out']:command==='archive'?['id','input','reason']:['id','input']);
 const body=input.input?readInput(input.input):{};
 if(input.id){if(body.id&&body.id!==input.id)throw auth.failure('INVALID_ARGUMENT','--id 与 JSON 中的 id 不一致');body.id=input.id;}
 if(command==='update'&&!input.input)throw auth.failure('INVALID_ARGUMENT','修改账号需要 --input JSON文件');
 if(command==='archive'&&input.reason){if(body.reason!==undefined&&body.reason!==input.reason)throw auth.failure('INVALID_ARGUMENT','--reason 与 JSON 中的 reason 不一致');body.reason=input.reason;}
 if(['disable','enable'].includes(command)){if(Object.keys(body).some(key=>key!=='id'))throw auth.failure('INVALID_ARGUMENT','停用/启用账号只接受 id；调整权限请使用 update');body.disabled=command==='disable';}
 const action={'reset-password':'resetPassword',disable:'update',enable:'update'}[command]||command;
 return service.execute(action,body,{request:auth.authenticated,credentialFile:input.out});
}
module.exports={run,readInput};
