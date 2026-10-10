'use strict';
const catalog=require('../contracts/operations.json');
const extra=[['audit.read','检索平台操作日志'],['dashboard.read','查看工作台'],['lead.read','查看线索'],['lead.conversion.read','查看本人转化率'],['student.read','查看学生档案'],['teacher.read','查看教师档案'],['staff.read','查看职工档案'],['course.read','查看课程'],['class.read','查看班级'],['schedule.read','查看课表'],['order.read','查看订单与欠费'],['refund.read','查看退款'],['consumption.read','查看课消'],['report.read','查看经营报表'],['settings.read','查看系统设置'],['settings.update','修改系统设置'],['store.read','查看课程商城'],['store.design','商城装修']];
const permissions=[...catalog.operations.map(x=>({id:x.permission,label:x.label})),...extra.map(([id,label])=>({id,label}))];
const reserved=new Set(['employee.create','account.update','role.grant']);
const common=['dashboard.read','schedule.read'];
const roles=[
 {id:'superadmin',label:'超级管理员',description:'统一管理账号、角色和授权范围；查看全部审计。',defaultScope:'all',permissions:permissions.map(x=>x.id)},
 {id:'principal',label:'校长',description:'负责授权校区的线索分配、教务、经营统计；不管理账号权限。',defaultScope:'campus',permissions:[...common,'lead.read','lead.create','lead.assign','lead.transfer','lead.release','lead.follow','lead.conversion.read','student.read','student.create','teacher.read','staff.read','course.read','class.read','class.create','class.batchCreate','enrollment.create','enrollment.batchCreate','enrollment.transfer','enrollment.batchTransfer','session.move','session.substitute','order.read','refund.read','consumption.read','report.read']},
 {id:'academic',label:'教务',description:'负责授权校区的课程、班级、排课、报名与考勤；不确认财务到账。',defaultScope:'campus',permissions:[...common,'student.read','student.create','teacher.read','course.read','course.create','course.update','class.read','class.create','class.batchCreate','class.relocate','enrollment.create','enrollment.batchCreate','enrollment.transfer','enrollment.batchTransfer','session.move','session.substitute','session.attendance','session.record','enrollment.withdraw','consumption.read','order.read','order.paymentLink']},
 {id:'sales',label:'销售',description:'跟进本人线索、查看本人转化率、办理报名与出示收款入口；不确认到账。',defaultScope:'own',permissions:[...common,'lead.read','lead.create','lead.transfer','lead.release','lead.follow','lead.conversion.read','student.read','course.read','class.read','enrollment.create','enrollment.batchCreate','order.read','order.paymentLink','store.read']},
 {id:'finance',label:'财务',description:'查看授权范围订单、课消与退款，核对收款和处理退款；不修改课程或线索。',defaultScope:'campus',permissions:[...common,'student.read','order.read','order.paymentLink','order.confirmReceipt','refund.read','refund.approve','refund.submit','consumption.read','report.read']},
 {id:'teacher',label:'教师',description:'仅查看本人授课和分配的学生，登记本人课次考勤与教学情况。',defaultScope:'assigned',permissions:[...common,'student.read','course.read','class.read','session.attendance','session.record','consumption.read']},
 {id:'operations',label:'运营',description:'登记活动线索、配置营销与商城内容；不分配账号或确认财务到账。',defaultScope:'campus',permissions:[...common,'lead.create','lead.read','course.read','promotion.create','promotion.publish','product.publish','store.read','store.design']},
 {id:'auditor',label:'只读审计员',description:'查看经授权的报表与业务资料；全部平台操作日志仅超级管理员可检索。',defaultScope:'campus',permissions:[...common,'lead.read','student.read','teacher.read','staff.read','course.read','class.read','order.read','refund.read','consumption.read','report.read']}
].map(role=>({...role,allowedScopes:['all','campus','own','assigned']}));
const permissionIds=new Set(permissions.map(x=>x.id));
function fail(message){const e=new Error(message);e.status=400;e.code='INVALID_ACCOUNT';throw e;}
function stringList(value,label,allowed,max=100){if(!Array.isArray(value)||value.length>max||value.some(x=>typeof x!=='string'||!allowed.has(x))||new Set(value).size!==value.length)fail(label+'包含无效或重复值');return [...value];}
function normalizePolicy(input,current={}){
 const roleIds=stringList(input.roleIds??current.roleIds??[], '角色',new Set(roles.map(x=>x.id)),8);if(!roleIds.length)fail('至少选择一个角色');
 const additionalPermissions=stringList(input.additionalPermissions??current.additionalPermissions??[],'额外权限',permissionIds);
 const deniedPermissions=stringList(input.deniedPermissions??current.deniedPermissions??[],'禁止权限',permissionIds);
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
function effectivePermissions(user){const set=new Set(user.roleIds.flatMap(id=>roles.find(x=>x.id===id)?.permissions||[]));for(const p of user.additionalPermissions||[])if(!reserved.has(p))set.add(p);for(const p of user.deniedPermissions||[])set.delete(p);return [...set].sort();}
function publicUser(user){const {id,username,name,employeeNo,roleIds,additionalPermissions,deniedPermissions,scope,mustChangePassword,disabled,version,createdAt,updatedAt}=user;return {id,username,name,employeeNo,roleIds,additionalPermissions,deniedPermissions,scope,mustChangePassword,disabled,version,createdAt,updatedAt,permissions:effectivePermissions(user)};}
module.exports={permissions,roles,reserved,normalizePolicy,effectivePermissions,publicUser};
