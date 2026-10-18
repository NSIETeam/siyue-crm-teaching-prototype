'use strict';
const catalog=require('../contracts/operations.json');
const extra=[['student.communicate','记录学生沟通'],['audit.read','检索平台操作日志'],['sales.activity.read','查看本人销售活动'],['teacher.metrics.read','查看本人教师绩效指标'],['session.reschedule.request','申请本人课次调课'],['dashboard.read','查看工作台'],['lead.read','查看线索'],['lead.conversion.read','查看本人转化率'],['student.read','查看学生档案'],['student.update','编辑学生档案'],['teacher.read','查看教师档案'],['staff.read','查看职工档案'],['course.read','查看课程'],['class.read','查看班级'],['schedule.read','查看课表'],['order.read','查看订单与欠费'],['refund.read','查看退款'],['consumption.read','查看课消'],['report.read','查看经营报表'],['settings.read','查看系统设置'],['settings.update','修改系统设置'],['store.read','查看课程商城'],['store.design','商城装修']];
const permissions=[...new Map([...catalog.operations.map(x=>[x.permission,x.label]),...extra].map(([id,label])=>[id,{id,label}])).values()];
const reserved=new Set(['employee.create','account.update','role.grant']);
const isReadOnlyPermission=id=>id.endsWith('.read')||id==='audit.query';
const common=['dashboard.read','schedule.read','lead.create'];
const roles=[
 {id:'superadmin',label:'超级管理员',description:'统一管理账号、角色和授权范围；查看全部审计。',defaultScope:'all',permissions:permissions.map(x=>x.id)},
 {id:'principal',label:'校长',description:'负责授权校区的线索分配、教务、经营统计；不管理账号权限。',defaultScope:'campus',permissions:[...common,'lead.read','lead.assign','lead.transfer','lead.release','lead.follow','lead.conversion.read','student.read','student.communicate','student.update','student.create','teacher.read','staff.read','course.read','class.read','class.create','class.batchCreate','enrollment.create','enrollment.batchCreate','enrollment.transfer','enrollment.batchTransfer','session.move','session.substitute','order.read','refund.read','consumption.read','report.read']},
 {id:'academic',label:'教务',description:'负责授权校区的课程、班级、排课、报名与考勤；不确认财务到账。',defaultScope:'campus',permissions:[...common,'student.read','student.communicate','student.update','student.create','teacher.read','course.read','course.create','course.update','class.read','class.create','class.batchCreate','class.relocate','enrollment.create','enrollment.batchCreate','enrollment.transfer','enrollment.batchTransfer','session.move','session.substitute','session.attendance','session.record','enrollment.withdraw','consumption.read','order.read','order.paymentLink']},
 {id:'sales',label:'销售',description:'收集并跟进本人线索、查看销售业绩与本人活动，办理报名并出示收款入口；不确认到账。',defaultScope:'own',permissions:[...common,'lead.read','lead.transfer','lead.release','lead.follow','lead.conversion.read','sales.activity.read','student.read','course.read','class.read','enrollment.create','enrollment.batchCreate','order.read','order.paymentLink','store.read']},
 {id:'finance',label:'财务',description:'查看授权范围订单、课消与退款，核对收款和处理退款；不修改课程或线索。',defaultScope:'campus',permissions:[...common,'student.read','order.read','order.paymentLink','order.confirmReceipt','refund.read','refund.approve','refund.submit','consumption.read','report.read']},
 {id:'teacher',label:'教师',description:'仅查看本人授课和分配的学生，登记本人课次考勤与教学情况；可收集线索并管理本人表单。',defaultScope:'assigned',permissions:[...common,'student.read','student.communicate','course.read','class.read','session.reschedule.request','teacher.metrics.read','session.attendance','session.record','consumption.read']},
 {id:'operations',label:'运营',description:'登记活动线索、配置营销与商城内容；不分配账号或确认财务到账。',defaultScope:'campus',permissions:[...common,'lead.read','course.read','promotion.create','promotion.publish','product.publish','store.read','store.design']},
 {id:'auditor',label:'只读审计员',description:'查看经授权的报表与业务资料；全部平台操作日志仅超级管理员可检索。',defaultScope:'campus',permissions:[...common.filter(isReadOnlyPermission),'lead.read','student.read','teacher.read','staff.read','course.read','class.read','order.read','refund.read','consumption.read','report.read']}
].map(role=>({...role,allowedScopes:['all','campus','own','assigned']}));
const permissionIds=new Set(permissions.map(x=>x.id));
function fail(message){const e=new Error(message);e.status=400;e.code='INVALID_ACCOUNT';throw e;}
function stringList(value,label,allowed,max=100){if(!Array.isArray(value)||value.length>max||value.some(x=>typeof x!=='string'||!allowed.has(x))||new Set(value).size!==value.length)fail(label+'包含无效或重复值');return [...value];}
function normalizePolicy(input,current={}){
 const roleIds=stringList(input.roleIds??current.roleIds??[], '角色',new Set(roles.map(x=>x.id)),8);if(!roleIds.length)fail('至少选择一个角色');
 const additionalPermissions=stringList(input.additionalPermissions??current.additionalPermissions??[],'额外权限',permissionIds);
 const deniedPermissions=stringList(input.deniedPermissions??current.deniedPermissions??[],'禁止权限',permissionIds);
 if(roleIds.every(id=>id==='auditor')&&additionalPermissions.some(id=>!isReadOnlyPermission(id)))fail('只读审计员不能授予业务写权限');
 if(additionalPermissions.some(x=>reserved.has(x)))fail('账号管理与角色授权只能由超级管理员身份获得');
 if(roleIds.includes('superadmin')&&deniedPermissions.length)fail('超级管理员角色不能设置局部禁止权限，请更换角色');
 const defaultScope=roles.find(x=>x.id===roleIds[0]).defaultScope;
 const raw=input.scope??current.scope??{type:defaultScope, campusIds:[]};
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||!['all','campus','own','assigned'].includes(raw.type)||Object.keys(raw).some(x=>!['type','campusIds'].includes(x)))fail('数据范围无效');
 const campusIds=raw.campusIds??[];
 if(!Array.isArray(campusIds)||campusIds.length>100||campusIds.some(x=>typeof x!=='string'||!x.trim()||x.length>80)||new Set(campusIds).size!==campusIds.length)fail('校区范围无效');
 if(raw.type==='campus'&&!campusIds.length)fail('校区范围必须选择至少一个校区');
 if(raw.type!=='campus'&&campusIds.length)fail('仅校区范围可指定校区');
 const scope=roleIds.includes('superadmin')?{type:'all',campusIds:[]}:{type:raw.type,campusIds:[...campusIds]};
 return {roleIds,additionalPermissions,deniedPermissions,scope};
}
function defaultRolePolicies(){return Object.fromEntries(roles.filter(role=>role.id!=='superadmin').map(role=>[role.id,{permissions:[...role.permissions].sort(),version:1}]));}
function effectivePermissions(user,rolePolicies={}){const set=new Set(user.roleIds.flatMap(id=>{const role=roles.find(x=>x.id===id);if(!role)return [];if(id==='superadmin')return role.permissions;const policy=rolePolicies?.[id];const granted=Array.isArray(policy?.permissions)?policy.permissions:role.permissions;return id==='auditor'?granted.filter(isReadOnlyPermission):granted;}));for(const p of user.additionalPermissions||[])if(!reserved.has(p)&&(!user.roleIds.every(id=>id==='auditor')||isReadOnlyPermission(p)))set.add(p);for(const p of user.deniedPermissions||[])set.delete(p);return [...set].sort();}
function publicUser(user,rolePolicies={}){const {id,username,name,employeeNo,roleIds,additionalPermissions,deniedPermissions,scope,mustChangePassword,disabled,version,createdAt,updatedAt}=user;return {id,username,name,employeeNo,roleIds,additionalPermissions,deniedPermissions,scope,mustChangePassword,disabled,version,createdAt,updatedAt,archivedAt:user.archivedAt||null,archivedBy:user.archivedBy||null,archiveReason:user.archiveReason||null,permissions:effectivePermissions(user,rolePolicies)};}
function publicRoles(rolePolicies={}){return roles.map(role=>{const policy=rolePolicies?.[role.id];return {...role,readOnly:role.id==='auditor',allowedPermissions:role.id==='auditor'?permissions.filter(p=>isReadOnlyPermission(p.id)).map(p=>p.id):undefined,permissions:role.id==='superadmin'?[...role.permissions]:Array.isArray(policy?.permissions)?[...policy.permissions]:[...role.permissions],version:role.id==='superadmin'?1:Number.isInteger(policy?.version)&&policy.version>0?policy.version:1,editable:role.id!=='superadmin',reservedPermissions:[...reserved].sort()};});}
function normalizeRolePermissions(value,roleId){if(roleId==='auditor'&&Array.isArray(value)&&value.some(id=>typeof id==='string'&&!isReadOnlyPermission(id)))fail('只读审计员角色不能包含业务写权限');if(!Array.isArray(value)||value.length>permissions.length||value.some(x=>typeof x!=='string'||!permissionIds.has(x))||new Set(value).size!==value.length||value.some(x=>reserved.has(x)))fail('角色权限包含无效、重复或保留权限');return [...value].sort();}
function validateRolePolicies(value){if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('角色权限存储格式无效');const known=new Set(roles.filter(x=>x.id!=='superadmin').map(x=>x.id));for(const [id,policy]of Object.entries(value)){if(!known.has(id)||!policy||typeof policy!=='object'||Array.isArray(policy)||!Number.isInteger(policy.version)||policy.version<1)throw new Error('角色权限存储格式无效');try{normalizeRolePermissions(policy.permissions);}catch{throw new Error('角色权限存储格式无效');}}}
module.exports={isReadOnlyPermission,permissions,roles,reserved,normalizePolicy,effectivePermissions,publicUser,publicRoles,defaultRolePolicies,normalizeRolePermissions,validateRolePolicies};
