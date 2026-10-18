/* Opportunity intake and need configuration. All business facts come from the Java API. */
(function (root) {
  'use strict';
  const pages = [
    { id: 'crmNeedIntake', title: '前台接待', permissions: ['crm.opportunity.intake', 'crm.customer.read'] },
    { id: 'crmNeedConfiguration', title: '需求配置', permissions: ['crm.opportunity.config.manage'] },
    { id: 'crmNeedNotifications', title: '站内提醒', permissions: ['crm.opportunity.read'] },
    { id: 'crmCustomerSearchMaintenance', title: '客户检索维护', permissions: ['crm.customer.search.manage'], scope: 'all' }
  ];
  const kinds = { department: '意向部门', project: '管理项目', grade: '意向年级', class_type: '意向班型', level: '意向等级', fiscal_year: '意向财年', quarter: '意向季度', judgment: '商机判定', judgment_reason: '判定原因' };
  const profileFields = [['gradeId', '意向年级', 'grade'], ['preferredCampusId', '意向校区', 'campus'], ['classTypeId', '意向班型', 'class_type'], ['levelId', '意向等级', 'level'], ['fiscalYearId', '意向财年', 'fiscal_year'], ['quarterId', '意向季度', 'quarter']];
  const actions = { create: '建立新需求', reuse: '追加本次咨询，保留原负责人', classify_existing: '核对并识别历史需求', create_distinct: '确认为不同需求并新建' };
  const stages = { qualified: '需求确认', appointment: '预约试听', trial: '已试听', negotiation: '待报名', won: '已成交', closed: '已关闭' };
  const bindings = new WeakMap();
  const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value);
  const version = value => Number.isSafeInteger(value) && value > 0;
  const nullable = value => String(value ?? '').trim() || null;
  const emptyProfile = () => Object.fromEntries(profileFields.map(([key]) => [key, null]));
  const validPage = data => data && Array.isArray(data.items) && Number.isSafeInteger(data.total) && data.total >= data.items.length && version(data.page) && version(data.size);
  const rejectedCodes = new Set(['INVALID_INPUT', 'FORBIDDEN', 'NOT_FOUND', 'UNAUTHORIZED', 'PREVIEW_STALE', 'ALREADY_EXISTS', 'IDEMPOTENCY_CONFLICT']);
  function create({ api, identity, render, onChange = () => {}, onOpenOpportunity = () => {}, onOpenIdentifiers = () => {}, onReturn = () => {} }) {
    let actor = identity, generation = 0, disposed = false, active = true, bound = null;
    let s = { route: {}, mode: 'intake', loading: false, writing: false, pending: null, error: '', notice: '', dirty: false,
      context: null, options: null, students: null, existing: null, orderHistory: null, orderHistoryError: '', customers: null, customerQuery: '', customerPage: 1, customerSearchType: 'name', customerSearchDraft: { searchType: 'name', query: '' },
      draft: {}, preview: null, decision: { action: '', targetRef: '', reason: '' }, receipt: null, detail: null,
      studentIntakeOpen: false, studentIntakeDraft: { name: '', grade: '', phone: '', relationship: 'child' }, createdStudent: null,
      assignees: null, assignment: { ownerId: '', reason: '' }, consultations: null, config: null, configQuery: { status: 'all', page: 1, size: 20 }, configDraft: null, parents: null,
      notifications: null, notificationQuery: { status: 'unread', page: 1, size: 20 }, review: null, refreshed: false, profileBaseline: null, restricted: false,
      identifiers: null, identifierQuery: { status: 'all', page: 1, size: 20 }, identifierDraft: { namespace: '', value: '', reason: '' }, identifierTarget: null, identifierReceipt: null,
      maintenance: { name: { status: null, afterId: 0, limit: 200, receipt: null }, number: { status: null, afterId: 0, limit: 200, receipt: null } } };
    const has = code => actor?.permissions?.includes(code);
    const locked = () => !!s.pending || s.writing;
    const draw = () => { if (!disposed && active) render(); };
    const required = codes => { if (codes.some(code => !has(code))) throw new Error('当前账号没有办理此工作页的权限。'); };
    const still = token => !disposed && active && token === generation;
    const newKey = () => root.crypto.randomUUID();
    function restrictProjection() {
      s.restricted = true; s.refreshed = false; s.preview = null; s.review = null; s.orderHistoryError = '';
      for (const field of ['context', 'detail', 'options', 'students', 'existing', 'orderHistory', 'customers', 'consultations', 'assignees', 'config', 'parents', 'notifications']) s[field] = null;
      if (s.receipt) s.receipt.opportunity = null;
      s.createdStudent = null; s.studentIntakeOpen = false;
      if (s.pending?.kind !== 'student-intake') s.studentIntakeDraft = { name: '', grade: '', phone: '', relationship: 'child' };
      s.identifiers = null; s.identifierTarget = null;
      if (s.identifierReceipt) s.identifierReceipt = { id: s.identifierReceipt.id, version: s.identifierReceipt.version, active: s.identifierReceipt.active };
      for (const item of Object.values(s.maintenance)) { item.status = null; item.receipt = null; }
    }
    const btn = (label, action, data = '', primary = false, disabled = false) => `<button type="button" class="btn${primary ? ' primary' : ''}" data-jn-action="${action}"${data}${disabled || (action !== 'retry' && locked()) ? ' disabled' : ''}>${e(label)}</button>`;
    const box = (label, control, cls = '', hint = '') => `<div class="jn-field ${cls}"><label>${e(label)}</label>${control}${hint ? `<p class="jn-hint">${e(hint)}</p>` : ''}</div>`;
    const input = (label, key, value = '', max = 100, cls = '', requiredValue = false) => box(label, `<input aria-label="${e(label)}" name="${key}" value="${e(value)}" maxlength="${max}"${requiredValue ? ' required' : ''}${locked() || s.loading ? ' disabled' : ''}>`, cls);
    const textarea = (label, key, value = '', max = 5000, clsRequired = false) => box(label, `<textarea aria-label="${e(label)}" name="${key}" maxlength="${max}"${clsRequired ? ' required' : ''}${locked() || s.loading ? ' disabled' : ''}>${e(value)}</textarea>`, 'jn-wide');
    function select(label, key, value, rows, { requiredValue = false, hint = '', disabled = false, historical = '' } = {}) {
      const values = [...rows];
      if (value && !values.some(row => row.id === value)) values.push({ id: value, label: `${historical || value}（历史值，当前未启用）` });
      return box(label, `<select aria-label="${e(label)}" name="${key}"${requiredValue ? ' required' : ''}${disabled || locked() || s.loading ? ' disabled' : ''}><option value="">${rows.length ? '请选择' : '未配置'}</option>${values.map(row => `<option value="${e(row.id)}"${row.id === value ? ' selected' : ''}>${e(row.label ?? row.name ?? row.id)}</option>`).join('')}</select>`, '', hint);
    }
    const opts = kind => (s.options?.items || []).filter(row => row.kind === kind && row.active !== false);
    function pager(data, action) {
      if (!data) return '';
      const count = Math.max(1, Math.ceil(data.total / data.size));
      return `<div class="jn-pager"><span>共 ${e(data.total)} 条 · 第 ${e(data.page)} / ${count} 页</span>${btn('上一页', action, ` data-page="${data.page - 1}"`, false, data.page <= 1)}${btn('下一页', action, ` data-page="${data.page + 1}"`, false, data.page >= count)}</div>`;
    }
    function table(headers, rows, empty = '当前范围暂无记录') {
      return `<div class="jn-table-wrap"><table class="jn-table"><thead><tr>${headers.map(label => `<th>${e(label)}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${headers.length}">${e(empty)}</td></tr>`}</tbody></table></div>`;
    }
    async function read(call, accept, message = '读取失败，请重试。') {
      const token = ++generation; s.loading = true; s.error = ''; draw();
      try { const result = await call(); if (still(token)) accept(result); }
      catch (error) { if (still(token)) { s.error = error.message || message; if ([401, 403, 404].includes(error.status)) restrictProjection(); } }
      finally { if (still(token)) { s.loading = false; draw(); } }
    }
    function formValues(form) {
      const result = {}; new root.FormData(form).forEach((value, key) => { result[key] = String(value); }); return result;
    }
    function capture(form) {
      const type = form.dataset.jnForm;
      if (locked() || s.restricted || s.loading && type !== 'search') return;
      const values = formValues(form);
      if (type === 'search') { s.customerSearchDraft = { searchType: values.searchType || s.customerSearchType, query: values.query || '' }; return; }
      if (type === 'need') { Object.assign(s.draft, values); s.preview = null; s.review = null; s.dirty = true; }
      else if (type === 'student-intake') { Object.assign(s.studentIntakeDraft, values); s.dirty = true; }
      else if (type === 'profile') { Object.assign(s.draft, values); s.review = null; s.dirty = true; }
      else if (type === 'judgment') { Object.assign(s.draft, values); s.review = null; s.dirty = true; }
      else if (type === 'assignment') { Object.assign(s.assignment, values); s.review = null; s.dirty = true; }
      else if (type === 'decision') { Object.assign(s.decision, values); s.dirty = true; }
      else if (type === 'config') { Object.assign(s.configDraft, values); s.review = null; s.dirty = true; }
      else if (type === 'customer-create') { Object.assign(s.draft, values); s.review = null; s.dirty = true; }
      else if (type === 'identifier-create' || type === 'identifier-deactivate') { Object.assign(s.identifierDraft, values); s.review = null; s.dirty = true; }
      else if (type === 'index-name' || type === 'index-number') { s.maintenance[type.slice(6)].limit = Number(values.limit); s.review = null; }
      onChange();
    }
    function checkPage(data) { if (!validPage(data)) throw new Error('未收到有效分页结果，请重试。'); return data; }
    function customerSearchTypes() {
      const rows = [['name', '姓名'], ['phone', '电话']];
      if (has('crm.opportunity.intake') || has('student.read')) rows.push(['student_number', '学号'], ['student_id', '学生系统编号']);
      if (has('crm.opportunity.read')) rows.push(['opportunity_id', '商机编码']);
      if (has('crm.lead.read')) rows.push(['lead_id', '线索编码']);
      return [...rows, ['email', '邮箱'], ['customer_id', '客户编号']];
    }
    async function searchCustomers(page = 1, query = s.customerQuery, searchType = s.customerSearchType || 'name', preserveInput = false) {
      if (locked()) return;
      required(['crm.customer.read', 'crm.opportunity.intake']);
      s.customers = null; s.customerQuery = query.trim() ? query : ""; s.customerPage = page; s.customerSearchType = searchType;
      if (!preserveInput) s.customerSearchDraft = { searchType, query: s.customerQuery };
      if (s.customerQuery && !customerSearchTypes().some(([value]) => value === searchType)) { s.error = '当前账号没有使用此检索方式的权限，请重新选择。'; draw(); return; }
      const request = { searchType: s.customerQuery ? searchType : 'auto', query: s.customerQuery, page, size: 20 };
      await read(() => api.customers.list(request), result => { s.customers = checkPage(result); s.restricted = false; });
    }
    function customerSearchHtml() {
      const form = s.customerSearchDraft || { searchType: s.customerSearchType || 'name', query: s.customerQuery }, choices = customerSearchTypes();
      const unavailable = !choices.some(([value]) => value === form.searchType);
      const selected = s.customerQuery ? `${choices.find(([value]) => value === s.customerSearchType)?.[1] || '原检索方式'}：${s.customerQuery}（精确匹配）` : '当前范围客户（未按身份条件过滤）';
      return `<section class="jn-panel"><h2>1. 查找客户</h2><form data-jn-form="search"><div class="jn-grid">${box('检索方式', `<select name="searchType" aria-label="检索方式"${locked() ? ' disabled' : ''}>${unavailable ? '<option value="" selected disabled>原检索方式已无权限，请重新选择</option>' : ''}${choices.map(([value, label]) => `<option value="${value}"${value === form.searchType ? ' selected' : ''}>${label}</option>`).join('')}</select>`)}${box('检索内容', `<input name="query" aria-label="检索内容（精确匹配）" maxlength="254" value="${e(form.query)}"${locked() ? ' disabled' : ''}>`)}<div class="jn-toolbar"><button class="btn primary" type="submit"${locked() ? ' disabled' : ''}>搜索</button>${has('crm.customer.write') ? btn('登记新客户', 'register') : ''}</div></div><p class="jn-hint">学号为已备案的真实业务学号；学生系统编号另选。姓名和电话均精确匹配。</p></form><p class="jn-hint">${e(selected)} · 总数按客户去重</p>${table(['客户', '编号', '负责校区', ''], (s.customers?.items || []).map(row => `<tr><td>${e(row.displayName)}</td><td>${e(row.id)}</td><td>${e(row.campusId)}</td><td>${btn('选择客户', 'customer', ` data-id="${e(row.id)}"`, true, s.loading)}</td></tr>`), s.loading ? '正在检索…' : s.error ? '检索未完成，请按上方提示处理。' : s.customers ? '没有符合当前条件的可见客户。' : '选择检索方式后输入条件搜索。')}${pager(s.customers, 'customers-page')}</section>`;
    }
    function requireIdentifiers() {
      required(['crm.customer.read']);
      if (!has('crm.opportunity.intake') && !has('student.read')) throw new Error('当前账号没有查看家庭孩子学号的权限。');
    }
    function requireMaintenance() {
      required(['crm.customer.search.manage']);
      if (actor.scope !== 'all') throw new Error('检索索引维护仅限明确授权的全局管理员。');
    }
    async function loadIdentifiers() {
      requireIdentifiers(); s.identifiers = null; s.refreshed = false; s.review = null;
      await read(() => api.customers.identifiers.list(s.route.customerId, s.route.studentId, s.identifierQuery), result => {
        checkPage(result); if (!version(result.studentVersion) || result.items.some(row => row.studentId !== s.route.studentId || !id(row.id) || !version(row.version))) throw new Error('学号目录回执无效。');
        s.identifiers = result; s.refreshed = true; s.restricted = false;
        if (s.identifierTarget) s.identifierTarget = result.items.find(row => row.id === s.identifierTarget.id && row.active) || null;
      });
    }
    function validIndexStatus(kind, status) {
      const nonnegative = value => Number.isSafeInteger(value) && value >= 0;
      if (!status) return false;
      if (kind === 'name') return ['totalStudents','indexedStudents','pendingStudents','keyVersionCount'].every(key => nonnegative(status[key])) && status.indexVersion === 1 && status.keyVersionCount > 0 && status.indexedStudents + status.pendingStudents === status.totalStudents;
      return ['totalIdentifiers','indexedIdentifiers','pendingIdentifiers','missingSearchable'].every(key => nonnegative(status[key])) && status.indexedIdentifiers + status.pendingIdentifiers === status.totalIdentifiers && status.missingSearchable <= status.pendingIdentifiers;
    }
    async function loadMaintenance() {
      requireMaintenance(); for (const item of Object.values(s.maintenance)) item.status = null;
      await read(() => Promise.all([api.customerSearch.nameIndexStatus(), api.customerSearch.numberIndexStatus()]), results => {
        if (!validIndexStatus('name', results[0]) || !validIndexStatus('number', results[1])) throw new Error('索引状态回执无效，请重试。');
        s.maintenance.name.status = results[0]; s.maintenance.number.status = results[1]; s.restricted = false;
      });
    }
    function identifierHtml() {
      const writable = has('crm.customer.identity.write') && s.refreshed, selected = s.identifierTarget;
      return `<section class="jn-panel"><h2>学号备案</h2><p>客户 ${e(s.route.customerId)} · 学生系统编号 ${e(s.route.studentId)}</p><p class="jn-hint">仅登记真实来源和业务学号。来源与学号保留原文、前导零及大小写，不得填写自动生成的替代号。纠错时先停用旧记录，再另行备案。</p>${s.identifierReceipt ? `<p class="jn-success">已确认${s.identifierReceipt.active ? '备案' : '停用'} · 记录 ${e(s.identifierReceipt.id)} · 版本 ${e(s.identifierReceipt.version)}</p>` : ''}<form data-jn-form="identifier-filter"><div class="jn-grid">${select('备案状态','status',s.identifierQuery.status,[{id:'all',label:'全部'},{id:'active',label:'有效'},{id:'inactive',label:'已停用'}])}<div class="jn-toolbar"><button type="submit" class="btn">筛选</button></div></div></form>${table(['来源','真实学号','状态','版本',''], (s.identifiers?.items || []).map(row => `<tr><td>${e(row.namespace)}</td><td>${e(row.value)}</td><td>${row.active ? '有效' : '已停用'}</td><td>${e(row.version)}</td><td>${writable && row.active ? btn('停用纠错','identifier-deactivate',` data-id="${e(row.id)}"`) : ''}</td></tr>`), s.loading ? '正在读取学号…' : s.error ? '读取未完成，请按上方提示处理。' : '当前范围没有已备案学号，不会自动补号。')}${pager(s.identifiers,'identifiers-page')}</section>${writable ? `<form class="jn-panel" data-jn-form="identifier-create"><h2>新增真实学号</h2><div class="jn-grid">${input('来源系统／学校','namespace',s.identifierDraft.namespace,100,'',true)}${input('真实业务学号','value',s.identifierDraft.value,120,'',true)}</div><div class="jn-actions"><button type="submit" class="btn primary"${locked() || s.loading ? ' disabled' : ''}>核对备案</button></div></form>` : '<p class="jn-notice">当前仅可查看学号；备案需专门的身份维护权限与客户写范围。</p>'}${selected && writable ? `<form class="jn-panel" data-jn-form="identifier-deactivate"><h2>停用前核对</h2><p>${e(selected.namespace)} · ${e(selected.value)}</p><p class="jn-hint">停用后不再通过此学号命中；历史事实保留，不可直接改写来源或号码。</p>${textarea('停用原因','reason',s.identifierDraft.reason,1000,true)}<div class="jn-actions">${btn('取消停用','identifier-cancel')}<button type="submit" class="btn primary">核对停用</button></div></form>` : ''}${reviewHtml()}`;
    }
    function maintenanceHtml() {
      return `<p class="jn-notice">只维护检索索引，不创建或更改学生姓名、业务学号。每批先核对再提交；成功后由员工明确继续下一批，不在后台自动循环。</p>${['name','number'].map(kind => {
        const item = s.maintenance[kind], status = item.status, labels = kind === 'name' ? [['totalStudents','有效学生数'],['indexedStudents','已完成当前索引'],['pendingStudents','待维护学生数'],['keyVersionCount','配置密钥版本数']] : [['totalIdentifiers','有效学号数'],['indexedIdentifiers','已覆盖当前密钥'],['pendingIdentifiers','待维护学号数'],['missingSearchable','缺少可检索索引']];
        return `<form class="jn-panel" data-jn-form="index-${kind}"><h2>${kind === 'name' ? '学生姓名索引' : '业务学号索引'}</h2>${status ? `<dl class="jn-summary-grid">${labels.map(([key,label]) => `<div><dt>${label}</dt><dd>${e(status[key])}</dd></div>`).join('')}</dl>` : '<p>状态尚未读取成功，请刷新核对。</p>'}<p class="jn-hint">当前计数来自服务端${item.receipt ? '最近一次批次回执，刷新可读取最新状态' : '状态查询'}。</p><p>本轮游标：${e(item.afterId)}${item.receipt ? ` · 上批处理 ${e(item.receipt.processed)} 条 · ${item.receipt.hasMore ? '还有后续批次' : '已到本轮末尾'}` : ''}</p><div class="jn-grid">${box('每批上限（1–200）',`<input name="limit" type="number" min="1" max="200" step="1" value="${e(item.limit)}"${locked() || s.loading ? ' disabled' : ''}>`)}</div><div class="jn-actions">${item.receipt && !item.receipt.hasMore ? btn('从头开始新一轮','index-reset',` data-kind="${kind}"`) : `<button class="btn primary" type="submit"${!status || locked() || s.loading ? ' disabled' : ''}>${item.receipt ? '核对下一批' : '核对首批重建'}</button>`}</div></form>`;
      }).join('')}${reviewHtml()}`;
    }
    async function loadCustomer(customerId, preserve = false) {
      required(['crm.customer.read', 'crm.opportunity.intake']);
      if (s.route.customerId && s.route.customerId !== customerId) { s.createdStudent = null; s.orderHistory = null; }
      s.route.customerId = customerId;
      const studentPage = s.students?.page || 1, existingPage = s.existing?.page || 1, orderPage = s.orderHistory?.page || 1;
      s.refreshed = false; s.context = null; s.options = null; s.students = null; s.existing = null; s.orderHistory = null; s.orderHistoryError = '';
      await read(() => Promise.all([api.needs.context(customerId), api.needs.options({ customerId }), api.needs.students(customerId, { page: studentPage, size: 20 }), api.needs.existing(customerId, { page: existingPage, size: 20 }),
        has('crm.order.read') ? api.orders.forCustomer(customerId, { page: orderPage, size: 20 }).catch(error => ({ readError: error.message || '读取失败' })) : Promise.resolve(null)]), results => {
        const [context, options, students, existing, orderHistory] = results;
        if (context?.customer?.id !== customerId || !version(context.customer.version) || !Array.isArray(options?.items) || !version(options.catalogVersion)) throw new Error('客户或需求配置回执无效。');
        s.context = context; s.options = options; s.students = checkPage(students); s.existing = checkPage(existing);
        if (orderHistory?.readError) { s.orderHistory = null; s.orderHistoryError = '历史订单暂时无法读取；其余接待信息已就绪。'; }
        else s.orderHistory = orderHistory ? checkPage(orderHistory) : null;
        if (!preserve) s.draft = { studentChoice: s.route.studentId || '', title: s.route.title || '', subject: s.route.subject || '', term: s.route.term || '', departmentId: '', projectId: '', ...emptyProfile(), detail: '' };
        s.preview = null; s.review = null; s.refreshed = true; s.restricted = false;
      });
    }
    async function loadProfile(preserve = false) {
      required(['crm.opportunity.read']); const opportunityId = s.route.opportunityId;
      const consultationPage = s.consultations?.page || 1;
      s.refreshed = false; s.detail = null; s.options = null; s.consultations = null;
      await read(() => Promise.all([api.needs.get(opportunityId), api.needs.optionsFor(opportunityId), api.needs.consultations(opportunityId, { page: consultationPage, size: 20 })]), results => {
        const [detail, options, consultations] = results;
        if (detail?.opportunity?.id !== opportunityId || !version(detail.opportunity.version) || !Array.isArray(options?.items) || !version(options.catalogVersion)) throw new Error('需求详情回执无效。');
        s.detail = detail; s.options = options; s.consultations = checkPage(consultations);
        if (!preserve) s.draft = { ...emptyProfile(), ...Object.fromEntries(profileFields.map(([key]) => [key, detail.profile?.[key] || ''])), judgmentId: '', reasonId: '', judgmentDetail: '' };
        else for (const [key] of profileFields) if (nullable(s.draft[key]) === nullable(s.profileBaseline?.[key])) s.draft[key] = detail.profile?.[key] || '';
        s.profileBaseline = copy(detail.profile || emptyProfile());
        s.review = null; s.refreshed = true; s.restricted = false;
      });
    }
    async function loadPage(kind, page) {
      if (locked() || !version(Number(page))) return;
      const customerId = s.context?.customer?.id;
      const lookup = { students: () => api.needs.students(customerId, { page: Number(page), size: 20 }), existing: () => api.needs.existing(customerId, { page: Number(page), size: 20 }),
        orderHistory: () => api.orders.forCustomer(customerId, { page: Number(page), size: 20 }), consultations: () => api.needs.consultations(s.route.opportunityId, { page: Number(page), size: 20 }) };
      if (lookup[kind]) await read(lookup[kind], result => { s[kind] = checkPage(result); });
    }
    function profileInput() { return Object.fromEntries(profileFields.map(([key]) => [key, nullable(s.draft[key])])); }
    function profileLabel(key, kind, value) {
      if (!value) return '清空';
      const row = (kind === 'campus' ? s.options?.campuses || [] : opts(kind)).find(item => item.id === value);
      if (row) return row.label || row.name || row.id;
      return value === s.detail?.profile?.[key] ? s.detail.profile[key.replace(/Id$/, 'Name')] || value : value;
    }
    function needInput() {
      if (!s.context || !s.options || !s.draft.studentChoice) throw new Error('请核对客户，并明确选择孩子或“孩子待确认”。');
      if (s.route.studentId && s.draft.studentChoice !== s.route.studentId) throw new Error('来源线索已明确孩子，本次需求必须沿用该孩子。');
      const department = opts('department').find(row => row.id === s.draft.departmentId);
      if (!department || department.projectMode === 'required' && !opts('project').some(row => row.id === s.draft.projectId && row.parentId === department.id)) throw new Error('请选择已配置的意向部门与管理项目。');
      for (const [key, label, max] of [['title', '需求名称', 200], ['subject', '意向学科', 100], ['term', '意向学期', 100], ['detail', '本次咨询内容', 5000]]) {
        if (!s.draft[key]?.trim() || s.draft[key].trim().length > max) throw new Error(`请填写 ${max} 字以内的${label}。`);
      }
      return { customerId: s.context.customer.id, studentId: s.draft.studentChoice === 'unknown' ? null : s.draft.studentChoice,
        sourceLeadId: s.route.sourceLeadId || null, activityId: s.route.activityId || null,
        title: s.draft.title.trim(), subject: s.draft.subject.trim(), term: s.draft.term.trim(),
        identity: { departmentId: department.id, projectId: department.projectMode === 'not_used' ? null : s.draft.projectId },
        profile: profileInput(), detail: s.draft.detail.trim(), ownerId: null };
    }
    async function previewNeed() {
      required(['crm.opportunity.intake', 'crm.customer.read']); const input = needInput();
      await read(() => api.needs.preview(input), result => {
        if (!result || !version(result.catalogVersion) || !version(result.customerVersion) || typeof result.inputHash !== 'string' || !result.inputHash || !Array.isArray(result.candidates) || !Array.isArray(result.allowedActions)) throw new Error('需求核对回执无效，请重新核对。');
        s.preview = { input: copy(input), expectedPreview: copy(result) }; s.decision = { action: result.allowedActions.length === 1 && result.allowedActions[0] === 'create' ? 'create' : '', targetRef: '', reason: '' };
      });
    }
    function begin(kind, body, targetId = null, baseline = null) {
      if (locked()) return;
      s.pending = { kind, body: copy(body), id: targetId, key: newKey(), baseline: copy(baseline), uncertain: false }; return commit();
    }
    function validReceipt(pending, result) {
      const { kind, body, baseline } = pending;
      if (!result) return false;
      if (kind === 'need') {
        const outcomes = { create: 'created', reuse: 'reused', classify_existing: 'classified', create_distinct: 'created_distinct' };
        if (result.outcome !== outcomes[body.decision.action] || !id(result.opportunityId) || !id(result.consultationId) || result.ownerChanged !== false || result.identityStatus !== 'classified' || !['not_required', 'recorded'].includes(result.notificationState)) return false;
        if (body.decision.targetRef && ['reuse', 'classify_existing'].includes(body.decision.action) && result.opportunityId !== body.decision.targetRef) return false;
        const created = ['create', 'create_distinct'].includes(body.decision.action), record = result.opportunity;
        if (result.notificationState !== (created ? 'not_required' : 'recorded')) return false;
        if (!record) return true; // Replay can remove the full projection after current scope changes.
        if (record.id !== result.opportunityId || record.customerId !== body.input.customerId || typeof record.subject !== 'string' || typeof record.term !== 'string'
            || record.subject.trim().toLowerCase() !== body.input.subject.toLowerCase() || record.term.trim().toLowerCase() !== body.input.term.toLowerCase()
            || record.studentId && record.studentId !== body.input.studentId) return false;
        if (created) return record.version === 1 && record.title === body.input.title && record.stage === 'qualified'
          && (record.campusId || null) === (body.expectedPreview.scopeCampusId || null) && record.ownerId === body.expectedPreview.selectedOwnerId;
        const candidate = body.expectedPreview.candidates.find(row => row.targetRef === body.decision.targetRef);
        return candidate && record.version === candidate.version + 1 && (!candidate.readable || record.ownerId === candidate.ownerId && record.stage === candidate.stage);
      }
      if (kind === 'student-intake') return id(result.linkId) && id(result.studentId) && result.name === body.student.name
        && (result.grade || null) === body.student.grade && result.relationship === body.relationship;
      if (kind === 'identifier-create') return id(result.id) && result.studentId === s.route.studentId && result.namespace === body.namespace && result.value === body.value && result.active === true && result.version === 1 && Number.isFinite(Date.parse(result.createdAt)) && result.deactivatedAt == null;
      if (kind === 'identifier-deactivate') return result.id === pending.id && result.studentId === s.route.studentId && result.namespace === baseline.namespace && result.value === baseline.value && result.active === false && result.version === body.expectedVersion + 1 && Number.isFinite(Date.parse(result.deactivatedAt));
      if (kind === 'index-name' || kind === 'index-number') return Number.isSafeInteger(result.processed) && result.processed >= 0 && result.processed <= body.limit && Number.isSafeInteger(result.nextAfterId) && result.nextAfterId >= body.afterId && typeof result.hasMore === 'boolean' && (!result.hasMore || result.processed > 0 && result.nextAfterId > body.afterId) && validIndexStatus(kind.slice(6), result.status);
      if (kind === 'assignment') return result.opportunityId === pending.id && result.ownerId === body.ownerId && result.version === body.expectedVersion + 1 && ['visible', 'left_scope'].includes(result.scopeStatus);
      if (kind === 'profile' || kind === 'judgment') {
        if (result.opportunity?.id !== pending.id || result.opportunity.version !== body.expectedVersion + 1 || result.opportunity.customerId !== baseline.opportunity.customerId || result.opportunity.ownerId !== baseline.opportunity.ownerId || result.opportunity.subject !== baseline.opportunity.subject || result.opportunity.term !== baseline.opportunity.term) return false;
        if (kind === 'profile') return profileFields.every(([key]) => (result.profile?.[key] || null) === body.profile[key]) && result.opportunity.nextFollowAt === baseline.opportunity.nextFollowAt && result.opportunity.stage === baseline.opportunity.stage;
        return result.judgment?.judgmentId === body.judgmentId && (result.judgment.reasonId || null) === body.reasonId && result.judgment.detail === body.detail && (result.judgment.effect !== 'close' || result.opportunity.stage === 'closed' && result.opportunity.nextFollowAt == null);
      }
      if (kind === 'config-create' || kind === 'config-update') return id(result.item?.id) && version(result.catalogVersion) && result.item.label === body.label && (kind === 'config-create' ? result.item.kind === body.kind && result.item.code === body.code && result.item.active === true && result.item.version === 1 : result.item.id === pending.id && result.item.active === body.active && result.item.version === body.expectedVersion + 1);
      if (kind === 'notification') return result.id === pending.id && result.version === body.expectedVersion + 1 && typeof result.readAt === 'string' && Number.isFinite(Date.parse(result.readAt));
      if (kind === 'customer') return id(result.id) && result.displayName === body.displayName && result.campusId === body.campusId && version(result.version);
      return false;
    }
    async function commit() {
      const pending = s.pending; if (!pending || s.writing) return;
      const token = generation; s.writing = true; s.error = ''; draw();
      const calls = { 'identifier-create': () => api.customers.identifiers.create(s.route.customerId,s.route.studentId,pending.body,pending.key), 'identifier-deactivate': () => api.customers.identifiers.deactivate(s.route.customerId,s.route.studentId,pending.id,pending.body,pending.key), 'index-name': () => api.customerSearch.rebuildNameIndex(pending.body,pending.key), 'index-number': () => api.customerSearch.rebuildNumberIndex(pending.body,pending.key), 'student-intake': () => api.customers.createAndLinkStudent(pending.id,pending.body,pending.key), need: () => api.needs.commitPreview(pending.body, pending.key), profile: () => api.needs.updateProfile(pending.id, pending.body, pending.key), judgment: () => api.needs.judge(pending.id, pending.body, pending.key), assignment: () => api.needs.assign(pending.id, pending.body, pending.key), 'config-create': () => api.needConfig.create(pending.body, pending.key), 'config-update': () => api.needConfig.update(pending.id, pending.body, pending.key), notification: () => api.needNotifications.markRead(pending.id, pending.body, pending.key), customer: () => api.customers.create(pending.body, pending.key) };
      let result;
      try { result = await calls[pending.kind](); if (!still(token)) return; if (!validReceipt(pending, result)) throw new Error('未收到与本次操作一致的成功回执，请用原请求重试确认。'); }
      catch (error) {
        if (!still(token)) return;
        if ([401, 403, 404].includes(error.status) || ['FORBIDDEN', 'NOT_FOUND', 'UNAUTHORIZED'].includes(error.code)) restrictProjection();
        const definitelyNotWritten = ['identifier-create','index-name','index-number'].includes(pending.kind) && error.status === 503 && error.code === 'SEARCH_INDEX_NOT_READY';
        if (definitelyNotWritten || !pending.uncertain && Number.isInteger(error.status) && error.status >= 400 && error.status < 500 && rejectedCodes.has(error.code)) {
          s.pending = null; s.preview = null; s.review = null; s.refreshed = false;
          if (['FORBIDDEN', 'NOT_FOUND', 'UNAUTHORIZED'].includes(error.code)) { s.context = null; s.detail = null; s.students = null; s.existing = null; s.options = null; }
        } else pending.uncertain = true;
        s.error = error.message || '提交结果尚未确认。'; s.writing = false; draw(); return;
      }
      if (!still(token)) return;
      s.pending = null; s.writing = false; s.dirty = false; s.review = null; s.notice = '已保存。'; s.restricted = false;
      if (pending.kind === 'need') { s.receipt = result; s.preview = null; s.refreshed = !!result.opportunity; s.notice = ['created', 'created_distinct'].includes(result.outcome) ? '需求已建立。可继续分配负责人，分配失败无需重复创建。' : '本次咨询已保存，保留原需求及原负责人。'; if (['created', 'created_distinct'].includes(result.outcome) && result.opportunity && has('crm.opportunity.assign')) await loadAssignees(1); }
      else if (pending.kind === 'assignment') { s.assignmentReceipt = result; s.assignment = { ownerId: '', reason: '' }; s.notice = result.scopeStatus === 'left_scope' ? '分配已成功，该商机已离开当前查看范围。' : '负责人已分配。'; if (result.scopeStatus === 'left_scope') restrictProjection(); else { if (s.detail) s.detail.opportunity = { ...s.detail.opportunity, ownerId: result.ownerId, version: result.version }; if (s.receipt?.opportunity) s.receipt.opportunity = { ...s.receipt.opportunity, ownerId: result.ownerId, version: result.version }; } }
      else if (['profile', 'judgment'].includes(pending.kind)) {
        s.detail = result; s.refreshed = true; s.profileBaseline = copy(result.profile || emptyProfile());
        if (pending.kind === 'profile') for (const [key] of profileFields) s.draft[key] = result.profile?.[key] || '';
        else Object.assign(s.draft, { judgmentId: '', reasonId: '', judgmentDetail: '' });
        s.notice = pending.kind === 'judgment' ? '商机判定已记录。' : '需求资料已保存。';
      }
      else if (pending.kind === 'identifier-create' || pending.kind === 'identifier-deactivate') { s.identifierReceipt = result; s.identifierTarget = null; s.identifierDraft = { namespace: '', value: '', reason: '' }; s.notice = '学号办理已确认。'; await loadIdentifiers(); }
      else if (pending.kind === 'student-intake') {
        s.createdStudent = { id: result.studentId, name: result.name, grade: result.grade, relationship: result.relationship };
        s.draft.studentChoice = result.studentId; s.studentIntakeOpen = false;
        s.studentIntakeDraft = { name: '', grade: '', phone: '', relationship: 'child' };
        s.dirty = true; s.notice = '孩子已建立并关联到当前家庭，已选为本次需求对象。';
      }
      else if (pending.kind === 'index-name' || pending.kind === 'index-number') { const item = s.maintenance[pending.kind.slice(6)]; item.status = result.status; item.receipt = result; item.afterId = result.nextAfterId; s.notice = '本批索引维护已确认。请核对回执后继续，或刷新查看当前状态。'; }
      else if (pending.kind.startsWith('config-')) { s.configDraft = null; await loadConfig(); }
      else if (pending.kind === 'notification') { s.notice = '提醒已标为已读。'; await loadNotifications(); }
      else if (pending.kind === 'customer') { s.registering = false; s.route.customerId = result.id; await loadCustomer(result.id); s.notice = '客户已登记，请核对孩子与购买需求。'; }
      draw();
    }
    async function loadAssignees(page = 1) {
      required(['crm.opportunity.assign']); const opportunityId = s.detail?.opportunity.id || s.receipt?.opportunityId;
      await read(() => api.needs.assignees({ opportunityId, page, size: 20 }), result => { s.assignees = checkPage(result); });
    }
    async function loadConfig() {
      required(['crm.opportunity.config.manage']);
      await read(() => api.needConfig.list(s.configQuery), result => { s.config = checkPage(result); s.restricted = false; });
    }
    async function loadParents(page = 1) {
      const kind = { project: 'department', quarter: 'fiscal_year', judgment_reason: 'judgment' }[s.configDraft?.kind];
      if (!kind) { s.parents = null; return; }
      await read(() => api.needConfig.list({ kind, status: 'active', page, size: 20 }), result => { s.parents = checkPage(result); });
    }
    async function loadNotifications() {
      required(['crm.opportunity.read']);
      await read(() => api.needNotifications.list(s.notificationQuery), result => { s.notifications = checkPage(result); s.restricted = false; });
    }
    function profileGrid(profile = s.draft) {
      return profileFields.map(([key, label, kind]) => {
        let rows = kind === 'campus' ? s.options?.campuses || [] : opts(kind);
        if (kind === 'quarter') rows = rows.filter(row => !row.parentId || row.parentId === profile.fiscalYearId);
        return select(label, key, profile[key], rows, { historical: s.detail?.profile?.[key.replace(/Id$/, 'Name')] });
      }).join('');
    }
    function summary() {
      const record = s.detail?.opportunity || s.receipt?.opportunity, customer = s.context?.customer;
      const student = s.students?.items?.find(row => row.id === s.draft.studentChoice);
      const facts = [['客户', customer?.displayName || record?.customerId || '待选择'], ['孩子', student?.name || (s.draft.studentChoice === 'unknown' ? '孩子待确认' : s.draft.studentChoice || record?.studentId || '待核对')], ['负责校区', customer?.campusId || record?.campusId || '待核对'], ['当前负责人', record?.ownerId || '新建后核对与分配']];
      return `<section class="jn-summary"><div class="jn-heading"><div><h1>${e({ intake: '前台接待 · 购买需求', profile: '商机需求资料', configuration: '需求配置', notifications: '站内提醒', identifiers: '真实学号备案', searchMaintenance: '客户检索维护' }[s.mode])}</h1><p class="jn-hint">${e(s.mode === 'intake' ? '核对客户和已有需求后办理；不同学科分别建立商机。' : s.mode === 'profile' ? '资料、判定和分派分别核对保存。财年、季度、学期各自独立。' : s.mode === 'configuration' ? '配置思跃实际使用的选项，停用保留历史记录。' : s.mode === 'identifiers' ? '按家庭孩子核对真实身份编号，来源与号码不可覆盖。' : s.mode === 'searchMaintenance' ? '仅全局授权管理员可手动分批维护检索索引。' : '仅显示发给本账号的提醒，按当前商机权限展示。')}</p></div><div class="jn-toolbar">${btn('返回', 'back')}${btn('刷新核对', 'refresh', '', false, s.loading)}</div></div>${!s.restricted && ['intake', 'profile'].includes(s.mode) ? `<dl class="jn-summary-grid">${facts.map(([label, value]) => `<div><dt>${e(label)}</dt><dd>${e(value)}</dd></div>`).join('')}</dl>` : ''}</section>`;
    }
    function candidates(data, preview = false) {
      return table(['需求', '孩子', '部门／项目', '学科／学期', '负责人／阶段', '核对结果', ''], (data?.items || data?.candidates || []).map(row => `<tr><td>${e(row.title)}<p class="jn-hint">${e(row.targetRef)}</p></td><td>${e(row.studentVisibility === 'restricted' ? '孩子资料当前不可确认' : s.students?.items?.find(student => student.id === row.studentId)?.name || row.studentId || '孩子待确认')}</td><td>${e(row.identityStatus === 'legacy_unknown' ? '历史需求身份待核对' : [row.identity?.departmentName, row.identity?.projectName || (row.identity?.projectMode === 'not_used' ? '项目不适用' : '')].filter(Boolean).join('／'))}</td><td>${e(row.subject)}／${e(row.term)}</td><td>${e(row.readable ? `${row.ownerId || '待分配'}／${stages[row.stage] || row.stage || '—'}` : '当前仅可接待追加咨询')}</td><td>${e({ exact: '同一在途需求', legacy_unknown: '需显式识别', different_need: '不同需求' }[row.match] || '已有记录')}</td><td>${row.readable ? btn('查看需求', 'open-candidate', ` data-id="${e(row.targetRef)}"`) : ''}</td></tr>`), preview ? '没有匹配候选，请按服务端允许的动作办理。' : '当前客户范围暂无已有需求');
    }
    function customerOrderHistory() {
      if (!has('crm.order.read')) return '';
      const status = { pending: '待收款', partially_received: '部分收款', received: '已收款', cancelled: '已取消' };
      return `<section class="jn-panel"><h2>历史订单</h2><p class="jn-hint">仅列出当前账号同时有客户读取和订单读取权限的记录；订单成交归属不随当前负责人变化。</p>${table(['订单', '孩子', '商品快照', '应收／实收／退款', '状态'], (s.orderHistory?.items || []).map(row => {
        const child = s.students?.items?.find(student => student.id === row.studentId) || s.createdStudent?.id === row.studentId && s.createdStudent;
        return `<tr><td>${e(row.id)}<p class="jn-hint">关联商机 ${e(row.opportunityId)}</p></td><td>${e(row.studentId ? child?.name || '孩子资料当前不可确认' : '未关联孩子')}</td><td>${e(row.productSnapshot)}</td><td>${e(row.totalAmount)}／${e(row.receivedAmount)}／${e(row.refundedAmount)}</td><td>${e(status[row.status] || row.status)}</td></tr>`;
      }), s.orderHistoryError || (s.loading ? '正在读取历史订单…' : '当前范围内暂无历史订单'))}${pager(s.orderHistory, 'orderHistory-page')}</section>`;
    }
    function intakeHtml() {
      if (s.receipt) return receiptHtml();
      if (s.registering) return customerForm();
      if (!s.context) return customerSearchHtml();
      const department = opts('department').find(row => row.id === s.draft.departmentId);
      const childRowsSource = [...(s.students?.items || [])];
      if (s.createdStudent && !childRowsSource.some(row => row.id === s.createdStudent.id)) childRowsSource.push(s.createdStudent);
      const child = childRowsSource.find(row => row.id === s.draft.studentChoice);
      const selectedChild = s.draft.studentChoice && s.draft.studentChoice !== 'unknown' && !child ? `<p class="jn-notice">已选择孩子 ${e(s.draft.studentChoice)}，不在当前分页；提交时服务端重新核对家庭关系。</p>` : '';
      const childRows = childRowsSource.map(row => `<label class="jn-choice"><input type="radio" name="studentChoice" value="${e(row.id)}"${s.draft.studentChoice === row.id ? ' checked' : ''}${s.route.studentId || locked() || s.loading ? ' disabled' : ''}><span>${e(row.name)} · ${e(row.grade || '年级未登记')}<p class="jn-hint">${e(row.id)} · ${e(row.relationship)}</p></span></label>`).join('');
      const canCreateChild = has('crm.customer.write') && has('student.write') && !s.route.studentId;
      const studentIntakeForm = s.studentIntakeOpen ? `<form class="jn-panel" data-jn-form="student-intake"><h2>新增家庭孩子</h2><div class="jn-grid">${input('学生姓名', 'name', s.studentIntakeDraft.name, 100, '', true)}${input('年级', 'grade', s.studentIntakeDraft.grade, 40)}${input('联系电话（可选）', 'phone', s.studentIntakeDraft.phone, 32)}${select('与家庭关系', 'relationship', s.studentIntakeDraft.relationship, [{ id: 'child', label: '子女' }, { id: 'ward', label: '监护对象' }, { id: 'self', label: '本人' }, { id: 'other', label: '其他' }], { requiredValue: true })}</div><div class="jn-actions">${btn('取消', 'student-intake-cancel')}<button type="submit" class="btn primary"${locked() || s.loading ? ' disabled' : ''}>创建并关联到当前家庭</button></div></form>` : '';
      return `<ol class="jn-steps"><li>1. 客户资料</li><li>2. 已有需求</li><li aria-current="step">3. 本次需求核对</li><li>4. 保存与分派</li></ol><section class="jn-panel"><h2>客户资料核对</h2><div class="jn-grid">${(s.context.contacts || []).map(row => `<div><strong>${e({ guardian: '监护人', student: '学生', other: '其他' }[row.personRole] || row.personRole)}</strong><p>${e(row.valueMasked)}${row.primary ? ' · 主联系方式' : ''}</p></div>`).join('') || '<p class="jn-hint">当前未登记可展示的联系方式。</p>'}</div>${canCreateChild ? `<div class="jn-actions">${btn(s.studentIntakeOpen ? '收起新增孩子' : '新增家庭孩子', 'student-intake-toggle')}</div>` : ''}</section>${studentIntakeForm}<section class="jn-panel"><h2>已有需求</h2>${candidates(s.existing)}${pager(s.existing, 'existing-page')}</section>${customerOrderHistory()}<form data-jn-form="need"><section class="jn-panel"><h2>本次购买需求</h2><fieldset${locked() || s.loading ? ' disabled' : ''}><legend>明确本次咨询的孩子</legend><div class="jn-grid">${childRows}<label class="jn-choice"><input type="radio" name="studentChoice" value="unknown"${s.draft.studentChoice === 'unknown' ? ' checked' : ''}${s.route.studentId ? ' disabled' : ''}><span>孩子待确认<p class="jn-hint">不从家庭第一名孩子推断身份。</p></span></label></div>${selectedChild}${pager(s.students, 'students-page')}<p class="jn-hint">显示此家庭已关联孩子，包含未报名孩子；孩子身份不明确时可选“孩子待确认”。</p></fieldset>${s.draft.studentChoice && s.draft.studentChoice !== 'unknown' ? `<div class="jn-toolbar">${btn('查看／备案真实学号','open-identifiers')}</div>` : ''}<div class="jn-grid">${select('意向部门', 'departmentId', s.draft.departmentId, opts('department'), { requiredValue: true })}${select('管理项目', 'projectId', s.draft.projectId, opts('project').filter(row => row.parentId === s.draft.departmentId), { requiredValue: department?.projectMode === 'required', disabled: department?.projectMode === 'not_used', hint: department?.projectMode === 'not_used' ? '该部门已配置为项目不适用。' : '' })}${input('意向学科', 'subject', s.draft.subject, 100, '', true)}${input('意向学期', 'term', s.draft.term, 100, '', true)}${input('需求名称', 'title', s.draft.title, 200, 'jn-wide', true)}${profileGrid()}${textarea('本次咨询内容', 'detail', s.draft.detail, 5000, true)}</div>${!opts('department').length ? `<p class="jn-notice">尚未配置可用的意向部门，请先由有权限的员工维护需求配置。</p>` : ''}<div class="jn-actions"><button type="submit" class="btn primary"${locked() || s.loading || !opts('department').length ? ' disabled' : ''}>核对重复需求与差异</button></div></section></form>${s.preview ? previewHtml() : ''}`;
    }
    function differenceValue(field, value) {
      if (value == null) return '未提供／当前不可见';
      if (field !== 'profile') return String(value);
      let profile;
      try { profile = typeof value === 'string' ? JSON.parse(value) : value; }
      catch { return '资料差异无法显示，请重新核对。'; }
      if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return '未登记资料';
      return profileFields.map(([key, label, kind]) => `${label}：${profile[key.replace(/Id$/, 'Name')] || (profile[key] ? profileLabel(key, kind, profile[key]) : '未填写')}`).join('；');
    }
    function previewHtml() {
      const preview = s.preview.expectedPreview;
      const targetRows = preview.candidates.filter(row => s.decision.action === 'reuse' ? row.match === 'exact' : s.decision.action === 'classify_existing' ? row.match === 'legacy_unknown' : false);
      return `<section class="jn-panel"><h2>提交前核对</h2><p class="jn-hint">配置版本 ${e(preview.catalogVersion)}；资料或范围变化后必须重新核对。</p>${candidates(preview, true)}${preview.differences?.length ? table(['候选', '字段', '本次填写', '现有资料'], preview.differences.map(row => `<tr><td>${e(row.targetRef)}</td><td>${e(({ title: '需求名称', profile: '需求资料' })[row.field] || row.field)}</td><td>${e(differenceValue(row.field, row.requested))}</td><td>${e(differenceValue(row.field, row.current))}</td></tr>`)) : ''}<form data-jn-form="decision"><div class="jn-grid">${select('本次办理方式', 'action', s.decision.action, preview.allowedActions.map(value => ({ id: value, label: actions[value] || value })), { requiredValue: true })}${targetRows.length ? select('核对的原需求', 'targetRef', s.decision.targetRef, targetRows.map(row => ({ id: row.targetRef, label: `${row.title} · ${row.targetRef}` })), { requiredValue: true }) : ''}${['classify_existing', 'create_distinct'].includes(s.decision.action) ? textarea('识别／区分依据', 'reason', s.decision.reason, 1000, true) : ''}</div><p class="jn-notice">追加咨询保留原负责人、原资料及回访安排；历史未知身份需明确识别，不能自动并入新需求。</p><div class="jn-actions"><button class="btn primary" type="submit"${locked() || !s.decision.action ? ' disabled' : ''}>确认办理</button></div></form></section>`;
    }
    function assignmentHtml() {
      const record = s.detail?.opportunity || s.receipt?.opportunity;
      if (!has('crm.opportunity.assign') || s.assignmentReceipt?.scopeStatus === 'left_scope') return '';
      if (!s.assignees) return `<section class="jn-panel"><h2>分派负责人</h2>${btn('查询可分派员工', 'assignees', '', false, !record)}</section>`;
      return `<section class="jn-panel"><h2>分派负责人</h2><p>当前负责人：${e(record?.ownerId || '当前不可见')}</p><form data-jn-form="assignment"><div class="jn-grid">${select('新的负责人', 'ownerId', s.assignment.ownerId, s.assignees.items, { requiredValue: true, historical: s.assignment.ownerId })}${textarea('分派原因', 'reason', s.assignment.reason, 1000, true)}</div>${pager(s.assignees, 'assignees-page')}<p class="jn-hint">候选来自此商机可接收范围。本次仅转交负责人，不修改历史订单归属。</p><div class="jn-actions"><button class="btn primary" type="submit"${locked() || !record || !s.refreshed ? ' disabled' : ''}>核对分派</button></div></form></section>`;
    }
    function receiptHtml() {
      const receipt = s.receipt;
      return `<section class="jn-panel"><h2>${e({ created: '新需求已建立', created_distinct: '独立新需求已建立', reused: '咨询已追加至原需求', classified: '历史需求已明确识别' }[receipt.outcome])}</h2><p>商机编号：${e(receipt.opportunityId)}</p><p>本次咨询编号：${e(receipt.consultationId)}</p><p>${receipt.notificationState === 'recorded' ? '已记录发给原负责人的站内提醒。' : '本次无需发送重复咨询提醒。'}</p>${receipt.opportunity && s.assignmentReceipt?.scopeStatus !== 'left_scope' ? btn('进入商机跟进', 'open-receipt', '', true) : '<p class="jn-hint">已确认办理成功；当前权限不提供完整商机详情。</p>'}</section>${['created', 'created_distinct'].includes(receipt.outcome) ? assignmentHtml() : '<p class="jn-notice">已保留原负责人，本次接待不自动转派。</p>'}${reviewHtml()}`;
    }
    function profileHtml() {
      const detail = s.detail;
      if (!detail) return '<section class="jn-panel"><p>需求详情当前不可用，请刷新核对。</p></section>';
      const writable = has('crm.opportunity.write') && s.refreshed;
      const identityView = detail.identity || {};
      const judgments = opts('judgment'), current = judgments.find(row => row.id === s.draft.judgmentId);
      return `<section class="jn-panel"><h2>需求身份</h2><dl class="jn-summary-grid">${[['意向部门', identityView.departmentName], ['管理项目', identityView.projectName || (identityView.projectMode === 'not_used' ? '不适用' : '')], ['意向学科', detail.opportunity.subject], ['意向学期', detail.opportunity.term]].map(([label, value]) => `<div><dt>${e(label)}</dt><dd>${e(value || '历史未明确')}</dd></div>`).join('')}</dl><p class="jn-hint">部门、项目、孩子、学科和学期确定后不在资料表中改写；其他购买需求请重新接待核对。</p>${detail.identityStatus === 'legacy_unknown' && has('crm.opportunity.intake') && has('crm.customer.read') ? btn('进入接待核对历史身份', 'classify') : ''}</section><form data-jn-form="profile" class="jn-panel"><h2>需求资料</h2><fieldset${locked() || !writable ? ' disabled' : ''}><div class="jn-grid">${profileGrid()}</div><div class="jn-actions"><button class="btn primary" type="submit">核对资料变更</button></div></fieldset></form><form data-jn-form="judgment" class="jn-panel"><h2>商机判定</h2><p class="jn-hint">判定和资料保存分别办理。关闭判定会关闭商机并取消回访；判定不会记为成交。</p><fieldset${locked() || !writable ? ' disabled' : ''}><div class="jn-grid">${select('商机判定', 'judgmentId', s.draft.judgmentId, judgments, { requiredValue: true })}${select('判定原因', 'reasonId', s.draft.reasonId, opts('judgment_reason').filter(row => row.parentId === s.draft.judgmentId))}${textarea('判定说明', 'judgmentDetail', s.draft.judgmentDetail, 1000, true)}</div>${current?.effect === 'close' ? '<p class="jn-notice">本次将关闭商机，并取消现有回访安排。</p>' : ''}<div class="jn-actions"><button class="btn primary" type="submit"${!judgments.length ? ' disabled' : ''}>核对判定</button></div></fieldset></form>${assignmentHtml()}${reviewHtml()}<section class="jn-panel"><h2>接待咨询记录</h2>${table(['时间', '接待员工', '本次咨询'], (s.consultations?.items || []).map(row => `<tr><td>${e(row.createdAt)}</td><td>${e(row.actorId)}</td><td>${e(row.detail)}</td></tr>`))}${pager(s.consultations, 'consultations-page')}</section>`;
    }
    function reviewHtml() {
      if (!s.review) return '';
      const labels = { profile: '保存以下需求资料', judgment: '记录以下商机判定', assignment: '确认负责人交接', 'config-create': '新增配置', 'config-update': '更新配置', customer: '登记客户', 'identifier-create': '登记真实学号', 'identifier-deactivate': '停用学号', 'index-name': '学生姓名索引重建', 'index-number': '业务学号索引重建' };
      return `<section class="jn-panel"><h2>提交前核对 · ${e(labels[s.review.kind])}</h2><dl class="jn-summary-grid">${s.review.summary.map(([label, value]) => `<div><dt>${e(label)}</dt><dd>${e(value || '未填写／清空')}</dd></div>`).join('')}</dl><div class="jn-actions">${btn('返回修改', 'cancel-review')}${btn('确认保存', 'commit-review', '', true)}</div></section>`;
    }
    function campusChoices() { return (actor.campusIds || []).map(value => ({ id: value, label: value })); }
    function customerForm() {
      const campuses = campusChoices();
      return `<form class="jn-panel" data-jn-form="customer-create"><h2>登记客户</h2><p class="jn-hint">负责校区使用账号明确授权的校区编号。登记后可选择孩子待确认，不自动创建学生档案。</p><div class="jn-grid">${input('客户名称', 'displayName', s.draft.displayName, 120, '', true)}${select('负责校区', 'campusId', s.draft.campusId, campuses, { requiredValue: true })}${input('监护人联系电话（可选）', 'phone', s.draft.phone, 100)}</div>${!campuses.length ? '<p class="jn-notice">当前账号未提供可选负责校区目录，暂不能在此登记新客户。请由已明确校区的员工登记。</p>' : ''}<div class="jn-actions">${btn('返回检索', 'cancel-register')}<button class="btn primary" type="submit"${!campuses.length || locked() ? ' disabled' : ''}>核对客户登记</button></div></form>${reviewHtml()}`;
    }
    function configurationHtml() {
      const form = s.configDraft, editing = !!form?.id;
      const needsParent = form && ['project', 'quarter', 'judgment_reason'].includes(form.kind);
      const parentRows = s.parents?.items || [];
      return `<section class="jn-panel"><form data-jn-form="config-filter"><div class="jn-grid">${select('配置分类', 'kind', s.configQuery.kind, Object.entries(kinds).map(([value, label]) => ({ id: value, label })))}${select('状态', 'status', s.configQuery.status, [{ id: 'all', label: '全部' }, { id: 'active', label: '使用中' }, { id: 'inactive', label: '已停用' }])}<div class="jn-toolbar"><button class="btn" type="submit">筛选</button>${btn('新增配置', 'config-new', '', true)}</div></div></form>${table(['分类', '名称', '代码', '适用范围', '状态', ''], (s.config?.items || []).map(row => `<tr><td>${e(kinds[row.kind] || row.kind)}</td><td>${e(row.label)}</td><td>${e(row.code)}</td><td>${e(row.campusId || '全局')}</td><td>${row.active ? '使用中' : '已停用'}</td><td>${btn('编辑／停用', 'config-edit', ` data-id="${e(row.id)}"`)}</td></tr>`), s.loading ? '正在读取配置…' : '当前范围尚未配置选项')}${pager(s.config, 'config-page')}</section>${form ? `<form data-jn-form="config" class="jn-panel"><h2>${editing ? '编辑配置' : '新增配置'}</h2><div class="jn-grid">${editing ? `<div><p>${e(kinds[form.kind])} · ${e(form.code)}</p><p class="jn-hint">稳定含义、父项和适用范围不能改写。</p></div>` : select('配置分类', 'kind', form.kind, Object.entries(kinds).map(([value, label]) => ({ id: value, label })), { requiredValue: true })}${!editing ? input('稳定代码', 'code', form.code, 60, '', true) : ''}${input('显示名称', 'label', form.label, 100, '', true)}${!editing ? select('适用校区', 'campusId', form.campusId, campusChoices(), { requiredValue: actor.scope !== 'all', hint: actor.scope === 'all' ? '留空为全局配置；校区选择仅来自当前账号明确校区。' : '仅可维护当前账号所属校区。' }) : select('状态', 'active', String(form.active), [{ id: 'true', label: '使用中' }, { id: 'false', label: '停用，保留历史' }])}${!editing && needsParent ? select('上级配置', 'parentId', form.parentId, parentRows, { requiredValue: form.kind !== 'quarter', historical: form.parentId, hint: form.kind === 'quarter' ? '季度可关联财年，也可留空为通用季度。' : '请选择对应的有效父项。' }) : ''}${!editing && form.kind === 'department' ? select('该部门是否使用项目', 'projectMode', form.projectMode, [{ id: 'required', label: '需要管理项目' }, { id: 'not_used', label: '项目不适用' }], { requiredValue: true }) : ''}${!editing && form.kind === 'judgment' ? select('判定效果', 'effect', form.effect, [{ id: 'continue', label: '仅记录判定，继续跟进' }, { id: 'close', label: '关闭商机并取消回访' }], { requiredValue: true }) : ''}</div>${!editing && needsParent ? pager(s.parents, 'parents-page') : ''}<div class="jn-actions">${btn('取消编辑', 'config-cancel')}<button class="btn primary" type="submit"${locked() ? ' disabled' : ''}>核对配置</button></div></form>` : ''}${reviewHtml()}`;
    }
    function notificationsHtml() {
      return `<section class="jn-panel"><form data-jn-form="notification-filter"><div class="jn-grid">${select('提醒状态', 'status', s.notificationQuery.status, [{ id: 'unread', label: '未读' }, { id: 'read', label: '已读' }, { id: 'all', label: '全部' }])}<div class="jn-toolbar"><button class="btn" type="submit">筛选</button></div></div></form>${table(['时间', '内容', '状态', ''], (s.notifications?.items || []).map(row => `<tr><td>${e(row.createdAt)}</td><td>${row.visibility === 'restricted' ? '相关需求已不在当前范围' : `客户有新的咨询 · ${e(row.opportunityId)}`}</td><td>${row.readAt ? '已读' : '未读'}</td><td>${row.visibility === 'visible' && row.opportunityId ? btn('查看需求', 'notification-open', ` data-id="${e(row.id)}"`) : ''}${!row.readAt ? btn('标为已读', 'notification-read', ` data-id="${e(row.id)}"`) : ''}</td></tr>`))}${pager(s.notifications, 'notifications-page')}</section>`;
    }
    function html() {
      const notices = `${s.loading ? '<p class="jn-notice" role="status">正在读取并核对当前权限…</p>' : ''}${s.error ? `<p class="jn-error" role="alert">${e(s.error)}</p>` : ''}${s.notice ? `<p class="jn-success" role="status">${e(s.notice)}</p>` : ''}${s.pending?.uncertain ? `<section class="jn-notice"><p>提交结果尚未确认。请保留此页，用原请求重试；内容及请求编号已锁定。</p>${btn('用原请求重试确认', 'retry', '', true, s.writing)}</section>` : ''}`;
      const restricted = `<section class="jn-panel"><p>原资料已隐藏，请刷新重新核对当前权限。未确认的提交仍保留原请求，不能另建或改写重试。</p>${s.assignmentReceipt ? `<p>分派回执：商机 ${e(s.assignmentReceipt.opportunityId)} · 负责人 ${e(s.assignmentReceipt.ownerId)} · 版本 ${e(s.assignmentReceipt.version)}</p>` : ''}</section>`;
      return `<div class="java-crm-needs" data-jn-root>${summary()}${notices}${s.restricted ? restricted : s.mode === 'identifiers' ? identifierHtml() : s.mode === 'searchMaintenance' ? maintenanceHtml() : s.mode === 'configuration' ? configurationHtml() : s.mode === 'notifications' ? notificationsHtml() : s.mode === 'profile' ? profileHtml() : intakeHtml()}</div>`;
    }
    async function submit(form) {
      if (locked() || s.restricted || s.loading && form.dataset.jnForm !== 'search') return; capture(form); const values = formValues(form), type = form.dataset.jnForm;
      if (type === 'search') return searchCustomers(1, values.query || '', values.searchType || s.customerSearchType);
      if (type === 'need') return previewNeed();
      if (type === 'student-intake') {
        required(['crm.customer.write', 'student.write', 'crm.opportunity.intake']);
        const student = { name: (values.name || '').trim(), grade: nullable(values.grade), phone: nullable(values.phone) };
        const relationship = values.relationship || '';
        if (!s.context?.customer?.id || !student.name || student.name.length > 100 || student.grade && student.grade.length > 40
            || student.phone && !/^\+?[0-9 ()-]{7,32}$/.test(student.phone)
            || !['child', 'ward', 'self', 'other'].includes(relationship)) throw new Error('请填写有效的学生姓名、联系方式和家庭关系。');
        return begin('student-intake', { student, relationship }, s.context.customer.id);
      }
      if (type === 'decision') {
        if (!s.preview) throw new Error('请先核对需求。');
        const decision = { action: s.decision.action, targetRef: nullable(s.decision.targetRef), reason: nullable(s.decision.reason) };
        if (!s.preview.expectedPreview.allowedActions.includes(decision.action)) throw new Error('请选择服务端允许的办理方式。');
        if (['reuse', 'classify_existing'].includes(decision.action) && !s.preview.expectedPreview.candidates.some(row => row.targetRef === decision.targetRef && row.match === (decision.action === 'reuse' ? 'exact' : 'legacy_unknown'))) throw new Error('请选择本次核对的原需求。');
        if (['create', 'create_distinct'].includes(decision.action)) { required(['crm.opportunity.write']); decision.targetRef = null; }
        if (['classify_existing', 'create_distinct'].includes(decision.action) && (!decision.reason || decision.reason.length > 1000)) throw new Error('请填写识别或区分依据。');
        return begin('need', { ...s.preview, decision });
      }
      if (type === 'identifier-filter') { s.identifierQuery = { status: values.status || 'all', page: 1, size: 20 }; return loadIdentifiers(); }
      if (type === 'identifier-create' || type === 'identifier-deactivate') {
        requireIdentifiers(); required(['crm.customer.identity.write']);
        if (!s.identifiers || !s.refreshed) throw new Error('请刷新学号资料后核对。');
        if (type === 'identifier-create') {
          const { namespace, value } = s.identifierDraft;
          if (![namespace,value].every(text => typeof text === 'string' && text.length > 0 && text === text.trim() && !/[\u0000-\u001F\u007F]/.test(text)) || namespace.length > 100 || value.length > 120) throw new Error('来源和学号须保留真实原文，不接受首尾空白或控制字符；来源最多100字、学号最多120字。');
          s.review = { kind: type, body: { namespace, value, expectedStudentVersion: s.identifiers.studentVersion }, summary: [['学生系统编号',s.route.studentId],['来源',namespace],['真实学号',value]] };
        } else {
          const target = s.identifierTarget, reason = s.identifierDraft.reason.trim();
          if (!target?.active || !reason || reason.length > 1000) throw new Error('请选择有效备案并填写1000字以内的停用原因。');
          s.review = { kind: type, id: target.id, baseline: copy(target), body: { expectedVersion: target.version, reason }, summary: [['来源',target.namespace],['真实学号',target.value],['停用原因',reason]] };
        }
        draw(); return;
      }
      if (type === 'index-name' || type === 'index-number') {
        requireMaintenance(); const item = s.maintenance[type.slice(6)];
        if (!item.status || !Number.isSafeInteger(item.limit) || item.limit < 1 || item.limit > 200 || item.receipt?.hasMore === false) throw new Error('请读取索引状态并核对1–200条的批次上限。');
        s.review = { kind: type, body: { afterId: item.afterId, limit: item.limit }, summary: [['维护对象',type === 'index-name' ? '学生姓名' : '业务学号'],['起始游标',String(item.afterId)],['本批最多处理',String(item.limit)],['操作说明','只重建索引，不改姓名和学号']] }; draw(); return;
      }
      if (type === 'profile') {
        required(['crm.opportunity.write']); if (!s.detail || !s.refreshed) throw new Error('请刷新需求详情后核对。');
        const profile = profileInput(); s.review = { kind: 'profile', id: s.detail.opportunity.id, baseline: copy(s.detail), body: { profile, expectedVersion: s.detail.opportunity.version, expectedCatalogVersion: s.options.catalogVersion }, summary: profileFields.map(([key, label, kind]) => [label, profileLabel(key, kind, profile[key])]) }; draw(); return;
      }
      if (type === 'judgment') {
        required(['crm.opportunity.write']); const judgment = opts('judgment').find(row => row.id === s.draft.judgmentId);
        if (!s.detail || !s.refreshed || !judgment || !s.draft.judgmentDetail?.trim() || s.draft.judgmentDetail.trim().length > 1000) throw new Error('请选择判定并填写说明，刷新后重新核对。');
        s.review = { kind: 'judgment', id: s.detail.opportunity.id, baseline: copy(s.detail), body: { judgmentId: judgment.id, reasonId: nullable(s.draft.reasonId), detail: s.draft.judgmentDetail.trim(), expectedVersion: s.detail.opportunity.version, expectedCatalogVersion: s.options.catalogVersion }, summary: [['判定', judgment.label], ['效果', judgment.effect === 'close' ? '关闭商机并取消回访' : '仅记录，继续跟进'], ['说明', s.draft.judgmentDetail]] }; draw(); return;
      }
      if (type === 'assignment') {
        required(['crm.opportunity.assign']); const record = s.detail?.opportunity || s.receipt?.opportunity;
        if (!record || !s.refreshed || !s.assignment.ownerId || !s.assignment.reason.trim() || s.assignment.reason.trim().length > 1000) throw new Error('请选择负责人并填写分派原因。');
        s.review = { kind: 'assignment', id: record.id, body: { ownerId: s.assignment.ownerId, reason: s.assignment.reason.trim(), expectedVersion: record.version }, summary: [['原负责人', record.ownerId], ['新负责人', s.assignees.items.find(row => row.id === s.assignment.ownerId)?.name || s.assignment.ownerId], ['原因', s.assignment.reason]] }; draw(); return;
      }
      if (type === 'config-filter') { s.configQuery = { ...s.configQuery, kind: nullable(values.kind), status: values.status || 'all', page: 1 }; return loadConfig(); }
      if (type === 'notification-filter') { s.notificationQuery = { status: values.status || 'unread', page: 1, size: 20 }; return loadNotifications(); }
      if (type === 'config') {
        required(['crm.opportunity.config.manage']); const draft = s.configDraft;
        if (!draft?.label?.trim() || draft.label.length > 100) throw new Error('请填写 100 字以内的显示名称。');
        let body;
        if (draft.id) body = { label: draft.label.trim(), active: String(draft.active) === 'true', expectedVersion: draft.version };
        else {
          if (!kinds[draft.kind] || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,59}$/.test(draft.code || '')) throw new Error('请选择分类并填写字母或数字开头、可含下划线、点或短横线的稳定代码。');
          if (actor.scope !== 'all' && !campusChoices().some(row => row.id === draft.campusId)) throw new Error('请选择账号所属校区。');
          body = { kind: draft.kind, code: draft.code, label: draft.label.trim(), parentId: nullable(draft.parentId), campusId: nullable(draft.campusId), projectMode: draft.kind === 'department' ? nullable(draft.projectMode) : null, effect: draft.kind === 'judgment' ? nullable(draft.effect) : null };
          if (draft.kind === 'department' && !body.projectMode || draft.kind === 'judgment' && !body.effect || ['project', 'judgment_reason'].includes(draft.kind) && !body.parentId) throw new Error('请完整选择该配置的稳定含义及父项。');
        }
        s.review = { kind: draft.id ? 'config-update' : 'config-create', id: draft.id || null, body, summary: [['分类', kinds[draft.kind]], ['名称', body.label], ['代码', draft.code], ['范围', draft.campusId || '全局'], ['状态', body.active === false ? '停用，保留历史' : '使用中']] }; draw(); return;
      }
      if (type === 'customer-create') {
        required(['crm.customer.write']); if (!s.draft.displayName?.trim() || s.draft.displayName.trim().length > 120 || !campusChoices().some(row => row.id === s.draft.campusId)) throw new Error('请填写客户名称并选择授权校区。');
        const body = { displayName: s.draft.displayName.trim(), campusId: s.draft.campusId, contacts: s.draft.phone?.trim() ? [{ personRole: 'guardian', channel: 'phone', value: s.draft.phone.trim(), primary: true }] : [] };
        s.review = { kind: 'customer', body, summary: [['客户名称', body.displayName], ['负责校区', body.campusId], ['联系电话', s.draft.phone || '未登记']] }; draw();
      }
    }
    async function act(action, data) {
      if (action === 'retry') return commit();
      if (locked()) return;
      if (action === 'back') return onReturn();
      if (action === 'refresh') return restore(null, actor);
      if (s.restricted || s.loading) return;
      if (action === 'open-identifiers') { if (s.context && s.draft.studentChoice && s.draft.studentChoice !== 'unknown') onOpenIdentifiers({ customerId: s.context.customer.id, studentId: s.draft.studentChoice }); return; }
      if (action === 'identifiers-page') { s.identifierQuery.page = Number(data.page); return loadIdentifiers(); }
      if (action === 'identifier-deactivate') { const item = s.identifiers?.items.find(row => row.id === data.id && row.active); if (item && has('crm.customer.identity.write')) { s.identifierTarget = copy(item); s.identifierDraft.reason = ''; s.review = null; draw(); } return; }
      if (action === 'identifier-cancel') { s.identifierTarget = null; s.identifierDraft.reason = ''; s.review = null; draw(); return; }
      if (action === 'index-reset') { requireMaintenance(); const item = s.maintenance[data.kind]; if (item) { item.afterId = 0; item.receipt = null; s.review = null; draw(); } return; }
      if (action === 'customer') { if (!s.customers?.items.some(row => row.id === data.id)) return; s.dirty = false; s.students = null; s.existing = null; return loadCustomer(data.id); }
      if (action === 'student-intake-toggle') { if (!has('crm.customer.write') || !has('student.write') || s.route.studentId) return; s.studentIntakeOpen = !s.studentIntakeOpen; s.studentIntakeDraft = { name: '', grade: '', phone: '', relationship: 'child' }; draw(); return; }
      if (action === 'student-intake-cancel') { s.studentIntakeOpen = false; s.studentIntakeDraft = { name: '', grade: '', phone: '', relationship: 'child' }; draw(); return; }
      if (action === 'customers-page') return searchCustomers(Number(data.page), s.customerQuery, s.customerSearchType, true);
      if (['students-page', 'existing-page', 'orderHistory-page', 'consultations-page'].includes(action)) return loadPage(action.replace('-page', ''), Number(data.page));
      if (action === 'open-candidate') { const candidate = [...(s.existing?.items || []), ...(s.preview?.expectedPreview.candidates || [])].find(row => row.targetRef === data.id && row.readable); if (candidate) onOpenOpportunity(candidate.targetRef); return; }
      if (action === 'open-receipt') { if (s.receipt?.opportunity && s.assignmentReceipt?.scopeStatus !== 'left_scope') onOpenOpportunity(s.receipt.opportunityId); return; }
      if (action === 'classify') { const record = s.detail?.opportunity; if (record) { s.mode = 'intake'; s.route = { ...s.route, mode: 'intake', customerId: record.customerId, studentId: record.studentId, subject: record.subject, term: record.term, title: record.title }; return loadCustomer(record.customerId); } }
      if (action === 'assignees' || action === 'assignees-page') return loadAssignees(Number(data.page || 1));
      if (action === 'commit-review') { if (s.review) return begin(s.review.kind, s.review.body, s.review.id, s.review.baseline); return; }
      if (action === 'cancel-review') { s.review = null; draw(); return; }
      if (action === 'config-new') { s.configDraft = { kind: '', code: '', label: '', campusId: '', parentId: '', projectMode: '', effect: '' }; s.review = null; draw(); return; }
      if (action === 'config-edit') { const row = s.config?.items.find(item => item.id === data.id); if (row) { s.configDraft = { ...row, active: String(row.active) }; s.review = null; draw(); } return; }
      if (action === 'config-cancel') { s.configDraft = null; s.review = null; s.dirty = false; draw(); return; }
      if (action === 'config-page') { s.configQuery.page = Number(data.page); return loadConfig(); }
      if (action === 'parents-page') return loadParents(Number(data.page));
      if (action === 'notifications-page') { s.notificationQuery.page = Number(data.page); return loadNotifications(); }
      if (action === 'notification-open') { const row = s.notifications?.items.find(item => item.id === data.id); if (row?.visibility === 'visible' && row.opportunityId) onOpenOpportunity(row.opportunityId); return; }
      if (action === 'notification-read') { const row = s.notifications?.items.find(item => item.id === data.id); if (row && !row.readAt) return begin('notification', { expectedVersion: row.version }, row.id); return; }
      if (action === 'register') { s.registering = true; s.draft = {}; draw(); return; }
      if (action === 'cancel-register') { s.registering = false; s.draft = {}; s.review = null; s.dirty = false; draw(); }
    }
    async function safely(call) { try { await call(); } catch (error) { if (active && !disposed) { s.error = error.message || '请核对填写内容。'; draw(); } } }
    function bind(container = root.document.getElementById('view')) {
      if (!container || disposed) return;
      bindings.get(container)?.();
      const handlers = {
        click: event => { const button = event.target.closest?.('[data-jn-action]'); if (!button || button.disabled) return; event.preventDefault(); void safely(() => act(button.dataset.jnAction, button.dataset)); },
        submit: event => { const form = event.target.closest?.('[data-jn-form]'); if (!form) return; event.preventDefault(); if (form.reportValidity && !form.reportValidity()) return; void safely(() => submit(form)); },
        input: event => { const form = event.target.closest?.('[data-jn-form]'); if (form) capture(form); },
        change: event => { const form = event.target.closest?.('[data-jn-form]'); if (!form || locked() || s.restricted || s.loading && form.dataset.jnForm !== 'search') return; capture(form); const name = event.target.name;
          if (form.dataset.jnForm === 'search' && name === 'searchType') { void safely(() => searchCustomers(1, s.customerSearchDraft.query, s.customerSearchDraft.searchType)); return; }
          if (form.dataset.jnForm === 'need' && name === 'studentChoice') { draw(); }
          else if (form.dataset.jnForm === 'need' && name === 'departmentId') { s.draft.projectId = ''; draw(); }
          else if (['need', 'profile'].includes(form.dataset.jnForm) && name === 'fiscalYearId') { s.draft.quarterId = ''; draw(); }
          else if (form.dataset.jnForm === 'judgment' && name === 'judgmentId') { s.draft.reasonId = ''; draw(); }
          else if (form.dataset.jnForm === 'decision' && name === 'action') { s.decision.targetRef = ''; draw(); }
          else if (form.dataset.jnForm === 'config' && name === 'kind' && !s.configDraft.id) { s.configDraft.parentId = ''; s.configDraft.projectMode = ''; s.configDraft.effect = ''; void safely(async () => { await loadParents(); draw(); }); }
        }
      };
      for (const [name, handler] of Object.entries(handlers)) container.addEventListener(name, handler);
      const unbind = () => { for (const [name, handler] of Object.entries(handlers)) container.removeEventListener?.(name, handler); if (bindings.get(container) === unbind) bindings.delete(container); };
      bindings.set(container, unbind); bound = unbind;
    }
    async function open(route) {
      if (locked()) return false;
      s.route = copy(route); s.mode = route.mode || 'intake'; s.error = ''; s.notice = ''; active = true;
      if (s.mode === 'identifiers') return loadIdentifiers();
      if (s.mode === 'searchMaintenance') return loadMaintenance();
      if (s.mode === 'configuration') { required(['crm.opportunity.config.manage']); return loadConfig(); }
      if (s.mode === 'notifications') { required(['crm.opportunity.read']); return loadNotifications(); }
      if (s.mode === 'profile') return loadProfile();
      required(['crm.opportunity.intake', 'crm.customer.read']);
      if (route.register) { required(['crm.customer.write']); s.registering = true; s.draft = {}; draw(); return; }
      return route.customerId ? loadCustomer(route.customerId) : searchCustomers();
    }
    async function restore(snapshot, currentIdentity) {
      if (disposed) return;
      if (currentIdentity?.principalId !== actor.principalId) throw new Error('登录身份已变化，不能恢复原账号草稿。');
      actor = currentIdentity; if (snapshot) s = copy(snapshot); active = true; generation++; s.loading = false;
      const permissions = s.mode === 'identifiers' ? ['crm.customer.read'] : s.mode === 'searchMaintenance' ? ['crm.customer.search.manage'] : s.mode === 'profile' ? ['crm.opportunity.read'] : s.mode === 'configuration' ? ['crm.opportunity.config.manage'] : s.mode === 'notifications' ? ['crm.opportunity.read'] : ['crm.opportunity.intake', 'crm.customer.read'];
      if (permissions.some(code => !has(code)) || s.mode === 'identifiers' && !has('crm.opportunity.intake') && !has('student.read') || s.mode === 'searchMaintenance' && actor.scope !== 'all') { restrictProjection(); s.error = '当前账号已没有此工作页的查看权限，原资料已隐藏。'; draw(); return; }
      if (locked()) { draw(); return; }
      if (s.mode === 'identifiers') return loadIdentifiers();
      if (s.mode === 'searchMaintenance') return loadMaintenance();
      if (s.mode === 'configuration') return loadConfig();
      if (s.mode === 'notifications') return loadNotifications();
      if (s.mode === 'profile') return loadProfile(true);
      if (s.receipt) {
        // A customer remains readable after a sales handover; recheck the opportunity independently.
        const opportunityId = s.receipt.opportunityId; restrictProjection();
        if (!has('crm.opportunity.read')) { s.restricted = false; draw(); return; }
        await read(() => api.needs.get(opportunityId), detail => {
          if (detail?.opportunity?.id !== opportunityId || !version(detail.opportunity.version)) throw new Error('需求详情回执无效。');
          s.receipt.opportunity = detail.opportunity; s.refreshed = true; s.restricted = false;
        });
        if (s.refreshed && has('crm.opportunity.assign') && ['created', 'created_distinct'].includes(s.receipt.outcome)) await loadAssignees(1);
        return;
      }
      return s.route.customerId ? loadCustomer(s.route.customerId, true) : searchCustomers(s.customerPage, s.customerQuery, s.customerSearchType, true);
    }
    function suspend() { if (locked()) return false; active = false; generation++; s.loading = false; bound?.(); bound = null; return true; }
    return Object.freeze({ open, html, bind, restore, snapshot: () => copy(s), suspend, canLeave: () => !locked(),
      isDirty: () => !!s.review || (s.mode === 'identifiers' ? !!(s.identifierDraft.namespace || s.identifierDraft.value || s.identifierDraft.reason) : s.mode === 'profile' ? profileFields.some(([key]) => nullable(s.draft[key]) !== nullable(s.profileBaseline?.[key])) || !!(s.draft.judgmentId || s.draft.judgmentDetail || s.assignment.ownerId || s.assignment.reason) : s.dirty), title: () => s.mode === 'identifiers' ? `学号备案 · ${s.route.studentId}` : s.mode === 'searchMaintenance' ? '客户检索维护' : s.mode === 'profile' ? `需求资料 · ${s.detail?.opportunity.title || s.route.opportunityId}` : s.mode === 'intake' ? `前台接待${s.context ? ` · ${s.context.customer.displayName}` : ''}` : s.mode === 'configuration' ? '需求配置' : '站内提醒',
      dispose() { disposed = true; active = false; generation++; bound?.(); bound = null; } });
  }
  root.SiyueCrmNeeds = Object.freeze({ pages, create });
})(window);
