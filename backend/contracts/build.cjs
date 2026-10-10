'use strict';
// Regenerate committed contracts: node backend/contracts/build.cjs
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const legacy = JSON.parse(fs.readFileSync(path.join(root, 'cli/operations.json'), 'utf8')).operations;
const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const str = (maxLength = 500) => ({ type: 'string', minLength: 1, maxLength });
const id = { type: 'string', format: 'uuid' };
const time = { type: 'string', format: 'date-time' };
const money = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER, description: '人民币整数分，禁止浮点金额' };
const int = (minimum = 1, maximum = 10000) => ({ type: 'integer', minimum, maximum });
const arr = (items, maxItems = 100) => ({ type: 'array', minItems: 1, maxItems, items });
const ids = { ...arr(id), uniqueItems: true };
const enumeration = (...values) => ({ type: 'string', enum: values });
const ref = name => ({ $ref: '#/components/schemas/' + name });
const schemas = {
  Empty: obj({}),
  Error: obj({ requestId: id, code: str(80), message: str(500), implemented: { const: false } }),
  Health: obj({ service: { const: 'siyue-backend-blueprint' }, mode: { const: 'design-only' }, businessReady: { const: false } }),
  ExpectedVersion: obj({ entity: enumeration('lead','course','class','session','student','enrollment','order','refund','account','role','policy','product','promotion','employee'), id, version: int(1, Number.MAX_SAFE_INTEGER) }),
  ClassInput: obj({ name: str(100), campusId: id, courseVersionId: id, teacherId: id, capacity: int(1, 1000) }),
  EnrollmentInput: obj({ studentId: id, classId: id, offerVersionIds: { ...ids, minItems: 0 }, creditApprovalId: id }, ['studentId','classId']),
  LessonInput: obj({ ordinal: int(), title: str(200), content: str(10000), materialIds: { ...ids, minItems: 0 } }, ['ordinal','title','content']),
  CourseInput: obj({ name: str(100), subject: str(100), ageMin: int(0, 100), ageMax: int(0, 100), priceMinor: money, lessons: arr(ref('LessonInput'), 500), materialIds: { ...ids, minItems: 0 } }, ['name','subject','priceMinor','lessons']),
  AssignmentInput: obj({ enrollmentId: id, targetClassId: id, effectiveAt: time, reason: str(1000) }),
  RoleGrant: obj({ operationId: str(100), scope: enumeration('own','campuses','tenant'), campusIds: { ...ids, minItems: 0 }, fields: { type: 'array', items: str(100), uniqueItems: true, maxItems: 100 } }, ['operationId','scope']),
  AuditFilter: obj({ actorId: id, category: str(100), result: enumeration('succeeded','failed','denied','viewed'), objectId: id, from: time, to: time, cursor: str(200), limit: int(1,100) }, []),
  PolicyInput: obj({ retainedDays: int(0,365), firstFollowHours: int(1,720), inactiveDays: int(1,365), campusIds: ids }),
  PromotionInput: obj({ name: str(100), template: enumeration('referral','pair','renewal','custom'), courseVersionIds: ids, campusIds: ids, startsAt: time, endsAt: time, discountMinor: money, discountBasisPoints: int(0,10000), stackable: { type: 'boolean' }, quota: int(1,1000000) }, ['name','template','courseVersionIds','campusIds','startsAt','endsAt','stackable'])
};
const operations = [];
function op(idValue, label, group, input, labels = [], opts = {}) {
  const inputName = idValue.split('.').map(x=>x[0].toUpperCase()+x.slice(1)).join('') + 'Input';
  schemas[inputName] = input;
  operations.push({ id: idValue, label, group, execution: 'planned', permission: idValue,
    inputSchema: ref(inputName), frontendAliases: legacy.filter(x => labels.includes(x.label)).map(x=>x.id),
    ...opts });
}
op('lead.create','创建线索','crm',obj({name:str(100),contact:str(100),campusId:id,source:enumeration('sales','operations','street','private','event','other'),sourceRef:str(200),retainForSelf:{type:'boolean'}},['name','contact','source']),['新建线索']);
op('lead.assign','分配线索','crm',obj({leadIds:ids,assigneeId:id,reason:str(1000)}),['分配线索']);
op('lead.transfer','转移线索','crm',obj({leadIds:ids,assigneeId:id,reason:str(1000)}),['转移线索']);
op('lead.release','释放线索到公海','crm',obj({leadIds:ids,reason:str(1000)}),['释放线索到公海']);
op('lead.follow','记录跟进','crm',obj({leadId:id,content:str(10000),nextFollowAt:time,intent:enumeration('high','medium','low','unknown')},['leadId','content']),['添加线索跟进']);
op('leadPolicy.preview','试运行保留与回收规则','crm',ref('PolicyInput'),['线索保留与回收策略设置']);
op('leadPolicy.publish','发布保留与回收规则','crm',obj({draftId:id,dryRunToken:str(500)}));
op('student.create','创建学生档案','archives',obj({name:str(100),birthday:{type:'string',format:'date'},guardianName:str(100),contact:str(100)},['name','guardianName','contact']),['录入新学生']);
op('student.archive','查看学生档案','archives',obj({studentId:id}),['查看学生档案'],{readOnly:true});
op('teacher.archive','查看老师档案','archives',obj({employeeId:id}),['查看老师档案'],{readOnly:true});
op('staff.archive','查看职工档案','archives',obj({employeeId:id}),['查看职工档案'],{readOnly:true});
op('course.create','创建课程与商品草稿','academic',ref('CourseInput'),['创建课程']);
op('course.update','更新课程草稿','academic',obj({courseId:id,draft:ref('CourseInput')}),['编辑课程']);
op('course.publish','发布课程版本','academic',obj({courseVersionId:id}));
op('class.create','创建班级','academic',ref('ClassInput'),['创建班级']);
op('class.batchCreate','批量创建班级','academic',obj({classes:arr(ref('ClassInput'))}),['批量创建班级']);
op('class.relocate','批量班级转校区','academic',obj({classIds:ids,targetCampusId:id,effectiveAt:time,reason:str(1000)}),['批量班级转校区']);
op('enrollment.create','单个学生报名','academic',ref('EnrollmentInput'),['为学生报名']);
op('enrollment.batchCreate','批量报名','academic',obj({items:arr(ref('EnrollmentInput'))}),['批量报名']);
op('enrollment.transfer','永久转班','academic',ref('AssignmentInput'),['转课／转班']);
op('enrollment.batchTransfer','批量学生转班','academic',obj({items:arr(ref('AssignmentInput'))}),['批量学生转班']);
op('session.move','临时转班或调课','academic',obj({enrollmentId:id,sourceSessionId:id,targetSessionId:id,chapterOverrideReason:str(1000)},['enrollmentId','sourceSessionId','targetSessionId']),['临时调课／调班']);
op('session.substitute','指定代课老师','academic',obj({sessionIds:ids,teacherId:id,reason:str(1000)}),['安排代课老师']);
op('session.attendance','点名与课消确认','academic',obj({sessionId:id,items:arr(obj({rosterId:id,attendance:enumeration('present','absent','leave'),confirmConsumption:{type:'boolean'}}))}),['课次点名／考勤']);
op('session.record','填写授课记录','academic',obj({sessionId:id,content:str(10000),materialIds:{...ids,minItems:0}},['sessionId','content']),['填写授课记录']);
op('enrollment.withdraw','办理退课并申请退款','academic',{oneOf:[
 obj({enrollmentId:id,effectiveAt:time,calculation:{const:'automatic'},reason:str(1000)}),
 obj({enrollmentId:id,effectiveAt:time,calculation:{const:'manual'},manualAmountMinor:money,evidenceIds:ids,reason:str(1000)})
]},['为学生退课'],{rules:['manual 时必须有 manualAmountMinor 和 evidenceIds','退课与退款支付独立；自动金额由服务器计算']});
op('order.paymentLink','生成支付二维码','finance',obj({orderId:id}),[],{rules:['只向渠道申请短时支付链接，不根据前端金额收款']});
op('order.confirmReceipt','核验线下收款','finance',obj({orderId:id,amountMinor:money,receivedAt:time,channel:enumeration('cash','bank'),evidenceId:id,reference:str(200)}),[],{rules:['需要独立财务权限，不能确认线上渠道付款']});
op('refund.approve','核定退款申请','finance',obj({refundId:id,evidenceIds:ids,reason:str(1000)}),[],{rules:['财务审批人与退课申请人分离；检查退款预占上限']});
op('refund.submit','提交渠道退款','finance',obj({refundId:id}),[],{rules:['须已审批；最终结果由验签回调或主动对账确认']});
op('promotion.create','创建优惠策略草稿','marketing',ref('PromotionInput'),['创建优惠策略','创建拼团活动','创建联报活动']);
op('promotion.publish','发布优惠版本','marketing',obj({promotionVersionId:id}));
op('product.publish','发布课程商品','marketing',obj({productVersionId:id,promotionVersionIds:{...ids,minItems:0}},['productVersionId']),['课程上下架管理']);
op('employee.create','创建员工','identity',obj({name:str(100),campusId:id,kind:enumeration('teacher','staff','both')}),['创建员工']);
op('account.update','设置账号状态和角色','identity',obj({accountId:id,active:{type:'boolean'},roleIds:ids},['accountId']),['编辑员工账号']);
op('role.grant','设置角色功能与范围','identity',obj({roleId:id,grants:arr(ref('RoleGrant'))}),['角色与权限']);
op('audit.query','分类检索全员操作日志','audit',ref('AuditFilter'),['查看操作日志'],{readOnly:true,superadminOnly:true});

const catalog = { version:'0.1.0', mode:'design-only', authorizationFiltered:false,
  description:'公开功能定义，不包含身份授权结果。执行前须由服务器重新鉴权；当前所有业务尚未实现。',
  operations, components:{schemas} };
const operationEnvelope = name => ({ oneOf: operations.map(o => obj({
  operationId:{const:o.id}, schemaVersion:{const:'1'}, input:o.inputSchema,
  expectedVersions:{type:'array',maxItems:300,items:ref('ExpectedVersion'),description:'新建可为空，所有被修改或决定资格/金额的对象必须传版本并由服务端复核'},
  ...(name==='execute'?{previewToken:str(1000)}:{})
}, name==='execute'?['operationId','schemaVersion','input','expectedVersions','previewToken']:['operationId','schemaVersion','input','expectedVersions'])) });
const stubResponses = { '501':{description:'骨架固定拒绝：业务尚未实现，不产生读写效果',content:{'application/json':{schema:ref('Error')}}} };
function planned(operationId, summary, extras={}) {
 return {operationId,summary,description:'计划接口，当前固定返回 501。正式实现后需认证、范围校验、审计与事务。',security:[{sessionCookie:[]},{serviceToken:[]}],responses:stubResponses,'x-implementation':'not-implemented',...extras};
}
function publicRead(operationId, summary, schema) {
 return {get:{operationId,summary,security:[],responses:{'200':{description:summary,content:{'application/json':{schema}}}}}};
}
const paths = {
 '/healthz':publicRead('health','仅检查骨架存活，不表示业务就绪',ref('Health')),
 '/v1/catalog':publicRead('publicCatalog','公开设计目录；不是身份授权结果',{type:'object',required:['mode','authorizationFiltered','operations'],properties:{mode:{const:'design-only'},authorizationFiltered:{const:false},operations:{type:'array',items:{type:'object'}}}}),
 '/openapi.json':publicRead('openApiDocument','读取此契约',{type:'object'}),
 '/v1/me':{get:planned('currentIdentity','读取真实身份与授权校区')},
 '/v1/me/operations':{get:planned('authorizedOperations','当前身份可执行操作目录')},
 '/v1/operations/{operationId}/preview':{post:planned('previewOperation','在单一办理页面预览影响',{
   parameters:[{name:'operationId',in:'path',required:true,schema:{type:'string',enum:operations.map(o=>o.id)}}],
   requestBody:{required:true,content:{'application/json':{schema:operationEnvelope('preview')}}}
 })},
 '/v1/operations/{operationId}/execute':{post:planned('executeOperation','原子执行同一操作；路径和正文操作 ID 必须一致',{
   parameters:[{name:'operationId',in:'path',required:true,schema:{type:'string',enum:operations.map(o=>o.id)}},{name:'Idempotency-Key',in:'header',required:true,schema:{type:'string',minLength:16,maxLength:128}}],
   requestBody:{required:true,content:{'application/json':{schema:operationEnvelope('execute')}}},
   'x-planned-result':{requestId:'uuid',status:'succeeded',resultIds:['uuid'],revisions:[{entity:'order',id:'uuid',version:2}],eventIds:['uuid']},
   'x-planned-errors':['UNAUTHENTICATED','FORBIDDEN','VALIDATION_ERROR','NOT_FOUND','VERSION_CONFLICT','IDEMPOTENCY_CONFLICT','PREVIEW_EXPIRED','AUDIT_UNAVAILABLE']
 })},
 '/v1/students':{get:planned('listStudents','分页读取范围内学生')},
 '/v1/employees':{get:planned('listEmployees','分页读取范围内在职员工')},
 '/v1/leads':{get:planned('listLeads','分页读取归属范围内线索')},
 '/v1/orders':{get:planned('listOrders','分页读取订单与欠费投影')},
 '/v1/schedule':{get:planned('querySchedule','统一课表投影',{parameters:[{name:'view',in:'query',required:true,schema:enumeration('student','teacher','room','campus')},{name:'subjectId',in:'query',required:true,schema:id},{name:'from',in:'query',required:true,schema:time},{name:'to',in:'query',required:true,schema:time}]})},
 '/v1/audit-events':{get:planned('listAuditEvents','超级管理员检索全员审计记录',{parameters:Object.entries(schemas.AuditFilter.properties).map(([name,schema])=>({name,in:'query',schema}))})},
 '/v1/jobs/{jobId}':{get:planned('readJob','查询批量任务结果',{parameters:[{name:'jobId',in:'path',required:true,schema:id}]})},
 '/v1/payment-webhooks/{provider}':{post:planned('paymentWebhook','渠道验签回调；骨架不接受任何支付确认',{security:[],parameters:[{name:'provider',in:'path',required:true,schema:enumeration('wechat','alipay')}],description:'正式实现时必须验签、防重放、核对商户/订单/金额并按渠道事件 ID 去重。当前返回 501，不认可任意 Authorization 或客户端身份。'})}
};
for(const route of ['/v1/students','/v1/employees','/v1/leads','/v1/orders']) paths[route].get.parameters = [
 {name:'campusId',in:'query',schema:id},{name:'query',in:'query',schema:str(100)},
 {name:'cursor',in:'query',schema:str(200)},{name:'limit',in:'query',schema:int(1,100)}
];
const openapi = {openapi:'3.1.0',info:{title:'思跃统一操作后端（设计预留）',version:'0.1.0',description:'只有 health/catalog/契约已实现，其余固定 501；尚未连接前端、数据库、身份服务或支付。'},servers:[{url:'http://127.0.0.1:8787',description:'仅本机设计骨架'}],paths,components:{schemas,securitySchemes:{sessionCookie:{type:'apiKey',in:'cookie',name:'siyue_session',description:'待实现的 HttpOnly Secure SameSite 会话；变更操作同时校验 CSRF，禁止复用演示身份。'},serviceToken:{type:'http',scheme:'bearer',description:'待实现的 CLI/agent 短时令牌，绑定真实账号、范围及到期时间；不接受客户端自报角色。'}}}};
fs.writeFileSync(path.join(__dirname,'operations.json'),JSON.stringify(catalog,null,2)+'\n');
fs.writeFileSync(path.join(__dirname,'openapi.json'),JSON.stringify(openapi,null,2)+'\n');
console.log(`Generated ${operations.length} planned operations and ${Object.keys(paths).length} HTTP paths.`);
