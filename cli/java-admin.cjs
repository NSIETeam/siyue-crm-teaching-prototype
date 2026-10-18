'use strict';
const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const text=(title,maxLength,pattern)=>({type:'string',title,minLength:1,maxLength,...(pattern?{pattern}:{})});
const permissionCodes={type:'array',title:'权限编号',items:text('权限编号',100),maxItems:100,uniqueItems:true};
const campusIds={type:'array',title:'校区编号',items:text('校区编号',120),maxItems:100,uniqueItems:true};
const scope={type:'string',title:'数据范围',enum:['all','campus','assigned','own']};
const createInput=object({principalId:text('外部身份编号',120,'^[A-Za-z0-9_-]+$'),issuer:text('OIDC 身份提供方 HTTPS 地址',1024),subject:text('OIDC subject',512),scope,permissionCodes,campusIds},['principalId','issuer','subject','scope','permissionCodes','campusIds']);
const updateInput=object({expectedVersion:{type:'integer',minimum:1,title:'当前授权版本'},scope,active:{type:'boolean',title:'账号启用状态'},permissionCodes,campusIds},['expectedVersion','scope','active','permissionCodes','campusIds']);
const adminInterfaces=[
 {id:'java.access.principals.list',version:'v2',method:'GET',path:'/v2/system/access/principals',label:'Java 员工授权目录',description:'按页读取员工授权摘要；不返回 OIDC issuer 或 subject。页码 1–100000，页大小 1–100。',authorization:'system.access.manage and global scope',inputSchema:object({page:{type:'integer',minimum:1,maximum:100000,title:'页码'},size:{type:'integer',minimum:1,maximum:100,title:'每页条数'}}),response:{data:'PrincipalView[]'},audit:'不写审计事件',cli:'access-admin list [--page 1] [--size 50]',readOnly:true},
 {id:'java.access.principals.create',version:'v2',method:'POST',path:'/v2/system/access/principals',label:'Java 创建员工授权映射',description:'为已经由 OIDC 身份提供方验证的 issuer+subject 建立员工授权；不会创建身份提供方账号或自动授予管理员权限。要求 Idempotency-Key。',authorization:'system.access.manage and global scope',inputSchema:createInput,response:{data:'PrincipalView'},audit:'system.access.create',cli:'access-admin create --input <JSON> --key <幂等键>',idempotency:'同一操作者、幂等键和输入安全重放'},
 {id:'java.access.principals.update',version:'v2',method:'PUT',path:'/v2/system/access/principals/{principalId}',label:'Java 修改员工授权',description:'以 expectedVersion 更新现有员工的数据范围、启用状态、权限和校区；不能通过此接口修改管理员自身授权。要求 Idempotency-Key。',authorization:'system.access.manage and global scope',pathParameters:{principalId:text('员工授权编号',120,'^[A-Za-z0-9_-]+$')},inputSchema:updateInput,response:{data:'PrincipalView'},audit:'system.access.update',cli:'access-admin update <编号> --input <JSON> --key <幂等键>',idempotency:'同一操作者、幂等键和输入安全重放'}
];
function validate(input,schema,label='input'){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error(label+' 必须是 JSON 对象');
 if(Object.keys(input).some(k=>!Object.hasOwn(schema.properties,k))||schema.required.some(k=>!Object.hasOwn(input,k)))throw Error(label+' 字段不符合注册契约');
 for(const [k,v] of Object.entries(input)){const s=schema.properties[k];if(s.type==='string'&&(typeof v!=='string'||v.length<(s.minLength||0)||v.length>s.maxLength||s.pattern&&!new RegExp(s.pattern).test(v)))throw Error(label+'.'+k+' 无效');if(s.type==='integer'&&(!Number.isSafeInteger(v)||v<s.minimum||v>s.maximum))throw Error(label+'.'+k+' 无效');if(s.type==='boolean'&&typeof v!=='boolean')throw Error(label+'.'+k+' 无效');if(s.enum&&!s.enum.includes(v))throw Error(label+'.'+k+' 无效');if(s.type==='array'&&(!Array.isArray(v)||v.length>s.maxItems||new Set(v).size!==v.length||v.some(x=>typeof x!=='string'||!x.trim()||x.length>s.items.maxLength)))throw Error(label+'.'+k+' 无效');}
 return input;
}
async function run(args,client,identity,{read,unwrap}){
 const fail=message=>{throw Object.assign(new Error(message),{code:'INVALID_ARGUMENT'})};
 if(!identity?.permissions?.includes('system.access.manage')||identity.scope!=='all')throw Object.assign(new Error('仅具有全局 system.access.manage 权限的 Java 管理员可管理员工授权'),{code:'FORBIDDEN'});
 const [action,...rest]=args;
 if(action==='list'){
  const options={page:1,size:50};for(let i=0;i<rest.length;i+=2){const key=rest[i],value=rest[i+1];if(!value||!['--page','--size'].includes(key)||!/^\d+$/.test(value))fail('用法：access-admin list [--page 1] [--size 50]');options[key.slice(2)]=Number(value);}
  if(options.page<1||options.page>100000||options.size<1||options.size>100)fail('分页范围：page 1–100000，size 1–100');return unwrap(await client.request('system/access/principals?'+new URLSearchParams(options)));
 }
 if(action==='create'||action==='update'){
  const update=action==='update',id=update?rest.shift():null;let file,key;
  for(let i=0;i<rest.length;i+=2){if(rest[i]==='--input'&&!file)file=rest[i+1];else if(rest[i]==='--key'&&!key)key=rest[i+1];else fail('用法：access-admin '+(update?'update <编号>':'create')+' --input <JSON> --key <幂等键>');}
  if(update&&(!id||!/^[A-Za-z0-9_-]{1,120}$/.test(id))||!file||!key||!/^[A-Za-z0-9_-]{16,100}$/.test(key))fail('需要有效编号、--input JSON 文件和 16–100 字符 --key 幂等键');
  const input=read(file),body=validate(input,update?updateInput:createInput,action);
  const path=update?'system/access/principals/'+encodeURIComponent(id):'system/access/principals';
  return unwrap(await client.request(path,{method:update?'PUT':'POST',body,idempotencyKey:key}));
 }
 fail('用法：access-admin list [--page 1] [--size 50] | create --input <JSON> --key <幂等键> | update <编号> --input <JSON> --key <幂等键>');
}
module.exports={adminInterfaces,createInput,updateInput,validate,run};
