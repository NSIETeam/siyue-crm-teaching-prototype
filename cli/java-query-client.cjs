'use strict';

const auth = require('./auth-client.cjs');
const failure = (code, message) => Object.assign(new Error(message), { code });
const booleanFilters = new Set(['unassignedOnly', 'activeOnly', 'includeInactive']);
const definitions = Object.freeze({
  customers: { label: '客户档案与资源检索', endpoint: 'crm/customers', filters: ['searchType', 'query', 'page', 'size'], maxPage: 100000, maxSize: 100,
    enums: { searchType: ['auto', 'name', 'phone', 'student_number', 'student_id', 'opportunity_id', 'lead_id', 'email', 'customer_id'] }, typedSearch: true },
  studentIdentifiers: { label: '客户关联孩子的学号', endpoint: 'crm/customers', filters: ['customerId', 'studentId', 'status', 'page', 'size'],
    required: ['customerId', 'studentId'], pathParameters: ['customerId', 'studentId'],
    pathTemplate: 'crm/customers/:customerId/students/:studentId/identifiers', maxPage: 100000, maxSize: 100,
    enums: { status: ['active', 'inactive', 'all'] } },
  studentNameIndexStatus: { label: '学生姓名检索维护状态', endpoint: 'crm/customer-search/student-name-index/status', filters: [] },
  studentNumberIndexStatus: { label: '学生学号检索维护状态', endpoint: 'crm/customer-search/student-number-index/status', filters: [] },
  activities: { label: '获客活动', endpoint: 'crm/activities', filters: ['campusId', 'page', 'size'] },
  leads: { label: '线索', endpoint: 'crm/leads', filters: ['status', 'customerId', 'activityId', 'campusId', 'ownerId',
    'source', 'subject', 'unassignedOnly', 'activeOnly', 'nextFollowFrom', 'nextFollowUntil', 'page', 'size'] },
  opportunities: { label: '销售机会', endpoint: 'crm/opportunities', filters: ['customerId', 'stage', 'page', 'size'] },
  needContext: { label: '接待客户摘要', endpoint: 'crm/opportunity-needs/customers', filters: ['customerId'],
    required: ['customerId'], pathParameters: ['customerId'], pathSuffix: 'context' },
  needStudents: { label: '接待客户关联孩子', endpoint: 'crm/opportunity-needs/customers', filters: ['customerId', 'page', 'size'],
    required: ['customerId'], pathParameters: ['customerId'], pathSuffix: 'students', maxSize: 100 },
  existingNeeds: { label: '客户已有需求最小投影', endpoint: 'crm/opportunity-needs/customers', filters: ['customerId', 'page', 'size'],
    required: ['customerId'], pathParameters: ['customerId'], pathSuffix: 'existing', maxSize: 100 },
  needOptions: { label: '接待需求可用配置', endpoint: 'crm/opportunity-needs/options', filters: ['customerId'], required: ['customerId'] },
  opportunityNeed: { label: '商机需求资料', endpoint: 'crm/opportunity-needs', filters: ['opportunityId'],
    required: ['opportunityId'], pathParameters: ['opportunityId'] },
  opportunityNeedOptions: { label: '当前商机可用配置', endpoint: 'crm/opportunity-needs', filters: ['opportunityId'],
    required: ['opportunityId'], pathParameters: ['opportunityId'], pathSuffix: 'options' },
  opportunityAssignees: { label: '商机候选负责人', endpoint: 'crm/opportunity-needs/assignees',
    filters: ['customerId', 'opportunityId', 'page', 'size'], exactlyOneOf: ['customerId', 'opportunityId'], maxSize: 100 },
  opportunityConsultations: { label: '商机接待记录', endpoint: 'crm/opportunity-needs', filters: ['opportunityId', 'page', 'size'],
    required: ['opportunityId'], pathParameters: ['opportunityId'], pathSuffix: 'consultations', maxSize: 100 },
  needConfiguration: { label: '商机需求配置', endpoint: 'crm/opportunity-config', filters: ['kind', 'status', 'campusId', 'page', 'size'],
    maxSize: 100, enums: { kind: ['department', 'project', 'grade', 'class_type', 'level', 'fiscal_year', 'quarter', 'judgment', 'judgment_reason'], status: ['active', 'inactive', 'all'] } },
  opportunityNotifications: { label: '本人的商机提醒', endpoint: 'crm/opportunity-notifications', filters: ['status', 'page', 'size'],
    maxSize: 100, enums: { status: ['unread', 'read', 'all'] } },
  taskRoutingSupervisors: { label: '任务候选主管', endpoint: 'crm/task-routing/supervisors', filters: ['campusId', 'batchId', 'query', 'page', 'size'], requireAny: ['campusId', 'batchId'], permissions: ['crm.task.write', 'crm.task.assign'], maxPage: 100000, maxSize: 100, allowOpenRange: true },
  taskRoutingBatches: { label: '主管任务批次', endpoint: 'crm/task-routing/batches', filters: ['view', 'campusId', 'supervisorId', 'activityId', 'query', 'distributionStatus', 'executionStatus', 'fromAt', 'untilAt', 'page', 'size'], enums: { view: ['responsible', 'created', 'scope'], distributionStatus: ['unassigned', 'partial', 'allocated', 'empty'], executionStatus: ['not_started', 'in_progress', 'completed', 'cancelled'] }, permissions: ['crm.task.read', 'crm.task.manage'], maxPage: 100000, maxSize: 100, allowOpenRange: true },
  taskRoutingGlobalTasks: { label: '主管任务明细', endpoint: 'crm/task-routing/tasks', filters: ['view', 'campusId', 'supervisorId', 'activityId', 'query', 'distributionStatus', 'executionStatus', 'fromAt', 'untilAt', 'page', 'size', 'batchId', 'ownerId', 'status'], enums: { view: ['responsible', 'created', 'scope'], distributionStatus: ['unassigned', 'partial', 'allocated', 'empty'], executionStatus: ['not_started', 'in_progress', 'completed', 'cancelled'] }, permissions: ['crm.task.read', 'crm.task.manage'], maxPage: 100000, maxSize: 100, allowOpenRange: true },
  taskRoutingGlobalEmployees: { label: '主管员工分派统计', endpoint: 'crm/task-routing/employees', filters: ['view', 'campusId', 'supervisorId', 'activityId', 'query', 'distributionStatus', 'executionStatus', 'fromAt', 'untilAt', 'page', 'size', 'batchId', 'ownerId', 'status'], enums: { view: ['responsible', 'created', 'scope'], distributionStatus: ['unassigned', 'partial', 'allocated', 'empty'], executionStatus: ['not_started', 'in_progress', 'completed', 'cancelled'] }, permissions: ['crm.task.read', 'crm.task.manage'], maxPage: 100000, maxSize: 100, allowOpenRange: true },
  taskRoutingBatch: { label: '任务批次详情', endpoint: 'crm/task-routing/batches', filters: ['batchId'], required: ['batchId'], pathParameters: ['batchId'], pathSuffix: '', permissions: ['crm.task.read', 'crm.task.manage'], maxPage: 100000, maxSize: 100 },
  taskRoutingTasks: { label: '批次任务', endpoint: 'crm/task-routing/batches', filters: ['batchId', 'status', 'ownerId', 'page', 'size'], required: ['batchId'], pathParameters: ['batchId'], pathSuffix: 'tasks', permissions: ['crm.task.read', 'crm.task.manage'], maxPage: 100000, maxSize: 100 },
  taskRoutingEmployees: { label: '批次员工统计', endpoint: 'crm/task-routing/batches', filters: ['batchId', 'page', 'size'], required: ['batchId'], pathParameters: ['batchId'], pathSuffix: 'employees', permissions: ['crm.task.read', 'crm.task.manage'], maxPage: 100000, maxSize: 100 },
  taskRoutingAssignees: { label: '批次候选员工', endpoint: 'crm/task-routing/batches', filters: ['batchId', 'query', 'page', 'size'], required: ['batchId'], pathParameters: ['batchId'], pathSuffix: 'assignees', permissions: ['crm.task.read', 'crm.task.manage'], maxPage: 100000, maxSize: 100 },
  taskRoutingEvents: { label: '批次分派历史', endpoint: 'crm/task-routing/batches', filters: ['batchId', 'page', 'size'], required: ['batchId'], pathParameters: ['batchId'], pathSuffix: 'events', permissions: ['crm.task.read', 'crm.task.manage'], maxPage: 100000, maxSize: 100 },
  tasks: { label: '任务中心', endpoint: 'crm/tasks', filters: ['status', 'taskType', 'batchId', 'activityId', 'page', 'size'], maxPage: 100000, maxSize: 100 },
  activityAudience: { label: '活动来源名单', endpoint: 'crm/activities',
    filters: ['activityId', 'sourceType', 'customerId', 'fromAt', 'untilAt', 'taskState', 'page', 'size'],
    required: ['activityId'], pathParameters: ['activityId'], pathSuffix: 'audience', maxPage: 100000, maxSize: 100,
    allowOpenRange: true, enums: { sourceType: ['lead', 'touchpoint'], taskState: ['all', 'with_evidence', 'without_evidence'] } },
  taskAssignees: { label: '任务候选员工与可见待办量', endpoint: 'crm/tasks/assignees',
    filters: ['campusId', 'taskType', 'query', 'page', 'size'], maxPage: 100000, maxSize: 100,
    enums: { taskType: ['marketing', 'service'] } },
  taskContext: { label: '当前任务必要客户信息', endpoint: 'crm/tasks', filters: ['taskId'],
    required: ['taskId'], pathParameters: ['taskId'], pathSuffix: 'context' },
  taskOpportunities: { label: '当前任务匹配商机', endpoint: 'crm/tasks', filters: ['taskId', 'page', 'size'],
    required: ['taskId'], pathParameters: ['taskId'], pathSuffix: 'opportunities', maxPage: 100000, maxSize: 100 },
  taskStudents: { label: '任务客户关联学生', endpoint: 'crm/tasks/targets', filters: ['customerId', 'page', 'size'],
    required: ['customerId'], maxSize: 100 },
  taskBatches: { label: '任务批次', endpoint: 'crm/tasks/batches', filters: ['status', 'taskType', 'activityId', 'page', 'size'], maxPage: 100000, maxSize: 100 },
  orders: { label: '收费订单', endpoint: 'crm/orders', filters: ['opportunityId', 'page', 'size'] },
  serviceTickets: { label: '服务工单', endpoint: 'crm/service-tickets', filters: ['status', 'page', 'size'] },
  forms: { label: '营销表单', endpoint: 'crm/forms', filters: ['campusId', 'status', 'page', 'size'] },
  receiptsReport: { label: '实收报表', endpoint: 'crm/reports/receipts', filters: ['fromAt', 'untilAt', 'page', 'size'],
    required: ['fromAt', 'untilAt'] },
  cashFlowReport: { label: '现金流报表', endpoint: 'crm/reports/cash-flow', filters: ['fromAt', 'untilAt', 'page', 'size'],
    required: ['fromAt', 'untilAt'] },
  customerDetails: { label: '客户档案详情', endpoint: 'crm/customers', filters: ['customerId'],
    required: ['customerId'], pathParameters: ['customerId'] },
  customerTouchpoints: { label: '客户触点', endpoint: 'crm/customers', filters: ['customerId'],
    required: ['customerId'], pathParameters: ['customerId'], pathSuffix: 'touchpoints' },
  leadEvents: { label: '线索时间线', endpoint: 'crm/leads', filters: ['leadId'],
    required: ['leadId'], pathParameters: ['leadId'], pathSuffix: 'events' },
  opportunityEvents: { label: '商机时间线', endpoint: 'crm/opportunities', filters: ['opportunityId'],
    required: ['opportunityId'], pathParameters: ['opportunityId'], pathSuffix: 'events' },
  orderReceipts: { label: '订单收款流水', endpoint: 'crm/orders', filters: ['orderId', 'page', 'size'],
    required: ['orderId'], pathParameters: ['orderId'], pathSuffix: 'receipts', maxSize: 100 },
  refundRequests: { label: '订单退款申请', endpoint: 'crm/orders', filters: ['orderId', 'page', 'size'],
    required: ['orderId'], pathParameters: ['orderId'], pathSuffix: 'refund-requests', maxSize: 100 },
  orderRefunds: { label: '订单退款流水', endpoint: 'crm/orders', filters: ['orderId', 'page', 'size'],
    required: ['orderId'], pathParameters: ['orderId'], pathSuffix: 'refunds', maxSize: 100 },
  attributionRequests: { label: '订单归因纠错申请', endpoint: 'crm/orders', filters: ['orderId', 'page', 'size'],
    required: ['orderId'], pathParameters: ['orderId'], pathSuffix: 'attribution-requests', maxSize: 100 },
  attributionAdjustments: { label: '订单归因调整流水', endpoint: 'crm/orders', filters: ['orderId'],
    required: ['orderId'], pathParameters: ['orderId'], pathSuffix: 'attribution-adjustments' },
  refundRequestEvents: { label: '退款审批时间线', endpoint: 'crm/refund-requests', filters: ['requestId'],
    required: ['requestId'], pathParameters: ['requestId'], pathSuffix: 'events' },
  attributionRequestEvents: { label: '归因纠错时间线', endpoint: 'crm/attribution-requests', filters: ['requestId'],
    required: ['requestId'], pathParameters: ['requestId'], pathSuffix: 'events' },
  serviceTicketTypes: { label: '服务工单类型', endpoint: 'crm/service-ticket-types', filters: ['campusId', 'includeInactive'] },
  serviceTicketEvents: { label: '服务工单时间线', endpoint: 'crm/service-tickets', filters: ['ticketId'],
    required: ['ticketId'], pathParameters: ['ticketId'], pathSuffix: 'events' },
  formSubmissions: { label: '表单提交审核', endpoint: 'crm/forms', filters: ['formId', 'status', 'page', 'size'],
    required: ['formId'], pathParameters: ['formId'], pathSuffix: 'submissions', maxSize: 100 },
  activityForms: { label: '活动关联表单', endpoint: 'crm/activities', filters: ['activityId'],
    required: ['activityId'], pathParameters: ['activityId'], pathSuffix: 'forms' },
  academicStudents: { label: '在读学生', endpoint: 'academic/students', filters: ['view', 'classId', 'page', 'size'], maxSize: 100 },
  academicCourses: { label: '课程目录', endpoint: 'academic/courses', filters: ['campusId', 'page', 'size'], maxSize: 100 },
  academicClasses: { label: '班级与排课', endpoint: 'academic/classes',
    filters: ['view', 'campusId', 'teacherId', 'room', 'fromAt', 'untilAt', 'page', 'size'], maxSize: 100 },
  academicOptions: { label: '教务校区教师教室选项', endpoint: 'academic/options', filters: ['campusId'] },
  studentClasses: { label: '学生在读班级', endpoint: 'academic/students', filters: ['studentId', 'view', 'page', 'size'],
    required: ['studentId'], pathParameters: ['studentId'], pathSuffix: 'classes', maxSize: 100 },
  teachingMetrics: { label: '教学月报', endpoint: 'academic/teaching-metrics', filters: ['month', 'view'], required: ['month'] },
  sessionRoster: { label: '课次点名册', endpoint: 'academic/sessions', filters: ['sessionId'], required: ['sessionId'],
    pathParameter: 'sessionId', pathSuffix: 'roster' },
  studentCommunications: { label: '学生沟通记录', endpoint: 'academic/students', filters: ['studentId', 'classId'],
    required: ['studentId', 'classId'], pathParameters: ['studentId'], pathSuffix: 'communications' },
  auditEvents: { label: '操作审计记录', endpoint: 'audit', filters: ['actorId', 'action', 'resourceId', 'fromAt', 'untilAt', 'page', 'size'],
    maxPage: 100000, maxSize: 100, maxWindowDays: 93 },
});
const safeIdentifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(value);
function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  const date = value.slice(0, 10), day = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(Date.parse(value)) && day.toISOString().slice(0, 10) === date
    && Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60 && Number(value.slice(17, 19)) < 60;
}

function validate(resource, input) {
  if (typeof resource !== 'string' || !Object.hasOwn(definitions, resource))
    throw failure('UNKNOWN_QUERY', 'Java CRM 暂无此查询资源');
  const definition = definitions[resource];
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input)) || Object.getOwnPropertySymbols(input).length)
    throw failure('INVALID_QUERY_INPUT', '查询条件必须是 JSON 对象');
  for (const [key, value] of Object.entries(input)) {
    if (!definition.filters.includes(key)) throw failure('INVALID_QUERY_INPUT', `查询 ${resource} 不支持条件 ${key}`);
    if (['page', 'size'].includes(key)) {
      const max = key === 'page' ? definition.maxPage || 1000000 : definition.maxSize || 200;
      if (!Number.isSafeInteger(value) || value < 1 || value > max)
        throw failure('INVALID_QUERY_INPUT', `${key} 须为 1–${max} 的整数`);
    } else if (definition.pathParameter === key || definition.pathParameters?.includes(key)) {
      if (!safeIdentifier(value)) throw failure('INVALID_QUERY_INPUT', `${key} 编号无效`);
    } else if (definition.enums?.[key]) {
      if (!definition.enums[key].includes(value)) throw failure('INVALID_QUERY_INPUT', `${key} 无效`);
    } else if (key === 'month') {
      if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value))
        throw failure('INVALID_QUERY_INPUT', 'month 须为 YYYY-MM');
    } else if (key === 'view') {
      if (!['mine', 'scope'].includes(value)) throw failure('INVALID_QUERY_INPUT', 'view 须为 mine 或 scope');
    } else if (booleanFilters.has(key)) {
      if (typeof value !== 'boolean') throw failure('INVALID_QUERY_INPUT', `${key} 须为布尔值`);
    } else if (['fromAt', 'untilAt'].includes(key) ? !instant(value)
      : typeof value !== 'string' || !value.trim() || value.length > 254 || /[\u0000-\u001f\u007f]/.test(value)) {
      throw failure('INVALID_QUERY_INPUT', `${key} 无效`);
    }
  }
  if (definition.typedSearch && input.searchType && input.searchType !== 'auto' && (typeof input.query !== 'string' || !input.query.trim()))
    throw failure('INVALID_QUERY_INPUT', '按类型检索必须填写查询内容');
  if (definition.typedSearch && input.searchType === 'student_number' && (input.query !== input.query.trim()
    || input.query.length > 120 || /[\u0000-\u001f\u007f-\u009f]/.test(input.query)))
    throw failure('INVALID_QUERY_INPUT', '学号须保留原值，不含首尾空白或控制字符，且不超过120字符');
  for (const key of definition.required || [])
    if (!Object.hasOwn(input, key)) throw failure('INVALID_QUERY_INPUT', `缺少 ${key}`);
  if (definition.requireAny && !definition.requireAny.some(key => Object.hasOwn(input, key)))
    throw failure('INVALID_QUERY_INPUT', `至少提供 ${definition.requireAny.join(' / ')}`);
  if (definition.exactlyOneOf && definition.exactlyOneOf.filter(key => Object.hasOwn(input, key)).length !== 1)
    throw failure('INVALID_QUERY_INPUT', `${definition.exactlyOneOf.join(' / ')} 必须且只能提供一个`);
  if (input.fromAt && input.untilAt && Date.parse(input.fromAt) >= Date.parse(input.untilAt))
    throw failure('INVALID_QUERY_INPUT', 'fromAt 必须早于 untilAt');
  if (!definition.allowOpenRange && (input.fromAt === undefined) !== (input.untilAt === undefined))
    throw failure('INVALID_QUERY_INPUT', 'fromAt 与 untilAt 必须同时提供');
  if (definition.maxWindowDays && input.fromAt && input.untilAt
    && Date.parse(input.untilAt) - Date.parse(input.fromAt) > definition.maxWindowDays * 86400000)
    throw failure('INVALID_QUERY_INPUT', `查询区间不能超过 ${definition.maxWindowDays} 天`);
  for (const key of definition.required || [])
    if (typeof input[key] === 'string' && !input[key].trim()) throw failure('INVALID_QUERY_INPUT', `${key} 不能为空`);
  return definition;
}

function unwrap(envelope) {
  if (!envelope || typeof envelope !== 'object' || envelope.code !== 'OK' || !Object.hasOwn(envelope, 'data'))
    throw failure(envelope?.code || 'INVALID_RESPONSE', envelope?.message || 'Java API 未返回有效业务数据');
  return envelope.data;
}

async function identity(client) {
  if (!client || typeof client.request !== 'function') throw failure('INVALID_CLIENT', '缺少 Java API 会话连接');
  return unwrap(await client.request('identity/me'));
}

async function query(resource, input = {}, client) {
  const definition = validate(resource, input);
  if (!client || typeof client.request !== 'function') throw failure('INVALID_CLIENT', '缺少 Java API 会话连接');
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input))
    if (key !== definition.pathParameter && !definition.pathParameters?.includes(key)) params.set(key, String(value));
  let endpoint = definition.endpoint;
  if (definition.pathTemplate) endpoint = definition.pathTemplate.replace(/:([A-Za-z]+)/g, (_, key) => encodeURIComponent(input[key]));
  else {
    if (definition.pathParameter) endpoint += `/${encodeURIComponent(input[definition.pathParameter])}`;
    if (definition.pathParameters) endpoint += `/${encodeURIComponent(input[definition.pathParameters[0]])}`;
    if (definition.pathSuffix) endpoint += `/${definition.pathSuffix}`;
  }
  const suffix = params.size ? `?${params}` : '';
  return unwrap(await client.request(`${endpoint}${suffix}`));
}

function queries(me) {
  return Object.entries(definitions).filter(([, value]) => !me || !value.permissions || value.permissions.every(permission => me.permissions?.includes(permission))).map(([id, value]) => ({ id, version:'v2', method:'GET', label: value.label, endpoint: value.endpoint, pathParameter:value.pathParameter||null,pathParameters:value.pathParameters||[],pathSuffix:value.pathSuffix||null,pathTemplate:value.pathTemplate||null,permissions:value.permissions||[],requiredQueryParams:(value.required||[]).filter(key=>key!==value.pathParameter&&!(value.pathParameters||[]).includes(key)),
    inputSchema: { type: 'object', properties: Object.fromEntries(value.filters.map(key => [key,
      ['page', 'size'].includes(key) ? { type: 'integer', minimum: 1,
        maximum: key === 'page' ? value.maxPage || 1000000 : value.maxSize || 200 }
        : booleanFilters.has(key) ? { type: 'boolean' }
          : ['fromAt', 'untilAt'].includes(key) ? { type: 'string', format: 'date-time' }
            : value.enums?.[key] ? { type: 'string', enum: value.enums[key] }
            : key === 'month' ? { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' }
              : key === 'view' ? { type: 'string', enum: ['mine', 'scope'] }
              : value.pathParameter === key || value.pathParameters?.includes(key)
                ? { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$' }
                : { type: 'string', minLength: 1, maxLength: 254 }])),
    required: value.required || [], additionalProperties: false,
    ...(value.requireAny ? { anyOf: value.requireAny.map(key => ({ required: [key] })) } : {}),
    ...(value.typedSearch ? { allOf: [{ if: { required: ['searchType'], properties: { searchType: { not: { const: 'auto' } } } }, then: { required: ['query'] } }] } : {}),
    ...(value.exactlyOneOf ? { oneOf: value.exactlyOneOf.map(key => ({ required: [key],
      not: { anyOf: value.exactlyOneOf.filter(other => other !== key).map(other => ({ required: [other] })) } })) } : {}) } }));
}

async function authenticate(server, token, env = process.env, fetcher = globalThis.fetch) {
  const endpoint = auth.serverURL(server);
  if (typeof token !== 'string' || !token.trim() || token.length > 16384 || /[\u0000-\u0020\u007f]/.test(token))
    throw failure('INVALID_TOKEN', 'Java access token 无效');
  const envelope = await auth.request(endpoint, 'identity/me', { token: token.trim(), fetcher });
  const user = unwrap(envelope);
  auth.writeSession({ server: endpoint, token: token.trim(), apiVersion: 'v2', principalId: user.principalId }, env);
  return user;
}

module.exports = { definitions, validate, identity, query, queries, authenticate, unwrap };
