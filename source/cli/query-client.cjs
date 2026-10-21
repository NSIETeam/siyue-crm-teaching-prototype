'use strict';

// Every route is fixed here. The supplied request function owns authentication;
// all data filtering and authorization remain on the server before projection.
const failure=(code,message)=>Object.assign(new Error(message),{code});
const text=(title,maxLength=120)=>({type:'string',title,minLength:1,maxLength});
const identifier=title=>text(title,120);
const schema=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
const date={...text('日期或带时区的时间',40),description:'YYYY-MM-DD 或带 Z / ±HH:MM 时区的 ISO 时间'};
const range={from:date,to:date};
const page={limit:{type:'integer',minimum:1,maximum:500,title:'每页数量'}};
const selected={id:identifier('记录编号；只在服务器已授权结果中筛选')};
const auditFields={
 view:{type:'string',enum:['activity','attention','all'],title:'日志视图'},
 actor:text('员工编号（actorId 的兼容名）',128),actorId:text('员工编号',128),actorQuery:text('员工姓名、账号或工号'),
 action:text('操作编号'),actionPrefix:text('操作编号前缀'),group:text('操作类别',100),outcome:text('操作结果',40),
 ...range,...page,before:text('上一页 nextBefore',128),
};
const definitions=[
 ['health','服务状态','/healthz'],['api-contract','API 接口契约','/openapi.json'],['me','当前登录员工','/v1/auth/me'],
 ['state','全部授权业务数据','/v1/state'],['catalog','当前账号可执行操作','/v1/catalog'],
 ['students','学生档案','/v1/students',selected,'items'],['employees','员工档案','/v1/employees',selected,'items'],
 ['leads','线索','/v1/leads',selected,'items'],['orders','收费订单','/v1/orders',selected,'items'],
 ['schedule','班级及课表','/v1/schedule',selected,'items'],['reports','综合统计','/v1/reports'],
 ['sales-report','销售统计','/v1/reports/sales',{employeeId:identifier('销售员工编号'),...range}],
 ['teacher-report','教师统计','/v1/reports/teachers',{employeeId:identifier('教师编号'),observationDays:{type:'integer',minimum:1,maximum:365,title:'续费观察天数'}}],
 ['activity','销售操作或跟进记录','/v1/sales/activity',{employeeId:identifier('员工编号'),view:{type:'string',enum:['activity','followups'],title:'活动或跟进记录'},leadId:identifier('线索编号'),action:text('操作编号'),...range,...page,cursor:text('上一页 nextCursor',512)}],
 ['audit-events','操作日志','/v1/audit-events',auditFields],['admin-audit','管理操作日志','/v1/admin/audit',auditFields],
 ['roles','角色及可配置权限','/v1/roles'],['accounts','全部员工账号','/v1/admin/users',selected,'users'],
 ['makeup-candidates','可补课课次','/v1/makeup/candidates',{enrollmentId:identifier('报名编号'),sourceSessionId:identifier('原课次编号')},null,['enrollmentId','sourceSessionId']],
 ['attendance-roster','当前课次有效考勤名单','/v1/sessions/attendance-roster',{classId:identifier('班级编号'),sessionId:identifier('课次编号')},null,['classId','sessionId']],
 ['public-store','已发布商城','/v1/public/store'],
 ['public-form','已发布表单','/v1/public/forms/',{formId:{...identifier('表单编号'),pattern:'^[a-zA-Z0-9_-]+$'}},null,['formId']],
].map(([id,label,endpoint,properties={},itemKey=null,required=[]])=>({id,label,endpoint,itemKey,inputSchema:schema(properties,required)}));

const collections=[
 ['courses','课程','courses'],['classes','班级','classes'],['campuses','校区及教室','campuses'],
 ['enrollments','报名权益','enrollments'],['receipts','收款记录','receipts'],['refunds','退款记录','refunds'],
 ['consumptions','课消记录','consumptions'],['attendance','考勤记录','attendance'],['session-adjustments','补课、临时转班及放弃记录','sessionAdjustments'],
 ['directory','员工选择目录','directory'],['staff','授权职工业务档案','staff'],['forms','表单及授权提交','forms'],
 ['lead-reclaim-requests','超时线索取回申请','leadReclaimRequests'],['reschedule-requests','教师调课申请','rescheduleRequests'],
 ['reward-claims','表单奖励领取记录','rewardClaims'],['trial-bookings','试课预约','trialBookings'],
 ['shelved','已上架课程编号','shelved'],['hidden-shelved','已隐藏课程编号','hiddenShelved'],['inbox','本人通知','inbox'],
];
for(const [id,label,collection] of collections)definitions.push({id,label,endpoint:'/v1/state',collection,inputSchema:schema(selected),collectionType:'array'});
for(const [id,label,collection] of [
 ['dictionary','教学字典','dictionary'],['settings','系统设置','settings'],['lead-policy','线索保留及回收策略','leadPolicy'],
 ['activities','优惠券、拼团及联报','activities'],['decor','商城装修草稿及发布内容','decor'],
 ['metrics','本人线索转化统计','metrics'],['learning-metrics','教学统计','learningMetrics'],
])definitions.push({id,label,endpoint:'/v1/state',collection,inputSchema:schema(),collectionType:'value'});

const registry=new Map(definitions.map(definition=>[definition.id,definition]));
const queries=definitions.map(({id,label,inputSchema})=>({id,label,inputSchema:structuredClone(inputSchema)}));
function validDate(value){
 const parts=value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/);
 if(!parts)return false;
 const day=`${parts[1]}-${parts[2]}-${parts[3]}`,date=new Date(`${day}T00:00:00Z`);
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===day&&Number.isFinite(Date.parse(value))&&(!parts[4]||+parts[4]<24&&+parts[5]<60&&+parts[6]<60);
}
function validate(definition,input){
 if(!input||typeof input!=='object'||Array.isArray(input)||![Object.prototype,null].includes(Object.getPrototypeOf(input))||Object.getOwnPropertySymbols(input).length)throw failure('INVALID_QUERY_INPUT','查询条件必须是 JSON 对象');
 const {properties,required}=definition.inputSchema;
 for(const key of Object.keys(input)){
  if(!Object.hasOwn(properties,key))throw failure('INVALID_QUERY_INPUT',`查询 ${definition.id} 不支持条件 ${key}`);
  const spec=properties[key],value=input[key];
  if(spec.type==='integer'){
   if(!Number.isSafeInteger(value)||value<spec.minimum||value>spec.maximum)throw failure('INVALID_QUERY_INPUT',`${key} 须为 ${spec.minimum}–${spec.maximum} 的整数`);
  }else if(typeof value!=='string'||value.length<(spec.minLength||1)||value.length>(spec.maxLength||120)||!value.trim()||/[\u0000-\u001f\u007f]/.test(value)||spec.enum&&!spec.enum.includes(value)||spec.pattern&&!new RegExp(spec.pattern).test(value))throw failure('INVALID_QUERY_INPUT',`${key} 无效`);
  if(['from','to'].includes(key)&&!validDate(value))throw failure('INVALID_QUERY_INPUT',`${key} 须为有效日期或带时区的时间`);
 }
 for(const key of required)if(!Object.hasOwn(input,key))throw failure('INVALID_QUERY_INPUT',`缺少 ${key}`);
 const isReport=['activity','sales-report'].includes(definition.id),instant=(value,end)=>Date.parse(isReport&&/^\d{4}-\d{2}-\d{2}$/.test(value)?`${value}T${end?'23:59:59.999':'00:00:00.000'}+08:00`:value);
 if(input.from&&input.to&&instant(input.from,false)>instant(input.to,true))throw failure('INVALID_QUERY_INPUT','开始时间不能晚于结束时间');
 if(input.actor&&input.actorId&&input.actor!==input.actorId)throw failure('INVALID_QUERY_INPUT','actor 与 actorId 不能指定不同员工');
 if(definition.id==='activity'&&input.view==='followups'&&['from','to','leadId','action'].some(key=>Object.hasOwn(input,key)))throw failure('INVALID_QUERY_INPUT','followups 视图只支持 employeeId、limit、cursor；历史跟进不按日期、线索或操作类型筛选');
}
function filterRows(rows,id){return id===undefined?rows:rows.filter(row=>typeof row==='string'?row===id:row?.id===id);}
async function query(id,input={},request){
 const definition=registry.get(id);
 if(!definition)throw failure('UNKNOWN_QUERY','没有该查询，请先列出可用查询');
 validate(definition,input);
 if(typeof request!=='function')throw failure('INVALID_QUERY_CLIENT','缺少已认证的查询连接');
 let endpoint=definition.endpoint;
 if(id==='public-form')endpoint+=encodeURIComponent(input.formId);
 else if(!definition.collection&&!definition.itemKey){const params=new URLSearchParams();for(const key of Object.keys(definition.inputSchema.properties))if(Object.hasOwn(input,key))params.set(key,String(input[key]));if(params.size)endpoint+='?'+params.toString();}
 const result=await request(endpoint,{method:'GET'});
 if(definition.collection){
  if(!result?.state||typeof result.state!=='object'||Array.isArray(result.state))throw failure('INVALID_RESPONSE','服务器未返回授权数据投影');
  const value=result.state[definition.collection],meta={revision:result.revision,userVersion:result.userVersion};
  if(definition.collectionType==='array'){
   if(!Array.isArray(value))throw failure('INVALID_RESPONSE','服务器未返回有效的授权记录集合');
   return {...meta,items:filterRows(value,input.id)};
  }
  return {...meta,value};
 }
 if(definition.itemKey&&input.id!==undefined){
  if(!Array.isArray(result?.[definition.itemKey]))throw failure('INVALID_RESPONSE','服务器未返回有效的授权记录集合');
  return {...result,[definition.itemKey]:filterRows(result[definition.itemKey],input.id)};
 }
 return result;
}

module.exports={queries,query};
