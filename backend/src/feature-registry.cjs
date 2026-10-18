'use strict';

const queryClient=require('../../cli/query-client.cjs');
const adminService=require('../../cli/admin-service.cjs');
const schema=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
const id={type:'string',minLength:1,maxLength:100,pattern:'^[a-z0-9-]+$'};
const text=(title,maxLength=120)=>({type:'string',title,minLength:1,maxLength});
const array=(items,maxItems=100)=>({type:'array',items,maxItems,uniqueItems:true});
const permissions=array(text('权限编号',100));
const roleIds=array(text('角色编号',80),8);
const scope={type:'object',properties:{type:{type:'string',enum:['all','campus','own','assigned']},campusIds:array(text('校区编号',80))},required:['type'],additionalProperties:false};
const accountFields={name:text('员工姓名'),roleIds,scope,disabled:{type:'boolean'},additionalPermissions:permissions,deniedPermissions:permissions};
const annotationProperties={
 page:text('CRM 页面路径',256),pageTitle:text('页面名称',120),elementKind:{type:'string',enum:['button','link','input','select','textarea','table-cell','table-row','table-header','tab','label','card','navigation','heading','other']},
 elementLabel:text('元素说明',200),selector:text('元素定位信息',500),issue:text('问题描述',4000),category:{type:'string',enum:['interface','workflow']},workflowName:text('业务流程名称',120),flowDefinition:text('当前流程定义',6000),desiredFlowDefinition:text('目标流程定义',6000)
};
const accountUpdateBody=structuredClone(adminService.schemas.update);delete accountUpdateBody.properties.id;accountUpdateBody.required=[];accountUpdateBody.minProperties=1;
const archiveBody=structuredClone(adminService.schemas.archive);delete archiveBody.properties.id;archiveBody.required=[];
const roleUpdateBody=structuredClone(adminService.schemas.updateRole);delete roleUpdateBody.properties.id;roleUpdateBody.required=['permissions','expectedVersion'];
const annotationCreateBody=schema(annotationProperties,['page','pageTitle','elementKind','elementLabel','selector','issue']);annotationCreateBody.allOf=[{if:{properties:{category:{const:'workflow'}},required:['category']},then:{required:['workflowName','flowDefinition','desiredFlowDefinition']}}];
const adminInterfaces=[
 {id:'admin.accounts.list',method:'GET',path:'/v1/admin/users',label:'员工账号目录',description:'返回员工账号、角色、范围、权限摘要及账号状态；不返回密码哈希或会话令牌。',authorization:'superadmin',inputSchema:schema(),response:{users:'EmployeeAccount[]'},audit:'account.list',cli:'accounts list',readOnly:true},
 {id:'admin.accounts.create',method:'POST',path:'/v1/admin/users',label:'创建员工账号',description:'创建员工并返回一次性初始密码；CLI 必须将凭据写入新建的私有文件，用户首次登录须改密。',authorization:'superadmin',inputSchema:adminService.schemas.create,response:{user:'EmployeeAccount',initialPassword:'string'},audit:'account.create',cli:'accounts create',sideEffects:['创建账号','写入认证审计'],idempotency:'接口无幂等键；超时或结果不明时先查账号，不得盲目重试'},
 {id:'admin.accounts.update',method:'PATCH',path:'/v1/admin/users/{userId}',label:'修改员工账号',description:'修改姓名、角色、范围、允许/禁止权限或启停用；立即撤销目标员工的现有会话。最后一名有效超级管理员不可降权或停用。',authorization:'superadmin',pathParameters:{userId:id},inputSchema:accountUpdateBody,response:{user:'EmployeeAccount'},audit:'account.update',cli:'accounts update|disable|enable',sideEffects:['更新账号策略','撤销目标员工全部会话']},
 {id:'admin.accounts.reset-password',method:'POST',path:'/v1/admin/users/{userId}/reset-password',label:'重置员工密码',description:'生成一次性初始密码并撤销该员工全部会话；归档账号不可重置。',authorization:'superadmin',pathParameters:{userId:id},inputSchema:schema(),response:{user:'EmployeeAccount',initialPassword:'string'},audit:'account.resetPassword',cli:'accounts reset-password',sideEffects:['替换密码哈希','要求首次登录改密','撤销目标员工全部会话'],idempotency:'接口无幂等键；仅在确认目标账号后执行'},
 {id:'admin.accounts.archive',method:'POST',path:'/v1/admin/users/{userId}/archive',label:'归档离职员工',description:'软归档：保留员工编号及历史业务关系、停用账号并撤销会话；不能归档当前登录员工或最后一名有效超级管理员。',authorization:'superadmin',pathParameters:{userId:id},inputSchema:archiveBody,response:{user:'EmployeeAccount',archived:'boolean'},audit:'account.archive',cli:'accounts archive',sideEffects:['停用账号','保留历史关联','撤销目标员工全部会话']},
 {id:'admin.roles.list',method:'GET',path:'/v1/roles',label:'角色与权限目录',description:'返回角色描述、权限、可配置范围、版本与保留权限。',authorization:'authenticated',inputSchema:schema(),response:{roles:'Role[]',permissions:'Permission[]',reservedPermissions:'string[]'},audit:'不写审计事件',cli:'roles list',readOnly:true},
 {id:'admin.roles.update',method:'PATCH',path:'/v1/admin/roles/{roleId}',label:'修改角色权限',description:'按 expectedVersion 乐观并发更新角色；超级管理员角色不可修改，保存后立即影响角色成员的继承权限。',authorization:'superadmin',pathParameters:{roleId:{type:'string',minLength:1,maxLength:80}},inputSchema:roleUpdateBody,response:{role:'Role',affectedUsers:'integer',changed:'boolean'},audit:'role.update',cli:'roles update',sideEffects:['更新角色权限','递增受影响员工版本']},
 {id:'admin.audit.list',method:'GET',path:'/v1/admin/audit',label:'管理员操作审计查询',description:'按操作者、动作、分组、结果、时间窗和游标分页检索认证与业务审计；结果按当前管理员范围授权过滤。',authorization:'superadmin 或 audit.read',inputSchema:queryClient.queries.find(x=>x.id==='admin-audit').inputSchema,response:{events:'AuditEvent[]',nextBefore:'string|null'},audit:'audit.query',cli:'get admin-audit',readOnly:true},
 {id:'admin.annotations.list',method:'GET',path:'/v1/admin/ui-annotations',label:'待修改建议清单',description:'按最近提交倒序返回最多 500 条界面或流程建议。',authorization:'superadmin',inputSchema:schema(),response:{annotations:'UIAnnotation[]'},audit:'不写审计事件',cli:'annotations list',readOnly:true},
 {id:'admin.annotations.create',method:'POST',path:'/v1/admin/ui-annotations',label:'提交界面或流程建议',description:'创建待处理建议。workflow 类必须提供当前与目标流程定义；建议内容不得包含学生或业务记录个人数据。浏览器写入要求同源 Origin 与 CSRF，CLI 使用 Bearer 会话。',authorization:'superadmin',inputSchema:annotationCreateBody,response:{annotation:'UIAnnotation'},audit:'ui.annotation.create',cli:'annotations create --input',sideEffects:['创建 open 状态建议','写入审计']},
 {id:'admin.annotations.resolve',method:'PATCH',path:'/v1/admin/ui-annotations/{annotationId}',label:'更新建议状态',description:'将建议状态更新为 open 或 resolved；应在对应代码变更完成并验证后设为 resolved。',authorization:'superadmin',pathParameters:{annotationId:{type:'string',format:'uuid'}},inputSchema:schema({status:{type:'string',enum:['open','resolved']}},['status']),response:{annotation:'UIAnnotation'},audit:'ui.annotation.update',cli:'annotations resolve <UUID> --verified | annotations reopen <UUID>',sideEffects:['更新建议状态','写入审计']},
 {id:'admin.feature-registry.read',method:'GET',path:'/v1/admin/feature-registry',label:'统一功能注册表',description:'返回服务器注册的管理员接口、业务操作、命名查询、CLI 命令、输入契约、权限和副作用说明；不包含业务记录。',authorization:'superadmin',inputSchema:schema(),response:{schemaVersion:'string',adminInterfaces:'AdminInterface[]',businessOperations:'BusinessOperation[]',queries:'Query[]',cliCommands:'CLICommand[]'},audit:'feature.registry.read',cli:'registry',readOnly:true}
];

const adminCliCommands=[
 {command:'login --username <账号>',purpose:'登录旧版认证与业务 API；密码隐藏输入。'},
 {command:'passwd',purpose:'修改当前登录密码并要求重新登录。'},
 {command:'whoami',purpose:'读取当前身份、范围和会话有效期。'},
 {command:'logout',purpose:'撤销旧版服务端会话并删除本地会话。'},
 {command:'registry [api|operations|queries|admin] [关键词]',purpose:'读取并搜索服务器统一功能注册表。'},
 {command:'list [关键词] / describe <操作编号>',purpose:'查看当前账号可执行业务操作及其输入契约。'},
 {command:'get <查询编号> --input <JSON>',purpose:'按服务器授权范围读取数据。'},
 {command:'plan <操作编号> --input <JSON> --out <私有计划>',purpose:'服务器预览业务写入，不提交变更。'},
 {command:'execute --plan <私有计划>',purpose:'提交原计划；复用原幂等键安全处理不确定结果。'},
 {command:'accounts list|create|update|disable|enable|reset-password|archive',purpose:'管理员工账号；一次性凭据只写入新的私有输出文件。'},
 {command:'roles list|update <角色编号>',purpose:'读取和更新可配置角色权限；更新要求 expectedVersion。'},
 {command:'annotations list|create|resolve <UUID> --verified|reopen <UUID>',purpose:'读取、提交或按完成情况更新超级管理员建议。只有完成修改并验证后才能 resolve。'},
 {command:'access-admin list|create|update',purpose:'使用 Java v2 全局 system.access.manage 权限管理员工 OIDC 授权；写入要求显式幂等键。'},
 {command:'query list / query <查询编号> --input <JSON>',purpose:'使用 Java v2 OIDC 会话执行已注册查询。'},
 {command:'plan task-batch|need-*|student-identifier-*|task-routing-*',purpose:'使用 Java v2 服务端预览支持的任务、商机与学号维护操作。'},
 {command:'mcp',purpose:'以本地 stdio MCP 暴露同一组受控查询和业务操作。'}
];

function backendOperations(){
 const names=['academic','crm','commerce','teacher-workflow','student-communication','scrm-core','scrm-service','scrm-import','scrm-views','trial-workflow'];
 const all=names.flatMap(name=>require('./business-'+name+'.cjs').operations);
 return require('./business-scrm-hooks.cjs').attachAcquisitionOperations(all);
}
function build({operations=backendOperations()}={}){
 const javaAdminInterfaces=require('../../cli/java-admin.cjs').adminInterfaces;
 const javaQueries=require('../../cli/java-query-client.cjs').queries().map(q=>{let endpoint=q.endpoint;if(q.pathTemplate)endpoint=q.pathTemplate.replace(/:([A-Za-z]+)/g,'{$1}');else{for(const key of q.pathParameters||[])endpoint+='/'+`{${key}}`;if(q.pathSuffix)endpoint+='/'+q.pathSuffix;}return {...q,id:'v2.'+q.id,path:'/v2/'+endpoint.replace(/^\//,''),authorization:q.permissions.length?q.permissions.join(' & '):'authenticated Java OIDC',cli:{command:`get ${q.id}`,apiVersion:'v2'}};});
 const businessOperations=operations.map(op=>({id:op.id,label:op.label,group:op.group,permission:op.permission,authorization:'server-enforced',status:'implemented',method:'POST',previewPath:`/v1/operations/${op.id}/preview`,executePath:`/v1/operations/${op.id}/execute`,inputSchema:op.inputSchema,preview:{required:true,commits:false,expiresInSeconds:600},execute:{requiresPreviewToken:true,requiresIdempotencyKey:true},sideEffects:'由操作处理器定义并在成功时写入业务审计',cli:{command:`plan ${op.id} --input <JSON> --out <计划>`,execute:'execute --plan <计划>'}}));
 const queries=[...queryClient.queries.map(q=>({...q,version:'v1',path:q.endpoint,authorization:'server-enforced and scope-filtered',cli:{command:`get ${q.id}`,alternates:[`query ${q.id}`],apiVersion:'v1'}})),...javaQueries];
 return {schemaVersion:'siyue-feature-registry/v1',audience:'superadmin',apiBasePath:'/crm-api',authorization:{identity:'当前真实服务端会话',adminGate:'superadmin role required for v1 account/role/annotation endpoints; Java v2 access APIs require system.access.manage and global scope',browserWrites:'same-origin Origin and X-CSRF-Token required',cli:'HTTPS Bearer session; no client-supplied role or scope'},versions:[{id:'v1',status:'active',basePath:'/v1'},{id:'v2',status:'java-adapter',basePath:'/v2',scope:'Java queries, access administration and mapped operations are listed; Java service remains the authorization source'}],adminInterfaces:[...adminInterfaces,...javaAdminInterfaces],businessOperations,queries,cliCommands:adminCliCommands,boundaries:[{id:'preview-before-write',description:'业务写入必须先由服务器预览，再使用同一预览和 Idempotency-Key 提交。'},{id:'scope',description:'读取和写入的记录范围由服务端按身份、权限和校区/本人范围校验。'},{id:'admin-credentials',description:'一次性密码只通过 CLI 私有文件交付；不要将口令、令牌、学员或业务记录写入命令参数或日志。'},{id:'unsupported',description:'注册表标记的未实现能力不能伪装成已实现；支付、短信、电话和未迁移 Java 写入仍按服务器能力明确拒绝。'}]};
}
module.exports={build,adminInterfaces,adminCliCommands,backendOperations};
